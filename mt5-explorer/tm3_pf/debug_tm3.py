import pandas as pd, numpy as np
from zoneinfo import ZoneInfo
csv = "subset_18m.csv"
df = pd.read_csv(csv)
df["time"] = pd.to_datetime(df["time"])
ny = ZoneInfo("America/New_York")
df["ny"] = df["time"].dt.tz_localize("UTC").dt.tz_convert(ny)
m = df[(df["ny"].dt.hour * 60 + df["ny"].dt.minute >= 9 * 60 + 29) & (df["ny"].dt.hour * 60 + df["ny"].dt.minute < 11 * 60)]
print("barras en sesion:", len(m), "de", len(df))
s = df.copy().reset_index(drop=True)
s["d"] = 1
o, h, l, c = s.open.values, s.high.values, s.low.values, s.close.values
arm, armdir = [], []
for i in range(2, len(s)):
    if c[i - 2] == o[i - 2]:
        continue
    d = 1 if c[i - 2] > o[i - 2] else -1
    A = (h[i - 2] - l[i - 1]) if d > 0 else (h[i - 1] - l[i - 2])
    if A <= 0:
        continue
    trig = h[i - 2] if d > 0 else l[i - 2]
    sl = l[i - 1] if d > 0 else h[i - 1]
    risk = abs(trig - sl)
    if risk < 5:
        sl = trig - d * 5
        risk = 5.0
    if A >= risk and A >= 6.0:
        arm.append(trig)
        armdir.append(d)
print("patrones armados:", len(arm))
# cruces dentro de sesion usando OHLC de la barra siguiente
cross = 0
setsess = m.index.tolist()
sess = set(setsess)
for i in range(3, len(s)):
    if i not in sess or i - 1 >= len(arm):
        continue
    hi, lo = h[i], l[i]
    for k in range(max(0, i - 3), i):
        if k >= len(arm):
            break
        t, d = arm[k], armdir[k]
        if (d > 0 and lo < t <= hi) or (d < 0 and hi > t >= lo):
            cross += 1
print("cruces en sesion (aprox, 3 barras de margen):", cross)
