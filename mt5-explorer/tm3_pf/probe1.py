# Consigue 1 hora de ticks Dukascopy con reintentos pacientes y decodifica.
# Objetivo: validar formato bi5 (ms, ask, bid, vol) y pointValue=1000 para IDX.
import os
import struct
import time
import lzma
import urllib.request

OUT = "duka_probe"
os.makedirs(OUT, exist_ok=True)
URL = "https://datafeed.dukascopy.com/datafeed/USATECHIDXUSD/2025/07/02/13h_ticks.bi5"
PV = 1000

raw = None
for attempt in range(40):
    t0 = time.time()
    try:
        req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=45) as r:
            body = r.read()
        if len(body) > 0:
            raw = body
            print(f"OK intento={attempt} bytes={len(body)} t={time.time() - t0:.1f}s", flush=True)
            break
        print(f"vacio intento={attempt} t={time.time() - t0:.1f}s", flush=True)
    except Exception as e:
        print(f"intento={attempt} {str(e)[:80]} t={time.time() - t0:.1f}s", flush=True)
    time.sleep(12)

if raw is None:
    print("NO SE PUDO DESCARGAR en 40 intentos")
    raise SystemExit(1)

with open(os.path.join(OUT, "2025-07-02_13h_ticks.bi5"), "wb") as f:
    f.write(raw)
dec = lzma.LZMADecompressor(format=lzma.FORMAT_ALONE, preset=6)
data = dec.decompress(raw)
print(f"descomprimido={len(data)} bytes -> {len(data) / 20} ticks", flush=True)
if len(data) % 20 == 0:
    n = len(data) // 20
    vals = struct.unpack(">" + "iiif" * n, data)
    for k in range(min(5, n)):
        ms, ask, bid, va, vb = vals[k * 4:k * 4 + 5]
        print(f"  [{k}] {ms} ask={ask / PV} bid={bid / PV} spr={(ask - bid) / PV:.4f} volA={va} volB={vb}", flush=True)
    ms0, ms1 = vals[0], vals[(n - 1) * 4]
    print(f"  rango: {time.strftime('%Y-%m-%d %H:%M', time.gmtime(ms0 / 1000))} -> "
          f"{time.strftime('%Y-%m-%d %H:%M', time.gmtime(ms1 / 1000))} UTC", flush=True)
