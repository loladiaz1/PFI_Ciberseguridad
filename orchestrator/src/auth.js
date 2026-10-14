const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { prisma } = require("./db");

// Control de acceso por roles (RF-13):
//   admin   -> todo, mas gestion de usuarios (y configuracion de la automatizacion)
//   analyst -> ve incidentes y ejecuta acciones de contencion
//   auditor -> solo lectura: incidentes, auditoria, metricas
const ROLES = ["admin", "analyst", "auditor"];
const STATUSES = ["pending", "active", "disabled"];
const BCRYPT_ROUNDS = 10;

// Misma politica que valida la app en el registro (register.tsx).
function validatePassword(password) {
  return (
    typeof password === "string" &&
    password.length >= 9 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

// Datos del usuario que pueden salir por la API (nunca el hash).
function publicUser(user) {
  const { passwordHash, ...rest } = user;
  return rest;
}

// Primer arranque: si no hay ningun admin activo, el usuario de AUTH_USER /
// AUTH_PASSWORD (el que existia antes del RBAC) pasa a ser el admin inicial.
// Una vez que hay un admin, el .env deja de importar: las credenciales viven
// en la base. Idempotente; tambien normaliza el rol anterior al RBAC.
async function ensureBootstrapAdmin(db = prisma) {
  const username = process.env.AUTH_USER;
  const password = process.env.AUTH_PASSWORD;
  if (!username || !password) return;

  await db.user.updateMany({ where: { role: "soc-analyst" }, data: { role: "analyst" } });
  if ((await db.user.count({ where: { role: "admin", status: "active" } })) > 0) return;

  const passwordHash = await hashPassword(password);
  await db.user.upsert({
    where: { username },
    update: { role: "admin", status: "active", passwordHash },
    create: {
      username,
      name: "Administrator",
      email: `${username}@microsoar.dev`,
      role: "admin",
      status: "active",
      passwordHash,
    },
  });
}

// Resultado: { user } si puede entrar, o { error: "invalid" | "pending" | "disabled" }.
async function authenticateUser(username, password, db = prisma) {
  await ensureBootstrapAdmin(db);
  const user = username ? await db.user.findUnique({ where: { username } }) : null;
  // Mismo error para usuario inexistente y password incorrecta: no revelar
  // que usuarios existen.
  if (!user || !user.passwordHash || !(await bcrypt.compare(password || "", user.passwordHash))) {
    return { error: "invalid" };
  }
  if (user.status !== "active") return { error: user.status };
  return { user };
}

function issueToken(user) {
  return jwt.sign({ sub: user.username, role: user.role }, process.env.JWT_SECRET, { expiresIn: "12h" });
}

// Verifica el JWT y que el usuario siga existiendo y activo: si un admin lo
// desactiva o lo elimina, la sesion se corta en la siguiente request, sin
// esperar a que venza el token. El rol se toma de la base, no del token.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ detail: "Missing bearer token" });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ detail: "Invalid or expired token" });
  }

  const user = await prisma.user.findUnique({ where: { username: payload.sub } });
  if (!user || user.status !== "active") {
    return res.status(401).json({ detail: "Session no longer valid" });
  }

  req.user = { sub: user.username, role: user.role };
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ detail: "Insufficient permissions" });
    }
    next();
  };
}

// Proteccion contra quedarse sin administradores: true si "username" es hoy
// el unico admin activo.
async function isLastActiveAdmin(username, db = prisma) {
  const user = await db.user.findUnique({ where: { username } });
  if (!user || user.role !== "admin" || user.status !== "active") return false;
  return (await db.user.count({ where: { role: "admin", status: "active" } })) === 1;
}

module.exports = {
  ROLES,
  STATUSES,
  validatePassword,
  hashPassword,
  publicUser,
  ensureBootstrapAdmin,
  authenticateUser,
  issueToken,
  requireAuth,
  requireRole,
  isLastActiveAdmin,
};
