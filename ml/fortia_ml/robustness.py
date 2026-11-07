# Robustez de la fase 1: ¿los resultados son buenos o salieron de una corrida
# con suerte? Sobre la evaluacion temporal de train.py (primer 70 % de cada
# org entrena, el resto evalua):
# - Intervalos de confianza por bootstrap de organizaciones. Se remuestrean
#   orgs y no incidentes: los incidentes de un mismo SOC no son independientes.
# - Semillas: el mismo pipeline con varias semillas.
# - Calibracion: si el modelo dice 90 %, ¿acierta el 90 % de las veces? Es la
#   confianza que mostraria la app.
# - Punto de operacion: desde que confianza sugerir y cuanto cubre.
# - Errores: que ataques reales absorberian las politicas "cerrar sin accion".
# - Corte por fecha: todo lo anterior a una fecha entrena, lo posterior evalua.
# - Tuneo acotado: validacion interna dentro del pasado, sin mirar la evaluacion.
#
# Usa los incidentes en cache de train.py (out/incidents_*_all.parquet).
#
#   python -m fortia_ml.robustness [--sample all] [--bootstrap 1000] [--seeds 0 1 2] [--skip-tuning]
import argparse
import json
import time
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier

from . import policies
from .baselines import LookupTable, majority
from .evaluation import history_segment
from .features import FeatureBuilder
from .schema import VERDICTS

DATE_CUT = "2024-06-10"
THRESHOLDS = [0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99]
# Grilla chica: alrededor de los valores por defecto de scikit-learn
# (learning_rate 0.1, max_iter 100, max_leaf_nodes 31).
TUNING_GRID = [
    {"learning_rate": lr, "max_iter": it, "max_leaf_nodes": leaves}
    for lr in (0.05, 0.1, 0.2) for it in (100, 300) for leaves in (31, 63)
] + [{"class_weight": "balanced"}]


def log(msg, t0=time.time()):
    print(f"[{time.time() - t0:6.0f}s] {msg}", flush=True)


# ---------------------------------------------------------------- metricas

def confusion_by_org(org, y, pred):
    # Matriz de confusion de cada org: (orgs, real, predicho), en el orden de VERDICTS.
    codes = pd.factorize(np.asarray(org))[0]
    yi = pd.Categorical(np.asarray(y), categories=VERDICTS).codes
    pi = pd.Categorical(np.asarray(pred), categories=VERDICTS).codes
    cm = np.zeros((codes.max() + 1, 3, 3), dtype=np.int64)
    np.add.at(cm, (codes, yi, pi), 1)
    return cm


def macro_f1(cm):
    # Igual que sklearn con average="macro" y zero_division=0, a partir de la matriz.
    cm = np.asarray(cm, dtype=float)
    tp = np.diagonal(cm, axis1=-2, axis2=-1)
    with np.errstate(divide="ignore", invalid="ignore"):
        p = np.nan_to_num(tp / cm.sum(-2))
        r = np.nan_to_num(tp / cm.sum(-1))
        f = np.nan_to_num(2 * p * r / (p + r))
    return f.mean(-1)


def policy_counts(applied):
    # Por org: [incidentes, cerrados sin accion, bien cerrados, TP absorbidos, TP].
    a = applied
    noa = a["decision"].eq(policies.NO_ACTION)
    flags = pd.DataFrame({
        "n": 1,
        "noa": noa,
        "noa_correct": noa & ~a["needs_action"],
        "absorbed": noa & a["needs_action"],
        "tp": a["needs_action"],
    }).astype(int)
    return flags.groupby(a["org_id"].to_numpy()).sum().to_numpy()


def policy_stats(c):
    n, noa, ok, absorbed, tp = c
    return {
        "no_action_coverage": noa / n if n else np.nan,
        "no_action_precision": ok / noa if noa else np.nan,
        "tp_absorbed_of_all_tp": absorbed / tp if tp else np.nan,
    }


def bootstrap(per_org, stat, b, seed):
    # per_org: arrays con primera dimension = orgs (alineados). stat recibe las
    # sumas sobre las orgs remuestreadas y devuelve un dict de cifras.
    rng = np.random.default_rng(seed)
    n = len(per_org[0])
    rows = []
    for _ in range(b):
        w = np.bincount(rng.integers(0, n, n), minlength=n)
        rows.append(stat(*[np.tensordot(w, a, axes=(0, 0)) for a in per_org]))
    df = pd.DataFrame(rows)
    return {k: {"low": float(df[k].quantile(0.025)), "high": float(df[k].quantile(0.975))} for k in df.columns}


