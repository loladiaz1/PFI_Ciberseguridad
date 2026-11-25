// Recomendador de triaje y politicas aprendidas (src/recommender.js, fase 2
// de ml/RESULTADOS.md).
jest.mock("../src/wazuh");
jest.mock("../src/enrichment");

const request = require("supertest");
const bruteforceAlert = require("../mocks/wazuh_ssh_bruteforce.json");
const { app } = require("../src/app");
const { prisma } = require("../src/db");
const { enrichIp } = require("../src/enrichment");
const { ensureAutomationDefaults } = require("../src/automation");
const { computeMetrics } = require("../src/metrics");
const {
  keysOf,
  summarize,
  recommend,
  indexOf,
  backtest,
  suggest,
  patternFailures,
  parseThresholds,
} = require("../src/recommender");
const { adminToken, tokenFor } = require("./helpers");

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
let admin;
let analyst;

// Regla propia de estos tests: el historial de los demas archivos (que usan
// la 5712 del mock) no se mezcla con el de aca.
let nextRule = 99000;
const freshRule = () => String(nextRule++);
const alert = (ip, rule) => ({ ...bruteforceAlert, rule: { ...bruteforceAlert.rule, id: rule }, data: { ...bruteforceAlert.data, srcip: ip } });
const webhook = (body) => request(app).post("/api/v1/webhook/wazuh").send(body);

async function closeAs(id, verdict, auth = analyst) {
  const note = verdict === "true_positive" ? undefined : "Job de monitoreo con credenciales vencidas";
  const resp = await request(app).post(`/api/v1/incidents/${id}/close`).set(auth).send({ verdict, note });
  expect(resp.status).toBe(200);
}

// n incidentes de la misma IP y regla, cerrados uno por uno con el veredicto.
async function history(ip, rule, verdicts) {
  for (const v of verdicts) await closeAs((await webhook(alert(ip, rule))).body.id, v);
}

// El agente del mock (000) no esta en el inventario: con criticidad por
// defecto "media" cumple la condicion de las politicas aprendidas (<= media).
async function configure({ mode = "simulate", maxActions = 1000 } = {}) {
  await ensureAutomationDefaults();
  await prisma.automationSettings.update({ where: { id: 1 }, data: { mode, maxActions, windowMinutes: 10, defaultCriticality: "medium" } });
  await prisma.automationPolicy.updateMany({ data: { enabled: false } });
}

async function adopt(patternKey, minSupport = 3, minAgreement = 0.95) {
  return request(app).post("/api/v1/recommender/policies").set(admin).send({ patternKey, minSupport, minAgreement });
}

async function enableLearned(patternKey) {
  const policies = await prisma.automationPolicy.findMany();
  const p = policies.find((x) => JSON.parse(x.conditions).patternKey === patternKey);
  await prisma.automationPolicy.update({ where: { id: p.id }, data: { enabled: true } });
  return p;
}

beforeAll(async () => {
  admin = bearer(await adminToken());
  analyst = bearer(await tokenFor({ username: "rec-analyst" }));
});

beforeEach(() => {
  enrichIp.mockReset().mockResolvedValue({ vt: null, abuseipdb: null });
});

