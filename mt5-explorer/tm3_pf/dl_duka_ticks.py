# =============================================================================
# Descargador paciente de ticks reales Dukascopy (USATECHIDXUSD = Nasdaq 100)
# Solo horas UTC 13-16 (09:00-11:59 ET) de dias laborables.
# Formato .bi5: LZMA solo (FORMAT_ALONE), registros de 20 bytes:
#   int32 ms | int32 ask | int32 bid | int32 volAsk | float32 volBid
# pointValue=1000 (IDX) -> precio = raw/1000
# Pausa 18 s entre aciertos, 60 s tras fallo/rate-limit. Resumible con ledger.
# Uso: python dl_duka_ticks.py --from 2025-07-01 --to 2026-09-24
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
OUT = os.path.join(BASE, "duka_ticks")
LEDGER = os.path.join(OUT, "ledger.json")
SYMBOL = "USATECHIDXUSD"
HOURS = [13, 14, 15, 16]      # 09:00-11:59 ET en EDT (UTC-4) y EST (UTC-5)
GAP_OK = 18.0
GAP_FAIL = 60.0


def log(msg):
    print(f"[{dt.datetime.now():%H:%M:%S}] {msg}", flush=True)


def load_ledger(shard=None):
    path = LEDGER if shard is None else f"{LEDGER}.{shard}"
    if os.path.exists(path):
        try:
            return json.load(open(path, encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_ledger(lg, shard=None):
    path = LEDGER if shard is None else f"{LEDGER}.{shard}"
    tmp = path + ".tmp"
    json.dump(lg, open(tmp, "w", encoding="utf-8"))
    os.replace(tmp, path)


def download(day_s, hour, tries=4):
    y, m, d = (int(x) for x in day_s.split("-"))
    url = (f"https://datafeed.dukascopy.com/datafeed/{SYMBOL}/"
           f"{y}/{m:02d}/{d:02d}/{hour:02d}h_ticks.bi5")
    last = ""
    for _ in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=40) as r:
                body = r.read()
            if body:
                return body, None
            last = "empty"
        except urllib.error.HTTPError as e:
            last = f"http{e.code}"
            if e.code == 404:
                return None, "404"
        except Exception as e:
            last = str(e)[:70]
        time.sleep(GAP_FAIL if last.startswith(("http42", "http503")) else 25)
    return None, last


def decode(body):
    try:
        data = lzma.LZMADecompressor(format=lzma.FORMAT_ALONE).decompress(body)
    except Exception as e:
        return None, f"lzma {e}"
    if len(data) % 20:
        return None, f"mod20={len(data) % 20}"
    # registro = 20 bytes: int32 ms | int32 ask | int32 bid | float32 volAsk | float32 volBid
    return struct.unpack(">" + "iiiff" * (len(data) // 20), data), None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="dfrom", default="2025-07-01")
    ap.add_argument("--to", dest="dto", default="2026-09-24")
    ap.add_argument("--shard", type=int, default=0)
    ap.add_argument("--shards", type=int, default=1)
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    d0 = dt.date(*map(int, a.dfrom.split("-")))
    d1 = dt.date(*map(int, a.dto.split("-")))
    days = []
    d = d0
    while d <= d1:
        if d.weekday() < 5:
            days.append(d.isoformat())
        d += dt.timedelta(days=1)
    lg = load_ledger(a.shard)
    todo = []
    for day in days:
        for h in HOURS:
            key = f"{day}/{h:02d}"
            fn = os.path.join(OUT, f"{day}_{h:02d}.ticks")
            if lg.get(key) in ("ok", "404") or os.path.exists(fn):
                continue
            todo.append((day, h))
    todo = [t for i, t in enumerate(todo) if i % a.shards == a.shard]
    log(f"shard {a.shard}/{a.shards}: pendientes={len(todo)} de {len(days) * len(HOURS)}")
    ok = miss = fail = 0
    for i, (day, hour) in enumerate(todo):
        key = f"{day}/{hour:02d}"
        body, err = download(day, hour)
        if body is None:
            if err == "404":
                lg[key] = "404"
                miss += 1
            else:
                lg[key] = f"fail:{err}"
                fail += 1
            log(f"{key} -> {err or 'FAIL'} ok={ok} miss={miss} fail={fail}")
            time.sleep(GAP_FAIL)
        else:
            ticks, derr = decode(body)
            if ticks is None:
                lg[key] = f"decode:{derr}"
                fail += 1
                log(f"{key} -> DECODE {derr}")
            else:
                fn = os.path.join(OUT, f"{day}_{hour:02d}.ticks")
                with open(fn, "wb") as f:
                    f.write(struct.pack(">" + "iiiff" * (len(ticks) // 5), *ticks))
                lg[key] = "ok"
                ok += 1
                nt = len(ticks) // 5
                log(f"{key} OK ticks={nt} ok={ok} miss={miss} fail={fail}")
            save_ledger(lg, a.shard)
            time.sleep(GAP_OK)
        if (i + 1) % 20 == 0:
            save_ledger(lg, a.shard)
    save_ledger(lg, a.shard)
    log(f"FINAL shard={a.shard} ok={ok} miss={miss} fail={fail}")


if __name__ == "__main__":
    main()
