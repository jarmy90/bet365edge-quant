# Backtesting motor fiel a TM_NQ_M1_MARTINGALE_EXPLORER_v1_02_COMPILE_FIX.mq5
# Ejecuta sobre HistData NSX/USD M1 (Nasdaq 100 = USTEC / NQ)
# Horario ET: 09:30 a 11:00 ET (con 09:29 para armado previo de datos)
# Simula las 20 variantes (V0 a V19) con ejecuciÃ³n a nivel M1 (OHLC intra-vela)
# Genera los 3 CSVs: Resumen, Trades y Eventos
import os
import math
import numpy as np
import pandas as pd

BASE = os.path.dirname(os.path.abspath(__file__))
M1_PATH = os.path.join(BASE, "..", "ustec_speed", "histdata_ustec", "nsxusd_m1_all.csv")

# Parametros base del EA
InpValorPuntoPorLote = 20.0  # NQ futuro estÃ¡ndar (20 USD/punto por lote)
InpComisionRT_Lote = 0.0
InpSlippagePts = 0.25
InpMinRewardPts = 6.0
InpMinSLPts = 5.0
InpMaxSpreadPts = 2.0
InpMaxSegundosTrade = 600  # 10 velas M1
InpCapitalInicialVirtual = 10000.0
InpLoteBase = 0.01
InpLoteMax = 0.04

# Variables TT
InpZVL = 2.0
InpRER = 0.35
InpIRPL = 3.0

# Variables FT
InpZSF = 1.50
InpRPCN = 0.0
InpIIT = 0.20
InpFranjaPts = 3.0
InpFT_TP_Pts = 10.0
InpFT_SL_Pts = 10.0
InpActivarFT256 = True

# Variables TT (parametros finos) y FT
InpRefSeconds = 60
InpSenTTSeconds = 2
InpSenFTSeconds = 3
InpMinTicksRef = 30
InpMinTicksSen = 3
InpLambda_ = 0.30
InpRegularizacion = 1e-8

