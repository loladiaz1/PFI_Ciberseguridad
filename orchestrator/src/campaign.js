// CU-03: busqueda de correos similares de una campana de phishing.
//
// Una campana masiva cambia asunto y remitente entre envios, pero reutiliza
// su infraestructura: el mismo adjunto, los mismos enlaces o dominios, la
// misma direccion para que le respondan. A partir de los correos confirmados
// del incidente (los reportados) se sacan esos indicadores y se buscan en los
// buzones correos recientes que los compartan. Lo que aparece queda como
// CANDIDATO: un analista decide que se pone en cuarentena (un falso positivo
// aca saca correo legitimo de varias personas), nunca la automatizacion.
const { prisma } = require("./db");
const { logAudit } = require("./audit");
const mailProvider = require("./mailProvider");
const { describeMessage } = require("./emailParse");

const WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
// Peso de cada indicador: uno fuerte (3) alcanza solo; los medios (2) y
// debiles (1) necesitan sumar con otro. Cuenta una vez por tipo.
const WEIGHTS = { attachment: 3, url: 3, urlDomain: 3, replyTo: 3, sendingIp: 3, from: 2, fromDomain: 1, subject: 1 };
const THRESHOLD = 3;
// Dominios que no sirven para relacionar correos: los usa todo el mundo.
const COMMON_DOMAINS = [
  "gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "google.com", "microsoft.com", "office.com",
  "apple.com", "linkedin.com", "facebook.com", "youtube.com", "bit.ly", "t.co", "tinyurl.com",
];

const hostOf = (url) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};
const domainOfAddress = (address) => address?.split("@")[1]?.toLowerCase() ?? null;

