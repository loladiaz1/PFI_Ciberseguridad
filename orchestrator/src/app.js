const express = require("express");
const rateLimit = require("express-rate-limit");
const { prisma } = require("./db");
const { normalizeWazuhAlert, isRelevantAlert, alertDetailOf } = require("./normalize");
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
const { CATEGORIES, categoryOf, logAudit, backfillIncidentIds } = require("./audit");
const { mitigate } = require("./mitigation");
const {
  MODES,
  CRITICALITIES,
  ensureAutomationDefaults,
  getAutomationConfig,
  runAutomation,
} = require("./automation");

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

// Una alerta de Wazuh tal como queda en la linea de tiempo del incidente.
function alertRecord(incidentId, fields, rawAlert) {
  return {
    incidentId,
    ruleId: fields.ruleId,
    ruleDescription: fields.ruleDescription,
    severity: fields.severity,
    timestamp: fields.timestamp,
    srcIp: fields.srcIp,
    hashPositives: fields.hashPositives,
    detail: alertDetailOf(rawAlert),
  };
}

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
    await prisma.incidentAlert.create({ data: alertRecord(grouped.id, fields, req.body) });
    await logAudit("alert_grouped", `Rule ${fields.ruleId} added to incident #${grouped.id}`, null, grouped.id);
    // Una alerta nueva es informacion nueva (severidad, hash, o el modo /
    // las politicas pudieron cambiar desde la primera): se vuelve a evaluar.
    // Si el incidente ya se mitigo, runAutomation no hace nada.
    const reevaluation = runAutomation(grouped.id);
    if (process.env.AUTOMATION_INLINE === "1") await reevaluation;
    return res.status(200).json({ ...grouped, grouped: true });
  }

  const incident = await prisma.incident.create({
    data: { ...fields, ingestedAt: now, lastSeenAt: now, ruleIds: JSON.stringify([fields.ruleId]) },
  });
  await prisma.incidentAlert.create({ data: alertRecord(incident.id, fields, req.body) });
  const ruleLabel = fields.ruleDescription ?? `Rule ${fields.ruleId}`;
  await logAudit(
    "incident_detected",
    fields.srcIp ? `${ruleLabel} from ${fields.srcIp}` : `${ruleLabel} on ${fields.hostname}`,
    null,
    incident.id
  );

  // Solo tiene sentido enriquecer si hay una IP atacante -- una alerta de
  // FIM/VirusTotal (CU-02) no tiene srcIp, no hay nada que consultar.
  // No se espera antes de responder: Wazuh no debe quedar bloqueado por una
  // llamada a VT/AbuseIPDB. Si no hay API key configurada, enrichIp no pega
  // a la red y esto es un no-op.
  //
  // Automatizacion (src/automation.js): en CU-01 decide DESPUES del
  // enriquecimiento (las politicas usan la reputacion de la IP); en CU-02 no
  // hay IP que enriquecer y decide enseguida. Tampoco bloquea la respuesta.
  let automation;
  if (fields.srcIp) {
    automation = enrichIp(fields.srcIp)
      .then(({ vt, abuseipdb }) => {
        if (!vt && !abuseipdb) return;
        return prisma.incident.update({
          where: { id: incident.id },
          data: { enrichmentVt: vt, enrichmentAbuseIpdb: abuseipdb },
        });
      })
      .catch((err) => console.error("No se pudo enriquecer el incidente:", err.message))
      .then(() => runAutomation(incident.id));
  } else {
    automation = runAutomation(incident.id);
  }
  // Solo en los tests (tests/jest.setup.js): esperar a la automatizacion
  // antes de responder, para que sea determinista y no quede trabajo
  // corriendo despues de que el test termina. En produccion, en segundo plano.
  if (process.env.AUTOMATION_INLINE === "1") await automation;

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
// La ejecucion (Wazuh, medicion, auditoria) es la misma que usa la
// automatizacion: src/mitigation.js.
async function manualAction(req, res, actionName) {
  const incident = await prisma.incident.findUnique({ where: { id: Number(req.params.id) } });
  if (!incident) {
    return res.status(404).json({ detail: "Incident not found" });
  }
  if (actionName === "block-ip" && !incident.srcIp) {
    return res.status(422).json({ detail: "Este incidente no tiene IP de origen para bloquear" });
  }

  let updated;
  try {
    updated = await mitigate(incident, actionName, req.user.sub);
  } catch (err) {
    return res.status(502).json({ detail: err.message });
  }

  res.status(200).json({
    incidentId: updated.id,
    srcIp: updated.srcIp,
    hostname: updated.hostname,
    agentId: updated.agentId,
    status: updated.status,
  });
}

