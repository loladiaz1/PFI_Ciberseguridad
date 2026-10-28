import pandas as pd
import pytest


def evidence_rows(rows):
    # Filas de evidencia con el formato de GUIDE (solo las columnas que se leen).
    base = {
        "OrgId": 0, "IncidentId": 1, "AlertId": 1, "Timestamp": "2024-06-01T00:00:00.000Z",
        "DetectorId": 7, "Category": "InitialAccess", "IncidentGrade": "TruePositive",
        "EntityType": "Ip", "EvidenceRole": "Related", "SuspicionLevel": None, "ThreatFamily": None,
        "MitreTechniques": None, "AntispamDirection": None,
    }
    return pd.DataFrame([{**base, **r} for r in rows])


def incidents(rows):
    # Incidentes en el esquema comun, con lo minimo que usan baselines y politicas.
    base = {"org_id": 0, "incident_id": 0, "rule": "7", "dominant_entity": "Ip", "alert_count": 1,
            "verdict": "benign_positive", "first_seen": pd.Timestamp("2024-06-01", tz="UTC")}
    df = pd.DataFrame([{**base, **r} for r in rows])
    df["incident_id"] = range(len(df))
    return df


@pytest.fixture
def make_evidence():
    return evidence_rows


@pytest.fixture
def make_incidents():
    return incidents
