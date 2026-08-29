const express = require("express");
const rateLimit = require("express-rate-limit");
const { prisma } = require("./db");
const { normalizeWazuhAlert } = require("./normalize");
const { authenticate, blockIp } = require("./wazuh");
const { login, requireAuth } = require("./auth");

const app = express();
app.use(express.json());

// El propio login es un endpoint de password guessing en potencia -- 5
// intentos cada 15 min por IP, misma logica que Wazuh detecta del lado del
// atacante pero aplicada a nuestro propio backend.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { detail: "Too many login attempts, try again later" },
});

app.post("/api/v1/auth/login", loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  const token = login(username, password);

  if (!token) {
    return res.status(401).json({ detail: "Invalid credentials" });
  }

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
  res.status(201).json(incident);
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

  res.status(200).json({
    incidentId: updated.id,
    srcIp: updated.srcIp,
    agentId: updated.agentId,
    status: updated.status,
  });
});

if (require.main === module) {
  const port = process.env.PORT || 8000;
  app.listen(port, () => console.log(`Micro-SOAR Orchestrator escuchando en :${port}`));
}

module.exports = { app };
