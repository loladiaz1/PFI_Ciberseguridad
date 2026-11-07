// Motores de VirusTotal que detectan el archivo (CU-02). La integracion
// nativa de Wazuh lo manda en data.virustotal.positives; si no viene, se
// toma de la descripcion de la regla 87105 ("... - 65 engines detected ...").
function hashPositivesOf(alert) {
  const raw = alert?.data?.virustotal?.positives ?? alert?.VirusTotal?.positives;
  if (raw !== undefined && Number.isFinite(Number(raw))) return Number(raw);
  const match = /(\d+) engines detected/.exec(alert?.rule?.description ?? "");
  return match ? Number(match[1]) : null;
}

// Lo que distingue a una alerta de las otras del mismo incidente: el archivo
// (CU-02, FIM / VirusTotal) o el usuario que se intento (CU-01, sshd / PAM).
function alertDetailOf(alert) {
  const file = alert?.syscheck?.path ?? alert?.data?.virustotal?.source?.file ?? alert?.VirusTotal?.source?.file;
  if (file) return `File ${file}`;
  const user = alert?.data?.dstuser ?? alert?.data?.srcuser;
  if (user) return `User ${user}`;
  return null;
}

// Alerta cruda de Wazuh -> modelo Incident canonico (PLAN.md seccion 7).
function normalizeWazuhAlert(alert) {
  const ruleId = alert?.rule?.id;
  const severity = alert?.rule?.level;
  const ruleDescription = alert?.rule?.description;
  const srcIp = alert?.data?.srcip;
  const hostname = alert?.agent?.name;
  const agentId = alert?.agent?.id;
  const timestamp = alert?.timestamp;

  // srcIp no es obligatorio: una alerta de FIM/VirusTotal (CU-02, archivo
  // infectado en el host) no tiene IP atacante -- es un evento sobre el
  // propio equipo, no una conexion de red.
  const missing = Object.entries({ ruleId, severity, hostname, agentId, timestamp })
    .filter(([, value]) => value === undefined)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Campo faltante en la alerta de Wazuh: ${missing.join(", ")}`);
  }

  return {
    source: "wazuh",
    ruleId: String(ruleId),
    severity,
    ruleDescription: ruleDescription ?? null,
    srcIp: srcIp ?? null,
    useCase: srcIp ? "CU-01" : "CU-02",
    hostname,
    agentId: String(agentId),
    timestamp,
    status: "new",
    hashPositives: hashPositivesOf(alert),
  };
}

// Solo las familias de reglas de los casos de uso generan incidente:
//   - authentication_failures: reglas compuestas de fuerza bruta (5712,
//     5763, 5551...) -- CU-01. No incluye los intentos fallidos sueltos
//     (grupo authentication_failed), que son la materia prima, no el ataque.
//   - virustotal: archivo malicioso confirmado por VT (87105) -- CU-02.
// Todo lo demas (FIM de archivos del sistema, dpkg, rootcheck...) era ruido:
// 1320 de 1334 incidentes al 13/10 (ver progress.md). Wazuh ya filtra lo
// mismo en el <integration> del manager; esto es la segunda capa, y la que
// esta versionada y testeada.
const RELEVANT_GROUPS = ["authentication_failures", "virustotal"];

function isRelevantAlert(alert) {
  const groups = alert?.rule?.groups ?? [];
  return groups.some((g) => RELEVANT_GROUPS.includes(g));
}

// Alerta de la regla de correo (integrations/mail-scan.py): va a la ingesta de
// CU-03 (src/email.js), no a este modelo de incidente.
function isPhishingAlert(alert) {
  return (alert?.rule?.groups ?? []).includes("phishing");
}

// Caso de uso del incidente. Los anteriores a la columna useCase se deducen
// de srcIp, como antes de CU-03 (un correo nunca tiene srcIp).
function useCaseOf(incident) {
  return incident.useCase ?? (incident.srcIp ? "CU-01" : "CU-02");
}

// Completa useCase en los incidentes anteriores a la columna. Idempotente;
// corre al arrancar el servidor.
async function backfillUseCases(db) {
  const a = await db.incident.updateMany({ where: { useCase: null, srcIp: { not: null } }, data: { useCase: "CU-01" } });
  const b = await db.incident.updateMany({ where: { useCase: null, srcIp: null }, data: { useCase: "CU-02" } });
  return a.count + b.count;
}

module.exports = { normalizeWazuhAlert, isRelevantAlert, isPhishingAlert, alertDetailOf, useCaseOf, backfillUseCases };
