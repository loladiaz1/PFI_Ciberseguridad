// Usuarios reales y control de acceso por roles (RF-13): registro con
// aprobacion, roles admin / analyst / auditor, y proteccion del ultimo admin.
jest.mock("../src/wazuh");

const request = require("supertest");
const bcrypt = require("bcryptjs");
const bruteforceAlert = require("../mocks/wazuh_ssh_bruteforce.json");
const { app } = require("../src/app");
const { prisma } = require("../src/db");
const { authenticate, blockIp, isolateHost } = require("../src/wazuh");
const { validatePassword, ensureBootstrapAdmin } = require("../src/auth");
const { adminToken, createUser, tokenFor, STRONG_PASSWORD } = require("./helpers");

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
let admin;

beforeAll(async () => {
  admin = bearer(await adminToken());
  authenticate.mockResolvedValue("fake-token");
  blockIp.mockResolvedValue({ error: 0, data: { total_failed_items: 0 } });
  isolateHost.mockResolvedValue({ error: 0, data: { total_failed_items: 0 } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

const register = (body) => request(app).post("/api/v1/auth/register").send(body);
const login = (username, password = STRONG_PASSWORD) =>
  request(app).post("/api/v1/auth/login").send({ username, password });

describe("politica de contrasenas", () => {
  test("exige 9+ caracteres con mayuscula, minuscula, numero y especial", () => {
    expect(validatePassword(STRONG_PASSWORD)).toBe(true);
    expect(validatePassword("Corta1!")).toBe(false);
    expect(validatePassword("sinmayuscula1!")).toBe(false);
    expect(validatePassword("SINMINUSCULA1!")).toBe(false);
    expect(validatePassword("SinNumero!!")).toBe(false);
    expect(validatePassword("SinEspecial123")).toBe(false);
    expect(validatePassword(undefined)).toBe(false);
  });
});

describe("registro con aprobacion", () => {
  test("crea la cuenta pendiente, como analista y con la contrasena hasheada", async () => {
    const resp = await register({ username: "nuevo1@test.dev", name: "Nuevo", email: "nuevo1@test.dev", password: STRONG_PASSWORD });

    expect(resp.status).toBe(201);
    expect(resp.body).toEqual({ username: "nuevo1@test.dev", status: "pending" });
    const user = await prisma.user.findUnique({ where: { username: "nuevo1@test.dev" } });
    expect(user.role).toBe("analyst");
    expect(user.passwordHash).not.toBe(STRONG_PASSWORD);
    expect(await bcrypt.compare(STRONG_PASSWORD, user.passwordHash)).toBe(true);
  });

  test("una cuenta pendiente no puede entrar", async () => {
    await register({ username: "nuevo2@test.dev", name: "Nuevo", email: "nuevo2@test.dev", password: STRONG_PASSWORD });

    const resp = await login("nuevo2@test.dev");

    expect(resp.status).toBe(403);
    expect(resp.body.detail).toMatch(/pending/i);
  });

  test("un admin la aprueba y recien ahi puede entrar", async () => {
    await register({ username: "nuevo3@test.dev", name: "Nuevo", email: "nuevo3@test.dev", password: STRONG_PASSWORD });

    const approve = await request(app).patch("/api/v1/users/nuevo3@test.dev").set(admin).send({ status: "active" });

    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe("active");
    expect(approve.body.passwordHash).toBeUndefined();
    expect((await login("nuevo3@test.dev")).status).toBe(200);
    const event = await prisma.auditEvent.findFirst({ where: { type: "user_updated" }, orderBy: { id: "desc" } });
    expect(event.detail).toBe("User nuevo3@test.dev: approved");
    expect(event.actor).toBe(process.env.AUTH_USER);
  });

  test("rechaza datos incompletos, contrasena debil y usuario repetido", async () => {
    expect((await register({ username: "x@test.dev" })).status).toBe(422);
    expect((await register({ username: "x@test.dev", name: "X", email: "x@test.dev", password: "debil" })).status).toBe(422);
    await register({ username: "dup@test.dev", name: "D", email: "dup@test.dev", password: STRONG_PASSWORD });
    expect((await register({ username: "dup@test.dev", name: "D", email: "dup@test.dev", password: STRONG_PASSWORD })).status).toBe(409);
  });
});

describe("login", () => {
  test("misma respuesta para usuario inexistente y contrasena incorrecta", async () => {
    await createUser({ username: "real@test.dev" });

    const wrongPassword = await login("real@test.dev", "Otra!Passw0rd");
    const noUser = await login("noexiste@test.dev");

    expect(wrongPassword.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(wrongPassword.body).toEqual(noUser.body);
  });

  test("una cuenta desactivada no puede entrar", async () => {
    await createUser({ username: "baja@test.dev", status: "disabled" });
    expect((await login("baja@test.dev")).status).toBe(403);
  });
});

describe("permisos por rol", () => {
  let incidentId;
  beforeAll(async () => {
    incidentId = (await request(app).post("/api/v1/webhook/wazuh").send(bruteforceAlert)).body.id;
  });

  test("el auditor ve incidentes, auditoria y metricas, pero no puede mitigar", async () => {
    const auditor = bearer(await tokenFor({ username: "auditor@test.dev", role: "auditor" }));

    expect((await request(app).get("/api/v1/incidents").set(auditor)).status).toBe(200);
    expect((await request(app).get("/api/v1/audit").set(auditor)).status).toBe(200);
    expect((await request(app).get("/api/v1/metrics").set(auditor)).status).toBe(200);
    expect((await request(app).post(`/api/v1/incidents/${incidentId}/actions/block-ip`).set(auditor)).status).toBe(403);
    expect((await request(app).post(`/api/v1/incidents/${incidentId}/actions/isolate-host`).set(auditor)).status).toBe(403);
  });

  test("el analista mitiga, pero no gestiona usuarios", async () => {
    const analyst = bearer(await tokenFor({ username: "analista@test.dev", role: "analyst" }));

    expect((await request(app).post(`/api/v1/incidents/${incidentId}/actions/block-ip`).set(analyst)).status).toBe(200);
    expect((await request(app).get("/api/v1/users").set(analyst)).status).toBe(403);
    expect((await request(app).patch("/api/v1/users/analista@test.dev").set(analyst).send({ role: "admin" })).status).toBe(403);
  });

  test("el admin lista usuarios (pendientes primero, sin hashes)", async () => {
    await register({ username: "pend@test.dev", name: "P", email: "pend@test.dev", password: STRONG_PASSWORD });

    const resp = await request(app).get("/api/v1/users").set(admin);

    expect(resp.status).toBe(200);
    expect(resp.body[0].status).toBe("pending");
    expect(resp.body.every((u) => u.passwordHash === undefined)).toBe(true);
  });

  test("el rol se toma de la base: un cambio de rol aplica sin volver a loguearse", async () => {
    const token = bearer(await tokenFor({ username: "cambia@test.dev", role: "analyst" }));
    await request(app).patch("/api/v1/users/cambia@test.dev").set(admin).send({ role: "auditor" });

    expect((await request(app).post(`/api/v1/incidents/${incidentId}/actions/block-ip`).set(token)).status).toBe(403);
  });

  test("desactivar a un usuario corta su sesion en el acto", async () => {
    const token = bearer(await tokenFor({ username: "corta@test.dev" }));
    await request(app).patch("/api/v1/users/corta@test.dev").set(admin).send({ status: "disabled" });

    expect((await request(app).get("/api/v1/incidents").set(token)).status).toBe(401);
  });
});

describe("gestion de usuarios (admin)", () => {
  test("valida rol y estado, y responde 404 si el usuario no existe", async () => {
    await createUser({ username: "valida@test.dev" });
    expect((await request(app).patch("/api/v1/users/valida@test.dev").set(admin).send({ role: "root" })).status).toBe(422);
    expect((await request(app).patch("/api/v1/users/valida@test.dev").set(admin).send({ status: "pending" })).status).toBe(422);
    expect((await request(app).patch("/api/v1/users/noexiste@test.dev").set(admin).send({ status: "active" })).status).toBe(404);
    expect((await request(app).delete("/api/v1/users/noexiste@test.dev").set(admin)).status).toBe(404);
  });

  test("audita cambios de estado y de rol, y un PATCH sin cambios", async () => {
    await createUser({ username: "audita@test.dev", role: "analyst", status: "active" });
    await request(app).patch("/api/v1/users/audita@test.dev").set(admin).send({ status: "disabled", role: "auditor" });
    let event = await prisma.auditEvent.findFirst({ where: { type: "user_updated" }, orderBy: { id: "desc" } });
    expect(event.detail).toBe("User audita@test.dev: status active -> disabled, role analyst -> auditor");

    await request(app).patch("/api/v1/users/audita@test.dev").set(admin).send({});
    event = await prisma.auditEvent.findFirst({ where: { type: "user_updated" }, orderBy: { id: "desc" } });
    expect(event.detail).toBe("User audita@test.dev: no changes");
  });

  test("rechazar un registro lo elimina y seudonimiza su rastro", async () => {
    await register({ username: "rechazo@test.dev", name: "R", email: "rechazo@test.dev", password: STRONG_PASSWORD });

    const resp = await request(app).delete("/api/v1/users/rechazo@test.dev").set(admin);

    expect(resp.status).toBe(204);
    expect(await prisma.user.findUnique({ where: { username: "rechazo@test.dev" } })).toBeNull();
    expect(await prisma.auditEvent.count({ where: { actor: "rechazo@test.dev" } })).toBe(0);
    const removed = await prisma.auditEvent.findFirst({ where: { type: "user_removed" }, orderBy: { id: "desc" } });
    expect(removed.actor).toBe(process.env.AUTH_USER);
  });

  test("no se puede quitar el ultimo admin: ni bajarle el rol, ni desactivarlo, ni eliminarlo", async () => {
    const me = process.env.AUTH_USER;
    expect((await request(app).patch(`/api/v1/users/${me}`).set(admin).send({ role: "analyst" })).status).toBe(409);
    expect((await request(app).patch(`/api/v1/users/${me}`).set(admin).send({ status: "disabled" })).status).toBe(409);
    expect((await request(app).delete(`/api/v1/users/${me}`).set(admin)).status).toBe(409);
  });

  test("con un segundo admin, el primero si puede dejar de serlo", async () => {
    await createUser({ username: "admin2@test.dev", role: "admin" });
    const second = bearer(await tokenFor({ username: "admin2@test.dev", role: "admin" }));

    const resp = await request(app).patch("/api/v1/users/admin2@test.dev").set(second).send({ role: "analyst" });

    expect(resp.status).toBe(200);
  });
});

describe("admin inicial", () => {
  test("normaliza el rol previo al RBAC y no pisa un admin existente", async () => {
    await createUser({ username: "viejo@test.dev", role: "soc-analyst" });

    await ensureBootstrapAdmin();

    expect((await prisma.user.findUnique({ where: { username: "viejo@test.dev" } })).role).toBe("analyst");
    expect((await prisma.user.findUnique({ where: { username: process.env.AUTH_USER } })).role).toBe("admin");
  });

  test("sin AUTH_USER/AUTH_PASSWORD no hace nada", async () => {
    const saved = process.env.AUTH_USER;
    delete process.env.AUTH_USER;
    await expect(ensureBootstrapAdmin()).resolves.toBeUndefined();
    process.env.AUTH_USER = saved;
  });
});
