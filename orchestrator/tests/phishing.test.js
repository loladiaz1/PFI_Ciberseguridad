// CU-03: reporte de phishing -> incidente (campana) -> cuarentena / restauracion.
// El servidor de correo (src/mailProvider.js) y VirusTotal estan mockeados.
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
const { enrichUrl, enrichFile } = require("../src/enrichment");
const { parseReport, ingestReport, pollReports, startReportPolling } = require("../src/email");
const { backfillUseCases } = require("../src/normalize");
const { adminToken, tokenFor } = require("./helpers");

const RAW_REPORT = fs.readFileSync(path.join(__dirname, "..", "mocks", "phishing_report.eml"));
const ALICE = "alice@lab.micro-soar.internal";
const BOB = "bob@lab.micro-soar.internal";

let token;
let messageCounter = 0;

beforeAll(async () => {
  token = await adminToken();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(() => {
  jest.clearAllMocks();
  mailProvider.isEnabled.mockReturnValue(true);
  enrichUrl.mockResolvedValue(null);
  enrichFile.mockResolvedValue(null);
});

// Un reporte con Message-ID propio (cada test, su propia campana).
async function report(overrides = {}) {
  const parsed = await parseReport(RAW_REPORT, new Date());
  messageCounter += 1;
  return { ...parsed, messageId: `<campana-${messageCounter}@test>`, ...overrides };
}

const post = (url, body) => request(app).post(url).set("Authorization", `Bearer ${token}`).send(body);

describe("parseReport", () => {
  test("extrae del original adjunto el Message-ID, remitente, URLs, hash y la IP de envio", async () => {
    const r = await parseReport(RAW_REPORT, new Date("2026-10-17T14:05:00Z"));
    expect(r).toMatchObject({
      source: "user_report",
      reporter: ALICE,
      messageId: "<factura-1760709600-1234@proveedor-pagos.test>",
      fromAddress: "facturacion@proveedor-pagos.test",
      replyTo: "cobranzas@pagos-urgentes.test",
      subject: "Factura vencida - accion requerida",
      sendingIp: "203.0.113.45",
      urls: ["http://malware.testing.google.test/testing/malware/"],
    });
    // SHA-256 del archivo de prueba EICAR.
    expect(r.attachments).toEqual([
      { name: "factura.exe", sha256: "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f", size: 68 },
    ]);
    expect(r.receivedAt.toISOString()).toBe("2026-10-17T14:05:00.000Z");
  });

  test("rechaza un reenvio sin el original adjunto (sin Message-ID no se lo puede buscar)", async () => {
    const inline = "From: alice@lab.micro-soar.internal\r\nSubject: Fwd: factura\r\n\r\n---- reenviado ----\r\nhttp://x.test\r\n";
    await expect(parseReport(Buffer.from(inline))).rejects.toThrow(/adjunto/);
  });

  test("rechaza un original sin Message-ID", async () => {
    // \r?: el .eml tiene CRLF en Windows y LF en el checkout de Linux (CI).
    const raw = RAW_REPORT.toString().replace(/Message-Id: <factura[^>]+>\r?\n/, "");
    await expect(parseReport(Buffer.from(raw))).rejects.toThrow(/Message-ID/);
  });
});

describe("ingesta", () => {
  test("un reporte crea un incidente CU-03 con el correo, la alerta y la auditoria", async () => {
    const r = await report();
    const { incident, created } = await ingestReport(r);

    expect(created).toBe(true);
    expect(incident).toMatchObject({ useCase: "CU-03", source: "user_report", severity: 6, srcIp: null, status: "new", alertCount: 1 });
    expect(JSON.parse(incident.tags)).toEqual(["phishing"]);

    const detail = await request(app).get(`/api/v1/incidents/${incident.id}`).set("Authorization", `Bearer ${token}`);
    expect(detail.body.emails).toHaveLength(1);
    expect(detail.body.emails[0]).toMatchObject({ messageId: r.messageId, status: "pending", origin: "reported", reportedBy: [ALICE] });
    expect(detail.body.emails[0].attachments[0].sha256).toMatch(/^275a021b/);

    const alerts = await prisma.incidentAlert.findMany({ where: { incidentId: incident.id } });
    expect(alerts).toEqual([expect.objectContaining({ ruleId: "user-report", detail: `Reportado por ${ALICE}` })]);
    const events = await prisma.auditEvent.findMany({ where: { incidentId: incident.id } });
    expect(events.map((e) => e.type)).toContain("incident_detected");
  });

  test("otro reporte del mismo correo se suma al incidente abierto (campana)", async () => {
    const r = await report();
    const first = await ingestReport(r);
    const second = await ingestReport({ ...r, reporter: BOB });
    const repeated = await ingestReport({ ...r, reporter: BOB });

    expect(second.created).toBe(false);
    expect(second.incident.id).toBe(first.incident.id);
    expect(repeated.incident.alertCount).toBe(3);
    const email = await prisma.incidentEmail.findFirst({ where: { incidentId: first.incident.id } });
    expect(JSON.parse(email.reportedBy)).toEqual([ALICE, BOB]);
  });

  test("si el incidente del correo ya se cerro, un reporte nuevo abre otro", async () => {
    const r = await report();
    const first = await ingestReport(r);
    await prisma.incident.update({ where: { id: first.incident.id }, data: { closedAt: new Date() } });
    const again = await ingestReport(r);
    expect(again.created).toBe(true);
    expect(again.incident.id).not.toBe(first.incident.id);
  });

  test("VirusTotal confirma el adjunto: severidad alta; un solo motor no alcanza", async () => {
    enrichFile.mockResolvedValue(61);
    const confirmed = await ingestReport(await report());
    const high = await prisma.incident.findUnique({ where: { id: confirmed.incident.id }, include: { emails: true } });
    expect(high.severity).toBe(12);
    expect(high.hashPositives).toBe(61);
    expect(JSON.parse(high.emails[0].attachments)[0].vtMalicious).toBe(61);

    enrichFile.mockResolvedValue(null);
    enrichUrl.mockResolvedValue(1);
    const weak = await ingestReport(await report());
    const medium = await prisma.incident.findUnique({ where: { id: weak.incident.id }, include: { emails: true } });
    expect(medium.severity).toBe(6);
    expect(JSON.parse(medium.emails[0].urls)[0]).toEqual({ url: "http://malware.testing.google.test/testing/malware/", vtMalicious: 1 });
  });

  test("respeta el limite de consultas a VirusTotal por correo", async () => {
    const urls = ["http://a.test/1", "http://b.test/2", "http://c.test/3", "http://d.test/4"];
    await ingestReport(await report({ urls }));
    expect(enrichFile).toHaveBeenCalledTimes(1);
    expect(enrichUrl).toHaveBeenCalledTimes(2);
  });

  test("un reporte sin remitente ni asunto igual se ingesta", async () => {
    const { incident } = await ingestReport(await report({ reporter: null, subject: null, fromAddress: null }));
    expect(incident.ruleDescription).toBe("Phishing reportado: (sin asunto)");
    const second = await ingestReport({ ...(await report()), messageId: (await prisma.incidentEmail.findFirst({ where: { incidentId: incident.id } })).messageId, reporter: null });
    expect(second.created).toBe(false);
  });

  test("si falla el enriquecimiento, el incidente queda igual", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    enrichFile.mockRejectedValue(new Error("VT caido"));
    const { incident } = await ingestReport(await report());
    expect((await prisma.incident.findUnique({ where: { id: incident.id } })).severity).toBe(6);
  });
});

describe("lectura del buzon de reportes", () => {
  test("procesa cada reporte que entrega el proveedor", async () => {
    mailProvider.fetchReports.mockImplementation(async (handle) => {
      await handle(RAW_REPORT, new Date());
      return 1;
    });
    expect(await pollReports()).toBe(1);
    expect(await prisma.incidentEmail.count({ where: { messageId: "<factura-1760709600-1234@proveedor-pagos.test>" } })).toBe(1);
  });

  test("apagada sin configuracion; un error del servidor no corta el intervalo", async () => {
    mailProvider.isEnabled.mockReturnValue(false);
    expect(await pollReports()).toBe(0);
    expect(startReportPolling()).toBeNull();
    expect(mailProvider.fetchReports).not.toHaveBeenCalled();

    mailProvider.isEnabled.mockReturnValue(true);
    jest.spyOn(console, "error").mockImplementation(() => {});
    mailProvider.fetchReports.mockRejectedValue(new Error("IMAP caido"));
    expect(await pollReports()).toBe(0);
  });

  test("arranca el intervalo cuando hay configuracion", () => {
    jest.spyOn(console, "log").mockImplementation(() => {});
    const timer = startReportPolling();
    expect(timer).not.toBeNull();
    clearInterval(timer);
  });
});

describe("cuarentena y restauracion", () => {
  async function campaign() {
    const { incident } = await ingestReport(await report());
    return incident;
  }

  test("pone en cuarentena el correo en todos los buzones donde esta", async () => {
    const incident = await campaign();
    mailProvider.quarantine.mockResolvedValue([ALICE, BOB]);

    const resp = await post(`/api/v1/incidents/${incident.id}/actions/quarantine-email`);
    expect(resp.status).toBe(200);
    expect(resp.body.status).toBe("quarantined");

    const persisted = await prisma.incident.findUnique({ where: { id: incident.id }, include: { emails: true } });
    expect(persisted.quarantinedAt).not.toBeNull();
    expect(persisted.actionLatencyMs).not.toBeNull();
    expect(JSON.parse(persisted.tags)).toEqual(["phishing", "email_quarantined"]);
    expect(persisted.emails[0].status).toBe("quarantined");
    expect(JSON.parse(persisted.emails[0].mailboxes)).toEqual([ALICE, BOB]);
    const audit = await prisma.auditEvent.findFirst({ where: { incidentId: incident.id, type: "email_quarantined" } });
    expect(audit.detail).toBe(`Cuarentena de 1 correo(s) en 2 buzón(es) (incidente #${incident.id})`);
  });

  test("restaura, y se puede volver a poner en cuarentena sin perder la primera hora", async () => {
    const incident = await campaign();
    mailProvider.quarantine.mockResolvedValue([ALICE]);
    await post(`/api/v1/incidents/${incident.id}/actions/quarantine-email`);
    const first = (await prisma.incident.findUnique({ where: { id: incident.id } })).quarantinedAt;

    mailProvider.restore.mockResolvedValue([ALICE]);
    const restored = await post(`/api/v1/incidents/${incident.id}/actions/restore-email`);
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({ status: "restored", emails: 1, mailboxes: 1, remaining: 0 });
    expect(mailProvider.restore).toHaveBeenCalledWith(expect.stringMatching(/^<campana-/));

    const again = await post(`/api/v1/incidents/${incident.id}/actions/quarantine-email`);
    expect(again.status).toBe(200);
    expect((await prisma.incident.findUnique({ where: { id: incident.id } })).quarantinedAt).toEqual(first);
  });

  test("acciona solo sobre los correos elegidos (messageIds)", async () => {
    const incident = await campaign();
    const email = await prisma.incidentEmail.findFirst({ where: { incidentId: incident.id } });
    mailProvider.quarantine.mockResolvedValue([ALICE]);

    const other = await post(`/api/v1/incidents/${incident.id}/actions/quarantine-email`, { messageIds: [email.id + 100000] });
    expect(other.status).toBe(502);
    expect(other.body.detail).toMatch(/No hay correos pendientes/);

    const chosen = await post(`/api/v1/incidents/${incident.id}/actions/quarantine-email`, { messageIds: [email.id] });
    expect(chosen.status).toBe(200);
  });

  test("restaurar parcialmente deja el incidente en cuarentena", async () => {
    const r = await report();
    const { incident } = await ingestReport(r);
    // Segundo correo de la misma campana (lo que aportara la busqueda de similares).
    const second = await prisma.incidentEmail.create({ data: { incidentId: incident.id, messageId: "<variante@test>", origin: "candidate" } });
    mailProvider.quarantine.mockResolvedValue([ALICE]);
    await post(`/api/v1/incidents/${incident.id}/actions/quarantine-email`);

    mailProvider.restore.mockResolvedValue([ALICE]);
    const resp = await post(`/api/v1/incidents/${incident.id}/actions/restore-email`, { messageIds: [second.id] });
    expect(resp.body).toMatchObject({ status: "quarantined", remaining: 1 });
  });

  test("si el correo no esta en ningun buzon, falla y queda auditado", async () => {
    const incident = await campaign();
    mailProvider.quarantine.mockResolvedValue([]);

    const resp = await post(`/api/v1/incidents/${incident.id}/actions/quarantine-email`);
    expect(resp.status).toBe(502);
    expect(resp.body.detail).toMatch(/ningún buzón/);
    expect((await prisma.incident.findUnique({ where: { id: incident.id } })).status).toBe("new");
    const failed = await prisma.auditEvent.findFirst({ where: { incidentId: incident.id, type: "mitigation_failed" } });
    expect(failed.detail).toMatch(/la cuarentena del correo/);
  });

  test("sin la integracion configurada, la cuarentena y la restauracion fallan con un mensaje claro", async () => {
    const incident = await campaign();
    mailProvider.isEnabled.mockReturnValue(false);
    const q = await post(`/api/v1/incidents/${incident.id}/actions/quarantine-email`);
    expect(q.status).toBe(502);
    expect(q.body.detail).toMatch(/no está configurada/);
    const r = await post(`/api/v1/incidents/${incident.id}/actions/restore-email`);
    expect(r.status).toBe(502);
  });

  test("restaurar sin nada en cuarentena falla y queda auditado", async () => {
    const incident = await campaign();
    const resp = await post(`/api/v1/incidents/${incident.id}/actions/restore-email`);
    expect(resp.status).toBe(502);
    expect(resp.body.detail).toMatch(/No hay correos en cuarentena/);
  });

  test("cada accion solo en su caso de uso, y messageIds validado", async () => {
    const incident = await campaign();
    expect((await post(`/api/v1/incidents/${incident.id}/actions/isolate-host`)).status).toBe(422);
    expect((await post(`/api/v1/incidents/${incident.id}/actions/quarantine-email`, { messageIds: "todos" })).status).toBe(422);
    expect((await post(`/api/v1/incidents/${incident.id}/actions/restore-email`, { messageIds: [] })).status).toBe(422);

    const bruteforce = await request(app).post("/api/v1/webhook/wazuh").send(require("../mocks/wazuh_ssh_bruteforce.json"));
    expect((await post(`/api/v1/incidents/${bruteforce.body.id}/actions/quarantine-email`)).status).toBe(422);
    expect((await post(`/api/v1/incidents/${bruteforce.body.id}/actions/restore-email`)).status).toBe(422);
    expect((await post("/api/v1/incidents/999999/actions/restore-email")).status).toBe(404);
  });

  test("el auditor no puede poner en cuarentena ni restaurar", async () => {
    const incident = await campaign();
    const auditor = await tokenFor({ username: "auditor-cu03", role: "auditor" });
    for (const action of ["quarantine-email", "restore-email"]) {
      const resp = await request(app).post(`/api/v1/incidents/${incident.id}/actions/${action}`).set("Authorization", `Bearer ${auditor}`);
      expect(resp.status).toBe(403);
    }
  });
});

describe("integracion con el resto del sistema", () => {
  test("filtros por caso de uso y contencion", async () => {
    const { incident } = await ingestReport(await report());
    mailProvider.quarantine.mockResolvedValue([ALICE]);
    await post(`/api/v1/incidents/${incident.id}/actions/quarantine-email`);

    const list = async (q) =>
      (await request(app).get(`/api/v1/incidents?${q}`).set("Authorization", `Bearer ${token}`)).body.map((i) => i.id);
    expect(await list("useCase=CU-03")).toContain(incident.id);
    expect(await list("useCase=CU-02")).not.toContain(incident.id);
    expect(await list("contained=yes")).toContain(incident.id);

    // Restaurado = vuelve a estar sin contener (dashboard: "por atender").
    mailProvider.restore.mockResolvedValue([ALICE]);
    await post(`/api/v1/incidents/${incident.id}/actions/restore-email`);
    expect(await list("contained=no")).toContain(incident.id);
    expect(await list("contained=yes")).not.toContain(incident.id);
  });

  test("metricas de CU-03: el reporte es la alerta, la cuarentena la contencion", async () => {
    const { incident } = await ingestReport(await report({ receivedAt: new Date(Date.now() - 30000) }));
    mailProvider.quarantine.mockResolvedValue([ALICE]);
    await post(`/api/v1/incidents/${incident.id}/actions/quarantine-email`);

    const resp = await request(app).get("/api/v1/metrics").set("Authorization", `Bearer ${token}`);
    expect(resp.body["CU-03"].containment.n).toBeGreaterThan(0);
    expect(resp.body["CU-03"].containment.maxMs).toBeGreaterThanOrEqual(30000);
  });

  test("backfillUseCases completa los incidentes anteriores a la columna", async () => {
    const legacy = await prisma.incident.create({
      data: { source: "wazuh", ruleId: "5712", severity: 10, hostname: "h", agentId: "001", timestamp: new Date().toISOString(), srcIp: "198.51.100.1" },
    });
    const legacyMalware = await prisma.incident.create({
      data: { source: "wazuh", ruleId: "87105", severity: 12, hostname: "h", agentId: "001", timestamp: new Date().toISOString() },
    });
    expect(await backfillUseCases(prisma)).toBeGreaterThanOrEqual(2);
    expect((await prisma.incident.findUnique({ where: { id: legacy.id } })).useCase).toBe("CU-01");
    expect((await prisma.incident.findUnique({ where: { id: legacyMalware.id } })).useCase).toBe("CU-02");
    expect(await backfillUseCases(prisma)).toBe(0);
  });
});
