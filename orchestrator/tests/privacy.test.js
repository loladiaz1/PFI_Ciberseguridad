// Proteccion de datos personales (Ley 25.326): supresion de la cuenta con
// auditoria seudonimizada, y politica de retencion sobre IPs de terceros.
jest.mock("../src/wazuh");

const request = require("supertest");
const bruteforceAlert = require("../mocks/wazuh_ssh_bruteforce.json");
const { app } = require("../src/app");
const { prisma } = require("../src/db");
const { adminToken, tokenFor, STRONG_PASSWORD } = require("./helpers");
const { authenticate, blockIp } = require("../src/wazuh");
const { pseudonymize, maskIp, maskIpsInText, applyRetention } = require("../src/privacy");

// Analista propio de este archivo: el admin inicial no se puede eliminar
// (es el ultimo admin, ver tests/users.test.js).
const USER = "ana.privacy@test.dev";
let auth;
beforeEach(async () => {
  auth = { Authorization: `Bearer ${await tokenFor({ username: USER, role: "analyst" })}` };
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("seudonimizacion y enmascarado", () => {
  test("el seudonimo es estable, no contiene el username y no es reversible a simple vista", () => {
    const p = pseudonymize("analyst");
    expect(p).toMatch(/^usuario-eliminado-[0-9a-f]{8}$/);
    expect(p).toBe(pseudonymize("analyst"));
    expect(p).not.toContain("analyst");
    expect(pseudonymize("otro")).not.toBe(p);
  });

  test("las IPs se enmascaran a su red, y enmascarar dos veces no cambia nada", () => {
    expect(maskIp("203.0.113.55")).toBe("203.0.113.0/24");
    expect(maskIp("203.0.113.0/24")).toBe("203.0.113.0/24");
    expect(maskIp("2001:db8:85a3:8d3:1319:8a2e:370:7348")).toBe("2001:db8:85a3:8d3::/64");
    expect(maskIp("2001:db8:85a3:8d3::/64")).toBe("2001:db8:85a3:8d3::/64");
    expect(maskIp(null)).toBeNull();
  });

  test("las IPs dentro de un texto de auditoria se enmascaran sin tocar el resto", () => {
    expect(maskIpsInText("Blocked 203.0.113.55 (incident #12)")).toBe("Blocked 203.0.113.0/24 (incident #12)");
    expect(maskIpsInText("Blocked 203.0.113.0/24 (incident #12)")).toBe("Blocked 203.0.113.0/24 (incident #12)");
    expect(maskIpsInText("Logged in")).toBe("Logged in");
  });
});

describe("DELETE /api/v1/me (derecho de supresion)", () => {
  test("sin token -> 401", async () => {
    expect((await request(app).delete("/api/v1/me")).status).toBe(401);
  });

  test("borra el perfil y seudonimiza la auditoria, sin perder los eventos", async () => {
    authenticate.mockResolvedValue("fake-token");
    blockIp.mockResolvedValue({ error: 0, data: { total_failed_items: 0 } });

    // Rastro real del usuario: perfil, login, una accion critica y un
    // evento con el formato anterior al campo actor.
    await request(app).put("/api/v1/me").set(auth).send({ name: "Ana Analista", email: "ana@example.com" });
    await request(app).post("/api/v1/auth/login").send({ username: USER, password: STRONG_PASSWORD });
    const created = await request(app).post("/api/v1/webhook/wazuh").send(bruteforceAlert);
    await request(app).post(`/api/v1/incidents/${created.body.id}/actions/block-ip`).set(auth);
    const legacy = await prisma.auditEvent.create({ data: { type: "login", detail: `${USER} logged in` } });
    const eventsBefore = await prisma.auditEvent.count();

    const resp = await request(app).delete("/api/v1/me").set(auth);

    expect(resp.status).toBe(204);
    expect(await prisma.user.findUnique({ where: { username: USER } })).toBeNull();
    expect(await prisma.auditEvent.count({ where: { actor: USER } })).toBe(0);
    const pseudonym = pseudonymize(USER);
    expect(await prisma.auditEvent.count({ where: { actor: pseudonym, type: "ip_blocked" } })).toBeGreaterThanOrEqual(1);
    expect((await prisma.auditEvent.findUnique({ where: { id: legacy.id } })).detail).toBe(`${pseudonym} logged in`);
    // Ningun evento se borra: se conserva la trazabilidad (+1 por account_deleted).
    expect(await prisma.auditEvent.count()).toBe(eventsBefore + 1);
    expect(await prisma.auditEvent.count({ where: { type: "account_deleted", actor: pseudonym } })).toBeGreaterThanOrEqual(1);
  });

  test("despues de eliminar la cuenta, el acceso se pierde en el acto", async () => {
    await request(app).delete("/api/v1/me").set(auth);

    // El token sigue siendo criptograficamente valido, pero el usuario ya no existe.
    expect((await request(app).get("/api/v1/me").set(auth)).status).toBe(401);
    const login = await request(app).post("/api/v1/auth/login").send({ username: USER, password: STRONG_PASSWORD });
    expect(login.status).toBe(401);
  });

  test("el ultimo administrador no puede eliminar su propia cuenta", async () => {
    const resp = await request(app)
      .delete("/api/v1/me")
      .set("Authorization", `Bearer ${await adminToken()}`);

    expect(resp.status).toBe(409);
    expect(await prisma.user.findUnique({ where: { username: process.env.AUTH_USER } })).not.toBeNull();
  });
});

describe("politica de retencion", () => {
  const NOW = new Date("2026-10-14T12:00:00Z");

  async function seed() {
    const old = await prisma.incident.create({
      data: {
        source: "wazuh", ruleId: "5712", severity: 10, srcIp: "198.51.100.77", hostname: "victima",
        agentId: "001", timestamp: "2026-06-01T10:00:00.000+0000", status: "blocked",
        enrichmentVt: '{"malicious":3}', enrichmentAbuseIpdb: '{"abuseConfidenceScore":90}',
      },
    });
    const recent = await prisma.incident.create({
      data: {
        source: "wazuh", ruleId: "5712", severity: 10, srcIp: "198.51.100.88", hostname: "victima",
        agentId: "001", timestamp: "2026-10-10T10:00:00.000+0000", status: "new",
      },
    });
    const oldEvent = await prisma.auditEvent.create({
      data: { type: "ip_blocked", detail: "Blocked 198.51.100.77 (incident #1)", createdAt: new Date("2026-06-01T10:01:00Z") },
    });
    return { old, recent, oldEvent };
  }

  test("modo prueba: cuenta lo que cambiaria sin modificar nada", async () => {
    const { old } = await seed();

    const r = await applyRetention(prisma, { days: 90, now: NOW, dryRun: true });

    expect(r.incidentsMasked).toBeGreaterThanOrEqual(1);
    expect((await prisma.incident.findUnique({ where: { id: old.id } })).srcIp).toBe("198.51.100.77");
  });

  test("enmascara la IP y descarta el enriquecimiento pasado el plazo; lo reciente queda igual", async () => {
    const { old, recent, oldEvent } = await seed();

    await applyRetention(prisma, { days: 90, now: NOW });

    const o = await prisma.incident.findUnique({ where: { id: old.id } });
    expect(o.srcIp).toBe("198.51.100.0/24");
    expect(o.enrichmentVt).toBeNull();
    expect(o.enrichmentAbuseIpdb).toBeNull();
    expect((await prisma.incident.findUnique({ where: { id: recent.id } })).srcIp).toBe("198.51.100.88");
    expect((await prisma.auditEvent.findUnique({ where: { id: oldEvent.id } })).detail).toBe("Blocked 198.51.100.0/24 (incident #1)");

    // Idempotente: una segunda pasada no vuelve a tocar lo ya enmascarado.
    const again = await applyRetention(prisma, { days: 90, now: NOW });
    expect((await prisma.incident.findUnique({ where: { id: old.id } })).srcIp).toBe("198.51.100.0/24");
    expect(again.incidentsMasked).toBe(0);
  });

  test("CU-03: de quien reporto y de los buzones queda solo el dominio", async () => {
    const incident = await prisma.incident.create({
      data: { source: "user_report", useCase: "CU-03", ruleId: "user-report", severity: 6, hostname: "mail", agentId: "mail", timestamp: "2026-06-01T10:00:00.000Z" },
    });
    const email = await prisma.incidentEmail.create({
      data: {
        incidentId: incident.id, messageId: "<viejo@test>", fromAddress: "atacante@malo.test", firstSeenAt: new Date("2026-06-01T10:00:00Z"),
        reportedBy: '["alice@empresa.com"]', mailboxes: '["alice@empresa.com","bob@empresa.com"]',
      },
    });
    const alert = await prisma.incidentAlert.create({
      data: { incidentId: incident.id, ruleId: "user-report", severity: 6, timestamp: "2026-06-01T10:00:00.000Z", detail: "Reportado por alice@empresa.com" },
    });

    const dry = await applyRetention(prisma, { days: 90, now: NOW, dryRun: true });
    expect(dry.emailsMasked).toBeGreaterThanOrEqual(1);
    await applyRetention(prisma, { days: 90, now: NOW });

    const e = await prisma.incidentEmail.findUnique({ where: { id: email.id } });
    expect(JSON.parse(e.reportedBy)).toEqual(["***@empresa.com"]);
    expect(JSON.parse(e.mailboxes)).toEqual(["***@empresa.com", "***@empresa.com"]);
    // El remitente del ataque es un indicador, no un dato del empleado: queda.
    expect(e.fromAddress).toBe("atacante@malo.test");
    expect((await prisma.incidentAlert.findUnique({ where: { id: alert.id } })).detail).toBe("Reportado por ***@empresa.com");
    expect((await applyRetention(prisma, { days: 90, now: NOW })).emailsMasked).toBe(0);
  });

  test("sin parametros usa el plazo por defecto (90 dias)", async () => {
    const r = await applyRetention(prisma, { dryRun: true });
    expect(Date.now() - r.cutoff.getTime()).toBeGreaterThanOrEqual(90 * 24 * 60 * 60 * 1000 - 1000);
  });
});
