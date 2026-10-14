// Base de datos propia de los tests, creada de cero en cada corrida: los
// tests no dependen del estado de la base de desarrollo (por ejemplo, la
// automatizacion en modo "active" despues de una prueba manual en la app) y
// se comportan igual en la laptop y en CI.
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

module.exports = () => {
  const root = path.join(__dirname, "..");
  const dbFile = path.join(root, "prisma", "test.db");
  for (const f of [dbFile, `${dbFile}-journal`]) fs.rmSync(f, { force: true });

  // Relativo a prisma/schema.prisma. Corre en el mismo proceso que los tests
  // (--runInBand), asi que el cliente de Prisma de los tests usa esta base.
  process.env.DATABASE_URL = "file:./test.db";
  execSync("npx prisma db push --skip-generate", { cwd: root, env: process.env, stdio: "ignore" });
};
