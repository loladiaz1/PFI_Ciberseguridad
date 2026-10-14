const express = require("express");
const rateLimit = require("express-rate-limit");
const { prisma } = require("./db");
const { normalizeWazuhAlert, isRelevantAlert } = require("./normalize");
const { authenticate, blockIp, isolateHost } = require("./wazuh");
const { enrichIp } = require("./enrichment");
const {
  ROLES,
  STATUSES,
  validatePassword,
  hashPassword,
  publicUser,
  authenticateUser,
  issueToken,
  requireAuth,
  requireRole,
  isLastActiveAdmin,
  ensureBootstrapAdmin,
} = require("./auth");
const { computeMetrics } = require("./metrics");
const { deleteAccount } = require("./privacy");
const { findOpenIncident, mergeAlert } = require("./grouping");

const app = express();
app.use(express.json());

// El propio login es un endpoint de password guessing en potencia -- 20
// intentos cada 15 min por IP, misma logica que Wazuh detecta del lado del
// atacante pero aplicada a nuestro propio backend. 20 en vez de 5: sigue
// siendo nada para un ataque automatizado real, pero no deja a un analista
// nervioso (o en plena demo) bloqueado 15 minutos por un par de typos.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { detail: "Too many login attempts, try again later" },
});

// actor va separado del texto (no "<username> hizo X") para poder
// seudonimizarlo al eliminar la cuenta (ver src/privacy.js).
function logAudit(type, detail, actor = null) {
  return prisma.auditEvent.create({ data: { type, detail, actor } }).catch((err) => {
    console.error("No se pudo registrar el evento de auditoria:", err.message);
  });
}

app.post("/api/v1/auth/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  const { user, error } = await authenticateUser(username, password);

  if (error === "pending") {
    return res.status(403).json({ detail: "Account pending approval by an administrator" });
  }
  if (error === "disabled") {
    return res.status(403).json({ detail: "Account disabled" });
  }
  if (error) {
    return res.status(401).json({ detail: "Invalid credentials" });
  }

  await logAudit("login", "Logged in", user.username);
  res.status(200).json({ token: issueToken(user) });
});

// Registro con aprobacion: la cuenta nace "pending" y con el rol de menor
// privilegio que puede operar (analyst); un admin la activa o la rechaza.
// Nadie se da acceso a si mismo.
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { detail: "Too many registration attempts, try again later" },
});

app.post("/api/v1/auth/register", registerLimiter, async (req, res) => {
  const { username, name, email, password } = req.body || {};
  if (!username || !name || !email || !password) {
    return res.status(422).json({ detail: "username, name, email y password son obligatorios" });
  }
  if (!validatePassword(password)) {
    return res.status(422).json({ detail: "Password too weak" });
  }
  if (await prisma.user.findUnique({ where: { username } })) {
    return res.status(409).json({ detail: "Username already registered" });
  }

  const user = await prisma.user.create({
    data: { username, name, email, role: "analyst", status: "pending", passwordHash: await hashPassword(password) },
  });
  await logAudit("user_registered", "Registered, pending approval", username);
  res.status(201).json({ username: user.username, status: user.status });
});

app.post("/api/v1/webhook/wazuh", async (req, res) => {
  let fields;
  try {
    fields = normalizeWazuhAlert(req.body);
  } catch (err) {
    return res.status(422).json({ detail: err.message });
  }

  // 202 y no 4xx: la alerta es valida, simplemente no es de un caso de uso.
  // Wazuh no debe reintentarla ni loguearla como error de integracion.
  if (!isRelevantAlert(req.body)) {
    return res.status(202).json({ ignored: true, ruleId: fields.ruleId });
  }

  const now = new Date();

  // Misma IP + mismo agente + incidente abierto reciente -> es el mismo
  // ataque: se suma la alerta en vez de abrir otro incidente (src/grouping.js).
  // 200 (no 201): no se creo nada nuevo. Sin enriquecer de nuevo: misma IP.
  const open = await findOpenIncident(prisma, fields, now);
  if (open) {
    const grouped = await prisma.incident.update({
      where: { id: open.id },
      data: mergeAlert(open, fields, now),
    });
    await logAudit("alert_grouped", `Rule ${fields.ruleId} added to incident #${grouped.id}`);
    return res.status(200).json({ ...grouped, grouped: true });
  }

  const incident = await prisma.incident.create({
    data: { ...fields, ingestedAt: now, lastSeenAt: now, ruleIds: JSON.stringify([fields.ruleId]) },
  });
  const ruleLabel = fields.ruleDescription ?? `Rule ${fields.ruleId}`;
  await logAudit(
    "incident_detected",
    fields.srcIp ? `${ruleLabel} from ${fields.srcIp}` : `${ruleLabel} on ${fields.hostname}`
  );

  // Solo tiene sentido enriquecer si hay una IP atacante -- una alerta de
  // FIM/VirusTotal (CU-02) no tiene srcIp, no hay nada que consultar.
  // No se espera antes de responder: Wazuh no debe quedar bloqueado por una
  // llamada a VT/AbuseIPDB. Si no hay API key configurada, enrichIp no pega
  // a la red y esto es un no-op.
  if (fields.srcIp) {
    enrichIp(fields.srcIp)
      .then(({ vt, abuseipdb }) => {
        if (!vt && !abuseipdb) return;
        return prisma.incident.update({
          where: { id: incident.id },
          data: { enrichmentVt: vt, enrichmentAbuseIpdb: abuseipdb },
        });
      })
      .catch((err) => console.error("No se pudo enriquecer el incidente:", err.message));
  }

  res.status(201).json(incident);
});

