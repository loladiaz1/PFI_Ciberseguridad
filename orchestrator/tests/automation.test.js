// Automatizacion de la respuesta segun contexto (src/automation.js).
jest.mock("../src/wazuh");
jest.mock("../src/enrichment");

const request = require("supertest");
const bruteforceAlert = require("../mocks/wazuh_ssh_bruteforce.json");
const malwareAlert = require("../mocks/wazuh_malware_detected.json");
const { app } = require("../src/app");
const { prisma } = require("../src/db");
const { authenticate, blockIp, isolateHost } = require("../src/wazuh");
const { enrichIp } = require("../src/enrichment");
const { normalizeWazuhAlert } = require("../src/normalize");
const { computeMetrics } = require("../src/metrics");
const {
  ensureAutomationDefaults,
  ipMatches,
  isValidAllowlistEntry,
  policyStats,
  evaluate,
  runAutomation,
} = require("../src/automation");
const { adminToken, tokenFor } = require("./helpers");

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const webhook = (alert) => request(app).post("/api/v1/webhook/wazuh").send(alert);
const OK = { error: 0, data: { total_failed_items: 0 } };
let admin;

// Configuracion conocida para cada test: modo, politicas habilitadas y
// criticidad del agente 001 (la victima de laboratorio).
// defaultCriticality "medium" y un cortacircuitos alto por defecto: los
// tests que no los prueban no deben depender de ellos (los e2e ejecutan
// varias acciones automaticas en pocos segundos).
async function configure({
  mode = "active",
  enable = [],
  allowlist = [],
  criticality = "low",
  defaultCriticality = "medium",
  maxActions = 1000,
  windowMinutes = 10,
} = {}) {
  await ensureAutomationDefaults();
  await prisma.automationSettings.update({
    where: { id: 1 },
    data: { mode, allowlist: JSON.stringify(allowlist), defaultCriticality, maxActions, windowMinutes },
  });
  await prisma.automationPolicy.updateMany({ data: { enabled: false } });
  if (enable.length) await prisma.automationPolicy.updateMany({ where: { key: { in: enable } }, data: { enabled: true } });
  await prisma.asset.upsert({
    where: { agentId: "001" },
    update: { criticality },
    create: { agentId: "001", name: "victima-laboratorio", criticality },
  });
}

const abuse = (score, country = "RU") => JSON.stringify({ abuseConfidenceScore: score, totalReports: 10, countryCode: country });

beforeAll(async () => {
  admin = bearer(await adminToken());
});

beforeEach(() => {
  authenticate.mockReset().mockResolvedValue("fake-token");
  blockIp.mockReset().mockResolvedValue(OK);
  isolateHost.mockReset().mockResolvedValue(OK);
  enrichIp.mockReset().mockResolvedValue({ vt: null, abuseipdb: null });
});

