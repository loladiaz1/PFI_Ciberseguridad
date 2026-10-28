# Esquema comun -> matriz de features para el clasificador.
#
# La regla (8.428 detectores en GUIDE) entra como codificacion por objetivo
# (TargetEncoder): la tasa de cada veredicto para esa regla, global y dentro
# de la organizacion. Es la misma informacion que la tabla de base
# (baselines.py), suavizada y con validacion cruzada interna para no
# filtrar la etiqueta en train.
import pandas as pd
from sklearn.model_selection import StratifiedKFold
from sklearn.preprocessing import TargetEncoder

from .guide import ENTITY_COLUMNS

NUMERIC = [
    "alert_count", "evidence_count", "detector_count", "category_count", "duration_s",
    "n_impacted", "n_suspicious", "n_incriminated", "n_threat_family", "n_mitre", "n_antispam",
    *ENTITY_COLUMNS,
]
CATEGORICAL = ["category", "dominant_entity"]
ENCODED = ["rule", "org_rule"]


def _base(inc, extra):
    return pd.DataFrame({
        **{c: inc[c] for c in NUMERIC + extra if c != "duration_s"},
        "duration_s": (inc["last_seen"] - inc["first_seen"]).dt.total_seconds(),
        "rule": inc["rule"].astype(str),
        "org_rule": inc["org_id"].astype(str) + ":" + inc["rule"].astype(str),
    }, index=inc.index)


class FeatureBuilder:
    # extra: columnas numericas adicionales (ej. guide.LAST_VERDICT_COLUMNS).
    def __init__(self, random_state=0, extra=()):
        self.extra = list(extra)
        self.encoder = TargetEncoder(target_type="multiclass", cv=StratifiedKFold(5, shuffle=True, random_state=random_state))

    def _categorical(self, inc, X):
        for c in CATEGORICAL:
            # Valor no visto en train -> desconocido (NaN).
            known = inc[c].where(inc[c].isin(self.categories[c]))
            X[c] = pd.Categorical(known, categories=self.categories[c])
        return X

    def fit_transform(self, inc):
        X = _base(inc, self.extra)
        self.categories = {c: sorted(inc[c].dropna().unique()) for c in CATEGORICAL}
        enc = self.encoder.fit_transform(X[ENCODED], inc["verdict"])
        X = X.drop(columns=ENCODED).join(pd.DataFrame(enc, columns=self.encoder.get_feature_names_out(), index=X.index))
        return self._categorical(inc, X)

    def transform(self, inc):
        X = _base(inc, self.extra)
        enc = self.encoder.transform(X[ENCODED])
        X = X.drop(columns=ENCODED).join(pd.DataFrame(enc, columns=self.encoder.get_feature_names_out(), index=X.index))
        return self._categorical(inc, X)
