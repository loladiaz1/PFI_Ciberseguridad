const express = require("express");
const { prisma } = require("./db");
const { normalizeWazuhAlert } = require("./normalize");

const app = express();
app.use(express.json());

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

app.get("/api/v1/incidents", async (_req, res) => {
  const incidents = await prisma.incident.findMany({ orderBy: { id: "desc" } });
  res.json(incidents);
});

if (require.main === module) {
  const port = process.env.PORT || 8000;
  app.listen(port, () => console.log(`Micro-SOAR Orchestrator escuchando en :${port}`));
}

module.exports = { app };
