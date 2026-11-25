// Recomendador de triaje (RF-15 / HU-11): fase 2 del componente de
// aprendizaje automatico (ml/RESULTADOS.md, secciones 6 y 10).
//
// Aprende de los veredictos de cierre de los analistas (src/closure.js). La
// fase 1, sobre 1 M de incidentes reales de GUIDE, mostro que casi toda la
// senal esta en "que decidio este SOC antes con casos de este patron": la
// tabla de historia empata con el gradient boosting cuando hay historia
// (macro-F1 0,927 vs 0,931) y es auditable sin ML. Por eso en produccion se
// sirve esa tabla, que se actualiza con cada cierre.
//
// Dos niveles, del mas especifico al mas general (mismo "back-off" que la
// tabla de base de ml/fortia_ml/baselines.py):
// - entidad: la regla y el indicador del caso (IP de origen en CU-01,
//   archivo en CU-02, dominio del remitente en CU-03). En GUIDE estos IDs
//   estaban anonimizados; en Fortia son reales.
// - patron: regla, tipo de evidencia y tamano (1, 2-5 o 6+ alertas), el
//   patron validado en GUIDE (ml/fortia_ml/policies.py, PATTERN).
// Se usa el primer nivel con al menos MIN_HISTORY casos cerrados.
//
// La decision es binaria, como en la fase 1: requires_action (verdadero
// positivo) o no_action (benigno o falso positivo). Un empate cuenta como
// requires_action: ante la duda, que lo mire una persona.
//
// Circularidad (ml/RESULTADOS.md, limitacion 8): los casos que cerro la
// propia automatizacion no entran al historial; si no, el modelo aprenderia
// de si mismo.
const { prisma } = require("./db");
const { useCaseOf } = require("./normalize");

// Mismo actor que src/automation.js (ACTOR).
const AUTOMATION_ACTOR = "automation";
const REQUIRES_ACTION = "requires_action";
const NO_ACTION = "no_action";
// Casos cerrados que hacen falta para mostrar una recomendacion.
const MIN_HISTORY = 3;
// N y X por defecto de la fase 1 (politicas por organizacion: 58,8 % de los
// incidentes cerrados sin accion con 99,6 % de precision en GUIDE).
const DEFAULT_MIN_SUPPORT = 20;
const DEFAULT_MIN_AGREEMENT = 0.95;

const ENTITY = {
  "CU-01": { name: "ip", label: "IP" },
  "CU-02": { name: "archivo", label: "archivo" },
  "CU-03": { name: "dominio", label: "remitente @" },
};

function alertBucket(alertCount) {
  return alertCount <= 1 ? "1" : alertCount <= 5 ? "2-5" : "6+";
}

// El indicador del caso. incident.alerts / incident.emails: la primera alerta
// y el primer correo, si se cargaron.
function entityOf(incident) {
  const useCase = useCaseOf(incident);
  if (useCase === "CU-01") return incident.srcIp || null;
  if (useCase === "CU-02") return incident.alerts?.[0]?.detail?.replace(/^File /, "") || null;
  const from = incident.emails?.[0]?.fromAddress;
  return from?.includes("@") ? from.split("@").pop().toLowerCase() : null;
}

// Claves del caso, de la mas especifica a la mas general.
function keysOf(incident) {
  const useCase = useCaseOf(incident);
  const rule = incident.ruleId;
  const keys = [];
  const entity = entityOf(incident);
  if (entity) {
    keys.push({
      level: "entity",
      key: `${useCase}|${rule}|${ENTITY[useCase].name}:${entity}`,
      label: `${ENTITY[useCase].label} ${entity} · regla ${rule}`,
      useCase,
    });
  }
  const bucket = alertBucket(incident.alertCount ?? 1);
  keys.push({
    level: "pattern",
    key: `${useCase}|${rule}|alertas:${bucket}`,
    label: `regla ${rule} · ${bucket === "1" ? "1 alerta" : `${bucket} alertas`}`,
    useCase,
  });
  return keys;
}

function emptyCounts() {
  return { support: 0, true_positive: 0, benign_positive: 0, false_positive: 0 };
}

function add(index, item) {
  for (const { key } of item.keys) {
    const c = index.get(key) ?? emptyCounts();
    c.support += 1;
    c[item.verdict] += 1;
    index.set(key, c);
  }
}