afterAll(async () => {
  // Dejar la configuracion como la cargan los valores iniciales.
  await configure({ mode: "simulate", enable: ["fuerza-bruta-mala-reputacion", "malware-confirmado"] });
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------

describe("motor de decision (evaluate)", () => {
  const settings = { mode: "active", allowlist: [], defaultCriticality: "medium" };
  const policy = (over) => ({
    name: "p", enabled: true, useCase: "CU-01", action: "block-ip", order: 1,
    conditions: { minSeverity: 10, minAbuseScore: 80, maxAssetCriticality: "medium" }, ...over,
  });
  const incident = (over) => ({ srcIp: "198.51.100.5", severity: 10, enrichmentAbuseIpdb: abuse(90), enrichmentVt: null, hashPositives: null, ...over });

  test("todas las condiciones se cumplen -> ejecutar en modo activo, simular en modo simulacion", () => {
    expect(evaluate({ incident: incident(), settings, policies: [policy()], asset: { criticality: "low" } }).decision).toBe("execute");
    expect(evaluate({ incident: incident(), settings: { ...settings, mode: "simulate" }, policies: [policy()], asset: null }).decision).toBe("simulate");
  });

  test("modo off: no evalua nada", () => {
    const r = evaluate({ incident: incident(), settings: { ...settings, mode: "off" }, policies: [policy()], asset: null });
    expect(r).toEqual({ decision: "none", policy: null, reason: "Automatización apagada" });
  });

  test("un activo critico nunca se automatiza, aunque una politica lo permita", () => {
    const permissive = policy({ conditions: { maxAssetCriticality: "critical" } });
    const r = evaluate({ incident: incident(), settings, policies: [permissive], asset: { criticality: "critical" } });
    expect(r.decision).toBe("none");
    expect(r.reason).toMatch(/Activo crítico/);
  });

  test("una IP de la lista de exclusion nunca se bloquea (exacta o por CIDR)", () => {
    for (const entry of ["198.51.100.5", "198.51.100.0/24"]) {
      const r = evaluate({ incident: incident(), settings: { ...settings, allowlist: [entry] }, policies: [policy()], asset: null });
      expect(r.decision).toBe("none");
      expect(r.reason).toMatch(/lista de exclusión/);
    }
  });

  test("dato faltante = condicion no cumplida (sin reputacion no se bloquea)", () => {
    const r = evaluate({ incident: incident({ enrichmentAbuseIpdb: null }), settings, policies: [policy()], asset: null });
    expect(r.decision).toBe("none");
    expect(r.reason).toMatch(/abuseScore n\/d < 80/);
  });

  test("respeta el orden: gana la primera politica que aplica", () => {
    const strict = policy({ name: "estricta", order: 1, conditions: { minAbuseScore: 99 } });
    const loose = policy({ name: "amplia", order: 2, conditions: { minAbuseScore: 50 } });
    expect(evaluate({ incident: incident(), settings, policies: [strict, loose], asset: null }).policy.name).toBe("amplia");
  });

  test("solo considera politicas habilitadas y del caso de uso del incidente", () => {
    const disabled = policy({ enabled: false });
    const otherUseCase = policy({ useCase: "CU-02" });
    const r = evaluate({ incident: incident(), settings, policies: [disabled, otherUseCase], asset: null });
    expect(r.reason).toBe("No hay políticas activas para este caso de uso");
  });

  test("condiciones de pais, VirusTotal, hash y criticidad", () => {
    const geo = policy({ conditions: { fromCountries: ["CN"] } });
    expect(evaluate({ incident: incident(), settings, policies: [geo], asset: null }).reason).toMatch(/país RU fuera de CN/);

    const vt = policy({ conditions: { minVtMalicious: 5 } });
    expect(evaluate({ incident: incident({ enrichmentVt: JSON.stringify({ malicious: 7 }) }), settings, policies: [vt], asset: null }).decision).toBe("execute");

    const crit = policy({ conditions: { maxAssetCriticality: "low" } });
    expect(evaluate({ incident: incident(), settings, policies: [crit], asset: null }).reason).toMatch(/activo medium > low/);

    const malware = policy({ useCase: "CU-02", action: "isolate-host", conditions: { minHashPositives: 10 } });
    expect(evaluate({ incident: incident({ srcIp: null, hashPositives: 3 }), settings, policies: [malware], asset: null }).reason).toMatch(/hashPositives 3 < 10/);
  });

  test("ipMatches ignora entradas invalidas", () => {
    expect(ipMatches("10.0.0.1", "10.0.0.0/8")).toBe(true);
    expect(ipMatches("11.0.0.1", "10.0.0.0/8")).toBe(false);
    expect(ipMatches("10.0.0.1", "10.0.0.0/40")).toBe(false);
    expect(ipMatches("no-es-ip", "10.0.0.0/8")).toBe(false);
    expect(ipMatches(null, "10.0.0.1")).toBe(false);
  });
});

describe("hash del malware desde la alerta (CU-02)", () => {
  test("lee data.virustotal.positives (formato real de Wazuh), el mock antiguo, o la descripcion", () => {
    expect(normalizeWazuhAlert({ ...malwareAlert, data: { virustotal: { positives: "65" } } }).hashPositives).toBe(65);
    expect(normalizeWazuhAlert(malwareAlert).hashPositives).toBe(60);
    const onlyText = { ...malwareAlert, VirusTotal: undefined, rule: { ...malwareAlert.rule, description: "VirusTotal: Alert - x - 11 engines detected this file" } };
    expect(normalizeWazuhAlert(onlyText).hashPositives).toBe(11);
    expect(normalizeWazuhAlert(bruteforceAlert).hashPositives).toBeNull();
  });
});

describe("de punta a punta (webhook -> decision -> Wazuh)", () => {
  test("CU-02 en modo activo: malware confirmado en un activo de criticidad baja se aisla solo", async () => {
    await configure({ mode: "active", enable: ["malware-confirmado"] });

    const created = await webhook(malwareAlert);

    const incident = await prisma.incident.findUnique({ where: { id: created.body.id } });
    expect(isolateHost).toHaveBeenCalledWith(expect.anything(), "fake-token", "001");
    expect(incident.status).toBe("isolated");
    expect(incident.automationDecision).toBe("executed");
    expect(incident.automationPolicy).toBe("Malware confirmado por VirusTotal");
    expect(incident.actionLatencyMs).toBeGreaterThanOrEqual(0);
    const event = await prisma.auditEvent.findFirst({ where: { type: "host_isolated" }, orderBy: { id: "desc" } });
    expect(event.actor).toBe("automation");
    expect(event.detail).toMatch(/automático \(política "Malware confirmado por VirusTotal"\)/);
  });

  test("CU-02 en modo simulacion: registra lo que haria y no ejecuta", async () => {
    await configure({ mode: "simulate", enable: ["malware-confirmado"] });

    const created = await webhook(malwareAlert);

    const incident = await prisma.incident.findUnique({ where: { id: created.body.id } });
    expect(isolateHost).not.toHaveBeenCalled();
    expect(incident.status).toBe("new");
    expect(incident.automationDecision).toBe("simulated");
    const event = await prisma.auditEvent.findFirst({ where: { type: "automation_simulated" }, orderBy: { id: "desc" } });
    expect(event.detail).toMatch(`#${incident.id}`);
  });

  test("CU-01: decide despues del enriquecimiento (IP con mala reputacion -> bloqueo)", async () => {
    await configure({ mode: "active", enable: ["fuerza-bruta-mala-reputacion"] });
    enrichIp.mockResolvedValue({ vt: null, abuseipdb: abuse(95) });

    const created = await webhook(bruteforceAlert);

    const incident = await prisma.incident.findUnique({ where: { id: created.body.id } });
    // El mock usa el agente 000, fuera del inventario: criticidad por defecto (medium).
    expect(blockIp).toHaveBeenCalledWith(expect.anything(), "fake-token", bruteforceAlert.agent.id, bruteforceAlert.data.srcip);
    expect(incident.status).toBe("blocked");
    expect(incident.automationDecision).toBe("executed");
  });

  test("CU-01 con reputacion baja: queda para el analista, con el motivo", async () => {
    await configure({ mode: "active", enable: ["fuerza-bruta-mala-reputacion"] });
    enrichIp.mockResolvedValue({ vt: null, abuseipdb: abuse(5) });

    const created = await webhook(bruteforceAlert);

    const incident = await prisma.incident.findUnique({ where: { id: created.body.id } });
    expect(blockIp).not.toHaveBeenCalled();
    expect(incident.status).toBe("new");
    expect(incident.automationDecision).toBe("none");
    expect(incident.automationReason).toMatch(/abuseScore 5 < 80/);
  });

  test("activo critico: nunca automatico", async () => {
    await configure({ mode: "active", enable: ["malware-confirmado"], criticality: "critical" });

    const created = await webhook(malwareAlert);

    expect(isolateHost).not.toHaveBeenCalled();
    expect((await prisma.incident.findUnique({ where: { id: created.body.id } })).automationReason).toMatch(/Activo crítico/);
  });

  test("si Wazuh rechaza, el incidente queda abierto para el analista y se audita la falla", async () => {
    await configure({ mode: "active", enable: ["malware-confirmado"] });
    isolateHost.mockRejectedValue(new Error("agente desconectado"));

    const created = await webhook(malwareAlert);

    const incident = await prisma.incident.findUnique({ where: { id: created.body.id } });
    expect(incident.status).toBe("new");
    expect(incident.automationDecision).toBe("failed");
    expect(incident.automationReason).toMatch(/Wazuh rechazó la acción: agente desconectado/);
    expect(await prisma.auditEvent.count({ where: { type: "automation_failed" } })).toBeGreaterThanOrEqual(1);
  });

  test("una alerta agrupada vuelve a evaluar: simulacion -> se activa el modo -> la alerta siguiente se contiene", async () => {
    // Caso real (prueba local del 14/10): el segundo malware del mismo host se
    // agrupaba y el incidente quedaba con la decision vieja de simulacion.
    // Agente propio (091): los otros tests de este archivo dejan incidentes
    // abiertos del agente 001 que absorberian estas alertas.
    process.env.GROUP_WINDOW_MS = String(10 * 60 * 1000);
    const host = { ...malwareAlert.agent, id: "091", name: "victima-reeval" };
    await configure({ mode: "simulate", enable: ["malware-confirmado"] });
    await prisma.asset.upsert({ where: { agentId: "091" }, update: { criticality: "low" }, create: { agentId: "091", name: "victima-reeval", criticality: "low" } });

    const first = await webhook({ ...malwareAlert, agent: host });
    expect((await prisma.incident.findUnique({ where: { id: first.body.id } })).automationDecision).toBe("simulated");

    // Mismo resultado de simulacion con otra alerta: no se repite la auditoria.
    const simulatedBefore = await prisma.auditEvent.count({ where: { type: "automation_simulated" } });
    await webhook({ ...malwareAlert, agent: host });
    expect(await prisma.auditEvent.count({ where: { type: "automation_simulated" } })).toBe(simulatedBefore);

    await configure({ mode: "active", enable: ["malware-confirmado"] });
    const third = await webhook({ ...malwareAlert, agent: host });
    process.env.GROUP_WINDOW_MS = "0";

    expect(third.body.grouped).toBe(true);
    const incident = await prisma.incident.findUnique({ where: { id: first.body.id } });
    expect(incident.status).toBe("isolated");
    expect(incident.automationDecision).toBe("executed");
    expect(incident.alertCount).toBe(3);
  });

  test("no decide sobre un incidente que ya no esta abierto, ni sobre uno inexistente", async () => {
    await configure({ mode: "active", enable: ["malware-confirmado"] });
    const done = await prisma.incident.create({
      data: { source: "wazuh", ruleId: "87105", severity: 12, hostname: "h", agentId: "001", timestamp: new Date().toISOString(), status: "isolated", hashPositives: 50 },
    });

    expect(await runAutomation(done.id)).toBeNull();
    expect(await runAutomation(999999)).toBeNull();
    expect(isolateHost).not.toHaveBeenCalled();
  });
});

describe("configuracion (endpoints)", () => {
  test("cualquier rol la ve; solo un admin la cambia", async () => {
    const auditor = bearer(await tokenFor({ username: "auditor-auto@test.dev", role: "auditor" }));
    const analyst = bearer(await tokenFor({ username: "analista-auto@test.dev", role: "analyst" }));

    const view = await request(app).get("/api/v1/automation").set(auditor);
    expect(view.status).toBe(200);
    expect(view.body.policies.length).toBeGreaterThanOrEqual(4);
    expect(view.body.assets.some((a) => a.agentId === "001")).toBe(true);

    expect((await request(app).put("/api/v1/automation/settings").set(analyst).send({ mode: "active" })).status).toBe(403);
    expect((await request(app).put("/api/v1/assets/001").set(auditor).send({ criticality: "low" })).status).toBe(403);
  });

  test("el admin cambia el modo y la lista de exclusion, y queda auditado", async () => {
    const resp = await request(app)
      .put("/api/v1/automation/settings")
      .set(admin)
      .send({ mode: "off", allowlist: [" 10.0.0.0/8 ", ""] });

    expect(resp.status).toBe(200);
    expect(resp.body.settings.mode).toBe("off");
    expect(resp.body.settings.allowlist).toEqual(["10.0.0.0/8"]);
    expect(resp.body.settings.updatedBy).toBe(process.env.AUTH_USER);
    const event = await prisma.auditEvent.findFirst({ where: { type: "automation_updated" }, orderBy: { id: "desc" } });
    expect(event.detail).toMatch(/^Ajustes: mode \w+ -> off, allowlist .* -> \["10\.0\.0\.0\/8"\]$/);
    expect(event.actor).toBe(process.env.AUTH_USER);
  });

  test("valida el modo y la lista de exclusion", async () => {
    expect((await request(app).put("/api/v1/automation/settings").set(admin).send({ mode: "turbo" })).status).toBe(422);
    expect((await request(app).put("/api/v1/automation/settings").set(admin).send({ allowlist: "10.0.0.1" })).status).toBe(422);
  });

  test("el admin habilita una politica y ajusta sus umbrales", async () => {
    const { body } = await request(app).get("/api/v1/automation").set(admin);
    const policy = body.policies.find((p) => p.key === "fuerza-bruta-laboratorio");

    const resp = await request(app)
      .put(`/api/v1/automation/policies/${policy.id}`)
      .set(admin)
      .send({ enabled: true, conditions: { minSeverity: 12, maxAssetCriticality: "low" } });

    expect(resp.status).toBe(200);
    const updated = resp.body.policies.find((p) => p.key === "fuerza-bruta-laboratorio");
    expect(updated.enabled).toBe(true);
    expect(updated.conditions).toEqual({ minSeverity: 12, maxAssetCriticality: "low" });
  });

  test("valida las politicas", async () => {
    const { body } = await request(app).get("/api/v1/automation").set(admin);
    const id = body.policies[0].id;
    const put = (data) => request(app).put(`/api/v1/automation/policies/${id}`).set(admin).send(data);

    expect((await request(app).put("/api/v1/automation/policies/999999").set(admin).send({ enabled: true })).status).toBe(404);
    expect((await put({ enabled: "si" })).status).toBe(422);
    expect((await put({ conditions: { borrarTodo: true } })).status).toBe(422);
    expect((await put({ conditions: { minAbuseScore: -1 } })).status).toBe(422);
    expect((await put({ conditions: { maxAssetCriticality: "extrema" } })).status).toBe(422);
    expect((await put({ conditions: { fromCountries: "CN" } })).status).toBe(422);
  });

  test("inventario de activos: cambia la criticidad o da de alta un agente nuevo", async () => {
    await prisma.asset.deleteMany({ where: { agentId: "042" } }); // la base local persiste entre corridas
    expect((await request(app).put("/api/v1/assets/001").set(admin).send({ criticality: "extrema" })).status).toBe(422);

    const created = await request(app).put("/api/v1/assets/042").set(admin).send({ criticality: "high" });
    expect(created.status).toBe(200);
    expect(created.body).toEqual({ agentId: "042", name: "agent-042", criticality: "high" });

    const renamed = await request(app).put("/api/v1/assets/042").set(admin).send({ name: "db-prod", criticality: "critical" });
    expect(renamed.body).toEqual({ agentId: "042", name: "db-prod", criticality: "critical" });
  });

  test("los valores iniciales no pisan lo que configuro un admin", async () => {
    await prisma.automationSettings.update({ where: { id: 1 }, data: { mode: "off" } });

    await ensureAutomationDefaults();

    expect((await prisma.automationSettings.findUnique({ where: { id: 1 } })).mode).toBe("off");
  });
});

describe("mejoras del 16/10", () => {
  test("lista de exclusion con IPv6 (exacta y rango): antes nunca coincidia y la IP se bloqueaba", () => {
    expect(ipMatches("2001:db8::5", "2001:db8::5")).toBe(true);
    expect(ipMatches("2001:db8:85a3::1", "2001:db8::/32")).toBe(true);
    expect(ipMatches("2001:db9::1", "2001:db8::/32")).toBe(false);
    expect(ipMatches("10.0.0.1", "2001:db8::/32")).toBe(false); // familias distintas
    expect(isValidAllowlistEntry("2001:db8::/32")).toBe(true);
    expect(isValidAllowlistEntry("2001:db8::/200")).toBe(false);
    expect(isValidAllowlistEntry("10.0.0.0/x")).toBe(false);
    expect(isValidAllowlistEntry("no-es-ip")).toBe(false);

    const policy = { name: "p", enabled: true, useCase: "CU-01", action: "block-ip", order: 1, conditions: {} };
    const r = evaluate({
      incident: { srcIp: "2001:db8::66", severity: 10, enrichmentAbuseIpdb: null, enrichmentVt: null, hashPositives: null },
      settings: { mode: "active", allowlist: ["2001:db8::/32"], defaultCriticality: "low" },
      policies: [policy],
      asset: null,
    });
    expect(r.decision).toBe("none");
    expect(r.reason).toMatch(/lista de exclusión/);
  });

  test("la allowlist rechaza entradas invalidas", async () => {
    const resp = await request(app).put("/api/v1/automation/settings").set(admin).send({ allowlist: ["10.0.0.0/8", "mi-servidor"] });
    expect(resp.status).toBe(422);
    expect(resp.body.detail).toMatch(/mi-servidor/);
  });

  test("activo fuera del inventario: criticidad alta por defecto, no se automatiza", async () => {
    await configure({ mode: "active", enable: ["fuerza-bruta-mala-reputacion"], defaultCriticality: "high" });
    enrichIp.mockResolvedValue({ vt: null, abuseipdb: abuse(99) });

    const created = await webhook(bruteforceAlert); // agente 000, fuera del inventario

    const incident = await prisma.incident.findUnique({ where: { id: created.body.id } });
    expect(blockIp).not.toHaveBeenCalled();
    expect(incident.automationReason).toMatch(/activo high > medium/);
  });

  test("cortacircuitos: al llegar al limite pasa sola a simulacion, avisa, y el caso queda para el analista", async () => {
    // Agente propio: cada malware abre su incidente (agrupamiento apagado).
    await configure({ mode: "active", enable: ["malware-confirmado"], maxActions: 2, windowMinutes: 10 });
    await prisma.auditEvent.deleteMany({ where: { actor: "automation", type: { in: ["ip_blocked", "host_isolated"] } } });
    const hosts = ["c1", "c2", "c3"].map((n, i) => ({ ...malwareAlert, agent: { id: `00${i + 1}`, name: `breaker-${n}` } }));
    for (const id of ["002", "003"]) {
      await prisma.asset.upsert({ where: { agentId: id }, update: { criticality: "low" }, create: { agentId: id, name: id, criticality: "low" } });
    }

    const first = await webhook(hosts[0]);
    const second = await webhook(hosts[1]);
    const third = await webhook(hosts[2]);

    expect(isolateHost).toHaveBeenCalledTimes(2);
    expect((await prisma.incident.findUnique({ where: { id: first.body.id } })).automationDecision).toBe("executed");
    expect((await prisma.incident.findUnique({ where: { id: second.body.id } })).automationDecision).toBe("executed");
    const paused = await prisma.incident.findUnique({ where: { id: third.body.id } });
    expect(paused.status).toBe("new");
    expect(paused.automationDecision).toBe("simulated");
    expect(paused.automationReason).toMatch(/cortacircuitos activado: 2 acciones automáticas en 10 min \(límite 2\)/);

    const settings = await prisma.automationSettings.findUnique({ where: { id: 1 } });
    expect(settings.mode).toBe("simulate");
    expect(settings.updatedBy).toBe("automation");
    const event = await prisma.auditEvent.findFirst({ where: { type: "automation_paused" }, orderBy: { id: "desc" } });
    expect(event.incidentId).toBe(third.body.id);
  });

  test("el admin ajusta el cortacircuitos y la criticidad por defecto; se valida y se audita antes -> despues", async () => {
    await configure({ mode: "simulate", maxActions: 5, windowMinutes: 10, defaultCriticality: "high" });
    const put = (data) => request(app).put("/api/v1/automation/settings").set(admin).send(data);

    expect((await put({ maxActions: 0 })).status).toBe(422);
    expect((await put({ windowMinutes: 2000 })).status).toBe(422);
    expect((await put({ maxActions: 2.5 })).status).toBe(422);
    expect((await put({ defaultCriticality: "extrema" })).status).toBe(422);

    const resp = await put({ maxActions: 3, windowMinutes: 30, defaultCriticality: "critical" });
    expect(resp.status).toBe(200);
    expect(resp.body.settings).toMatchObject({ maxActions: 3, windowMinutes: 30, defaultCriticality: "critical" });
    const event = await prisma.auditEvent.findFirst({ where: { type: "automation_updated" }, orderBy: { id: "desc" } });
    expect(event.detail).toBe("Ajustes: defaultCriticality high -> critical, maxActions 5 -> 3, windowMinutes 10 -> 30");

    await put({ maxActions: 3 });
    const same = await prisma.auditEvent.findFirst({ where: { type: "automation_updated" }, orderBy: { id: "desc" } });
    expect(same.detail).toBe("Ajustes: sin cambios");
  });

  test("politicas y activos tambien se auditan con el valor anterior", async () => {
    const { body } = await request(app).get("/api/v1/automation").set(admin);
    const policy = body.policies.find((p) => p.key === "fuerza-bruta-pais-alto-riesgo");
    await request(app).put(`/api/v1/automation/policies/${policy.id}`).set(admin).send({ enabled: !policy.enabled });
    let event = await prisma.auditEvent.findFirst({ where: { type: "automation_updated" }, orderBy: { id: "desc" } });
    expect(event.detail).toBe(`Política "${policy.name}": enabled ${policy.enabled} -> ${!policy.enabled}`);

    await prisma.asset.deleteMany({ where: { agentId: "055" } });
    await request(app).put("/api/v1/assets/055").set(admin).send({ criticality: "low" });
    await request(app).put("/api/v1/assets/055").set(admin).send({ criticality: "high" });
    event = await prisma.auditEvent.findFirst({ where: { type: "automation_updated" }, orderBy: { id: "desc" } });
    expect(event.detail).toBe("Activo agent-055 (055): criticidad low -> high");
  });

  test("precision por politica, con los veredictos de cierre de los analistas", async () => {
    const mk = (decision, verdict) =>
      prisma.incident.create({
        data: {
          source: "wazuh", ruleId: "87105", severity: 12, hostname: "h", agentId: "001", timestamp: new Date().toISOString(),
          automationPolicy: "Politica de precision", automationDecision: decision,
          ...(verdict ? { verdict, closedAt: new Date() } : {}),
        },
      });
    await mk("executed", "true_positive");
    await mk("executed", "true_positive");
    await mk("executed", "true_positive");
    await mk("executed", "false_positive");
    await mk("executed", null); // contenido, todavia abierto
    await mk("simulated", "benign_positive");

    const stats = (await policyStats())["Politica de precision"];

    expect(stats.executed).toEqual({ total: 5, closed: 4, true_positive: 3, benign_positive: 0, false_positive: 1, precision: 0.75 });
    expect(stats.simulated).toMatchObject({ total: 1, closed: 1, benign_positive: 1, precision: 0 });

    const view = await request(app).get("/api/v1/automation").set(admin);
    expect(view.body.policies.every((p) => p.stats && p.stats.executed && p.stats.simulated)).toBe(true);
  });
});

describe("metricas", () => {
  test("la contencion automatica se mide aparte de la manual", () => {
    const t = "2026-10-15T10:00:00.000Z";
    const metrics = computeMetrics([
      { srcIp: null, timestamp: t, ingestedAt: "2026-10-15T10:00:01.000Z", isolatedAt: "2026-10-15T10:00:02.000Z", blockedAt: null, actionLatencyMs: 200, automationDecision: "executed" },
      { srcIp: null, timestamp: t, ingestedAt: "2026-10-15T10:00:01.000Z", isolatedAt: "2026-10-15T10:00:20.000Z", blockedAt: null, actionLatencyMs: 200, automationDecision: "none" },
    ]);
    expect(metrics["CU-02"].automatedContainment).toEqual({ n: 1, p50Ms: 2000, p95Ms: 2000, maxMs: 2000 });
    expect(metrics["CU-02"].containment).toEqual({ n: 1, p50Ms: 20000, p95Ms: 20000, maxMs: 20000 });
  });
});