# Definicion de variantes (0 a 19)
# lot_mode: 0 fija; 1 lineal; 2 suave; 3 recup dinero; 4 anti; 5 reset parcial
# tp_mode: 0 modular; 1 recovery; 2 fixed; 3 RR; 4 ATR-like A
# sl_mode: 0 estructural; 1 fijo; 2 A; 3 reducido; 4 seguridad
# filter_mode: 0 geometria; 1 3 vars; 2 2de3; 3 score; 4 solo velocidad
VARIANTS_DEF = [
    {"name": "Fija_Geometrica", "lm": 0, "tm": 0, "sm": 0, "fm": 0, "ftp": 0, "fsl": 0, "rr": 1.0, "money": 0, "maxs": 1, "ft": False},
    {"name": "Lineal_001_004_Modular", "lm": 1, "tm": 0, "sm": 0, "fm": 0, "ftp": 0, "fsl": 0, "rr": 1.0, "money": 0, "maxs": 4, "ft": False},
    {"name": "Lineal_3Vars_Modular", "lm": 1, "tm": 0, "sm": 0, "fm": 1, "ftp": 0, "fsl": 0, "rr": 1.0, "money": 0, "maxs": 4, "ft": False},
    {"name": "Lineal_2de3_Modular", "lm": 1, "tm": 0, "sm": 0, "fm": 2, "ftp": 0, "fsl": 0, "rr": 1.0, "money": 0, "maxs": 4, "ft": False},
    {"name": "Lineal_Score_Modular", "lm": 1, "tm": 0, "sm": 0, "fm": 3, "ftp": 0, "fsl": 0, "rr": 1.0, "money": 0, "maxs": 4, "ft": False},
    {"name": "Lineal_Velocidad_Modular", "lm": 1, "tm": 0, "sm": 0, "fm": 4, "ftp": 0, "fsl": 0, "rr": 1.0, "money": 0, "maxs": 4, "ft": False},
    {"name": "Lineal_RecuperacionEUR", "lm": 1, "tm": 1, "sm": 0, "fm": 2, "ftp": 0, "fsl": 0, "rr": 1.0, "money": 10.0, "maxs": 4, "ft": False},
    {"name": "LoteRecuperacion_Dinero", "lm": 3, "tm": 0, "sm": 0, "fm": 2, "ftp": 0, "fsl": 0, "rr": 1.0, "money": 10.0, "maxs": 4, "ft": False},
    {"name": "Suave_001_0015_002_003", "lm": 2, "tm": 0, "sm": 0, "fm": 2, "ftp": 0, "fsl": 0, "rr": 1.0, "money": 0, "maxs": 4, "ft": False},
    {"name": "ResetParcial_Modular", "lm": 5, "tm": 0, "sm": 0, "fm": 2, "ftp": 0, "fsl": 0, "rr": 1.0, "money": 0, "maxs": 4, "ft": False},
    {"name": "AntiMartingala_Modular", "lm": 4, "tm": 0, "sm": 0, "fm": 2, "ftp": 0, "fsl": 0, "rr": 1.0, "money": 0, "maxs": 4, "ft": False},
    {"name": "Lineal_TP10_SL10", "lm": 1, "tm": 2, "sm": 1, "fm": 2, "ftp": 10.0, "fsl": 10.0, "rr": 1.0, "money": 0, "maxs": 4, "ft": False},
    {"name": "Lineal_TP15_SL10", "lm": 1, "tm": 2, "sm": 1, "fm": 2, "ftp": 15.0, "fsl": 10.0, "rr": 1.0, "money": 0, "maxs": 4, "ft": False},
    {"name": "Lineal_RR1", "lm": 1, "tm": 3, "sm": 0, "fm": 2, "ftp": 0, "fsl": 0, "rr": 1.0, "money": 0, "maxs": 4, "ft": False},
    {"name": "Lineal_RR125", "lm": 1, "tm": 3, "sm": 0, "fm": 2, "ftp": 0, "fsl": 0, "rr": 1.25, "money": 0, "maxs": 4, "ft": False},
    {"name": "Lineal_RR15", "lm": 1, "tm": 3, "sm": 0, "fm": 2, "ftp": 0, "fsl": 0, "rr": 1.5, "money": 0, "maxs": 4, "ft": False},
    {"name": "Lineal_SL075A_TP_A", "lm": 1, "tm": 0, "sm": 3, "fm": 2, "ftp": 0, "fsl": 0, "rr": 1.0, "money": 0, "maxs": 4, "ft": False},
    {"name": "Lineal_TT_y_FT_3Vars", "lm": 1, "tm": 0, "sm": 0, "fm": 1, "ftp": 0, "fsl": 0, "rr": 1.0, "money": 0, "maxs": 4, "ft": True},
    {"name": "Recuperacion_TT_y_FT", "lm": 3, "tm": 1, "sm": 4, "fm": 2, "ftp": 0, "fsl": 0, "rr": 1.0, "money": 10.0, "maxs": 4, "ft": True},
    {"name": "Fija_TT_y_FT_Score", "lm": 0, "tm": 0, "sm": 0, "fm": 3, "ftp": 0, "fsl": 0, "rr": 1.0, "money": 0, "maxs": 1, "ft": True},
]

def get_lot(v_idx, slpts, var_state):
    v = VARIANTS_DEF[v_idx]
    lm = v["lm"]
    step = var_state["step"]
    lot = InpLoteBase
    if lm == 1:
        lot = InpLoteBase * (step + 1)
    elif lm == 2:
        seq = [0.01, 0.015, 0.02, 0.03]
        lot = seq[min(step, 3)]
    elif lm == 3:
        need = var_state["lost_money"] + v["money"]
        val = max(slpts * InpValorPuntoPorLote, 0.01)
        lot = math.ceil((need / val) * 100.0) / 100.0
    elif lm == 4:
        lot = InpLoteBase * (step + 1)
    elif lm == 5:
        seq2 = [0.01, 0.02, 0.03, 0.02]
        lot = seq2[min(step, 3)]
    lot = min(lot, InpLoteMax)
    lot = max(0.01, math.floor(lot / 0.01 + 1e-9) * 0.01)
    return round(lot, 2)

