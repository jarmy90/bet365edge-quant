# Simulador offline del EA TM3_PF_OPTIMIZER v2.21 (Teoria Modular v6)
# Replica la logica del EA con datos M1 HistData SPX/USD (UTC).
# Notas de aproximacion (M1-only, sin ticks):
#  - CRUCE del trigger: dentro de la vela M1 se asume que se alcanza el nivel
#    si trig esta dentro de [low,high] (histdata no da secuencia intra-vela).
#  - AUTOCORTE (senteimiento pre-touch) y filtros TT (zvl/rer/irpl): en M1-only
#    se aproximan con las velocidades M1 de las 2-3 velas previas (proxy).
#  - Sesion: 09:30-11:00 America/New_York (con DST), como InpServerMinusET real.
# Uso: python tm3_sim.py [--cost 0.5] [--csv tm3_sim_trades.csv]

import argparse, math, sys
import numpy as np
import pandas as pd

try:
    import zoneinfo
    ET = zoneinfo.ZoneInfo("America/New_York")
except Exception:
    ET = None  # fallback: UTC fijo

NV = 20
MAXT_PAT = 120

# ---------- Variantes: replica exacta de InitVars ----------
# name, cap, slcap, obj, steps, filter, useft, fttp, ftsl, dynlot
def init_vars():
    V = []
    rows = [
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
        ("REC60_FT_STRICT", 60, 0, 1, 4, 3, True, 10, 10, False),
    ]
    for r in rows:
        V.append(dict(zip(
            ("name", "cap", "slcap", "obj", "steps", "filter", "useft", "fttp", "ftsl", "dynlot"), r),
            eq=0.0, peak=0.0, dd=0.0, gp=0.0, gl=0.0, lost=0.0, step=0,
            n=0, w=0, l=0, streak=0, maxstreak=0, skipped=0,
            seq=0, seqwin=0, seqfail=0, afterhours=0, has_open=False))
    return V

# ---------- Parametros EA (defaults) ----------
REWARD_MIN = 6.0
SL_MIN = 5.0
MAX_TRADE_BARS = 10      # InpMaxTradeSec=600 -> 10 velas M1
HORA_TRADE, MIN_TRADE = 9, 30
HORA_FIN, MIN_FIN = 11, 0
COMPLETAR_ESCALERA = True
FT256 = True
FRANJA = 3.0
COMISION_RT = 0.0        # comision round-trip por lote (ademas del cost de spread)

# Filtros TT (aprox en M1)
ZVL_TH, RER_TH, IRPL_TH, IIT_TH = 2.0, 0.35, 3.0, 0.20
LAMBDA = 0.30

def to_et(ts):
    ts = pd.Timestamp(ts)
    if ET is None:
        return ts
    return ts.tz_localize("UTC").tz_convert(ET).tz_localize(None)

def minute_et(ts):
    t = to_et(ts)
    return t.hour * 60 + t.minute

def in_trade(ts):
    m = minute_et(ts)
    return HORA_TRADE * 60 + MIN_TRADE <= m < HORA_FIN * 60 + MIN_FIN

def is_wd(ts):
    return to_et(ts).weekday() < 5

# ---------- Senal TT proxy (M1) ----------
def tt_signal(df, i, dirn):
    # usa velocidades M1 de las ultimas 3 velas previas y 3 velas alrededor del touch
    if i < 3:
        return False
    ref = df["close"].values[i-3:i] - df["open"].values[i-3:i]     # vandas previas
    sen = df["close"].values[i:i+3] - df["open"].values[i:i+3]     # velas del touch
    mv, sv = ref.mean(), ref.std(ddof=1) if len(ref) > 1 else 1e-9
    ml = sen.mean()
    zvl = (ml - mv) / (sv + 1e-12) * (1 if dirn > 0 else -1)
    # momentum senal vs referencia
    rer = (ml - mv) / (abs(mv) + abs(ml) + 1e-12) * (1 if dirn > 0 else -1)
    irpl = abs(sen[-1]) / (sen.std(ddof=1) + 1e-12) if len(sen) > 1 else 0
    ok_a = zvl > ZVL_TH
    ok_b = rer > RER_TH
    ok_c = irpl > IRPL_TH / 10  # proxy
    return int(ok_a) + int(ok_b) + int(ok_c) >= 2