// El dominio propio (el del buzon de reportes) y los comunes, mas los que se
// agreguen en MAIL_HUNT_EXCLUDE (separados por coma).
function excludedDomains() {
  const own = domainOfAddress(process.env.MAIL_REPORT_MAILBOX);
  const extra = (process.env.MAIL_HUNT_EXCLUDE || "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
  return [...COMMON_DOMAINS, ...extra, ...(own ? [own] : [])];
}

const isExcluded = (domain, excluded) => !domain || excluded.some((d) => domain === d || domain.endsWith(`.${d}`));

// "RE: Factura #4411 vencida" y "Factura #9902 vencida" -> "factura ## vencida".
function normalizeSubject(subject) {
  if (!subject) return null;
  const s = subject.toLowerCase().replace(/^((re|fw|fwd|rv)\s*:\s*)+/, "").replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
  return s.length >= 8 ? s : null;
}

// Correos (filas de IncidentEmail o salida de describeMessage) -> indicadores.
function indicatorsOf(emails, excluded) {
  const iocs = Object.fromEntries(Object.keys(WEIGHTS).map((k) => [k, new Set()]));
  for (const e of emails) {
    for (const a of e.attachments) iocs.attachment.add(a.sha256);
    for (const u of e.urls) {
      const url = typeof u === "string" ? u : u.url;
      iocs.url.add(url);
      const host = hostOf(url);
      if (!isExcluded(host, excluded)) iocs.urlDomain.add(host);
    }
    if (e.replyTo && !isExcluded(domainOfAddress(e.replyTo), excluded)) iocs.replyTo.add(e.replyTo);
    if (e.sendingIp) iocs.sendingIp.add(e.sendingIp);
    if (e.fromAddress && !isExcluded(domainOfAddress(e.fromAddress), excluded)) {
      iocs.from.add(e.fromAddress);
      iocs.fromDomain.add(domainOfAddress(e.fromAddress));
    }
    const subject = normalizeSubject(e.subject);
    if (subject) iocs.subject.add(subject);
  }
  return iocs;
}

// En que coincide un correo con la campana y cuanto suma. Devuelve
// { score, reasons: [{ type, value }] }.
function matchOf(campaign, message, excluded) {
  const own = indicatorsOf([message], excluded);
  const reasons = [];
  for (const type of Object.keys(WEIGHTS)) {
    for (const value of own[type]) if (campaign[type].has(value)) reasons.push({ type, value });
  }
  const types = new Set(reasons.map((r) => r.type));
  const score = [...types].reduce((sum, t) => sum + WEIGHTS[t], 0);
  return { score, reasons };
}

const asRow = (email) => ({ ...email, urls: JSON.parse(email.urls), attachments: JSON.parse(email.attachments) });

// Indicadores que alcanzan solos (peso 3).
const STRONG = Object.keys(WEIGHTS).filter((t) => WEIGHTS[t] >= THRESHOLD);

// Campana abierta a la que pertenece un correo reportado con otro Message-ID
// (otra variante: otro asunto o remitente, misma infraestructura). Solo con
// un indicador fuerte en comun: un asunto parecido no alcanza para mezclar
// dos casos. Devuelve { incident, match } (la de mayor puntaje) o null.
async function findOpenCampaign(report) {
  const since = new Date(Date.now() - WINDOW_DAYS * DAY_MS);
  const open = await prisma.incident.findMany({
    where: { useCase: "CU-03", closedAt: null, lastSeenAt: { gte: since } },
    include: { emails: { where: { origin: { not: "candidate" } } } },
  });
  const excluded = excludedDomains();
  let best = null;
  for (const incident of open) {
    if (incident.emails.length === 0) continue;
    const match = matchOf(indicatorsOf(incident.emails.map(asRow), excluded), report, excluded);
    const strong = match.reasons.some((r) => STRONG.includes(r.type));
    if (strong && match.score >= THRESHOLD && (!best || match.score > best.match.score)) best = { incident, match };
  }
  return best;
}

// Busca y guarda los candidatos nuevos. Devuelve { scanned, found } o null si
// la integracion con el correo no esta configurada.
async function searchSimilar(incidentId, actor = null) {
  if (!mailProvider.isEnabled()) return null;
  const incident = await prisma.incident.findUnique({ where: { id: incidentId }, include: { emails: true } });
  const seeds = incident?.emails.filter((e) => e.origin !== "candidate") ?? [];
  if (seeds.length === 0) return null;

  const excluded = excludedDomains();
  const campaign = indicatorsOf(seeds.map(asRow), excluded);
  const earliest = Math.min(...seeds.map((e) => new Date(e.sentAt ?? e.firstSeenAt).getTime()));
  const recent = await mailProvider.listRecent(new Date(earliest - WINDOW_DAYS * DAY_MS));

  // El mismo correo llega a varios buzones: se analiza una vez por Message-ID.
  const known = new Set(incident.emails.map((e) => e.messageId));
  const messages = new Map();
  for (const { mailbox, raw } of recent) {
    const message = await describeMessage(raw);
    if (!message.messageId || known.has(message.messageId)) continue;
    const entry = messages.get(message.messageId) ?? { message, mailboxes: [] };
    entry.mailboxes.push(mailbox);
    messages.set(message.messageId, entry);
  }

  let found = 0;
  for (const { message, mailboxes } of messages.values()) {
    const match = matchOf(campaign, message, excluded);
    if (match.score < THRESHOLD) continue;
    await prisma.incidentEmail.create({
      data: {
        incidentId,
        messageId: message.messageId,
        fromAddress: message.fromAddress,
        replyTo: message.replyTo,
        subject: message.subject,
        sentAt: message.sentAt,
        sendingIp: message.sendingIp,
        urls: JSON.stringify(message.urls.map((url) => ({ url }))),
        attachments: JSON.stringify(message.attachments),
        origin: "candidate",
        matchedBy: JSON.stringify(match),
        mailboxes: JSON.stringify(mailboxes),
      },
    });
    found += 1;
  }

  await logAudit(
    "campaign_searched",
    `Búsqueda de correos similares: ${found} nuevo(s) entre ${messages.size} correo(s) revisado(s) (incidente #${incidentId})`,
    actor,
    incidentId
  );
  return { scanned: messages.size, found };
}

module.exports = { searchSimilar, findOpenCampaign, indicatorsOf, matchOf, normalizeSubject, excludedDomains, WEIGHTS, THRESHOLD };
