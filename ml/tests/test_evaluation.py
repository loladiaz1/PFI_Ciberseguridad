import pytest

from fortia_ml import guide
from fortia_ml.evaluation import by_segment, history_segment, org_size_segment, scores


def test_history_segment(make_incidents):
    train = make_incidents([{"org_id": 0, "rule": "A"}, {"org_id": 1, "rule": "B"}])
    test = make_incidents([
        {"org_id": 0, "rule": "A"},  # par visto
        {"org_id": 0, "rule": "B"},  # regla vista en otra org
        {"org_id": 0, "rule": "C"},  # regla nueva
    ])
    assert list(history_segment(train, test)) == ["pair_seen", "rule_seen", "rule_new"]


def test_org_size_segment(make_incidents):
    train = make_incidents([{"org_id": 0}] * 25 + [{"org_id": 1}] * 3)
    test = make_incidents([{"org_id": 0}, {"org_id": 1}, {"org_id": 2}])
    assert list(org_size_segment(train, test)) == ["20-199", "1-19", "0"]


def test_macro_f1_ignores_classes_absent_from_segment():
    y = ["benign_positive", "true_positive"]
    assert scores(y, y)["macro_f1"] == pytest.approx(1.0)


def test_by_segment_one_row_per_segment_and_predictor():
    y = ["true_positive", "benign_positive", "true_positive", "false_positive"]
    preds = {"a": y, "b": ["benign_positive"] * 4}
    df = by_segment(y, preds, ["x", "x", "y", "y"])
    assert len(df) == 4
    row = df[(df["segment"] == "x") & (df["predictor"] == "a")].iloc[0]
    assert row["n"] == 2 and row["share"] == 0.5 and row["macro_f1"] == pytest.approx(1.0)


def test_last_verdict_counts_only_when_column_present(make_evidence):
    ev = make_evidence([{"AlertId": 1}, {"AlertId": 2}])
    assert "n_lv_malicious" not in guide.aggregate(ev).columns
    inc = guide.aggregate(ev.assign(LastVerdict=["Malicious", "NoThreatsFound"]))
    assert inc.loc[0, "n_lv_malicious"] == 1 and inc.loc[0, "n_lv_no_threats"] == 1
    assert inc.loc[0, "n_lv_suspicious"] == 0
