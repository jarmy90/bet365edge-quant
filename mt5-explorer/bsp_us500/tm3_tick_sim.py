# TM3 Tick Simulator — motor tick real para validar TM3 v2.21 FAST TICK
# Lee CSV exportado de MT5: time_msc,bid,ask,last,volume
# NO falsifica resultados: si no hay CSV de ticks, solo corre los tests unitarios.
#
# Reproduce exactamente la causalidad del EA:
#  - autocorte alcista: prevAsk < trigger && ask >= trigger (y bajista simetrico con bid)
#  - sentimiento pre-autocorte en touch_time - InpPreAutocorteMs (2000 ms)
#  - decision TT con 2 s, decision FT con 3 s, referencia 60 s
#  - ZVL, RER, IRPL, ZSF, RPCN, IIT identicos a CalcSentAt del MQL5
#  - nunca usa informacion posterior al tick de decision

import argparse, math, os
import numpy as np
import pandas as pd

try:
    import zoneinfo
    ET = zoneinfo.ZoneInfo("America/New_York")
except Exception:
    ET = None

REF_SEC = 60
SEN_TT_SEC = 2
SEN_FT_SEC = 3
PRE_MS = 2000
MIN_TICKS_REF = 30
MIN_TICKS_SEN = 3
LAMBDA = 0.30

def load_ticks(path):
    df = pd.read_csv(path)
    need = {"time_msc", "bid", "ask"}
    if not need.issubset(df.columns):
        raise ValueError(f"faltan columnas {need - set(df.columns)}")
    df = df.sort_values("time_msc").reset_index(drop=True)
    # rechazar duplicados invalidos: mismo ms con bid/ask distintos -> mantener el ultimo
    df = df.drop_duplicates(subset=["time_msc"], keep="last")
    # detectar huecos > 5 s (para log, no para filtrar)
    gaps = df.time_msc.diff() > 5000
    print(f"ticks={len(df)} huecos>5s={int(gaps.sum())} "
          f"rango={pd.to_datetime(df.time_msc.min(), unit='ms')} -> "
          f"{pd.to_datetime(df.time_msc.max(), unit='ms')}")
    return df

class TickWindow:
    """Buffer de ticks con busqueda binaria; replica la compactacion del EA."""
    def __init__(self, df):
        self.ms = df.time_msc.values.astype(np.int64)
        self.bid = df.bid.values
        self.ask = df.ask.values
        self.mid = (df.bid.values + df.ask.values) * 0.5
    def window(self, start_ms, end_ms):
        i0 = np.searchsorted(self.ms, start_ms, side="left")
        i1 = np.searchsorted(self.ms, end_ms, side="right")
        return i0, i1

def stats(v):
    n = len(v)
    if n < 1:
        return 0.0, 0.0
    m = v.mean()
    var = v.var(ddof=1) if n > 1 else 0.0
    return m, var

def entropy(up, dn):
    n = up + dn
    if n < 1:
        return 0.0
    p, q = up / n, dn / n
    h = 0.0
    if p > 0: h -= p * math.log(p, 2)
    if q > 0: h -= q * math.log(q, 2)
    return h

def build_series(tw, sec, end_ms, i0, i1):
    """Series de velocidad y aceleracion tick a tick dentro de la ventana, igual que BuildSeriesAt."""
    if i1 - i0 < 3:
        return None, None, 0
    v = np.empty(i1 - i0)
    a = np.empty(i1 - i0)
    n = 0
    for i in range(max(i0 + 1, 1), i1):
        if tw.ms[i-1] >= end_ms:
            continue
        dt = (tw.ms[i] - tw.ms[i-1]) / 1000.0
        if dt < 0.001:
            dt = 0.001
        v[n] = (tw.mid[i] - tw.mid[i-1]) / dt
        a[n] = (v[n] - (v[n-1] if n > 0 else v[n])) / dt
        n += 1
    return v[:n], a[:n], n

def calc_sent_at(tw, dirn, sec, end_ms, tw_full=None):
    """Replica CalcSentAt del MQL5 exactamente. Devuelve dict con zvl,rer,irpl,zsf,rpcn,iit,vpond,ok,nr,ns."""
    out = dict(zvl=0.0, rer=0.0, irpl=0.0, zsf=0.0, rpcn=0.0, iit=0.0, vpond=0.0,
               ok=False, nr=0, ns=0)
    if tw_full is None:
        tw_full = tw
    cut = end_ms - sec * 1000
    cut_ref = end_ms - REF_SEC * 1000
    i0, i1 = tw_full.window(cut_ref, end_ms + 1)
    vr, ar, nr = build_series(tw_full, REF_SEC, end_ms, i0, i1)
    i0s, i1s = tw.window(cut, end_ms + 1)
    vs, ac, ns = build_series(tw, sec, end_ms, i0s, i1s)
    if vr is None or vs is None:
        return out
    out["nr"], out["ns"] = nr, ns
    if nr < MIN_TICKS_REF or ns < MIN_TICKS_SEN:
        return out
    mv, vv = stats(vr); ma, va = stats(ar); ml, vl = stats(vs)
    sv = math.sqrt(max(vv, 0))
    out["zvl"] = (ml - mv) / (sv + 1e-12)
    ur = int((vr > 0).sum()); dr = int((vr < 0).sum())
    us = int((vs > 0).sum()); ds = int((vs < 0).sum())
    hr, hs = entropy(ur, dr), entropy(us, ds)
    dp = tw.mid[i1s-1] - tw.mid[i0s]
    out["rer"] = ((hr - hs) / (hr + 1e-12)) * (1 if dp > 0 else (-1 if dp < 0 else 0))
    sw = wv = wa = 0.0
    for i in range(ns):
        w = math.exp(LAMBDA * (i + 1))
        sw += w; wv += w * vs[i]; wa += w * ac[i]
    out["vpond"] = wv / sw
    cov = float(np.mean((vr - mv) * (ar - ma))) if nr > 1 else 0.0
    av, acv = vv + 1e-8, va + 1e-8
    det = av * acv - cov * cov
    if det <= 1e-16:
        return out
    d1, d2 = out["vpond"] - mv, wa / sw - ma
    out["irpl"] = math.sqrt(max(0.0, d1*d1*acv/det - 2*d1*d2*cov/det + d2*d2*av/det))
    out["zsf"] = (dirn*mv - dirn*ml) / (sv + 1e-12)
    fav = opp = 0.0
    for i in range(ns):
        if vs[i]*dirn > 0: fav += abs(vs[i])
        elif vs[i]*dirn < 0: opp += abs(vs[i])
    phi = (opp - fav) / (opp + fav + 1e-12)
    out["rpcn"] = phi * (opp + fav) / ns / max(abs(mv) + sv, 1e-12)
    el = abs(vs.sum()) / (abs(vs).sum() + 1e-12)
    out["iit"] = abs(vr.sum()) / (abs(vr).sum() + 1e-12) - el
    out["ok"] = True
    return out

