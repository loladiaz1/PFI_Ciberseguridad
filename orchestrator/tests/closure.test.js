// Cierre de casos (veredicto, etiquetas, nota), reapertura y filtros de la
// lista de incidentes.
jest.mock("../src/wazuh");

const request = require("supertest");
const bruteforceAlert = require("../mocks/wazuh_ssh_bruteforce.json");
const malwareAlert = require("../mocks/wazuh_malware_detected.json");
const { app } = require("../src/app");
const { prisma } = require("../src/db");
const { authenticate, blockIp } = require("../src/wazuh");
const { validateClosure, mergeTags } = require("../src/closure");
const { computeMetrics } = require("../src/metrics");
const { deleteAccount, pseudonymize } = require("../src/privacy");
const { adminToken, tokenFor } = require("./helpers");

const bearer = (t) => ({ Authorization: `Bearer ${t}` });
let admin;
const webhook = (alert) => request(app).post("/api/v1/webhook/wazuh").send(alert);
const close = (id, body, auth = admin) => request(app).post(`/api/v1/incidents/${id}/close`).set(auth).send(body);
const list = (query) => request(app).get(`/api/v1/incidents?${query}`).set(admin);

beforeAll(async () => {
  admin = bearer(await adminToken());
  authenticate.mockResolvedValue("fake-token");
  blockIp.mockResolvedValue({ error: 0, data: { total_failed_items: 0 } });
});

afterAll(async () => {
  process.env.GROUP_WINDOW_MS = "0";
  await prisma.$disconnect();
});

describe("validacion del cierre", () => {
  test("veredicto obligatorio y del catalogo; etiquetas del catalogo", () => {
    expect(validateClosure({ verdict: "malo" })).toMatch(/verdict/);
    expect(validateClosure({ verdict: "true_positive", tags: ["inventada"] })).toMatch(/catalogo/);
    expect(validateClosure({ verdict: "true_positive", tags: "phishing" })).toMatch(/catalogo/);
    expect(validateClosure({ verdict: "true_positive" })).toBeNull(); // sin nota: valido
  });

  test("benigno y falso positivo exigen una nota de 10+ caracteres", () => {
    for (const verdict of ["benign_positive", "false_positive"]) {
      expect(validateClosure({ verdict })).toMatch(/nota/);
      expect(validateClosure({ verdict, note: "   corta  " })).toMatch(/nota/);
      expect(validateClosure({ verdict, note: "Escaneo autorizado, ticket INF-2231" })).toBeNull();
    }
  });

  test("las etiquetas se unen sin repetir y en el orden del catalogo", () => {
    expect(JSON.parse(mergeTags(["ip_blocked", "brute_force"], ["brute_force", "escalated"]))).toEqual(["brute_force", "ip_blocked", "escalated"]);
  });
});

