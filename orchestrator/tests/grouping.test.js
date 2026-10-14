// Agrupamiento de alertas del mismo ataque en un solo incidente.
jest.mock("../src/wazuh");

const request = require("supertest");
const bruteforceAlert = require("../mocks/wazuh_ssh_bruteforce.json");
const malwareAlert = require("../mocks/wazuh_malware_detected.json");
const { app } = require("../src/app");
const { prisma } = require("../src/db");
const { adminToken } = require("./helpers");
const { authenticate, blockIp } = require("../src/wazuh");
const { groupWindowMs, mergeAlert, ruleIdsOf, DEFAULT_WINDOW_MS } = require("../src/grouping");

let token;
beforeAll(async () => {
  token = await adminToken();
});
const webhook = (alert) => request(app).post("/api/v1/webhook/wazuh").send(alert);
// IP distinta por test: los incidentes de otros tests no interfieren.
const withIp = (ip, ruleId = "5712") => ({ ...bruteforceAlert, rule: { ...bruteforceAlert.rule, id: ruleId }, data: { srcip: ip } });
// La regla 5551 (PAM) que dispara junto a la 5712 en una fuerza bruta real.
const pamAlert = (ip) => ({
  ...withIp(ip, "5551"),
  rule: { level: 10, id: "5551", description: "PAM: Multiple failed logins in a small period of time.", groups: ["pam", "syslog", "authentication_failures"] },
});

beforeAll(async () => {
  process.env.GROUP_WINDOW_MS = String(DEFAULT_WINDOW_MS);
  // La base local persiste entre corridas: un incidente abierto de la corrida
  // anterior (misma IP, dentro de la ventana) absorberia las alertas de esta.
  // 192.0.2.0/24 (TEST-NET-1) y el agente 077 los usa solo este archivo.
  await prisma.incident.deleteMany({ where: { OR: [{ srcIp: { startsWith: "192.0.2." } }, { agentId: "077" }] } });
});
afterAll(async () => {
  process.env.GROUP_WINDOW_MS = "0";
  await prisma.$disconnect();
});

test("sshd + PAM de la misma IP -> un solo incidente con las dos reglas", async () => {
  const first = await webhook(withIp("192.0.2.10"));
  const second = await webhook(pamAlert("192.0.2.10"));

  expect(first.status).toBe(201);
  expect(second.status).toBe(200);
  expect(second.body.grouped).toBe(true);
  expect(second.body.id).toBe(first.body.id);
  expect(second.body.alertCount).toBe(2);
  expect(JSON.parse(second.body.ruleIds)).toEqual(["5712", "5551"]);
});

test("la misma regla repetida suma alertas pero no se duplica en la lista", async () => {
  await webhook(withIp("192.0.2.11"));
  const again = await webhook(withIp("192.0.2.11"));

  expect(again.body.alertCount).toBe(2);
  expect(JSON.parse(again.body.ruleIds)).toEqual(["5712"]);
});

test("IPs distintas -> incidentes distintos", async () => {
  const a = await webhook(withIp("192.0.2.12"));
  const b = await webhook(withIp("192.0.2.13"));

  expect(b.status).toBe(201);
  expect(b.body.id).not.toBe(a.body.id);
});

test("despues de mitigar, un intento nuevo abre otro incidente", async () => {
  authenticate.mockResolvedValue("fake-token");
  blockIp.mockResolvedValue({ error: 0, data: { total_failed_items: 0 } });
  const first = await webhook(withIp("192.0.2.14"));
  await request(app)
    .post(`/api/v1/incidents/${first.body.id}/actions/block-ip`)
    .set("Authorization", `Bearer ${token}`);

  const after = await webhook(withIp("192.0.2.14"));

  expect(after.status).toBe(201);
  expect(after.body.id).not.toBe(first.body.id);
});

test("fuera de la ventana -> incidente nuevo", async () => {
  const first = await webhook(withIp("192.0.2.15"));
  await prisma.incident.update({
    where: { id: first.body.id },
    data: { lastSeenAt: new Date(Date.now() - DEFAULT_WINDOW_MS - 1000) },
  });

  const later = await webhook(withIp("192.0.2.15"));

  expect(later.status).toBe(201);
  expect(later.body.id).not.toBe(first.body.id);
});

test("CU-02: dos archivos maliciosos en el mismo host abierto se agrupan", async () => {
  const host = { ...malwareAlert.agent, id: "077", name: "host-cu02" };
  const first = await webhook({ ...malwareAlert, agent: host });
  const second = await webhook({ ...malwareAlert, agent: host });

  expect(second.status).toBe(200);
  expect(second.body.id).toBe(first.body.id);
  expect(second.body.srcIp).toBeNull();
});

test("la severidad del incidente es la mas alta de sus alertas", () => {
  const merged = mergeAlert({ alertCount: 1, ruleIds: null, ruleId: "5712", severity: 10 }, { ruleId: "40112", severity: 12 });
  expect(merged.severity).toBe(12);
  expect(JSON.parse(merged.ruleIds)).toEqual(["5712", "40112"]);
});

test("se queda con la deteccion del hash mas alta (y la conserva si la alerta nueva no la trae)", () => {
  const base = { alertCount: 1, ruleIds: null, ruleId: "87105", severity: 12, hashPositives: 11 };
  expect(mergeAlert(base, { ruleId: "87105", severity: 12, hashPositives: 40 }).hashPositives).toBe(40);
  expect(mergeAlert(base, { ruleId: "87105", severity: 12, hashPositives: 3 }).hashPositives).toBe(11);
  expect(mergeAlert(base, { ruleId: "87105", severity: 12, hashPositives: null }).hashPositives).toBe(11);
  expect(mergeAlert({ ...base, hashPositives: null }, { ruleId: "5712", severity: 10, hashPositives: null }).hashPositives).toBeNull();
});

test("incidentes anteriores al agrupamiento (ruleIds null) usan su ruleId", () => {
  expect(ruleIdsOf({ ruleIds: null, ruleId: "5712" })).toEqual(["5712"]);
});

test("ventana configurable; 0 la desactiva", () => {
  const saved = process.env.GROUP_WINDOW_MS;
  process.env.GROUP_WINDOW_MS = "";
  expect(groupWindowMs()).toBe(DEFAULT_WINDOW_MS);
  process.env.GROUP_WINDOW_MS = "0";
  expect(groupWindowMs()).toBe(0);
  process.env.GROUP_WINDOW_MS = saved;
});

test("con el agrupamiento desactivado, cada alerta abre su incidente", async () => {
  process.env.GROUP_WINDOW_MS = "0";
  const a = await webhook(withIp("192.0.2.16"));
  const b = await webhook(withIp("192.0.2.16"));
  process.env.GROUP_WINDOW_MS = String(DEFAULT_WINDOW_MS);

  expect(b.status).toBe(201);
  expect(b.body.id).not.toBe(a.body.id);
});
