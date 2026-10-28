# Pipeline completo sobre GUIDE: carga y agregacion, lineas de base, modelo
# de 3 clases, metricas por segmento, importancia de features, explicaciones
# y grilla de politicas. Dos evaluaciones:
# - temporal (la principal): dentro de cada org, el primer 70 % de sus
#   incidentes (Train + Test juntos) entrena y el resto evalua.
# - guide_split: el split oficial de GUIDE, estratificado por org y detector
#   (no temporal; casi todo par org-regla del test ya esta en train).
# Todo queda en --out.
#
#   python -m fortia_ml.train --data <carpeta con GUIDE_*.csv> [--sample-orgs 0.1] [--with-last-verdict]
import argparse
import json
import os
import platform
import time
from pathlib import Path

import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.inspection import permutation_importance
from sklearn.metrics import confusion_matrix

from . import guide, policies
from .baselines import LookupTable, majority
from .evaluation import by_segment, history_segment, org_size_segment, scores
from .features import FeatureBuilder
from .schema import VERDICTS

NS = [5, 10, 20, 50, 100]
XS = [0.80, 0.90, 0.95, 0.99]


def log(msg, t0=time.time()):
    print(f"[{time.time() - t0:6.0f}s] {msg}", flush=True)


def load(data, name, sample, last_verdict, out):
    # Cache a nivel incidente: la agregacion de 9,5 M filas tarda minutos.
    cache = out / f"incidents_{name}_{sample or 'all'}{'_lv' if last_verdict else ''}.parquet"
    if cache.exists():
        return pd.read_parquet(cache)
    inc = guide.load_incidents(Path(data) / f"GUIDE_{name}.csv", sample, last_verdict)
    inc.to_parquet(cache)
    return inc


def _json_value(v):
    if isinstance(v, (float, np.floating)):
        return None if np.isnan(v) else round(float(v), 4)
    if isinstance(v, (int, np.integer)):
        return int(v)
    return None if pd.isna(v) else str(v)


def explain(model, X, inc, top_features):
    # Explicacion legible: prediccion, confianza y el valor del caso en las
    # features que mas pesan en el modelo (importancia global, no atribucion
    # local exacta).
    proba = model.predict_proba(X)
    out = []
    for i in range(len(X)):
        k = int(proba[i].argmax())
        out.append({
            "org_id": int(inc["org_id"].iloc[i]),
            "incident_id": int(inc["incident_id"].iloc[i]),
            "verdict_real": inc["verdict"].iloc[i],
            "prediction": str(model.classes_[k]),
            "confidence": round(float(proba[i, k]), 3),
            "probabilities": {str(c): round(float(p), 3) for c, p in zip(model.classes_, proba[i])},
            "top_features": {f: _json_value(X[f].iloc[i]) for f in top_features},
        })
    return out