def calibration(proba, y, classes, bins=10):
    conf = proba.max(1)
    correct = np.asarray(classes)[proba.argmax(1)] == np.asarray(y)
    edges = np.linspace(1 / len(classes), 1, bins + 1)
    idx = np.clip(np.digitize(conf, edges[1:-1]), 0, bins - 1)
    rows = []
    for k in range(bins):
        sel = idx == k
        if sel.any():
            rows.append({"bin_low": edges[k], "bin_high": edges[k + 1], "n": int(sel.sum()),
                         "confidence": float(conf[sel].mean()), "accuracy": float(correct[sel].mean())})
    table = pd.DataFrame(rows)
    ece = float((table["n"] * (table["accuracy"] - table["confidence"]).abs()).sum() / len(conf))
    onehot = (np.asarray(y)[:, None] == np.asarray(classes)[None, :]).astype(float)
    brier = float(((proba - onehot) ** 2).sum(1).mean())
    return table, {"ece": ece, "brier": brier}


def operating_points(proba, y, classes, thresholds=THRESHOLDS):
    # Dos usos de la confianza:
    # - sugerir el veredicto si la confianza maxima supera el umbral;
    # - sugerir "cerrar sin accion" si P(benigno) + P(falso positivo) lo supera.
    classes = np.asarray(classes)
    y = np.asarray(y)
    conf = proba.max(1)
    correct = classes[proba.argmax(1)] == y
    p_noa = proba[:, classes != "true_positive"].sum(1)
    is_tp = y == "true_positive"
    rows = []
    for t in thresholds:
        sug, noa = conf >= t, p_noa >= t
        rows.append({
            "threshold": t,
            "verdict_coverage": float(sug.mean()),
            "verdict_precision": float(correct[sug].mean()) if sug.any() else np.nan,
            "no_action_coverage": float(noa.mean()),
            "no_action_precision": float((~is_tp[noa]).mean()) if noa.any() else np.nan,
            "tp_absorbed_of_all_tp": float((noa & is_tp).sum() / is_tp.sum()),
        })
    return pd.DataFrame(rows)


def absorbed_profile(applied):
    # De que tipo son los ataques reales que una politica cerraria sin accion,
    # comparado con todos los ataques reales.
    tp = applied[applied["needs_action"]]
    absorbed = tp["decision"].eq(policies.NO_ACTION)
    out = {}
    for col in ("category", "dominant_entity", "alert_bucket"):
        df = pd.DataFrame({"absorbed": tp.loc[absorbed, col].value_counts(),
                           "all_tp": tp[col].value_counts()}).fillna(0)
        df["absorbed_share"] = df["absorbed"] / df["absorbed"].sum()
        df["all_tp_share"] = df["all_tp"] / df["all_tp"].sum()
        df["absorbed_rate"] = df["absorbed"] / df["all_tp"]
        out[col] = df.sort_values("absorbed", ascending=False).head(8)
    return out


# ---------------------------------------------------------------- modelo

def fit_predict(train, test, seed, params=None):
    fb = FeatureBuilder(random_state=seed)
    X_train = fb.fit_transform(train)
    X_test = fb.transform(test)
    model = HistGradientBoostingClassifier(categorical_features="from_dtype", random_state=seed, **(params or {}))
    model.fit(X_train, train["verdict"])
    return model.predict_proba(X_test), model.classes_, int(model.n_iter_)


def tune(past, seed):
    # Validacion interna: dentro del pasado, el ultimo 20 % de cada org valida.
    inner_train, inner_val = policies.temporal_split(past, past_frac=0.8)
    rows = []
    for params in [{}] + TUNING_GRID:
        t0 = time.perf_counter()
        proba, classes, iters = fit_predict(inner_train, inner_val, seed, params)
        pred = classes[proba.argmax(1)]
        f1 = macro_f1(confusion_by_org(inner_val["org_id"], inner_val["verdict"], pred).sum(0))
        rows.append({"params": json.dumps(params) if params else "por defecto", "val_macro_f1": float(f1),
                     "iterations": iters, "seconds": time.perf_counter() - t0})
        log(f"tuneo {rows[-1]['params']}: {f1:.4f}")
    return pd.DataFrame(rows).sort_values("val_macro_f1", ascending=False).reset_index(drop=True)


