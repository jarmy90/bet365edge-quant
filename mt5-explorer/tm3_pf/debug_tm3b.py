import backtest_tm3_pf as B
import sys

orig_open = B.Engine.open_v
stats = dict(cross=0, arm=0, tt_ok=0, tt_bad=0, no_sent=0)


def open_wrap(self, vi, p, kind, s, tmsc, bid, ask):
    if kind == 0:
        sent = self.sent(p["dir"], B.SEN_TT)
        if sent is None:
            stats["no_sent"] += 1
        elif self.tt_filter(vi, sent, p["dir"]):
            stats["tt_ok"] += 1
        else:
            stats["tt_bad"] += 1
    return orig_open(self, vi, p, kind, s, tmsc, bid, ask)


B.Engine.open_v = open_wrap
orig_trig = B.Engine.triggers


def trig_wrap(self, tmsc, bid, ask, sec):
    for p in self.pending:
        if not p["armed"] or p["trigged"] or p["resolved"]:
            continue
        cr = (self.prev_ask < p["trig"] <= ask) if p["dir"] > 0 else (self.prev_bid > p["trig"] >= bid)
        if cr:
            stats["cross"] += 1
    return orig_trig(self, tmsc, bid, ask, sec)


B.Engine.triggers = trig_wrap
eng, df, pend = B.run("subset_18m.csv", 1.0, False, 1.0, 40000)
print("stats:", stats, "trades:", len(eng.trades), "pats:", len(eng.pats),
      "trigged:", sum(1 for p in eng.pats if p["trigged"]))
print("et_min rango visto:", eng.et_day)
