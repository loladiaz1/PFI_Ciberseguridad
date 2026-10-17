const express = require("express");
const rateLimit = require("express-rate-limit");
const { prisma } = require("./db");
const { normalizeWazuhAlert, isRelevantAlert, alertDetailOf, backfillUseCases } = require("./normalize");
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
const { VERDICTS, VERDICT_LABELS, TAGS, NOTE_REQUIRED, MIN_NOTE_LENGTH, USE_CASE_TAG, tagsOf, mergeTags, validateClosure } = require("./closure");
const { CATEGORIES, categoryOf, logAudit, backfillIncidentIds } = require("./audit");
const { mitigate } = require("./mitigation");
const { restoreEmails, publicEmail } = require("./emailActions");
const { startReportPolling } = require("./email");
const {
  MODES,
  CRITICALITIES,
  ensureAutomationDefaults,
  getAutomationConfig,
  isValidAllowlistEntry,
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
  message: { detail: "Demasiados intentos de inicio de sesión, intentá más tarde" },
});

app.post("/api/v1/auth/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  const { user, error } = await authenticateUser(username, password);

  if (error === "pending") {
    return res.status(403).json({ detail: "La cuenta está pendiente de aprobación por un administrador" });
  }
  if (error === "disabled") {
    return res.status(403).json({ detail: "La cuenta está desactivada" });
  }
  if (error) {
    return res.status(401).json({ detail: "Usuario o contraseña incorrectos" });
  }

  await logAudit("login", "Inicio de sesión", user.username);
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
  message: { detail: "Demasiados intentos de registro, intentá más tarde" },
});

app.post("/api/v1/auth/register", registerLimiter, async (req, res) => {
  const { username, name, email, password } = req.body || {};
  if (!username || !name || !email || !password) {
    return res.status(422).json({ detail: "username, name, email y password son obligatorios" });
  }
  if (!validatePassword(password)) {
    return res.status(422).json({ detail: "La contraseña es demasiado débil" });
  }
  if (await prisma.user.findUnique({ where: { username } })) {
    return res.status(409).json({ detail: "Ese usuario ya está registrado" });
  }

  const user = await prisma.user.create({
    data: { username, name, email, role: "analyst", status: "pending", passwordHash: await hashPassword(password) },
  });
  await logAudit("user_registered", "Registro, pendiente de aprobación", username);
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
    await logAudit("alert_grouped", `Regla ${fields.ruleId} sumada al incidente #${grouped.id}`, null, grouped.id);
    // Una alerta nueva es informacion nueva (severidad, hash, o el modo /
    // las politicas pudieron cambiar desde la primera): se vuelve a evaluar.
    // Si el incidente ya se mitigo, runAutomation no hace nada.
    const reevaluation = runAutomation(grouped.id);
    if (process.env.AUTOMATION_INLINE === "1") await reevaluation;
    return res.status(200).json({ ...grouped, grouped: true });
  }

  const incident = await prisma.incident.create({
    data: {
      ...fields,
      ingestedAt: now,
      lastSeenAt: now,
      ruleIds: JSON.stringify([fields.ruleId]),
      tags: mergeTags([], [USE_CASE_TAG[fields.useCase]]),
    },
  });
  await prisma.incidentAlert.create({ data: alertRecord(incident.id, fields, req.body) });
  const ruleLabel = fields.ruleDescription ?? `Regla ${fields.ruleId}`;
  await logAudit(
    "incident_detected",
    fields.srcIp ? `${ruleLabel} desde ${fields.srcIp}` : `${ruleLabel} en ${fields.hostname}`,
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
    return res.status(422).json({ detail: "name y email son obligatorios" });
  }

  const user = await prisma.user.update({ where: { username: req.user.sub }, data: { name, email } });
  res.json(publicUser(user));
});

