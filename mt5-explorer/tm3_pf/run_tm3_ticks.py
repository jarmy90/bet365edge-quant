# =============================================================================
# Runner TM3 v2.10 sobre TICKS REALES de Dukascopy (USATECHIDXUSD)
#   - Velas M1: duka_m1/<dia>_m1.csv (mismo origen que los ticks) para patrones
#   - Ticks:    duka_ticks/<dia>_<hh>.ticks para sentimiento, disparo y gestion
#   - Sesion:   datos 09:29-11:00 ET, nuevas escaleras 09:30-11:00 ET,
#               cierre forzado a las 11:00 ET si InpCerrarAlFinSesion
#   - Sentimiento TT/FT calculado con microestructura real de ticks
# Uso: python run_tm3_ticks.py [--from 2025-07-01] [--to 2025-12-31]
#                              [--spread 0] [--no-close] [--tag real]
# =============================================================================
import argparse
import datetime as dt
import glob
import os
import re
import struct
import sys
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import backtest_tm3_pf as B          # Engine, V, constantes y utilidades

BASE = os.path.dirname(os.path.abspath(__file__))
TICKDIR = os.path.join(BASE, "duka_ticks")
M1DIR = os.path.join(BASE, "duka_m1")
NY = ZoneInfo("America/New_York")
PV = 1000.0
H_TICK_LOAD = ((9, 0), (12, 0))       # ventana ET a cargar de ticks
TICK_RE = re.compile(r"(\d{4}-\d{2}-\d{2})_(\d{2})\.ticks$")
M1_RE = re.compile(r"(\d{4}-\d{2}-\d{2})_m1\.csv$")


def load_day_ticks(day):
    """Devuelve (ms_utc, bid, ask) de las horas disponibles del dia, filtrado a ET."""
    out_ms, out_bid, out_ask = [], [], []
    for fn in sorted(glob.glob(os.path.join(TICKDIR, f"{day}_*.ticks"))):
        m = TICK_RE.search(os.path.basename(fn))
        if not m:
            continue
        hour = int(m.group(2))
        base = dt.datetime.strptime(day, "%Y-%m-%d").replace(
            hour=hour, tzinfo=dt.timezone.utc)
        base_ms = int(base.timestamp() * 1000)
        raw = open(fn, "rb").read()
        n = len(raw) // 20
        if n == 0:
            continue
        v = struct.unpack(">" + "iiiff" * n, raw)
        for i in range(n):
            ms = base_ms + v[i * 5]
            out_ms.append(ms)
            out_ask.append(v[i * 5 + 1] / PV)
            out_bid.append(v[i * 5 + 2] / PV)
    if not out_ms:
        return None
    order = np.argsort(np.asarray(out_ms, dtype=np.int64), kind="stable")
    ms = np.asarray(out_ms, dtype=np.int64)[order]
    bid = np.asarray(out_bid, dtype=float)[order]
    ask = np.asarray(out_ask, dtype=float)[order]
    keep = ms > 0
    return ms[keep], bid[keep], ask[keep]


def load_day_bars(day):
    """Velas M1 del dia desde duka_m1 (formato '<fecha> <minuto>;o;h;l;c;v')."""
    fn = os.path.join(M1DIR, f"{day}_m1.csv")
    if not os.path.exists(fn):
        return None
    rows = []
    for ln in open(fn, encoding="utf-8"):
        ln = ln.strip()
        if not ln:
            continue
        head, rest = ln.split(";", 1)
        _, minute = head.split(" ")
        o, h, l, c, v = rest.split(";")
        rows.append((int(minute), float(o), float(h), float(l), float(c)))
    if not rows:
        return None
    rows.sort()
    day0 = dt.datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=NY)
    out = []
    for minute, o, h, l, c in rows:
        t = day0 + dt.timedelta(minutes=minute)
        et930 = (t.hour == 9 and t.minute == 30)
        out.append(dict(open=o, high=h, low=l, close=c, ts=int(t.timestamp() * 1000),
                        et930=et930, et_min=t.hour * 60 + t.minute))
    return out


