// Limpieza unica del ruido que entro antes del filtro de alertas (13/10,
// ver progress.md): incidentes "new" de FIM / dpkg / rootcheck y sus eventos
// de auditoria "incident_detected". No toca incidentes de los casos de uso
// ni nada mitigado (blocked / isolated).
//
// Uso, desde orchestrator/ en la instancia, CON BACKUP ANTES:
//   node scripts/limpiar-ruido.js              -> solo muestra que borraria
//   node scripts/limpiar-ruido.js --confirmar  -> borra
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const NOISE_RULES = ["550", "553", "554", "2902", "2903", "2904", "510"];
const confirmed = process.argv.includes("--confirmar");
const prisma = new PrismaClient();

(async () => {
  const noise = await prisma.incident.findMany({
    where: { ruleId: { in: NOISE_RULES }, status: "new" },
    select: { id: true, ruleDescription: true },
  });
  const descriptions = [...new Set(noise.map((i) => i.ruleDescription).filter(Boolean))];
  const auditWhere = {
    type: "incident_detected",
    OR: descriptions.map((d) => ({ detail: { startsWith: d } })),
  };
  const auditCount = descriptions.length ? await prisma.auditEvent.count({ where: auditWhere }) : 0;

  console.log(`Incidentes de ruido: ${noise.length} | eventos de auditoria: ${auditCount}`);
  console.log(`Total antes: ${await prisma.incident.count()} incidentes`);

  if (!confirmed) {
    console.log("Modo prueba: no se borro nada. Correr con --confirmar para borrar.");
  } else if (noise.length > 0) {
    const [inc, audit] = await prisma.$transaction([
      prisma.incident.deleteMany({ where: { id: { in: noise.map((i) => i.id) } } }),
      prisma.auditEvent.deleteMany({ where: auditWhere }),
    ]);
    console.log(`Borrados: ${inc.count} incidentes, ${audit.count} eventos de auditoria`);
    console.log(`Total despues: ${await prisma.incident.count()} incidentes`);
  }
  await prisma.$disconnect();
})();