app.post("/api/v1/incidents/:id/actions/block-ip", requireAuth, requireRole("admin", "analyst"), (req, res) =>
  manualAction(req, res, "block-ip")
);

app.post("/api/v1/incidents/:id/actions/isolate-host", requireAuth, requireRole("admin", "analyst"), (req, res) =>
  manualAction(req, res, "isolate-host")
);

// ---------------------------------------------------------------------------
// Automatizacion: cualquier rol la ve; solo un admin la cambia. Todo cambio
// queda auditado (la app ademas pide step-up antes de mandarlo).
// ---------------------------------------------------------------------------

app.get("/api/v1/automation", requireAuth, async (_req, res) => {
  res.json(await getAutomationConfig());
});

app.put("/api/v1/automation/settings", requireAuth, requireRole("admin"), async (req, res) => {
  const { mode, allowlist } = req.body || {};
  if (mode !== undefined && !MODES.includes(mode)) {
    return res.status(422).json({ detail: `mode debe ser uno de: ${MODES.join(", ")}` });
  }
  if (allowlist !== undefined && (!Array.isArray(allowlist) || allowlist.some((e) => typeof e !== "string"))) {
    return res.status(422).json({ detail: "allowlist debe ser una lista de IPs o CIDR" });
  }

  await ensureAutomationDefaults();
  const data = { updatedBy: req.user.sub };
  if (mode !== undefined) data.mode = mode;
  if (allowlist !== undefined) data.allowlist = JSON.stringify(allowlist.map((e) => e.trim()).filter(Boolean));
  await prisma.automationSettings.update({ where: { id: 1 }, data });

  const changes = [mode !== undefined && `mode -> ${mode}`, allowlist !== undefined && `allowlist (${allowlist.length})`];
  await logAudit("automation_updated", `Settings: ${changes.filter(Boolean).join(", ") || "no changes"}`, req.user.sub);
  res.json(await getAutomationConfig());
});

const CONDITION_KEYS = ["minSeverity", "minAbuseScore", "minVtMalicious", "minHashPositives", "fromCountries", "maxAssetCriticality"];

app.put("/api/v1/automation/policies/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const { enabled, conditions } = req.body || {};
  const policy = await prisma.automationPolicy.findUnique({ where: { id: Number(req.params.id) } });
  if (!policy) return res.status(404).json({ detail: "Policy not found" });

  if (enabled !== undefined && typeof enabled !== "boolean") {
    return res.status(422).json({ detail: "enabled debe ser true o false" });
  }
  if (conditions !== undefined) {
    const unknown = Object.keys(conditions).filter((k) => !CONDITION_KEYS.includes(k));
    if (unknown.length) return res.status(422).json({ detail: `Condiciones desconocidas: ${unknown.join(", ")}` });
    const numbersOk = ["minSeverity", "minAbuseScore", "minVtMalicious", "minHashPositives"].every(
      (k) => conditions[k] === undefined || (Number.isFinite(conditions[k]) && conditions[k] >= 0)
    );
    const critOk = conditions.maxAssetCriticality === undefined || CRITICALITIES.includes(conditions.maxAssetCriticality);
    const countriesOk = conditions.fromCountries === undefined || Array.isArray(conditions.fromCountries);
    if (!numbersOk || !critOk || !countriesOk) return res.status(422).json({ detail: "Condiciones invalidas" });
  }

  const data = {};
  if (enabled !== undefined) data.enabled = enabled;
  if (conditions !== undefined) data.conditions = JSON.stringify(conditions);
  await prisma.automationPolicy.update({ where: { id: policy.id }, data });

  const changes = [
    enabled !== undefined && (enabled ? "enabled" : "disabled"),
    conditions !== undefined && `conditions ${JSON.stringify(conditions)}`,
  ];
  await logAudit("automation_updated", `Policy "${policy.name}": ${changes.filter(Boolean).join(", ") || "no changes"}`, req.user.sub);
  res.json(await getAutomationConfig());
});

