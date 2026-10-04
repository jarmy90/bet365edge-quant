# Auditoría post-hoc HistData: temporal, mensual, bootstrap, score.
# Lee es_hist_h1_v2_trades.csv (separador ';'). El CSV es cost=0.5/minrisk=0.30.
import pandas as pd
import numpy as np

T = pd.read_csv("es_hist_h1_v2_trades.csv", sep=";")
T["pivot_time"] = pd.to_datetime(T["pivot_time"])
print(f"filas={len(T)} signals={T.signal_id.nunique()} "
      f"{T.pivot_time.min()} -> {T.pivot_time.max()}")
T["combo"] = T.side + "|" + T.entry_mode + "|" + T.exit_model


def agg(x):
    pos = x.loc[x.r_multiple > 0, "r_multiple"].sum()
    neg = abs(x.loc[x.r_multiple < 0, "r_multiple"].sum())
    s = x.r_multiple.sort_values(ascending=False)
    top5 = s.head(5).sum()
    net = s.sum()
    w = x.r_multiple.clip(-5, 5).sum()
    return pd.Series({
        "trades": len(x), "net_R": net,
        "avg_R": x.r_multiple.mean(),
        "mediana_R": x.r_multiple.median(),
        "win%": (x.r_multiple > 0).mean() * 100,
        "PF": pos / neg if neg > 0 else np.nan,
        "net_exTop5": net - top5,
        "%top5": 100 * top5 / net if net != 0 else np.nan,
        "net_winsor5": w,
    })


print("=== TOP (base cost 0.5 / mr 0.3) ===")
g = T.groupby("combo").apply(agg, include_groups=False).sort_values("net_R", ascending=False)
print(g.round(3).to_string())
print()
print("=== TEMPORAL dev/val/test (por signal_id cronológico) ===")
order = sorted(T.signal_id.unique())
q1, q2 = int(len(order) * 0.5), int(len(order) * 0.75)
seg = {s: k for k, ss in {"dev": order[:q1], "val": order[q1:q2], "test": order[q2:]}.items() for s in ss}
T["seg"] = T.signal_id.map(seg)
print(T.groupby(["combo", "seg"]).r_multiple.sum().unstack(fill_value=0).round(2).to_string())
print()
print("=== MENSUAL/TRIMESTRAL (top4 combos) ===")
T["month"] = T.pivot_time.dt.to_period("M").astype(str)
T["quarter"] = T.pivot_time.dt.to_period("Q").astype(str)
TOPN = 4
top_combos = g.head(TOPN).index.tolist()
for cb in top_combos:
    x = T[T.combo == cb]
    mn = x.groupby("month").r_multiple.sum()
    qt = x.groupby("quarter").r_multiple.sum()
    s = x.r_multiple.sort_values(ascending=False)
    print(f"{cb}: n={len(x)} meses+={(mn > 0).sum()}/{mn.count()} "
          f"trim+={(qt > 0).sum()}/{qt.count()} mejor_trim={qt.max():.1f} "
          f"peor_trim={qt.min():.1f} %top5={100 * s.head(5).sum() / s.sum():.1f}%")
print()
print("=== BOOTSTRAP x signal_id (300 reps, net_R y PF) ===")
rng = np.random.default_rng(7)
for cb in top_combos + [c for c in g.index if c not in top_combos][:2]:
    ids = T[T.combo == cb][["signal_id", "r_multiple"]].values
    u = np.array(sorted(set(ids[:, 0]), key=str))
    m = {s: ids[ids[:, 0] == s, 1].astype(float).sum() for s in u}
    v = np.array([m[s] for s in u], dtype=float)
    b = np.array([rng.choice(v, len(v), replace=True).sum() for _ in range(300)])
    pf = []
    for _ in range(300):
        w = rng.choice(v, len(v), replace=True)
        pp, nn = w[w > 0].sum(), abs(w[w < 0].sum())
        pf.append(pp / nn if nn > 0 else np.nan)
    print(f"{cb}: n={len(v)} net_mean={b.mean():.1f} "
          f"p5={np.nanpercentile(b, 5):.1f} p95={np.nanpercentile(b, 95):.1f} "
          f"PF_mean={np.nanmean(pf):.2f} PF_p5={np.nanpercentile(pf, 5):.2f} "
          f"PF_p95={np.nanpercentile(pf, 95):.2f}")
print()
print("=== SCORE: correlaciones y terciles vs R ===")
for col in ["evidence", "node_strength", "absorption", "score"]:
    print(f"corr({col},R)={T[col].corr(T.r_multiple):.4f}")
    T["q"] = pd.qcut(T[col], 3, labels=["T1", "T2", "T3"], duplicates="drop")
    print(T.groupby("q", observed=True).r_multiple.agg(["count", "mean", "sum"]).round(3).to_string())

