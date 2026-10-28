import json

import pandas as pd
import pytest

from fortia_ml import policies
from fortia_ml.policies import ACTION, NO_ACTION


def _many(n, **fields):
    return [fields] * n


def test_alert_bucket():
    assert list(policies.alert_bucket(pd.Series([1, 2, 5, 6, 100]))) == ["1", "2-5", "2-5", "6+", "6+"]


def test_mine_applies_support_and_agreement_thresholds(make_incidents):
    train = make_incidents(
        _many(19, rule="noise", verdict="benign_positive")
        + _many(1, rule="noise", verdict="false_positive")       # BP+FP = no_action: 20/20
        + _many(19, rule="attack", verdict="true_positive")
        + _many(1, rule="attack", verdict="benign_positive")     # 19/20 = 0.95
        + _many(10, rule="mixed", verdict="true_positive")
        + _many(10, rule="mixed", verdict="false_positive")      # 50 %: sin politica
        + _many(5, rule="rare", verdict="benign_positive")       # soporte < N
    )
    p = policies.mine(train, "global", n=20, x=0.95).set_index("rule")
    assert set(p.index) == {"noise", "attack"}
    assert p.loc["noise", "decision"] == NO_ACTION
    assert p.loc["noise", "false_positive"] == 1
    assert p.loc["attack", "decision"] == ACTION
    assert set(policies.mine(train, "global", n=20, x=0.96)["rule"]) == {"noise"}


def test_org_scope_mines_each_org_separately(make_incidents):
    # La regla es ruido en la org 0 y ataque en la org 1: entre orgs no hay
    # acuerdo, por org si.
    train = make_incidents(
        _many(20, org_id=0, rule="r", verdict="benign_positive")
        + _many(20, org_id=1, rule="r", verdict="true_positive")
    )
    assert policies.mine(train, "global", n=20, x=0.95).empty
    org = policies.mine(train, "org", n=20, x=0.95).set_index("org_id")
    assert org.loc[0, "decision"] == NO_ACTION and org.loc[1, "decision"] == ACTION


def test_metrics_count_absorbed_true_positives(make_incidents):
    train = make_incidents(_many(20, rule="noise", verdict="benign_positive")
                           + _many(20, rule="attack", verdict="true_positive"))
    patterns = policies.mine(train, "global", n=20, x=0.95)
    test = make_incidents([
        {"rule": "noise", "verdict": "benign_positive"},
        {"rule": "noise", "verdict": "false_positive"},
        {"rule": "noise", "verdict": "true_positive"},    # ataque real absorbido: el error critico
        {"rule": "attack", "verdict": "true_positive"},
        {"rule": "other", "verdict": "true_positive"},    # sin politica: analista
    ])
    m = policies.metrics(policies.apply(patterns, test, "global"))
    assert m["incidents"] == 5
    assert m[NO_ACTION]["matched"] == 3
    assert m[NO_ACTION]["precision"] == pytest.approx(2 / 3)
    assert m[NO_ACTION]["tp_absorbed"] == 1
    assert m[NO_ACTION]["tp_absorbed_of_all_tp"] == pytest.approx(1 / 3)
    assert m[ACTION]["precision"] == 1.0
    assert m["all"]["coverage"] == pytest.approx(4 / 5)
    assert m["all"]["precision"] == pytest.approx(3 / 4)


def test_per_org_distribution(make_incidents):
    train = make_incidents(_many(20, org_id=0, rule="noise", verdict="benign_positive"))
    patterns = policies.mine(train, "org", n=20, x=0.95)
    test = make_incidents([
        {"org_id": 0, "rule": "noise", "verdict": "benign_positive"},
        {"org_id": 0, "rule": "x", "verdict": "true_positive"},
        {"org_id": 1, "rule": "noise", "verdict": "benign_positive"},  # la org 1 no tiene politicas
    ])
    dist = policies.per_org(policies.apply(patterns, test, "org"))
    assert dist["coverage"]["orgs"] == 2
    assert dist["coverage"]["mean"] == pytest.approx(0.25)  # (0.5 + 0) / 2
    assert dist["precision"]["orgs"] == 1  # solo donde alguna politica coincidio


def test_temporal_split_cuts_inside_each_org(make_incidents):
    day = lambda d: pd.Timestamp(f"2024-06-{d:02d}", tz="UTC")
    inc = make_incidents([{"org_id": o, "first_seen": day(d)} for o in (0, 1) for d in range(1, 11)])
    past, future = policies.temporal_split(inc, 0.7)
    assert len(past) == 14 and len(future) == 6
    for org in (0, 1):
        assert past[past["org_id"] == org]["first_seen"].max() < future[future["org_id"] == org]["first_seen"].min()


def test_to_policies_uses_automation_defaults_shape(make_incidents):
    train = make_incidents(
        _many(30, rule="noise", verdict="benign_positive")
        + _many(20, rule="scan", dominant_entity="Ip", verdict="true_positive")
        + _many(20, rule="phish", dominant_entity="User", verdict="true_positive")
    )
    out = policies.to_policies(policies.mine(train, "global", 20, 0.95), "global", 20, 0.95)
    json.dumps(out)  # serializable
    assert out["mode"] == "simulate"
    by_rule = {p["guideConditions"]["detectorId"]: p for p in out["policies"]}
    for p in out["policies"]:
        assert p["enabled"] is False
        assert p["conditions"] == {}
        assert {"key", "name", "order", "useCase", "action"} <= set(p)
    assert by_rule["noise"]["action"] is None and by_rule["noise"]["proposedAction"] == "close-as-benign"
    assert by_rule["scan"]["action"] == "block-ip"
    assert by_rule["phish"]["action"] is None and "finding" in by_rule["phish"]
    assert [p["order"] for p in out["policies"]] == [1, 2, 3]