// Decision, veredicto sugerido y acuerdo (que parte del historial decidio
// lo mismo).
function summarize(c) {
  const requires = c.true_positive >= c.support / 2;
  const agreeing = requires ? c.true_positive : c.support - c.true_positive;
  return {
    ...c,
    decision: requires ? REQUIRES_ACTION : NO_ACTION,
    verdict: requires ? "true_positive" : c.benign_positive >= c.false_positive ? "benign_positive" : "false_positive",
    agreement: c.support ? agreeing / c.support : 0,
  };
}

// Recomendacion para un caso, dado el historial indexado. null = sin
// historial suficiente: decide el analista.
function recommend(keys, index) {
  for (const k of keys) {
    const c = index.get(k.key);
    if (c && c.support >= MIN_HISTORY) return { ...k, ...summarize(c) };
  }
  return null;
}

// Historial: casos cerrados por un analista, con lo necesario para sus claves.
async function loadHistory(db = prisma) {
  const rows = await db.incident.findMany({
    where: { closedAt: { not: null }, verdict: { not: null } },
    select: {
      id: true, useCase: true, srcIp: true, ruleId: true, alertCount: true, verdict: true,
      closedAt: true, closedBy: true, ingestedAt: true, timestamp: true,
      alerts: { orderBy: { id: "asc" }, take: 1, select: { detail: true } },
      emails: { orderBy: { id: "asc" }, take: 1, select: { fromAddress: true } },
    },
  });
  return rows
    .filter((r) => r.closedBy !== AUTOMATION_ACTOR)
    .map((r) => ({
      id: r.id,
      keys: keysOf(r),
      verdict: r.verdict,
      closedAt: r.closedAt,
      detectedAt: r.ingestedAt ?? new Date(r.timestamp),
    }));
}

function indexOf(history) {
  const index = new Map();
  for (const item of history) add(index, item);
  return index;
}

// Claves del incidente e historial sin el (si ya esta cerrado, no se
// recomienda a si mismo). incident puede venir sin alerts / emails.
async function learnedContext(incident, db = prisma) {
  const full = incident.alerts && incident.emails ? incident : {
    ...incident,
    alerts: await db.incidentAlert.findMany({ where: { incidentId: incident.id }, orderBy: { id: "asc" }, take: 1 }),
    emails: await db.incidentEmail.findMany({ where: { incidentId: incident.id }, orderBy: { id: "asc" }, take: 1 }),
  };
  const history = (await loadHistory(db)).filter((h) => h.id !== incident.id);
  return { keys: keysOf(full), index: indexOf(history) };
}

async function recommendationFor(incident, db = prisma) {
  const { keys, index } = await learnedContext(incident, db);
  return recommend(keys, index);
}

// Patrones que hoy cumplen N y X para "cerrar sin accion": las politicas que
// un admin puede adoptar. Solo no_action: la contencion automatica ya tiene
// sus politicas por contexto (reputacion, VirusTotal, criticidad).
function suggest(history, { minSupport, minAgreement }) {
  const index = indexOf(history);
  const labels = new Map(history.flatMap((h) => h.keys.map((k) => [k.key, k])));
  return [...index]
    .map(([key, c]) => ({ ...labels.get(key), ...summarize(c) }))
    .filter((s) => s.decision === NO_ACTION && s.support >= minSupport && s.agreement >= minAgreement)
    .sort((a, b) => b.support - a.support || a.key.localeCompare(b.key));
}

// Motivos por los que una politica aprendida NO aplica (vacio = aplica). Se
// vuelve a medir con el historial actual: si el patron dejo de cumplir N y X
// (por ejemplo, un analista cerro uno como ataque real), la politica se
// apaga sola para ese patron. Y si el historial propio de la entidad dice
// "ataque", no se cierra por el patron general.
function patternFailures(conditions, learned) {
  const position = learned.keys.findIndex((k) => k.key === conditions.patternKey);
  if (position < 0) return ["el incidente no es de este patrón"];
  const failed = [];
  const s = summarize(learned.index.get(conditions.patternKey) ?? emptyCounts());
  if (s.support < conditions.minSupport) failed.push(`historial ${s.support} < ${conditions.minSupport} casos`);
  else if (s.decision !== conditions.decision || s.agreement < conditions.minAgreement) {
    failed.push(`acuerdo ${Math.round(s.agreement * 100)} % < ${Math.round(conditions.minAgreement * 100)} %`);
  }
  for (const k of learned.keys.slice(0, position)) {
    const specific = learned.index.get(k.key);
    if (specific && specific.support >= MIN_HISTORY && summarize(specific).decision === REQUIRES_ACTION) {
      failed.push(`el historial de ${k.label} indica ataque`);
    }
  }
  return failed;
}

const rate = (num, den) => (den ? num / den : null);

