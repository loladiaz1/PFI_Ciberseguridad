const { prisma } = require("./db");
const { authenticate, blockIp, isolateHost } = require("./wazuh");
const { logAudit } = require("./audit");

// Ejecucion de las acciones de contencion, compartida por el analista
// (endpoints de app.js) y por la automatizacion (src/automation.js): misma
// llamada a Wazuh, misma medicion y misma auditoria, cambia solo el actor.
const ACTIONS = {
  "block-ip": {
    run: (token, incident) => blockIp(process.env.WAZUH_HOST, token, incident.agentId, incident.srcIp),
    done: () => ({ status: "blocked", blockedAt: new Date() }),
    audit: (i) => ["ip_blocked", `Blocked ${i.srcIp} (incident #${i.id})`],
  },
  "isolate-host": {
    run: (token, incident) => isolateHost(process.env.WAZUH_HOST, token, incident.agentId),
    done: () => ({ status: "isolated", isolatedAt: new Date() }),
    audit: (i) => ["host_isolated", `Isolated ${i.hostname} (incident #${i.id})`],
  },
};

// Tira si Wazuh rechaza la accion (el incidente queda sin tocar).
// actionLatencyMs: login a la API + ejecucion, lo que tarda la contencion
// una vez decidida (RNF-05, ver src/metrics.js). extraData: campos extra
// a guardar junto con la mitigacion (ej. la decision de la automatizacion).
async function mitigate(incident, actionName, actor, { auditSuffix = "", extraData = {} } = {}) {
  const action = ACTIONS[actionName];
  const startedAt = Date.now();
  const token = await authenticate(process.env.WAZUH_HOST, process.env.WAZUH_USER, process.env.WAZUH_PASSWORD);
  await action.run(token, incident);

  const updated = await prisma.incident.update({
    where: { id: incident.id },
    data: { ...action.done(), actionLatencyMs: Date.now() - startedAt, ...extraData },
  });
  const [type, detail] = action.audit(updated);
  await logAudit(type, detail + auditSuffix, actor);
  return updated;
}

module.exports = { mitigate, ACTIONS };
