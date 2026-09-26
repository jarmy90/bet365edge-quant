# Backtest BSP (Zeiierman) sobre ES=F (futuro S&P500) — replica Pine v6
# Datos: Yahoo Finance ES=F (gratis, sin registro). 4 TF x 2 entradas x 15 salidas.
# Uso: python backtest_bsp.py  (lee es_15m.json, es_1h.json, es_1d.json)
import json, argparse, math, os
import pandas as pd
import numpy as np

P = dict(profLb=600, profRows=72, swingLen=5, volLen=40, atrLen=14, searchAtr=1.20,
         minNode=0.08, minEv=0.22, pullMax=0.85, minScore=30.0, breakAtr=0.10,
         absRad=3, pivVolX=2.2, absBodyMax=0.40, absVolX=1.5,
         retestBars=30, retestTolAtr=0.10, reqReaction=True,
         stopBufAtr=0.25, maxHold=240, slipPts=2.0)

def load_yahoo(path):
    d = json.load(open(path))
    r = d["chart"]["result"][0]
    ts = r["timestamp"]
    q = r["indicators"]["quote"][0]
    df = pd.DataFrame({"time": pd.to_datetime(ts, unit="s"),
                       "open": q["open"], "high": q["high"],
                       "low": q["low"], "close": q["close"],
                       "vol": q.get("volume")})
    df = df.dropna(subset=["open", "high", "low", "close"]).reset_index(drop=True)
    df["vol"] = df["vol"].fillna(0)
    return df

def wilder_atr(df, n):
    h, l, c = df.high.values, df.low.values, df.close.values
    tr = np.maximum(h - l, np.maximum(np.abs(h - np.roll(c, 1)), np.abs(l - np.roll(c, 1))))
    tr[0] = h[0] - l[0]
    atr = np.zeros_like(tr)
    atr[0] = tr[0]
    for i in range(1, len(tr)):
        atr[i] = (atr[i - 1] * (n - 1) + tr[i]) / n
    return atr

def profile(lo_arr, hi_arr, cl_arr, vol_arr, first, last, rows):
    lo = lo_arr[first:last + 1].min()
    hi = hi_arr[first:last + 1].max()
    span = max(hi - lo, 1e-9 * rows)
    bot = lo
    step = span / rows
    tot = np.zeros(rows)
    buy = np.zeros(rows)
    for i in range(first, last + 1):
        l, h, vv = lo_arr[i], hi_arr[i], max(vol_arr[i], 0.0)
        rg = h - l
        bs = np.clip((cl_arr[i] - l) / rg, 0, 1) if rg > 0 else 0.5
        r0 = max(0, min(rows - 1, int(math.floor((l - bot) / step))))
        r1 = max(0, min(rows - 1, int(math.floor((h - bot) / step))))
        for rr in range(r0, r1 + 1):
            rl = bot + rr * step
            ov = max(0.0, min(h, rl + step) - max(l, rl)) if rg > 0 else step
            fr = ov / rg if rg > 0 else 1.0
            if fr > 0:
                x = vv * fr
                tot[rr] += x
EXITS = ["TP_1R", "TP_2R", "TP_3R", "TP_1ATR", "TP_2ATR", "TRAIL_1ATR",
         "TRAIL_2ATR", "BE_THEN_2R", "BE_THEN_TRAIL", "STEP_TRAIL",
         "TIME_FAST", "TIME_SLOW", "EMA_CLOSE", "SWING_TRAIL", "LEVEL_INVALIDATION"]

def find_signal(o, h, l, c, v, av, atr, p, supp):
    n = len(c)
    sw = P["swingLen"]
    first, last = max(0, p - P["profLb"] + 1), p
    bot, step, tot, buy, mx, poc = profile(l, h, c, v, first, last, P["profRows"])
    if mx <= 0:
        return None
    raw = l[p] if supp else h[p]
    atrp = max(atr[p], 1e-9)
    rad = max(atrp * P["searchAtr"], step * 2.0)
    be, bnode, bns = -1, raw, 0.0
    for rr in range(P["profRows"]):
        pr = bot + (rr + 0.5) * step
        dd = abs(pr - raw)
        if dd > rad:
            continue
        rv = tot[rr]
        s = rv / mx
        lv = tot[rr - 1] if rr > 0 else rv
        xv = tot[rr + 1] if rr < P["profRows"] - 1 else rv
        nav = max((lv + xv) * 0.5, mx * 0.01)
        pk = np.clip((rv / nav - 0.85) / 0.65, 0, 1)
        bs = np.clip(buy[rr] / rv, 0, 1) if rv > 0 else 0.5
        dr = bs if supp else 1 - bs
        e = 0.5 * s + 0.2 * pk + 0.2 * dr + 0.1 * (1 - dd / rad)
        if e > be:
            be, bnode, bns = e, pr, s
    ev = max(be, 0.0)
    if bns < P["minNode"] or ev < P["minEv"]:
        return None
    vb = av[p]
    vr = v[p] / vb if vb > 0 else 1.0
    vSc = np.clip((vr - 0.8) / (P["pivVolX"] - 0.8), 0, 1)
    rg = max(h[p] - l[p], 1e-9)
    wk = min(o[p], c[p]) - l[p] if supp else h[p] - max(o[p], c[p])
    wSc = np.clip((wk / rg) / 0.50, 0, 1)
    ab = 0.0
    for i in range(max(0, p - P["absRad"]), min(n, p + P["absRad"] + 1)):
        cr = max(h[i] - l[i], 1e-9)
        vv = v[i] / av[i] if av[i] > 0 else 1.0
        b = abs(c[i] - o[i]) / cr
        ab = max(ab, math.sqrt(np.clip((P["absBodyMax"] - b) / P["absBodyMax"], 0, 1) * np.clip((vv - 1.0) / (P["absVolX"] - 1.0), 0, 1)))
