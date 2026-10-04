# =============================================================================
# TM3 PF OPTIMIZER - replica Python del EA MQL5
#   Base: TM3_PF_OPTIMIZER_EXPLORER_v2_00.mq5 (20 variantes REC_*)
#   Reglas anadidas v2.10:
#     * 11:00 ET corta NUEVAS escaleras, pero no las pendientes
#     * al perder el ultimo paso: step=0 y lost=0 (sin heredar perdidas)
#     * contadores sequences / sequence_wins / sequence_failures
#     * after_hours en trades (abierta fuera de 09:30-11:00 ET)
#     * patrones reciclados por dia ET y slots de ops reutilizados
#   Datos: HistData NSX/USD M1 (proxy USTEC/NQ) convertido a ET real.
# Uso: python backtest_tm3_pf.py [spread] [tag] [--csv=file] [--v200] [--vpt=1.0]
# =============================================================================
import os
import math
import sys
import time as _t
import numpy as np
import pandas as pd
from zoneinfo import ZoneInfo

BASE = os.path.dirname(os.path.abspath(__file__))
M1_DEFAULT = os.path.join(BASE, "..", "ustec_speed", "histdata_ustec", "nsxusd_m1_all.csv")

# ---- inputs del EA ----
CAP0 = 10000.0
LOTBASE = 0.01
LOTMAX = 0.04
VPT = 1.0          # InpValorPuntoLote
COMM = 0.0         # InpComisionRTLote
REWMIN = 6.0
SLMIN = 5.0
SPRMAX = 2.0
MAXSEC = 600
H_DATA = 9 * 60 + 29
H_TRADE = 9 * 60 + 30
H_END = 11 * 60
REF_SEC = 60
SEN_TT = 2
SEN_FT = 3
MIN_TREF = 30
MIN_TSEN = 3
ZVL = 2.0
RER = 0.35
IRPL = 3.0
IIT = 0.20
LAM = 0.30
REG = 1e-8
FRANJA = 3.0
FT256 = True
CARRIL = True
SEGMIN = 0
SEGMAX = 59
EXCL3 = False
TICKS_PER_BAR = 120
TICK_MS = 500      # ticks sinteticos cada 0.5 s (el TT exige >=3 ticks en 2 s)
TT_MODE = "strict"  # strict (2de3) | k1 (>=1) | off (sin filtro de sentimiento)

# name, cap(pts), slcap(pts), obj, maxstep, filter, ft, fttp, ftsl, dyn
V = [
    ("REC_TT_CAP30", 30, 0, 1, 4, 2, False, 0, 0, False),
    ("REC_TT_CAP35", 35, 0, 1, 4, 2, False, 0, 0, False),
    ("REC_TT_CAP40", 40, 0, 1, 4, 2, False, 0, 0, False),
    ("REC_TT_CAP45", 45, 0, 1, 4, 2, False, 0, 0, False),
    ("REC_TT_CAP50", 50, 0, 1, 4, 2, False, 0, 0, False),
    ("REC_TT_CAP60", 60, 0, 1, 4, 2, False, 0, 0, False),
    ("REC_TT_3PASOS", 60, 0, 1, 3, 2, False, 0, 0, False),
    ("REC_TT_4PASOS", 60, 0, 1, 4, 2, False, 0, 0, False),
    ("REC_TT_DINAMICO", 60, 0, 1, 4, 2, False, 0, 0, True),
    ("REC_TT_OBJ05", 60, 0, 0.5, 4, 2, False, 0, 0, False),
    ("REC_TT_OBJ20", 60, 0, 2, 4, 2, False, 0, 0, False),
    ("REC_TT_OBJ30", 60, 0, 3, 4, 2, False, 0, 0, False),
    ("REC_TT_SL10", 60, 10, 1, 4, 2, False, 0, 0, False),
    ("REC_TT_SL15", 60, 15, 1, 4, 2, False, 0, 0, False),
    ("REC_TT_SL20", 60, 20, 1, 4, 2, False, 0, 0, False),
    ("REC60_FT10_10", 60, 0, 1, 4, 2, True, 10, 10, False),
    ("REC60_FT12_10", 60, 0, 1, 4, 2, True, 12, 10, False),
    ("REC60_FT15_10", 60, 0, 1, 4, 2, True, 15, 10, False),
    ("REC40_FT10_10", 40, 0, 1, 4, 2, True, 10, 10, False),
    ("REC60_FT_STRICT", 60, 0, 1, 4, 1, True, 10, 10, False),
]
IDX = {v[0]: i for i, v in enumerate(V)}



