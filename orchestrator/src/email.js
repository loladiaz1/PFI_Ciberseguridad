// CU-03: ingesta de correos de phishing.
//
// Todas las fuentes terminan en el mismo "reporte" canonico y en
// ingestReport():
//   - hoy: un usuario reenvia el correo sospechoso COMO ADJUNTO (.eml) al
//     buzon de reportes (phishing@), igual que el boton "Report phishing" de
//     Outlook / Gmail. El orchestrator lo lee por IMAP cada pocos segundos.
//   - futuro: el antispam (Rspamd) lo detecta y llega por Wazuh al webhook,
//     con source "gateway" y su puntaje.
// La clave del caso es el Message-ID: el mismo correo tiene el mismo
// Message-ID en todos los buzones, en todos los reportes y en el log del
// antispam. Varios reportes del mismo correo = un solo incidente.
const { prisma } = require("./db");
const { logAudit } = require("./audit");
const { mergeTags, USE_CASE_TAG } = require("./closure");
const { enrichUrl, enrichFile } = require("./enrichment");
const { runAutomation } = require("./automation");
const mailProvider = require("./mailProvider");
const { parseReport } = require("./emailParse");
const { searchSimilar, findOpenCampaign } = require("./campaign");

const REPORT_RULE_ID = "user-report";
// Un reporte sin confirmar es severidad media; si VirusTotal marca una URL o
// un adjunto, alta. Desde MIN_ENGINES motores: uno solo suele ser un falso
// positivo de ese motor.
const REPORTED_SEVERITY = 6;
const MALICIOUS_SEVERITY = 12;
const MIN_ENGINES = 3;
// Consultas a VT por correo (cuota gratuita: 4 por minuto).
const MAX_LOOKUPS = 3;

function reportAlert(incidentId, report, severity) {
  return {
    incidentId,
    ruleId: REPORT_RULE_ID,
    ruleDescription: "Correo reportado como phishing",
    severity,
    timestamp: report.receivedAt.toISOString(),
    detail: report.reporter ? `Reportado por ${report.reporter}` : null,
  };
}

// Reputacion de los adjuntos y las URLs (primero los adjuntos: un hash
// conocido es mas concluyente). Actualiza el correo y sube la severidad.
async function enrichEmail(incidentId, email) {
  const attachments = JSON.parse(email.attachments);
  const urls = JSON.parse(email.urls).map((url) => ({ url }));
  let budget = MAX_LOOKUPS;
  for (const a of attachments) a.vtMalicious = budget-- > 0 ? await enrichFile(a.sha256) : null;
  for (const u of urls) u.vtMalicious = budget-- > 0 ? await enrichUrl(u.url) : null;

  const worst = Math.max(0, ...[...attachments, ...urls].map((x) => x.vtMalicious ?? 0));
  await prisma.incidentEmail.update({
    where: { id: email.id },
    data: { attachments: JSON.stringify(attachments), urls: JSON.stringify(urls) },
  });
  if (worst >= MIN_ENGINES) {
    await prisma.incident.update({ where: { id: incidentId }, data: { severity: MALICIOUS_SEVERITY, hashPositives: worst } });
  }
}

// Correo reportado tal como se guarda en IncidentEmail.
function emailRecord(report) {
  return {
    messageId: report.messageId,
    fromAddress: report.fromAddress,
    replyTo: report.replyTo,
    subject: report.subject,
    sentAt: report.sentAt,
    sendingIp: report.sendingIp,
    urls: JSON.stringify(report.urls),
    attachments: JSON.stringify(report.attachments),
    origin: "reported",
    reportedBy: JSON.stringify(report.reporter ? [report.reporter] : []),
  };
}

