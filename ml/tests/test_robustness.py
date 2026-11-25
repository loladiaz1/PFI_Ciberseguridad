import numpy as np
import pandas as pd
from sklearn.metrics import f1_score

from fortia_ml import policies
from fortia_ml.robustness import (bootstrap, calibration, confusion_by_org, macro_f1, operating_points,
                                  policy_counts, policy_stats)
from fortia_ml.schema import VERDICTS


def test_macro_f1_igual_a_sklearn():
    rng = np.random.default_rng(0)
    y = rng.choice(VERDICTS, 500)
    pred = np.where(rng.random(500) < 0.7, y, rng.choice(VERDICTS, 500))
    org = rng.integers(0, 20, 500)
    cm = confusion_by_org(org, y, pred)
    assert cm.shape == (20, 3, 3)
    assert cm.sum() == 500
    assert np.isclose(macro_f1(cm.sum(0)), f1_score(y, pred, average="macro"))


def test_macro_f1_con_clase_ausente_cuenta_cero():
    y = np.array(["true_positive", "benign_positive"])
    cm = confusion_by_org([0, 0], y, y).sum(0)
    # false_positive no aparece: F1 = 0 para esa clase (zero_division=0).
    assert np.isclose(macro_f1(cm), 2 / 3)


def test_bootstrap_intervalo_contiene_el_valor_y_es_reproducible():
    rng = np.random.default_rng(1)
    y = rng.choice(VERDICTS, 2000)
    pred = np.where(rng.random(2000) < 0.8, y, rng.choice(VERDICTS, 2000))
    cm = confusion_by_org(rng.integers(0, 50, 2000), y, pred)
    stat = lambda a: {"f1": macro_f1(a)}
    ci = bootstrap([cm], stat, 200, seed=3)
    value = macro_f1(cm.sum(0))
    assert ci["f1"]["low"] <= value <= ci["f1"]["high"]
    assert ci == bootstrap([cm], stat, 200, seed=3)


def test_calibracion_perfecta_da_ece_cero():
    classes = np.array(VERDICTS)
    proba = np.array([[1.0, 0, 0], [0, 1.0, 0], [0, 0, 1.0]])
    y = classes
    _, s = calibration(proba, y, classes)
    assert s["ece"] == 0
    assert s["brier"] == 0


def test_punto_de_operacion_cuenta_los_ataques_absorbidos():
    classes = np.array(VERDICTS)
    # P(no requiere accion) = 0.9, 0.9 y 0.2; el segundo es un ataque real.
    proba = np.array([[0.1, 0.8, 0.1], [0.1, 0.5, 0.4], [0.8, 0.1, 0.1]])
    y = np.array(["benign_positive", "true_positive", "true_positive"])
    row = operating_points(proba, y, classes, thresholds=[0.85]).iloc[0]
    assert np.isclose(row["no_action_coverage"], 2 / 3)
    assert np.isclose(row["no_action_precision"], 0.5)
    assert np.isclose(row["tp_absorbed_of_all_tp"], 0.5)


def test_conteos_de_politicas_por_org(make_incidents):
    past = make_incidents([{"org_id": 1, "verdict": "benign_positive"}] * 20)
    future = make_incidents([{"org_id": 1, "verdict": "benign_positive"}] * 3
                            + [{"org_id": 1, "verdict": "true_positive"}]
                            + [{"org_id": 2, "verdict": "true_positive"}])
    applied = policies.apply(policies.mine(past, "org"), future, "org")
    c = policy_counts(applied)
    assert c.tolist() == [[4, 4, 3, 1, 1], [1, 0, 0, 0, 1]]
    s = policy_stats(c.sum(0))
    assert np.isclose(s["no_action_precision"], 0.75)
    assert np.isclose(s["tp_absorbed_of_all_tp"], 0.5)
