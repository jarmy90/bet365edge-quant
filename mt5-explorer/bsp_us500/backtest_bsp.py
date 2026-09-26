import json
import math
import os
import pandas as pd
import numpy as np

P = dict(profLb=600, profRows=72, swingLen=5, volLen=40, atrLen=14,
         searchAtr=1.20, minNode=0.08, minEv=0.22, pullMax=0.85,
         minScore=30.0, breakAtr=0.10, absRad=3, pivVolX=2.2,
         absBodyMax=0.40, absVolX=1.5, retestBars=30,
         retestTolAtr=0.10, reqReaction=True, stopBufAtr=0.25,
         maxHold=240, slipPts=2.0)

EXITS = ["TP_1R", "TP_2R", "TP_3R", "TP_1ATR", "TP_2ATR",
         "TRAIL_1ATR", "TRAIL_2ATR", "BE_THEN_2R", "BE_THEN_TRAIL",
         "STEP_TRAIL", "TIME_FAST", "TIME_SLOW", "EMA_CLOSE",
         "SWING_TRAIL", "LEVEL_INVALIDATION"]


def load_yahoo(path):
    d = json.load(open(path))
    r = d["chart"]["result"][0]
    q = r["indicators"]["quote"][0]
    df = pd.DataFrame({"time": pd.to_datetime(r["timestamp"], unit="s"),
                       "open": q["open"], "high": q["high"],
                       "low": q["low"], "close": q["close"],
                       "vol": q.get("volume")})
    df = df.dropna(subset=["open", "high", "low", "close"]).reset_index(drop=True)
    df["vol"] = df["vol"].fillna(0)
    return df


def wilder_atr(h, l, c, n):
    tr = np.maximum(h - l, np.maximum(np.abs(h - np.roll(c, 1)), np.abs(l - np.roll(c, 1))))
    tr[0] = h[0] - l[0]
    atr = np.zeros_like(tr, dtype=float)
    atr[0] = tr[0]
    for i in range(1, len(tr)):
        atr[i] = (atr[i - 1] * (n - 1) + tr[i]) / n
    return atr

def prof(lo, hi, cl, vv, first, last, rows):
    lo_ = lo[first:last + 1].min()
    hi_ = hi[first:last + 1].max()
    span = max(hi_ - lo_, 1e-9 * rows)
    bot = lo_
    step = span / rows
    tot = np.zeros(rows)
    buy = np.zeros(rows)
    for i in range(first, last + 1):
        l, h, v = lo[i], hi[i], max(vv[i], 0.0)
        rg = h - l
        bs = np.clip((cl[i] - l) / rg, 0, 1) if rg > 0 else 0.5
        r0 = max(0, min(rows - 1, int(math.floor((l - bot) / step))))
        r1 = max(0, min(rows - 1, int(math.floor((h - bot) / step))))
        for rr in range(r0, r1 + 1):
            rl = bot + rr * step
            ov = max(0.0, min(h, rl + step) - max(l, rl)) if rg > 0 else step
            fr = ov / rg if rg > 0 else 1.0
            if fr > 0:
                x = v * fr
                tot[rr] += x
                buy[rr] += x * bs
    return bot, step, tot, buy, tot.max()


def signal(o, h, l, c, v, av, atr, p, supp):
    n = len(c)
    first, last = max(0, p - P["profLb"] + 1), p
    bot, step, tot, buy, mx = prof(l, h, c, v, first, last, P["profRows"])
    if mx <= 0:
        return None
    raw = l[p] if supp else h[p]
    atrp = max(atr[p], 1e-9)
    rad = max(atrp * P["searchAtr"], step * 2.0)
    be, bnode, bns = -1.0, raw, 0.0
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
    vr = v[p] / av[p] if av[p] > 0 else 1.0
    vSc = np.clip((vr - 0.8) / (P["pivVolX"] - 0.8), 0, 1)
    rg = max(h[p] - l[p], 1e-9)
    wk = min(o[p], c[p]) - l[p] if supp else h[p] - max(o[p], c[p])
    wSc = np.clip((wk / rg) / 0.50, 0, 1)
    ab = 0.0
    for i in range(max(0, p - P["absRad"]), min(n, p + P["absRad"] + 1)):
        cr = max(h[i] - l[i], 1e-9)
        r2 = v[i] / av[i] if av[i] > 0 else 1.0
        b = abs(c[i] - o[i]) / cr
        ab = max(ab, math.sqrt(np.clip((P["absBodyMax"] - b) / P["absBodyMax"], 0, 1) * np.clip((r2 - 1.0) / (P["absVolX"] - 1.0), 0, 1)))
    lvl = raw + (bnode - raw) * P["pullMax"] * np.clip(ev / 0.65, 0, 1)
    sc = 100.0 * (0.50 * ev + 0.20 * ab + 0.15 * vSc + 0.15 * wSc)
    if sc < P["minScore"]:
        return None
    return dict(raw=raw, node=bnode, level=lvl, evid=ev, nstr=bns, score=sc, atrp=atrp)
def sim(o, h, l, c, atr, ema, ei, ep, st0, risk, atrp, lvl, supp, ex, point):
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
    lastb = min(len(c) - 1, ei + P["maxHold"])
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
            px = st - point * P["slipPts"] if supp else st + point * P["slipPts"]
            return px, i, "STOP_FIRST_CONSERVATIVE"
        if ht:
