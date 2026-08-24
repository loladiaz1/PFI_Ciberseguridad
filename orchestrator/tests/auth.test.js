const request = require("supertest");
const { app } = require("../src/app");
const { prisma } = require("../src/db");

afterAll(async () => {
  await prisma.$disconnect();
});

test("login devuelve un token con credenciales validas", async () => {
  const resp = await request(app)
    .post("/api/v1/auth/login")
    .send({ username: process.env.AUTH_USER, password: process.env.AUTH_PASSWORD });

  expect(resp.status).toBe(200);
  expect(typeof resp.body.token).toBe("string");
});

test("login rechaza credenciales invalidas", async () => {
  const resp = await request(app)
    .post("/api/v1/auth/login")
    .send({ username: process.env.AUTH_USER, password: "wrong" });

  expect(resp.status).toBe(401);
});

test("GET /incidents sin token devuelve 401", async () => {
  const resp = await request(app).get("/api/v1/incidents");
  expect(resp.status).toBe(401);
});
