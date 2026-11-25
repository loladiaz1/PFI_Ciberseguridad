# Mineria de patrones -> politicas de automatizacion sugeridas.
#
# Un patron es un grupo de incidentes con la misma regla, el mismo tipo de
# entidad dominante y el mismo tamano (1, 2-5 o 6+ alertas). Si tiene al
# menos N casos y al menos el X % comparte la decision del analista, se
# sugiere una politica. La decision es binaria:
# - requires_action: true_positive (habria que contener).
# - no_action: benign_positive o false_positive (cerrar sin accion).
# El error critico es que una politica no_action absorba un true_positive:
# un ataque real cerrado sin que lo vea nadie.
#
# Dos alcances: "org" (cada SOC mina sus propios casos) y "global" (un MSSP
# que ve muchos clientes mina todos juntos).
import re

import numpy as np
import pandas as pd

ACTION = "requires_action"
NO_ACTION = "no_action"
PATTERN = ["rule", "dominant_entity", "alert_bucket"]
SCOPES = {"org": ["org_id"], "global": []}
DEFAULT_N = 20
DEFAULT_X = 0.95

# Accion de Fortia para un patron requires_action, segun la evidencia
# dominante (orchestrator/src/automation.js, ACTION_LABELS). User, Url, etc.
# no tienen accion equivalente (GUIDE contiene cuentas: ContainAccount).
ENTITY_ACTION = {
    "Ip": "block-ip",
    "Machine": "isolate-host",
    "File": "isolate-host",
    "Process": "isolate-host",
    "MailMessage": "quarantine-email",
    "MailCluster": "quarantine-email",
    "Mailbox": "quarantine-email",
}


def alert_bucket(alert_count):
    return pd.cut(alert_count, bins=[0, 1, 5, np.inf], labels=["1", "2-5", "6+"]).astype(str)


def _with_pattern(df):
    return df.assign(alert_bucket=alert_bucket(df["alert_count"]), needs_action=df["verdict"].eq("true_positive"))


def mine(train, scope, n=DEFAULT_N, x=DEFAULT_X):
    keys = SCOPES[scope] + PATTERN
    d = _with_pattern(train).assign(is_bp=train["verdict"].eq("benign_positive"))
    g = d.groupby(keys, observed=True).agg(
        support=("needs_action", "size"),
        true_positive=("needs_action", "sum"),
        benign_positive=("is_bp", "sum"),
    ).reset_index()
    g["false_positive"] = g["support"] - g["true_positive"] - g["benign_positive"]
    g["tp_share"] = g["true_positive"] / g["support"]
    g["decision"] = np.select([g["tp_share"] >= x, 1 - g["tp_share"] >= x], [ACTION, NO_ACTION], default="")
    return g[(g["support"] >= n) & (g["decision"] != "")].reset_index(drop=True)


def apply(patterns, df, scope):
    # decision vacia = ninguna politica coincide, decide el analista.
    keys = SCOPES[scope] + PATTERN
    m = _with_pattern(df).merge(patterns[keys + ["decision"]], on=keys, how="left")
    m["decision"] = m["decision"].fillna("")
    return m


def metrics(applied):
    total = len(applied)
    tp_total = int(applied["needs_action"].sum())
    out = {"incidents": total}
    for dec in (NO_ACTION, ACTION):
        sel = applied["decision"].eq(dec)
        correct = applied["needs_action"].eq(dec == ACTION)
        matched = int(sel.sum())
        out[dec] = {
            "matched": matched,
            "coverage": matched / total if total else None,
            "precision": float(correct[sel].mean()) if matched else None,
        }
    absorbed = int((applied["decision"].eq(NO_ACTION) & applied["needs_action"]).sum())
    out[NO_ACTION]["tp_absorbed"] = absorbed
    # De todos los ataques reales, cuantos se habrian cerrado sin verlos.
    out[NO_ACTION]["tp_absorbed_of_all_tp"] = absorbed / tp_total if tp_total else None
    sel = applied["decision"].ne("")
    correct = applied["needs_action"].eq(applied["decision"].eq(ACTION))
    out["all"] = {
        "matched": int(sel.sum()),
        "coverage": float(sel.mean()) if total else None,
        "precision": float(correct[sel].mean()) if sel.any() else None,
    }
    return out


def _flat(m):
    return {
        "coverage": m["all"]["coverage"],
        "precision": m["all"]["precision"],
        "no_action_coverage": m[NO_ACTION]["coverage"],
        "no_action_precision": m[NO_ACTION]["precision"],
        "tp_absorbed": m[NO_ACTION]["tp_absorbed"],
        "tp_absorbed_of_all_tp": m[NO_ACTION]["tp_absorbed_of_all_tp"],
        "action_coverage": m[ACTION]["coverage"],
        "action_precision": m[ACTION]["precision"],
    }


