// Cuarentena y restauracion de los correos de una campana (CU-03). Actuan
// sobre todos los correos del incidente, o solo sobre los elegidos
// (messageIds = ids de IncidentEmail): la misma accion en bloque sirve hoy
// para el correo reportado y manana para los similares que encuentre la
// busqueda. La llamada al servidor de correo esta en src/mailProvider.js.
const { prisma } = require("./db");
const mailProvider = require("./mailProvider");

const json = (value) => JSON.parse(value || "[]");

function ensureEnabled() {
  if (!mailProvider.isEnabled()) throw new Error("La integración con el servidor de correo no está configurada");
}

// Sin messageIds: todos los del incidente. Para la cuarentena, menos los
// candidatos de la busqueda de similares: solo entran si el analista los elige.
function emailsOf(incidentId, statuses, messageIds, { withCandidates = false } = {}) {
  const which = messageIds ? { id: { in: messageIds } } : withCandidates ? {} : { origin: { not: "candidate" } };
  return prisma.incidentEmail.findMany({ where: { incidentId, status: { in: statuses }, ...which } });
}

// Devuelve { emails, mailboxes } (cuantos correos y en cuantos buzones). Tira
// si no hay nada que poner en cuarentena o si no aparece en ningun buzon (por
// ejemplo, los usuarios ya lo borraron): el analista tiene que saberlo.
async function quarantineEmails(incident, messageIds) {
  ensureEnabled();
  const emails = await emailsOf(incident.id, ["pending", "restored"], messageIds);
  if (emails.length === 0) throw new Error("No hay correos pendientes de cuarentena en este incidente");

  const mailboxes = new Set();
  let quarantined = 0;
  for (const email of emails) {
    const found = await mailProvider.quarantine(email.messageId);
    if (found.length === 0) continue;
    found.forEach((m) => mailboxes.add(m));
    quarantined += 1;
    await prisma.incidentEmail.update({
      where: { id: email.id },
      data: { status: "quarantined", quarantinedAt: new Date(), mailboxes: JSON.stringify(found) },
    });
  }
  if (quarantined === 0) throw new Error("No se encontró el correo en ningún buzón");
  return { emails: quarantined, mailboxes: mailboxes.size };
}

// Vuelve los correos a la bandeja de entrada (falso positivo, o un correo
// legitimo que entro en la campana). Devuelve { emails, mailboxes, remaining }
// (remaining = cuantos siguen en cuarentena).
async function restoreEmails(incident, messageIds) {
  ensureEnabled();
  const emails = await emailsOf(incident.id, ["quarantined"], messageIds, { withCandidates: true });
  if (emails.length === 0) throw new Error("No hay correos en cuarentena en este incidente");

  const mailboxes = new Set();
  for (const email of emails) {
    const found = await mailProvider.restore(email.messageId);
    found.forEach((m) => mailboxes.add(m));
    await prisma.incidentEmail.update({ where: { id: email.id }, data: { status: "restored", restoredAt: new Date() } });
  }
  const remaining = await prisma.incidentEmail.count({ where: { incidentId: incident.id, status: "quarantined" } });
  return { emails: emails.length, mailboxes: mailboxes.size, remaining };
}

// Descarta un candidato de la busqueda de similares ("no es de la campana").
// Queda registrado: junto con el veredicto del caso, mide la precision de la
// busqueda.
async function dismissCandidate(incident, emailId) {
  const email = await prisma.incidentEmail.findFirst({ where: { id: emailId, incidentId: incident.id } });
  if (!email) return { error: 404, detail: "Correo no encontrado en este incidente" };
  if (email.origin !== "candidate" || email.status !== "pending") {
    return { error: 409, detail: "Solo se descarta un candidato pendiente" };
  }
  return { email: await prisma.incidentEmail.update({ where: { id: email.id }, data: { status: "dismissed" } }) };
}

// IncidentEmail con los campos JSON ya parseados (para la API).
function publicEmail(email) {
  return {
    ...email,
    urls: json(email.urls),
    attachments: json(email.attachments),
    matchedBy: email.matchedBy ? JSON.parse(email.matchedBy) : null,
    reportedBy: json(email.reportedBy),
    mailboxes: json(email.mailboxes),
  };
}

module.exports = { quarantineEmails, restoreEmails, dismissCandidate, publicEmail };
