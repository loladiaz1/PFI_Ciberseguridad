// Metricas de tiempo de respuesta (RNF-05): calculo puro + endpoint real.
jest.mock("../src/wazuh");

const request = require("supertest");
const bruteforceAlert = require("../mocks/wazuh_ssh_bruteforce.json");
const malwareAlert = require("../mocks/wazuh_malware_detected.json");
const { app } = require("../src/app");
const { prisma } = require("../src/db");
const { login } = require("../src/auth");
const { authenticate, blockIp, isolateHost } = require("../src/wazuh");
const { computeMetrics, percentile, summarize } = require("../src/metrics");

const token = login(process.env.AUTH_USER, process.env.AUTH_PASSWORD);
const auth = { Authorization: `Bearer ${token}` };

afterAll(async () => {
  await prisma.$disconnect();
});

describe("calculo", () => {
  test("percentil por rango mas cercano: devuelve siempre un valor observado", () => {
    const sorted = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    expect(percentile(sorted, 50)).toBe(500);
    expect(percentile(sorted, 95)).toBe(1000);
    expect(percentile([42], 95)).toBe(42);
  });

  test("summarize descarta valores invalidos y maneja el caso vacio", () => {
    expect(summarize([])).toEqual({ n: 0, p50Ms: null, p95Ms: null, maxMs: null });
    // negativo = reloj desfasado o dato corrupto; NaN = timestamp ilegible
    expect(summarize([3000, -5, NaN, 1000, 2000])).toEqual({ n: 3, p50Ms: 2000, p95Ms: 3000, maxMs: 3000 });
  });

  test("separa por caso de uso y mide los tres tiempos", () => {
    const alert = "2026-10-14T10:00:00.000+0000"; // formato real de Wazuh (+0000)
    const metrics = computeMetrics([
      // CU-01: ingesta a los 4 s, bloqueo a los 40 s, la accion tardo 1,2 s
      {
        srcIp: "203.0.113.9",
        timestamp: alert,
        ingestedAt: "2026-10-14T10:00:04.000Z",
        blockedAt: "2026-10-14T10:00:40.000Z",
        isolatedAt: null,
        actionLatencyMs: 1200,
      },
      // CU-02: ingesta a los 6 s, todavia sin mitigar
      { srcIp: null, timestamp: alert, ingestedAt: "2026-10-14T10:00:06.000Z", blockedAt: null, isolatedAt: null, actionLatencyMs: null },
      // incidente anterior a la instrumentacion: no entra en ninguna metrica de tiempo
      { srcIp: "198.51.100.1", timestamp: alert, ingestedAt: null, blockedAt: "2026-10-14T10:05:00.000Z", isolatedAt: null, actionLatencyMs: null },
    ]);

    expect(metrics["CU-01"].detectionToIngest).toEqual({ n: 1, p50Ms: 4000, p95Ms: 4000, maxMs: 4000 });
    expect(metrics["CU-01"].actionExecution).toEqual({ n: 1, p50Ms: 1200, p95Ms: 1200, maxMs: 1200 });
    expect(metrics["CU-01"].containment).toEqual({ n: 1, p50Ms: 40000, p95Ms: 40000, maxMs: 40000 });
    expect(metrics["CU-02"].detectionToIngest.p50Ms).toBe(6000);
    expect(metrics["CU-02"].containment.n).toBe(0);
  });
});

describe("GET /api/v1/metrics", () => {
  beforeEach(() => {
    authenticate.mockResolvedValue("fake-token");
    blockIp.mockResolvedValue({ error: 0, data: { total_failed_items: 0 } });
    isolateHost.mockResolvedValue({ error: 0, data: { total_failed_items: 0 } });
  });

  test("sin token -> 401", async () => {
    expect((await request(app).get("/api/v1/metrics")).status).toBe(401);
  });

  test("el webhook registra la ingesta y las acciones registran su duracion", async () => {
    // Alerta "recien emitida" para que la latencia de ingesta sea realista.
    const now = new Date().toISOString();
    const cu01 = await request(app).post("/api/v1/webhook/wazuh").send({ ...bruteforceAlert, timestamp: now });
    const cu02 = await request(app).post("/api/v1/webhook/wazuh").send({ ...malwareAlert, timestamp: now });
    await request(app).post(`/api/v1/incidents/${cu01.body.id}/actions/block-ip`).set(auth);
    await request(app).post(`/api/v1/incidents/${cu02.body.id}/actions/isolate-host`).set(auth);

    const blocked = await prisma.incident.findUnique({ where: { id: cu01.body.id } });
    const isolated = await prisma.incident.findUnique({ where: { id: cu02.body.id } });
    expect(blocked.ingestedAt).not.toBeNull();
    expect(blocked.actionLatencyMs).toBeGreaterThanOrEqual(0);
    expect(isolated.actionLatencyMs).toBeGreaterThanOrEqual(0);

    const resp = await request(app).get("/api/v1/metrics").set(auth);

    expect(resp.status).toBe(200);
    for (const useCase of ["CU-01", "CU-02"]) {
      const m = resp.body[useCase];
      expect(m.detectionToIngest.n).toBeGreaterThanOrEqual(1);
      expect(m.actionExecution.n).toBeGreaterThanOrEqual(1);
      expect(m.containment.n).toBeGreaterThanOrEqual(1);
      expect(m.containment.p95Ms).toBeGreaterThanOrEqual(m.containment.p50Ms);
    }
  });
});
