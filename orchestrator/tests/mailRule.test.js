// CU-03: alerta de la regla de correo (mail-scan.py, via Wazuh) -> incidente.
// El servidor de correo (src/mailProvider.js) y VirusTotal estan mockeados.
jest.mock("../src/mailProvider");
jest.mock("../src/enrichment", () => ({
  enrichIp: jest.fn(async () => ({ vt: null, abuseipdb: null })),
  enrichUrl: jest.fn(async () => null),
  enrichFile: jest.fn(async () => null),
}));

const request = require("supertest");
const { app } = require("../src/app");
const { prisma } = require("../src/db");
const mailProvider = require("../src/mailProvider");
const { ingestReport } = require("../src/email");
const { describeMessage } = require("../src/emailParse");

const ALICE = "alice@lab.micro-soar.internal";
const BOB = "bob@lab.micro-soar.internal";
const LABEL = "Detectado por regla de correo, vía Wazuh";

let counter = 0;

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(() => {
  jest.clearAllMocks();
  mailProvider.isEnabled.mockReturnValue(true);
  mailProvider.isMonitored.mockImplementation((mailbox) => [ALICE, BOB].includes(mailbox));
  mailProvider.listRecent.mockResolvedValue([]);
});

// Un correo con indicadores unicos: si no, se sumaria a la campana del anterior.
function mail() {
  counter += 1;
  const messageId = `<regla-${counter}@regla-mail-${counter}.test>`;
  const raw = Buffer.from(
    [
      `From: Facturacion <facturacion@regla-mail-${counter}.test>`,
      `Reply-To: cobros@otro-${counter}.test`,
      `Subject: Factura ${counter}`,
      `Message-ID: ${messageId}`,
      "Date: Sun, 01 Nov 2026 03:00:00 +0000",
      "",
      `Pague en http://regla-mail-${counter}.test/pagar`,
      "",
    ].join("\r\n")
  );
  mailProvider.fetchMessage.mockResolvedValue(raw);
  return { messageId, raw };
}

const alert = (messageId, data = {}) => ({
  timestamp: "2026-11-01T03:00:02.000+0000",
  rule: { id: "100510", level: 10, description: "Regla de correo", groups: ["local", "phishing"] },
  agent: { id: "004", name: "micro-soar-mail" },
  data: { scanner: "mail-scan", message_id: messageId, mailbox: ALICE, reason: "Adjunto ejecutable", delivered_at: "2026-11-01T03:00:00.000Z", ...data },
});

const webhook = (body) => request(app).post("/api/v1/webhook/wazuh").send(body);
const asReport = async (raw, reporter) => ({ source: "user_report", reporter, receivedAt: new Date(), ...(await describeMessage(raw)) });

describe("webhook con alerta de la regla de correo", () => {
  test("abre un incidente CU-03 sin reportantes, con el origen correcto", async () => {
    const { messageId } = mail();
    const resp = await webhook(alert(messageId));

    expect(resp.status).toBe(201);
    expect(resp.body).toMatchObject({ useCase: "CU-03", source: "gateway", ruleId: "mail-rule" });
    expect(resp.body.ruleDescription).toMatch(/^Phishing detectado: /);
    expect(mailProvider.fetchMessage).toHaveBeenCalledWith(ALICE, messageId);

    const email = await prisma.incidentEmail.findFirst({ where: { incidentId: resp.body.id } });
    expect(email).toMatchObject({ messageId, origin: "gateway", reportedBy: "[]" });
    const [row] = await prisma.incidentAlert.findMany({ where: { incidentId: resp.body.id } });
    expect(row).toMatchObject({ ruleId: "mail-rule", ruleDescription: LABEL, detail: "Adjunto ejecutable", timestamp: "2026-11-01T03:00:00.000Z" });
    const audit = await prisma.auditEvent.findFirst({ where: { incidentId: resp.body.id, type: "incident_detected" } });
    expect(audit.detail ?? audit.message ?? JSON.stringify(audit)).toContain(LABEL);
    expect(JSON.stringify(audit)).not.toMatch(/reportado/i);
  });

  test("primero la regla y despues un reporte: un solo incidente, con las dos rutas", async () => {
    const { messageId, raw } = mail();
    const first = await webhook(alert(messageId));
    const second = await ingestReport(await asReport(raw, ALICE));

    expect(second).toMatchObject({ created: false });
    expect(second.incident.id).toBe(first.body.id);
    const email = await prisma.incidentEmail.findFirst({ where: { incidentId: first.body.id } });
    expect(email.origin).toBe("gateway");
    expect(JSON.parse(email.reportedBy)).toEqual([ALICE]);
  });

  test("primero un reporte y despues la regla: un solo incidente, con las dos rutas", async () => {
    const { messageId, raw } = mail();
    const { incident } = await ingestReport(await asReport(raw, ALICE));
    const resp = await webhook(alert(messageId));

    expect(resp.status).toBe(200);
    expect(resp.body.id).toBe(incident.id);
    expect(resp.body.source).toBe("user_report");
    const email = await prisma.incidentEmail.findFirst({ where: { incidentId: incident.id } });
    expect(email.origin).toBe("gateway");
    expect(JSON.parse(email.reportedBy)).toEqual([ALICE]);
    const audit = await prisma.auditEvent.findFirst({ where: { incidentId: incident.id, type: "alert_grouped" } });
    expect(JSON.stringify(audit)).toContain(LABEL);
  });

  test.each([
    ["sin Message-ID", { message_id: undefined }],
    ["Message-ID sin formato", { message_id: "regla@x" }],
    ["fecha invalida", { delivered_at: "ayer" }],
  ])("payload invalido: %s", async (_, data) => {
    const resp = await webhook(alert("<valido@x.test>", data));
    expect(resp.status).toBe(422);
    expect(mailProvider.fetchMessage).not.toHaveBeenCalled();
  });

  test("buzon no monitoreado: no se toca el servidor de correo", async () => {
    const resp = await webhook(alert("<valido@x.test>", { mailbox: "phishing@lab.micro-soar.internal" }));
    expect(resp.status).toBe(403);
    expect(mailProvider.fetchMessage).not.toHaveBeenCalled();
  });

  test("el correo ya no esta, o es otro: no abre incidente", async () => {
    mailProvider.fetchMessage.mockResolvedValue(null);
    expect((await webhook(alert("<no-esta@x.test>"))).status).toBe(404);

    mail();
    expect((await webhook(alert("<subcadena@x.test>"))).status).toBe(404);
  });

  test("si falla el servidor de correo responde 502, sin tirar el proceso", async () => {
    mailProvider.fetchMessage.mockRejectedValue(new Error("IMAP caido"));
    const resp = await webhook(alert("<caido@x.test>"));
    expect(resp.status).toBe(502);
  });

  test("una alerta de fuerza bruta sigue por la ruta de siempre", async () => {
    const resp = await webhook(require("../mocks/wazuh_ssh_bruteforce.json"));
    expect(resp.body).toMatchObject({ source: "wazuh", useCase: "CU-01" });
    expect(mailProvider.fetchMessage).not.toHaveBeenCalled();
  });
});
