const express = require("express");
const cors = require("cors");

const userRoutes = require("./routes/users");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "Micro-SOAR Orchestrator",
  });
});

app.use("/api/users", userRoutes);

module.exports = app;