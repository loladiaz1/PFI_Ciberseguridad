// CU-03: busqueda de correos similares de la campana (src/campaign.js).
jest.mock("../src/mailProvider");
jest.mock("../src/enrichment", () => ({
  enrichIp: jest.fn(async () => ({ vt: null, abuseipdb: null })),
  enrichUrl: jest.fn(async () => null),
  enrichFile: jest.fn(async () => null),
}));

const fs = require("fs");
const path = require("path");
const request = require("supertest");
const { app } = require("../src/app");
const { prisma } = require("../src/db");
const mailProvider = require("../src/mailProvider");
const { parseReport } = require("../src/emailParse");
const { ingestReport } = require("../src/email");
const { matchOf, indicatorsOf, normalizeSubject, excludedDomains } = require("../src/campaign");
// El proveedor devuelve { messageId: [buzones] }: todos encontrados en estos buzones.
const foundIn = (boxes) => async (ids) => Object.fromEntries(ids.map((id) => [id, boxes]));
const { adminToken } = require("./helpers");

const RAW_REPORT = fs.readFileSync(path.join(__dirname, "..", "mocks", "phishing_report.eml"));
const EICAR = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*").toString("base64");
const ORIGINAL_ENV = { ...process.env };

let token;
let counter = 0;

// Correo crudo minimo con los campos que importan para la busqueda.
function mime({ id, from, replyTo, subject, body = "Hola", eicar = false }) {
  const headers = [
    `Message-Id: <${id}>`,
    `From: ${from}`,
    replyTo ? `Reply-To: ${replyTo}` : null,
    "To: bob@lab.micro-soar.internal",
    `Subject: ${subject}`,
    "Date: Fri, 17 Oct 2026 15:00:00 +0000",
    "MIME-Version: 1.0",
  ].filter(Boolean);
  if (!eicar) return Buffer.from([...headers, "Content-Type: text/plain", "", body, ""].join("\r\n"));
  return Buffer.from(
    [
      ...headers,
      'Content-Type: multipart/mixed; boundary="B"',
      "",
      "--B",
      "Content-Type: text/plain",
      "",
      body,
      "--B",
      'Content-Type: application/octet-stream; name="pago.exe"',
      'Content-Disposition: attachment; filename="pago.exe"',
      "Content-Transfer-Encoding: base64",
      "",
      EICAR,
      "--B--",
      "",
    ].join("\r\n")
  );
}

