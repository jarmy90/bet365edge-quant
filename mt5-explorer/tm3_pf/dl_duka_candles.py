# =============================================================================
# Descargador de velas M1 diarias Dukascopy (BID_candles_min_1.bi5)
# 1 fichero por dia con las 1440 velas -> niveles de patron coherentes con los
# ticks del mismo origen. Formato: LZMA solo, registros de 24 bytes:
#   int32 segDesdeMedianoche | int32 open | int32 close | int32 low | int32 high | float32 vol
# Uso: python dl_duka_candles.py --from 2025-07-01 --to 2026-09-24 [--shard 0 --shards 4]
# =============================================================================
import argparse
import datetime as dt
import json
import lzma
import os
import struct
import time
import urllib.error
import urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "duka_m1")
LEDGER = os.path.join(OUT, "ledger.json")
SYMBOL = "USATECHIDXUSD"
GAP_OK = 6.0
GAP_FAIL = 30.0


def log(m):
    print(f"[{dt.datetime.now():%H:%M:%S}] {m}", flush=True)


def get(url, tries=4):
    last = ""
    for _ in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=40) as r:
                b = r.read()
            if b:
                return b, None
            last = "empty"
        except urllib.error.HTTPError as e:
            last = f"http{e.code}"
            if e.code == 404:
                return None, "404"
        except Exception as e:
            last = str(e)[:70]
        time.sleep(GAP_FAIL)
    return None, last


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="dfrom", default="2025-07-01")
    ap.add_argument("--to", dest="dto", default="2026-09-24")
    ap.add_argument("--shard", type=int, default=0)
    ap.add_argument("--shards", type=int, default=1)
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    lgpath = f"{LEDGER}.{a.shard}"
    lg = json.load(open(lgpath, encoding="utf-8")) if os.path.exists(lgpath) else {}
    d0 = dt.date(*map(int, a.dfrom.split("-")))
    d1 = dt.date(*map(int, a.dto.split("-")))
    todo = []
    d = d0
    while d <= d1:
        if d.weekday() < 5:
            key = d.isoformat()
            fn = os.path.join(OUT, f"{key}_m1.csv")
            if lg.get(key) != "ok" and not os.path.exists(fn):
                todo.append(key)
        d += dt.timedelta(days=1)
    todo = [t for i, t in enumerate(todo) if i % a.shards == a.shard]
    log(f"candles shard {a.shard}/{a.shards}: pendientes={len(todo)}")
    ok = miss = fail = 0
    for key in todo:
        y, m, dd = (int(x) for x in key.split("-"))
        url = (f"https://datafeed.dukascopy.com/datafeed/{SYMBOL}/"
               f"{y}/{m:02d}/{dd:02d}/BID_candles_min_1.bi5")
        body, err = get(url)
        if body is None:
            lg[key] = "404" if err == "404" else f"fail:{err}"
            miss += 1
            log(f"{key} -> {err}")
            time.sleep(GAP_FAIL)
            continue
        try:
            data = lzma.LZMADecompressor(format=lzma.FORMAT_ALONE).decompress(body)
        except Exception as e:
            lg[key] = f"lzma:{e}"
            fail += 1
            log(f"{key} -> DECODE {e}")
            continue
        if len(data) % 24:
            lg[key] = f"mod24:{len(data) % 24}"
            fail += 1
            log(f"{key} -> MOD24 {len(data) % 24} len={len(data)}")
            continue
        n = len(data) // 24
        v = struct.unpack(">" + "iiiiif" * n, data)
        rows = []
        for i in range(n):
            sec, o, c, l, h, vol = v[i * 6:i * 6 + 6]
            rows.append(f"{key} {sec // 60:04d};{o / 1000};{h / 1000};{l / 1000};{c / 1000};{vol}")
        with open(os.path.join(OUT, f"{key}_m1.csv"), "w", encoding="utf-8") as f:
            f.write("\n".join(rows))
        lg[key] = "ok"
        ok += 1
        log(f"{key} OK velas={n} ok={ok} miss={miss} fail={fail}")
        json.dump(lg, open(lgpath, "w", encoding="utf-8"))
        time.sleep(GAP_OK)
    json.dump(lg, open(lgpath, "w", encoding="utf-8"))
    log(f"FINAL candles shard={a.shard} ok={ok} miss={miss} fail={fail}")


if __name__ == "__main__":
    main()