def get_prices(v_idx, p, entry, var_state):
    v = VARIANTS_DEF[v_idx]
    sl = p["sl"]
    if v["sm"] == 1:
        sl = entry - p["dir"] * v["fsl"]
    elif v["sm"] == 2:
        sl = entry - p["dir"] * p["agrande"]
    elif v["sm"] == 3:
        sl = entry - p["dir"] * max(InpMinSLPts, p["agrande"] * 0.75)
    elif v["sm"] == 4:
        sl = entry - p["dir"] * max(InpMinSLPts, min(p["risk"], p["agrande"]))

    risk = abs(entry - sl)
    tp = entry + p["dir"] * p["agrande"]

    if v["tm"] == 1:
        lot = get_lot(v_idx, risk, var_state)
        need = var_state["lost_money"] + v["money"] + InpComisionRT_Lote * lot
        pts = need / max(lot * InpValorPuntoPorLote, 0.01)
        tp = entry + p["dir"] * max(InpMinRewardPts, pts)
    elif v["tm"] == 2:
        tp = entry + p["dir"] * v["ftp"]
    elif v["tm"] == 3:
        tp = entry + p["dir"] * risk * v["rr"]
    elif v["tm"] == 4:
        tp = entry + p["dir"] * p["agrande"]
    return round(tp, 2), round(sl, 2)


