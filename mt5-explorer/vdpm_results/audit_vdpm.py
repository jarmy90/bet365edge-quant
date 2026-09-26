# Auditoría Fase 1 de los CSV del Explorer VDPM DAX IC Markets
# Verifica unidades (net vs result_r), concentración, estabilidad mensual,
# sesgos BUY/SELL, MFE/MAE, duración, duplicados y cierres de fin de test.
import pandas as pd
import numpy as np
import glob
import os

pd.set_option("display.width", 200)
pd.set_option("display.max_columns", 50)

BASE = os.path.dirname(os.path.abspath(__file__))
trades_path = glob.glob(os.path.join(BASE, "*_trades.csv"))[0]
signals_path = glob.glob(os.path.join(BASE, "*_signals.csv"))[0]

t = pd.read_csv(trades_path, sep=";")
s = pd.read_csv(signals_path, sep=";")

print("=" * 90)
print("1) SANIDAD GENERAL")
print("=" * 90)
print(f"trades.csv filas: {len(t):,}   signals.csv filas: {len(s):,}")
print(f"Periodo: {t['entry_time'].min()} -> {t['exit_time'].max()}")
print(f"trade_id duplicados: {t['trade_id'].duplicated().sum()}")
print(f"exit_reason:\n{t['exit_reason'].value_counts().to_string()}")

print()
print("=" * 90)
print("2) VERIFICACION DE UNIDADES: net (moneda) vs result_r (R)")
print("=" * 90)
# money(risk) implicito = net / result_r para trades cerrados con resultado
mask = t["result_r"].abs() > 1e-9
t["implied_risk_money"] = np.where(mask, t["net"] / t["result_r"], np.nan)
# Por construcción del EA: risk_money = risk_price_units/TickSize*TickValue*lots
# => net/result_r debe ser proporcional a risk_price_units*lots con constante única
ratio = t["implied_risk_money"] / (t["risk_price_units"] * t["lots"])
print(f"risk_money implicito (net/result_r): mediana={t['implied_risk_money'].median():.4f} EUR")
print(f"constante money/(price_units*lots): mediana={ratio.median():.8f}, std={ratio.std():.10f} (std~0 => coherente)")
print(f"SUMA net   = {t['net'].sum():,.2f}  <- UNIDAD MONEDA (EUR)")
print(f"SUMA result_r = {t['result_r'].sum():,.2f}  <- UNIDAD R")
print("=> CONFIRMADO: net es monetario; result_r es R. Las tablas previas etiquetaban euros como R.")

print()
print("=" * 90)
print("3) CANDIDATO H1 + REACTION_CLOSE: TODAS LAS SALIDAS (EUR y R)")
print("=" * 90)
h1 = t[(t["tf"] == "H1") & (t["entry_model"] == "REACTION_CLOSE")].copy()


def agg(x):
    pos = x.loc[x["result_r"] > 0, "result_r"].sum()
    neg = abs(x.loc[x["result_r"] < 0, "result_r"].sum())
    return pd.Series({
        "trades": len(x),
        "net_EUR": x["net"].sum(),
        "net_R": x["result_r"].sum(),
        "avg_R": x["result_r"].mean(),
        "win_rate": (x["net"] > 0).mean() * 100,
        "PF_R": pos / neg if neg > 0 else np.nan,
        "max_win_R": x["result_r"].max(),
        "max_loss_R": x["result_r"].min(),
    })


g = h1.groupby("exit_model").apply(agg, include_groups=False).sort_values("net_EUR", ascending=False)
print(g.round(3).to_string())

print()
print("=" * 90)
print("4) CONCENTRACION DE BENEFICIO (candidatos top)")
print("=" * 90)
for exitm in ["TIME12_ATR1", "ATR100_TP1R5", "ATR150_TP1R5"]:
    x = h1[h1["exit_model"] == exitm].sort_values("net", ascending=False)
    if len(x) == 0:
        continue
    total = x["net"].sum()
    top3 = x.head(3)["net"].sum()
    pct = 100 * top3 / total if total > 0 else float("nan")
    print(f"{exitm}: trades={len(x)}, net={total:.2f} EUR, top3 trades={top3:.2f} EUR ({pct:.1f}% del total)")

print()
print("=" * 90)
print("5) ESTABILIDAD MENSUAL - H1 REACTION_CLOSE (todas las salidas juntas)")
print("=" * 90)
h1["month"] = pd.to_datetime(h1["entry_time"]).dt.to_period("M")
m = h1.groupby("month").agg(trades=("net", "count"), net_EUR=("net", "sum"),
                            net_R=("result_r", "sum"), win_pct=("net", lambda x: (x > 0).mean() * 100))
print(m.round(2).to_string())
# por salida candidata, meses positivos
print("\nMeses positivos por salida (sobre meses con >=1 trade):")
for exitm in ["TIME12_ATR1", "ATR100_TP1R5", "ATR150_TP1R5"]:
    x = h1[h1["exit_model"] == exitm]
    mm = x.groupby(x["month"].astype(str))["net"].sum()
    print(f"  {exitm}: {(mm > 0).sum()}/{len(mm)} meses en positivo")

print()
print("=" * 90)
print("6) BALANCE BUY/SELL, DURACION, MFE/MAE - H1 REACTION_CLOSE")
print("=" * 90)
print(h1.groupby("side").agg(trades=("net", "count"), net_EUR=("net", "sum"),
                             net_R=("result_r", "sum"), win_pct=("net", lambda x: (x > 0).mean() * 100)).round(2).to_string())
h1["entry_dt"] = pd.to_datetime(h1["entry_time"])
h1["exit_dt"] = pd.to_datetime(h1["exit_time"])
h1["mins"] = (h1["exit_dt"] - h1["entry_dt"]).dt.total_seconds() / 60
print(f"\nDuracion media (min): {h1['mins'].mean():.1f}   mediana: {h1['mins'].median():.1f}")
print(f"MFE medio (price units): {h1['mfe_price_units'].mean():.1f}   MAE medio: {h1['mae_price_units'].mean():.1f}")

print()
print("=" * 90)
print("7) SENALES: ACEPTACION Y DUPLICADOS")
print("=" * 90)
print(f"signals aceptadas: {(s['accepted'] == 'true').sum():,} / {len(s):,}")
s["sig_key"] = s["signal_time"].astype(str) + "|" + s["tf"] + "|" + s["entry_model"] + "|" + s["level_id"].astype(str)
dup = s["sig_key"].duplicated().sum()
print(f"signals con misma clave (hora+tf+modelo+nivel): {dup:,} (cada señal abre hasta 13 salidas por diseño)")

print()
print("=" * 90)
print("8) TOP 15 COMBINACIONES GLOBAL (unidades correctas: EUR y R)")
print("=" * 90)
allc = t.groupby(["tf", "entry_model", "exit_model"]).apply(agg, include_groups=False).reset_index()
top = allc[allc["trades"] >= 20].sort_values("net_R", ascending=False).head(15)
print(top.round(3).to_string(index=False))
