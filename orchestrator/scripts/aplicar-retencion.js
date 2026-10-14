// Politica de retencion de datos personales (Ley 25.326, art. 4 inc. 7):
// enmascara las IPs de origen (red /24) y descarta el enriquecimiento de los
// incidentes y eventos de auditoria mas viejos que RETENTION_DAYS (default 90).
// Ver src/privacy.js.
//
// Uso, desde orchestrator/ en la instancia, CON BACKUP ANTES:
//   node scripts/aplicar-retencion.js              -> solo muestra que cambiaria
//   node scripts/aplicar-retencion.js --confirmar  -> aplica
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { applyRetention, DEFAULT_RETENTION_DAYS } = require("../src/privacy");

const days = Number(process.env.RETENTION_DAYS) || DEFAULT_RETENTION_DAYS;
const confirmed = process.argv.includes("--confirmar");
const prisma = new PrismaClient();

(async () => {
  const r = await applyRetention(prisma, { days, dryRun: !confirmed });
  console.log(`Retencion: ${days} dias (corte ${r.cutoff.toISOString()})`);
  console.log(`Incidentes con IP a enmascarar: ${r.incidentsMasked} | eventos de auditoria: ${r.auditMasked}`);
  console.log(confirmed ? "Aplicado." : "Modo prueba: no se modifico nada. Correr con --confirmar para aplicar.");
  await prisma.$disconnect();
})();