# ------------------------- MOTOR -------------------------
class Engine:
    """Replica tick-a-tick del EA: sentimiento sobre ticks, patrones geometricos,
    20 variantes virtuales, FT por franjas y FT 2.56."""

    MAX_PATTERNS = 300
    MAX_VTRADES = 1000
    MAX_TICKS = 20000

    def __init__(self, fix_patterns=False, fix_vtrades=False, spread_pts=1.0):
        self.fixp = fix_patterns
        self.fixv = fix_vtrades
        self.spread = spread_pts
        self.tk_t, self.tk_b, self.tk_a, self.tk_p = [], [], [], []
        self.pats = []
        self.vt = []
        self.n_open_total = 0
        self.next_pid = 1
        self.state = [self._new_state() for _ in VARIANTS_DEF]
        self.trades_rows, self.events_rows = [], []
        self.prev_ask = self.prev_bid = 0.0
        self.pending, self.active_idx, self.ft_watch, self.ft_open = [], [], [], []
        self.et_min = 0

    def _new_state(self):
        return dict(equity=InpCapitalInicialVirtual, peak=InpCapitalInicialVirtual,
                    maxdd=0.0, gross_profit=0.0, gross_loss=0.0, lost_money=0.0,
                    step=0, trades=0, wins=0, losses=0, max_consec_loss=0, consec_loss=0)

    # ---- ticks ----
    def add_tick(self, tmsc, bid, ask):
        self.tk_t.append(tmsc)
        self.tk_b.append(bid)
        self.tk_a.append(ask)
        self.tk_p.append((bid + ask) * 0.5)
        if len(self.tk_t) > self.MAX_TICKS:
            self.tk_t.pop(0); self.tk_b.pop(0); self.tk_a.pop(0); self.tk_p.pop(0)
        cut = tmsc - (InpRefSeconds + 5) * 1000
        first = 0
        while first < len(self.tk_t) and self.tk_t[first] < cut:
            first += 1
        if first > 0:
            del self.tk_t[:first]; del self.tk_b[:first]
            del self.tk_a[:first]; del self.tk_p[:first]

    def _series(self, seconds):
        n = len(self.tk_t)
        if n < 3:
            return None, None
        cut = self.tk_t[n - 1] - seconds * 1000
        st = 0
        while st < n and self.tk_t[st] < cut:
            st += 1
        if st + 1 >= n:
            return None, None
        t = np.asarray(self.tk_t[st:], dtype=float)
        p = np.asarray(self.tk_p[st:], dtype=float)
        dt = np.diff(t) / 1000.0
        dt[dt < 0.001] = 0.001
        v = np.diff(p) / dt
        a = np.empty(len(v))
        a[0] = 0.0
        a[1:] = np.diff(v) / dt[1:]
        return v, a

    @staticmethod
    def _entropy(plus, minus):
        n = plus + minus
        if n <= 0:
            return 0.0
        h = 0.0
        for c in (plus, minus):
            if c > 0:
                q = c / n
                h -= q * math.log(q) / math.log(2.0)
        return h

    def sent_tt(self, direction):
        vr, ar = self._series(InpRefSeconds)
        vs, as_ = self._series(2)  # InpSenTTSeconds
        if vr is None or vs is None or len(vr) < 30 or len(vs) < 3:
            return None
        mv, mv_s = vr.mean(), vr.var(ddof=1) if len(vr) > 1 else 0.0
        ma, va = ar.mean(), ar.var(ddof=1) if len(ar) > 1 else 0.0
        sv = math.sqrt(max(mv_s, 0.0))
        zvl = (vs.mean() - mv) / (sv + 1e-12)
        pr = int((vr > 0).sum()); mr = int((vr < 0).sum())
        ps = int((vs > 0).sum()); ms = int((vs < 0).sum())
        href = self._entropy(pr, mr); hsen = self._entropy(ps, ms)
        idx = max(0, len(self.tk_p) - len(vs) - 1)
        dp = self.tk_p[-1] - self.tk_p[idx]
        rer = ((href - hsen) / (href + 1e-12)) * (1 if dp > 0 else (-1 if dp < 0 else 0))
        w = np.exp(InpLambda_ * (np.arange(1, len(vs) + 1)))
        sw = w.sum()
        wv = float((w * vs).sum() / sw); wa = float((w * as_).sum() / sw)
        cov = float(((vr - mv) * (ar - ma)).sum() / (len(vr) - 1 if len(vr) > 1 else 1))
        aa = mv_s + InpRegularizacion; cc = va + InpRegularizacion
        det = aa * cc - cov * cov
        if det <= InpRegularizacion * InpRegularizacion:
            return None
        d1 = wv - mv; d2 = wa - ma
        q = d1 * d1 * (cc / det) + 2 * d1 * d2 * (-cov / det) + d2 * d2 * (aa / det)
        irpl = math.sqrt(max(q, 0.0))
        return dict(zvl=zvl, rer=rer, irpl=irpl, vmean=wv, amean=wa, valid=True)

    def sent_ft(self, direction):
        vr, ar = self._series(InpRefSeconds)
        vs, as_ = self._series(3)  # InpSenFTSeconds
        if vr is None or vs is None or len(vr) < 30 or len(vs) < 3:
            return None
        mv = vr.mean(); sv = math.sqrt(max(vr.var(ddof=1), 0.0)); ml = vs.mean()
        zsf = (direction * mv - direction * ml) / (sv + 1e-12)
        ip = float(np.abs(vs[vs * direction > 0]).sum())
        im = float(np.abs(vs[vs * direction < 0]).sum())
        phi = (im - ip) / (im + ip + 1e-12)
        scale = max(abs(mv) + sv, 1e-12)
        rpcn = phi * (im + ip) / len(vs) / scale
        en = abs(vs.sum()) / (np.abs(vs).sum() + 1e-12)
        er = abs(vr.sum()) / (np.abs(vr).sum() + 1e-12)
        return dict(zsf=zsf, rpcn=rpcn, iit=er - en, valid=True)

    @staticmethod
    def filter_ok(vi, s, direction):
        if s is None:
            return False
        a = direction * s["zvl"] > InpZVL
        b = direction * s["rer"] > InpRER
        c = s["irpl"] > InpIRPL and direction * s["vmean"] > 0
        k = int(a) + int(b) + int(c)
        fm = VARIANTS_DEF[vi]["fm"]
        if fm == 0:
            return True
        if fm == 1:
            return k == 3
        if fm == 2:
            return k >= 2
        if fm == 3:
            sc = (max(0.0, direction * s["zvl"] / InpZVL)
                  + max(0.0, direction * s["rer"] / InpRER)
                  + max(0.0, s["irpl"] / InpIRPL))
            return sc >= 3.0
        return a

    # ---- patrones ----
    def new_closed_bar(self, bar_n, bar_n1):
        """bar_n = r[2] (cerrada anterior), bar_n1 = r[1] (recien cerrada)."""
        if len(self.pats) >= self.MAX_PATTERNS:
            if not self.fixp:
                return
            self.pats = [p for p in self.pats if not p["resolved"]]
            if len(self.pats) >= self.MAX_PATTERNS:
                return
        if bar_n["close"] == bar_n["open"]:
            return
        d = 1 if bar_n["close"] > bar_n["open"] else -1
        ag = (bar_n["high"] - bar_n1["low"]) if d > 0 else (bar_n1["high"] - bar_n["low"])
        if ag <= 0:
            return
        trig = bar_n["high"] if d > 0 else bar_n["low"]
        sl = bar_n1["low"] if d > 0 else bar_n1["high"]
        if abs(trig - sl) < InpMinSLPts:
            sl = trig - d * InpMinSLPts
        risk = abs(trig - sl)
        p = dict(id=self.next_pid, dir=d, agrande=ag, trigger=trig, sl=sl,
                 risk=risk, reward=ag, tp=trig + d * ag,
                 armed=(ag >= risk and ag >= InpMinRewardPts),
                 triggered=False, resolved=False, ft_started=False,
                 ft_k=0, next_ft_level=0.0, ft_end_time=0, is930=bar_n1["et930"],
                 ft256_done=False, s=None)
        self.next_pid += 1
        self.pats.append(p)
        self.events_rows.append([bar_n1["ts"], p["id"], "ARM", d, trig, ag, sl, p["tp"], risk, ag, 0, 0, 0])

    def check_patterns(self, tmsc, bid, ask, sp_pts):
        if not (InpStartTradeMin <= self.et_min < InpEndMin):
            return
        if sp_pts > InpMaxSpreadPts:
            return
        for p in self.pending:
            if not p["armed"] or p["triggered"] or p["resolved"]:
                continue
            cross = (self.prev_ask < p["trigger"] <= ask) if p["dir"] > 0 else (self.prev_bid > p["trigger"] >= bid)
            if not cross:
                continue
            p["s"] = self.sent_tt(p["dir"])
            p["triggered"] = True
            s = p["s"] or dict(zvl=0, rer=0, irpl=0)
            self.events_rows.append([tmsc, p["id"], "AUTOCORTE", p["dir"], p["trigger"],
                                     p["agrande"], p["sl"], p["tp"], p["risk"], p["reward"],
                                     s["zvl"], s["rer"], s["irpl"]])
            for v in range(len(VARIANTS_DEF)):
                self.open_virtual(v, p, 0, None, ask, bid, tmsc)

    # ---- operaciones virtuales ----
    def open_virtual(self, vi, p, kind, sf, ask, bid, tmsc):
        if kind == 0 and not self.filter_ok(vi, p["s"], p["dir"]):
            return
        if kind > 0 and not VARIANTS_DEF[vi]["ft"]:
            return
        if len(self.vt) >= self.MAX_VTRADES:
            if not self.fixv:
                return
            self.vt = [x for x in self.vt if x["active"]]
            if len(self.vt) >= self.MAX_VTRADES:
                return
        st = self.state[vi]
        d = p["dir"] if kind == 0 else -p["dir"]
        entry = ask if d > 0 else bid
        if kind == 0:
            tp, sl = get_prices(vi, p, entry, st)
        else:
            tp, sl = entry + d * InpFT_TP_Pts, entry - d * InpFT_SL_Pts
        lot = get_lot(vi, abs(entry - sl), st)
        s = p["s"] or {}
        self.vt.append(dict(active=True, variant=vi, pattern=p["id"], dir=d, kind=kind,
                            step=st["step"], entry=entry, tp=round(tp, 2), sl=round(sl, 2),
                            lot=lot, opentime=tmsc,
                            zvl=s.get("zvl", 0), rer=s.get("rer", 0), irpl=s.get("irpl", 0),
                            zsf=(sf or {}).get("zsf", 0), rpcn=(sf or {}).get("rpcn", 0),
                            iit=(sf or {}).get("iit", 0)))
        self.n_open_total += 1

    def close_virtual(self, idx, exitp, reason, tmsc):
        x = self.vt[idx]
        if not x["active"]:
            return
        st = self.state[x["variant"]]
        pts = x["dir"] * (exitp - x["entry"])
        pnl = pts * InpValorPuntoPorLote * x["lot"] - InpComisionRT_Lote * x["lot"]
        st["equity"] += pnl
        st["trades"] += 1
        v = VARIANTS_DEF[x["variant"]]
        if pnl >= 0:
            st["wins"] += 1
            st["gross_profit"] += pnl
            st["consec_loss"] = 0
            st["lost_money"] = 0.0
            st["step"] = min(st["step"] + 1, v["maxs"] - 1) if v["lm"] == 4 else 0
        else:
            st["losses"] += 1
            st["gross_loss"] += -pnl
            st["lost_money"] += -pnl
            st["consec_loss"] += 1
            st["max_consec_loss"] = max(st["max_consec_loss"], st["consec_loss"])
            if v["lm"] == 4:
                st["step"] = 0
            else:
                st["step"] += 1
                if st["step"] >= v["maxs"]:
                    st["step"] = 0
        st["peak"] = max(st["peak"], st["equity"])
        st["maxdd"] = max(st["maxdd"], st["peak"] - st["equity"])
        self.trades_rows.append([x["opentime"], tmsc, x["variant"], v["name"], x["pattern"],
                                 x["kind"], x["dir"], x["step"], x["lot"], x["entry"], exitp,
                                 x["tp"], x["sl"], round(pts, 2), round(pnl, 2), reason,
                                 x["zvl"], x["rer"], x["irpl"], x["zsf"], x["rpcn"], x["iit"],
                                 round(st["equity"], 2)])
        x["active"] = False

    def manage_virtuals(self, tmsc, bid, ask):
        for i in self.active_idx:
            x = self.vt[i]
            if not x["active"]:
                continue
            px = bid if x["dir"] > 0 else ask
            hit_tp = px >= x["tp"] if x["dir"] > 0 else px <= x["tp"]
            hit_sl = px <= x["sl"] if x["dir"] > 0 else px >= x["sl"]
            if hit_sl:
                self.close_virtual(i, x["sl"], "SL", tmsc)
            elif hit_tp:
                self.close_virtual(i, x["tp"], "TP", tmsc)
            elif (tmsc - x["opentime"]) >= InpMaxSegundosTrade * 1000:
                self.close_virtual(i, px, "TIME", tmsc)

    # ---- resultados de patron y franjas FT ----
    def check_outcomes_ft(self, tmsc, bid, ask):
        for p in self.ft_watch:
            if not p["triggered"] or p["resolved"]:
                continue
            px = bid if p["dir"] > 0 else ask
            hit_tp = px >= p["tp"] if p["dir"] > 0 else px <= p["tp"]
            hit_sl = px <= p["sl"] if p["dir"] > 0 else px >= p["sl"]
            if hit_sl:
                p["resolved"] = True
            elif hit_tp:
                p["resolved"] = True
                p["ft_started"] = True
                p["ft_k"] = 0
                p["next_ft_level"] = p["tp"]
                p["ft_end_time"] = tmsc + 120 * 1000
                if p not in self.ft_open:
                    self.ft_open.append(p)

    def check_ft_levels(self, tmsc, bid, ask):
        for p in self.ft_open:
            if not p["ft_started"]:
                continue
            if tmsc >= p["ft_end_time"]:
                p["ft_started"] = False
                continue
            px = bid if p["dir"] > 0 else ask
            touch = px >= p["next_ft_level"] if p["dir"] > 0 else px <= p["next_ft_level"]
            guard = 0
            while touch and p["ft_k"] < 100 and guard < 100:
                guard += 1
                sf = self.sent_ft(p["dir"])
                s = sf or dict(zsf=0, rpcn=0, iit=0)
                self.events_rows.append([tmsc, p["id"], "FT_FRANJA_" + str(p["ft_k"]), p["dir"],
                                         p["next_ft_level"], p["agrande"], p["sl"], p["tp"],
                                         p["risk"], p["reward"], s["zsf"], s["rpcn"], s["iit"]])
                for v in range(len(VARIANTS_DEF)):
                    if VARIANTS_DEF[v]["ft"]:
                        self.open_virtual(v, p, 1, sf, ask, bid, tmsc)
                p["ft_k"] += 1
                p["next_ft_level"] = p["tp"] + p["dir"] * p["ft_k"] * InpFranjaPts
                touch = px >= p["next_ft_level"] if p["dir"] > 0 else px <= p["next_ft_level"]
            if InpActivarFT256 and p["is930"] and not p["ft256_done"]:
                lv = p["trigger"] + p["dir"] * 2.56 * p["agrande"]
                hit = px >= lv if p["dir"] > 0 else px <= lv
                if hit:
                    sf256 = self.sent_ft(p["dir"])
                    for v in range(len(VARIANTS_DEF)):
                        if VARIANTS_DEF[v]["ft"]:
                            self.open_virtual(v, p, 2, sf256, ask, bid, tmsc)
                    p["ft256_done"] = True


