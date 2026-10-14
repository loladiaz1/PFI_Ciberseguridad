// Detalle de incidente, token invalido, enriquecimiento asincronico del
// webhook y tolerancia a fallas de la auditoria.
jest.mock("../src/enrichment");

const request = require("supertest");
const mockAlert = require("../mocks/wazuh_ssh_bruteforce.json");
const { app } = require("../src/app");
const { prisma } = require("../src/db");
const { adminToken } = require("./helpers");
const { enrichIp } = require("../src/enrichment");

let token;
beforeAll(async () => {
  token = await adminToken();
});
// El enriquecimiento corre despues de responder a Wazuh (no lo bloquea):
// hay que darle un tick para que termine antes de mirar la base.
const flush = () => new Promise((resolve) => setTimeout(resolve, 100));

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(() => {
  enrichIp.mockReset();
  enrichIp.mockResolvedValue({ vt: null, abuseipdb: null });
});

test("GET /incidents/:id devuelve el incidente", async () => {
  const created = await request(app).post("/api/v1/webhook/wazuh").send(mockAlert);

  const resp = await request(app)
    .get(`/api/v1/incidents/${created.body.id}`)
    .set("Authorization", `Bearer ${token}`);

  expect(resp.status).toBe(200);
  expect(resp.body.id).toBe(created.body.id);
  expect(resp.body.srcIp).toBe(mockAlert.data.srcip);
});

test("GET /incidents/:id inexistente -> 404", async () => {
  const resp = await request(app).get("/api/v1/incidents/999999").set("Authorization", `Bearer ${token}`);

  expect(resp.status).toBe(404);
});

test("un token adulterado o vencido -> 401", async () => {
  const resp = await request(app).get("/api/v1/incidents").set("Authorization", "Bearer no.es.un-jwt");

  expect(resp.status).toBe(401);
  expect(resp.body.detail).toBe("Invalid or expired token");
});

test("el webhook guarda el enriquecimiento cuando VT/AbuseIPDB responden", async () => {
  const vt = JSON.stringify({ malicious: 9, suspicious: 1, harmless: 50 });
  const abuseipdb = JSON.stringify({ abuseConfidenceScore: 100, totalReports: 300, countryCode: "CN" });
  enrichIp.mockResolvedValue({ vt, abuseipdb });

  const created = await request(app).post("/api/v1/webhook/wazuh").send(mockAlert);
  await flush();

  expect(enrichIp).toHaveBeenCalledWith(mockAlert.data.srcip);
  const persisted = await prisma.incident.findUnique({ where: { id: created.body.id } });
  expect(persisted.enrichmentVt).toBe(vt);
  expect(persisted.enrichmentAbuseIpdb).toBe(abuseipdb);
});

test("sin datos de enriquecimiento, el incidente queda sin tocar", async () => {
  const created = await request(app).post("/api/v1/webhook/wazuh").send(mockAlert);
  await flush();

  const persisted = await prisma.incident.findUnique({ where: { id: created.body.id } });
  expect(persisted.enrichmentVt).toBeNull();
  expect(persisted.enrichmentAbuseIpdb).toBeNull();
});

test("si el enriquecimiento falla, el webhook igual responde 201", async () => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  enrichIp.mockRejectedValue(new Error("VT caido"));

  const resp = await request(app).post("/api/v1/webhook/wazuh").send(mockAlert);
  await flush();

  expect(resp.status).toBe(201);
  expect(console.error).toHaveBeenCalledWith("No se pudo enriquecer el incidente:", "VT caido");
  console.error.mockRestore();
});

test("si falla la auditoria, el login igual funciona (la auditoria no es bloqueante)", async () => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  const spy = jest.spyOn(prisma.auditEvent, "create").mockRejectedValueOnce(new Error("disco lleno"));

  const resp = await request(app)
    .post("/api/v1/auth/login")
    .send({ username: process.env.AUTH_USER, password: process.env.AUTH_PASSWORD });

  expect(resp.status).toBe(200);
  expect(resp.body.token).toBeDefined();
  spy.mockRestore();
  console.error.mockRestore();
});