beforeAll(async () => {
  token = await adminToken();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.MAIL_REPORT_MAILBOX = "phishing@lab.micro-soar.internal";
  mailProvider.isEnabled.mockReturnValue(true);
  mailProvider.listRecent.mockResolvedValue([]);
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

// Un incidente CU-03 nuevo (cada test, su propia campana) con lo que
// devuelva el servidor de correo en la busqueda.
async function campaignWith(recent) {
  await closeOpenCampaigns();
  counter += 1;
  mailProvider.listRecent.mockResolvedValue(recent);
  const report = await parseReport(RAW_REPORT, new Date());
  const { incident } = await ingestReport({ ...report, messageId: `<original-${counter}@proveedor-pagos.test>` });
  return { incident, report: { ...report, messageId: `<original-${counter}@proveedor-pagos.test>` } };
}

// Todos los tests usan el mismo correo de ejemplo: se cierran las campanas
// abiertas para que cada uno arranque la suya.
const closeOpenCampaigns = () => prisma.incident.updateMany({ where: { useCase: "CU-03", closedAt: null }, data: { closedAt: new Date() } });

const emailsOf = (incidentId) => prisma.incidentEmail.findMany({ where: { incidentId }, orderBy: { id: "asc" } });
const post = (url, body) => request(app).post(url).set("Authorization", `Bearer ${token}`).send(body);

describe("indicadores y puntaje", () => {
  const excluded = ["lab.micro-soar.internal", "gmail.com"];
  const campaign = indicatorsOf(
    [
      {
        fromAddress: "facturacion@proveedor-pagos.test",
        replyTo: "cobranzas@pagos-urgentes.test",
        subject: "Factura #4411 vencida",
        sendingIp: "203.0.113.45",
        urls: [{ url: "http://malo.test/pagar" }],
        attachments: [{ sha256: "abc" }],
      },
    ],
    excluded
  );
  const message = (overrides) => ({ fromAddress: null, replyTo: null, subject: null, sendingIp: null, urls: [], attachments: [], ...overrides });

  test("un indicador fuerte alcanza solo: adjunto, URL, dominio, Reply-To, IP de envio", () => {
    expect(matchOf(campaign, message({ attachments: [{ sha256: "abc" }] }), excluded).score).toBe(3);
    expect(matchOf(campaign, message({ urls: ["http://malo.test/otra-ruta"] }), excluded).reasons).toEqual([
      { type: "urlDomain", value: "malo.test" },
    ]);
    expect(matchOf(campaign, message({ replyTo: "cobranzas@pagos-urgentes.test" }), excluded).score).toBe(3);
    expect(matchOf(campaign, message({ sendingIp: "203.0.113.45" }), excluded).score).toBe(3);
  });

  test("el remitente solo no alcanza; remitente + asunto parecido si", () => {
    expect(matchOf(campaign, message({ fromAddress: "facturacion@proveedor-pagos.test" }), excluded).score).toBe(3);
    expect(matchOf(campaign, message({ fromAddress: "otro@proveedor-pagos.test" }), excluded).score).toBe(1);
    expect(matchOf(campaign, message({ fromAddress: "otro@proveedor-pagos.test", subject: "RE: Factura #9902 vencida" }), excluded).score).toBe(2);
  });

  test("los dominios propios y comunes no relacionan correos", () => {
    const internal = indicatorsOf([message({ fromAddress: "rrhh@lab.micro-soar.internal", urls: ["https://gmail.com/x"] })], excluded);
    expect([...internal.from, ...internal.urlDomain]).toEqual([]);
    expect(excludedDomains()).toContain("lab.micro-soar.internal");
    process.env.MAIL_HUNT_EXCLUDE = "proveedor-confiable.com";
    expect(excludedDomains()).toContain("proveedor-confiable.com");
  });

  test("asunto normalizado: sin RE/FWD ni numeros; los muy cortos no cuentan", () => {
    expect(normalizeSubject("RE: Fwd: Factura #4411  vencida")).toBe("factura ## vencida");
    expect(normalizeSubject("Hola")).toBeNull();
    expect(normalizeSubject(null)).toBeNull();
  });
});

describe("busqueda en los buzones", () => {
  test("al crear el incidente encuentra las variantes de la campana y no los correos legitimos", async () => {
    const { incident } = await campaignWith([
      // Otro asunto y remitente, mismo adjunto -> candidato
      { mailbox: "bob@lab", raw: mime({ id: "variante-hash@x.test", from: "pagos@otro-remitente.test", subject: "Comprobante adjunto", eicar: true }) },
      // Mismo dominio de enlace, otra ruta -> candidato (en dos buzones)
      { mailbox: "alice@lab", raw: mime({ id: "variante-url@x.test", from: "aviso@tercero.test", subject: "Ultimo aviso", body: "Pague en http://malware.testing.google.test/otra" }) },
      { mailbox: "bob@lab", raw: mime({ id: "variante-url@x.test", from: "aviso@tercero.test", subject: "Ultimo aviso", body: "Pague en http://malware.testing.google.test/otra" }) },
      // Legitimo: nada en comun
      { mailbox: "alice@lab", raw: mime({ id: "newsletter@empresa.test", from: "news@empresa.test", subject: "Novedades de octubre" }) },
      // El correo reportado mismo no es un candidato
      { mailbox: "alice@lab", raw: mime({ id: `original-${counter + 1}@proveedor-pagos.test`, from: "facturacion@proveedor-pagos.test", subject: "x" }) },
    ]);

    const candidates = (await emailsOf(incident.id)).filter((e) => e.origin === "candidate");
    expect(candidates.map((c) => c.messageId).sort()).toEqual(["<variante-hash@x.test>", "<variante-url@x.test>"]);
    const byUrl = candidates.find((c) => c.messageId === "<variante-url@x.test>");
    expect(JSON.parse(byUrl.mailboxes)).toEqual(["alice@lab", "bob@lab"]);
    expect(JSON.parse(byUrl.matchedBy)).toEqual({ score: 3, reasons: [{ type: "urlDomain", value: "malware.testing.google.test" }] });
    expect(mailProvider.listRecent).toHaveBeenCalledWith(expect.any(Date));

    const audit = await prisma.auditEvent.findFirst({ where: { incidentId: incident.id, type: "campaign_searched" } });
    expect(audit.detail).toBe(`Búsqueda de correos similares: 2 nuevo(s) entre 3 correo(s) revisado(s) (incidente #${incident.id})`);

    // Repetir la busqueda no duplica candidatos.
    const again = await post(`/api/v1/incidents/${incident.id}/search-similar`);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ scanned: 1, found: 0 });
  });

  test("la cuarentena sin elegir no toca a los candidatos; eligiendolos, si", async () => {
    const { incident } = await campaignWith([
      { mailbox: "bob@lab", raw: mime({ id: "variante-q@x.test", from: "a@b.test", subject: "Pago", eicar: true }) },
    ]);
    const [reported, candidate] = await emailsOf(incident.id);
    mailProvider.quarantine.mockImplementation(foundIn(["bob@lab"]));

    await post(`/api/v1/incidents/${incident.id}/actions/quarantine-email`);
    expect(mailProvider.quarantine).toHaveBeenCalledTimes(1);
    expect(mailProvider.quarantine).toHaveBeenCalledWith([reported.messageId]);

    const both = await post(`/api/v1/incidents/${incident.id}/actions/quarantine-email`, { messageIds: [candidate.id] });
    expect(both.status).toBe(200);
    expect((await prisma.incidentEmail.findUnique({ where: { id: candidate.id } })).status).toBe("quarantined");

    // Restaurar sin elegir devuelve todo, candidatos incluidos.
    mailProvider.restore.mockImplementation(foundIn(["bob@lab"]));
    const restored = await post(`/api/v1/incidents/${incident.id}/actions/restore-email`);
    expect(restored.body).toMatchObject({ emails: 2, remaining: 0, status: "restored" });
  });

  test("descartar un candidato: queda auditado y no se puede descartar dos veces", async () => {
    const { incident } = await campaignWith([
      { mailbox: "bob@lab", raw: mime({ id: "variante-d@x.test", from: "a@b.test", subject: "Pago", eicar: true }) },
    ]);
    const [reported, candidate] = await emailsOf(incident.id);

    const resp = await post(`/api/v1/incidents/${incident.id}/emails/${candidate.id}/dismiss`);
    expect(resp.status).toBe(200);
    expect(resp.body.status).toBe("dismissed");
    expect(resp.body.matchedBy.score).toBe(3);
    const audit = await prisma.auditEvent.findFirst({ where: { incidentId: incident.id, type: "email_dismissed" } });
    expect(audit.detail).toMatch(/Correo descartado de la campaña: "Pago" de a@b.test/);

    expect((await post(`/api/v1/incidents/${incident.id}/emails/${candidate.id}/dismiss`)).status).toBe(409);
    expect((await post(`/api/v1/incidents/${incident.id}/emails/${reported.id}/dismiss`)).status).toBe(409);
    expect((await post(`/api/v1/incidents/${incident.id}/emails/999999/dismiss`)).status).toBe(404);
    expect((await post("/api/v1/incidents/999999/emails/1/dismiss")).status).toBe(404);
  });

  test("si un usuario reporta un candidato, pasa a confirmado", async () => {
    const { incident, report } = await campaignWith([
      { mailbox: "bob@lab", raw: mime({ id: "variante-r@x.test", from: "a@b.test", subject: "Pago", eicar: true }) },
    ]);
    const { created } = await ingestReport({ ...report, messageId: "<variante-r@x.test>", reporter: "bob@lab.micro-soar.internal" });
    expect(created).toBe(false);
    const email = await prisma.incidentEmail.findFirst({ where: { incidentId: incident.id, messageId: "<variante-r@x.test>" } });
    expect(email.origin).toBe("reported");
    expect(JSON.parse(email.reportedBy)).toEqual(["bob@lab.micro-soar.internal"]);
  });

  test("errores: sin integracion, fuera de CU-03, servidor caido", async () => {
    const { incident } = await campaignWith([]);
    mailProvider.isEnabled.mockReturnValue(false);
    const disabled = await post(`/api/v1/incidents/${incident.id}/search-similar`);
    expect(disabled.status).toBe(502);
    expect(disabled.body.detail).toMatch(/no está configurada/);

    mailProvider.isEnabled.mockReturnValue(true);
    mailProvider.listRecent.mockRejectedValue(new Error("IMAP caido"));
    expect((await post(`/api/v1/incidents/${incident.id}/search-similar`)).status).toBe(502);

    const bruteforce = await request(app).post("/api/v1/webhook/wazuh").send(require("../mocks/wazuh_ssh_bruteforce.json"));
    expect((await post(`/api/v1/incidents/${bruteforce.body.id}/search-similar`)).status).toBe(422);
    expect((await post("/api/v1/incidents/999999/search-similar")).status).toBe(404);
  });

  test("si falla la busqueda automatica, el incidente se crea igual", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    mailProvider.listRecent.mockRejectedValue(new Error("IMAP caido"));
    await closeOpenCampaigns();
    const report = await parseReport(RAW_REPORT, new Date());
    const { created } = await ingestReport({ ...report, messageId: "<falla-busqueda@test>" });
    expect(created).toBe(true);
  });
});

