// Linea de tiempo del incidente (alertas agrupadas + eventos) y auditoria por
// categorias / por incidente.
jest.mock("../src/wazuh");

const request = require("supertest");
const bruteforceAlert = require("../mocks/wazuh_ssh_bruteforce.json");
const malwareAlert = require("../mocks/wazuh_malware_detected.json");
const { app } = require("../src/app");
const { prisma } = require("../src/db");
const { authenticate, isolateHost } = require("../src/wazuh");
const { alertDetailOf } = require("../src/normalize");
const { categoryOf, backfillIncidentIds } = require("../src/audit");
const { applyRetention } = require("../src/privacy");
const { adminToken } = require("./helpers");

let auth;
const webhook = (alert) => request(app).post("/api/v1/webhook/wazuh").send(alert);
const malwareOn = (agentId, file) => ({
  ...malwareAlert,
  agent: { id: agentId, name: `host-${agentId}` },
  syscheck: { path: file, event: "added" },
});

beforeAll(async () => {
  auth = { Authorization: `Bearer ${await adminToken()}` };
  authenticate.mockResolvedValue("fake-token");
  isolateHost.mockResolvedValue({ error: 0, data: { total_failed_items: 0 } });
});

afterAll(async () => {
  process.env.GROUP_WINDOW_MS = "0";
  await prisma.$disconnect();
});

describe("dato distintivo de cada alerta", () => {
  test("archivo (CU-02), usuario (CU-01) o nada", () => {
    expect(alertDetailOf({ syscheck: { path: "/home/ubuntu/dropzone/a.com" } })).toBe("File /home/ubuntu/dropzone/a.com");
    expect(alertDetailOf({ data: { virustotal: { source: { file: "/tmp/b.exe" } } } })).toBe("File /tmp/b.exe");
    expect(alertDetailOf({ data: { srcip: "1.2.3.4", dstuser: "root" } })).toBe("User root");
    expect(alertDetailOf(bruteforceAlert)).toBeNull();
  });
});

describe("GET /api/v1/incidents/:id/timeline", () => {
  test("muestra cada alerta agrupada con su archivo, y los eventos del caso en orden", async () => {
    process.env.GROUP_WINDOW_MS = String(10 * 60 * 1000);
    const first = await webhook(malwareOn("081", "/home/ubuntu/dropzone/eicar-1.com"));
    await webhook(malwareOn("081", "/home/ubuntu/dropzone/eicar-2.com"));
    process.env.GROUP_WINDOW_MS = "0";
    await request(app).post(`/api/v1/incidents/${first.body.id}/actions/isolate-host`).set(auth);

    const resp = await request(app).get(`/api/v1/incidents/${first.body.id}/timeline`).set(auth);

    expect(resp.status).toBe(200);
    const alerts = resp.body.filter((e) => e.kind === "alert");
    expect(alerts.map((a) => a.detail)).toEqual([
      "File /home/ubuntu/dropzone/eicar-1.com",
      "File /home/ubuntu/dropzone/eicar-2.com",
    ]);
    expect(alerts.map((a) => a.grouped)).toEqual([false, true]);

    const types = resp.body.filter((e) => e.kind === "event").map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["incident_detected", "alert_grouped", "host_isolated"]));
    const isolated = resp.body.find((e) => e.type === "host_isolated");
    expect(isolated.category).toBe("response");
    expect(isolated.actor).toBe(process.env.AUTH_USER);

    // Orden cronologico.
    const times = resp.body.map((e) => new Date(e.at).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  test("un incidente anterior al registro de alertas muestra su alerta original", async () => {
    const legacy = await prisma.incident.create({
      data: { source: "wazuh", ruleId: "5712", severity: 10, srcIp: "198.51.100.9", hostname: "h", agentId: "001", timestamp: "2026-09-01T10:00:00.000+0000" },
    });

    const resp = await request(app).get(`/api/v1/incidents/${legacy.id}/timeline`).set(auth);

    expect(resp.body).toHaveLength(1);
    expect(resp.body[0]).toMatchObject({ kind: "alert", ruleId: "5712", srcIp: "198.51.100.9", grouped: false });
  });

  test("404 si el incidente no existe, 401 sin token", async () => {
    expect((await request(app).get("/api/v1/incidents/999999/timeline").set(auth)).status).toBe(404);
    expect((await request(app).get("/api/v1/incidents/1/timeline")).status).toBe(401);
  });
});

describe("GET /api/v1/audit con filtros", () => {
  test("por categoria: solo los tipos de esa categoria, cada uno con su categoria", async () => {
    await request(app).post("/api/v1/auth/login").send({ username: process.env.AUTH_USER, password: process.env.AUTH_PASSWORD });

    const resp = await request(app).get("/api/v1/audit?category=access").set(auth);

    expect(resp.status).toBe(200);
    expect(resp.body.length).toBeGreaterThan(0);
    expect(resp.body.every((e) => e.category === "access")).toBe(true);
  });

  test("por incidente: solo los eventos de ese caso", async () => {
    const created = await webhook(bruteforceAlert);

    const resp = await request(app).get(`/api/v1/audit?incidentId=${created.body.id}`).set(auth);

    expect(resp.body.length).toBeGreaterThan(0);
    expect(resp.body.every((e) => e.incidentId === created.body.id)).toBe(true);
  });

  test("categoria invalida -> 422; el limite se acota a 200", async () => {
    expect((await request(app).get("/api/v1/audit?category=todo").set(auth)).status).toBe(422);
    const resp = await request(app).get("/api/v1/audit?limit=5").set(auth);
    expect(resp.body.length).toBeLessThanOrEqual(5);
    expect((await request(app).get("/api/v1/audit?limit=100000").set(auth)).status).toBe(200);
  });

  test("tipos sin categoria conocida quedan como 'other'", () => {
    expect(categoryOf("login")).toBe("access");
    expect(categoryOf("algo_nuevo")).toBe("other");
  });
});

describe("eventos anteriores al vinculo con el incidente", () => {
  test("se vinculan por el numero que mencionan en el texto, una sola vez", async () => {
    const old = await prisma.auditEvent.create({ data: { type: "ip_blocked", detail: "Blocked 203.0.113.1 (incident #4242)" } });
    const unrelated = await prisma.auditEvent.create({ data: { type: "login", detail: "Logged in" } });

    expect(await backfillIncidentIds()).toBeGreaterThanOrEqual(1);

    expect((await prisma.auditEvent.findUnique({ where: { id: old.id } })).incidentId).toBe(4242);
    expect((await prisma.auditEvent.findUnique({ where: { id: unrelated.id } })).incidentId).toBeNull();
    expect(await backfillIncidentIds()).toBe(0); // idempotente
  });
});

describe("retencion sobre las alertas del incidente", () => {
  test("enmascara la IP de cada alerta vencida", async () => {
    const incident = await prisma.incident.create({
      data: {
        source: "wazuh", ruleId: "5712", severity: 10, srcIp: "198.51.100.33", hostname: "h", agentId: "001",
        timestamp: "2026-05-01T10:00:00.000+0000",
        alerts: { create: { ruleId: "5712", severity: 10, timestamp: "2026-05-01T10:00:00.000+0000", srcIp: "198.51.100.33" } },
      },
      include: { alerts: true },
    });

    const r = await applyRetention(prisma, { days: 90, now: new Date("2026-10-15T00:00:00Z") });

    expect(r.alertsMasked).toBeGreaterThanOrEqual(1);
    expect((await prisma.incidentAlert.findUnique({ where: { id: incident.alerts[0].id } })).srcIp).toBe("198.51.100.0/24");
  });
});
