// Spike Fase 0: bloquear una IP en un agente Wazuh via la API.
// Hilo dorado: auth -> token JWT -> PUT /active-response.
//
// El agente 000 es el manager mismo y Wazuh rechaza active-response ahi
// (error 1703) -- el agente objetivo tiene que ser un agente real registrado.
require("dotenv").config();
const https = require("https");
const axios = require("axios");

const ATTACKER_IP = "8.8.8.8";

// El manager usa un certificado autofirmado por defecto en un spike/lab.
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

function die(message) {
  console.error(message);
  process.exit(1);
}

async function authenticate(host, user, password) {
  let resp;
  try {
    resp = await axios.get(`${host}/security/user/authenticate`, {
      auth: { username: user, password },
      httpsAgent,
      timeout: 10000,
      validateStatus: () => true,
    });
  } catch (err) {
    return die(`No se pudo conectar a ${host}: ${err.message}`);
  }

  if (resp.status !== 200) {
    return die(`Login rechazado (${resp.status}): ${JSON.stringify(resp.data)}`);
  }

  return resp.data.data.token;
}

async function blockIp(host, token, agentId, ip) {
  const url = `${host}/active-response`;
  // El script firewall-drop lee la IP de alert.data.srcip, no de "arguments"
  // (el mismo campo que ya usa src/normalize.js para alertas reales de Wazuh).
  const body = { command: "!firewall-drop", alert: { data: { srcip: ip } } };

  let resp;
  try {
    resp = await axios.put(url, body, {
      headers: { Authorization: `Bearer ${token}` },
      params: { agents_list: agentId },
      httpsAgent,
      timeout: 10000,
      validateStatus: () => true,
    });
  } catch (err) {
    return die(`No se pudo enviar el active-response: ${err.message}`);
  }

  if (resp.status !== 200) {
    return die(`El comando fue rechazado (${resp.status}): ${JSON.stringify(resp.data)}`);
  }

  // La API de Wazuh puede devolver HTTP 200 con la accion rechazada
  // (ver data.failed_items / error != 0) en vez de un status code de error.
  const result = resp.data;
  if (result.error || result.data.total_failed_items > 0) {
    return die(`El comando fue rechazado: ${JSON.stringify(result)}`);
  }

  console.log(`IP ${ip} bloqueada en agente ${agentId}:`, result);
}

async function main() {
  const host = process.env.WAZUH_HOST;
  const user = process.env.WAZUH_USER;
  const password = process.env.WAZUH_PASSWORD;
  const agentId = process.env.WAZUH_AGENT_ID;

  const token = await authenticate(host, user, password);
  await blockIp(host, token, agentId, ATTACKER_IP);
}

main();
