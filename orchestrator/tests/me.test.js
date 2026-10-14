const request = require("supertest");
const { app } = require("../src/app");
const { prisma } = require("../src/db");
const { adminToken } = require("./helpers");

let token;
beforeAll(async () => {
  token = await adminToken();
});

afterAll(async () => {
  await prisma.$disconnect();
});

test("GET /me sin token devuelve 401", async () => {
  const resp = await request(app).get("/api/v1/me");
  expect(resp.status).toBe(401);
});

test("GET /me crea y devuelve el perfil del usuario autenticado", async () => {
  const resp = await request(app).get("/api/v1/me").set("Authorization", `Bearer ${token}`);

  expect(resp.status).toBe(200);
  expect(resp.body.username).toBe(process.env.AUTH_USER);
  expect(resp.body.role).toBe("admin"); // admin inicial (AUTH_USER)
  expect(resp.body.passwordHash).toBeUndefined(); // el hash nunca sale por la API
});

test("PUT /me actualiza nombre y email", async () => {
  const resp = await request(app)
    .put("/api/v1/me")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: "Analyst Test", email: "test@microsoar.dev" });

  expect(resp.status).toBe(200);
  expect(resp.body.name).toBe("Analyst Test");
  expect(resp.body.email).toBe("test@microsoar.dev");
});

test("PUT /me sin name/email devuelve 422", async () => {
  const resp = await request(app)
    .put("/api/v1/me")
    .set("Authorization", `Bearer ${token}`)
    .send({});

  expect(resp.status).toBe(422);
});