def ft_signal(df, i, dirn, strict=False):
    # FT: replica FTFilter = rpcn>0 && iit>0 (proxy: continuacion en la misma direccion)
    c = df["close"].values
    cont = (c[i+1] - c[i]) * dirn if i + 1 < len(c) else 0
    ok = cont > 0
    if strict:
        ok = ok and cont > IIT_TH * df["atr"].values[i]
    return ok

# ---------- Carga de datos ----------
def load_m1(path):
    df = pd.read_csv(path, parse_dates=["time"])
    df = df[(df["time"].dt.weekday < 5)]
    df["atr"] = (df["high"] - df["low"]).rolling(20).mean()
    return df.reset_index(drop=True)

# ---------- Motor ----------
def run(df, cost, out_csv=None):
    V = init_vars()
    trades = []
    o, h, l, c = df["open"].values, df["high"].values, df["low"].values, df["close"].values
    times = df["time"].values
    atr = df["atr"].values
    n = len(df)

    def close_trade(vi, en, tp, sl, dirn, lot, kind, i_open, step_at_open, pid, sent_row):
        # resuelve la variante vi: busca TP o SL barra a barra (stop-first)
        for j in range(i_open + 1, min(i_open + MAX_TRADE_BARS + 1, n)):
            px_long = (l[j] <= sl, h[j] >= tp)
            hit_sl, hit_tp = px_long if dirn > 0 else (h[j] >= sl, l[j] <= tp)
            if hit_sl:
                pts = -abs(en - sl); why = "SL"
                pnl = pts * lot - cost * lot
                settle(vi, pnl, why, pid, kind, step_at_open, times[j])
                trades.append((vi, pid, kind, dirn, step_at_open, lot, en, sl, pts, pnl, why))
                return
            if hit_tp:
                pts = abs(tp - en); why = "TP"
                pnl = pts * lot - cost * lot
                settle(vi, pnl, why, pid, kind, step_at_open, times[j])
                trades.append((vi, pid, kind, dirn, step_at_open, lot, en, tp, pts, pnl, why))
                return
        # TIME: cierra a close de la ultima barra
        j = min(i_open + MAX_TRADE_BARS, n - 1)
        pts = dirn * (c[j] - en); why = "TIME"
        pnl = pts * lot - cost * lot
        settle(vi, pnl, why, pid, kind, step_at_open, times[j])
        trades.append((vi, pid, kind, dirn, step_at_open, lot, en, c[j], pts, pnl, why))

    def settle(vi, pnl, why, pid, kind, step_at_open, ts):
        v = V[vi]
        v["eq"] += pnl
        v["n"] += 1
        if pnl > 0:
            v["w"] += 1; v["gp"] += pnl; v["lost"] = 0.0; v["step"] = 0; v["streak"] = 0; v["seqwin"] += 1
        else:
            v["l"] += 1; v["gl"] += -pnl; v["lost"] += -pnl; v["streak"] += 1
            v["maxstreak"] = max(v["maxstreak"], v["streak"]); v["step"] += 1
            if v["step"] >= v["steps"]:
                v["seqfail"] += 1; v["step"] = 0; v["lost"] = 0.0
        v["peak"] = max(v["peak"], v["eq"])
        v["dd"] = max(v["dd"], v["peak"] - v["eq"])
        v["has_open"] = False

    def lot_for(vi, slpts):
        v = V[vi]
        lot = 0.01 * (v["step"] + 1)
        if v["dynlot"]:
            need = v["lost"] + v["obj"]
            lot = math.ceil(need / max(slpts, 1e-9) * 100) / 100.0
        lot = min(lot, 0.04)
        return max(0.01, math.floor(lot / 0.01 + 1e-9) * 0.01)

    def open_virtual(vi, kind, dirn, en, sl, tp_cap, obj, pid, i, step_at_open):
        v = V[vi]
        if v["has_open"]:
            return
        dist = abs(en - sl)
        lot = lot_for(vi, dist)
        need = v["lost"] + v["obj"] + COMISION_RT * lot
        pts = max(REWARD_MIN, need / max(lot, 1e-9))
        if kind == 0 and tp_cap is not None and pts > tp_cap:
            v["skipped"] += 1
            return
        tp = en + dirn * pts if kind == 0 else tp_cap
        v["has_open"] = True
        close_trade(vi, en, tp, sl, dirn, lot, kind, i, step_at_open, pid, None)

    pid = 0
    i = 0
    prev_i = -1
    patterns = []  # patrones activos por indice de barra
    # recorre velas; detecta patron en la vela i usando r[2] (i-1) y r[1] (i-2) como el EA (NewBar usa 3 velas)
    # En M1: patron formado con velas i-2 (dir/hi/lo) e i-3 (hi1/lo1), trigger en vela i-1+
    for i in range(4, n - MAX_TRADE_BARS):
        t = times[i]
        if not is_wd(t):
            continue
        m = minute_et(pd.Timestamp(t))
        # Patron: vela i-2 = r[2], vela i-3 = r[1]
        b2o, b2c, b2h, b2l = o[i-2], c[i-2], h[i-2], l[i-2]
        b3h, b3l = h[i-3], l[i-3]
        if b2c == b2o:
            continue
        dirn = 1 if b2c > b2o else -1
        A = (b2h - b3l) if dirn > 0 else (b3h - b2l)
        if A <= 0:
            continue
        trig = b2h if dirn > 0 else b2l
        sl = b3l if dirn > 0 else b3h
        if abs(trig - sl) < SL_MIN:
            sl = trig - dirn * SL_MIN
        risk = abs(trig - sl)
        armed = A >= risk and A >= REWARD_MIN
        if not armed:
            continue
        pid += 1
        # Touch en velas posteriores (cruce del trigger con low/high M1)
        for k in range(i, min(i + 60, n)):
            tk = times[k]
            if not is_wd(tk):
                break
            mk = minute_et(pd.Timestamp(tk))
            in_tr = HORA_TRADE*60+MIN_TRADE <= mk < HORA_FIN*60+MIN_FIN
            cont_ok = in_tr or (COMPLETAR_ESCALERA and any(v["step"] > 0 or v["lost"] > 1e-9 for v in V))
            if not cont_ok:
                break
            touched = (l[k] <= trig <= h[k])
            if not touched:
                continue
            en = trig  # entrada en el nivel
            if not in_tr:
                pass  # entrada fuera de hora solo si escalera pendiente (aprox: permitida si cont_ok)
            for vi in range(NV):
                v = V[vi]
                if v["has_open"]:
                    continue
                step0 = (v["step"] == 0 and v["lost"] <= 1e-9)
                if not in_tr and step0:
                    continue  # primera entrada solo en horario
                if kind0_filter(vi, df, k, dirn):
                    sl_v = sl
                    if V[vi]["slcap"] > 0 and abs(en - sl_v) > V[vi]["slcap"]:
                        sl_v = en - dirn * V[vi]["slcap"]
                    open_virtual(vi, 0, dirn, en, sl_v, V[vi]["cap"], V[vi]["obj"], pid, k, v["step"])
            # SL/TP patron -> FT
            slp = sl
            ft_done = False
            # resuelve el patron: SL o TP en barras siguientes
            for j in range(k + 1, min(k + 240, n)):
                hit_sl = l[j] <= slp if dirn > 0 else h[j] >= slp
                hit_tp = h[j] >= trig + dirn * A if dirn > 0 else l[j] <= trig - dirn * A
                if hit_sl:
                    ft_done = False
                    break
                if hit_tp:
                    ft_done = True
                    tp1 = trig + dirn * A
                    # Escalera FT: bandas cada FRANJA durante 2 minutos (2 velas M1 aprox -> k..k+2)
                    kend = min(j + 2, n - 1)
                    kk = 0
                    nextband = tp1
                    while kk < 60 and j + kk <= kend:
                        idx = j + kk
                        if h[idx] >= nextband if dirn > 0 else l[idx] <= nextband:
                            sdir = -dirn  # el EA abre contra la banda
                            for vi in range(NV):
                                v = V[vi]
                                if v["has_open"] or not v["useft"]:
                                    continue
                                if ft_signal(df, idx, sdir, strict=(vi == 19)):
                                    sl_ft = en_dummy = nextband - sdir * V[vi]["ftsl"]
                                    open_virtual(vi, 1, sdir, nextband, sl_ft,
                                                 nextband + sdir * V[vi]["fttp"], 0, pid, idx, v["step"])
                            kk += 1
                            nextband = tp1 + dirn * kk * FRANJA
                            continue
                        # FT256: solo patron 9:30
                        if FT256 and HORA_TRADE*60+MIN_TRADE <= minute_et(pd.Timestamp(times[j])) < HORA_TRADE*60+MIN_TRADE+1:
                            lv = trig + dirn * 2.56 * A
                            if (h[j] >= lv if dirn > 0 else l[j] <= lv):
                                for vi in range(NV):
                                    v = V[vi]
                                    if v["has_open"] or not v["useft"]:
                                        continue
                                    sdir = dirn
                                    if ft_signal(df, j, sdir, strict=(vi == 19)):
                                        open_virtual(vi, 2, sdir, lv, lv - sdir * V[vi]["ftsl"],
                                                     lv + sdir * V[vi]["fttp"], 0, pid, j, v["step"])
                        break
                    break
            break  # un patron = un touch

    return V, trades

