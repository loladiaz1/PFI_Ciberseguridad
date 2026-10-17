const { prisma } = require("./db");
const { authenticate, blockIp, isolateHost } = require("./wazuh");
const { logAudit } = require("./audit");
const { ACTION_TAG, tagsOf, mergeTags } = require("./closure");
const { quarantineEmails } = require("./emailActions");

// Ejecucion de las acciones de contencion, compartida por el analista
// (endpoints de app.js) y por la automatizacion (src/automation.js): misma
// ejecucion, misma medicion y misma auditoria, cambia solo el actor.
// CU-01 y CU-02 van por la API de Wazuh; CU-03 por el servidor de correo.
const wazuhToken = () => authenticate(process.env.WAZUH_HOST, process.env.WAZUH_USER, process.env.WAZUH_PASSWORD);

const ACTIONS = {
  "block-ip": {
    run: async (incident) => blockIp(process.env.WAZUH_HOST, await wazuhToken(), incident.agentId, incident.srcIp),
    done: () => ({ status: "blocked", blockedAt: new Date() }),
    audit: (i) => ["ip_blocked", `Bloqueo de ${i.srcIp} (incidente #${i.id})`],
  },
  "isolate-host": {
    run: async (incident) => isolateHost(process.env.WAZUH_HOST, await wazuhToken(), incident.agentId),
    done: () => ({ status: "isolated", isolatedAt: new Date() }),
    audit: (i) => ["host_isolated", `Aislamiento de ${i.hostname} (incidente #${i.id})`],
  },
  "quarantine-email": {
    run: (incident, options) => quarantineEmails(incident, options.messageIds),
    // Si se restauro y se vuelve a poner en cuarentena, la contencion sigue
    // siendo la primera (metricas).
    done: (incident) => ({ status: "quarantined", quarantinedAt: incident.quarantinedAt ?? new Date() }),
    audit: (i, r) => ["email_quarantined", `Cuarentena de ${r.emails} correo(s) en ${r.mailboxes} buzón(es) (incidente #${i.id})`],
  },
};

// Tira si la accion falla (el incidente queda sin tocar).
// actionLatencyMs: lo que tarda la contencion una vez decidida (login a la
// API + ejecucion; RNF-05, ver src/metrics.js). extraData: campos extra a
// guardar junto con la mitigacion (ej. la decision de la automatizacion).
// options: parametros de la accion (ej. messageIds para la cuarentena).
async function mitigate(incident, actionName, actor, { auditSuffix = "", extraData = {}, options = {} } = {}) {
  const action = ACTIONS[actionName];
  const startedAt = Date.now();
  const result = await action.run(incident, options);

  const updated = await prisma.incident.update({
    where: { id: incident.id },
    data: {
      ...action.done(incident),
      actionLatencyMs: Date.now() - startedAt,
      tags: mergeTags(tagsOf(incident), [ACTION_TAG[actionName]]),
      ...extraData,
    },
  });
  const [type, detail] = action.audit(updated, result);
  await logAudit(type, detail + auditSuffix, actor, updated.id);
  return updated;
}

module.exports = { mitigate, ACTIONS };
