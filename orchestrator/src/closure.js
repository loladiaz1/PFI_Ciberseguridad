// Cierre de casos: veredicto, etiquetas y nota del analista.
//
// Los tres veredictos son la misma taxonomia que usa el triaje de incidentes
// en la industria (y el dataset GUIDE de Microsoft): cada cierre queda como
// un ejemplo etiquetado por un humano, base para un modelo futuro que
// aprenda de las decisiones del analista.
const VERDICTS = ["true_positive", "benign_positive", "false_positive"];

// Justificar un cierre sin ataque real es obligatorio: descartar una alerta
// es la decision que mas cuesta si esta mal.
const NOTE_REQUIRED = ["benign_positive", "false_positive"];
const MIN_NOTE_LENGTH = 10;

// Catalogo fijo de etiquetas (clave -> texto en la app).
const TAGS = {
  brute_force: "Fuerza bruta",
  malware: "Malware",
  phishing: "Phishing",
  ip_blocked: "IP bloqueada",
  host_isolated: "Host aislado",
  email_quarantined: "Correo en cuarentena",
  escalated: "Escalado",
  authorized_activity: "Actividad autorizada",
  test_exercise: "Prueba / ejercicio",
  recurring_attacker: "Atacante recurrente",
  rule_tuning_needed: "Ajustar la regla",
};

// Texto de cada veredicto en la auditoria.
const VERDICT_LABELS = {
  true_positive: "verdadero positivo",
  benign_positive: "benigno positivo",
  false_positive: "falso positivo",
};

// Etiquetas que pone el sistema: por caso de uso al crear el incidente, y
// por accion al contener (la ponga el analista o la automatizacion).
const USE_CASE_TAG = { "CU-01": "brute_force", "CU-02": "malware", "CU-03": "phishing" };
const ACTION_TAG = { "block-ip": "ip_blocked", "isolate-host": "host_isolated", "quarantine-email": "email_quarantined" };

function tagsOf(incident) {
  return incident?.tags ? JSON.parse(incident.tags) : [];
}

// Union sin repetir, en el orden del catalogo.
function mergeTags(current, extra) {
  const all = new Set([...current, ...extra]);
  return JSON.stringify(Object.keys(TAGS).filter((t) => all.has(t)));
}

// Devuelve el error de validacion, o null si el cierre es valido.
function validateClosure({ verdict, tags = [], note }) {
  if (!VERDICTS.includes(verdict)) return `verdict debe ser uno de: ${VERDICTS.join(", ")}`;
  if (!Array.isArray(tags) || tags.some((t) => !TAGS[t])) return "tags tiene etiquetas fuera del catalogo";
  if (NOTE_REQUIRED.includes(verdict) && (typeof note !== "string" || note.trim().length < MIN_NOTE_LENGTH)) {
    return `Una nota de al menos ${MIN_NOTE_LENGTH} caracteres es obligatoria para ${verdict}`;
  }
  return null;
}

module.exports = {
  VERDICT_LABELS,
  VERDICTS,
  NOTE_REQUIRED,
  MIN_NOTE_LENGTH,
  TAGS,
  USE_CASE_TAG,
  ACTION_TAG,
  tagsOf,
  mergeTags,
  validateClosure,
};
