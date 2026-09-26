# Auditoría BSP US500 — Buyers & Sellers Profile + Dynamic S/R (Zeiierman)
# Uso: python audit_bsp_us500.py <trades.csv> [--signals <signals.csv>]
# El CSV del explorer usa ';' y las columnas del Header() del .mq5.
import sys, glob
import pandas as pd
import numpy as np

pd.set_option("display.width", 220)
pd.set_option("display.max_columns", 60)

def load(path):
    t = pd.read_csv(path, sep=";")
    return t

def agg(x):
    pos = x.loc[x["r_multiple"] > 0, "r_multiple"].sum()
    neg = abs(x.loc[x["r_multiple"] < 0, "r_multiple"].sum())
    pf = pos / neg if neg > 0 else np.nan
    return pd.Series({
        "trades": len(x),
        "net_R": x["r_multiple"].sum(),
        "avg_R": x["r_multiple"].mean(),
        "win_rate": (x["r_multiple"] > 0).mean() * 100,
        "PF_R": pf,
        "avg_bars": x["bars_held"].mean(),
        "max_win_R": x["r_multiple"].max(),
        "max_loss_R": x["r_multiple"].min(),
    })

def main():
    if len(sys.argv) < 2:
        print("Uso: python audit_bsp_us500.py <trades.csv> [--signals <signals.csv>]")
        sys.exit(1)
    tp = sys.argv[1]
    t = load(tp)
    print("=" * 100); print("1) SANIDAD"); print("=" * 100)
    print(f"filas: {len(t):,}  columnas: {list(t.columns)}")
    for c in ["timeframe", "side", "entry_mode", "exit_model"]:
        if c in t.columns:
            print(f"\n{c}:\n{t[c].value_counts().to_string()}")
    print(f"\n duplicados exactos: {t.duplicated().sum()}")
    if "r_multiple" in t.columns:
        print(f"\nSUMA r_multiple = {t['r_multiple'].sum():,.2f} R  | media = {t['r_multiple'].mean():.4f} R")
    print(); print("=" * 100); print("2) TOP COMBINACIONES (TF x entrada x salida, min 20 trades)"); print("=" * 100)
    g = t.groupby(["timeframe", "entry_mode", "exit_model"]).apply(agg, include_groups=False).reset_index()
    top = g[g["trades"] >= 20].sort_values("net_R", ascending=False).head(20)
    print(top.round(3).to_string(index=False))
    print(); print("=" * 100); print("3) POR EXIT_MODEL (todas las entradas/TF juntas)"); print("=" * 100)
    g2 = t.groupby("exit_model").apply(agg, include_groups=False).sort_values("net_R", ascending=False)
    print(g2.round(3).to_string())
    print(); print("=" * 100); print("4) POR ENTRY_MODE y SIDE"); print("=" * 100)
    print(t.groupby("entry_mode").apply(agg, include_groups=False).round(3).to_string())
    print()
    print(t.groupby("side").apply(agg, include_groups=False).round(3).to_string())
    print(); print("=" * 100); print("5) CONCENTRACION (top3 trades por combo ganador)"); print("=" * 100)
    for _, row in top.head(5).iterrows():
        x = t[(t["timeframe"] == row["timeframe"]) & (t["entry_mode"] == row["entry_mode"]) & (t["exit_model"] == row["exit_model"])].sort_values("r_multiple", ascending=False)
        tot = x["r_multiple"].sum()
        t3 = x.head(3)["r_multiple"].sum()
        pct = 100 * t3 / tot if tot > 0 else float("nan")
        print(f"{row['timeframe']} {row['entry_mode']} {row['exit_model']}: trades={len(x)}, net={tot:.2f} R, top3={t3:.2f} R ({pct:.1f}%)")
    print(); print("=" * 100); print("6) MFE/MAE (¿hay recorrido para trailing?)"); print("=" * 100)
    if "mfe_points" in t.columns:
        print(t.groupby("exit_model")[["mfe_points", "mae_points", "bars_held"]].median().round(1).sort_values("mfe_points", ascending=False).to_string())
    print(); print("=" * 100); print("7) SCORE vs R (¿el score del Pine filtra?)"); print("=" * 100)
    if "score" in t.columns:
        t["score_bin"] = pd.cut(t["score"], bins=[0, 30, 45, 60, 75, 100])
        print(t.groupby("score_bin", observed=True)["r_multiple"].agg(["count", "mean", "sum"]).round(3).to_string())
    print("\nNOTA: el CSV del explorer repite cada caso en 15 filas (una por exit_model). No sumes net_R global: compara por exit_model.")

if __name__ == "__main__":
    main()
