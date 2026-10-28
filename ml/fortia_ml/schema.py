# Esquema comun de entrada, a nivel incidente.
#
# Cada fuente (hoy solo GUIDE; despues los incidentes cerrados de Fortia y,
# si se aprueba, los tickets de Opsgenie) tiene un adaptador que produce un
# DataFrame con estas columnas. Features, lineas de base y politicas solo
# leen este esquema, nunca las columnas crudas de la fuente.
#
# Adaptador de Fortia (fase 2): excluir los casos con automationDecision =
# "executed"; si no, el modelo aprende de sus propias decisiones.

# Mismos veredictos que orchestrator/src/closure.js (VERDICTS).
VERDICTS = ("true_positive", "benign_positive", "false_positive")

REQUIRED = [
    "source",          # guide | fortia | ...
    "org_id",          # SOC / cliente
    "incident_id",
    "first_seen",      # datetime UTC de la primera alerta
    "last_seen",
    "rule",            # regla/detector de la primera alerta (Fortia: ruleId)
    "category",        # categoria de la primera alerta (Fortia: useCase)
    "alert_count",
    "evidence_count",
    "detector_count",
    "dominant_entity", # tipo de evidencia mas frecuente (Ip, User, File...)
    "verdict",         # etiqueta: uno de VERDICTS
]

# Contexto que usa orchestrator/src/automation.js y que GUIDE no trae: en
# GUIDE quedan en NaN.
OPTIONAL = ["severity", "asset_criticality", "abuse_score", "vt_malicious", "hash_positives", "country"]


def validate(df):
    missing = [c for c in REQUIRED + OPTIONAL if c not in df.columns]
    if missing:
        raise ValueError(f"faltan columnas del esquema comun: {missing}")
    bad = set(df["verdict"].dropna()) - set(VERDICTS)
    if bad:
        raise ValueError(f"veredictos fuera del esquema: {sorted(bad)}")
    return df