def sim_trade(o, h, l, c, atr, ema, ei, ep, st0, risk, atrp, lvl, supp, ex, point):
    n = len(c)
    sgn = 1 if supp else -1
    tp = 0
    if ex == "TP_1R":
        tp = ep + sgn * 1.0 * risk
    elif ex == "TP_2R":
        tp = ep + sgn * 2.0 * risk
    elif ex == "TP_3R":
        tp = ep + sgn * 3.0 * risk
    elif ex == "TP_1ATR":
        tp = ep + sgn * 1.0 * atrp
    elif ex == "TP_2ATR":
        tp = ep + sgn * 2.0 * atrp
    elif ex == "BE_THEN_2R":
        tp = ep + sgn * 2.0 * risk
    st = st0
    out, oor, reason = ep, ei, "MAX_HOLD"
    lastb = min(n - 1, ei + P["maxHold"])
    for i in range(ei, lastb + 1):
        fav = (h[i] - ep) if supp else (ep - l[i])
        fr = fav / risk
        if ex == "TRAIL_1ATR" and i > ei:
            st = max(st, c[i - 1] - 1.0 * atr[i - 1]) if supp else min(st, c[i - 1] + 1.0 * atr[i - 1])
        if ex == "TRAIL_2ATR" and i > ei:
            st = max(st, c[i - 1] - 2.0 * atr[i - 1]) if supp else min(st, c[i - 1] + 2.0 * atr[i - 1])
        if ex in ("BE_THEN_2R", "BE_THEN_TRAIL") and fr >= 1.0:
            st = max(st, ep + 0.10 * risk) if supp else min(st, ep - 0.10 * risk)
        if ex == "BE_THEN_TRAIL" and fr >= 2:
            st = max(st, c[i] - 1.0 * atr[i]) if supp else min(st, c[i] + 1.0 * atr[i])
        if ex == "STEP_TRAIL":
            lk = -1
            if fr >= 1:
                lk = 0
            if fr >= 2:
                lk = 1
            if fr >= 3:
                lk = 2
            if lk >= 0:
                st = max(st, ep + lk * risk) if supp else min(st, ep - lk * risk)
        if ex == "SWING_TRAIL" and i > ei:
            a = max(0, i - 5)
            x = l[a:i].min() if supp else h[a:i].max()
            st = max(st, x) if supp else min(st, x)
        if ex == "LEVEL_INVALIDATION":
            st = lvl - P["breakAtr"] * atr[i] if supp else lvl + P["breakAtr"] * atr[i]
        hs = (l[i] <= st) if supp else (h[i] >= st)
        ht = tp > 0 and ((h[i] >= tp) if supp else (l[i] <= tp))
        if hs:
            return (st - point * P["slipPts"] if supp else st + point * P["slipPts"]), i, "STOP_FIRST_CONSERVATIVE"
        if ht:
            return (tp - point * P["slipPts"] if supp else tp + point * P["slipPts"]), i, "TARGET"
        if ex == "TIME_FAST" and i - ei + 1 >= 24:
            return (c[i] - point * P["slipPts"] if supp else c[i] + point * P["slipPts"]), i, "TIME_FAST"
        if ex == "TIME_SLOW" and i - ei + 1 >= 72:
            return (c[i] - point * P["slipPts"] if supp else c[i] + point * P["slipPts"]), i, "TIME_SLOW"
        if ex == "EMA_CLOSE" and ((supp and c[i] < ema[i]) or (not supp and c[i] > ema[i])):
            return (c[i] - point * P["slipPts"] if supp else c[i] + point * P["slipPts"]), i, "EMA_CLOSE"
        if i == lastb:
            return (c[i] - point * P["slipPts"] if supp else c[i] + point * P["slipPts"]), i, "MAX_HOLD"
    return out, oor, reason
    pull = P["pullMax"] * np.clip(ev / 0.65, 0, 1)
    lvl = raw + (bnode - raw) * pull
    sc = 100.0 * (0.50 * ev + 0.20 * ab + 0.15 * vSc + 0.15 * wSc)
    if sc < P["minScore"]:
        return None
    return dict(raw=raw, node=bnode, level=lvl, evid=ev, nstr=bns, score=sc, atrp=atrp)
                buy[rr] += x * bs
    mx = tot.max()
    poc = bot + (int(tot.argmax()) + 0.5) * step
    return bot, step, tot, buy, mx, poc