afterAll(async () => {
  await prisma.automationPolicy.deleteMany({ where: { action: "close-no-action" } });
  // Los cierres automaticos cuentan para el cortacircuitos: que no los vea
  // el test del cortacircuitos de automation.test.js si corre despues.
  await prisma.auditEvent.deleteMany({ where: { actor: "automation", type: "incident_closed" } });
  await configure({ mode: "simulate" });
  await prisma.automationPolicy.updateMany({
    where: { key: { in: ["fuerza-bruta-mala-reputacion", "malware-confirmado"] } },
    data: { enabled: true },
  });
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------

describe("claves, resumen y recomendacion (funciones puras)", () => {
  test("cada caso de uso tiene su entidad y el patron validado en GUIDE", () => {
    expect(keysOf({ useCase: "CU-01", ruleId: "5712", srcIp: "10.0.0.5", alertCount: 7 })).toEqual([
      { level: "entity", key: "CU-01|5712|ip:10.0.0.5", label: "IP 10.0.0.5 · regla 5712", useCase: "CU-01" },
      { level: "pattern", key: "CU-01|5712|alertas:6+", label: "regla 5712 · 6+ alertas", useCase: "CU-01" },
    ]);
    const malware = keysOf({ useCase: "CU-02", ruleId: "87105", alertCount: 3, alerts: [{ detail: "File /tmp/eicar.com" }] });
    expect(malware.map((k) => k.key)).toEqual(["CU-02|87105|archivo:/tmp/eicar.com", "CU-02|87105|alertas:2-5"]);
    const phishing = keysOf({ useCase: "CU-03", ruleId: "user-report", alertCount: 1, emails: [{ fromAddress: "x@Pagos.TEST" }] });
    expect(phishing[0].key).toBe("CU-03|user-report|dominio:pagos.test");
    // Sin indicador (alerta anterior al registro de alertas): solo el patron.
    expect(keysOf({ useCase: "CU-02", ruleId: "87105", alertCount: 1, alerts: [] }).map((k) => k.level)).toEqual(["pattern"]);
  });

  test("un empate cuenta como 'requiere accion' (ante la duda, lo mira una persona)", () => {
    const tie = summarize({ support: 4, true_positive: 2, benign_positive: 1, false_positive: 1 });
    expect(tie.decision).toBe("requires_action");
    expect(tie.verdict).toBe("true_positive");
    const noise = summarize({ support: 5, true_positive: 1, benign_positive: 1, false_positive: 3 });
    expect(noise).toMatchObject({ decision: "no_action", verdict: "false_positive", agreement: 0.8 });
  });

  test("usa el nivel mas especifico con al menos 3 casos; si no hay, null", () => {
    const h = (ip, verdict) => ({ keys: keysOf({ useCase: "CU-01", ruleId: "1", srcIp: ip, alertCount: 1 }), verdict });
    const index = indexOf([h("a", "benign_positive"), h("a", "benign_positive"), h("b", "true_positive"), h("c", "true_positive"), h("d", "true_positive")]);
    // La IP "a" tiene 2 casos: alcanza solo el patron (3 de 5 ataques reales).
    const keysA = keysOf({ useCase: "CU-01", ruleId: "1", srcIp: "a", alertCount: 1 });
    expect(recommend(keysA, index)).toMatchObject({ level: "pattern", decision: "requires_action", support: 5, true_positive: 3 });
    const third = indexOf([h("a", "benign_positive"), h("a", "benign_positive"), h("a", "benign_positive")]);
    expect(recommend(keysA, third)).toMatchObject({ level: "entity", decision: "no_action", agreement: 1 });
    expect(recommend(keysOf({ useCase: "CU-01", ruleId: "2", srcIp: "a", alertCount: 1 }), index)).toBeNull();
  });

  test("una politica aprendida deja de aplicar si el patron ya no cumple N y X, o si la entidad indica ataque", () => {
    const k = (ip) => keysOf({ useCase: "CU-01", ruleId: "1", srcIp: ip, alertCount: 1 });
    const h = (ip, verdict) => ({ keys: k(ip), verdict });
    const cond = (patternKey, minSupport = 3) => ({ patternKey, decision: "no_action", minSupport, minAgreement: 0.95 });
    const base = [h("a", "benign_positive"), h("a", "benign_positive"), h("a", "benign_positive")];

    expect(patternFailures(cond("CU-01|1|ip:a"), { keys: k("a"), index: indexOf(base) })).toEqual([]);
    expect(patternFailures(cond("CU-01|1|ip:a", 4), { keys: k("a"), index: indexOf(base) })).toEqual(["historial 3 < 4 casos"]);
    expect(patternFailures(cond("CU-01|1|ip:a"), { keys: k("a"), index: indexOf([...base, h("a", "true_positive")]) })).toEqual([
      "acuerdo 75 % < 95 %",
    ]);
    expect(patternFailures(cond("CU-01|1|ip:a"), { keys: k("b"), index: indexOf(base) })).toEqual(["el incidente no es de este patrón"]);

    // Patron general "ruido", pero esta IP fue ataque 3 veces: no se cierra.
    const mixed = [...base, ...base, ...base, h("z", "true_positive"), h("z", "true_positive"), h("z", "true_positive")];
    expect(patternFailures(cond("CU-01|1|alertas:1", 3), { keys: k("z"), index: indexOf(mixed) }).at(-1)).toBe(
      "el historial de IP z · regla 1 indica ataque"
    );
  });

  test("N y X invalidos se rechazan; sin valores, los de la fase 1", () => {
    expect(parseThresholds({})).toEqual({ minSupport: 20, minAgreement: 0.95 });
    expect(parseThresholds({ minSupport: "5", minAgreement: "0.9" })).toEqual({ minSupport: 5, minAgreement: 0.9 });
    expect(parseThresholds({ minSupport: 0 }).error).toBeDefined();
    expect(parseThresholds({ minAgreement: 0.4 }).error).toBeDefined();
  });
});

describe("evaluacion temporal (backtest)", () => {
  // Detectado en t, cerrado en t + 0,5: cada caso solo ve lo cerrado antes.
  const item = (t, ip, verdict) => ({
    keys: keysOf({ useCase: "CU-01", ruleId: "7", srcIp: ip, alertCount: 1 }),
    verdict,
    detectedAt: new Date(t * 1000),
    closedAt: new Date(t * 1000 + 500),
  });

  test("solo usa lo cerrado antes de la deteccion y mide aciertos y ataques absorbidos", () => {
    const h = [
      item(1, "a", "benign_positive"),
      item(2, "a", "benign_positive"),
      item(3, "a", "benign_positive"),
      item(4, "a", "benign_positive"), // primero con 3 casos previos: recomienda y acierta
      item(5, "a", "true_positive"), // recomienda cerrar y era un ataque
    ];
    const r = backtest(h, { minSupport: 3, minAgreement: 0.95 });
    expect(r).toMatchObject({ incidents: 5, truePositives: 1, recommended: 2, correct: 1 });
    expect(r.noAction).toEqual({ recommended: 2, correct: 1, precision: 0.5 });
    expect(r.byLevel.entity).toEqual({ recommended: 2, correct: 1 });
    expect(r.policies).toMatchObject({ matched: 2, correct: 1, tpAbsorbed: 1, tpAbsorbedOfAllTp: 1 });
    expect(r.coverage).toBe(0.4);
  });

  test("las sugerencias son los patrones 'sin accion' que cumplen N y X", () => {
    const h = [1, 2, 3].map((t) => item(t, "a", "false_positive")).concat([item(4, "b", "true_positive")]);
    const s = suggest(h, { minSupport: 3, minAgreement: 0.95 });
    expect(s.map((x) => x.key)).toEqual(["CU-01|7|ip:a"]);
    expect(s[0]).toMatchObject({ verdict: "false_positive", support: 3, agreement: 1, label: "IP a · regla 7" });
  });
});

// ---------------------------------------------------------------------------

describe("recomendacion en el detalle del incidente", () => {
  test("aparece con 3 cierres de la misma IP y regla, y no cuenta los cierres automaticos", async () => {
    const rule = freshRule();
    const ip = "198.51.100.10";
    await history(ip, rule, ["benign_positive", "benign_positive"]);
    let open = await webhook(alert(ip, rule));
    let detail = await request(app).get(`/api/v1/incidents/${open.body.id}`).set(analyst);
    expect(detail.status).toBe(200);
    expect(detail.body.recommendation).toBeNull();
    expect(detail.body.alerts).toBeUndefined();

    // Un cierre de la automatizacion no es historial.
    await prisma.incident.update({ where: { id: open.body.id }, data: { closedAt: new Date(), closedBy: "automation", verdict: "benign_positive" } });
    open = await webhook(alert(ip, rule));
    detail = await request(app).get(`/api/v1/incidents/${open.body.id}`).set(analyst);
    expect(detail.body.recommendation).toBeNull();

    await closeAs(open.body.id, "benign_positive");
    open = await webhook(alert(ip, rule));
    detail = await request(app).get(`/api/v1/incidents/${open.body.id}`).set(analyst);
    expect(detail.body.recommendation).toMatchObject({
      level: "entity",
      key: `CU-01|${rule}|ip:${ip}`,
      decision: "no_action",
      verdict: "benign_positive",
      support: 3,
      agreement: 1,
    });
    expect(detail.body.automationAction).toBeNull();
  });
});

describe("GET /api/v1/recommender y adopcion de politicas", () => {
  test("devuelve la evaluacion y las sugerencias; valida N y X", async () => {
    const rule = freshRule();
    await history("198.51.100.20", rule, ["false_positive", "false_positive", "false_positive"]);
    const resp = await request(app).get("/api/v1/recommender").query({ minSupport: 3 }).set(analyst);
    expect(resp.status).toBe(200);
    expect(resp.body).toMatchObject({ minSupport: 3, minAgreement: 0.95 });
    expect(resp.body.evaluation.incidents).toBeGreaterThanOrEqual(3);
    const s = resp.body.suggestions.find((x) => x.key === `CU-01|${rule}|ip:198.51.100.20`);
    expect(s).toMatchObject({ adopted: false, verdict: "false_positive", support: 3 });

    expect((await request(app).get("/api/v1/recommender").query({ minAgreement: 2 }).set(analyst)).status).toBe(422);
  });

  test("solo un admin adopta; un patron que no cumple o ya adoptado se rechaza", async () => {
    const rule = freshRule();
    const key = `CU-01|${rule}|ip:198.51.100.30`;
    await history("198.51.100.30", rule, ["benign_positive", "benign_positive", "benign_positive"]);

    expect((await request(app).post("/api/v1/recommender/policies").set(analyst).send({ patternKey: key, minSupport: 3 })).status).toBe(403);
    expect((await adopt(key, 4)).status).toBe(422);
    expect((await adopt(key, 0)).status).toBe(422);

    const created = await adopt(key);
    expect(created.status).toBe(201);
    const policy = created.body.policies.find((p) => p.conditions.patternKey === key);
    expect(policy).toMatchObject({
      enabled: false,
      useCase: "CU-01",
      action: "close-no-action",
      name: `Aprendida: IP 198.51.100.30 · regla ${rule} → cerrar sin acción`,
      conditions: { decision: "no_action", minSupport: 3, minAgreement: 0.95, maxAssetCriticality: "medium" },
    });
    expect(policy.order).toBe(Math.max(...created.body.policies.map((p) => p.order)));
    expect((await adopt(key)).status).toBe(409);

    const audit = await prisma.auditEvent.findFirst({ where: { type: "automation_updated" }, orderBy: { id: "desc" } });
    expect(audit.detail).toMatch(/^Política aprendida ".+" \(deshabilitada\): 3 de 3 casos sin acción, acuerdo 100 %; N 3, X 95 %$/);

    const listed = await request(app).get("/api/v1/recommender").query({ minSupport: 3 }).set(analyst);
    expect(listed.body.suggestions.find((x) => x.key === key).adopted).toBe(true);

    // N y X se editan; el patron no.
    const put = (conditions) => request(app).put(`/api/v1/automation/policies/${policy.id}`).set(admin).send({ conditions });
    expect((await put({ ...policy.conditions, minSupport: 5 })).status).toBe(200);
    expect((await put({ ...policy.conditions, patternKey: "CU-01|1|ip:1.1.1.1" })).status).toBe(422);
    expect((await put({ ...policy.conditions, minAgreement: 0.3 })).status).toBe(422);
  });
});

describe("eliminar una politica aprendida", () => {
  test("solo un admin, solo las aprendidas, auditado; el patron se puede volver a adoptar", async () => {
    const rule = freshRule();
    const key = `CU-01|${rule}|ip:198.51.100.70`;
    await history("198.51.100.70", rule, ["benign_positive", "benign_positive", "benign_positive"]);
    const policy = (await adopt(key)).body.policies.find((p) => p.conditions.patternKey === key);
    const del = (id, auth = admin) => request(app).delete(`/api/v1/automation/policies/${id}`).set(auth);

    expect((await del(policy.id, analyst)).status).toBe(403);
    const initial = (await request(app).get("/api/v1/automation").set(admin)).body.policies.find((p) => p.key === "malware-confirmado");
    expect((await del(initial.id)).status).toBe(422);

    const resp = await del(policy.id);
    expect(resp.status).toBe(200);
    expect(resp.body.policies.some((p) => p.id === policy.id)).toBe(false);
    const audit = await prisma.auditEvent.findFirst({ where: { type: "automation_updated" }, orderBy: { id: "desc" } });
    expect(audit.actor).toBe(process.env.AUTH_USER);
    expect(audit.detail).toBe(`Política aprendida "${policy.name}" eliminada (estaba deshabilitada; condiciones ${JSON.stringify(policy.conditions)})`);
    expect((await del(policy.id)).status).toBe(404);

    const listed = await request(app).get("/api/v1/recommender").query({ minSupport: 3 }).set(analyst);
    expect(listed.body.suggestions.find((s) => s.key === key).adopted).toBe(false);
    expect((await adopt(key)).status).toBe(201);
  });
});

describe("cierre automatico por una politica aprendida", () => {
  test("simulacion -> activa -> se apaga sola cuando un analista marca un ataque", async () => {
    await configure({ mode: "simulate" });
    const rule = freshRule();
    const ip = "198.51.100.40";
    const key = `CU-01|${rule}|ip:${ip}`;
    await history(ip, rule, ["benign_positive", "benign_positive", "benign_positive"]);
    expect((await adopt(key)).status).toBe(201);
    const policy = await enableLearned(key);

    // Simulacion: queda registrado, no se cierra.
    const simulated = await webhook(alert(ip, rule));
    let incident = await prisma.incident.findUnique({ where: { id: simulated.body.id } });
    expect(incident).toMatchObject({ automationDecision: "simulated", automationPolicy: policy.name, closedAt: null });
    const sim = await prisma.auditEvent.findFirst({ where: { incidentId: incident.id, type: "automation_simulated" } });
    expect(sim.detail).toContain("cierre sin acción");
    const detail = await request(app).get(`/api/v1/incidents/${incident.id}`).set(analyst);
    expect(detail.body.automationAction).toBe("close-no-action");
    await closeAs(incident.id, "benign_positive");

    // Activa: se cierra solo, con el veredicto del historial y la evidencia.
    await configure({ mode: "active" });
    await enableLearned(key);
    const closed = await webhook(alert(ip, rule));
    incident = await prisma.incident.findUnique({ where: { id: closed.body.id } });
    expect(incident).toMatchObject({ automationDecision: "executed", closedBy: "automation", verdict: "benign_positive", status: "new" });
    expect(incident.closingNote).toBe(`Cierre automático: 4 de 4 casos de este patrón se cerraron sin acción (política "${policy.name}").`);
    expect(JSON.parse(incident.tags)).toEqual(["brute_force", "auto_closed"]);
    const audit = await prisma.auditEvent.findFirst({ where: { incidentId: incident.id, type: "incident_closed" } });
    expect(audit).toMatchObject({ actor: "automation" });

    // La precision de la politica solo mide cierres de un analista: el
    // simulado cerrado como benigno cuenta, el cierre automatico no.
    const cfg = await request(app).get("/api/v1/automation").set(analyst);
    const stats = cfg.body.policies.find((p) => p.id === policy.id).stats;
    expect(stats.simulated).toMatchObject({ total: 1, closed: 1, benign_positive: 1, precision: 1 });
    expect(stats.executed).toMatchObject({ total: 1, closed: 0, precision: null });

    // Un analista reabre el cierre automatico: no se vuelve a cerrar solo.
    await request(app).post(`/api/v1/incidents/${incident.id}/reopen`).set(analyst).send({ note: "Lo revisamos a mano" });
    const { runAutomation } = require("../src/automation");
    expect(await runAutomation(incident.id)).toBeNull();

    // Y lo cierra como ataque real: el acuerdo baja (4 de 5) y la politica
    // deja de aplicar a este patron.
    await closeAs(incident.id, "true_positive");
    const next = await webhook(alert(ip, rule));
    incident = await prisma.incident.findUnique({ where: { id: next.body.id } });
    expect(incident.closedAt).toBeNull();
    expect(incident.automationDecision).toBe("none");
    expect(incident.automationReason).toContain("acuerdo 80 % < 95 %");
  });

  test("un caso que un analista cerro y reabrio no se cierra solo (aunque la politica aplique)", async () => {
    await configure({ mode: "active" });
    const rule = freshRule();
    const ip = "198.51.100.60";
    const key = `CU-01|${rule}|ip:${ip}`;
    await history(ip, rule, ["benign_positive", "benign_positive", "benign_positive"]);
    await adopt(key);
    const policy = await enableLearned(key);

    // Lo cierra un analista antes de que la politica aplique (aca: deshabilitada).
    await prisma.automationPolicy.update({ where: { id: policy.id }, data: { enabled: false } });
    const created = await webhook(alert(ip, rule));
    await closeAs(created.body.id, "benign_positive");
    await prisma.automationPolicy.update({ where: { id: policy.id }, data: { enabled: true } });

    // Lo reabre y llegan alertas nuevas: con la agrupacion, se suman al caso.
    await request(app).post(`/api/v1/incidents/${created.body.id}/reopen`).set(analyst).send({ note: "Me equivoque, hay que mirarlo" });
    const { runAutomation } = require("../src/automation");
    const result = await runAutomation(created.body.id);

    const incident = await prisma.incident.findUnique({ where: { id: created.body.id } });
    expect(result.decision).toBe("none");
    expect(incident.closedAt).toBeNull();
    expect(incident.automationReason).toBe("Caso reabierto por un analista: las políticas aprendidas no lo cierran");
  });

  test("los cierres automaticos cuentan para el cortacircuitos", async () => {
    await configure({ mode: "active", maxActions: 1 });
    const rule = freshRule();
    const ip = "198.51.100.50";
    const key = `CU-01|${rule}|ip:${ip}`;
    await history(ip, rule, ["benign_positive", "benign_positive", "benign_positive"]);
    await adopt(key);
    await enableLearned(key);
    // Que no cuenten las acciones automaticas de otros tests.
    await prisma.auditEvent.deleteMany({ where: { actor: "automation" } });

    const first = await webhook(alert(ip, rule));
    expect((await prisma.incident.findUnique({ where: { id: first.body.id } })).closedBy).toBe("automation");
    const second = await webhook(alert(ip, rule));
    const incident = await prisma.incident.findUnique({ where: { id: second.body.id } });
    expect(incident.closedAt).toBeNull();
    expect(incident.automationReason).toContain("cortacircuitos");
    expect((await prisma.automationSettings.findUnique({ where: { id: 1 } })).mode).toBe("simulate");
  });
});

test("el tiempo hasta el cierre no cuenta los cierres automaticos", () => {
  const base = { srcIp: "1.1.1.1", useCase: "CU-01", timestamp: "2026-10-01T00:00:00.000Z", ingestedAt: "2026-10-01T00:00:01.000Z" };
  const m = computeMetrics([
    { ...base, closedAt: "2026-10-01T00:10:00.000Z", closedBy: "ana" },
    { ...base, closedAt: "2026-10-01T00:00:02.000Z", closedBy: "automation" },
  ]);
  expect(m["CU-01"].timeToClose).toMatchObject({ n: 1, p50Ms: 600000 });
});
