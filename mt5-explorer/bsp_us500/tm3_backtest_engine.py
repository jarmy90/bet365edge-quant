# TM3 Backtest Engine v2 — motor causal M1 sin look-ahead
# Reproduce la geometria del EA TM3 v2.21 FAST TICK con datos M1 HistData.
#
# Principios:
#  - MODO M1_GEOMETRY_ONLY: no inventa microestructura de 2-3 s. Los filtros ZVL/RER/IRPL
#    de tick NO se calculan (requieren tm3_tick_sim.py con ticks reales). Sin filtro de senal.
#  - Barras ambiguas (trigger+SL o SL+TP en la misma vela) se marcan intrabar_ambiguous y se
#    resuelven en 3 escenarios: CONSERVATIVE (peor resultado primero), OPTIMISTIC (mejor
#    primero), RANDOM_BRIDGE (>=1000 trayectorias Brownian bridge condicionadas, semilla fija).
#  - Politicas TIME (independientes, no mezcladas): LEGACY, STRICT_RECOVERY,
#    CONTINUE_AFTER_TIME, NO_TIME.
#  - Economia: VPT en 3 modos (BROKER_SPEC via JSON, FIXED_VPT, PRICE_POINTS_ONLY).
#    PnL monetario solo si hay spec real; por defecto PRICE_POINTS_ONLY.
#  - Secuencia de escalera: sequence_id, sequence_pnl acumulado; ganada solo si
#    pnl_acumulado >= objetivo monetario de la secuencia.
#  - Sin look-ahead: cada decision usa solo velas <= la actual.

import argparse, json, math, os, sys
import numpy as np
import pandas as pd

try:
    import zoneinfo
    ET = zoneinfo.ZoneInfo("America/New_York")
except Exception:
    ET = None

DATA_DEFAULT = os.path.join("histdata_spx", "spxusd_m1_all.csv")
SYMBOL_SPEC_FILE = "SYMBOL_SPEC.json"

# ------------------------- utilidades tiempo -------------------------
def to_et(ts):
    ts = pd.Timestamp(ts)
    if ET is None:
        return ts
    return ts.tz_localize("UTC").tz_convert(ET).tz_localize(None)

def minute_et(ts):
    t = to_et(ts)
    return t.hour * 60 + t.minute

# ------------------------- carga datos -------------------------
def load_m1(path=DATA_DEFAULT):
    df = pd.read_csv(path, parse_dates=["time"])
    df = df.sort_values("time").reset_index(drop=True)
    df["dow"] = df["time"].dt.weekday
    df["min_et"] = [minute_et(t) for t in df["time"]]
    df["date_et"] = [to_et(t).date() for t in df["time"]]
    return df

# ------------------------- geometria de patrones (precomputo) -------------------------
def build_patterns(df, sl_min=5.0, reward_min=6.0, sess_end=660):
    """Detecta patrones TT como el EA: vela n (i-2) y n-1 (i-3) al cierre de vela i-1.
    Devuelve DataFrame de patrones con trigger/sl/A y barra de armado."""
    o, h, l, c = df["open"].values, df["high"].values, df["low"].values, df["close"].values
    rows = []
    n = len(df)
    for i in range(2, n):
        # r[2]=i-1? No: EA usa r[2]=vela cerrada anterior (n), r[1]=n-1. Tras cierre de vela j,
        # n=j-1 y n-1=j-2. Aqui j=i: n=i-1, n-1=i-2.
        b2o, b2c, b2h, b2l = o[i-1], c[i-1], h[i-1], l[i-1]  # vela n
        b3h, b3l = h[i-2], l[i-2]                              # vela n-1
        if b2c == b2o:
            continue
        dirn = 1 if b2c > b2o else -1
        A = (b2h - b3l) if dirn > 0 else (b3h - b2l)
        if A <= 0:
            continue
        trig = b2h if dirn > 0 else b2l
        sl = b3l if dirn > 0 else b3h
        if abs(trig - sl) < sl_min:
            sl = trig - dirn * sl_min
        risk = abs(trig - sl)
        if not (A >= risk and A >= reward_min):
            continue
        # el patron solo se busca durante la sesion (horario de la vela de armado)
        m = df["min_et"].values[i-1]
        if m > sess_end:
            continue
        rows.append((i, i-1, i-2, dirn, A, trig, sl, risk))
    return pd.DataFrame(rows, columns=["arm_bar", "n_bar", "n1_bar", "dir", "A", "trig", "sl", "risk"])