# ---------------------------------------------------------------- reporte

def _pct(x):
    return "-" if x is None or (isinstance(x, float) and np.isnan(x)) else f"{100 * x:.1f} %".replace(".", ",")


def _f(x, d=3):
    return f"{x:.{d}f}".replace(".", ",")


def _ci(c, pct=False):
    fmt = _pct if pct else _f
    return f"{fmt(c['low'])} a {fmt(c['high'])}"


def _table(df, cols, headers):
    lines = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    lines += ["| " + " | ".join(str(r[c]) for c in cols) + " |" for _, r in df.iterrows()]
    return "\n".join(lines)


def figures(out, calib, ops):
    fig, ax = plt.subplots(figsize=(4.2, 4.2))
    ax.plot([0, 1], [0, 1], ls="--", color="#999", lw=1)
    ax.plot(calib["confidence"], calib["accuracy"], marker="o", color="#2e86c1")
    ax.set_xlim(0.3, 1.01)
    ax.set_ylim(0.3, 1.01)
    ax.set_xlabel("confianza del modelo")
    ax.set_ylabel("aciertos reales")
    ax.set_title("Calibracion (evaluacion temporal)")
    fig.tight_layout()
    fig.savefig(out / "calibracion.png", dpi=120)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(6, 3.4))
    ax.plot(ops["threshold"], ops["no_action_coverage"] * 100, marker="o", label="incidentes cubiertos")
    ax.plot(ops["threshold"], ops["tp_absorbed_of_all_tp"] * 100, marker="o", color="#c0392b",
            label="ataques reales absorbidos")
    ax.set_xlabel("umbral de P(no requiere accion)")
    ax.set_ylabel("%")
    ax.set_title("Sugerir \"cerrar sin accion\" segun la confianza")
    ax.legend(frameon=False)
    fig.tight_layout()
    fig.savefig(out / "punto_operacion.png", dpi=120)
    plt.close(fig)


