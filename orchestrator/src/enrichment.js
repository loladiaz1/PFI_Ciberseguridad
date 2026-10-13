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

module.exports = { enrichIp };