// Crea el incidente o suma el reporte al incidente abierto del mismo correo
// (mismo Message-ID) o de la misma campana (indicadores en comun).
// Devuelve { incident, created }.
async function ingestReport(report) {
  const now = new Date();
  const open = await prisma.incidentEmail.findFirst({
    where: { messageId: report.messageId, incident: { closedAt: null } },
    include: { incident: true },
    orderBy: { id: "desc" },
  });

  if (open) {
    const reporters = JSON.parse(open.reportedBy);
    if (report.reporter && !reporters.includes(report.reporter)) reporters.push(report.reporter);
    // Si la busqueda de similares ya lo habia encontrado, ahora esta confirmado.
    await prisma.incidentEmail.update({
      where: { id: open.id },
      data: { reportedBy: JSON.stringify(reporters), ...(open.origin === "candidate" ? { origin: "reported" } : {}) },
    });
    const incident = await prisma.incident.update({
      where: { id: open.incidentId },
      data: { alertCount: open.incident.alertCount + 1, lastSeenAt: now },
    });
    await prisma.incidentAlert.create({ data: reportAlert(incident.id, report, incident.severity) });
    await logAudit("alert_grouped", `Nuevo reporte de ${report.reporter ?? "un usuario"} sumado al incidente #${incident.id}`, null, incident.id);
    return { incident, created: false };
  }

  // Otro Message-ID, pero la misma campana (src/campaign.js): se suma como
  // otro correo confirmado del incidente abierto, en vez de abrir otro caso.
  const campaign = await findOpenCampaign(report);
  if (campaign) {
    const email = await prisma.incidentEmail.create({
      data: { incidentId: campaign.incident.id, ...emailRecord(report), matchedBy: JSON.stringify(campaign.match) },
    });
    const incident = await prisma.incident.update({
      where: { id: campaign.incident.id },
      data: { alertCount: campaign.incident.alertCount + 1, lastSeenAt: now },
    });
    await prisma.incidentAlert.create({ data: reportAlert(incident.id, report, incident.severity) });
    await logAudit(
      "alert_grouped",
      `Otro correo de la campaña reportado por ${report.reporter ?? "un usuario"}: "${report.subject ?? "(sin asunto)"}" (incidente #${incident.id})`,
      null,
      incident.id
    );
    const enrichment = enrichEmail(incident.id, email).catch((err) => console.error("No se pudo enriquecer el correo:", err.message));
    if (process.env.AUTOMATION_INLINE === "1") await enrichment;
    return { incident, created: false };
  }

  const incident = await prisma.incident.create({
    data: {
      source: report.source,
      useCase: "CU-03",
      ruleId: REPORT_RULE_ID,
      ruleIds: JSON.stringify([REPORT_RULE_ID]),
      severity: REPORTED_SEVERITY,
      ruleDescription: `Phishing reportado: ${report.subject ?? "(sin asunto)"}`,
      srcIp: null,
      // El activo afectado es el servidor de correo (inventario de activos).
      hostname: process.env.MAIL_HOSTNAME || "micro-soar-mail",
      agentId: process.env.MAIL_AGENT_ID || "mail",
      timestamp: report.receivedAt.toISOString(),
      ingestedAt: now,
      lastSeenAt: now,
      tags: mergeTags([], [USE_CASE_TAG["CU-03"]]),
      emails: { create: emailRecord(report) },
    },
    include: { emails: true },
  });
  await prisma.incidentAlert.create({ data: reportAlert(incident.id, report, REPORTED_SEVERITY) });
  await logAudit(
    "incident_detected",
    `Correo reportado por ${report.reporter ?? "un usuario"}: "${report.subject ?? "(sin asunto)"}" de ${report.fromAddress ?? "remitente desconocido"}`,
    null,
    incident.id
  );

  // Igual que CU-01: enriquecer y despues decidir la automatizacion, sin
  // frenar la ingesta (en los tests, en linea). Despues, la busqueda de
  // correos similares de la campana (la cuarentena de esos la decide el
  // analista: nunca automatica).
  const followUp = enrichEmail(incident.id, incident.emails[0])
    .catch((err) => console.error("No se pudo enriquecer el correo:", err.message))
    .then(() => runAutomation(incident.id))
    .then(() => searchSimilar(incident.id).catch((err) => console.error("No se pudo buscar correos similares:", err.message)));
  if (process.env.AUTOMATION_INLINE === "1") await followUp;

  const { emails, ...rest } = incident;
  return { incident: rest, created: true };
}

// Una pasada por el buzon de reportes. Nunca tira. Si ya hay una en curso,
// se repite al terminar (un aviso de IDLE que llega en el medio no se pierde).
let polling = false;
let pending = false;
async function pollReports() {
  if (!mailProvider.isEnabled()) return 0;
  if (polling) {
    pending = true;
    return 0;
  }
  polling = true;
  try {
    return await mailProvider.fetchReports(async (raw, receivedAt) => ingestReport(await parseReport(raw, receivedAt)));
  } catch (err) {
    console.error("No se pudo leer el buzón de reportes:", err.message);
    return 0;
  } finally {
    polling = false;
    if (pending) {
      pending = false;
      setImmediate(pollReports);
    }
  }
}

// Detección: IMAP IDLE avisa al instante cuando llega un reporte. El
// chequeo periódico queda solo como red de seguridad (si IDLE se cae).
// Hasta el 18/10 era solo el chequeo cada 15 s: la medición de CU-03 dio
// detección p50 6,8 s / p95 11,8 s, fuera de la cota de RNF-05 (5 s).
const SAFETY_POLL_MS = 60 * 1000;

function startReportPolling() {
  if (!mailProvider.isEnabled()) return null;
  console.log("CU-03: buzón de reportes por IMAP IDLE (chequeo de respaldo cada", SAFETY_POLL_MS / 1000, "s)");
  mailProvider.watchReports(() => pollReports());
  return setInterval(pollReports, SAFETY_POLL_MS);
}

module.exports = { parseReport, ingestReport, pollReports, startReportPolling, REPORT_RULE_ID };
