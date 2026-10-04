import pandas as pd
t = pd.read_csv("TM3_PF_Trades_v210_vpt20.csv", sep=";")
t["open_server"] = pd.to_datetime(t["open_server"] / 1000, unit="s")
t["close_server"] = pd.to_datetime(t["close_server"] / 1000, unit="s")
t["d"] = t["open_server"].dt.date
print(t.groupby("d").size().to_string())
print()
print(t.groupby(["d", "kind"]).size().to_string())
print()
print(t.groupby("reason").pnl.agg(["count", "sum", "mean"]).round(2).to_string())
print()
print(t.groupby(["variant", "kind"]).pnl.agg(["count", "sum", "mean"]).round(2).to_string())

