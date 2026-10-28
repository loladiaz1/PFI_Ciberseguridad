import pandas as pd

from fortia_ml import guide
from fortia_ml.baselines import LookupTable, majority
from fortia_ml.features import CATEGORICAL, FeatureBuilder


def _incidents(make_evidence, n=60):
    rows = []
    grades = ["TruePositive", "BenignPositive", "FalsePositive"]
    for i in range(n):
        tp = i % 3 == 0
        rows.append({
            "OrgId": i % 2, "IncidentId": i, "AlertId": i, "DetectorId": i % 3,
            "Category": "Malware" if tp else "InitialAccess", "EntityType": "File" if tp else "Ip",
            "IncidentGrade": grades[i % 3],
        })
    return guide.aggregate(make_evidence(rows))


def test_features_have_no_ids_or_label(make_evidence):
    inc = _incidents(make_evidence)
    X = FeatureBuilder().fit_transform(inc)
    for col in ("org_id", "incident_id", "verdict", "rule", "org_rule", "first_seen", "last_seen"):
        assert col not in X.columns
    assert {"rule_true_positive", "org_rule_benign_positive", "duration_s"} <= set(X.columns)
    assert len(X) == len(inc)


def test_transform_matches_fit_columns_and_handles_unseen_values(make_evidence):
    inc = _incidents(make_evidence)
    fb = FeatureBuilder()
    X_train = fb.fit_transform(inc)
    new = inc.head(2).assign(rule="999", category="NeverSeen")
    X_new = fb.transform(new)
    assert list(X_new.columns) == list(X_train.columns)
    assert X_new["category"].isna().all()  # categoria nueva -> desconocida, no error
    for c in CATEGORICAL:
        assert isinstance(X_new[c].dtype, pd.CategoricalDtype)


def test_lookup_table_falls_back_org_rule_then_rule_then_majority(make_incidents):
    train = make_incidents([
        {"org_id": 0, "rule": "A", "verdict": "true_positive"},
        {"org_id": 0, "rule": "A", "verdict": "true_positive"},
        {"org_id": 1, "rule": "A", "verdict": "false_positive"},
        {"org_id": 1, "rule": "A", "verdict": "false_positive"},
        {"org_id": 1, "rule": "A", "verdict": "false_positive"},
        {"org_id": 1, "rule": "B", "verdict": "benign_positive"},
        {"org_id": 1, "rule": "B", "verdict": "benign_positive"},
        {"org_id": 1, "rule": "B", "verdict": "benign_positive"},
        {"org_id": 1, "rule": "B", "verdict": "benign_positive"},
    ])
    table = LookupTable().fit(train)
    test = make_incidents([
        {"org_id": 0, "rule": "A"},  # par conocido
        {"org_id": 2, "rule": "A"},  # org nueva -> mayoritario de la regla
        {"org_id": 0, "rule": "Z"},  # regla nueva -> mayoritaria global
    ])
    assert list(table.predict(test)) == ["true_positive", "false_positive", "benign_positive"]
    assert majority(train) == "benign_positive"
