const express = require("express");
const rateLimit = require("express-rate-limit");
const { prisma } = require("./db");
const { normalizeWazuhAlert, isRelevantAlert } = require("./normalize");
const { authenticate, blockIp, isolateHost } = require("./wazuh");
const { enrichIp } = require("./enrichment");
const { login, requireAuth } = require("./auth");
const { computeMetrics } = require("./metrics");
const { deleteAccount } = require("./privacy");

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
  const token = login(username, password);

  if (!token) {
    return res.status(401).json({ detail: "Invalid credentials" });
  }

  await logAudit("login", "Logged in", username);
  res.status(200).json({ token });
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

  const incident = await prisma.incident.create({ data: { ...fields, ingestedAt: new Date() } });
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
  // upsert en vez de un seed aparte al bootear: no hay endpoint de registro
  // real, asi que la primera vez que este usuario pide su perfil es cuando
  // se crea la fila -- sin condicion de carrera con el arranque del server.
  const user = await prisma.user.upsert({
    where: { username: req.user.sub },
    update: {},
    create: {
      username: req.user.sub,
      name: "SOC Analyst",
      email: `${req.user.sub}@microsoar.dev`,
      role: req.user.role,
    },
  });
  res.json(user);
});

app.put("/api/v1/me", requireAuth, async (req, res) => {
  const { name, email } = req.body || {};
  if (!name || !email) {
    return res.status(422).json({ detail: "name and email son obligatorios" });
  }

  const user = await prisma.user.upsert({
    where: { username: req.user.sub },
    update: { name, email },
    create: { username: req.user.sub, name, email, role: req.user.role },
  });

  res.json(user);
});

// Derecho de supresion (Ley 25.326, art. 16): borra el perfil y seudonimiza
// el rastro de auditoria. Las credenciales del MVP son de configuracion (un
// solo usuario por env vars), no se guardan en la base: si la persona vuelve
// a iniciar sesion, GET /me crea un perfil nuevo y vacio.
app.delete("/api/v1/me", requireAuth, async (req, res) => {
  await deleteAccount(prisma, req.user.sub);
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

app.post("/api/v1/incidents/:id/actions/block-ip", requireAuth, async (req, res) => {
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

app.post("/api/v1/incidents/:id/actions/isolate-host", requireAuth, async (req, res) => {
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
  app.listen(port, () => console.log(`Micro-SOAR Orchestrator escuchando en :${port}`));
}

module.exports = { app };
