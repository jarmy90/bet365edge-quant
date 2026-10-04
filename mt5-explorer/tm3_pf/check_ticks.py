# Lee un .ticks de Dukascopy y muestra sanidad (precios, spread, frecuencia).
import struct
import sys
import time

fn = sys.argv[1] if len(sys.argv) > 1 else "duka_ticks/2025-07-01_13.ticks"
PV = 1000.0
raw = open(fn, "rb").read()
n = len(raw) // 20
v = struct.unpack(">" + "iiiff" * n, raw)
print(f"fichero={fn} ticks={n}")
ms = [v[i * 5] for i in range(n)]
ask = [v[i * 5 + 1] / PV for i in range(n)]
bid = [v[i * 5 + 2] / PV for i in range(n)]
va = [v[i * 5 + 3] for i in range(n)]
vb = [v[i * 5 + 4] for i in range(n)]
spr = [a - b for a, b in zip(ask, bid)]
print(f"t min/max (ms en la hora): {min(ms)} / {max(ms)}")
print(f"dia UTC/hora: {time.strftime('%Y-%m-%d %H:%M', time.gmtime(0))} + {min(ms)}ms")
print(f"ask: {min(ask):.2f} .. {max(ask):.2f}   bid: {min(bid):.2f} .. {max(bid):.2f}")
print(f"spread: min={min(spr):.3f} med={sorted(spr)[n // 2]:.3f} max={max(spr):.3f}")
print(f"volAsk: min={min(va):.3f} max={max(va):.3f}  volBid: min={min(vb):.3f} max={max(vb):.3f}")
d = [ms[i] - ms[i - 1] for i in range(1, n)]
print(f"delta ms: min={min(d)} med={sorted(d)[len(d) // 2]} max={max(d)}")
print("primeros 5:")
for i in range(5):
    print(f"  {ms[i]:>7}ms ask={ask[i]:.2f} bid={bid[i]:.2f} spr={spr[i]:.3f} vA={va[i]} vB={vb[i]}")
