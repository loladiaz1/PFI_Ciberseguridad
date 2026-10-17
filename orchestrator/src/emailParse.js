// CU-03: lectura de correos (sin efectos). Lo usan la ingesta del reporte
// (src/email.js) y la busqueda de correos similares (src/campaign.js).
const crypto = require("crypto");
const { simpleParser } = require("mailparser");

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

// Correo ya parseado (mailparser) -> metadatos e indicadores. Nunca el cuerpo.
function describe(mail) {
  return {
    messageId: mail.messageId ?? null,
    fromAddress: addressOf(mail.from),
    replyTo: addressOf(mail.replyTo),
    subject: mail.subject ?? null,
    sentAt: mail.date ?? null,
    sendingIp: sendingIpOf(mail),
    urls: urlsOf(mail),
    attachments: mail.attachments.map((a) => ({ name: a.filename ?? null, sha256: sha256(a.content), size: a.size })),
  };
}

const describeMessage = async (raw) => describe(await simpleParser(raw));

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
    ...describe(original),
  };
}

module.exports = { parseReport, describeMessage };
