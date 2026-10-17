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
const crypto = require("crypto");
const { simpleParser } = require("mailparser");
const { prisma } = require("./db");
const { logAudit } = require("./audit");
const { mergeTags, USE_CASE_TAG } = require("./closure");
const { enrichUrl, enrichFile } = require("./enrichment");
const { runAutomation } = require("./automation");
const mailProvider = require("./mailProvider");

const REPORT_RULE_ID = "user-report";
// Un reporte sin confirmar es severidad media; si VirusTotal marca una URL o
// un adjunto, alta. Desde MIN_ENGINES motores: uno solo suele ser un falso
// positivo de ese motor.
const REPORTED_SEVERITY = 6;
const MALICIOUS_SEVERITY = 12;
const MIN_ENGINES = 3;
// Consultas a VT por correo (cuota gratuita: 4 por minuto).
const MAX_LOOKUPS = 3;
const MAX_URLS = 20;

const addressOf = (field) => field?.value?.[0]?.address?.toLowerCase() ?? null;
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

function urlsOf(mail) {
  const text = `${mail.text ?? ""} ${typeof mail.html === "string" ? mail.html : ""}`;
  const found = text.match(/https?:\/\/[^\s"'<>]+/gi) ?? [];
  const clean = found.map((u) => u.replace(/[).,;]+$/, ""));
  return [...new Set(clean)].slice(0, MAX_URLS);
}

// IP del servidor que entrego el correo: la primera que no sea local en los
// encabezados Received (el de arriba es el ultimo salto).
function sendingIpOf(mail) {
  const received = [].concat(mail.headers.get("received") ?? []);
  for (const header of received) {
    const match = /\[(\d{1,3}(?:\.\d{1,3}){3})\]/.exec(String(header));
    if (match && !match[1].startsWith("127.")) return match[1];
  }
  return null;
}

// Reporte crudo (el correo que llega a phishing@) -> reporte canonico. Tira
// si no trae el original adjunto: sin el Message-ID no se lo puede buscar en
// los buzones.
async function parseReport(raw, receivedAt = new Date()) {
  const outer = await simpleParser(raw);
  const attached = outer.attachments.find((a) => a.contentType === "message/rfc822");
  if (!attached) throw new Error("El reporte no trae el correo original adjunto (.eml)");

  const original = await simpleParser(attached.content);
  if (!original.messageId) throw new Error("El correo original no tiene Message-ID");

  return {
    source: "user_report",
    reporter: addressOf(outer.from),
    receivedAt: new Date(receivedAt),
    messageId: original.messageId,
    fromAddress: addressOf(original.from),
    replyTo: addressOf(original.replyTo),
    subject: original.subject ?? null,
    sentAt: original.date ?? null,
    sendingIp: sendingIpOf(original),
    urls: urlsOf(original),
    attachments: original.attachments.map((a) => ({ name: a.filename ?? null, sha256: sha256(a.content), size: a.size })),
  };
}

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

// Crea el incidente o suma el reporte al incidente abierto del mismo correo.
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
    await prisma.incidentEmail.update({ where: { id: open.id }, data: { reportedBy: JSON.stringify(reporters) } });
    const incident = await prisma.incident.update({
      where: { id: open.incidentId },
      data: { alertCount: open.incident.alertCount + 1, lastSeenAt: now },
    });
    await prisma.incidentAlert.create({ data: reportAlert(incident.id, report, incident.severity) });
    await logAudit("alert_grouped", `Nuevo reporte de ${report.reporter ?? "un usuario"} sumado al incidente #${incident.id}`, null, incident.id);
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
      emails: {
        create: {
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
        },
      },
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
  // frenar la ingesta (en los tests, en linea).
  const followUp = enrichEmail(incident.id, incident.emails[0])
    .catch((err) => console.error("No se pudo enriquecer el correo:", err.message))
    .then(() => runAutomation(incident.id));
  if (process.env.AUTOMATION_INLINE === "1") await followUp;

  const { emails, ...rest } = incident;
  return { incident: rest, created: true };
}

// Una pasada por el buzon de reportes. Nunca tira (corre en un intervalo).
let polling = false;
async function pollReports() {
  if (polling || !mailProvider.isEnabled()) return 0;
  polling = true;
  try {
    return await mailProvider.fetchReports(async (raw, receivedAt) => ingestReport(await parseReport(raw, receivedAt)));
  } catch (err) {
    console.error("No se pudo leer el buzón de reportes:", err.message);
    return 0;
  } finally {
    polling = false;
  }
}

const POLL_INTERVAL_MS = 15 * 1000;

function startReportPolling() {
  if (!mailProvider.isEnabled()) return null;
  console.log("CU-03: leyendo el buzón de reportes cada", POLL_INTERVAL_MS / 1000, "s");
  return setInterval(pollReports, POLL_INTERVAL_MS);
}

module.exports = { parseReport, ingestReport, pollReports, startReportPolling, REPORT_RULE_ID };
