// Usuarios y tokens para los tests (RBAC real: el token tiene que
// corresponder a un usuario existente y activo en la base).
const { prisma } = require("../src/db");
const { ensureBootstrapAdmin, hashPassword, issueToken } = require("../src/auth");

const STRONG_PASSWORD = "Str0ng!Passw0rd";

// Token del admin inicial (AUTH_USER), el mismo que usa la demo.
async function adminToken() {
  await ensureBootstrapAdmin();
  return issueToken(await prisma.user.findUnique({ where: { username: process.env.AUTH_USER } }));
}

// Crea (o resetea) un usuario con el rol y estado pedidos.
async function createUser({ username, role = "analyst", status = "active", password = STRONG_PASSWORD }) {
  const passwordHash = await hashPassword(password);
  const data = { role, status, passwordHash, name: `Test ${username}`, email: `${username}@test.dev` };
  return prisma.user.upsert({ where: { username }, update: data, create: { username, ...data } });
}

async function tokenFor(options) {
  return issueToken(await createUser(options));
}

module.exports = { STRONG_PASSWORD, adminToken, createUser, tokenFor };
