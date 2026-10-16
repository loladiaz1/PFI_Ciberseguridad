// Metricas de tiempo de respuesta (RNF-05) a partir de los incidentes reales.
// Por caso de uso, tres tiempos:
//   - detectionToIngest: alerta de Wazuh (rule timestamp) -> incidente creado
//     en el orquestador. Mide el pipeline de deteccion (integratord + webhook).
//   - actionExecution: duracion de la llamada a la API de Wazuh que ejecuta
//     la accion (bloqueo / aislamiento), medida en el servidor.
//   - containment: alerta -> incidente mitigado POR UN ANALISTA. Incluye el
//     tiempo de decision humana; es el numero comparable con los 8-14 min del
//     acceso remoto tradicional.
//   - automatedContainment: alerta -> mitigado por la automatizacion
//     (src/automation.js). Separado para no mezclar los dos regimenes.
//   - timeToClose: alerta -> caso cerrado por el analista (MTTR, incluye la
//     investigacion despues de contener).
// Los relojes del manager y del orquestador se sincronizan con Amazon Time
// Sync (NTP), asi que la diferencia entre instancias es despreciable frente
// a los valores medidos (segundos).

// Percentil por rango mas cercano: siempre devuelve un valor observado.
function percentile(sorted, p) {
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)];
}

function summarize(values) {
  const sorted = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (sorted.length === 0) return { n: 0, p50Ms: null, p95Ms: null, maxMs: null };
  return {
    n: sorted.length,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    maxMs: sorted[sorted.length - 1],
  };
}

function useCaseOf(incident) {
  return incident.srcIp ? "CU-01" : "CU-02";
}

function computeMetrics(incidents) {
  const result = {};
  for (const useCase of ["CU-01", "CU-02"]) {
    const group = incidents.filter((i) => useCaseOf(i) === useCase);
    const alertMs = (i) => new Date(i.timestamp).getTime();
    const mitigatedAt = (i) => i.blockedAt ?? i.isolatedAt;

    result[useCase] = {
      detectionToIngest: summarize(
        group.filter((i) => i.ingestedAt).map((i) => new Date(i.ingestedAt).getTime() - alertMs(i))
      ),
      actionExecution: summarize(
        group.filter((i) => i.actionLatencyMs != null).map((i) => i.actionLatencyMs)
      ),
      // Solo incidentes medidos de punta a punta (con ingestedAt): los
      // anteriores a la instrumentacion no tienen la cadena completa.
      containment: summarize(
        group
          .filter((i) => i.ingestedAt && mitigatedAt(i) && i.automationDecision !== "executed")
          .map((i) => new Date(mitigatedAt(i)).getTime() - alertMs(i))
      ),
      timeToClose: summarize(
        group.filter((i) => i.ingestedAt && i.closedAt).map((i) => new Date(i.closedAt).getTime() - alertMs(i))
      ),
      automatedContainment: summarize(
        group
          .filter((i) => i.ingestedAt && mitigatedAt(i) && i.automationDecision === "executed")
          .map((i) => new Date(mitigatedAt(i)).getTime() - alertMs(i))
      ),
    };
  }
  return result;
}

module.exports = { computeMetrics, percentile, summarize };
