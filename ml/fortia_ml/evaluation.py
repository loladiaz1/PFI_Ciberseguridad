# Metricas de clasificacion, en total y por segmento del conjunto evaluado.
#
# Segmentos, segun lo que el entrenamiento ya vio:
# - history: cuanta historia hay de la regla (pair_seen = el par (org, regla)
#   aparece en train; rule_seen = la regla si, pero no en esta org;
#   rule_new = regla nunca vista).
# - org_size: incidentes de la org en train.
# Sirve para ver donde aporta el modelo frente a la tabla de base.
import numpy as np
import pandas as pd
from sklearn.metrics import classification_report, precision_recall_fscore_support

from .schema import VERDICTS

ORG_SIZE_BINS = [-1, 0, 19, 199, 1999, np.inf]
ORG_SIZE_LABELS = ["0", "1-19", "20-199", "200-1999", "2000+"]


def scores(y, pred):
    rep = classification_report(y, pred, labels=list(VERDICTS), output_dict=True, zero_division=0)
    # Promedio macro sobre las clases presentes (en un segmento puede faltar
    # alguna; contarla como F1 = 0 castigaria a todos los predictores igual).
    p, r, f, _ = precision_recall_fscore_support(y, pred, average="macro", zero_division=0)
    return {
        "n": int(len(y)),
        "macro_f1": f,
        "macro_precision": p,
        "macro_recall": r,
        "per_class": {v: {k: rep[v][k] for k in ("precision", "recall", "f1-score", "support")} for v in VERDICTS},
    }


def history_segment(train, df):
    pairs = pd.MultiIndex.from_frame(train[["org_id", "rule"]].drop_duplicates())
    pair_seen = pd.MultiIndex.from_frame(df[["org_id", "rule"]]).isin(pairs)
    rule_seen = df["rule"].isin(set(train["rule"]))
    return pd.Series(np.select([pair_seen, rule_seen], ["pair_seen", "rule_seen"], "rule_new"), index=df.index)


def org_size_segment(train, df):
    size = df["org_id"].map(train["org_id"].value_counts()).fillna(0)
    return pd.cut(size, bins=ORG_SIZE_BINS, labels=ORG_SIZE_LABELS).astype(str)


def by_segment(y, preds, segment):
    # preds: {"model": array, "lookup": array, ...}. Una fila por segmento y predictor.
    rows = []
    y = pd.Series(np.asarray(y))
    segment = pd.Series(np.asarray(segment))
    for seg in sorted(segment.unique()):
        sel = (segment == seg).to_numpy()
        for name, pred in preds.items():
            s = scores(y[sel], np.asarray(pred)[sel])
            rows.append({
                "segment": seg, "predictor": name, "n": s["n"], "share": sel.mean(), "macro_f1": s["macro_f1"],
                **{f"{v}_precision": s["per_class"][v]["precision"] for v in VERDICTS},
                **{f"{v}_recall": s["per_class"][v]["recall"] for v in VERDICTS},
            })
    return pd.DataFrame(rows)