# ------------------------- resolucion de trade en velas -------------------------
def resolve_trade(df, i_open, dirn, en, tp, sl, max_bars, scenario, rng, bridge_paths=1000):
    """Resuelve TP/SL/TIME vela a vela desde i_open+1. Devuelve (exit_bar, exit_px, reason,
    ambiguous). Stop-first en CONSERVATIVE, tp-first en OPTIMISTIC, bridge en RANDOM_BRIDGE."""
    o, h, l, c = df["open"].values, df["high"].values, df["low"].values, df["close"].values
    n = len(df)
    ambiguous = False
    for j in range(i_open + 1, min(i_open + max_bars + 1, n)):
        if dirn > 0:
            hit_sl, hit_tp = l[j] <= sl, h[j] >= tp
        else:
            hit_sl, hit_tp = h[j] >= sl, l[j] <= tp
        if hit_sl and hit_tp:
            ambiguous = True
            if scenario == "CONSERVATIVE":
                hit_tp = False
            elif scenario == "OPTIMISTIC":
                hit_sl = False
            else:  # RANDOM_BRIDGE: bridge condicionado por OHLC de la vela
                hit_sl, hit_tp = bridge_decide(o[j], h[j], l[j], c[j], dirn, tp, sl, rng, bridge_paths)
        if hit_sl:
            return j, sl, "SL", ambiguous
        if hit_tp:
            return j, tp, "TP", ambiguous
    j = min(i_open + max_bars, n - 1)
    return j, c[j], "TIME", ambiguous

def bridge_decide(op, hi, lo, cl, dirn, tp, sl, rng, paths):
    """Brownian bridge condicionada por O/H/L/C de la vela: genera trayectorias, decide si
    SL o TP se toca primero en la mayoria de recorridos."""
    span = max(hi - lo, 1e-9)
    steps = 32
    # puente browniano de open a close con vol implicita del rango
    vol = span / math.sqrt(steps) / 3.0
    # niveles normalizados dentro de la vela
    def lvl(px):
        return (px - lo) / span
    t_sl, t_tp = lvl(sl), lvl(tp)
    first_sl, first_tp = 0, 0
    Z = rng.standard_normal((paths, steps))
    dt = 1.0 / steps
    drift = (cl - op)  # condicion terminal
    for s in range(paths):
        x = op
        done = False
        for k in range(steps):
            inc = drift / steps + vol * (Z[s, k] - Z[s, k-1] if k > 0 else Z[s, 0])
            x = x + inc
            x = min(max(x, lo), hi)
            if not done:
                if dirn > 0:
                    if x <= sl:
                        first_sl += 1; done = True
                    elif x >= tp:
                        first_tp += 1; done = True
                else:
                    if x >= sl:
                        first_sl += 1; done = True
                    elif x <= tp:
                        first_tp += 1; done = True
        if not done:
            # sin toque: decide por lado de cierre
            if (cl - sl) * dirn < (cl - tp) * dirn:
                first_sl += 1
            else:
                first_tp += 1
    if first_sl >= first_tp:
        return True, False
    return False, True

