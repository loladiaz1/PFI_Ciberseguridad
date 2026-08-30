const express = require("express");
const rateLimit = require("express-rate-limit");
const { prisma } = require("./db");
const { normalizeWazuhAlert } = require("./normalize");
const { authenticate, blockIp } = require("./wazuh");
const { login, requireAuth } = require("./auth");

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

function logAudit(type, detail) {
  return prisma.auditEvent.create({ data: { type, detail } }).catch((err) => {
    console.error("No se pudo registrar el evento de auditoria:", err.message);
  });
}

app.post("/api/v1/auth/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  const token = login(username, password);

  if (!token) {
    return res.status(401).json({ detail: "Invalid credentials" });
  }

  await logAudit("login", `${username} logged in`);
  res.status(200).json({ token });
});

app.post("/api/v1/webhook/wazuh", async (req, res) => {
  let fields;
  try {
    fields = normalizeWazuhAlert(req.body);
  } catch (err) {
    return res.status(422).json({ detail: err.message });
  }

  const incident = await prisma.incident.create({ data: fields });
  await logAudit(
    "incident_detected",
    `${fields.ruleDescription ?? `Rule ${fields.ruleId}`} from ${fields.srcIp}`
  );
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
    data: { status: "blocked", blockedAt: new Date() },
  });

  await logAudit("ip_blocked", `Blocked ${updated.srcIp} (incident #${updated.id})`);

  res.status(200).json({
    incidentId: updated.id,
    srcIp: updated.srcIp,
    agentId: updated.agentId,
    status: updated.status,
  });
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