describe("reportes de otras variantes de la campana", () => {
  test("otro Message-ID con el mismo adjunto se suma a la campana abierta, no abre otro caso", async () => {
    const { incident, report } = await campaignWith([]);
    const variant = {
      ...report,
      messageId: "<variante-reportada@x.test>",
      reporter: "bob@lab.micro-soar.internal",
      subject: "Comprobante de transferencia",
      fromAddress: "tesoreria@otro.test",
      replyTo: null,
      sendingIp: null,
      urls: [],
    };

    const { incident: grouped, created } = await ingestReport(variant);
    expect(created).toBe(false);
    expect(grouped.id).toBe(incident.id);
    expect(grouped.alertCount).toBe(2);

    const emails = await emailsOf(incident.id);
    expect(emails).toHaveLength(2);
    expect(emails[1]).toMatchObject({ origin: "reported", subject: "Comprobante de transferencia", reportedBy: '["bob@lab.micro-soar.internal"]' });
    expect(JSON.parse(emails[1].matchedBy).reasons).toEqual([{ type: "attachment", value: report.attachments[0].sha256 }]);
    const audit = await prisma.auditEvent.findFirst({ where: { incidentId: incident.id, type: "alert_grouped" } });
    expect(audit.detail).toMatch(/Otro correo de la campaña reportado por bob@lab.micro-soar.internal: "Comprobante de transferencia"/);

    // Sin remitente ni asunto tambien se suma (y queda registrado igual).
    const anonymous = await ingestReport({ ...variant, messageId: "<variante-2@x.test>", reporter: null, subject: null });
    expect(anonymous.incident.id).toBe(incident.id);
  });

  test("solo un asunto parecido no alcanza para mezclar casos", async () => {
    const { incident, report } = await campaignWith([]);
    const unrelated = {
      ...report,
      messageId: "<otro-caso@y.test>",
      fromAddress: "otro@y.test",
      replyTo: null,
      sendingIp: null,
      urls: [],
      attachments: [],
    };
    const { incident: other, created } = await ingestReport(unrelated);
    expect(created).toBe(true);
    expect(other.id).not.toBe(incident.id);
  });
});
