# Explorer estadístico USTEC velocidad TT/FT, sesión NY 09:30-11:30.
# Replica Q_SPEED_MARTINGALE_EXPLORER_USTEC.mq5 v1.01 (servidor=NY+7h).
import argparse
import os
import pandas as pd
import numpy as np

BASE = os.path.dirname(os.path.abspath(__file__))
M1 = os.path.join(BASE, "histdata_ustec", "nsxusd_m1_all.csv")

PLANS = [
    dict(name="P1_FIXED_01", steps=1, sl=5, base=12, target=1.0, maxtp=20),
    dict(name="P2_01_02_EUR1", steps=2, sl=6, base=12, target=1.0, maxtp=25),
    dict(name="P3_01_02_03_EUR1", steps=3, sl=6, base=14, target=1.0, maxtp=30),
    dict(name="P4_01_02_03_EUR2", steps=3, sl=8, base=16, target=2.0, maxtp=35),
    dict(name="P5_01_02_03_EUR3", steps=3, sl=10, base=20, target=3.0, maxtp=40),
    dict(name="P6_01_02_03_04_EUR2", steps=4, sl=8, base=18, target=2.0, maxtp=40),
    dict(name="P7_01_02_03_04_EUR3", steps=4, sl=10, base=22, target=3.0, maxtp=50),
    dict(name="P8_01_02_03_04_EUR5", steps=4, sl=10, base=25, target=5.0, maxtp=60),
]
LOTS = [0.1, 0.2, 0.3, 0.4]
SPEEDS = dict(minSpeed=2.0, contRatio=1.10, redRatio=0.55, minPrev=4.0)
COSTS = dict(spread=2.50, commission=0.0, maxHold=10, cooldown=1,
             dailyLoss=20.0, budget=100.0, maxSigDay=100)


def session_mask(t):
    ny = t - pd.Timedelta(hours=7)
    mins = ny.dt.hour * 60 + ny.dt.minute
    return (mins >= 9 * 60 + 30) & (mins < 11 * 60 + 30)

def run(df, eurpt):
    df = df.copy()
    df["time"] = pd.to_datetime(df["time"])
    o = df.open.values
    h = df.high.values
    l = df.low.values
    c = df.close.values
    n = len(df)
    in_sess = session_mask(df.time).values
    day = df.time.dt.date.values
    times = df.time.values
    st = {p["name"]: dict(open=False, step=0, seq_loss=0.0, day_pnl=0.0,
                          tot=0.0, peak=100.0, dd=0.0, trades=0, wins=0,
                          losses=0, seqs=0, failed=0, streak=0, maxstreak=0,
                          reach=[0, 0, 0, 0], skip=0, nday=0, cool=0,
                          lastday=None) for p in PLANS}
    rows = []
    nsig = 0
    sess_idx = np.where(in_sess)[0]
    sess_set = set(sess_idx.tolist())
    for i in range(3, n):
        t = times[i]
        dd = day[i]
        b = i - 1
        for p in PLANS:
            s = st[p["name"]]
            if s["lastday"] is not dd:
                s["lastday"] = dd
                s["day_pnl"] = 0.0
                s["nday"] = 0
            if not s["open"]:
                continue
            d = s["dir"]
            sl_hit = (l[b] <= s["sl"]) if d > 0 else (h[b] + s["sp"] >= s["sl"])
            tp_hit = (h[b] >= s["tp"]) if d > 0 else (l[b] + s["sp"] <= s["tp"])
            if sl_hit and tp_hit:
                out, rs = s["sl"], "SL_SAME_BAR"
            elif sl_hit:
                out, rs = s["sl"], "SL"
            elif tp_hit:
                out, rs = s["tp"], "TP"
            elif (i - s["ei"]) >= COSTS["maxHold"]:
                out = c[b] if d > 0 else c[b] + s["sp"]
                rs = "TIME"
            elif i not in sess_set:
                out = c[b] if d > 0 else c[b] + s["sp"]
                rs = "SESSION_END"
            else:
                continue
            lot = LOTS[s["step"]]
            gross = (out - s["ep"]) * d * lot * eurpt
            pnl = gross - COSTS["commission"] * lot
            s["trades"] += 1
            s["day_pnl"] += pnl
            s["tot"] += pnl
            eq = 100.0 + s["tot"]
            s["peak"] = max(s["peak"], eq)
            s["dd"] = max(s["dd"], s["peak"] - eq)
            rows.append(dict(plan=p["name"], t_in=s["tin"], t_out=t,
                             pattern=s["pat"], side="BUY" if d > 0 else "SELL",
                             step=s["step"] + 1, lot=lot, ep=s["ep"],
                             sl=s["sl"], tp=s["tp"], out=out, reason=rs,
                             pnl=round(pnl, 2), spread=s["sp"]))
            if pnl > 0:
                s["wins"] += 1
                s["streak"] = 0
                s["seq_loss"] = 0.0
                s["step"] = 0
                s["seqs"] += 1
            else:
                s["losses"] += 1
                s["streak"] += 1
                s["maxstreak"] = max(s["maxstreak"], s["streak"])
                s["seq_loss"] += -pnl
                if s["step"] + 1 >= p["steps"]:
                    s["failed"] += 1
                    s["seqs"] += 1
                    s["seq_loss"] = 0.0
                    s["step"] = 0
                else:
                    s["step"] += 1
            s["open"] = False
            s["cool"] = COSTS["cooldown"]
        for p in PLANS:
            if st[p["name"]]["cool"] > 0:
                st[p["name"]]["cool"] -= 1
        if i not in sess_set:
            continue
        m1, m2, m3 = c[i - 1] - o[i - 1], c[i - 2] - o[i - 2], c[i - 3] - o[i - 3]
        vr, vp = abs(m1), (abs(m2) + abs(m3)) * 0.5
        sig, d, pat = False, 0, ""
        if m1 * m2 > 0 and m2 * m3 > 0 and vr >= SPEEDS["minSpeed"] and vr >= vp * SPEEDS["contRatio"]:
            sig, d, pat = True, (1 if m1 > 0 else -1), "TT"
        elif m2 * m3 > 0 and m1 * m2 > 0 and vp >= SPEEDS["minPrev"] and vr <= vp * SPEEDS["redRatio"]:
            sig, d, pat = True, (-1 if m2 > 0 else 1), "FT"
        if not sig:
            continue
        nsig += 1
        sp = COSTS["spread"]
        bid, ask = o[i], o[i] + sp
        if sp > 2.50:
            for p in PLANS:
                st[p["name"]]["skip"] += 1
            continue
        for p in PLANS:
            s = st[p["name"]]
            ok = (not s["open"] and s["cool"] <= 0 and s["day_pnl"] > -COSTS["dailyLoss"]
                  and s["tot"] > -COSTS["budget"] and s["nday"] < COSTS["maxSigDay"])
            if not ok:
                s["skip"] += 1
                continue
            lot = LOTS[s["step"]]
            ep = ask if d > 0 else bid
            need = s["seq_loss"] + p["target"]
            tppts = p["base"]
            if need > 0 and lot * eurpt > 0:
                tppts = max(p["base"], min(p["maxtp"], need / (lot * eurpt)))
            s.update(open=True, dir=d, pat=pat, ei=i, tin=t, ep=ep, sp=sp,
                     sl=ep - d * p["sl"], tp=ep + d * tppts)
            s["reach"][s["step"]] += 1
            s["nday"] += 1
    return pd.DataFrame(rows), st, nsig


