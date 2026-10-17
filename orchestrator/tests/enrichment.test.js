jest.mock("axios");

const axios = require("axios");
const { enrichIp } = require("../src/enrichment");

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  axios.get.mockReset();
});

test("sin API keys configuradas, no pega a la red y devuelve null en ambas", async () => {
  delete process.env.VT_API_KEY;
  delete process.env.ABUSEIPDB_API_KEY;

  const result = await enrichIp("198.51.100.99");

  expect(result).toEqual({ vt: null, abuseipdb: null });
  expect(axios.get).not.toHaveBeenCalled();
});

test("con ambas API keys, consulta VT y AbuseIPDB y resume la respuesta", async () => {
  process.env.VT_API_KEY = "fake-vt-key";
  process.env.ABUSEIPDB_API_KEY = "fake-abuseipdb-key";

  axios.get.mockImplementation((url) => {
    if (url.includes("virustotal.com")) {
      return Promise.resolve({
        status: 200,
        data: { data: { attributes: { last_analysis_stats: { malicious: 12, suspicious: 3, harmless: 60 } } } },
      });
    }
    return Promise.resolve({
      status: 200,
      data: { data: { abuseConfidenceScore: 87, totalReports: 42, countryCode: "RU" } },
    });
  });

  const result = await enrichIp("203.0.113.77");

  expect(JSON.parse(result.vt)).toEqual({ malicious: 12, suspicious: 3, harmless: 60 });
  expect(JSON.parse(result.abuseipdb)).toEqual({ abuseConfidenceScore: 87, totalReports: 42, countryCode: "RU" });
  // Un 429/500 no tira: se evalua el status a mano y se devuelve null.
  for (const [, config] of axios.get.mock.calls) {
    expect(config.validateStatus(429)).toBe(true);
  }
});

test("cachea el resultado: una segunda consulta a la misma IP no vuelve a pegarle a la red", async () => {
  process.env.VT_API_KEY = "fake-vt-key";
  process.env.ABUSEIPDB_API_KEY = "fake-abuseipdb-key";

  axios.get.mockResolvedValue({
    status: 200,
    data: { data: { attributes: { last_analysis_stats: { malicious: 1, suspicious: 0, harmless: 70 } } } },
  });

  const ip = "203.0.113.200";
  await enrichIp(ip);
  const callsAfterFirst = axios.get.mock.calls.length;
  await enrichIp(ip);

  expect(axios.get.mock.calls.length).toBe(callsAfterFirst);
});

test("si la red falla (timeout, DNS), no rompe: devuelve null para esa fuente", async () => {
  process.env.VT_API_KEY = "fake-vt-key";
  process.env.ABUSEIPDB_API_KEY = "fake-abuseipdb-key";
  jest.spyOn(console, "error").mockImplementation(() => {});

  axios.get.mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));

  const result = await enrichIp("203.0.113.202");

  expect(result).toEqual({ vt: null, abuseipdb: null });
  console.error.mockRestore();
});

test("con una sola API key, consulta solo esa fuente", async () => {
  delete process.env.VT_API_KEY;
  process.env.ABUSEIPDB_API_KEY = "fake-abuseipdb-key";

  axios.get.mockResolvedValue({
    status: 200,
    data: { data: { abuseConfidenceScore: 5, totalReports: 1, countryCode: "AR" } },
  });

  const result = await enrichIp("203.0.113.203");

  expect(result.vt).toBeNull();
  expect(JSON.parse(result.abuseipdb).countryCode).toBe("AR");
  expect(axios.get).toHaveBeenCalledTimes(1);
});

test("si la API responde con error, no rompe: devuelve null para esa fuente", async () => {
  process.env.VT_API_KEY = "fake-vt-key";
  process.env.ABUSEIPDB_API_KEY = "fake-abuseipdb-key";

  axios.get.mockResolvedValue({ status: 429, data: {} });

  const result = await enrichIp("203.0.113.201");

  expect(result).toEqual({ vt: null, abuseipdb: null });
});

describe("reputacion de URLs y archivos (CU-03)", () => {
  const { enrichUrl, enrichFile } = require("../src/enrichment");

  test("sin API key de VT no consulta", async () => {
    delete process.env.VT_API_KEY;
    expect(await enrichUrl("http://sin-key.test/")).toBeNull();
    expect(axios.get).not.toHaveBeenCalled();
  });

  test("consulta la URL por su base64url y el archivo por su hash, con cache", async () => {
    process.env.VT_API_KEY = "fake-vt-key";
    axios.get.mockResolvedValue({ status: 200, data: { data: { attributes: { last_analysis_stats: { malicious: 7 } } } } });

    expect(await enrichUrl("http://phish.test/login")).toBe(7);
    expect(axios.get.mock.calls[0][0]).toBe(
      `https://www.virustotal.com/api/v3/urls/${Buffer.from("http://phish.test/login").toString("base64url")}`
    );
    expect(await enrichFile("abc123")).toBe(7);
    expect(axios.get.mock.calls[1][0]).toBe("https://www.virustotal.com/api/v3/files/abc123");

    await enrichUrl("http://phish.test/login");
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  test("objeto desconocido para VT (404) o error de red: null", async () => {
    process.env.VT_API_KEY = "fake-vt-key";
    axios.get.mockResolvedValueOnce({ status: 404, data: {} });
    expect(await enrichFile("desconocido")).toBeNull();

    jest.spyOn(console, "error").mockImplementation(() => {});
    axios.get.mockRejectedValueOnce(new Error("timeout"));
    expect(await enrichUrl("http://caido.test/")).toBeNull();
  });
});