def report(out, r, ops, calib, profile, tuning):
    m = r["temporal"]
    md = ["# Robustez de la fase 1", "",
          "Generado por `python -m fortia_ml.robustness`. Evaluacion temporal salvo que se indique otra: dentro de "
          "cada organizacion, el primer 70 % de sus incidentes entrena y el resto evalua. Intervalos del 95 % por "
          f"bootstrap de organizaciones ({r['bootstrap']} remuestreos).", "",
          "## 1. Macro-F1 con intervalo de confianza", "",
          "| Predictor | Macro-F1 | IC 95 % |", "|---|---|---|",
          f"| Mayoritaria | {_f(m['majority'])} | {_ci(m['ci']['majority'])} |",
          f"| Tabla | {_f(m['lookup'])} | {_ci(m['ci']['lookup'])} |",
          f"| Modelo | {_f(m['model'])} | {_ci(m['ci']['model'])} |",
          f"| Modelo menos tabla | {_f(m['model'] - m['lookup'], 4)} | {_ci(m['ci']['model_minus_lookup'])} |", "",
          "Si el intervalo de \"modelo menos tabla\" no incluye el 0, la diferencia no es azar del muestreo "
          "de organizaciones. Eso no la vuelve grande.", "",
          "## 2. Semillas", "",
          "| Semilla | Macro-F1 del modelo |", "|---|---|"]
    md += [f"| {s} | {_f(v, 4)} |" for s, v in r["seeds"].items()]
    md += ["", "## 3. Politicas por organizacion (N = 20, X = 95 %)", "",
           "| Cifra | Valor | IC 95 % |", "|---|---|---|"]
    for k, label in (("no_action_coverage", "Cerrar sin accion: cobertura"),
                     ("no_action_precision", "Cerrar sin accion: precision"),
                     ("tp_absorbed_of_all_tp", "Ataques reales absorbidos")):
        md.append(f"| {label} | {_pct(r['policies']['value'][k])} | {_ci(r['policies']['ci'][k], pct=True)} |")
    md += ["", "## 4. Calibracion", "",
           f"Error de calibracion esperado (ECE): {_f(r['calibration']['ece'], 4)}. "
           f"Brier multiclase: {_f(r['calibration']['brier'], 4)}. Un ECE cerca de 0 significa que la confianza "
           "que mostraria la app se puede leer como probabilidad de acierto.", "",
           _table(calib.assign(rango=lambda d: [f"{_f(a, 2)}-{_f(b, 2)}" for a, b in zip(d.bin_low, d.bin_high)],
                               conf=lambda d: d.confidence.map(_pct), acc=lambda d: d.accuracy.map(_pct)),
                  ["rango", "n", "conf", "acc"], ["Confianza", "Incidentes", "Confianza media", "Aciertos"]), "",
           "![](calibracion.png)", "", "## 5. Punto de operacion", "",
           _table(ops.assign(umbral=ops["threshold"].map(lambda v: _f(v, 2)), **{c: ops[c].map(_pct) for c in ops.columns if c != "threshold"}),
                  ["umbral", "verdict_coverage", "verdict_precision", "no_action_coverage",
                   "no_action_precision", "tp_absorbed_of_all_tp"],
                  ["Umbral", "Sugiere veredicto", "Precision", "Sugiere cerrar", "Precision", "TP absorbidos"]), "",
           "![](punto_operacion.png)", "", "## 6. Que ataques absorben las politicas", "",
           "Ataques reales que una politica \"cerrar sin accion\" cerraria, comparados con todos los ataques reales.", ""]
    for col, df in profile.items():
        d = df.reset_index().rename(columns={"index": col})
        md += [f"**{col}**", "", _table(d.assign(a=d.absorbed.astype(int), s=d.absorbed_share.map(_pct),
                                                 t=d.all_tp_share.map(_pct), rate=d.absorbed_rate.map(_pct)),
                                        [col, "a", "s", "t", "rate"],
                                        ["Valor", "Absorbidos", "% de absorbidos", "% de todos los TP",
                                         "Tasa de absorcion"]), ""]
    d = r["date_cut"]
    md += [f"## 7. Corte por fecha ({DATE_CUT})", "",
           f"Entrena con todo lo anterior al {DATE_CUT} ({d['train']:,} incidentes) y evalua lo posterior "
           f"({d['test']:,}).".replace(",", "."), "",
           "| Predictor | Macro-F1 |", "|---|---|",
           f"| Mayoritaria | {_f(d['majority'])} |", f"| Tabla | {_f(d['lookup'])} |", f"| Modelo | {_f(d['model'])} |",
           "", f"- Par (org, regla) ya visto en el entrenamiento: {_pct(d['pair_seen_share'])} de la evaluacion.",
           f"- Politicas por org: cobertura {_pct(d['policies']['no_action_coverage'])}, precision "
           f"{_pct(d['policies']['no_action_precision'])}, ataques absorbidos "
           f"{_pct(d['policies']['tp_absorbed_of_all_tp'])}.", ""]
    if tuning is not None:
        best = tuning.iloc[0]
        md += ["## 8. Tuneo acotado", "",
               "Validacion interna: dentro del pasado, el ultimo 20 % de cada organizacion valida. La evaluacion "
               "no se usa para elegir.", "",
               _table(tuning.assign(f1=tuning.val_macro_f1.map(lambda v: _f(v, 4)),
                                    s=tuning.seconds.map(lambda v: f"{v:.0f}")),
                      ["params", "f1", "iterations", "s"], ["Parametros", "Macro-F1 validacion", "Iteraciones",
                                                            "Segundos"]), "",
               f"- Elegido: {best['params']}.",
               f"- Macro-F1 en la evaluacion temporal: {_f(r['tuned']['model'], 4)} "
               f"(por defecto {_f(m['model'], 4)}).", ""]
    (out / "ROBUSTEZ.md").write_text("\n".join(md), encoding="utf-8")


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=None, help="carpeta con incidents_*_all.parquet (por defecto ml/out)")
    ap.add_argument("--sample", default="all", help="sufijo del cache: all o la fraccion de orgs (ej. 0.1)")
    ap.add_argument("--bootstrap", type=int, default=1000)
    ap.add_argument("--seeds", type=int, nargs="+", default=[0, 1, 2])
    ap.add_argument("--skip-tuning", action="store_true")
    args = ap.parse_args()
    root = Path(__file__).resolve().parent.parent / "out"
    cache = Path(args.cache) if args.cache else root
    out = root / ("robustez" if args.sample == "all" else f"robustez_{args.sample}")
    out.mkdir(parents=True, exist_ok=True)
    seed = args.seeds[0]

    inc = pd.concat([pd.read_parquet(cache / f"incidents_{n}_{args.sample}.parquet") for n in ("Train", "Test")],
                    ignore_index=True)
    past, future = policies.temporal_split(inc)
    log(f"temporal: {len(past):,} / {len(future):,}")
    y, org = future["verdict"], future["org_id"]
    r = {"bootstrap": args.bootstrap, "seeds": {}}

    lookup = LookupTable().fit(past).predict(future).to_numpy()
    base = np.full(len(future), majority(past))
    proba = classes = None
    for s in args.seeds:
        p, c, _ = fit_predict(past, future, s)
        f1 = float(macro_f1(confusion_by_org(org, y, c[p.argmax(1)]).sum(0)))
        r["seeds"][s] = f1
        log(f"semilla {s}: {f1:.4f}")
        if s == seed:
            proba, classes = p, c
    pred = classes[proba.argmax(1)]

    cms = {name: confusion_by_org(org, y, p) for name, p in
           (("majority", base), ("lookup", lookup), ("model", pred))}
    r["temporal"] = {name: float(macro_f1(cm.sum(0))) for name, cm in cms.items()}
    r["temporal"]["ci"] = bootstrap(
        [cms["majority"], cms["lookup"], cms["model"]],
        lambda a, b, c: {"majority": macro_f1(a), "lookup": macro_f1(b), "model": macro_f1(c),
                         "model_minus_lookup": macro_f1(c) - macro_f1(b)},
        args.bootstrap, seed)
    log("intervalos del modelo listos")

    patterns = policies.mine(past, "org")
    applied = policies.apply(patterns, future, "org")
    counts = policy_counts(applied)
    r["policies"] = {"value": policy_stats(counts.sum(0)),
                     "ci": bootstrap([counts], policy_stats, args.bootstrap, seed)}
    profile = absorbed_profile(applied.assign(category=future["category"].to_numpy()))
    log("politicas listas")

    calib, r["calibration"] = calibration(proba, y, classes)
    ops = operating_points(proba, y, classes)

    cut = pd.Timestamp(DATE_CUT, tz="UTC")
    before, after = inc[inc["first_seen"] < cut], inc[inc["first_seen"] >= cut]
    p, c, _ = fit_predict(before, after, seed)
    ya = after["verdict"]
    d_applied = policies.apply(policies.mine(before, "org"), after, "org")
    r["date_cut"] = {
        "train": len(before), "test": len(after),
        "majority": float(macro_f1(confusion_by_org(after["org_id"], ya, np.full(len(after), majority(before))).sum(0))),
        "lookup": float(macro_f1(confusion_by_org(after["org_id"], ya, LookupTable().fit(before).predict(after)).sum(0))),
        "model": float(macro_f1(confusion_by_org(after["org_id"], ya, c[p.argmax(1)]).sum(0))),
        "pair_seen_share": float((history_segment(before, after) == "pair_seen").mean()),
        "policies": policy_stats(policy_counts(d_applied).sum(0)),
    }
    log("corte por fecha listo")

    tuning = None
    if not args.skip_tuning:
        tuning = tune(past, seed)
        best = tuning.iloc[0]["params"]
        params = {} if best == "por defecto" else json.loads(best)
        p, c, _ = fit_predict(past, future, seed, params)
        r["tuned"] = {"params": params, "model": float(macro_f1(confusion_by_org(org, y, c[p.argmax(1)]).sum(0)))}
        tuning.to_csv(out / "tuneo.csv", index=False)
        log("tuneo listo")

    calib.to_csv(out / "calibracion.csv", index=False)
    ops.to_csv(out / "punto_operacion.csv", index=False)
    figures(out, calib, ops)
    report(out, r, ops, calib, profile, tuning)
    with open(out / "robustez.json", "w", encoding="utf-8") as f:
        json.dump(r, f, ensure_ascii=False, indent=2, default=float)
    log(f"listo: {out / 'ROBUSTEZ.md'}")


if __name__ == "__main__":
    main()
