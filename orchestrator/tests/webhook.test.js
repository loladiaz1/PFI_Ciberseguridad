const request = require("supertest");
const mockAlert = require("../mocks/wazuh_ssh_bruteforce.json");
const { app } = require("../src/app");
const { prisma } = require("../src/db");

afterAll(async () => {
  await prisma.$disconnect();
});

test("el webhook normaliza y persiste una alerta de brute-force SSH", async () => {
  const resp = await request(app).post("/api/v1/webhook/wazuh").send(mockAlert);

  expect(resp.status).toBe(201);
  expect(resp.body.source).toBe("wazuh");
  expect(resp.body.ruleId).toBe("5712");
  expect(resp.body.severity).toBe(10);
  expect(resp.body.srcIp).toBe("203.0.113.55");
  expect(resp.body.hostname).toBe("ip-10-0-1-23");
  expect(resp.body.status).toBe("new");
});

test("el webhook rechaza una alerta con campos faltantes", async () => {
  const resp = await request(app).post("/api/v1/webhook/wazuh").send({ rule: { id: "1" } });

  expect(resp.status).toBe(422);
});

test("GET /incidents devuelve la alerta persistida", async () => {
  await request(app).post("/api/v1/webhook/wazuh").send(mockAlert);

  const resp = await request(app).get("/api/v1/incidents");

  expect(resp.status).toBe(200);
  expect(resp.body.some((i) => i.srcIp === "203.0.113.55")).toBe(true);
});
