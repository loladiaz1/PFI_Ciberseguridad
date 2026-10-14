// Automatizacion de la respuesta segun contexto ("autonomia graduada").
//
// La campana de medicion del 14/10 mostro que el 94 % del tiempo de
// contencion es la decision del analista. Para los casos claros y de bajo
// riesgo, una politica aprobada por un admin decide sola; el resto sigue
// esperando al analista (humano "en" el ciclo -> humano "sobre" el ciclo).
//
// - Modo: off (no evalua) | simulate (registra lo que haria, no ejecuta) |
//   active (ejecuta).
// - Politicas: se evaluan en orden; gana la primera habilitada cuyas
//   condiciones se cumplen todas.
// - Reglas fijas, por encima de cualquier politica: un activo "critical"
//   nunca se mitiga solo, y una IP de la lista de exclusion nunca se bloquea.
// - Toda decision queda en el incidente (automationDecision / Policy /
//   Reason) y en la auditoria con actor "automation".
const fs = require("fs");
const path = require("path");
const { prisma } = require("./db");
const { logAudit } = require("./audit");
const { mitigate } = require("./mitigation");

const DEFAULTS_PATH = path.join(__dirname, "..", "config", "automation.defaults.json");
const MODES = ["off", "simulate", "active"];
const CRITICALITIES = ["low", "medium", "high", "critical"];
const ACTOR = "automation";

function loadDefaults() {
  return JSON.parse(fs.readFileSync(DEFAULTS_PATH, "utf8"));
}

// Carga los valores iniciales solo si faltan: nunca pisa lo que un admin ya
// configuro. Idempotente.
async function ensureAutomationDefaults(db = prisma) {
  const defaults = loadDefaults();
  if (!(await db.automationSettings.findUnique({ where: { id: 1 } }))) {
    await db.automationSettings.create({
      data: { id: 1, mode: defaults.mode, allowlist: JSON.stringify(defaults.allowlist), defaultCriticality: defaults.defaultCriticality },
    });
  }
  for (const p of defaults.policies) {
    if (!(await db.automationPolicy.findUnique({ where: { key: p.key } }))) {
      await db.automationPolicy.create({
        data: { key: p.key, name: p.name, order: p.order, enabled: p.enabled, useCase: p.useCase, action: p.action, conditions: JSON.stringify(p.conditions) },
      });
    }
  }
  for (const a of defaults.assets) {
    if (!(await db.asset.findUnique({ where: { agentId: a.agentId } }))) {
      await db.asset.create({ data: a });
    }
  }
}

// Configuracion completa, con los JSON ya parseados.
async function getAutomationConfig(db = prisma) {
  await ensureAutomationDefaults(db);
  const settings = await db.automationSettings.findUnique({ where: { id: 1 } });
  const policies = await db.automationPolicy.findMany({ orderBy: { order: "asc" } });
  const assets = await db.asset.findMany({ orderBy: { agentId: "asc" } });
  return {
    settings: { ...settings, allowlist: JSON.parse(settings.allowlist) },
    policies: policies.map((p) => ({ ...p, conditions: JSON.parse(p.conditions) })),
    assets,
  };
}

// --- utilidades -----------------------------------------------------------

function ipToInt(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return parts.reduce((acc, n) => acc * 256 + n, 0);
}

// IPv4 exacta o CIDR (203.0.113.0/24). Lo que no entiende, no matchea.
function ipMatches(ip, entry) {
  if (!ip || !entry) return false;
  if (!entry.includes("/")) return ip === entry;
  const [base, bitsRaw] = entry.split("/");
  const bits = Number(bitsRaw);
  const a = ipToInt(ip);
  const b = ipToInt(base);
  if (a === null || b === null || !(bits >= 0 && bits <= 32)) return false;
  const size = 2 ** (32 - bits);
  return Math.floor(a / size) === Math.floor(b / size);
}

const rank = (criticality) => CRITICALITIES.indexOf(criticality);

// Contexto que usan las condiciones, a partir del incidente persistido.
function contextOf(incident, asset, defaultCriticality) {
  const abuse = incident.enrichmentAbuseIpdb ? JSON.parse(incident.enrichmentAbuseIpdb) : null;
  const vt = incident.enrichmentVt ? JSON.parse(incident.enrichmentVt) : null;
  return {
    useCase: incident.srcIp ? "CU-01" : "CU-02",
    severity: incident.severity,
    abuseScore: abuse?.abuseConfidenceScore ?? null,
    country: abuse?.countryCode ?? null,
    vtMalicious: vt?.malicious ?? null,
    hashPositives: incident.hashPositives ?? null,
    criticality: asset?.criticality ?? defaultCriticality,
  };
}