// Inventario de activos: alta o cambio de criticidad de un agente.
app.put("/api/v1/assets/:agentId", requireAuth, requireRole("admin"), async (req, res) => {
  const { agentId } = req.params;
  const { name, criticality } = req.body || {};
  if (!CRITICALITIES.includes(criticality)) {
    return res.status(422).json({ detail: `criticality debe ser una de: ${CRITICALITIES.join(", ")}` });
  }

  const asset = await prisma.asset.upsert({
    where: { agentId },
    update: { criticality, ...(name ? { name } : {}) },
    create: { agentId, name: name || `agent-${agentId}`, criticality },
  });
  await logAudit("automation_updated", `Asset ${asset.name} (${agentId}): criticality -> ${criticality}`, req.user.sub);
  res.json(asset);
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
      automationDecision: true,
    },
  });
  res.json(computeMetrics(incidents));
});

// Auditoria con filtros: ?category=access|users|incidents|response|automation
// (ver src/audit.js), ?incidentId=12, ?limit=50 (max 200). Cada evento trae
// su categoria.
app.get("/api/v1/audit", requireAuth, async (req, res) => {
  const { category, incidentId } = req.query;
  if (category !== undefined && !CATEGORIES[category]) {
    return res.status(422).json({ detail: `category debe ser una de: ${Object.keys(CATEGORIES).join(", ")}` });
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);

  const where = {};
  if (category) where.type = { in: CATEGORIES[category] };
  if (incidentId !== undefined) where.incidentId = Number(incidentId);

  const events = await prisma.auditEvent.findMany({ where, orderBy: { id: "desc" }, take: limit });
  res.json(events.map((e) => ({ ...e, category: categoryOf(e.type) })));
});

// Linea de tiempo del incidente: cada alerta que lo forma (la primera y las
// agrupadas) y cada evento de auditoria vinculado (automatizacion, acciones),
// en orden cronologico. Los incidentes anteriores al registro de alertas
// muestran solo la alerta original, reconstruida desde el incidente.
app.get("/api/v1/incidents/:id/timeline", requireAuth, async (req, res) => {
  const incident = await prisma.incident.findUnique({
    where: { id: Number(req.params.id) },
    include: { alerts: { orderBy: { id: "asc" } } },
  });
  if (!incident) return res.status(404).json({ detail: "Incident not found" });

  const alerts = incident.alerts.length
    ? incident.alerts
    : [{ id: null, ruleId: incident.ruleId, ruleDescription: incident.ruleDescription, severity: incident.severity, timestamp: incident.timestamp, srcIp: incident.srcIp, detail: null, hashPositives: incident.hashPositives }];
  const events = await prisma.auditEvent.findMany({ where: { incidentId: incident.id }, orderBy: { id: "asc" } });

  const timeline = [
    ...alerts.map((a, i) => ({ kind: "alert", at: new Date(a.timestamp).toISOString(), grouped: i > 0, ...a })),
    ...events.map((e) => ({ kind: "event", at: e.createdAt.toISOString(), category: categoryOf(e.type), ...e })),
  // Empate de hora: la alerta antes que lo que provoco; entre dos del mismo
  // tipo, el orden de llegada (sort estable).
  ].sort((a, b) => new Date(a.at) - new Date(b.at) || (a.kind === b.kind ? 0 : a.kind === "alert" ? -1 : 1));

  res.json(timeline);
});

if (require.main === module) {
  const port = process.env.PORT || 8000;
  // Admin inicial desde AUTH_USER / AUTH_PASSWORD si todavia no hay ninguno
  // (tambien se intenta en cada login, por si la base se recreo en caliente).
  ensureBootstrapAdmin().catch((err) => console.error("No se pudo crear el admin inicial:", err.message));
  ensureAutomationDefaults().catch((err) => console.error("No se pudo cargar la automatizacion:", err.message));
  backfillIncidentIds().catch((err) => console.error("No se pudo vincular la auditoria a los incidentes:", err.message));
  app.listen(port, () => console.log(`Micro-SOAR Orchestrator escuchando en :${port}`));
}

module.exports = { app };
