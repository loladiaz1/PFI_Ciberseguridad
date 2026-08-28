jest.mock("../src/wazuh");

const request = require("supertest");
const mockAlert = require("../mocks/wazuh_ssh_bruteforce.json");
const { app } = require("../src/app");
const { prisma } = require("../src/db");
const { authenticate, blockIp } = require("../src/wazuh");
const { login } = require("../src/auth");

const token = login(process.env.AUTH_USER, process.env.AUTH_PASSWORD);

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(() => {
  authenticate.mockReset();
  blockIp.mockReset();
});

test("bloquea un incidente existente y lo marca como blocked", async () => {
  const created = await request(app).post("/api/v1/webhook/wazuh").send(mockAlert);
  authenticate.mockResolvedValue("fake-token");
  blockIp.mockResolvedValue({ error: 0, data: { total_failed_items: 0 } });

  const resp = await request(app)
    .post(`/api/v1/incidents/${created.body.id}/actions/block-ip`)
    .set("Authorization", `Bearer ${token}`);

  expect(resp.status).toBe(200);
  expect(resp.body.incidentId).toBe(created.body.id);
  expect(resp.body.srcIp).toBe(mockAlert.data.srcip);
  expect(resp.body.agentId).toBe(mockAlert.agent.id);
  expect(resp.body.status).toBe("blocked");
  expect(blockIp).toHaveBeenCalledWith(
    expect.anything(),
    "fake-token",
    mockAlert.agent.id,
    mockAlert.data.srcip
  );

  const persisted = await prisma.incident.findUnique({ where: { id: created.body.id } });
  expect(persisted.status).toBe("blocked");
  expect(persisted.blockedAt).not.toBeNull();
});

test("devuelve 404 si el incidente no existe", async () => {
  const resp = await request(app)
    .post("/api/v1/incidents/999999/actions/block-ip")
    .set("Authorization", `Bearer ${token}`);
  expect(resp.status).toBe(404);
});

test("devuelve 502 si Wazuh rechaza el comando", async () => {
  const created = await request(app).post("/api/v1/webhook/wazuh").send(mockAlert);
  authenticate.mockResolvedValue("fake-token");
  blockIp.mockRejectedValue(new Error("El comando fue rechazado"));

  const resp = await request(app)
    .post(`/api/v1/incidents/${created.body.id}/actions/block-ip`)
    .set("Authorization", `Bearer ${token}`);

  expect(resp.status).toBe(502);
});
