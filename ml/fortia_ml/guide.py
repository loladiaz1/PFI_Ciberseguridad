# Adaptador de GUIDE (Freitas et al., arXiv:2407.09017): filas de evidencia
# -> un registro por incidente en el esquema comun (schema.py).
#
# Columnas que NO se leen, a proposito:
# - ActionGrouped / ActionGranular: la accion que tomo el SOC, posterior al
#   triaje (filtraria la respuesta).
# - Id y los IDs de entidades (DeviceId, Sha256, IpAddress, AccountSid...):
#   identificadores anonimizados, el modelo memorizaria valores sin sentido.
#   AlertId se lee solo para contar alertas.
# - CountryCode / State / City: anonimizados (CountryCode 242 = 92 % de las
#   filas), no se pueden traducir a fromCountries.
# - LastVerdict: "Final verdict of threat analysis" (Tabla 4 del paper); no
#   queda claro si se completa antes o despues del triaje. Fuera del modelo
#   principal; solo entra con last_verdict=True, en una corrida aparte que
#   se reporta como cota superior con posible filtracion.
import numpy as np
import pandas as pd

from .schema import OPTIONAL, validate

GRADES = {"TruePositive": "true_positive", "BenignPositive": "benign_positive", "FalsePositive": "false_positive"}

COLUMNS = [
    "OrgId", "IncidentId", "AlertId", "Timestamp", "DetectorId", "Category", "IncidentGrade",
    "EntityType", "EvidenceRole", "SuspicionLevel", "ThreatFamily", "MitreTechniques", "AntispamDirection",
]

# Los 12 tipos de entidad mas frecuentes en GUIDE_Train (97 % de las filas);
# el resto se cuenta como "Other".
ENTITY_TYPES = [
    "Ip", "User", "MailMessage", "Machine", "File", "Url", "CloudLogonRequest", "Mailbox",
    "Process", "MailCluster", "CloudApplication", "CloudLogonSession",
]
ENTITY_COLUMNS = [f"n_ent_{t}" for t in ENTITY_TYPES + ["Other"]]

LAST_VERDICTS = {"Malicious": "n_lv_malicious", "Suspicious": "n_lv_suspicious", "NoThreatsFound": "n_lv_no_threats"}
LAST_VERDICT_COLUMNS = list(LAST_VERDICTS.values())


def in_sample(org_ids, frac):
    # Muestreo deterministico por organizacion: entra toda la org o nada.
    h = (np.asarray(org_ids, dtype=np.uint64) * np.uint64(2654435761)) % np.uint64(2**32)
    return (h % np.uint64(1000)) < np.uint64(round(frac * 1000))


def read_evidence(path, sample_orgs=None, last_verdict=False):
    ev = pd.read_csv(path, usecols=COLUMNS + (["LastVerdict"] if last_verdict else []), engine="pyarrow")
    if sample_orgs is not None:
        ev = ev[in_sample(ev["OrgId"], sample_orgs)]
    return ev


def aggregate(ev):
    # Si ev trae LastVerdict, suma un conteo por veredicto (corrida aparte).
    ev = ev.assign(Timestamp=pd.to_datetime(ev["Timestamp"], utc=True))
    ev = ev.sort_values(["OrgId", "IncidentId", "Timestamp"], kind="stable")
    keys = ["org_id", "incident_id"]
    entity = ev["EntityType"].where(ev["EntityType"].isin(ENTITY_TYPES), "Other")

    flags = pd.DataFrame({
        "org_id": ev["OrgId"],
        "incident_id": ev["IncidentId"],
        "n_impacted": ev["EvidenceRole"].eq("Impacted"),
        "n_suspicious": ev["SuspicionLevel"].notna(),
        "n_incriminated": ev["SuspicionLevel"].eq("Incriminated"),
        "n_threat_family": ev["ThreatFamily"].notna(),
        "n_mitre": ev["MitreTechniques"].notna(),
        "n_antispam": ev["AntispamDirection"].notna(),
    })
    for t, col in zip(ENTITY_TYPES + ["Other"], ENTITY_COLUMNS):
        flags[col] = entity.eq(t)
    if "LastVerdict" in ev.columns:
        for value, col in LAST_VERDICTS.items():
            flags[col] = ev["LastVerdict"].eq(value)
    counts = flags.groupby(keys, sort=False).sum().astype("int64")

    g = ev.groupby(["OrgId", "IncidentId"], sort=False)
    base = pd.DataFrame({
        "first_seen": g["Timestamp"].min(),
        "last_seen": g["Timestamp"].max(),
        "alert_count": g["AlertId"].nunique(),
        "evidence_count": g.size(),
        "detector_count": g["DetectorId"].nunique(),
        "category_count": g["Category"].nunique(),
        # Ya ordenado por Timestamp: first = la primera alerta del incidente.
        "rule": g["DetectorId"].first().astype(str),
        "category": g["Category"].first(),
        "grade": g["IncidentGrade"].first(),
    })
    base.index.names = keys

    inc = base.join(counts).reset_index()
    inc["dominant_entity"] = inc[ENTITY_COLUMNS].idxmax(axis=1).str.removeprefix("n_ent_")
    inc["verdict"] = inc.pop("grade").map(GRADES)
    inc["source"] = "guide"
    for c in OPTIONAL:
        inc[c] = np.nan
    return validate(inc)


def load_incidents(path, sample_orgs=None, last_verdict=False):
    # Incidentes con grado (en Train, 3,2 % no lo tiene).
    inc = aggregate(read_evidence(path, sample_orgs, last_verdict))
    return inc[inc["verdict"].notna()].reset_index(drop=True)