app.get("/api/v1/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { username: req.user.sub } });
  res.json(publicUser(user));
});

app.put("/api/v1/me", requireAuth, async (req, res) => {
  const { name, email } = req.body || {};
  if (!name || !email) {
    return res.status(422).json({ detail: "name and email son obligatorios" });
  }

  const user = await prisma.user.update({ where: { username: req.user.sub }, data: { name, email } });
  res.json(publicUser(user));
});

const LAST_ADMIN = { detail: "Cannot remove the last active administrator" };

// Derecho de supresion (Ley 25.326, art. 16): borra el usuario (y con el su
// acceso) y seudonimiza el rastro de auditoria.
app.delete("/api/v1/me", requireAuth, async (req, res) => {
  if (await isLastActiveAdmin(req.user.sub)) return res.status(409).json(LAST_ADMIN);
  await deleteAccount(prisma, req.user.sub);
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Gestion de usuarios (solo admin). Toda accion queda auditada con el admin
// como actor.
// ---------------------------------------------------------------------------

app.get("/api/v1/users", requireAuth, requireRole("admin"), async (_req, res) => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  // Pendientes primero: es lo que el admin tiene que resolver.
  const order = { pending: 0, active: 1, disabled: 2 };
  res.json(users.map(publicUser).sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3)));
});

// Aprobar / desactivar (status) y cambiar el rol.
app.patch("/api/v1/users/:username", requireAuth, requireRole("admin"), async (req, res) => {
  const { username } = req.params;
  const { role, status } = req.body || {};
  if (role !== undefined && !ROLES.includes(role)) {
    return res.status(422).json({ detail: `role debe ser uno de: ${ROLES.join(", ")}` });
  }
  if (status !== undefined && (!STATUSES.includes(status) || status === "pending")) {
    return res.status(422).json({ detail: "status debe ser active o disabled" });
  }

  const target = await prisma.user.findUnique({ where: { username } });
  if (!target) return res.status(404).json({ detail: "User not found" });

  const losesAdmin = (role !== undefined && role !== "admin") || status === "disabled";
  if (losesAdmin && (await isLastActiveAdmin(username))) return res.status(409).json(LAST_ADMIN);

  const data = {};
  if (role !== undefined) data.role = role;
  if (status !== undefined) data.status = status;
  const updated = await prisma.user.update({ where: { username }, data });

  const changes = [];
  if (status === "active" && target.status === "pending") changes.push("approved");
  else if (status !== undefined && status !== target.status) changes.push(`status ${target.status} -> ${status}`);
  if (role !== undefined && role !== target.role) changes.push(`role ${target.role} -> ${role}`);
  await logAudit("user_updated", `User ${username}: ${changes.join(", ") || "no changes"}`, req.user.sub);

  res.json(publicUser(updated));
});

// Rechazar un registro o dar de baja a un usuario: misma supresion que
// DELETE /me (borra el usuario, seudonimiza su auditoria).
app.delete("/api/v1/users/:username", requireAuth, requireRole("admin"), async (req, res) => {
  const { username } = req.params;
  if (!(await prisma.user.findUnique({ where: { username } }))) {
    return res.status(404).json({ detail: "User not found" });
  }
  if (await isLastActiveAdmin(username)) return res.status(409).json(LAST_ADMIN);

  const pseudonym = await deleteAccount(prisma, username);
  await logAudit("user_removed", `Removed user (${pseudonym})`, req.user.sub);
  res.status(204).end();
});

