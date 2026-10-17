const { prisma } = require("./db");

// Categorias de la auditoria, derivadas del tipo de evento (no se guardan:
// asi los eventos anteriores tambien quedan clasificados).
const CATEGORIES = {
  access: ["login", "user_registered"],
  users: ["user_updated", "user_removed", "account_deleted"],
  incidents: ["incident_detected", "alert_grouped", "incident_closed", "incident_reopened"],
  response: ["ip_blocked", "host_isolated", "email_quarantined", "email_restored", "mitigation_failed"],
  automation: ["automation_simulated", "automation_failed", "automation_updated", "automation_paused"],
};

function categoryOf(type) {
  return Object.keys(CATEGORIES).find((c) => CATEGORIES[c].includes(type)) ?? "other";
}

// Registro de auditoria. actor va separado del texto (no "<username> hizo X")
// para poder seudonimizarlo al eliminar la cuenta (ver src/privacy.js).
// actor = username, "automation" (src/automation.js) o null (sistema).
// incidentId vincula el evento a su incidente (linea de tiempo del caso).
// Nunca tira: una falla de la auditoria no debe cortar el flujo principal.
function logAudit(type, detail, actor = null, incidentId = null) {
  return prisma.auditEvent.create({ data: { type, detail, actor, incidentId } }).catch((err) => {
    console.error("No se pudo registrar el evento de auditoria:", err.message);
  });
}

// Vincula a su incidente los eventos anteriores al campo incidentId, que lo
// mencionaban solo en el texto ("... incident #12"). Idempotente; corre al
// arrancar el servidor.
async function backfillIncidentIds(db = prisma) {
  const legacy = await db.auditEvent.findMany({
    where: { incidentId: null, detail: { contains: "incident #" } },
    select: { id: true, detail: true },
  });
  let linked = 0;
  for (const event of legacy) {
    const match = /incident #(\d+)/.exec(event.detail);
    if (!match) continue;
    await db.auditEvent.update({ where: { id: event.id }, data: { incidentId: Number(match[1]) } });
    linked += 1;
  }
  return linked;
}

module.exports = { CATEGORIES, categoryOf, logAudit, backfillIncidentIds };