def kind0_filter(vi, df, k, dirn):
    # kind==0 exige TTFilter; fuera de horario (escalera) el EA no exige TTFilter
    m = minute_et(df["time"].iloc[k])
    if not (HORA_TRADE*60+MIN_TRADE <= m < HORA_FIN*60+MIN_FIN):
        return True
    return tt_signal(df, k, dirn)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default="histdata_spx/spxusd_m1_all.csv")
    ap.add_argument("--cost", type=float, default=0.5)
    ap.add_argument("--out", default="tm3_sim_trades.csv")
    a = ap.parse_args()
    df = load_m1(a.csv)
    print(f"barras M1 = {len(df)}  {df.time.min()} -> {df.time.max()}")
    V, trades = run(df, a.cost)
    rows = []
    for v in V:
        pf = v["gp"] / v["gl"] if v["gl"] > 0 else float("inf")
        wr = 100.0 * v["w"] / v["n"] if v["n"] else 0
        rows.append(dict(name=v["name"], trades=v["n"], wins=v["w"], losses=v["l"],
                         winrate=round(wr, 1), gp=round(v["gp"], 2), gl=round(v["gl"], 2),
                         PF=round(pf, 3), net=round(v["eq"], 2), maxDD=round(v["dd"], 2),
                         max_streak=v["maxstreak"], skipped=v["skipped"], seqfail=v["seqfail"]))
    r = pd.DataFrame(rows).sort_values("net", ascending=False)
    print(r.to_string(index=False))
    r.to_csv("tm3_sim_resumen.csv", index=False)
    if trades:
        pd.DataFrame(trades, columns=["variant_idx", "pattern", "kind", "dir", "step", "lot",
                                      "entry", "exit", "points", "pnl", "reason"]).to_csv(a.out, index=False)
    print(f"\nresumen -> tm3_sim_resumen.csv | trades -> {a.out}")

if __name__ == "__main__":
    main()