def audit(df, st, nsig, eurpt):
    print(f"nsig={nsig} eurpt={eurpt}", flush=True)
    print()
    print("=== PLANES ===", flush=True)
    for p in PLANS:
        s = st[p["name"]]
        n = s["trades"]
        wr = 100.0 * s["wins"] / n if n else 0
        exp = s["tot"] / n if n else 0
        print(f"{p['name']}: trades={n} win%={wr:.1f} PnL={s['tot']:.2f} "
              f"exp={exp:.3f} DD={s['dd']:.2f} rachaMax={s['maxstreak']} "
              f"seq={s['seqs']} fallidas={s['failed']} "
              f"paso={s['reach']} skip={s['skip']}", flush=True)
    print()
    print("=== POR PATRON (todos los planes) ===")
    print(df.groupby(["plan", "pattern", "side"]).pnl.agg(["count", "sum", "mean"]).round(2).to_string())
    print()
    print("=== RACHAS (paso necesario, plan P4) ===")
    d4 = df[df.plan == "P4_01_02_03_EUR2"].copy()
    if len(d4):
        print(d4.groupby("step").pnl.agg(["count", "sum", "mean"]).round(2).to_string())
    print()
    print("=== FRANJAS NY ===")
    df["ny"] = pd.to_datetime(df["t_in"]) - pd.Timedelta(hours=7)
    df["franja"] = pd.cut(df.ny.dt.hour * 60 + df.ny.dt.minute,
                           bins=[570, 600, 630, 660, 691],
                           labels=["09:30-10:00", "10:00-10:30", "10:30-11:00", "11:00-11:30"])
    print(df.groupby(["plan", "franja"], observed=True).pnl.agg(["count", "sum", "mean"]).round(2).to_string())
    print()
    print("=== MENSUAL (P4) ===")
    d4["month"] = pd.to_datetime(d4["t_in"]).dt.to_period("M").astype(str)
    print(d4.groupby("month").pnl.agg(["count", "sum", "mean"]).round(2).to_string())


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--eurpt", type=float, default=0.9)
    a = ap.parse_args()
    df = pd.read_csv(M1)
    t, st, nsig = run(df, a.eurpt)
    t.to_csv(os.path.join(BASE, "ustec_trades.csv"), index=False, sep=";")
    srows = []
    for p in PLANS:
        s = st[p["name"]]
        srows.append(dict(plan=p["name"], steps=p["steps"], sl=p["sl"], base=p["base"],
                          target=p["target"], maxtp=p["maxtp"], trades=s["trades"],
                          wins=s["wins"], losses=s["losses"],
                          winrate=round(100.0 * s["wins"] / s["trades"], 2) if s["trades"] else 0,
                          pnl=round(s["tot"], 2), maxdd=round(s["dd"], 2),
                          rachaMax=s["maxstreak"], seq=s["seqs"], fallidas=s["failed"],
                          paso1=s["reach"][0], paso2=s["reach"][1],
                          paso3=s["reach"][2], paso4=s["reach"][3], skip=s["skip"]))
    pd.DataFrame(srows).to_csv(os.path.join(BASE, "ustec_summary.csv"), index=False, sep=";")
    audit(t, st, nsig, a.eurpt)