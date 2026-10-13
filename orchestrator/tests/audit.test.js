const request = require("supertest");
const { app } = require("../src/app");
const { prisma } = require("../src/db");
const { login } = require("../src/auth");

const token = login(process.env.AUTH_USER, process.env.AUTH_PASSWORD);

afterAll(async () => {
  await prisma.$disconnect();
});

test("GET /audit sin token devuelve 401", async () => {
  const resp = await request(app).get("/api/v1/audit");
  expect(resp.status).toBe(401);
});

test("un login exitoso queda registrado en el audit log", async () => {
  await request(app)
    .post("/api/v1/auth/login")
    .send({ username: process.env.AUTH_USER, password: process.env.AUTH_PASSWORD });

  const resp = await request(app).get("/api/v1/audit").set("Authorization", `Bearer ${token}`);

  expect(resp.status).toBe(200);
  expect(resp.body.some((e) => e.type === "login")).toBe(true);
});
