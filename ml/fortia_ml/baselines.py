# Lineas de base triviales. Si el modelo no les gana, no aporta.
# - majority: siempre la clase mas frecuente del entrenamiento.
# - lookup: (org, regla) -> veredicto mayoritario; si el par no aparece,
#   regla -> mayoritario; si tampoco, la clase mayoritaria. Es lo que haria
#   un SOC con una planilla de "esta regla siempre es ruido".
import pandas as pd


def _mode_by(train, keys):
    counts = train.groupby(keys + ["verdict"]).size()
    # Empate: gana el veredicto que va primero alfabeticamente (deterministico).
    best = counts.groupby(level=list(range(len(keys)))).idxmax()
    return pd.Series([idx[-1] for idx in best], index=best.index, name="verdict")


def majority(train):
    return train["verdict"].value_counts().idxmax()


class LookupTable:
    def fit(self, train):
        self.by_org_rule = _mode_by(train, ["org_id", "rule"])
        self.by_rule = _mode_by(train, ["rule"])
        self.default = majority(train)
        return self

    def predict(self, df):
        org_rule = pd.MultiIndex.from_frame(df[["org_id", "rule"]])
        pred = pd.Series(self.by_org_rule.reindex(org_rule).to_numpy(), index=df.index)
        pred = pred.fillna(pd.Series(self.by_rule.reindex(df["rule"]).to_numpy(), index=df.index))
        return pred.fillna(self.default)
