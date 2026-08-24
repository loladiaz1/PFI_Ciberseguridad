// Alerta cruda de Wazuh -> modelo Incident canonico (PLAN.md seccion 7).
function normalizeWazuhAlert(alert) {
  const ruleId = alert?.rule?.id;
  const severity = alert?.rule?.level;
  const srcIp = alert?.data?.srcip;
  const hostname = alert?.agent?.name;
  const agentId = alert?.agent?.id;
  const timestamp = alert?.timestamp;

  const missing = Object.entries({ ruleId, severity, srcIp, hostname, agentId, timestamp })
    .filter(([, value]) => value === undefined)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Campo faltante en la alerta de Wazuh: ${missing.join(", ")}`);
  }

  return {
    source: "wazuh",
    ruleId: String(ruleId),
    severity,
    srcIp,
    hostname,
    agentId: String(agentId),
    timestamp,
    status: "new",
  };
}

module.exports = { normalizeWazuhAlert };