def run(df, point=0.25):
    o = df.open.values
    h = df.high.values
    l = df.low.values
    c = df.close.values
    v = df.vol.values.astype(float)
    n = len(df)
    sw = P["swingLen"]
    av = pd.Series(v).rolling(P["volLen"], min_periods=1).mean().values
    atr = wilder_atr(h, l, c, P["atrLen"])
    ema = pd.Series(c).ewm(span=20, adjust=False).mean().values
    is_lo = np.zeros(n, bool)
    is_hi = np.zeros(n, bool)
    for p in range(sw, n - sw):
        ok_lo = True
        ok_hi = True
        for j in range(p - sw, p + sw + 1):
            if j == p:
                continue
            if l[j] <= l[p]:
                ok_lo = False
            if h[j] >= h[p]:
                ok_hi = False
        is_lo[p] = ok_lo
        is_hi[p] = ok_hi
    rows = []
    cases = 0
    start = max(700, P["profLb"] + sw)
    for p in range(start, n - sw - 2):
        for supp in (True, False):
            if supp and not is_lo[p]:
                continue
            if not supp and not is_hi[p]:
                continue
            conf = p + sw
            sig = signal(o, h, l, c, v, av, atr, p, supp)
            if sig is None:
                continue
            for em in ("CLOSE_CONFIRM", "INTRABAR_RETEST"):
                if em == "CLOSE_CONFIRM":
                    ei = conf
                    ep = c[ei] + point * P["slipPts"] if supp else c[ei] - point * P["slipPts"]
                else:
                    tol = atr[conf] * P["retestTolAtr"]
                    ei, ep = -1, None
                    for i in range(conf + 1, min(n, conf + 1 + P["retestBars"])):
                        touch = l[i] <= sig["level"] + tol and h[i] >= sig["level"] - tol
                        react = (c[i] >= sig["level"]) if supp else (c[i] <= sig["level"])
                        if touch and (react or not P["reqReaction"]):
                            ei = i
                            ep = sig["level"] + point * P["slipPts"] if supp else sig["level"] - point * P["slipPts"]
                            break
                    if ei < 0:
                        continue
                st0 = sig["raw"] - P["stopBufAtr"] * sig["atrp"] if supp else sig["raw"] + P["stopBufAtr"] * sig["atrp"]
                risk = abs(ep - st0)
                if risk < 1e-9:
                    continue
                cases += 1
                for ex in EXITS:
                    out, oor, reason = sim(o, h, l, c, atr, ema, ei, ep, st0, risk, sig["atrp"], sig["level"], supp, ex, point)
                    r = ((out - ep) if supp else (ep - out)) / risk
                    rows.append(dict(side="LONG" if supp else "SHORT", entry_mode=em,
                                     exit_model=ex, r_multiple=r, score=sig["score"],
                                     evidence=sig["evid"], node_strength=sig["nstr"],
                                     bars_held=oor - ei + 1, reason=reason))
    return pd.DataFrame(rows), cases


def report(t, title):
    print("=" * 100)
    print(title + " filas=" + str(len(t)))
    print("=" * 100)

    def agg(x):
        pos = x.loc[x.r_multiple > 0, "r_multiple"].sum()
        neg = abs(x.loc[x.r_multiple < 0, "r_multiple"].sum())
        return pd.Series({"trades": len(x), "net_R": x.r_multiple.sum(),
                          "avg_R": x.r_multiple.mean(),
                          "win_rate": (x.r_multiple > 0).mean() * 100,
                          "PF": pos / neg if neg > 0 else np.nan,
                          "avg_bars": x.bars_held.mean()})
    g = t.groupby(["side", "entry_mode", "exit_model"]).apply(agg, include_groups=False).reset_index()
    top = g[g.trades >= 20].sort_values("net_R", ascending=False).head(20)
    print(top.round(3).to_string(index=False))
    print("--- por exit ---")
    print(t.groupby("exit_model").apply(agg, include_groups=False).sort_values("net_R", ascending=False).round(3).to_string())
    print("--- score vs R ---")
    t["sbin"] = pd.cut(t.score, bins=[0, 30, 45, 60, 75, 100])
    print(t.groupby("sbin", observed=True).r_multiple.agg(["count", "mean", "sum"]).round(3).to_string())
    return top


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--es15", default="es_15m.json")
    ap.add_argument("--es1h", default="es_1h.json")
    ap.add_argument("--es1d", default="es_1d.json")
    a = ap.parse_args()
    for f, pt, nm in [(a.es15, 0.25, "ES=F 15m 60d"), (a.es1h, 0.25, "ES=F 1H 2y"), (a.es1d, 0.25, "ES=F Daily 10y")]:
        if not os.path.exists(f):
            print(nm + ": falta " + f)
            continue
        df = load_yahoo(f)
        print("#### " + nm + ": " + str(len(df)) + " barras " + str(df.time.min()) + " -> " + str(df.time.max()))
        t, cases = run(df, pt)
        t.to_csv(os.path.splitext(f)[0] + "_bsp_trades.csv", index=False, sep=";")
        print("casos=" + str(cases) + " filas=" + str(len(t)))
        if len(t):
            report(t, nm)
            px = tp - point * P["slipPts"] if supp else tp + point * P["slipPts"]
            return px, i, "TARGET"
        if ex == "TIME_FAST" and i - ei + 1 >= 24:
            px = c[i] - point * P["slipPts"] if supp else c[i] + point * P["slipPts"]
            return px, i, "TIME_FAST"
        if ex == "TIME_SLOW" and i - ei + 1 >= 72:
            px = c[i] - point * P["slipPts"] if supp else c[i] + point * P["slipPts"]
            return px, i, "TIME_SLOW"
        if ex == "EMA_CLOSE" and ((supp and c[i] < ema[i]) or (not supp and c[i] > ema[i])):
            px = c[i] - point * P["slipPts"] if supp else c[i] + point * P["slipPts"]
            return px, i, "EMA_CLOSE"
        if i == lastb:
            px = c[i] - point * P["slipPts"] if supp else c[i] + point * P["slipPts"]
            return px, i, "MAX_HOLD"
    return ep, ei, "NO_DATA"