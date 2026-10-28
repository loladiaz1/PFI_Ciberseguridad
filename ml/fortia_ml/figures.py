# Figuras para la tesis, a partir de lo que dejo train.py en --out:
# - confusion_matrix.png: modelo de la evaluacion temporal (la principal).
# - policy_tradeoff.png: cobertura de las politicas "cerrar sin accion" contra
#   la tasa de ataques reales absorbidos, para la grilla N x X, por org y MSSP.
#
#   python -m fortia_ml.figures [--out ml/out]
import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from matplotlib.ticker import FixedLocator, FuncFormatter

from .schema import VERDICTS

# Paleta de referencia (skill dataviz), modo claro.
SURFACE = "#fcfcfb"
TEXT = "#0b0b0b"
TEXT_2 = "#52514e"
GRID = "#e4e3df"
SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"]
LABELS = {"true_positive": "Verdadero\npositivo", "benign_positive": "Benigno\npositivo", "false_positive": "Falso\npositivo"}


def _es(value, decimals):
    # Coma decimal (la tesis esta en castellano).
    return f"{value:.{decimals}f}".replace(".", ",")


def _style(ax):
    ax.set_facecolor(SURFACE)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(GRID)
    ax.tick_params(colors=TEXT_2, labelsize=9)
    ax.grid(color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)


def confusion(metrics, path):
    cm = pd.DataFrame(metrics["temporal"]["confusion_matrix"]["model"]).T.loc[list(VERDICTS), list(VERDICTS)]
    rate = cm.div(cm.sum(axis=1), axis=0)
    fig, ax = plt.subplots(figsize=(5.2, 4.4), facecolor=SURFACE)
    ax.imshow(rate.to_numpy(), cmap="Blues", vmin=0, vmax=1)
    for i in range(3):
        for j in range(3):
            r = rate.iat[i, j]
            ax.text(j, i, f"{r:.1%}\n({cm.iat[i, j]:,})".replace(",", "."), ha="center", va="center",
                    fontsize=9, color="white" if r > 0.5 else TEXT)
    ticks = [LABELS[v] for v in VERDICTS]
    ax.set_xticks(range(3), ticks, fontsize=9, color=TEXT_2)
    ax.set_yticks(range(3), ticks, fontsize=9, color=TEXT_2)
    ax.set_xlabel("Predicción del modelo", color=TEXT_2)
    ax.set_ylabel("Veredicto del analista", color=TEXT_2)
    ax.set_title("Matriz de confusión (evaluación temporal, % por fila)", fontsize=10, color=TEXT, loc="left")
    for s in ax.spines.values():
        s.set_visible(False)
    fig.tight_layout()
    fig.savefig(path, dpi=200)
    plt.close(fig)


def tradeoff(grid, path):
    g = grid[grid["evaluation"] == "temporal"]
    titles = {"org": "Por organización (SOC propio)", "global": "Entre organizaciones (MSSP)"}
    fig, axes = plt.subplots(1, 2, figsize=(10, 4.2), sharey=True, facecolor=SURFACE)
    for ax, scope in zip(axes, ("org", "global")):
        _style(ax)
        d = g[g["scope"] == scope]
        for color, (x, s) in zip(SERIES, d.groupby("X")):
            s = s.sort_values("N")
            ax.plot(s["tp_absorbed_of_all_tp"] * 100, s["no_action_coverage"] * 100, color=color, linewidth=2,
                    marker="o", markersize=6, markeredgecolor=SURFACE, markeredgewidth=1.5, label=f"X = {x * 100:.0f} %")
            # N solo en la serie X = 95 % (la configuracion por defecto) del
            # panel por org; en el MSSP los puntos quedan muy juntos.
            if x == 0.95 and scope == "org":
                for _, r in s.iterrows():
                    ax.annotate(f"N={r['N']}", (r["tp_absorbed_of_all_tp"] * 100, r["no_action_coverage"] * 100),
                                textcoords="offset points", xytext=(6, -3), fontsize=8, color=TEXT_2)
        ax.set_xscale("log")
        ax.xaxis.set_major_locator(FixedLocator([0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50]))
        ax.xaxis.set_minor_locator(FixedLocator([]))
        ax.xaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{_es(v, 1 if v < 1 else 0)} %"))
        ax.set_title(titles[scope], fontsize=10, color=TEXT, loc="left")
        ax.set_xlabel("Ataques reales absorbidos (% de todos los TP)", color=TEXT_2, fontsize=9)
    axes[0].set_ylabel("Incidentes cerrados sin acción (% cobertura)", color=TEXT_2, fontsize=9)
    axes[1].legend(frameon=False, fontsize=9, labelcolor=TEXT_2, loc="lower right")
    fig.suptitle("Políticas «cerrar sin acción»: ruido absorbido vs. ataques perdidos (evaluación temporal)",
                 fontsize=11, color=TEXT, x=0.01, ha="left")
    fig.tight_layout()
    fig.savefig(path, dpi=200)
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "out"))
    out = Path(ap.parse_args().out)
    with open(out / "metrics.json", encoding="utf-8") as f:
        metrics = json.load(f)
    confusion(metrics, out / "confusion_matrix.png")
    tradeoff(pd.read_csv(out / "policy_grid.csv"), out / "policy_tradeoff.png")
    print(f"figuras en {out}")


if __name__ == "__main__":
    main()
