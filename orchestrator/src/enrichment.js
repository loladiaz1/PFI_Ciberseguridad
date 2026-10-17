const axios = require("axios");

// Cache en memoria por IP -- evita re-consultar el mismo atacante dentro de
// la ventana de rate limit gratuito de ambas APIs (VT: 4 req/min; AbuseIPDB:
// 1000/dia). PLAN.md seccion 10 lista esto como riesgo ("Rate limit de
// VT/AbuseIPDB en vivo") con la misma mitigacion ("respuestas cacheadas").
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map(); // ip -> { data, fetchedAt }

async function queryVirusTotal(ip) {
  const apiKey = process.env.VT_API_KEY;
  if (!apiKey) return null;

  try {
    const resp = await axios.get(`https://www.virustotal.com/api/v3/ip_addresses/${ip}`, {
      headers: { "x-apikey": apiKey },
      timeout: 8000,
      validateStatus: () => true,
    });
    const stats = resp.data?.data?.attributes?.last_analysis_stats;
    if (resp.status !== 200 || !stats) return null;

    return JSON.stringify({
      malicious: stats.malicious,
      suspicious: stats.suspicious,
      harmless: stats.harmless,
    });
  } catch (err) {
    console.error(`VirusTotal fallo para ${ip}:`, err.message);
    return null;
  }
}

async function queryAbuseIpdb(ip) {
  const apiKey = process.env.ABUSEIPDB_API_KEY;
  if (!apiKey) return null;

  try {
    const resp = await axios.get("https://api.abuseipdb.com/api/v2/check", {
      params: { ipAddress: ip, maxAgeInDays: 90 },
      headers: { Key: apiKey, Accept: "application/json" },
      timeout: 8000,
      validateStatus: () => true,
    });
    const data = resp.data?.data;
    if (resp.status !== 200 || !data) return null;

    return JSON.stringify({
      abuseConfidenceScore: data.abuseConfidenceScore,
      totalReports: data.totalReports,
      countryCode: data.countryCode,
    });
  } catch (err) {
    console.error(`AbuseIPDB fallo para ${ip}:`, err.message);
    return null;
  }
}

// Reputacion de una URL o de un archivo (CU-03): motores de VirusTotal que lo
// marcan como malicioso, o null si VT no lo conoce, no responde o no hay key.
async function queryVtObject(kind, id) {
  const apiKey = process.env.VT_API_KEY;
  if (!apiKey) return null;

  try {
    const resp = await axios.get(`https://www.virustotal.com/api/v3/${kind}/${id}`, {
      headers: { "x-apikey": apiKey },
      timeout: 8000,
      validateStatus: () => true,
    });
    const malicious = resp.data?.data?.attributes?.last_analysis_stats?.malicious;
    return resp.status === 200 && Number.isFinite(malicious) ? malicious : null;
  } catch (err) {
    console.error(`VirusTotal fallo para ${kind}/${id}:`, err.message);
    return null;
  }
}

// Mismo cache que las IPs (misma cuota de VT), con prefijo para no mezclar.
async function cached(key, fetcher) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.data;
  const data = await fetcher();
  cache.set(key, { data, fetchedAt: Date.now() });
  return data;
}

// VT identifica una URL por su base64url sin relleno.
const enrichUrl = (url) => cached(`url:${url}`, () => queryVtObject("urls", Buffer.from(url).toString("base64url")));
const enrichFile = (sha256) => cached(`file:${sha256}`, () => queryVtObject("files", sha256));

// Sin ninguna de las dos API key seteadas, devuelve { vt: null, abuseipdb: null }
// sin pegarle a la red -- asi los tests y un dev sin credenciales no rompen.
async function enrichIp(ip) {
  const cached = cache.get(ip);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const [vt, abuseipdb] = await Promise.all([queryVirusTotal(ip), queryAbuseIpdb(ip)]);
  const data = { vt, abuseipdb };
  cache.set(ip, { data, fetchedAt: Date.now() });
  return data;
}

module.exports = { enrichIp, enrichUrl, enrichFile };