def evaluate(train, test, seed, extra):
    # Mayoritaria, tabla y modelo sobre el mismo conjunto, en total y por segmento.
    preds = {
        "majority": np.full(len(test), majority(train)),
        "lookup": LookupTable().fit(train).predict(test).to_numpy(),
    }
    fb = FeatureBuilder(random_state=seed, extra=extra)
    X_train = fb.fit_transform(train)
    X_test = fb.transform(test)
    model = HistGradientBoostingClassifier(categorical_features="from_dtype", random_state=seed)
    t0 = time.perf_counter()
    model.fit(X_train, train["verdict"])
    fit_s = time.perf_counter() - t0
    t0 = time.perf_counter()
    preds["model"] = model.predict(X_test)
    predict_s = time.perf_counter() - t0

    y = test["verdict"]
    res = {"train": len(train), "test": len(test), **{name: scores(y, p) for name, p in preds.items()}}
    res["model"]["iterations"] = int(model.n_iter_)
    # Sin contar la construccion de features; inferencia en lote.
    res["model"]["fit_seconds"] = fit_s
    res["model"]["predict_us_per_incident"] = predict_s / len(test) * 1e6
    # De a un incidente, como llegaria en Fortia.
    t0 = time.perf_counter()
    for i in range(200):
        model.predict(X_test.iloc[[i]])
    res["model"]["predict_ms_single"] = (time.perf_counter() - t0) / 200 * 1e3
    res["confusion_matrix"] = {
        name: pd.DataFrame(confusion_matrix(y, preds[name], labels=list(VERDICTS)), index=VERDICTS, columns=VERDICTS).to_dict(orient="index")
        for name in ("model", "lookup")
    }
    seg = pd.concat([
        by_segment(y, preds, history_segment(train, test)).assign(segmentation="history"),
        by_segment(y, preds, org_size_segment(train, test)).assign(segmentation="org_size"),
    ], ignore_index=True)
    return res, seg, model, X_test


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, help="carpeta con GUIDE_Train.csv y GUIDE_Test.csv")
    ap.add_argument("--out", default=None, help="por defecto ml/out (ml/out/last_verdict con --with-last-verdict)")
    ap.add_argument("--sample-orgs", type=float, default=None, help="fraccion de organizaciones (iterar rapido)")
    ap.add_argument("--with-last-verdict", action="store_true",
                    help="corrida aparte con LastVerdict (cota superior, posible filtracion); sin politicas")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    root = Path(__file__).resolve().parent.parent / "out"
    out = Path(args.out) if args.out else (root / "last_verdict" if args.with_last_verdict else root)
    out.mkdir(parents=True, exist_ok=True)
    extra = guide.LAST_VERDICT_COLUMNS if args.with_last_verdict else []
    results = {
        "sample_orgs": args.sample_orgs,
        "with_last_verdict": args.with_last_verdict,
        "seed": args.seed,
        "environment": {
            "python": platform.python_version(),
            "pandas": pd.__version__,
            "numpy": np.__version__,
            "scikit-learn": sklearn.__version__,
            "os": platform.platform(),
            "cpu": platform.processor(),
            "logical_cpus": os.cpu_count(),
        },
    }

    train = load(args.data, "Train", args.sample_orgs, args.with_last_verdict, out)
    test = load(args.data, "Test", args.sample_orgs, args.with_last_verdict, out)
    log(f"incidentes: train {len(train):,} / test {len(test):,}")
    results["data"] = {
        name: {"incidents": len(df), "orgs": int(df["org_id"].nunique()), "verdicts": df["verdict"].value_counts().to_dict()}
        for name, df in (("train", train), ("test", test))
    }

    past, future = policies.temporal_split(pd.concat([train, test], ignore_index=True))
    evals = {}
    segments = []
    for name, (tr, te) in {"temporal": (past, future), "guide_split": (train, test)}.items():
        res, seg, model, X_test = evaluate(tr, te, args.seed, extra)
        results[name] = res
        segments.append(seg.assign(evaluation=name))
        evals[name] = (model, X_test, te)
        log(f"{name}: mayoritaria {res['majority']['macro_f1']:.3f} | tabla {res['lookup']['macro_f1']:.3f} | modelo {res['model']['macro_f1']:.3f}")
    pd.concat(segments, ignore_index=True).to_csv(out / "segments.csv", index=False)

    # Importancia y explicaciones con el modelo de la evaluacion principal.
    model, X_test, te = evals["temporal"]
    sample = X_test.sample(min(20_000, len(X_test)), random_state=args.seed)
    imp = permutation_importance(model, sample, te["verdict"].loc[sample.index], scoring="f1_macro",
                                 n_repeats=3, random_state=args.seed, n_jobs=-1)
    importance = pd.Series(imp.importances_mean, index=X_test.columns).sort_values(ascending=False)
    importance.rename("f1_macro_drop").to_csv(out / "feature_importance.csv")
    results["feature_importance_top10"] = importance.head(10).round(4).to_dict()
    pick = te.sample(5, random_state=args.seed).index
    with open(out / "explicaciones.json", "w", encoding="utf-8") as f:
        json.dump(explain(model, X_test.loc[pick], te.loc[pick], list(importance.index[:5])), f, ensure_ascii=False, indent=2)
    log("importancia y explicaciones listas")

    if not args.with_last_verdict:
        grid = pd.concat([
            policies.grid(tr, te, scope, NS, XS).assign(evaluation=name)
            for name, (tr, te) in {"temporal": (past, future), "guide_split": (train, test)}.items()
            for scope in policies.SCOPES
        ], ignore_index=True)
        grid.to_csv(out / "policy_grid.csv", index=False)
        log("grilla de politicas lista")

        # Ejemplo de salida: minado con todo el pasado conocido (Train).
        for scope in policies.SCOPES:
            patterns = policies.mine(train, scope)
            with open(out / f"politicas_sugeridas_{scope}.json", "w", encoding="utf-8") as f:
                json.dump(policies.to_policies(patterns, scope, policies.DEFAULT_N, policies.DEFAULT_X), f, ensure_ascii=False, indent=2)

    with open(out / "metrics.json", "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2, default=_json_value)
    log(f"listo: {out}")


if __name__ == "__main__":
    main()