// Evaluacion temporal con los casos reales de Fortia, el mismo criterio que
// la evaluacion principal de la fase 1: cada caso se recomienda solo con lo
// cerrado ANTES de que se detectara. Mide la recomendacion (cualquier
// historial >= MIN_HISTORY) y las politicas de cierre (N y X).
function backtest(history, { minSupport, minAgreement }) {
  const byDetection = [...history].sort((a, b) => a.detectedAt - b.detectedAt);
  const byClosure = [...history].sort((a, b) => a.closedAt - b.closedAt);
  const index = new Map();
  let next = 0;
  const r = {
    incidents: history.length,
    truePositives: 0,
    recommended: 0,
    correct: 0,
    noAction: { recommended: 0, correct: 0 },
    requiresAction: { recommended: 0, correct: 0 },
    byLevel: { entity: { recommended: 0, correct: 0 }, pattern: { recommended: 0, correct: 0 } },
    policies: { matched: 0, correct: 0, tpAbsorbed: 0 },
  };

  for (const item of byDetection) {
    while (next < byClosure.length && byClosure[next].closedAt < item.detectedAt) add(index, byClosure[next++]);
    const actual = item.verdict === "true_positive" ? REQUIRES_ACTION : NO_ACTION;
    if (actual === REQUIRES_ACTION) r.truePositives += 1;

    const rec = recommend(item.keys, index);
    if (rec) {
      const ok = rec.decision === actual ? 1 : 0;
      r.recommended += 1;
      r.correct += ok;
      const side = rec.decision === NO_ACTION ? r.noAction : r.requiresAction;
      side.recommended += 1;
      side.correct += ok;
      r.byLevel[rec.level].recommended += 1;
      r.byLevel[rec.level].correct += ok;
    }

    // Todas las politicas sugeridas adoptadas: aplica la primera clave que
    // cumple N y X para cerrar sin accion.
    const policy = item.keys.find((k) => {
      const c = index.get(k.key);
      return c && patternFailures({ patternKey: k.key, decision: NO_ACTION, minSupport, minAgreement }, { keys: item.keys, index }).length === 0;
    });
    if (policy) {
      r.policies.matched += 1;
      if (actual === NO_ACTION) r.policies.correct += 1;
      else r.policies.tpAbsorbed += 1;
    }
  }

  r.coverage = rate(r.recommended, r.incidents);
  r.accuracy = rate(r.correct, r.recommended);
  r.noAction.precision = rate(r.noAction.correct, r.noAction.recommended);
  r.requiresAction.precision = rate(r.requiresAction.correct, r.requiresAction.recommended);
  r.policies.coverage = rate(r.policies.matched, r.incidents);
  r.policies.precision = rate(r.policies.correct, r.policies.matched);
  r.policies.tpAbsorbedOfAllTp = rate(r.policies.tpAbsorbed, r.truePositives);
  return r;
}

// N (casos) y X (acuerdo) desde la query o el body. { error } si no valen.
function parseThresholds({ minSupport = DEFAULT_MIN_SUPPORT, minAgreement = DEFAULT_MIN_AGREEMENT } = {}) {
  const n = Number(minSupport);
  const x = Number(minAgreement);
  if (!Number.isInteger(n) || n < 1 || n > 1000 || !(x >= 0.5 && x <= 1)) {
    return { error: "minSupport debe ser un entero 1-1000 y minAgreement un numero entre 0,5 y 1" };
  }
  return { minSupport: n, minAgreement: x };
}

// Politica de automatizacion a partir de un patron sugerido. Arranca
// deshabilitada; el modo (simulacion / activa) lo decide el admin, y siguen
// valiendo activo critico = solo manual y el cortacircuitos.
function policyFromSuggestion(s, { minSupport, minAgreement }, order) {
  return {
    key: `ml-${s.key.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`.slice(0, 120),
    name: `Aprendida: ${s.label} → cerrar sin acción`,
    order,
    enabled: false,
    useCase: s.useCase,
    action: "close-no-action",
    conditions: JSON.stringify({ patternKey: s.key, decision: NO_ACTION, minSupport, minAgreement, maxAssetCriticality: "medium" }),
  };
}

module.exports = {
  REQUIRES_ACTION,
  NO_ACTION,
  MIN_HISTORY,
  DEFAULT_MIN_SUPPORT,
  DEFAULT_MIN_AGREEMENT,
  alertBucket,
  keysOf,
  summarize,
  recommend,
  loadHistory,
  indexOf,
  learnedContext,
  recommendationFor,
  suggest,
  patternFailures,
  backtest,
  parseThresholds,
  policyFromSuggestion,
};
