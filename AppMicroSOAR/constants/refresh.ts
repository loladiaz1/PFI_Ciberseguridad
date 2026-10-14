// Sin push notifications, las pantallas de incidentes se refrescan solas
// mientras estan abiertas (PLAN.md, riesgos: "caer a polling con app
// abierta"). Tambien hace reproducible la metrica de contencion (RNF-05):
// un incidente nuevo aparece en <= 10 s sin depender de que el analista
// refresque a mano.
export const REFRESH_MS = 10_000;
