// Los tests no deben depender de que el .env local tenga (o no tenga) API
// keys reales de VT/AbuseIPDB -- sin esto, un dev con las keys cargadas
// dispara llamadas de red reales en cada test run (gasta cuota y deja
// promesas sin resolver que Jest reporta como "did not exit").
// Vacias y no borradas: src/db.js carga el .env con dotenv, que no pisa
// variables ya definidas pero SI completa las que faltan -- con "delete" las
// keys reales volvian y cada "npm test" local gastaba cuota de VT/AbuseIPDB.
process.env.VT_API_KEY = "";
process.env.ABUSEIPDB_API_KEY = "";

// wazuh.js esta mockeado en los tests que lo usan, pero app.js le pasa
// process.env.WAZUH_HOST -- en CI no hay .env y llegaba undefined. Valor
// fijo y no resoluble (.invalid): nunca se le pega de verdad.
process.env.WAZUH_HOST = "https://wazuh.invalid:55000";

// Agrupamiento desactivado por defecto en los tests: la mayoria postea la
// misma alerta varias veces y necesita un incidente nuevo cada vez.
// tests/grouping.test.js lo activa explicitamente.
process.env.GROUP_WINDOW_MS = "0";

// La automatizacion corre en segundo plano en produccion; en los tests, en
// linea (ver el webhook en src/app.js).
process.env.AUTOMATION_INLINE = "1";