def synth_ticks(o, h, l, c, t0_ms, spread):
    """Camino intravela O->(L|H)->(H|L)->C, TICKS_PER_BAR ticks de 1s."""
    wps = [o, l, h, c] if c >= o else [o, h, l, c]
    seg = TICKS_PER_BAR // (len(wps) - 1)
    out, k = [], 0
    for s in range(len(wps) - 1):
        a, b = wps[s], wps[s + 1]
        for j in range(seg):
            bid = a + (b - a) * (j / seg)
            out.append((t0_ms + k * TICK_MS, bid, bid + spread))
            k += 1
    bid = wps[-1]
    out.append((t0_ms + k * TICK_MS, bid, bid + spread))
    return out


class Engine:
    MAXT = 25000
    MAXP = 600
    MAXO = 4000

    def __init__(self, spread=1.0, v200=False, vpt=1.0):
        self.spread = spread
        self.v200 = v200          # True = no resetea lost al fallar la escalera
        self.vpt = vpt
        self.t, self.b, self.a, self.mid = [], [], [], []
        self.pats = []
        self.ops = []
        self.state = [dict(eq=CAP0, peak=CAP0, dd=0.0, gp=0.0, gl=0.0, lost=0.0,
                           step=0, n=0, w=0, l=0, streak=0, maxstreak=0, skip=0,
                           seqs=0, seqwin=0, seqfail=0, afterh=0) for _ in V]
        self.trades, self.events, self.days = [], [], []
        self.prev_ask = self.prev_bid = 0.0
        self.et_min = 0
        self.pid = 1
        self.pending = []
        self.active_idx = []
        self.out_watch = []
        self.band_watch = []
        self.n_open = 0
        self.et_day = None

    # ---------------- ticks y series ----------------
    def add_tick(self, ms, bid, ask):
        self.t.append(ms); self.b.append(bid); self.a.append(ask)
        self.mid.append((bid + ask) * 0.5)
        if len(self.t) > self.MAXT:
            for L in (self.t, self.b, self.a, self.mid):
                del L[0]
        cut = ms - (REF_SEC + 5) * 1000
        k = 0
        while k < len(self.t) and self.t[k] < cut:
            k += 1
        if k:
            for L in (self.t, self.b, self.a, self.mid):
                del L[:k]

    def series(self, sec):
        n = len(self.t)
        if n < 3:
            return None, None
        cut = self.t[-1] - sec * 1000
        st = 0
        while st < n and self.t[st] < cut:
            st += 1
        if st + 1 >= n:
            return None, None
        tt = np.asarray(self.t[st:], float)
        mm = np.asarray(self.mid[st:], float)
        dt = np.diff(tt) / 1000.0
        dt[dt < 0.001] = 0.001
        v = np.diff(mm) / dt
        acc = np.empty(len(v))
        acc[0] = 0.0
        acc[1:] = np.diff(v) / dt[1:]
        return v, acc

    @staticmethod
    def ent(p, m):
        n = p + m
        if n < 1:
            return 0.0
        h = 0.0
        for c in (p, m):
            if c > 0:
                q = c / n
                h -= q * math.log(q) / math.log(2.0)
        return h

    def sent(self, direction, sigsec):
        vr, ar = self.series(REF_SEC)
        vv, aa = self.series(sigsec)
        if vr is None or vv is None or len(vr) < MIN_TREF or len(vv) < MIN_TSEN:
            return None
        mv, xv = vr.mean(), vr.var(ddof=1)
        ma, xa = ar.mean(), ar.var(ddof=1)
        ms = vv.mean()
        sv = math.sqrt(max(xv, 0.0))
        zvl = (ms - mv) / (sv + 1e-12)
        hr = self.ent(int((vr > 0).sum()), int((vr < 0).sum()))
        hs = self.ent(int((vv > 0).sum()), int((vv < 0).sum()))
        idx = max(0, len(self.mid) - len(vv) - 1)
        dp = self.mid[-1] - self.mid[idx]
        rer = ((hr - hs) / (hr + 1e-12)) * (1 if dp > 0 else (-1 if dp < 0 else 0))
        w = np.exp(LAM * np.arange(1, len(vv) + 1))
        sw = w.sum()
        wv = float((w * vv).sum() / sw)
        wa = float((w * aa).sum() / sw)
        cov = float(((vr - mv) * (ar - ma)).sum() / (len(vr) - 1 if len(vr) > 1 else 1))
        A = xv + REG
        C = xa + REG
        D = A * C - cov * cov
        if D <= REG * REG:
            return None
        d1, d2 = wv - mv, wa - ma
        irpl = math.sqrt(max(0.0, d1 * d1 * C / D - 2 * d1 * d2 * cov / D + d2 * d2 * A / D))
        zsf = (direction * mv - direction * ms) / (sv + 1e-12)
        ip = float(np.abs(vv[vv * direction > 0]).sum())
        im = float(np.abs(vv[vv * direction < 0]).sum())
        phi = (im - ip) / (im + ip + 1e-12)
        rpcn = phi * (im + ip) / len(vv) / max(abs(mv) + sv, 1e-12)
        el = abs(vv.sum()) / (np.abs(vv).sum() + 1e-12)
        er = abs(vr.sum()) / (np.abs(vr).sum() + 1e-12)
        return dict(zvl=zvl, rer=rer, irpl=irpl, zsf=zsf, rpcn=rpcn, iit=er - el,
                    vpond=wv, ok=True)

    # ---------------- filtros y lotaje ----------------
    @staticmethod
    def tt_filter(vi, s, direction):
        if TT_MODE == "off":
            return True
        if s is None:
            return False
        a = direction * s["zvl"] > ZVL
        b = direction * s["rer"] > RER
        c = s["irpl"] > IRPL and direction * s["vpond"] > 0
        k = int(a) + int(b) + int(c)
        if V[vi][5] == 1:
            return k == 3
        return k >= 1 if TT_MODE == "k1" else k >= 2

    @staticmethod
    def ft_filter(vi, s):
        if s is None:
            return False
        if not CARRIL:
            return True
        q = s["rpcn"] > 0 and s["iit"] > 0
        if vi == IDX["REC60_FT_STRICT"]:
            q = q and s["zsf"] > 0 and s["iit"] > IIT
        return q

    def lot(self, vi, slpts):
        st = self.state[vi]
        z = LOTBASE * (st["step"] + 1)
        if V[vi][9]:
            need = st["lost"] + V[vi][3]
            z = math.ceil(need / max(slpts * self.vpt, 0.0001) * 100) / 100.0
        z = min(z, LOTMAX)
        return round(max(0.01, math.floor(z / 0.01 + 1e-9) * 0.01), 2)

    # ---------------- patrones ----------------
    def new_bar(self, bn, bn1):
        if len(self.pats) >= self.MAXP:
            self.pats = [p for p in self.pats if not p["resolved"]]
            if len(self.pats) >= self.MAXP:
                return
        if bn["close"] == bn["open"]:
            return
        d = 1 if bn["close"] > bn["open"] else -1
        A = (bn["high"] - bn1["low"]) if d > 0 else (bn1["high"] - bn["low"])
        if A <= 0:
            return
        trig = bn["high"] if d > 0 else bn["low"]
        sl = bn1["low"] if d > 0 else bn1["high"]
        if abs(trig - sl) < SLMIN:
            sl = trig - d * SLMIN
        risk = abs(trig - sl)
        self.pats.append(dict(id=self.pid, dir=d, A=A, trig=trig, sl=sl, risk=risk,
                              tp=trig + d * A, armed=(A >= risk and A >= REWMIN),
                              trigged=False, resolved=False, ftactive=False, k=0,
                              nextband=0.0, ftend=0, is930=bn1["et930"], ft256=False,
                              st=None))
        self.pid += 1

    # ---------------- apertura / cierre ----------------
    def open_v(self, vi, p, kind, s, tmsc, bid, ask):
        if self.active_of(vi):
            return False
        if kind == 0 and not self.tt_filter(vi, p["st"], p["dir"]):
            return False
        if kind > 0:
            if not V[vi][6]:
                return False
            if TT_MODE != "off" and not self.ft_filter(vi, s):
                return False
        st = self.state[vi]
        d = -p["dir"] if kind else p["dir"]
        entry = ask if d > 0 else bid
        if kind == 0:
            sl = p["sl"]
            if V[vi][2] > 0 and abs(entry - sl) > V[vi][2]:
                sl = entry - d * V[vi][2]
            risk = abs(entry - sl)
            lot = self.lot(vi, risk)
            need = st["lost"] + V[vi][3] + COMM * lot
            pts = max(REWMIN, need / max(lot * self.vpt, 0.0001))
            if pts > V[vi][1]:
                st["skip"] += 1
                return False
            tp = entry + d * pts
        else:
            tp = entry + d * V[vi][7]
            sl = entry - d * V[vi][8]
            lot = self.lot(vi, abs(entry - sl))
        if self.n_open >= self.MAXO:
            self.ops = [o for o in self.ops if o["active"]]
            if self.n_open >= self.MAXO:
                return False
        if not (H_TRADE <= self.et_min < H_END) and not (st["step"] > 0 or st["lost"] > 0):
            return False          # v2.10: fuera de horario solo escaleras pendientes
        if kind == 0 and st["step"] == 0:
            st["seqs"] += 1       # nueva escalera
        if not (H_TRADE <= self.et_min < H_END):
            st["afterh"] += 1
        s = s or {}
        self.ops.append(dict(active=True, vi=vi, pat=p["id"], kind=kind, dir=d, step=st["step"],
                             lot=lot, en=entry, tp=round(tp, 2), sl=round(sl, 2), ot=tmsc,
                             ah=0 if (H_TRADE <= self.et_min < H_END) else 1,
                             zvl=(p["st"] or {}).get("zvl", 0), rer=(p["st"] or {}).get("rer", 0),
                             irpl=(p["st"] or {}).get("irpl", 0),
                             zsf=s.get("zsf", 0), rpcn=s.get("rpcn", 0), iit=s.get("iit", 0)))
        self.active_idx.append(len(self.ops) - 1)
        self.n_open = max(self.n_open, len(self.ops))
        return True

    def close_v(self, idx, ex, why, tmsc):
        o = self.ops[idx]
        if not o["active"]:
            return
        vi = o["vi"]
        st = self.state[vi]
        pts = o["dir"] * (ex - o["en"])
        pnl = pts * self.vpt * o["lot"] - COMM * o["lot"]
        st["eq"] += pnl
        st["n"] += 1
        if pnl > 0:
            st["w"] += 1
            st["gp"] += pnl
            st["lost"] = 0.0
            st["streak"] = 0
            st["step"] = 0
            st["seqwin"] += 1
        else:
            st["l"] += 1
            st["gl"] += -pnl
            st["lost"] += -pnl
            st["streak"] += 1
            st["maxstreak"] = max(st["maxstreak"], st["streak"])
            st["step"] += 1
            if st["step"] >= V[vi][4]:
                st["step"] = 0
                st["seqfail"] += 1
                if not self.v200:
                    st["lost"] = 0.0
        st["peak"] = max(st["peak"], st["eq"])
        st["dd"] = max(st["dd"], st["peak"] - st["eq"])
        self.trades.append([o["ot"], tmsc, vi, V[vi][0], o["pat"], o["kind"], o["dir"], o["step"],
                            o["lot"], o["en"], ex, o["tp"], o["sl"], round(pts, 2), round(pnl, 2),
                            why, o["ah"], o["zvl"], o["rer"], o["irpl"], o["zsf"], o["rpcn"],
                            o["iit"], round(st["eq"], 2)])
        o["active"] = False

    def manage(self, tmsc, bid, ask):
        for i in list(self.active_idx):
            o = self.ops[i]
            if not o["active"]:
                continue
            px = bid if o["dir"] > 0 else ask
            hit_tp = px >= o["tp"] if o["dir"] > 0 else px <= o["tp"]
            hit_sl = px <= o["sl"] if o["dir"] > 0 else px >= o["sl"]
            if hit_sl:
                self.close_v(i, o["sl"], "SL", tmsc)
            elif hit_tp:
                self.close_v(i, o["tp"], "TP", tmsc)
            elif (tmsc - o["ot"]) >= MAXSEC * 1000:
                self.close_v(i, px, "TIME", tmsc)

    # ---------------- disparadores ----------------
    def triggers(self, tmsc, bid, ask, sec):
        if not (H_TRADE <= self.et_min < H_END):
            # v2.10: sin nuevas escaleras, pero el bucle sigue para las pendientes
            pass
        if self.spread > SPRMAX:
            return
        if sec < SEGMIN or sec > SEGMAX or (EXCL3 and sec <= 3):
            return
        for p in self.pending:
            if not p["armed"] or p["trigged"] or p["resolved"]:
                continue
            cr = (self.prev_ask < p["trig"] <= ask) if p["dir"] > 0 else (self.prev_bid > p["trig"] >= bid)
            if not cr:
                continue
            p["st"] = self.sent(p["dir"], SEN_TT)
            p["trigged"] = True
            for vi in range(len(V)):
                self.open_v(vi, p, 0, None, tmsc, bid, ask)

    def outcomes(self, tmsc, bid, ask):
        for p in self.out_watch:
            if not p["trigged"] or p["resolved"]:
                continue
            px = bid if p["dir"] > 0 else ask
            hit_tp = px >= p["tp"] if p["dir"] > 0 else px <= p["tp"]
            hit_sl = px <= p["sl"] if p["dir"] > 0 else px >= p["sl"]
            if hit_sl:
                p["resolved"] = True
            elif hit_tp:
                p["resolved"] = True
                p["ftactive"] = True
                p["k"] = 0
                p["nextband"] = p["tp"]
                p["ftend"] = tmsc + 120 * 1000
                if p not in self.band_watch:
                    self.band_watch.append(p)

    def bands(self, tmsc, bid, ask):
        for p in self.band_watch:
            if not p["ftactive"]:
                continue
            if tmsc >= p["ftend"]:
                p["ftactive"] = False
                continue
            px = bid if p["dir"] > 0 else ask
            hit = px >= p["nextband"] if p["dir"] > 0 else px <= p["nextband"]
            guard = 0
            while hit and p["k"] < 80 and guard < 80:
                guard += 1
                s = self.sent(p["dir"], SEN_FT)
                for vi in range(len(V)):
                    self.open_v(vi, p, 1, s, tmsc, bid, ask)
                p["k"] += 1
                p["nextband"] = p["tp"] + p["dir"] * p["k"] * FRANJA
                hit = px >= p["nextband"] if p["dir"] > 0 else px <= p["nextband"]
            if FT256 and p["is930"] and not p["ft256"]:
                lv = p["trig"] + p["dir"] * 2.56 * p["A"]
                h = px >= lv if p["dir"] > 0 else px <= lv
                if h:
                    s = self.sent(p["dir"], SEN_FT)
                    for vi in range(len(V)):
                        self.open_v(vi, p, 2, s, tmsc, bid, ask)
                    p["ft256"] = True

    def active_of(self, vi):
        for j in self.active_idx:
            o = self.ops[j]
            if o["active"] and o["vi"] == vi:
                return True
        return False

    def has_pending(self, vi):
        st = self.state[vi]
        return st["step"] > 0 or st["lost"] > 0 or self.active_of(vi)