def per_org(applied):
    # Distribucion entre organizaciones (cada org = un SOC). La precision solo
    # existe en las orgs donde alguna politica coincidio.
    a = applied
    noa = a["decision"].eq(NO_ACTION)
    sel = a["decision"].ne("")
    flags = pd.DataFrame({
        "n": 1,
        "sel": sel,
        "correct": sel & a["needs_action"].eq(a["decision"].eq(ACTION)),
        "noa": noa,
        "noa_correct": noa & ~a["needs_action"],
        "absorbed": noa & a["needs_action"],
        "tp": a["needs_action"],
    })
    g = flags.groupby(a["org_id"]).sum()
    ratio = lambda num, den: (g[num] / g[den]).where(g[den] > 0)
    df = pd.DataFrame({
        "coverage": g["sel"] / g["n"],
        "precision": ratio("correct", "sel"),
        "no_action_coverage": g["noa"] / g["n"],
        "no_action_precision": ratio("noa_correct", "noa"),
        "tp_absorbed_of_all_tp": ratio("absorbed", "tp"),
    })
    stats = {}
    for col in ("coverage", "precision", "no_action_coverage", "no_action_precision", "tp_absorbed_of_all_tp"):
        s = df[col].dropna()
        stats[col] = {
            "orgs": int(len(s)),
            "mean": float(s.mean()) if len(s) else None,
            "p10": float(s.quantile(0.1)) if len(s) else None,
            "median": float(s.median()) if len(s) else None,
            "p90": float(s.quantile(0.9)) if len(s) else None,
        }
    return stats


def grid(train, test, scope, ns, xs):
    rows = []
    for n in ns:
        for x in xs:
            patterns = mine(train, scope, n, x)
            applied = apply(patterns, test, scope)
            row = {"scope": scope, "N": n, "X": x, "policies": len(patterns),
                   "no_action_policies": int(patterns["decision"].eq(NO_ACTION).sum()), **_flat(metrics(applied))}
            if scope == "org":
                dist = per_org(applied)
                row["org_coverage_mean"] = dist["coverage"]["mean"]
                row["org_coverage_median"] = dist["coverage"]["median"]
                row["org_precision_mean"] = dist["precision"]["mean"]
                row["org_precision_p10"] = dist["precision"]["p10"]
                row["orgs_with_policies"] = int(patterns["org_id"].nunique()) if len(patterns) else 0
            rows.append(row)
    return pd.DataFrame(rows)


def temporal_split(inc, past_frac=0.7):
    # Dentro de cada org: el primer 70 % de sus incidentes (por first_seen)
    # es el pasado, el resto el futuro.
    rank = inc.groupby("org_id")["first_seen"].rank(method="first", pct=True)
    past = rank <= past_frac
    return inc[past].reset_index(drop=True), inc[~past].reset_index(drop=True)


def _slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def to_policies(patterns, scope, n, x, limit=10):
    # Mismo esqueleto que orchestrator/config/automation.defaults.json. Las
    # condiciones de GUIDE no existen en Fortia (failedConditions()), por eso
    # conditions queda vacio y el patron va en guideConditions.
    top = patterns.sort_values(["support", "tp_share"], ascending=[False, False]).head(limit)
    policies = []
    for order, p in enumerate(top.itertuples(index=False), start=1):
        org = f"org {p.org_id} · " if scope == "org" else ""
        policy = {
            "key": _slug(f"guide-{org}det-{p.rule}-{p.dominant_entity}-{p.alert_bucket}"),
            "name": f"GUIDE {org}detector {p.rule} · {p.dominant_entity} · alertas {p.alert_bucket} → {p.decision}",
            "order": order,
            "enabled": False,
            "useCase": None,
            "action": None,
            "conditions": {},
            "guideConditions": {
                **({"orgId": int(p.org_id)} if scope == "org" else {}),
                "detectorId": p.rule,
                "dominantEntity": p.dominant_entity,
                "alerts": p.alert_bucket,
            },
            "evidence": {
                "support": int(p.support),
                "true_positive": int(p.true_positive),
                "benign_positive": int(p.benign_positive),
                "false_positive": int(p.false_positive),
                "agreement": round(float(p.tp_share if p.decision == ACTION else 1 - p.tp_share), 4),
            },
        }
        if p.decision == NO_ACTION:
            policy["proposedAction"] = "close-as-benign"
            policy["finding"] = "Accion inexistente en automation.js (solo block-ip, isolate-host, quarantine-email)"
        elif p.dominant_entity in ENTITY_ACTION:
            policy["action"] = ENTITY_ACTION[p.dominant_entity]
        else:
            policy["finding"] = f"Sin accion de Fortia para la entidad {p.dominant_entity}"
        policies.append(policy)
    return {
        "_comment": "Politicas SUGERIDAS por ml/fortia_ml (minadas en GUIDE). Arrancan deshabilitadas, en modo simulacion, y las aprueba un admin. Siguen valiendo activo critico = solo manual, lista de exclusion y cortacircuitos.",
        "source": "GUIDE",
        "scope": scope,
        "minSupport": n,
        "minAgreement": x,
        "mode": "simulate",
        "policies": policies,
    }
