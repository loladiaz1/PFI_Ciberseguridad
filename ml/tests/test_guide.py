import numpy as np
import pandas as pd
import pytest

from fortia_ml import guide
from fortia_ml.schema import OPTIONAL, REQUIRED, validate


def test_aggregate_one_row_per_incident(make_evidence):
    ev = make_evidence([
        {"IncidentId": 1, "AlertId": 10, "Timestamp": "2024-06-01T10:00:05.000Z", "DetectorId": 9, "EntityType": "User"},
        {"IncidentId": 1, "AlertId": 11, "Timestamp": "2024-06-01T10:00:00.000Z", "DetectorId": 7, "EntityType": "Ip"},
        {"IncidentId": 1, "AlertId": 11, "Timestamp": "2024-06-01T10:00:00.000Z", "DetectorId": 7, "EntityType": "Ip",
         "EvidenceRole": "Impacted", "SuspicionLevel": "Incriminated"},
        {"IncidentId": 2, "AlertId": 20, "IncidentGrade": "FalsePositive", "EntityType": "Registry"},
    ])
    inc = guide.aggregate(ev).set_index("incident_id")
    assert len(inc) == 2

    one = inc.loc[1]
    assert one["alert_count"] == 2
    assert one["evidence_count"] == 3
    assert one["detector_count"] == 2
    assert one["rule"] == "7"  # la de la primera alerta, no la de la primera fila
    assert one["last_seen"] - one["first_seen"] == pd.Timedelta(seconds=5)
    assert one["n_ent_Ip"] == 2 and one["n_ent_User"] == 1
    assert one["dominant_entity"] == "Ip"
    assert one["n_impacted"] == 1 and one["n_suspicious"] == 1 and one["n_incriminated"] == 1
    assert one["verdict"] == "true_positive"

    two = inc.loc[2]
    assert two["n_ent_Other"] == 1 and two["dominant_entity"] == "Other"
    assert two["verdict"] == "false_positive"


def test_aggregate_produces_common_schema_without_post_triage_columns(make_evidence):
    inc = guide.aggregate(make_evidence([{}]))
    assert set(REQUIRED + OPTIONAL) <= set(inc.columns)
    assert inc[OPTIONAL].isna().all().all()
    for leaked in ("ActionGrouped", "ActionGranular", "LastVerdict", "AlertId", "IncidentGrade"):
        assert leaked not in inc.columns
    assert "ActionGrouped" not in guide.COLUMNS and "ActionGranular" not in guide.COLUMNS


def test_same_incident_id_in_two_orgs_are_different_incidents(make_evidence):
    inc = guide.aggregate(make_evidence([{"OrgId": 0}, {"OrgId": 1}]))
    assert len(inc) == 2


def test_ungraded_incident_has_no_verdict(make_evidence):
    inc = guide.aggregate(make_evidence([{"IncidentGrade": None}]))
    assert inc["verdict"].isna().all()


def test_sample_is_deterministic_and_by_org():
    orgs = np.arange(5000)
    a = guide.in_sample(orgs, 0.1)
    assert (a == guide.in_sample(orgs, 0.1)).all()
    assert 0.07 < a.mean() < 0.13
    assert guide.in_sample(orgs, 1.0).all()


def test_validate_rejects_unknown_verdict(make_evidence):
    inc = guide.aggregate(make_evidence([{}]))
    inc.loc[0, "verdict"] = "maybe"
    with pytest.raises(ValueError):
        validate(inc)