# ---------------- bucle principal ----------------
def run(csv_path, spread, v200=False, vpt=1.0, limit=None):
    ny = ZoneInfo("America/New_York")
    df = pd.read_csv(csv_path)
    df["time"] = pd.to_datetime(df["time"])
    df["ny"] = df["time"].dt.tz_localize("UTC").dt.tz_convert(ny)
    if limit:
        df = df.iloc[:limit].reset_index(drop=True)
    og, hg, lg, cg = (df[x].values for x in ("open", "high", "low", "close"))
    tsg = df["time"].values
    etmin = (df["ny"].dt.hour * 60 + df["ny"].dt.minute).values
    etsec = df["ny"].dt.second.values
    et930 = ((df["ny"].dt.hour == 9) & (df["ny"].dt.minute == 30)).values
    etday = df["ny"].dt.date.values
    eng = Engine(spread, v200, vpt)
    n = len(df)
    for i in range(2, n):
        bn = dict(open=og[i - 2], high=hg[i - 2], low=lg[i - 2], close=cg[i - 2], et930=et930[i - 2])
        bn1 = dict(open=og[i - 1], high=hg[i - 1], low=lg[i - 1], close=cg[i - 1], et930=et930[i - 1])
        if eng.et_day != etday[i]:
            eng.et_day = etday[i]
            eng.pats = [p for p in eng.pats if not p["resolved"]]
        eng.new_bar(bn, bn1)
        eng.pending = [p for p in eng.pats if p["armed"] and not p["trigged"] and not p["resolved"]]
        eng.out_watch = [p for p in eng.pats if p["trigged"] and not p["resolved"]]
        eng.active_idx = [j for j, o in enumerate(eng.ops) if o["active"]]
        if not (H_DATA <= etmin[i] < H_END + 120):
            continue
        t0 = int(pd.Timestamp(tsg[i]).timestamp() * 1000)
        k = 0
        for tmsc, bid, ask in synth_ticks(og[i], hg[i], lg[i], cg[i], t0, spread):
            eng.et_min = (int(etmin[i]) + k) % 1440
            k += 1
            eng.add_tick(tmsc, bid, ask)
            eng.triggers(tmsc, bid, ask, (int(etsec[i]) + k) % 60)
            eng.manage(tmsc, bid, ask)
            eng.outcomes(tmsc, bid, ask)
            eng.bands(tmsc, bid, ask)
            eng.prev_ask, eng.prev_bid = ask, bid
        pend = sum(1 for vi in range(len(V)) if eng.has_pending(vi))
        if eng.et_min >= H_END and pend == 0:
            eng.days.append([etday[i], eng.et_min, pend])
    pend = [vi for vi in range(len(V)) if eng.has_pending(vi)]
    return eng, df, pend


