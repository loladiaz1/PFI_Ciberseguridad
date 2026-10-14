const { prisma } = require("./db");

// Registro de auditoria. actor va separado del texto (no "<username> hizo X")
// para poder seudonimizarlo al eliminar la cuenta (ver src/privacy.js).
// actor = username, "automation" (src/automation.js) o null (sistema).
// Nunca tira: una falla de la auditoria no debe cortar el flujo principal.
function logAudit(type, detail, actor = null) {
  return prisma.auditEvent.create({ data: { type, detail, actor } }).catch((err) => {
    console.error("No se pudo registrar el evento de auditoria:", err.message);
  });
}

module.exports = { logAudit };
