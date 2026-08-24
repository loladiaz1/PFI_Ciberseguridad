const https = require("https");
const axios = require("axios");

// El manager usa un certificado autofirmado por defecto en un spike/lab.
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function authenticate(host, user, password) {
  const resp = await axios.get(`${host}/security/user/authenticate`, {
    auth: { username: user, password },
    httpsAgent,
    timeout: 10000,
    validateStatus: () => true,
  });

  if (resp.status !== 200) {
    throw new Error(`Login rechazado (${resp.status}): ${JSON.stringify(resp.data)}`);
  }

  return resp.data.data.token;
}

async function blockIp(host, token, agentId, ip) {
  const url = `${host}/active-response`;
  // El script firewall-drop lee la IP de alert.data.srcip, no de "arguments"
  // (el mismo campo que usa src/normalize.js para alertas reales de Wazuh).
  const body = { command: "!firewall-drop", alert: { data: { srcip: ip } } };

  const resp = await axios.put(url, body, {
    headers: { Authorization: `Bearer ${token}` },
    params: { agents_list: agentId },
    httpsAgent,
    timeout: 10000,
    validateStatus: () => true,
  });

  if (resp.status !== 200) {
    throw new Error(`El comando fue rechazado (${resp.status}): ${JSON.stringify(resp.data)}`);
  }

  // La API de Wazuh puede devolver HTTP 200 con la accion rechazada
  // (ver data.failed_items / error != 0) en vez de un status code de error.
  const result = resp.data;
  if (result.error || result.data.total_failed_items > 0) {
    throw new Error(`El comando fue rechazado: ${JSON.stringify(result)}`);
  }

  return result;
}

module.exports = { authenticate, blockIp };
