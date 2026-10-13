const request = require("supertest");
const noiseAlert = require("../mocks/wazuh_fim_noise.json");
const bruteforceAlert = require("../mocks/wazuh_ssh_bruteforce.json");
const malwareAlert = require("../mocks/wazuh_malware_detected.json");
const { app } = require("../src/app");
const { prisma } = require("../src/db");
const { isRelevantAlert } = require("../src/normalize");

afterAll(async () => {
  await prisma.$disconnect();
});

test("una alerta de FIM sobre archivos del sistema no crea incidente", async () => {
  const before = await prisma.incident.count();

  const resp = await request(app).post("/api/v1/webhook/wazuh").send(noiseAlert);

  expect(resp.status).toBe(202);
  expect(resp.body).toEqual({ ignored: true, ruleId: "550" });
  expect(await prisma.incident.count()).toBe(before);
});

test("una alerta ignorada igual se valida: si esta rota da 422", async () => {
  const resp = await request(app)
    .post("/api/v1/webhook/wazuh")
    .send({ rule: { id: "550", groups: ["syscheck"] } });

  expect(resp.status).toBe(422);
});

test("solo pasan las familias de los casos de uso", () => {
  expect(isRelevantAlert(bruteforceAlert)).toBe(true); // CU-01
  expect(isRelevantAlert(malwareAlert)).toBe(true); // CU-02
  expect(isRelevantAlert(noiseAlert)).toBe(false);
  // dpkg (2902/2904) y rootcheck (510): el otro 50% del ruido real
  expect(isRelevantAlert({ rule: { groups: ["ossec", "dpkg", "config_changed"] } })).toBe(false);
  expect(isRelevantAlert({ rule: { groups: ["ossec", "rootcheck"] } })).toBe(false);
  // intento fallido suelto: no es todavia un ataque
  expect(isRelevantAlert({ rule: { groups: ["syslog", "sshd", "authentication_failed"] } })).toBe(false);
  expect(isRelevantAlert({ rule: {} })).toBe(false);
});
