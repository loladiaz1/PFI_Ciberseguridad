jest.mock("../src/wazuh");

const request = require("supertest");
const mockAlert = require("../mocks/wazuh_ssh_bruteforce.json");
const { app } = require("../src/app");
const { prisma } = require("../src/db");
const { authenticate, isolateHost } = require("../src/wazuh");
const { adminToken } = require("./helpers");

let token;
beforeAll(async () => {
  token = await adminToken();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(() => {
  authenticate.mockReset();
  isolateHost.mockReset();
});

test("aisla un incidente existente y lo marca como isolated", async () => {
  const created = await request(app).post("/api/v1/webhook/wazuh").send(mockAlert);
  authenticate.mockResolvedValue("fake-token");
  isolateHost.mockResolvedValue({ error: 0, data: { total_failed_items: 0 } });

  const resp = await request(app)
    .post(`/api/v1/incidents/${created.body.id}/actions/isolate-host`)
    .set("Authorization", `Bearer ${token}`);

  expect(resp.status).toBe(200);
  expect(resp.body.incidentId).toBe(created.body.id);
  expect(resp.body.hostname).toBe(mockAlert.agent.name);
  expect(resp.body.status).toBe("isolated");
  expect(isolateHost).toHaveBeenCalledWith(expect.anything(), "fake-token", mockAlert.agent.id);

  const persisted = await prisma.incident.findUnique({ where: { id: created.body.id } });
  expect(persisted.status).toBe("isolated");
  expect(persisted.isolatedAt).not.toBeNull();
});

test("devuelve 404 si el incidente no existe", async () => {
  const resp = await request(app)
    .post("/api/v1/incidents/999999/actions/isolate-host")
    .set("Authorization", `Bearer ${token}`);
  expect(resp.status).toBe(404);
});

test("devuelve 502 si Wazuh rechaza el comando", async () => {
  const created = await request(app).post("/api/v1/webhook/wazuh").send(mockAlert);
  authenticate.mockResolvedValue("fake-token");
  isolateHost.mockRejectedValue(new Error("El comando fue rechazado"));

  const resp = await request(app)
    .post(`/api/v1/incidents/${created.body.id}/actions/isolate-host`)
    .set("Authorization", `Bearer ${token}`);

  expect(resp.status).toBe(502);

  // El intento fallido queda auditado, vinculado al incidente.
  const event = await prisma.auditEvent.findFirst({ where: { type: "mitigation_failed" }, orderBy: { id: "desc" } });
  expect(event.incidentId).toBe(created.body.id);
  expect(event.actor).toBeTruthy();
  expect(event.detail).toMatch(/^Falló el aislamiento de .*\(incidente #\d+\): El comando fue rechazado$/);
});
