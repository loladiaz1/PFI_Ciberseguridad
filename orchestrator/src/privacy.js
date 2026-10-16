// Proteccion de datos personales (Ley 25.326, Argentina).
//
// Datos personales que trata el sistema:
//   - del analista: username, nombre y email (perfil) y su rastro en la
//     auditoria (que acciones ejecuto y cuando);
//   - de terceros: la IP de origen de un ataque (incidentes, enriquecimiento
//     y detalle de auditoria). Una IP puede identificar a una persona.
//
// Dos mecanismos:
//   1) Supresion (art. 16): al eliminar la cuenta se borra el perfil y el
//      rastro de auditoria se SEUDONIMIZA en vez de borrarse -- la traza de
//      que se bloqueo una IP o se aislo un host se conserva (art. 9,
//      seguridad de los datos / RNF-09), pero deja de identificar a la persona.
//   2) Retencion (art. 4 inc. 7: los datos se destruyen cuando dejan de ser
//      necesarios): pasado el plazo, las IPs de origen se enmascaran (red /24)
//      y se descarta el enriquecimiento, que solo describe a esa IP.
const crypto = require("crypto");

const DEFAULT_RETENTION_DAYS = 90;

// Seudonimo estable y no reversible: el mismo usuario da siempre el mismo
// seudonimo (los eventos siguen agrupados), pero sin el secreto del servidor
// no se puede volver al username.
function pseudonymize(username) {
  const hash = crypto
    .createHmac("sha256", process.env.JWT_SECRET || "")
    .update(username)
    .digest("hex")
    .slice(0, 8);
  return `usuario-eliminado-${hash}`;
}

// 203.0.113.55 -> 203.0.113.0/24 ; IPv6 -> su /64. Conserva el valor
// estadistico (de que red vino el ataque) sin identificar al host.
function maskIp(ip) {
  if (!ip) return ip;
  if (ip.endsWith("/24") || ip.endsWith("::/64")) return ip; // ya enmascarada
  if (ip.includes(".")) {
    const parts = ip.split(".");
    return `${parts.slice(0, 3).join(".")}.0/24`;
  }
  return `${ip.split(":").slice(0, 4).join(":")}::/64`;
}

const IPV4_IN_TEXT = /\b(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}\b(?!\/)/g;

function maskIpsInText(text) {
  return text.replace(IPV4_IN_TEXT, "$1.0/24");
}

// Elimina el perfil y seudonimiza la auditoria del usuario, todo o nada.
async function deleteAccount(prisma, username) {
  const pseudonym = pseudonymize(username);
  await prisma.$transaction(async (tx) => {
    await tx.user.deleteMany({ where: { username } });
    await tx.auditEvent.updateMany({ where: { actor: username }, data: { actor: pseudonym } });
    await tx.incident.updateMany({ where: { closedBy: username }, data: { closedBy: pseudonym } });
    // Eventos anteriores al campo "actor" llevaban el username en el texto
    // ("<username> logged in").
    const legacy = await tx.auditEvent.findMany({ where: { detail: { startsWith: `${username} ` } } });
    for (const event of legacy) {
      await tx.auditEvent.update({
        where: { id: event.id },
        data: { detail: pseudonym + event.detail.slice(username.length) },
      });
    }
    await tx.auditEvent.create({
      data: { type: "account_deleted", detail: "Cuenta eliminada (datos personales borrados)", actor: pseudonym },
    });
  });
  return pseudonym;
}

// Aplica la politica de retencion. Idempotente: correrla dos veces no cambia
// nada la segunda vez. dryRun: solo cuenta, no modifica.
async function applyRetention(prisma, { days = DEFAULT_RETENTION_DAYS, now = new Date(), dryRun = false } = {}) {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  // timestamp es string ISO de Wazuh: se filtra en JS, no en SQL.
  const candidates = await prisma.incident.findMany({
    where: { srcIp: { not: null } },
    select: { id: true, srcIp: true, timestamp: true },
  });
  const expired = candidates.filter(
    (i) => new Date(i.timestamp) < cutoff && maskIp(i.srcIp) !== i.srcIp
  );
  for (const incident of dryRun ? [] : expired) {
    await prisma.incident.update({
      where: { id: incident.id },
      data: { srcIp: maskIp(incident.srcIp), enrichmentVt: null, enrichmentAbuseIpdb: null },
    });
  }

  const oldAlerts = await prisma.incidentAlert.findMany({
    where: { srcIp: { not: null } },
    select: { id: true, srcIp: true, timestamp: true },
  });
  const expiredAlerts = oldAlerts.filter((a) => new Date(a.timestamp) < cutoff && maskIp(a.srcIp) !== a.srcIp);
  for (const alert of dryRun ? [] : expiredAlerts) {
    await prisma.incidentAlert.update({ where: { id: alert.id }, data: { srcIp: maskIp(alert.srcIp) } });
  }

  const oldEvents = await prisma.auditEvent.findMany({ where: { createdAt: { lt: cutoff } } });
  let auditMasked = 0;
  for (const event of oldEvents) {
    const masked = maskIpsInText(event.detail);
    if (masked !== event.detail) {
      if (!dryRun) await prisma.auditEvent.update({ where: { id: event.id }, data: { detail: masked } });
      auditMasked += 1;
    }
  }

  return { cutoff, incidentsMasked: expired.length, alertsMasked: expiredAlerts.length, auditMasked };
}

module.exports = {
  DEFAULT_RETENTION_DAYS,
  pseudonymize,
  maskIp,
  maskIpsInText,
  deleteAccount,
  applyRetention,
};
