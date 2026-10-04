# Sonda rapida Dukascopy: descarga 1 hora, decodifica y muestra ticks.
import os
import struct
import time
import lzma
import urllib.request

URL = "https://datafeed.dukascopy.com/datafeed/USATECHIDXUSD/2025/07/01/13h_ticks.bi5"
PV = 1000
t0 = time.time()
req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
with urllib.request.urlopen(req, timeout=45) as r:
    raw = r.read()
print(f"descarga: {len(raw)} bytes en {time.time() - t0:.1f}s", flush=True)
dec = lzma.LZMADecompressor(format=lzma.FORMAT_ALONE, preset=6)
data = dec.decompress(raw)
print(f"descomprimido: {len(data)} bytes -> {len(data) / 20} ticks", flush=True)
if len(data) % 20:
    print(f"ALERTA len%20={len(data) % 20}")
else:
    n = len(data) // 20
    vals = struct.unpack(">" + "iiif" * n, data)
    for k in range(min(4, n)):
        ms, ask, bid, va, vb = vals[k * 4:k * 4 + 5]
        print(f"  tick {k}: ms={ms} ask={ask / PV:.2f} bid={bid / PV:.2f} "
              f"spread={(ask - bid) / PV:.3f} volA={va} volB={vb}")
    ms_last = vals[(n - 1) * 4]
    print(f"  ultimo tick ms={ms_last} (hora UTC={time.strftime('%H:%M', time.gmtime(ms_last / 1000))})")

