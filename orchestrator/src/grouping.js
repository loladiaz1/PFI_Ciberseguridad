// Agrupamiento de alertas en incidentes (triaje).
//
// Un mismo ataque dispara varias reglas de Wazuh: una fuerza bruta SSH genera
// 5712 (sshd) y 5551 (PAM) casi al mismo tiempo, y antes eso eran dos
// incidentes -- el analista mitigaba uno y el otro quedaba abierto (campana
// de medicion del 14/10, ver docs/metricas-campana-2026-10-14.md).
//
// Criterio: una alerta se suma a un incidente existente si es del mismo
// agente y la misma IP de origen (null para CU-02: mismo host infectado), el
// incidente sigue abierto ("new") y tuvo actividad dentro de la ventana. Si
// ya se mitigo, la alerta nueva es un intento POSTERIOR a la contencion y
// abre otro incidente, para que se vea.
const DEFAULT_WINDOW_MS = 10 * 60 * 1000;

// GROUP_WINDOW_MS=0 desactiva el agrupamiento (lo usan los tests que
// necesitan un incidente nuevo por alerta).
function groupWindowMs() {
  const raw = process.env.GROUP_WINDOW_MS;
  return raw === undefined || raw === "" ? DEFAULT_WINDOW_MS : Number(raw);
}

async function findOpenIncident(prisma, fields, now = new Date()) {
  const windowMs = groupWindowMs();
  if (!(windowMs > 0)) return null;

  return prisma.incident.findFirst({
    where: {
      status: "new",
      agentId: fields.agentId,
      srcIp: fields.srcIp,
      lastSeenAt: { gte: new Date(now.getTime() - windowMs) },
    },
    orderBy: { id: "desc" },
  });
}

function ruleIdsOf(incident) {
  return incident.ruleIds ? JSON.parse(incident.ruleIds) : [incident.ruleId];
}

// Datos para sumar la alerta al incidente: contador, reglas sin repetir,
// ultima actividad y la severidad mas alta vista.
function mergeAlert(incident, fields, now = new Date()) {
  const ruleIds = ruleIdsOf(incident);
  if (!ruleIds.includes(fields.ruleId)) ruleIds.push(fields.ruleId);
  return {
    alertCount: incident.alertCount + 1,
    ruleIds: JSON.stringify(ruleIds),
    lastSeenAt: now,
    severity: Math.max(incident.severity, fields.severity),
  };
}

module.exports = { DEFAULT_WINDOW_MS, groupWindowMs, findOpenIncident, mergeAlert, ruleIdsOf };