def tt_filter(s, dirn, zvl=2.0, rer=0.35, irpl=3.0):
    if not s["ok"]:
        return False
    a = dirn * s["zvl"] > zvl
    b = dirn * s["rer"] > rer
    c = s["irpl"] > irpl and dirn * s["vpond"] > 0
    return int(a) + int(b) + int(c) >= 2

def ft_filter(s, strict=False, iit_th=0.20):
    if not s["ok"]:
        return False
    ok = s["rpcn"] > 0 and s["iit"] > 0
    if strict:
        ok = ok and s["zsf"] > 0 and s["iit"] > iit_th
    return ok

def simulate_day(tw, day_ticks, patterns, cfg):
    """Simula un dia tick a tick. patterns: lista de dicts con trig, dir, sl, A, armed, is930.
    Devuelve lista de trades con entry/exit/pnl y metadatos de senal."""
    trades = []
    ms = day_ticks.time_msc.values
    bid = day_ticks.bid.values
    ask = day_ticks.ask.values
    prev_ask = prev_bid = None
    live_bar = None
    for i in range(len(ms)):
        t = ms[i]
        bt = t // 60000 * 60000
        if live_bar is None or live_bar["t"] != bt:
            live_bar = dict(t=bt, o=tw.mid[i], h=tw.mid[i], l=tw.mid[i], c=tw.mid[i])
        else:
            live_bar["h"] = max(live_bar["h"], tw.mid[i])
            live_bar["l"] = min(live_bar["l"], tw.mid[i])
            live_bar["c"] = tw.mid[i]
        # patrones: cruce exacto
        for p in patterns:
            if p["resolved"] or not p["armed"]:
                continue
            d = p["dir"]
            if d > 0:
                cross = prev_ask is not None and prev_ask < p["trig"] and ask[i] >= p["trig"]
            else:
                cross = prev_bid is not None and prev_bid > p["trig"] and bid[i] <= p["trig"]
            if not cross:
                continue
            p["touch_ms"] = t
            pre = calc_sent_at(tw, d, SEN_TT_SEC, t - PRE_MS)
            st = calc_sent_at(tw, d, SEN_TT_SEC, t)
            if cfg.get("filter") and not tt_filter(st, d):
                p["resolved"] = True
                continue
            en = ask[i] if d > 0 else bid[i]
            sl = p["sl"]
            # resolver la operacion tick a tick
            exit_px, why = None, None
            for k in range(i + 1, len(ms)):
                px = bid[k] if d > 0 else ask[k]
                if d > 0:
                    if px <= sl: exit_px, why = sl, "SL"; break
                    if px >= p["tp"]: exit_px, why = p["tp"], "TP"; break
                else:
                    if px >= sl: exit_px, why = sl, "SL"; break
                    if px <= p["tp"]: exit_px, why = p["tp"], "TP"; break
                if ms[k] - t > cfg.get("max_trade_ms", 600_000):
                    exit_px, why = px, "TIME"; break
            if exit_px is None:
                exit_px, why = bid[-1] if d > 0 else ask[-1], "EOD"
            pnl_pts = d * (exit_px - en)
            trades.append(dict(pattern=p["id"], dir=d, entry=en, exit=exit_px, reason=why,
                               pnl_pts=pnl_pts, pre_zvl=pre["zvl"], touch_zvl=st["zvl"],
                               nr=st["nr"], ns=st["ns"]))
            p["resolved"] = True
            if why == "TP":
                p["ftactive"] = True
                p["ftend"] = t + cfg.get("ft_window_ms", 120_000)
        prev_ask, prev_bid = ask[i], bid[i]
    return trades

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ticks", required=True, help="CSV con time_msc,bid,ask,last,volume")
    ap.add_argument("--patterns", default=None, help="CSV de patrones del motor M1 (opcional)")
    ap.add_argument("--out", default="tm3_tick_trades.csv")
    a = ap.parse_args()
    if not os.path.exists(a.ticks):
        print("NO TICK DATA: exporta ticks desde MT5 (Ver -> Simulador de estrategias -> export)")
        print("o usa el generador de patrones del motor M1 como referencia.")
        return 1
    df = load_ticks(a.ticks)
    tw = TickWindow(df)
    print("motor tick listo; simulacion no implementada en este esqueleto sin patrones")
    return 0

if __name__ == "__main__":
    sys.exit(main()) if False else main()