describe("cerrar y reabrir", () => {
  test("el incidente nace con la etiqueta de su caso de uso y suma la de la accion al contener", async () => {
    const created = await webhook(bruteforceAlert);
    expect(JSON.parse(created.body.tags)).toEqual(["brute_force"]);

    await request(app).post(`/api/v1/incidents/${created.body.id}/actions/block-ip`).set(admin);

    const incident = await prisma.incident.findUnique({ where: { id: created.body.id } });
    expect(JSON.parse(incident.tags)).toEqual(["brute_force", "ip_blocked"]);
    expect(JSON.parse((await webhook(malwareAlert)).body.tags)).toEqual(["malware"]);
  });

  test("cierre como verdadero positivo: guarda veredicto, quien, cuando y etiquetas; queda auditado", async () => {
    const created = await webhook(bruteforceAlert);

    const resp = await close(created.body.id, { verdict: "true_positive", tags: ["recurring_attacker"] });

    expect(resp.status).toBe(200);
    expect(resp.body.verdict).toBe("true_positive");
    expect(resp.body.closedBy).toBe(process.env.AUTH_USER);
    expect(resp.body.closedAt).not.toBeNull();
    expect(JSON.parse(resp.body.tags)).toEqual(["brute_force", "recurring_attacker"]);
    const event = await prisma.auditEvent.findFirst({ where: { type: "incident_closed" }, orderBy: { id: "desc" } });
    expect(event.incidentId).toBe(created.body.id);
    expect(event.detail).toBe(`Cierre del incidente #${created.body.id} como verdadero positivo`);
  });

  test("falso positivo sin nota -> 422; con nota -> cerrado con la nota", async () => {
    const created = await webhook(bruteforceAlert);

    expect((await close(created.body.id, { verdict: "false_positive" })).status).toBe(422);
    const ok = await close(created.body.id, { verdict: "false_positive", note: "  Regla demasiado sensible para este host  " });

    expect(ok.status).toBe(200);
    expect(ok.body.closingNote).toBe("Regla demasiado sensible para este host");
  });

  test("no se cierra dos veces, ni algo que no existe; el auditor no puede cerrar", async () => {
    const created = await webhook(bruteforceAlert);
    await close(created.body.id, { verdict: "true_positive" });

    expect((await close(created.body.id, { verdict: "true_positive" })).status).toBe(409);
    expect((await close(999999, { verdict: "true_positive" })).status).toBe(404);
    const auditor = bearer(await tokenFor({ username: "auditor-close@test.dev", role: "auditor" }));
    expect((await close(created.body.id, { verdict: "true_positive" }, auditor)).status).toBe(403);
  });

  test("reabrir exige nota, limpia el cierre y deja el veredicto anterior en la auditoria", async () => {
    const created = await webhook(bruteforceAlert);
    const reopen = (body) => request(app).post(`/api/v1/incidents/${created.body.id}/reopen`).set(admin).send(body);

    expect((await reopen({ note: "x" })).status).toBe(409); // todavia abierto
    await close(created.body.id, { verdict: "benign_positive", note: "Escaneo autorizado de infraestructura" });
    expect((await reopen({ note: "corta" })).status).toBe(422);

    const resp = await reopen({ note: "Aparecio un login exitoso desde la misma IP" });

    expect(resp.status).toBe(200);
    expect(resp.body.closedAt).toBeNull();
    expect(resp.body.verdict).toBeNull();
    const event = await prisma.auditEvent.findFirst({ where: { type: "incident_reopened" }, orderBy: { id: "desc" } });
    expect(event.detail).toMatch(/era benigno positivo/);
    expect((await request(app).post("/api/v1/incidents/999999/reopen").set(admin).send({ note: "nota suficiente" })).status).toBe(404);
  });

  test("un caso cerrado no absorbe alertas nuevas: la siguiente abre otro incidente", async () => {
    process.env.GROUP_WINDOW_MS = String(10 * 60 * 1000);
    const alert = { ...bruteforceAlert, data: { srcip: "192.0.2.200" }, agent: { id: "071", name: "h071" } };
    const first = await webhook(alert);
    await close(first.body.id, { verdict: "false_positive", note: "Prueba de agrupamiento con caso cerrado" });

    const next = await webhook(alert);
    process.env.GROUP_WINDOW_MS = "0";

    expect(next.status).toBe(201);
    expect(next.body.id).not.toBe(first.body.id);
  });

  test("catalogo de cierre disponible para la app", async () => {
    const resp = await request(app).get("/api/v1/closure-catalog").set(admin);
    expect(resp.body.verdicts).toEqual(["true_positive", "benign_positive", "false_positive"]);
    expect(resp.body.noteRequired).toEqual(["benign_positive", "false_positive"]);
    expect(Object.keys(resp.body.tags).length).toBeGreaterThanOrEqual(10);
  });

  test("al eliminar una cuenta, quien cerro el caso tambien se seudonimiza", async () => {
    const analyst = bearer(await tokenFor({ username: "cierra@test.dev", role: "analyst" }));
    const created = await webhook(bruteforceAlert);
    await close(created.body.id, { verdict: "true_positive" }, analyst);

    await deleteAccount(prisma, "cierra@test.dev");

    expect((await prisma.incident.findUnique({ where: { id: created.body.id } })).closedBy).toBe(pseudonymize("cierra@test.dev"));
  });
});