const LAST_ADMIN = { detail: "No se puede quitar al último administrador activo" };

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
  if (!target) return res.status(404).json({ detail: "Usuario no encontrado" });

  const losesAdmin = (role !== undefined && role !== "admin") || status === "disabled";
  if (losesAdmin && (await isLastActiveAdmin(username))) return res.status(409).json(LAST_ADMIN);

  const data = {};
  if (role !== undefined) data.role = role;
  if (status !== undefined) data.status = status;
  const updated = await prisma.user.update({ where: { username }, data });

  const changes = [];
  if (status === "active" && target.status === "pending") changes.push("aprobado");
  else if (status !== undefined && status !== target.status) changes.push(`estado ${target.status} -> ${status}`);
  if (role !== undefined && role !== target.role) changes.push(`rol ${target.role} -> ${role}`);
  await logAudit("user_updated", `Usuario ${username}: ${changes.join(", ") || "sin cambios"}`, req.user.sub);

  res.json(publicUser(updated));
});

// Rechazar un registro o dar de baja a un usuario: misma supresion que
// DELETE /me (borra el usuario, seudonimiza su auditoria).
app.delete("/api/v1/users/:username", requireAuth, requireRole("admin"), async (req, res) => {
  const { username } = req.params;
  if (!(await prisma.user.findUnique({ where: { username } }))) {
    return res.status(404).json({ detail: "Usuario no encontrado" });
  }
  if (await isLastActiveAdmin(username)) return res.status(409).json(LAST_ADMIN);

  const pseudonym = await deleteAccount(prisma, username);
  await logAudit("user_removed", `Usuario eliminado (${pseudonym})`, req.user.sub);
  res.status(204).end();
});

// Lista de incidentes con filtros (todos opcionales y combinables):
//   status=open|closed           contained=yes|no|auto (auto = por la automatizacion)
//   verdict=true_positive|...    tag=<clave del catalogo>
//   useCase=CU-01|CU-02|CU-03    minSeverity=<0-15>
//   q=<texto>  (#12 o 12 = numero de incidente; si no, busca en host e IP)
//   sort=recent (default) | severity
const INCIDENT_FILTERS = {
  status: ["open", "closed"],
  contained: ["yes", "no", "auto"],
  verdict: VERDICTS,
  useCase: ["CU-01", "CU-02", "CU-03"],
  sort: ["recent", "severity"],
};