app.get("/api/v1/incidents", requireAuth, async (_req, res) => {
  const incidents = await prisma.incident.findMany({ orderBy: { id: "desc" } });
  res.json(incidents);
});

app.get("/api/v1/incidents/:id", requireAuth, async (req, res) => {
  const incident = await prisma.incident.findUnique({ where: { id: Number(req.params.id) } });
  if (!incident) {
    return res.status(404).json({ detail: "Incident not found" });
  }
  res.json(incident);
});

// Acciones de contencion: admin y analyst. El auditor es solo lectura.
app.post("/api/v1/incidents/:id/actions/block-ip", requireAuth, requireRole("admin", "analyst"), async (req, res) => {
  const incident = await prisma.incident.findUnique({ where: { id: Number(req.params.id) } });
  if (!incident) {
    return res.status(404).json({ detail: "Incident not found" });
  }
  if (!incident.srcIp) {
    return res.status(422).json({ detail: "Este incidente no tiene IP de origen para bloquear" });
  }

  // actionLatencyMs: login + ejecucion en Wazuh, lo que tarda la contencion
  // una vez que el analista confirmo (RNF-05, ver src/metrics.js).
  const startedAt = Date.now();
  try {
    const token = await authenticate(
      process.env.WAZUH_HOST,
      process.env.WAZUH_USER,
      process.env.WAZUH_PASSWORD
    );
    await blockIp(process.env.WAZUH_HOST, token, incident.agentId, incident.srcIp);
  } catch (err) {
    return res.status(502).json({ detail: err.message });
  }

  const updated = await prisma.incident.update({
    where: { id: incident.id },
    data: { status: "blocked", blockedAt: new Date(), actionLatencyMs: Date.now() - startedAt },
  });

  await logAudit("ip_blocked", `Blocked ${updated.srcIp} (incident #${updated.id})`, req.user.sub);

  res.status(200).json({
    incidentId: updated.id,
    srcIp: updated.srcIp,
    agentId: updated.agentId,
    status: updated.status,
  });
});

app.post("/api/v1/incidents/:id/actions/isolate-host", requireAuth, requireRole("admin", "analyst"), async (req, res) => {
  const incident = await prisma.incident.findUnique({ where: { id: Number(req.params.id) } });
  if (!incident) {
    return res.status(404).json({ detail: "Incident not found" });
  }

  const startedAt = Date.now();
  try {
    const token = await authenticate(
      process.env.WAZUH_HOST,
      process.env.WAZUH_USER,
      process.env.WAZUH_PASSWORD
    );
    await isolateHost(process.env.WAZUH_HOST, token, incident.agentId);
  } catch (err) {
    return res.status(502).json({ detail: err.message });
  }

  const updated = await prisma.incident.update({
    where: { id: incident.id },
    data: { status: "isolated", isolatedAt: new Date(), actionLatencyMs: Date.now() - startedAt },
  });

  await logAudit("host_isolated", `Isolated ${updated.hostname} (incident #${updated.id})`, req.user.sub);

  res.status(200).json({
    incidentId: updated.id,
    hostname: updated.hostname,
    agentId: updated.agentId,
    status: updated.status,
  });
});

app.get("/api/v1/metrics", requireAuth, async (_req, res) => {
  const incidents = await prisma.incident.findMany({
    select: {
      srcIp: true,
      timestamp: true,
      ingestedAt: true,
      blockedAt: true,
      isolatedAt: true,
      actionLatencyMs: true,
    },
  });
  res.json(computeMetrics(incidents));
});

app.get("/api/v1/audit", requireAuth, async (_req, res) => {
  const events = await prisma.auditEvent.findMany({
    orderBy: { id: "desc" },
    take: 50,
  });
  res.json(events);
});

if (require.main === module) {
  const port = process.env.PORT || 8000;
  // Admin inicial desde AUTH_USER / AUTH_PASSWORD si todavia no hay ninguno
  // (tambien se intenta en cada login, por si la base se recreo en caliente).
  ensureBootstrapAdmin().catch((err) => console.error("No se pudo crear el admin inicial:", err.message));
  app.listen(port, () => console.log(`Micro-SOAR Orchestrator escuchando en :${port}`));
}

module.exports = { app };