describe("filtros de la lista", () => {
  let open, closedFp, blocked;
  beforeAll(async () => {
    open = (await webhook({ ...bruteforceAlert, agent: { id: "061", name: "filtro-host-a" }, data: { srcip: "203.0.113.61" } })).body;
    closedFp = (await webhook({ ...malwareAlert, agent: { id: "062", name: "filtro-host-b" } })).body;
    await close(closedFp.id, { verdict: "false_positive", note: "Archivo de prueba del equipo de QA", tags: ["test_exercise"] });
    blocked = (await webhook({ ...bruteforceAlert, agent: { id: "063", name: "filtro-host-c" }, data: { srcip: "203.0.113.63" } })).body;
    await request(app).post(`/api/v1/incidents/${blocked.id}/actions/block-ip`).set(admin);
  });
  const ids = (resp) => resp.body.map((i) => i.id);

  test("abiertos / cerrados", async () => {
    expect(ids(await list("status=open"))).toEqual(expect.arrayContaining([open.id, blocked.id]));
    expect(ids(await list("status=open"))).not.toContain(closedFp.id);
    expect(ids(await list("status=closed"))).toContain(closedFp.id);
  });

  test("contenidos / sin contener / por la automatizacion", async () => {
    expect(ids(await list("contained=yes"))).toContain(blocked.id);
    expect(ids(await list("contained=yes"))).not.toContain(open.id);
    expect(ids(await list("contained=no"))).toContain(open.id);
    expect(ids(await list("contained=auto"))).not.toContain(blocked.id); // lo bloqueo el admin, no la automatizacion
  });

  test("veredicto, etiqueta, caso de uso y severidad", async () => {
    expect(ids(await list("verdict=false_positive"))).toContain(closedFp.id);
    expect(ids(await list("tag=test_exercise"))).toEqual([closedFp.id]);
    expect(ids(await list("tag=ip_blocked"))).toContain(blocked.id);
    expect(ids(await list("useCase=CU-02"))).toContain(closedFp.id);
    expect(ids(await list("useCase=CU-02"))).not.toContain(open.id);
    expect(ids(await list("useCase=CU-01"))).toContain(open.id);
    expect((await list("minSeverity=12")).body.every((i) => i.severity >= 12)).toBe(true);
  });

  test("busqueda por numero de incidente, host o IP", async () => {
    expect(ids(await list(`q=%23${open.id}`))).toEqual([open.id]);
    expect(ids(await list(`q=${open.id}`))).toEqual([open.id]);
    expect(ids(await list("q=filtro-host-b"))).toEqual([closedFp.id]);
    expect(ids(await list("q=203.0.113.63"))).toEqual([blocked.id]);
  });

  test("orden por severidad y combinacion de filtros", async () => {
    const bySeverity = (await list("sort=severity")).body.map((i) => i.severity);
    expect([...bySeverity].sort((a, b) => b - a)).toEqual(bySeverity);
    expect(ids(await list("status=open&useCase=CU-01&q=filtro-host-a"))).toEqual([open.id]);
  });

  test("valores invalidos -> 422", async () => {
    for (const q of ["status=todos", "contained=quizas", "verdict=malo", "useCase=CU-09", "sort=azar", "tag=inventada"]) {
      expect((await list(q)).status).toBe(422);
    }
  });
});

describe("metricas", () => {
  test("tiempo hasta el cierre (MTTR)", () => {
    const m = computeMetrics([
      { srcIp: "1.2.3.4", timestamp: "2026-10-15T10:00:00.000Z", ingestedAt: "2026-10-15T10:00:01.000Z", closedAt: "2026-10-15T10:30:00.000Z", blockedAt: null, isolatedAt: null, actionLatencyMs: null, automationDecision: "none" },
    ]);
    expect(m["CU-01"].timeToClose).toEqual({ n: 1, p50Ms: 1800000, p95Ms: 1800000, maxMs: 1800000 });
  });
});