app.get("/api/v1/incidents", requireAuth, async (req, res) => {
  const { status, contained, verdict, tag, useCase, minSeverity, q, sort } = req.query;
  for (const [key, allowed] of Object.entries(INCIDENT_FILTERS)) {
    if (req.query[key] !== undefined && !allowed.includes(req.query[key])) {
      return res.status(422).json({ detail: `${key} debe ser uno de: ${allowed.join(", ")}` });
    }
  }
  if (tag !== undefined && !TAGS[tag]) return res.status(422).json({ detail: "tag fuera del catalogo" });

  const and = [];
  if (status === "open") and.push({ closedAt: null });
  if (status === "closed") and.push({ closedAt: { not: null } });
  if (contained === "yes") and.push({ status: { in: ["blocked", "isolated", "quarantined"] } });
  if (contained === "no") and.push({ status: "new" });
  if (contained === "auto") and.push({ automationDecision: "executed" });
  if (verdict) and.push({ verdict });
  if (useCase) and.push({ useCase });
  if (minSeverity !== undefined) and.push({ severity: { gte: Number(minSeverity) || 0 } });
  // tags es JSON ("[\"brute_force\",...]"): se busca la clave entre comillas.
  if (tag) and.push({ tags: { contains: `"${tag}"` } });
  if (q && q.trim()) {
    const text = q.trim().replace(/^#/, "");
    and.push(/^\d+$/.test(text) ? { id: Number(text) } : { OR: [{ hostname: { contains: text } }, { srcIp: { contains: text } }] });
  }

  const incidents = await prisma.incident.findMany({
    where: and.length ? { AND: and } : {},
    orderBy: sort === "severity" ? [{ severity: "desc" }, { id: "desc" }] : { id: "desc" },
  });
  res.json(incidents);
});

// Catalogo de cierre: veredictos y etiquetas (fuente unica para la app).
app.get("/api/v1/closure-catalog", requireAuth, (_req, res) => {
  res.json({ verdicts: VERDICTS, noteRequired: NOTE_REQUIRED, minNoteLength: MIN_NOTE_LENGTH, tags: TAGS });
});

// Cerrar un caso: veredicto + etiquetas + nota (obligatoria para benigno y
// falso positivo). El step-up para "falso positivo" lo pide la app (la
// biometria es local al dispositivo); el backend valida rol y datos y audita.
app.post("/api/v1/incidents/:id/close", requireAuth, requireRole("admin", "analyst"), async (req, res) => {
  const incident = await prisma.incident.findUnique({ where: { id: Number(req.params.id) } });
  if (!incident) return res.status(404).json({ detail: "Incidente no encontrado" });
  if (incident.closedAt) return res.status(409).json({ detail: "El incidente ya está cerrado" });

  const { verdict, tags = [], note } = req.body || {};
  const invalid = validateClosure({ verdict, tags, note });
  if (invalid) return res.status(422).json({ detail: invalid });

  const updated = await prisma.incident.update({
    where: { id: incident.id },
    data: {
      closedAt: new Date(),
      closedBy: req.user.sub,
      verdict,
      closingNote: note?.trim() || null,
      tags: mergeTags(tagsOf(incident), tags),
    },
  });
  await logAudit("incident_closed", `Cierre del incidente #${incident.id} como ${VERDICT_LABELS[verdict]}`, req.user.sub, incident.id);
  res.json(updated);
});

// Reabrir: informacion nueva despues del cierre. Nota obligatoria; el
// veredicto anterior queda en la auditoria.
app.post("/api/v1/incidents/:id/reopen", requireAuth, requireRole("admin", "analyst"), async (req, res) => {
  const incident = await prisma.incident.findUnique({ where: { id: Number(req.params.id) } });
  if (!incident) return res.status(404).json({ detail: "Incidente no encontrado" });
  if (!incident.closedAt) return res.status(409).json({ detail: "El incidente no está cerrado" });

  const { note } = req.body || {};
  if (typeof note !== "string" || note.trim().length < MIN_NOTE_LENGTH) {
    return res.status(422).json({ detail: `Una nota de al menos ${MIN_NOTE_LENGTH} caracteres es obligatoria para reabrir` });
  }

  const updated = await prisma.incident.update({
    where: { id: incident.id },
    data: { closedAt: null, closedBy: null, verdict: null, closingNote: null },
  });
  await logAudit(
    "incident_reopened",
    `Reapertura del incidente #${incident.id} (era ${VERDICT_LABELS[incident.verdict]}): ${note.trim()}`,
    req.user.sub,
    incident.id
  );
  res.json(updated);
});

// Incluye los correos de la campana (CU-03; lista vacia en CU-01 / CU-02).
app.get("/api/v1/incidents/:id", requireAuth, async (req, res) => {
  const incident = await prisma.incident.findUnique({
    where: { id: Number(req.params.id) },
    include: { emails: { orderBy: { id: "asc" } } },
  });
  if (!incident) {
    return res.status(404).json({ detail: "Incidente no encontrado" });
  }
  res.json({ ...incident, emails: incident.emails.map(publicEmail) });
});

// messageIds (opcional, CU-03): ids de los correos de la campana sobre los
// que actuar; sin el, todos. Devuelve el error o null.
function invalidMessageIds(messageIds) {
  if (messageIds === undefined) return null;
  const ok = Array.isArray(messageIds) && messageIds.length > 0 && messageIds.every(Number.isInteger);
  return ok ? null : "messageIds debe ser una lista de ids de correos del incidente";
}

const WRONG_USE_CASE = { detail: "La acción no corresponde al caso de uso del incidente" };

// Acciones de contencion: admin y analyst. El auditor es solo lectura.
// La ejecucion (Wazuh / servidor de correo, medicion, auditoria) es la misma
// que usa la automatizacion: src/mitigation.js.
async function manualAction(req, res, actionName) {
  const incident = await prisma.incident.findUnique({ where: { id: Number(req.params.id) } });
  if (!incident) {
    return res.status(404).json({ detail: "Incidente no encontrado" });
  }
  if (actionName === "block-ip" && !incident.srcIp) {
    return res.status(422).json({ detail: "Este incidente no tiene IP de origen para bloquear" });
  }
  // Un correo solo se pone en cuarentena, y la cuarentena es solo para correos.
  if ((incident.useCase === "CU-03") !== (actionName === "quarantine-email")) {
    return res.status(422).json(WRONG_USE_CASE);
  }
  const { messageIds } = req.body || {};
  const invalid = invalidMessageIds(messageIds);
  if (invalid) return res.status(422).json({ detail: invalid });

  let updated;
  try {
    updated = await mitigate(incident, actionName, req.user.sub, { options: { messageIds } });
  } catch (err) {
    // El intento fallido tambien queda en la auditoria: quien lo hizo, sobre
    // que incidente y por que fallo.
    const target = {
      "block-ip": `el bloqueo de ${incident.srcIp}`,
      "isolate-host": `el aislamiento de ${incident.hostname}`,
      "quarantine-email": "la cuarentena del correo",
    }[actionName];
    await logAudit("mitigation_failed", `Falló ${target} (incidente #${incident.id}): ${err.message}`, req.user.sub, incident.id);
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

app.post("/api/v1/incidents/:id/actions/quarantine-email", requireAuth, requireRole("admin", "analyst"), (req, res) =>
  manualAction(req, res, "quarantine-email")
);

// Deshacer la cuarentena (CU-03): no es una accion de contencion sino su
// reverso, asi que no pasa por mitigate(). Si no queda ningun correo en
// cuarentena, el incidente pasa a "restored".
app.post("/api/v1/incidents/:id/actions/restore-email", requireAuth, requireRole("admin", "analyst"), async (req, res) => {
  const incident = await prisma.incident.findUnique({ where: { id: Number(req.params.id) } });
  if (!incident) return res.status(404).json({ detail: "Incidente no encontrado" });
  if (incident.useCase !== "CU-03") return res.status(422).json(WRONG_USE_CASE);
  const { messageIds } = req.body || {};
  const invalid = invalidMessageIds(messageIds);
  if (invalid) return res.status(422).json({ detail: invalid });

  let result;
  try {
    result = await restoreEmails(incident, messageIds);
  } catch (err) {
    await logAudit("mitigation_failed", `Falló la restauración del correo (incidente #${incident.id}): ${err.message}`, req.user.sub, incident.id);
    return res.status(502).json({ detail: err.message });
  }
  const updated =
    result.remaining === 0 ? await prisma.incident.update({ where: { id: incident.id }, data: { status: "restored" } }) : incident;
  await logAudit(
    "email_restored",
    `Restauración de ${result.emails} correo(s) en ${result.mailboxes} buzón(es) (incidente #${incident.id})`,
    req.user.sub,
    incident.id
  );
  res.status(200).json({ incidentId: updated.id, status: updated.status, ...result });
});

// ---------------------------------------------------------------------------
// Automatizacion: cualquier rol la ve; solo un admin la cambia. Todo cambio
// queda auditado (la app ademas pide step-up antes de mandarlo).
// ---------------------------------------------------------------------------

app.get("/api/v1/automation", requireAuth, async (_req, res) => {
  res.json(await getAutomationConfig());
});

app.put("/api/v1/automation/settings", requireAuth, requireRole("admin"), async (req, res) => {
  const { mode, allowlist, defaultCriticality, maxActions, windowMinutes } = req.body || {};
  if (mode !== undefined && !MODES.includes(mode)) {
    return res.status(422).json({ detail: `mode debe ser uno de: ${MODES.join(", ")}` });
  }
  if (allowlist !== undefined && (!Array.isArray(allowlist) || allowlist.some((e) => typeof e !== "string"))) {
    return res.status(422).json({ detail: "allowlist debe ser una lista de IPs o CIDR" });
  }
  const entries = allowlist === undefined ? undefined : allowlist.map((e) => e.trim()).filter(Boolean);
  const invalid = entries?.filter((e) => !isValidAllowlistEntry(e)) ?? [];
  if (invalid.length) {
    return res.status(422).json({ detail: `Entradas invalidas en la allowlist: ${invalid.join(", ")}` });
  }
  if (defaultCriticality !== undefined && !CRITICALITIES.includes(defaultCriticality)) {
    return res.status(422).json({ detail: `defaultCriticality debe ser una de: ${CRITICALITIES.join(", ")}` });
  }
  const intIn = (v, min, max) => v === undefined || (Number.isInteger(v) && v >= min && v <= max);
  if (!intIn(maxActions, 1, 1000) || !intIn(windowMinutes, 1, 1440)) {
    return res.status(422).json({ detail: "maxActions debe ser 1-1000 y windowMinutes 1-1440 (enteros)" });
  }

  await ensureAutomationDefaults();
  const before = await prisma.automationSettings.findUnique({ where: { id: 1 } });
  const data = { updatedBy: req.user.sub };
  if (mode !== undefined) data.mode = mode;
  if (entries !== undefined) data.allowlist = JSON.stringify(entries);
  if (defaultCriticality !== undefined) data.defaultCriticality = defaultCriticality;
  if (maxActions !== undefined) data.maxActions = maxActions;
  if (windowMinutes !== undefined) data.windowMinutes = windowMinutes;
  await prisma.automationSettings.update({ where: { id: 1 }, data });

  // Auditoria con el valor anterior y el nuevo de cada campo que cambio.
  const changes = [];
  const diff = (label, from, to) => {
    if (to !== undefined && String(from) !== String(to)) changes.push(`${label} ${from} -> ${to}`);
  };
  diff("mode", before.mode, mode);
  diff("defaultCriticality", before.defaultCriticality, defaultCriticality);
  diff("maxActions", before.maxActions, maxActions);
  diff("windowMinutes", before.windowMinutes, windowMinutes);
  if (entries !== undefined && before.allowlist !== JSON.stringify(entries)) {
    changes.push(`allowlist ${before.allowlist} -> ${JSON.stringify(entries)}`);
  }
  await logAudit("automation_updated", `Ajustes: ${changes.join(", ") || "sin cambios"}`, req.user.sub);
  res.json(await getAutomationConfig());
});

const CONDITION_KEYS = ["minSeverity", "minAbuseScore", "minVtMalicious", "minHashPositives", "fromCountries", "maxAssetCriticality"];

app.put("/api/v1/automation/policies/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const { enabled, conditions } = req.body || {};
  const policy = await prisma.automationPolicy.findUnique({ where: { id: Number(req.params.id) } });
  if (!policy) return res.status(404).json({ detail: "Política no encontrada" });

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

  const changes = [];
  if (enabled !== undefined && enabled !== policy.enabled) changes.push(`enabled ${policy.enabled} -> ${enabled}`);
  if (conditions !== undefined && JSON.stringify(conditions) !== policy.conditions) {
    changes.push(`conditions ${policy.conditions} -> ${JSON.stringify(conditions)}`);
  }
  await logAudit("automation_updated", `Política "${policy.name}": ${changes.join(", ") || "sin cambios"}`, req.user.sub);
  res.json(await getAutomationConfig());
});

// Inventario de activos: alta o cambio de criticidad de un agente.
app.put("/api/v1/assets/:agentId", requireAuth, requireRole("admin"), async (req, res) => {
  const { agentId } = req.params;
  const { name, criticality } = req.body || {};
  if (!CRITICALITIES.includes(criticality)) {
    return res.status(422).json({ detail: `criticality debe ser una de: ${CRITICALITIES.join(", ")}` });
  }

  const before = await prisma.asset.findUnique({ where: { agentId } });
  const asset = await prisma.asset.upsert({
    where: { agentId },
    update: { criticality, ...(name ? { name } : {}) },
    create: { agentId, name: name || `agent-${agentId}`, criticality },
  });
  await logAudit(
    "automation_updated",
    `Activo ${asset.name} (${agentId}): criticidad ${before ? before.criticality : "(nuevo)"} -> ${criticality}`,
    req.user.sub
  );
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
      quarantinedAt: true,
      useCase: true,
      actionLatencyMs: true,
      automationDecision: true,
      closedAt: true,
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
  if (!incident) return res.status(404).json({ detail: "Incidente no encontrado" });

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
  backfillUseCases(prisma).catch((err) => console.error("No se pudo completar el caso de uso de los incidentes:", err.message));
  startReportPolling();
  app.listen(port, () => console.log(`Micro-SOAR Orchestrator escuchando en :${port}`));
}

module.exports = { app };