def run_days(days, spread_override=0.0, close_at_session=True, vpt=1.0, tag="real"):
    eng = B.Engine(spread=spread_override if spread_override > 0 else 1.0,
                   v200=False, vpt=vpt)
    days_done = 0
    for day in days:
        bars = load_day_bars(day)
        tk = load_day_ticks(day)
        if tk is None or bars is None:
            print(f"  {day} sin datos (ticks={'ok' if tk else 'no'}, "
                  f"bars={'ok' if bars else 'no'})", flush=True)
            continue
        ms, bid, ask = tk
        d = dt.datetime.strptime(day, "%Y-%m-%d")
        d0 = d.replace(tzinfo=NY)
        # Reset diario (v2.10 ResetDailyArrays)
        eng.et_day = None
        eng.pats = []
        eng.ops = []
        eng.t[:] = []
        eng.b[:] = []
        eng.a[:] = []
        eng.mid[:] = []
        eng.prev_ask = eng.prev_bid = 0.0
        eng.pending, eng.out_watch, eng.band_watch = [], [], []
        ti = 0
        nticks = len(ms)
        for k, bar in enumerate(bars):
            # NewBar: al abrir la vela k usamos k-1 (recien cerrada) y k-2
            if k >= 2:
                eng.new_bar(bars[k - 2], bars[k - 1])
                eng.pending = [p for p in eng.pats
                               if p["armed"] and not p["trigged"] and not p["resolved"]]
                eng.out_watch = [p for p in eng.pats if p["trigged"] and not p["resolved"]]
                eng.active_idx = [j for j, o in enumerate(eng.ops) if o["active"]]
            t_end = bar["ts"] + 60000
            while ti < nticks and ms[ti] < t_end:
                tmsc = int(ms[ti])
                et = dt.datetime.fromtimestamp(tmsc / 1000, NY)
                eng.et_min = et.hour * 60 + et.minute
                sec = et.second
                eng.add_tick(tmsc, bid[ti], ask[ti])
                md = eng.et_min
                if B.H_DATA <= md < B.H_END + 120:
                    eng.triggers(tmsc, bid[ti], ask[ti], sec)
                eng.manage(tmsc, bid[ti], ask[ti])
                eng.outcomes(tmsc, bid[ti], ask[ti])
                eng.bands(tmsc, bid[ti], ask[ti])
                if close_at_session and md >= B.H_END:
                    for j in [x for x in eng.active_idx]:
                        o = eng.ops[j]
                        if o["active"]:
                            px = bid[ti] if o["dir"] > 0 else ask[ti]
                            eng.close_v(j, px, "SESSION", tmsc)
                eng.prev_ask, eng.prev_bid = ask[ti], bid[ti]
                ti += 1
        days_done += 1
        if days_done % 20 == 0:
            print(f"  dias={days_done} trades={len(eng.trades)} "
                  f"ultimo={day}", flush=True)
    return eng, days_done


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="dfrom", default="2025-07-01")
    ap.add_argument("--to", dest="dto", default="2026-09-24")
    ap.add_argument("--spread", type=float, default=0.0)
    ap.add_argument("--vpt", type=float, default=1.0)
    ap.add_argument("--no-close", action="store_true")
    ap.add_argument("--tag", default="real")
    a = ap.parse_args()
    days = sorted({M1_RE.search(os.path.basename(f)).group(1)
                   for f in glob.glob(os.path.join(M1DIR, "*_m1.csv"))
                   if M1_RE.search(os.path.basename(f))})
    days = [d for d in days if a.dfrom <= d <= a.dto]
    tk_days = {TICK_RE.search(os.path.basename(f)).group(1)
               for f in glob.glob(os.path.join(TICKDIR, "*.ticks"))
               if TICK_RE.search(os.path.basename(f))}
    days = [d for d in days if d in tk_days]
    print(f"dias con ticks+velas={len(days)} rango={days[0] if days else '-'}.."
          f"{days[-1] if days else '-'}", flush=True)
    if not days:
        print("Sin datos aun. Espera a que avance la descarga.")
        return
    t0 = dt.datetime.now()
    eng, ndone = run_days(days, a.spread, not a.no_close, a.vpt, a.tag)
    print(f"tiempo={(dt.datetime.now() - t0).total_seconds():.0f}s dias={ndone}", flush=True)
    sm, tr = B.write_out(eng, a.tag, [])
    B.report(sm, tr, a.tag, pd.DataFrame({"time": [days[0], days[-1]]}), [])


if __name__ == "__main__":
    main()


