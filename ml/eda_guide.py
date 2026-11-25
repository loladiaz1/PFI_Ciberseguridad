"""Analisis exploratorio de GUIDE (Microsoft Security Incident Prediction).

Dos niveles:
  1. Evidencia: los CSV originales, leidos en bloques (no entran en memoria).
  2. Incidente: las tablas agregadas por fortia_ml (out/incidents_*_all.parquet).

Responde lo que pregunto el jurado: si los datos son reales y correctos, y de
donde sale la senal que usa el modelo. Escribe out/eda/EDA.md y las figuras.

    .venv\\Scripts\\python eda_guide.py --data ..\\data\\guide\\archive
"""
import argparse
import json
import time
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.csv as pcsv

HERE = Path(__file__).parent
OUT = HERE / "out" / "eda"
ID_COLUMNS = ["DeviceId", "Sha256", "IpAddress", "Url", "AccountSid", "AccountUpn", "AccountObjectId",
              "AccountName", "DeviceName", "NetworkMessageId", "RegistryKey", "ApplicationId", "FileName",
              "FolderPath", "OSFamily", "OSVersion", "CountryCode", "State", "City"]
COUNT_COLUMNS = ["Category", "EntityType", "EvidenceRole", "IncidentGrade", "LastVerdict", "SuspicionLevel",
                 "ActionGrouped"]
VERDICTS = ["true_positive", "benign_positive", "false_positive"]
T0 = time.time()


def log(msg):
    print(f"[{time.time() - T0:6.0f}s] {msg}", flush=True)


def pct(part, total):
    return 100.0 * part / total if total else 0.0


# ---------------------------------------------------------------- evidencia

def scan_csv(path):
    """Una pasada por el CSV: nulos, duplicados, consistencia del grado, fechas y conteos."""
    header = path.open(encoding="utf-8").readline().strip().split(",")
    reader = pcsv.open_csv(
        path,
        read_options=pcsv.ReadOptions(block_size=64 << 20),
        convert_options=pcsv.ConvertOptions(column_types={c: pa.string() for c in header},
                                            strings_can_be_null=True),
    )
    rows = 0
    nulls = {c: 0 for c in header}
    ids, grades, actions, row_hashes = [], [], [], []
    counts = {c: pd.Series(dtype="int64") for c in COUNT_COLUMNS}
    sentinel, sentinel_hits = {}, {c: 0 for c in ID_COLUMNS}
    ts_min, ts_max = None, None
    for batch in reader:
        t = pa.Table.from_batches([batch])
        rows += t.num_rows
        for c in header:
            nulls[c] += t[c].null_count
        ids.append(pc.cast(t["Id"], pa.int64()).to_numpy())
        row_hashes.append(pd.util.hash_pandas_object(t.to_pandas(), index=False).to_numpy())
        key = t.select(["OrgId", "IncidentId", "IncidentGrade"]).to_pandas().drop_duplicates()
        grades.append(key)
        act = t.select(["OrgId", "IncidentId", "ActionGrouped"]).to_pandas().dropna()
        actions.append(act[["OrgId", "IncidentId"]].drop_duplicates())
        for c in COUNT_COLUMNS:
            vc = t[c].to_pandas().value_counts(dropna=False)
            counts[c] = counts[c].add(vc, fill_value=0)
        # Valor de relleno de cada columna anonimizada: el mas frecuente del primer bloque.
        for c in ID_COLUMNS:
            if c not in sentinel:
                vc = t[c].to_pandas().value_counts()
                sentinel[c] = vc.index[0] if len(vc) else None
            if sentinel[c] is not None:
                sentinel_hits[c] += int(pc.sum(pc.equal(t[c], sentinel[c])).as_py() or 0)
        ts = pc.min_max(t["Timestamp"])
        lo, hi = ts["min"].as_py(), ts["max"].as_py()
        ts_min = lo if ts_min is None or (lo and lo < ts_min) else ts_min
        ts_max = hi if ts_max is None or (hi and hi > ts_max) else ts_max
    ids = np.concatenate(ids)
    grades = pd.concat(grades).drop_duplicates()
    graded = grades.dropna(subset=["IncidentGrade"])
    per_incident = graded.groupby(["OrgId", "IncidentId"])["IncidentGrade"].nunique()
    incidents = grades[["OrgId", "IncidentId"]].drop_duplicates()
    actions = pd.concat(actions).drop_duplicates()
    return {
        "rows": rows,
        "columns": len(header),
        "nulls": nulls,
        "distinct_ids": int(len(np.unique(ids))),
        "duplicate_rows": int(rows - len(np.unique(np.concatenate(row_hashes)))),
        "incidents": len(incidents),
        "incidents_ungraded": int(len(incidents) - graded[["OrgId", "IncidentId"]].drop_duplicates().shape[0]),
        "incidents_multi_grade": int((per_incident > 1).sum()),
        "incidents_with_action": len(actions),
        "counts": {c: s.sort_values(ascending=False).astype(int) for c, s in counts.items()},
        "sentinel": {c: (sentinel[c], sentinel_hits[c]) for c in ID_COLUMNS},
        "ts_min": ts_min,
        "ts_max": ts_max,
        "keys": incidents,
    }