# ------------------- parametros de sesion (ET) -------------------
InpStartDataMin = 9 * 60 + 29
InpStartTradeMin = 9 * 60 + 30
InpEndMin = 11 * 60
TICKS_PER_BAR = 60


def synth_ticks(o, h, l, c, t0_ms, spread):
    """Camino intravela O->(L|H)->(H|L)->C con TICKS_PER_BAR ticks de 1s."""
    if c > o:
        wps = [o, l, h, c]
    elif c < o:
        wps = [o, h, l, c]
    else:
        wps = [o, h, l, c]
    seg = TICKS_PER_BAR // (len(wps) - 1)
    out = []
    k = 0
    for s in range(len(wps) - 1):
        a, b = wps[s], wps[s + 1]
        for j in range(seg):
            frac = j / seg
            bid = a + (b - a) * frac
            out.append((t0_ms + k * 1000, bid, bid + spread))
            k += 1
    bid = wps[-1]
    out.append((t0_ms + k * 1000, bid, bid + spread))
    return out


def run(csv_path, spread, fix_patterns=False, fix_vtrades=False, et=None):
    from zoneinfo import ZoneInfo
    ny = ZoneInfo("America/New_York")
    df = pd.read_csv(csv_path)
    df["time"] = pd.to_datetime(df["time"])
    df["ny"] = df["time"].dt.tz_localize("UTC").dt.tz_convert(ny)
    og, hg, lg, cg = (df[x].values for x in ("open", "high", "low", "close"))
    tsg = df["time"].values
    etmin = (df["ny"].dt.hour * 60 + df["ny"].dt.minute).values
    et930 = ((df["ny"].dt.hour == 9) & (df["ny"].dt.minute == 30)).values
    eng = Engine(fix_patterns, fix_vtrades, spread)
    n = len(df)
    for i in range(2, n):
        bar_n = dict(open=og[i - 2], high=hg[i - 2], low=lg[i - 2], close=cg[i - 2],
                     ts=tsg[i - 2], et930=et930[i - 2])
        bar_n1 = dict(open=og[i - 1], high=hg[i - 1], low=lg[i - 1], close=cg[i - 1],
                      ts=tsg[i - 1], et930=et930[i - 1])
        eng.new_closed_bar(bar_n, bar_n1)
        eng.pending = [p for p in eng.pats
                       if p["armed"] and not p["triggered"] and not p["resolved"]]
        eng.active_idx = [j for j, x in enumerate(eng.vt) if x["active"]]
        eng.ft_watch = [p for p in eng.pats if p["triggered"] and not p["resolved"]]
        eng.ft_open = [p for p in eng.pats if p["ft_started"]]
        if not (InpStartDataMin <= etmin[i] < InpEndMin):
            continue
        t0 = int(pd.Timestamp(tsg[i]).timestamp() * 1000)
        k = 0
        for tmsc, bid, ask in synth_ticks(og[i], hg[i], lg[i], cg[i], t0, spread):
            eng.et_min = (int(etmin[i]) + k) % 1440
            k += 1
            eng.add_tick(tmsc, bid, ask)
            eng.check_patterns(tmsc, bid, ask, spread)
            eng.manage_virtuals(tmsc, bid, ask)
            eng.check_outcomes_ft(tmsc, bid, ask)
            eng.check_ft_levels(tmsc, bid, ask)
            eng.prev_ask, eng.prev_bid = ask, bid
    return eng, df



