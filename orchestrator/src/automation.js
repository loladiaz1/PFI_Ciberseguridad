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
const net = require("net");
const path = require("path");
const { prisma } = require("./db");
const { logAudit } = require("./audit");
const { mitigate } = require("./mitigation");

const DEFAULTS_PATH = path.join(__dirname, "..", "config", "automation.defaults.json");
const MODES = ["off", "simulate", "active"];
const CRITICALITIES = ["low", "medium", "high", "critical"];
const ACTOR = "automation";
// Texto de cada accion en la auditoria y en los motivos.
const ACTION_LABELS = { "block-ip": "bloqueo de IP", "isolate-host": "aislamiento del host" };

function loadDefaults() {
  return JSON.parse(fs.readFileSync(DEFAULTS_PATH, "utf8"));
}

// Carga los valores iniciales solo si faltan: nunca pisa lo que un admin ya
// configuro. Idempotente.
async function ensureAutomationDefaults(db = prisma) {
  const defaults = loadDefaults();
  if (!(await db.automationSettings.findUnique({ where: { id: 1 } }))) {
    await db.automationSettings.create({
      data: {
        id: 1,
        mode: defaults.mode,
        allowlist: JSON.stringify(defaults.allowlist),
        defaultCriticality: defaults.defaultCriticality,
        maxActions: defaults.maxActions,
        windowMinutes: defaults.windowMinutes,
      },
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
  const stats = await policyStats(db);
  return {
    settings: { ...settings, allowlist: JSON.parse(settings.allowlist) },
    policies: policies.map((p) => ({ ...p, conditions: JSON.parse(p.conditions), stats: stats[p.name] ?? emptyStats() })),
    assets,
  };
}

// Precision de cada politica, medida con los veredictos de cierre de los
// analistas: de los casos que contuvo (o habria contenido, en simulacion),
// cuantos resultaron ataques reales. precision = verdaderos positivos /
// casos cerrados. Es la evidencia para decidir activar, ajustar o apagar
// una politica.
function emptyCounts() {
  return { total: 0, closed: 0, true_positive: 0, benign_positive: 0, false_positive: 0, precision: null };
}

function emptyStats() {
  return { executed: emptyCounts(), simulated: emptyCounts() };
}

async function policyStats(db = prisma) {
  const incidents = await db.incident.findMany({
    where: { automationPolicy: { not: null }, automationDecision: { in: ["executed", "simulated"] } },
    select: { automationPolicy: true, automationDecision: true, verdict: true, closedAt: true },
  });
  const stats = {};
  for (const i of incidents) {
    const counts = (stats[i.automationPolicy] ??= emptyStats())[i.automationDecision];
    counts.total += 1;
    if (i.closedAt && i.verdict) {
      counts.closed += 1;
      counts[i.verdict] += 1;
    }
  }
  for (const s of Object.values(stats)) {
    for (const c of [s.executed, s.simulated]) c.precision = c.closed ? c.true_positive / c.closed : null;
  }
  return stats;
}

// --- utilidades -----------------------------------------------------------

const family = (ip) => (net.isIP(ip) === 6 ? "ipv6" : "ipv4");

// Agrega una entrada de la lista de exclusion (IPv4 o IPv6, exacta o CIDR)
// a un BlockList. false si la entrada no es valida.
// Antes del 16/10 solo se entendia IPv4: una IPv6 de la lista de exclusion
// nunca coincidia y esa IP se bloqueaba igual (el unico caso que fallaba del
// lado inseguro).
function addEntry(list, entry) {
  const value = String(entry ?? "").trim();
  try {
    if (value.includes("/")) {
      const [base, bitsRaw] = value.split("/");
      const bits = Number(bitsRaw);
      if (!net.isIP(base) || !/^\d+$/.test(bitsRaw)) return false;
      list.addSubnet(base, bits, family(base));
      return true;
    }
    if (!net.isIP(value)) return false;
    list.addAddress(value, family(value));
    return true;
  } catch {
    return false; // prefijo fuera de rango, etc.
  }
}

function isValidAllowlistEntry(entry) {
  return addEntry(new net.BlockList(), entry);
}

function ipMatches(ip, entry) {
  if (!ip || !net.isIP(ip)) return false;
  const list = new net.BlockList();
  return addEntry(list, entry) && list.check(ip, family(ip));
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
    failed.push(`país ${ctx.country ?? "n/d"} fuera de ${conditions.fromCountries.join(",")}`);
  }
  if (conditions.maxAssetCriticality && rank(ctx.criticality) > rank(conditions.maxAssetCriticality)) {
    failed.push(`activo ${ctx.criticality} > ${conditions.maxAssetCriticality}`);
  }
  return failed;
}

// Decision pura (sin efectos): { decision, policy, reason }.
// decision: "none" | "simulate" | "execute"
function evaluate({ incident, settings, policies, asset }) {
  if (settings.mode === "off") return { decision: "none", policy: null, reason: "Automatización apagada" };

  const ctx = contextOf(incident, asset, settings.defaultCriticality);
  if (ctx.criticality === "critical") {
    return { decision: "none", policy: null, reason: "Activo crítico: solo respuesta manual" };
  }

  const candidates = policies.filter((p) => p.enabled && p.useCase === ctx.useCase);
  for (const policy of candidates) {
    if (failedConditions(policy.conditions, ctx).length > 0) continue;
    if (policy.action === "block-ip" && settings.allowlist.some((entry) => ipMatches(incident.srcIp, entry))) {
      return { decision: "none", policy, reason: `La IP ${incident.srcIp} está en la lista de exclusión` };
    }
    return {
      decision: settings.mode === "active" ? "execute" : "simulate",
      policy,
      reason: `Coincide la política "${policy.name}"`,
    };
  }

  const tried = candidates.map((p) => `${p.name}: ${failedConditions(p.conditions, ctx).join("; ")}`);
  return { decision: "none", policy: null, reason: tried.length ? `Ninguna política coincide (${tried.join(" | ")})` : "No hay políticas activas para este caso de uso" };
}

// Evalua un incidente recien creado (o recien enriquecido) y actua segun el
// modo. Nunca tira: un error en la automatizacion no debe afectar la ingesta.
async function runAutomation(incidentId) {
  try {
    const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
    // Si un analista ya actuo mientras tanto, no hay nada que decidir.
    if (!incident || incident.status !== "new" || incident.closedAt) return null;

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
        `Simulación: ${ACTION_LABELS[result.policy.action]} en el incidente #${incident.id} (política "${result.policy.name}")`,
        ACTOR,
        incident.id
      );
      return result;
    }

    // Cortacircuitos: limite de "radio de impacto". Si la automatizacion ya
    // ejecuto maxActions acciones en la ventana, se pasa sola a simulacion
    // (hasta que un admin la reactive) y este caso queda para el analista.
    // Una politica mal configurada o una ola de ataques no puede bloquear
    // cientos de IPs o aislar media red sin que una persona lo vea.
    const since = new Date(Date.now() - settings.windowMinutes * 60 * 1000);
    const recent = await prisma.auditEvent.count({
      where: { actor: ACTOR, type: { in: ["ip_blocked", "host_isolated"] }, createdAt: { gte: since } },
    });
    if (recent >= settings.maxActions) {
      await prisma.automationSettings.update({ where: { id: 1 }, data: { mode: "simulate", updatedBy: ACTOR } });
      const why = `cortacircuitos activado: ${recent} acciones automáticas en ${settings.windowMinutes} min (límite ${settings.maxActions}); la automatización pasó a simulación`;
      await prisma.incident.update({
        where: { id: incident.id },
        data: { automationDecision: "simulated", ...record, automationReason: `${result.reason}; ${why}` },
      });
      await logAudit("automation_paused", `Incidente #${incident.id}: ${why}`, ACTOR, incident.id);
      return { ...result, decision: "simulate", paused: true };
    }

    try {
      await mitigate(incident, result.policy.action, ACTOR, {
        auditSuffix: `, automático (política "${result.policy.name}")`,
        extraData: { automationDecision: "executed", ...record },
      });
    } catch (err) {
      // Wazuh rechazo: el incidente queda abierto para el analista.
      await prisma.incident.update({
        where: { id: incident.id },
        data: { automationDecision: "failed", ...record, automationReason: `${result.reason}; Wazuh rechazó la acción: ${err.message}` },
      });
      await logAudit("automation_failed", `Falló el ${ACTION_LABELS[result.policy.action]} automático en el incidente #${incident.id}`, ACTOR, incident.id);
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
  policyStats,
  isValidAllowlistEntry,
  ipMatches,
  failedConditions,
  evaluate,
  runAutomation,
};