// Devuelve la lista de condiciones que NO se cumplen (vacia = la politica aplica).
// Un dato faltante (ej. sin reputacion porque VT no respondio) cuenta como
// no cumplido: ante la duda, no se automatiza.
function failedConditions(conditions, ctx) {
  const failed = [];
  const atLeast = (key, value, min) => {
    if (min === undefined) return;
    if (value === null || value < min) failed.push(`${key} ${value ?? "n/d"} < ${min}`);
  };
  atLeast("severity", ctx.severity, conditions.minSeverity);
  atLeast("abuseScore", ctx.abuseScore, conditions.minAbuseScore);
  atLeast("vtMalicious", ctx.vtMalicious, conditions.minVtMalicious);
  atLeast("hashPositives", ctx.hashPositives, conditions.minHashPositives);
  if (conditions.fromCountries && !conditions.fromCountries.includes(ctx.country)) {
    failed.push(`country ${ctx.country ?? "n/d"} not in ${conditions.fromCountries.join(",")}`);
  }
  if (conditions.maxAssetCriticality && rank(ctx.criticality) > rank(conditions.maxAssetCriticality)) {
    failed.push(`asset ${ctx.criticality} > ${conditions.maxAssetCriticality}`);
  }
  return failed;
}

// Decision pura (sin efectos): { decision, policy, reason }.
// decision: "none" | "simulate" | "execute"
function evaluate({ incident, settings, policies, asset }) {
  if (settings.mode === "off") return { decision: "none", policy: null, reason: "Automation off" };

  const ctx = contextOf(incident, asset, settings.defaultCriticality);
  if (ctx.criticality === "critical") {
    return { decision: "none", policy: null, reason: "Critical asset: manual response only" };
  }

  const candidates = policies.filter((p) => p.enabled && p.useCase === ctx.useCase);
  for (const policy of candidates) {
    if (failedConditions(policy.conditions, ctx).length > 0) continue;
    if (policy.action === "block-ip" && settings.allowlist.some((entry) => ipMatches(incident.srcIp, entry))) {
      return { decision: "none", policy, reason: `IP ${incident.srcIp} is in the allowlist` };
    }
    return {
      decision: settings.mode === "active" ? "execute" : "simulate",
      policy,
      reason: `Policy "${policy.name}" matched`,
    };
  }

  const tried = candidates.map((p) => `${p.name}: ${failedConditions(p.conditions, ctx).join("; ")}`);
  return { decision: "none", policy: null, reason: tried.length ? `No policy matched (${tried.join(" | ")})` : "No enabled policy for this use case" };
}

// Evalua un incidente recien creado (o recien enriquecido) y actua segun el
// modo. Nunca tira: un error en la automatizacion no debe afectar la ingesta.
async function runAutomation(incidentId) {
  try {
    const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
    // Si un analista ya actuo mientras tanto, no hay nada que decidir.
    if (!incident || incident.status !== "new") return null;

    const { settings, policies } = await getAutomationConfig();
    const asset = await prisma.asset.findUnique({ where: { agentId: incident.agentId } });
    const result = evaluate({ incident, settings, policies, asset });
    const record = { automationPolicy: result.policy?.name ?? null, automationReason: result.reason };

    if (result.decision === "none") {
      await prisma.incident.update({ where: { id: incident.id }, data: { automationDecision: "none", ...record } });
      return result;
    }

    if (result.decision === "simulate") {
      // Re-evaluacion por una alerta agrupada con la misma conclusion: no
      // repetir el evento de auditoria (seria ruido).
      const unchanged = incident.automationDecision === "simulated" && incident.automationPolicy === record.automationPolicy;
      await prisma.incident.update({ where: { id: incident.id }, data: { automationDecision: "simulated", ...record } });
      if (unchanged) return result;
      await logAudit(
        "automation_simulated",
        `Would ${result.policy.action} on incident #${incident.id} (policy "${result.policy.name}")`,
        ACTOR,
        incident.id
      );
      return result;
    }

    try {
      await mitigate(incident, result.policy.action, ACTOR, {
        auditSuffix: ` automatically, policy "${result.policy.name}"`,
        extraData: { automationDecision: "executed", ...record },
      });
    } catch (err) {
      // Wazuh rechazo: el incidente queda abierto para el analista.
      await prisma.incident.update({
        where: { id: incident.id },
        data: { automationDecision: "failed", ...record, automationReason: `${result.reason}; Wazuh rejected: ${err.message}` },
      });
      await logAudit("automation_failed", `Automatic ${result.policy.action} failed on incident #${incident.id}`, ACTOR, incident.id);
    }
    return result;
  } catch (err) {
    console.error("La automatizacion fallo:", err.message);
    return null;
  }
}

module.exports = {
  MODES,
  CRITICALITIES,
  ACTOR,
  ensureAutomationDefaults,
  getAutomationConfig,
  ipMatches,
  failedConditions,
  evaluate,
  runAutomation,
};