# ---------------------------------------------------------------- incidente

def purity(df):
    """Para cada par (org, regla): cuantos casos y que % se cerro con el veredicto mayoritario."""
    g = df.groupby(["org_id", "rule"])["verdict"]
    top = g.agg(lambda s: s.value_counts().iloc[0])
    n = g.size()
    out = pd.DataFrame({"n": n, "agreement": top / n}).reset_index()
    return out


def figures(train, test, pur):
    OUT.mkdir(parents=True, exist_ok=True)
    plt.rcParams.update({"figure.dpi": 120, "font.size": 9})
    colors = {"true_positive": "#c0392b", "benign_positive": "#2e86c1", "false_positive": "#7f8c8d"}

    fig, ax = plt.subplots(figsize=(6, 3))
    share = pd.DataFrame({"Train": train["verdict"].value_counts(normalize=True),
                          "Test": test["verdict"].value_counts(normalize=True)}).loc[VERDICTS] * 100
    share.T.plot.barh(stacked=True, ax=ax, color=[colors[v] for v in VERDICTS], width=0.6)
    ax.set_xlabel("% de incidentes")
    ax.set_title("Veredicto del analista")
    ax.legend(loc="center left", bbox_to_anchor=(1, 0.5), frameon=False)
    fig.tight_layout()
    fig.savefig(OUT / "01_veredictos.png")
    plt.close(fig)

    fig, axes = plt.subplots(1, 2, figsize=(9, 3))
    axes[0].hist(train["alert_count"].clip(upper=30), bins=30, color="#555")
    axes[0].set_yscale("log")
    axes[0].set_xlabel("alertas por incidente (30 = 30 o mas)")
    axes[0].set_ylabel("incidentes (escala log)")
    org = train.groupby("org_id").size()
    axes[1].hist(np.log10(org), bins=40, color="#555")
    axes[1].set_xlabel("incidentes por organizacion (log10)")
    axes[1].set_ylabel("organizaciones")
    fig.suptitle("Incidentes chicos y organizaciones muy desiguales")
    fig.tight_layout()
    fig.savefig(OUT / "02_tamanos.png")
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(9, 3))
    for name, df in (("Train", train), ("Test", test)):
        daily = df.set_index("first_seen").resample("D").size()
        ax.plot(daily.index, daily.values, label=name)
    ax.set_ylabel("incidentes por dia")
    ax.set_title("Train y Test cubren el mismo periodo: el split no es temporal")
    ax.legend(frameon=False)
    fig.tight_layout()
    fig.savefig(OUT / "03_tiempo.png")
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(8, 5))
    top = train["category"].value_counts().index[:12]
    ct = pd.crosstab(train.loc[train["category"].isin(top), "category"],
                     train["verdict"], normalize="index").reindex(top)[VERDICTS] * 100
    ct.plot.barh(stacked=True, ax=ax, color=[colors[v] for v in VERDICTS])
    ax.invert_yaxis()
    ax.set_xlabel("% de incidentes de la categoria")
    ax.set_title("Veredicto por categoria MITRE (12 mas frecuentes)")
    ax.legend(loc="center left", bbox_to_anchor=(1, 0.5), frameon=False)
    fig.tight_layout()
    fig.savefig(OUT / "04_categorias.png")
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(6, 3.2))
    big = pur[pur["n"] >= 20]
    ax.hist(big["agreement"] * 100, bins=40, weights=big["n"], color="#555")
    ax.set_xlabel("% de casos cerrados con el veredicto mayoritario del par")
    ax.set_ylabel("incidentes")
    ax.set_title("Pares (organizacion, regla) con 20+ casos")
    fig.tight_layout()
    fig.savefig(OUT / "05_pureza.png")
    plt.close(fig)