def write_csvs(eng, tag):
    tr = pd.DataFrame(eng.trades_rows, columns=[
        "open", "close", "variant", "name", "pattern", "kind", "dir", "step", "lot",
        "entry", "exit", "tp", "sl", "points", "pnl", "reason",
        "ZVL", "RER", "IRPL", "ZSF", "RPCN", "IIT", "equity"])
    ev = pd.DataFrame(eng.events_rows, columns=[
        "timestamp", "pattern", "event", "dir", "trigger", "A_grande", "sl", "tp",
        "risk", "reward", "ZVL", "RER", "IRPL"])
    rows = []
    for i, v in enumerate(VARIANTS_DEF):
        st = eng.state[i]
        pf = st["gross_profit"] / st["gross_loss"] if st["gross_loss"] > 0 else 0.0
        wr = 100.0 * st["wins"] / st["trades"] if st["trades"] else 0.0
        rows.append(dict(variant=i, name=v["name"], trades=st["trades"], wins=st["wins"],
                         losses=st["losses"], winrate=round(wr, 2),
                         gross_profit=round(st["gross_profit"], 2),
                         gross_loss=round(st["gross_loss"], 2), profit_factor=round(pf, 3),
                         equity=round(st["equity"], 2), net=round(st["equity"] - InpCapitalInicialVirtual, 2),
                         maxdd=round(st["maxdd"], 2), max_losing_streak=st["max_consec_loss"],
                         next_step=st["step"], unrecovered_loss=round(st["lost_money"], 2)))
    sm = pd.DataFrame(rows)
    tr.to_csv(os.path.join(BASE, f"TM_Explorer_Trades_{tag}.csv"), index=False, sep=";")
    ev.to_csv(os.path.join(BASE, f"TM_Explorer_Eventos_{tag}.csv"), index=False, sep=";")
    sm.to_csv(os.path.join(BASE, f"TM_Explorer_Resumen_{tag}.csv"), index=False, sep=";")
    return sm, tr, ev


