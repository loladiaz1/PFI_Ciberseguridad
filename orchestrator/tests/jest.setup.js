// Los tests no deben depender de que el .env local tenga (o no tenga) API
// keys reales de VT/AbuseIPDB -- sin esto, un dev con las keys cargadas
// dispara llamadas de red reales en cada test run (gasta cuota y deja
// promesas sin resolver que Jest reporta como "did not exit").
delete process.env.VT_API_KEY;
delete process.env.ABUSEIPDB_API_KEY;