# ---------------------------------------------------------------- reporte

def table(rows, headers):
    lines = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    lines += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(lines)


def fmt(n):
    return f"{n:,.0f}".replace(",", ".")


def fpct(x):
    return f"{x:.1f} %".replace(".", ",")


def report(raw, train, test, pur, summary):
    tr, te = raw["Train"], raw["Test"]
    md = ["# Analisis exploratorio de GUIDE", "",
          "Generado por `ml/eda_guide.py`. Cifras sobre los CSV originales (nivel evidencia) y sobre los "
          "incidentes agregados por `fortia_ml` (nivel incidente, solo con veredicto).", ""]

    md += ["## 1. Estructura", "",
           table([[k, fmt(v["rows"]), v["columns"], fmt(v["incidents"]), str(v["ts_min"])[:10],
                   str(v["ts_max"])[:10]] for k, v in raw.items()],
                 ["Archivo", "Filas (evidencias)", "Columnas", "Incidentes", "Desde", "Hasta"]), ""]

    md += ["## 2. Calidad de datos", "",
           table([[k, fmt(v["duplicate_rows"]), fmt(v["distinct_ids"]), fmt(v["incidents_ungraded"]),
                   fpct(pct(v["incidents_ungraded"], v["incidents"])), fmt(v["incidents_multi_grade"]),
                   fmt(v["incidents_with_action"]), fpct(pct(v["incidents_with_action"], v["incidents"]))]
                  for k, v in raw.items()],
                 ["Archivo", "Filas identicas repetidas", "Valores distintos de Id", "Incidentes sin veredicto", "%", "Incidentes con 2+ veredictos",
                  "Incidentes con accion", "%"]), "",
           f"- Incidentes en Train y en Test a la vez: **{fmt(summary['overlap_incidents'])}**.",
           f"- Organizaciones en ambos archivos: {fmt(summary['orgs_both'])} "
           f"(Train {fmt(summary['orgs_train'])}, Test {fmt(summary['orgs_test'])}).", ""]

    md += ["### Nulos por columna (Train, % de filas)", "",
           table([[c, fpct(pct(n, tr["rows"])), fpct(pct(te["nulls"][c], te["rows"]))]
                  for c, n in sorted(tr["nulls"].items(), key=lambda x: -x[1]) if n],
                 ["Columna", "Train", "Test"]), "",
           "### Columnas anonimizadas: peso del valor de relleno (Train)", "",
           "Valor mas frecuente de cada columna y % de filas que lo tienen. Un % alto indica que el campo casi "
           "nunca trae informacion (el anonimizador pone un mismo entero cuando no hay dato).", "",
           table([[c, v, fpct(pct(h, tr["rows"]))] for c, (v, h) in
                  sorted(tr["sentinel"].items(), key=lambda x: -x[1][1])],
                 ["Columna", "Valor", "% de filas"]), ""]

    md += ["## 3. Etiquetas", "",
           table([[v, fpct(pct((train["verdict"] == v).sum(), len(train))),
                   fpct(pct((test["verdict"] == v).sum(), len(test)))] for v in VERDICTS],
                 ["Veredicto", "Train", "Test"]), "",
           f"- Organizaciones de Train con un solo veredicto en todos sus incidentes: "
           f"{fmt(summary['orgs_single_class'])} de {fmt(summary['orgs_train'])}.", "",
           "![](01_veredictos.png)", "![](04_categorias.png)", ""]

    a = train["alert_count"]
    org = train.groupby("org_id").size()
    md += ["## 4. Tamanos", "",
           f"- Alertas por incidente: mediana {a.median():.0f}, p90 {a.quantile(.9):.0f}, p99 {a.quantile(.99):.0f}, "
           f"maximo {fmt(a.max())}.",
           f"- Incidentes por organizacion: mediana {org.median():.0f}, p90 {org.quantile(.9):.0f}, "
           f"maximo {fmt(org.max())}. Las 10 mas grandes concentran el {fpct(pct(org.nlargest(10).sum(), len(train)))} "
           "de los incidentes.",
           f"- Reglas (DetectorId) distintas: {fmt(train['rule'].nunique())}. Las 20 mas frecuentes cubren el "
           f"{fpct(pct(train['rule'].value_counts().iloc[:20].sum(), len(train)))} de los incidentes.", "",
           "![](02_tamanos.png)", "", "## 5. Tiempo", "",
           f"- Train: {summary['train_from']} a {summary['train_to']}. Test: {summary['test_from']} a "
           f"{summary['test_to']}.",
           f"- Organizaciones comunes en las que Test empieza despues de que termina Train: "
           f"{fmt(summary['orgs_test_after'])} de {fmt(summary['orgs_both'])}.", "",
           "![](03_tiempo.png)", ""]

    big = pur[pur["n"] >= 20]
    md += ["## 6. De donde sale la senal", "",
           "Para cada par (organizacion, regla) se mide que % de sus incidentes se cerro con el mismo veredicto.",
           "",
           table([[f">= {int(th * 100)} %", fmt(big.loc[big["agreement"] >= th, "n"].sum()),
                   fpct(pct(big.loc[big["agreement"] >= th, "n"].sum(), len(train)))]
                  for th in (0.8, 0.9, 0.95, 0.99, 1.0)],
                 ["Acuerdo del par (20+ casos)", "Incidentes", "% de Train"]), "",
           f"- Incidentes en pares con menos de 20 casos: {fpct(pct(pur.loc[pur['n'] < 20, 'n'].sum(), len(train)))}.",
           "", "![](05_pureza.png)", ""]

    md += ["## 7. Conteos a nivel evidencia (Train)", ""]
    for c in ("EntityType", "EvidenceRole", "LastVerdict", "SuspicionLevel", "ActionGrouped"):
        s = tr["counts"][c]
        md += [f"**{c}**", "", table([[("(vacio)" if pd.isna(k) else k), fmt(v), fpct(pct(v, tr["rows"]))]
                                      for k, v in s.head(8).items()], ["Valor", "Filas", "%"]), ""]
    (OUT / "EDA.md").write_text("\n".join(md), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, type=Path)
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)

    raw = {}
    for name in ("Train", "Test"):
        log(f"leyendo GUIDE_{name}.csv")
        raw[name] = scan_csv(args.data / f"GUIDE_{name}.csv")
        log(f"{name}: {raw[name]['rows']:,} filas")

    train = pd.read_parquet(HERE / "out" / "incidents_Train_all.parquet")
    test = pd.read_parquet(HERE / "out" / "incidents_Test_all.parquet")
    pur = purity(train)
    k_tr, k_te = raw["Train"]["keys"], raw["Test"]["keys"]
    overlap = k_tr.merge(k_te, on=["OrgId", "IncidentId"]).shape[0]
    span_tr = train.groupby("org_id")["first_seen"].max()
    span_te = test.groupby("org_id")["first_seen"].min()
    both = span_tr.index.intersection(span_te.index)
    summary = {
        "overlap_incidents": overlap,
        "orgs_train": train["org_id"].nunique(),
        "orgs_test": test["org_id"].nunique(),
        "orgs_both": len(both),
        "orgs_test_after": int((span_te[both] > span_tr[both]).sum()),
        "orgs_single_class": int((train.groupby("org_id")["verdict"].nunique() == 1).sum()),
        "train_from": str(train["first_seen"].min())[:10], "train_to": str(train["first_seen"].max())[:10],
        "test_from": str(test["first_seen"].min())[:10], "test_to": str(test["first_seen"].max())[:10],
    }
    figures(train, test, pur)
    report(raw, train, test, pur, summary)
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    log(f"listo: {OUT / 'EDA.md'}")


if __name__ == "__main__":
    main()