def report(sm, tr, tag, npat, nopen):
    print("=" * 110)
    print(f"{tag}: patrones creados={npat} operaciones abiertas={nopen} trades cerrados={len(tr)}")
    print("=" * 110)
    print(sm[["variant", "name", "trades", "winrate", "net", "maxdd",
              "max_losing_streak", "profit_factor"]].to_string(index=False))
    if len(tr):
        print("\n-- por variante y motivo --")
        print(tr.groupby(["variant", "reason"]).pnl.agg(["count", "sum", "mean"]).round(2).to_string())
        print("\n-- por kind (0=TT trigger, 1=FT franja, 2=FT256) --")
        print(tr.groupby("kind").pnl.agg(["count", "sum", "mean"]).round(2).to_string())


if __name__ == "__main__":
    import sys
    spread = float(sys.argv[1]) if len(sys.argv) > 1 else 1.0
    fixp = "--fixp" in sys.argv
    fixv = "--fixv" in sys.argv
    tag = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith("--") else ("fix" if (fixp or fixv) else "fiel")
    csv = M1_PATH
    for a in sys.argv[3:]:
        if a.startswith("--csv="):
            csv = a.split("=", 1)[1]
    import time as _t
    t0 = _t.time()
    eng, df = run(csv, spread, fixp, fixv)
    sm, tr, ev = write_csvs(eng, tag)
    print(f"tiempo={_t.time() - t0:.1f}s  barras={len(df)}")
    report(sm, tr, tag, len(eng.pats), eng.n_open_total)