def write_out(eng, tag, pend):
    tr = pd.DataFrame(eng.trades, columns=[
        "open_server", "close_server", "variant", "name", "pattern", "kind", "dir", "step",
        "lot", "entry", "exit", "tp", "sl", "points", "pnl", "reason", "after_hours",
        "ZVL", "RER", "IRPL", "ZSF", "RPCN", "IIT", "equity"])
    rows = []
    for i, v in enumerate(V):
        st = eng.state[i]
        pf = st["gp"] / st["gl"] if st["gl"] > 0 else 0.0
        wr = 100.0 * st["w"] / st["n"] if st["n"] else 0.0
        fp = 100.0 * st["seqfail"] / st["seqs"] if st["seqs"] else 0.0
        rows.append(dict(variant=i, name=v[0], cap_pts=v[1], slcap=v[2], obj=v[3],
                         maxstep=v[4], filter=v[5], ft=v[6], trades=st["n"], wins=st["w"],
                         losses=st["l"], winrate=round(wr, 2), gp=round(st["gp"], 2),
                         gl=round(st["gl"], 2), pf=round(pf, 3), equity=round(st["eq"], 2),
                         net=round(st["eq"] - CAP0, 2), maxdd=round(st["dd"], 2),
                         max_streak=st["maxstreak"], next_step=st["step"],
                         unrecovered=round(st["lost"], 2), skipped=st["skip"],
                         sequences=st["seqs"], sequence_wins=st["seqwin"],
                         sequence_failures=st["seqfail"], failure_pct=round(fp, 1),
                         after_hours_entries=st["afterh"],
                         pending_at_summary=1 if i in pend else 0))
    sm = pd.DataFrame(rows)
    tr.to_csv(os.path.join(BASE, f"TM3_PF_Trades_{tag}.csv"), index=False, sep=";")
    sm.to_csv(os.path.join(BASE, f"TM3_PF_Resumen_{tag}.csv"), index=False, sep=";")
    return sm, tr




