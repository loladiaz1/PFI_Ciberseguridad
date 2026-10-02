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
    hostname,
    agentId: String(agentId),
    timestamp,
    status: "new",
  };
}

module.exports = { normalizeWazuhAlert };