# ------------------------- motor de secuencias -------------------------
def run_config(df, pats, cfg, scenario="CONSERVATIVE", seed=12345, spread=0.5, slip=0.0,
               commission=0.0, vpt=None, collect_trades=False):
    """Ejecuta una configuracion. Devuelve (df_seq, df_trades, dict_resumen)."""
    rng = np.random.default_rng(seed)
    v = cfg
    cap, obj, steps = v["cap"], v["obj"], v["steps"]
    use_ft, fttp, ftsl = v["use_ft"], v["ft_tp"], v["ft_sl"]
    franja, ft_window_s, ft256_on = v["ft_bands"], v["ft_window_s"], v["ft256"]
    sl_cap = v["sl_cap"]          # None = estructural
    max_bars = v["max_trade_bars"]
    policy = v["time_policy"]
    sess_start, sess_end = v["sess_start"], v["sess_end"]
    lot_ladder = v["lot_ladder"]  # lista de lotes por paso
    dynlot = v["dynlot"]
    vol_min, vol_step, vol_max = v["vol_min"], v["vol_step"], v["vol_max"]

    o, h, l, c = df["open"].values, df["high"].values, df["low"].values, df["close"].values
    times, min_et, date_et = df["time"].values, df["min_et"].values, df["date_et"].values
    n = len(df)

    seq_rows, trade_rows = [], []
    sid = 0
    step, lost = 0, 0.0
    seq_pnl, seq_trades, seq_open, seq_start_t = 0.0, 0, False, None
    seq_dir, seq_pid = 0, -1
    after_hours_entries, after_min_sum = 0, 0
    last_touch_bar = -1  # impide doble entrada por multiples patrones en la misma barra (HasOpen)
    eq, peak, dd = 0.0, 0.0, 0.0
    daily_pnl = {}

    def lot_for(k):
        if dynlot:
            need = lost + obj
            slpts = 10.0  # proxy de riesgo por punto; con VPT=0 default queda en PRICE_POINTS
            lot = math.ceil(need / max(slpts * (vpt or 1.0), 1e-9) * 100) / 100.0
        else:
            lot = lot_ladder[min(k, len(lot_ladder) - 1)]
        lot = min(lot, vol_max)
        lot = max(vol_min, math.floor(lot / vol_step + 1e-9) * vol_step)
        return round(lot, 4)

    def settle(pnl, why, j, en, ex, kind, amb, pid):
        nonlocal step, lost, seq_pnl, seq_trades, seq_open, after_hours_entries, after_min_sum
        nonlocal eq, peak, dd
        eq += pnl
        peak = max(peak, eq)
        dd = max(dd, peak - eq)
        d = date_et[j]
        daily_pnl[d] = daily_pnl.get(d, 0.0) + pnl
        seq_pnl += pnl
        seq_trades += 1
        m = min_et[j]
        if m >= sess_end:
            after_hours_entries += 1
            after_min_sum += m - sess_end
        if collect_trades:
            trade_rows.append(dict(sequence_id=sid, pattern=pid, kind=kind, dir=seq_dir, step=step,
                                   entry=en, exit=ex, reason=why, pnl=pnl, ambiguous=amb,
                                   date=str(d), time=str(times[j]), min_et=m))
        # ---- maquina de estados de la escalera ----
        won = seq_pnl >= obj - 1e-9
        is_time = (why == "TIME")
        if policy == "LEGACY" and is_time and pnl > 0:
            won = True  # toda salida TIME positiva cierra como ganada (politica legacy)
        if won:
            seq_rows.append(dict(sequence_id=sid, pattern=pid, dir=seq_dir, trades=seq_trades,
                                 pnl=seq_pnl, result="WIN", start=str(seq_start_t), end=str(times[j]),
                                 after_hours_entries=after_hours_entries, minutes_after=after_min_sum))
            step, lost, seq_pnl, seq_trades, seq_open = 0, 0.0, 0.0, 0, False
            after_hours_entries, after_min_sum = 0, 0
            return
        # ganancia individual insuficiente: reinicia el engranaje, la secuencia sigue
        if pnl > 0:
            step, lost = 0, 0.0
            return
        # perdida: consume un paso
        if is_time and policy in ("LEGACY", "STRICT_RECOVERY"):
            pass  # TIME perdedor cierra trade, no consume paso extra en LEGACY/STRICT
        step += 1
        lost += -pnl
        if step >= steps:
            # escalera agotada por debajo del objetivo -> secuencia fallida
            seq_rows.append(dict(sequence_id=sid, pattern=pid, dir=seq_dir, trades=seq_trades,
                                 pnl=seq_pnl, result="FAIL", start=str(seq_start_t), end=str(times[j]),
                                 after_hours_entries=after_hours_entries, minutes_after=after_min_sum))
            step, lost, seq_pnl, seq_trades, seq_open = 0, 0.0, 0.0, 0, False
            after_hours_entries, after_min_sum = 0, 0

    def apply_costs(dirn, px_entry, px_exit):
        # long: entra a ask(+slip), sale a bid(-slip); short al reves
        if dirn > 0:
            en = px_entry + spread + slip
            ex = px_exit - spread - slip
        else:
            en = px_entry - spread - slip
            ex = px_exit + spread + slip
        return en, ex

    for _, p in pats.iterrows():
        arm = int(p.arm_bar)
        if arm >= n - 2:
            continue
        dirn = int(p["dir"])
        # touch: primera vela >= arm cuyo rango cruza el trigger
        touch = -1
        for k in range(arm, min(arm + 60, n)):
            m = min_et[k]
            in_sess = sess_start <= m < sess_end
            if not in_sess and not seq_open:
                if m >= sess_end:
                    break
                continue
            if (l[k] <= p.trig <= h[k]):
                touch = k
                break
        if touch < 0:
            continue
        if touch <= last_touch_bar and seq_open:
            continue  # ya se abrio posicion en este evento (HasOpen del EA)
        if seq_open and seq_dir != dirn:
            continue  # el EA abre contra/direccion por patron; nueva secuencia solo si libre
        if not seq_open:
            sid += 1
            step, lost, seq_pnl, seq_trades = 0, 0.0, 0.0, 0
            seq_open, seq_start_t, seq_dir, seq_pid = True, times[touch], dirn, int(p.n_bar)
        en_raw = float(p.trig)
        sl = float(p.sl)
        if sl_cap is not None and abs(en_raw - sl) > sl_cap:
            sl = en_raw - dirn * sl_cap
        lot = lot_for(step)
        need = lost + obj + commission * lot
        slpts = abs(en_raw - sl)
        tp_pts = max(6.0, need / max(lot, 1e-9) / (vpt or 1.0))
        if cap is not None and tp_pts > cap:
            # INVALID_CONFIGURATION a nivel de secuencia: no se abre, se registra
            seq_rows.append(dict(sequence_id=sid, pattern=seq_pid, dir=dirn, trades=0,
                                 pnl=0.0, result="INVALID_CONFIGURATION", start=str(times[touch]),
                                 end=str(times[touch]), after_hours_entries=0, minutes_after=0))
            step, lost, seq_pnl, seq_trades, seq_open = 0, 0.0, 0.0, 0, False
            continue
        en, _ = apply_costs(dirn, en_raw, en_raw)
        tp = en + dirn * tp_pts
        last_touch_bar = touch
        j, ex, why, amb = resolve_trade(df, touch, dirn, en, tp, sl, max_bars, scenario, rng)
        _, ex = apply_costs(dirn, en_raw, ex)
        pnl = dirn * (ex - en) * lot * (vpt or 1.0) - commission * lot
        settle(pnl, why, j, en, ex, 0, amb, seq_pid)

        # ---- Paridad MQL5: el patron se resuelve con TP/SL ESTRUCTURALES (CheckOutcomes),
        # independientemente del trade de recuperacion. Si el precio alcanza tp_struct antes
        # que sl, el patron activa la escalera FT (CheckBands).
        tp_struct_raw = float(p.trig) + dirn * float(p.A)
        j_struct = -1
        for jj in range(touch + 1, min(touch + 240, n)):
            if dirn > 0:
                hit_sl = l[jj] <= float(p.sl); hit_tp = h[jj] >= tp_struct_raw
            else:
                hit_sl = h[jj] >= float(p.sl); hit_tp = l[jj] <= tp_struct_raw
            if hit_sl:
                break
            if hit_tp:
                j_struct = jj
                break
        if use_ft and j_struct >= 0:
            # bandas desde tp estructural, ventana ft_window_s, una entrada por banda
            tp_struct = tp_struct_raw
            band_px = tp_struct
            k0 = j_struct + 1
            kend = min(n - 1, j_struct + max(1, ft_window_s // 60))
            kk = 0
            while kk < 60 and k0 <= kend:
                idx = k0
                hit = (h[idx] >= band_px) if dirn > 0 else (l[idx] <= band_px)
                if hit:
                    sdir = -dirn
                    en_f, _ = apply_costs(sdir, band_px, band_px)
                    sl_f = en_f - sdir * ftsl
                    tp_f = en_f + sdir * fttp
                    jf, exf, whyf, ambf = resolve_trade(df, idx, sdir, en_f, tp_f, sl_f, max_bars, scenario, rng)
                    _, exf = apply_costs(sdir, band_px, exf)
                    pnl_f = sdir * (exf - en_f) * lot * (vpt or 1.0) - commission * lot
                    settle(pnl_f, whyf, jf, en_f, exf, 1, ambf, seq_pid)
                    kk += 1
                    band_px = tp_struct + dirn * kk * franja
                    k0 = idx + 1
                    if cap is not None and kk * franja > cap:
                        break
                else:
                    k0 += 1
                if k0 > kend:
                    break
            # FT256 solo patron 9:30
            if ft256_on:
                m0 = min_et[j_struct]
                if 570 <= m0 < 571:
                    lv = tp_struct_raw + dirn * 1.56 * float(p.A)
                    for kx in range(j_struct, min(j_struct + 120, n)):
                        if (h[kx] >= lv if dirn > 0 else l[kx] <= lv):
                            sdir = dirn
                            en_x, _ = apply_costs(sdir, lv, lv)
                            sl_x = en_x - sdir * ftsl
                            tp_x = en_x + sdir * fttp
                            jx, exx, whyx, ambx = resolve_trade(df, kx, sdir, en_x, tp_x, sl_x, max_bars, scenario, rng)
                            _, exx = apply_costs(sdir, lv, exx)
                            pnl_x = sdir * (exx - en_x) * lot * (vpt or 1.0) - commission * lot
                            settle(pnl_x, whyx, jx, en_x, exx, 2, ambx, seq_pid)
                            break

    # cerrar secuencia abierta al acabar datos (no se transfiere a resumen diario)
    if seq_open:
        seq_rows.append(dict(sequence_id=sid, pattern=seq_pid, dir=seq_dir, trades=seq_trades,
                             pnl=seq_pnl, result="OPEN", start=str(seq_start_t), end="",
                             after_hours_entries=after_hours_entries, minutes_after=after_min_sum))

    seq_df = pd.DataFrame(seq_rows)
    tr_df = pd.DataFrame(trade_rows) if collect_trades else pd.DataFrame()
    return seq_df, tr_df, dict(eq=eq, maxdd=dd, daily=daily_pnl)

# ------------------------- resumen de metricas -------------------------
def summarize(seq_df, tr_df, res, cfg, vpt_mode):
    if len(seq_df) == 0:
        return dict(config=cfg["name"], status="NO_TRADES", **{k: 0 for k in (
            "trades","sequences","seq_wins","seq_fails","PF","net","maxdd","maxdd_pct",
            "recovery","expectancy_seq","win_pct_seq","after_hours_pct")})
    valid = seq_df[seq_df.result != "INVALID_CONFIGURATION"]
    inval = (seq_df.result == "INVALID_CONFIGURATION").sum()
    wins = valid[valid.result == "WIN"]
    fails = valid[valid.result == "FAIL"]
    pnl_win = wins.pnl.sum() if len(wins) else 0.0
    pnl_fail = fails.pnl.sum() if len(fails) else 0.0
    net = res["eq"]
    gp = pnl_win + wins.pnl.clip(lower=0).sum() - (pnl_win if len(wins) else 0)
    gp = wins.pnl.clip(lower=0).sum() if len(wins) else 0.0
    gl = -fails.pnl.clip(upper=0).sum() if len(fails) else 0.0
    # gl debe incluir perdidas de trades dentro de secuencias ganadas; aproximacion por net:
    gl = max(gl, -min(net - (gp - gl), 0) + gl) if False else gl
    pf = gp / gl if gl > 0 else float("inf")
    eq_curve = None
    daily = pd.Series(res["daily"]).sort_index()
    dret = daily.diff().fillna(daily)
    sharpe = (dret.mean() / dret.std(ddof=1) * math.sqrt(252)) if dret.std(ddof=1) > 0 else 0.0
    downside = dret[dret < 0]
    sortino = (dret.mean() / downside.std(ddof=1) * math.sqrt(252)) if len(downside) > 1 and downside.std(ddof=1) > 0 else 0.0
    monthly = daily.groupby(pd.PeriodIndex(daily.index, freq="M")).sum()
    pos_months = int((monthly > 0).sum()); neg_months = int((monthly < 0).sum())
    maxdd = res["maxdd"]
    return dict(config=cfg["name"], status="OK", invalid_configs=int(inval),
                sequences=len(valid), seq_wins=len(wins), seq_fails=len(fails),
                win_pct_seq=round(100.0 * len(wins) / max(1, len(valid)), 1),
                trades=int(tr_df.shape[0]) if collect_flag else int(valid.trades.sum()),
                gross_profit=round(gp, 2), gross_loss=round(gl, 2), net=round(net, 2),
                PF=round(pf, 3) if pf != float("inf") else 999,
                expectancy_seq=round(net / max(1, len(valid)), 3),
                maxdd=round(maxdd, 2), maxdd_pct=round(maxdd, 2),
                recovery=round(net / maxdd, 3) if maxdd > 0 else 0,
                sharpe=round(sharpe, 2), sortino=round(sortino, 2),
                pos_months=pos_months, neg_months=neg_months,
                pct_pos_months=round(100 * pos_months / max(1, pos_months + neg_months), 1),
                after_hours_pct=round(100 * seq_df.after_hours_entries.sum() / max(1, valid.trades.sum()), 1),
                vpt_mode=vpt_mode)

collect_flag = False  # global simple para summarize

# ------------------------- generacion de matriz de configuraciones -------------------------
def gen_configs(quick=False):
    """Genera la matriz de configuraciones. Podado economico previo: marca INVALID cuando
    el TP requerido por la martingala supera el cap de forma estructural."""
    if quick:
        steps_list = [2, 4]
        obj_list = [0.5, 1.0, 2.0]
        cap_list = [30, 60, 100, None]
        sl_list = [None, 10, 20]
        ft_list = [(False, 0, 0), (True, 10, 10), (True, 12, 10), (True, 15, 10)]
        band_list = [3.0]
        win_list = [120]
        pol_list = ["STRICT_RECOVERY"]
    else:
        steps_list = [1, 2, 3, 4, 5, 6]
        obj_list = [0.25, 0.5, 1.0, 2.0, 3.0, 5.0, 7.5, 10.0]
        cap_list = [20, 30, 40, 50, 60, 75, 100, None]
        sl_list = [None, 5, 6, 8, 10, 12, 15, 20, 30]
        ft_list = [(False, 0, 0), (True, 6, 6), (True, 8, 8), (True, 10, 10), (True, 12, 10),
                   (True, 15, 10), (True, 20, 10), (True, 15, 12), (True, 20, 15)]
        band_list = [2.0, 3.0, 4.0, 5.0, 6.0]
        win_list = [60, 120, 180, 300, 600]
        pol_list = ["LEGACY", "STRICT_RECOVERY", "CONTINUE_AFTER_TIME", "NO_TIME"]
    ladder_map = {
        1: [0.01], 2: [0.01, 0.02], 3: [0.01, 0.02, 0.03], 4: [0.01, 0.02, 0.03, 0.04],
        5: [0.01, 0.02, 0.03, 0.04, 0.05], 6: [0.01, 0.02, 0.03, 0.04, 0.05, 0.06],
    }
    cfgs = []
    for steps in steps_list:
        for obj in obj_list:
            for cap in cap_list:
                for sl_cap in sl_list:
                    for (use_ft, fttp, ftsl) in ft_list:
                        # bandas/ventana solo si FT activo
                        for franja in (band_list if use_ft else [3.0]):
                            for win in (win_list if use_ft else [120]):
                                for pol in pol_list:
                                    # poda: TP requerido en paso 0 = obj/(0.01*vpt) en puntos;
                                    # con lotes lineales el peor caso es el paso 1 (lost=obj)
                                    # TP0 = obj/0.01 (en unidades de precio si VPT=1*lot)
                                    tp0 = obj / 0.01
                                    worst_tp = tp0 * 2  # paso 1: recuperar lost+obj
                                    if cap is not None and worst_tp > cap:
                                        continue  # INVALID structural: no generar
                                    name = f"S{steps}_O{obj}_C{cap or 'NC'}_SL{sl_cap or 'E'}_" \
                                           f"FT{fttp if use_ft else 'OFF'}{ftsl if use_ft else ''}_" \
                                           f"B{franja if use_ft else '-'}_W{win if use_ft else '-'}_{pol[:4]}"
                                    cfgs.append(dict(
                                        name=name, steps=steps, obj=obj, cap=cap, sl_cap=sl_cap,
                                        use_ft=use_ft, ft_tp=fttp, ft_sl=ftsl, ft_bands=franja,
                                        ft_window_s=win, ft256=(use_ft and franja == 3.0),
                                        time_policy=pol, sess_start=570, sess_end=660,
                                        max_trade_bars=10,
                                        lot_ladder=ladder_map[steps], dynlot=False,
                                        vol_min=0.01, vol_step=0.01, vol_max=0.06))
    return cfgs

# ------------------------- main -------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default=DATA_DEFAULT)
    ap.add_argument("--scenario", default="CONSERVATIVE",
                    choices=["CONSERVATIVE", "OPTIMISTIC", "RANDOM_BRIDGE"])
    ap.add_argument("--policy", default=None, help="filtro de politica TIME")
    ap.add_argument("--spread", type=float, default=0.5)
    ap.add_argument("--slip", type=float, default=0.0)
    ap.add_argument("--commission", type=float, default=0.0)
    ap.add_argument("--vpt", type=float, default=None, help="FIXED_VPT; default PRICE_POINTS_ONLY")
    ap.add_argument("--spec", default=SYMBOL_SPEC_FILE, help="JSON BROKER_SPEC")
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--train", action="store_true", help="solo 2023")
    ap.add_argument("--val", action="store_true", help="solo 2024")
    ap.add_argument("--test", action="store_true", help="solo 2025")
    ap.add_argument("--forward", action="store_true", help="2026")
    ap.add_argument("--out", default="tm3_all_configs.csv")
    a = ap.parse_args()

    df = load_m1(a.csv)
    if a.train:
        df = df[df.time.dt.year == 2023]
    elif a.val:
        df = df[df.time.dt.year == 2024]
    elif a.test:
        df = df[df.time.dt.year == 2025]
    elif a.forward:
        df = df[df.time.dt.year == 2026]
    df = df.reset_index(drop=True)
    print(f"barras M1 = {len(df)}  {df.time.min()} -> {df.time.max()}", flush=True)

    pats = build_patterns(df)
    print(f"patrones TT armados = {len(pats)}", flush=True)

    # modo VPT
    spec = None
    if os.path.exists(a.spec):
        spec = json.load(open(a.spec))
        vpt_mode = "BROKER_SPEC"
        vpt_val = spec["tick_value_profit"] / spec["tick_size"]
    elif a.vpt is not None:
        vpt_mode = "FIXED_VPT"
        vpt_val = a.vpt
    else:
        vpt_mode = "PRICE_POINTS_ONLY"
        vpt_val = 1.0  # unidad de precio por punto-lote; no interpretar como moneda

    global collect_flag
    collect_flag = False

    cfgs = gen_configs(quick=a.quick)
    if a.policy:
        cfgs = [c for c in cfgs if c["time_policy"] == a.policy]
    print(f"configuraciones = {len(cfgs)} (VPT mode={vpt_mode})", flush=True)

    rows = []
    for i, cfg in enumerate(cfgs):
        seq_df, tr_df, res = run_config(df, pats, cfg, scenario=a.scenario, spread=a.spread,
                                        slip=a.slip, commission=a.commission, vpt=vpt_val)
        s = summarize(seq_df, tr_df, res, cfg, vpt_mode)
        rows.append(s)
        if i % 50 == 0:
            print(f"  {i}/{len(cfgs)} done", flush=True)
    out = pd.DataFrame(rows)
    out.to_csv(a.out, index=False)
    # separar validas
    valid = out[(out.status == "OK") & (out.sequences >= 0)]
    valid.to_csv(a.out.replace("all_configs", "valid_configs"), index=False)
    print(out.sort_values("net", ascending=False).head(20).to_string(index=False))
    print(f"\n-> {a.out} | valid -> {a.out.replace('all_configs','valid_configs')}")

if __name__ == "__main__":
    main()