def report(sm, tr, tag, df, pend):
    print("=" * 118)
    print(f"{tag}  barras={len(df)}  {df.time.min()} -> {df.time.max()}  "
          f"trades={len(tr)}  variantes_pendientes_al_final={len(pend)}")
    print("=" * 118)
    cols = ["variant", "name", "trades", "winrate", "net", "pf", "maxdd", "max_streak",
            "sequences", "sequence_wins", "sequence_failures", "failure_pct",
            "after_hours_entries", "skipped", "next_step", "unrecovered"]
    print(sm[cols].to_string(index=False))
    if len(tr):
        print("\n-- motivo de salida --")
        print(tr.groupby("reason").pnl.agg(["count", "sum", "mean"]).round(2).to_string())
        print("\n-- kind 0=TT 1=FT_band 2=FT256 --")
        print(tr.groupby("kind").pnl.agg(["count", "sum", "mean"]).round(2).to_string())
        print("\n-- after_hours --")
        print(tr.groupby("after_hours").pnl.agg(["count", "sum", "mean"]).round(2).to_string())
        print("\n-- paso de escalera --")
        print(tr.groupby("step").pnl.agg(["count", "sum", "mean"]).round(2).to_string())


if __name__ == "__main__":
    args = [a for a in sys.argv[1:]]
    spread = float(args[0]) if args and not args[0].startswith("--") else 1.0
    tag = args[1] if len(args) > 1 and not args[1].startswith("--") else "v210"
    v200 = "--v200" in args
    if "--k1" in args:
        TT_MODE = "k1"
    if "--nofilter" in args:
        TT_MODE = "off"
    vpt = 1.0
    csvp = M1_DEFAULT
    lim = None
    for a in args:
        if a.startswith("--vpt="):
            vpt = float(a.split("=", 1)[1])
        if a.startswith("--csv="):
            csvp = a.split("=", 1)[1]
        if a.startswith("--limit="):
            lim = int(a.split("=", 1)[1])
    t0 = _t.time()
    eng, df, pend = run(csvp, spread, v200, vpt, lim)
    sm, tr = write_out(eng, tag, pend)
    print(f"tiempo={_t.time() - t0:.1f}s")
    report(sm, tr, tag, df, pend)
