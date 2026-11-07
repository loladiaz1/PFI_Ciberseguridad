// Integracion con el servidor de correo (CU-03). Es el UNICO archivo que
// conoce IMAP: el resto del sistema usa las funciones que exporta. Migrar a
// Microsoft 365 o Google Workspace = reescribir este archivo con Graph API
// (/users/{u}/messages, move) o Gmail API (messages.list q=rfc822msgid:,
// modify), sin tocar incidentes, app ni automatizacion.
//
// Laboratorio (terraform/mail.tf): Dovecot con un usuario master. El
// orchestrator entra a cada buzon como "<buzon>*<master>" con la clave del
// master, que Dovecot solo acepta desde la IP privada del orchestrator.
const { ImapFlow } = require("imapflow");

const QUARANTINE = "Quarantine";
const PROCESSED = "Processed";
const INVALID = "Invalid";

function config() {
  return {
    host: process.env.MAIL_IMAP_HOST,
    port: Number(process.env.MAIL_IMAP_PORT || 993),
    master: process.env.MAIL_MASTER_USER || "soar",
    password: process.env.MAIL_MASTER_PASSWORD,
    reportMailbox: process.env.MAIL_REPORT_MAILBOX,
    // Buzones donde se busca el correo reportado (separados por coma). En
    // produccion sale del directorio (Entra ID / Google Directory).
    mailboxes: (process.env.MAIL_MAILBOXES || "").split(",").map((m) => m.trim()).filter(Boolean),
  };
}

// Sin MAIL_IMAP_HOST la integracion esta apagada (dev local, tests, CI).
function isEnabled() {
  const c = config();
  return Boolean(c.host && c.password && c.reportMailbox);
}

async function connect(mailbox) {
  const c = config();
  const client = new ImapFlow({
    host: c.host,
    port: c.port,
    secure: true,
    // Certificado autofirmado del laboratorio, igual que la API de Wazuh.
    tls: { rejectUnauthorized: false },
    auth: { user: `${mailbox}*${c.master}`, pass: c.password },
    logger: false,
  });
  await client.connect();
  return client;
}

// Abre el buzon, ejecuta fn con la carpeta bloqueada y cierra siempre.
async function withFolder(mailbox, folder, fn) {
  const client = await connect(mailbox);
  try {
    const lock = await client.getMailboxLock(folder);
    try {
      return await fn(client);
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

// Reportes nuevos del buzon de reportes (phishing@). Por cada uno llama a
// handle(rawBuffer, receivedAt) y despues lo mueve a Processed (o a Invalid
// si handle tiro), para no procesarlo dos veces.
async function fetchReports(handle) {
  const c = config();
  return withFolder(c.reportMailbox, "INBOX", async (client) => {
    if (!client.mailbox.exists) return 0;
    const messages = await client.fetchAll("1:*", { uid: true, source: true, internalDate: true });
    let processed = 0;
    for (const msg of messages) {
      let target = PROCESSED;
      try {
        await handle(msg.source, msg.internalDate);
        processed += 1;
      } catch (err) {
        console.error(`Reporte de phishing invalido (uid ${msg.uid}):`, err.message);
        target = INVALID;
      }
      await client.messageMove(String(msg.uid), target, { uid: true });
    }
    return processed;
  });
}

// Aviso inmediato de reportes nuevos (IMAP IDLE): una conexion abierta al
// buzon de reportes; el servidor avisa ("exists") en cuanto llega un correo,
// en vez de esperar al proximo chequeo periodico. Si la conexion se cae,
// reconecta con espera creciente (hasta 1 min). onChange se llama tambien al
// conectar, por si llego algo mientras no habia conexion. Devuelve una
// funcion para cortar. En Graph / Gmail el equivalente son las
// suscripciones (webhooks / Pub/Sub).
const MAX_RETRY_MS = 60 * 1000;

function watchReports(onChange) {
  let client = null;
  let stopped = false;
  let retryMs = 1000;

  const retry = () => {
    if (stopped) return;
    setTimeout(open, retryMs);
    retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
  };

  async function open() {
    try {
      client = await connect(config().reportMailbox);
      client.on("error", (err) => console.error("IMAP IDLE:", err.message));
      await client.mailboxOpen("INBOX");
    } catch (err) {
      console.error("No se pudo abrir IMAP IDLE:", err.message);
      client?.logout().catch(() => {});
      return retry();
    }
    retryMs = 1000;
    client.on("close", retry);
    // Seleccionada la carpeta y sin otros comandos, imapflow queda en IDLE.
    client.on("exists", () => onChange());
    onChange();
  }

  open();
  return () => {
    stopped = true;
    client?.logout().catch(() => {});
  };
}

// Mueve los correos de una campana (por Message-ID) de una carpeta a otra en
// todos los buzones: UNA conexion por buzon y un solo movimiento con todos los
// que encuentra (una campana de miles de correos no abre miles de conexiones
// por buzon). Devuelve { messageId: [buzones donde estaba] }.
async function moveEverywhere(messageIds, from, to) {
  const found = Object.fromEntries(messageIds.map((id) => [id, []]));
  for (const mailbox of config().mailboxes) {
    await withFolder(mailbox, from, async (client) => {
      const uids = [];
      for (const id of messageIds) {
        const hits = await client.search({ header: { "message-id": id } }, { uid: true });
        if (!hits || hits.length === 0) continue;
        uids.push(...hits);
        found[id].push(mailbox);
      }
      if (uids.length) await client.messageMove(uids, to, { uid: true });
    });
  }
  return found;
}

const quarantine = (messageIds) => moveEverywhere(messageIds, "INBOX", QUARANTINE);
const restore = (messageIds) => moveEverywhere(messageIds, QUARANTINE, "INBOX");

// Correos recibidos desde "since" en la bandeja de entrada de cada buzon
// (busqueda de similares, src/campaign.js): [{ mailbox, raw }], hasta
// MAX_SCAN por buzon (los mas nuevos). En el laboratorio se bajan y se
// analizan en el orchestrator; en produccion el equivalente es el message
// trace del gateway de correo, o $search de Graph por buzon.
const MAX_SCAN = 200;

async function listRecent(since) {
  const found = [];
  for (const mailbox of config().mailboxes) {
    const messages = await withFolder(mailbox, "INBOX", async (client) => {
      if (!client.mailbox.exists) return [];
      const uids = await client.search({ since }, { uid: true });
      if (!uids || uids.length === 0) return [];
      return client.fetchAll(uids.slice(-MAX_SCAN), { uid: true, source: true }, { uid: true });
    });
    for (const m of messages) found.push({ mailbox, raw: m.source });
  }
  return found;
}

// El correo crudo de un buzon por Message-ID (alerta de la regla de correo,
// src/email.js), o null si ya no esta. Sin marcarlo como leido: "source" usa
// BODY.PEEK.
async function fetchMessage(mailbox, messageId) {
  return withFolder(mailbox, "INBOX", async (client) => {
    const uids = await client.search({ header: { "message-id": messageId } }, { uid: true });
    if (!uids || uids.length === 0) return null;
    const [message] = await client.fetchAll(uids.slice(0, 1), { uid: true, source: true }, { uid: true });
    return message?.source ?? null;
  });
}

const isMonitored = (mailbox) => config().mailboxes.includes(mailbox);

module.exports = { isEnabled, isMonitored, fetchReports, watchReports, quarantine, restore, listRecent, fetchMessage };
