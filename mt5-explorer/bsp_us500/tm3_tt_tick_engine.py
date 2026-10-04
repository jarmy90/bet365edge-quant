"""REAL_TICK TT-only adapter. Requires real MT5 ticks; never synthesizes ticks.
CSV schema: time_msc,bid,ask,last,volume. M1 geometry engine is separate.
"""
import argparse, os, sys
import numpy as np
import pandas as pd
import tm3_tick_sim as sentiment

REQUIRED={'time_msc','bid','ask','last','volume'}

def load_ticks(path):
    d=pd.read_csv(path)
    missing=REQUIRED-set(d.columns)
    if missing: raise ValueError(f'missing columns: {sorted(missing)}')
    d=d.sort_values('time_msc',kind='stable').reset_index(drop=True)
    # duplicate timestamps are invalid for causal prev-tick crossing; reject, don't dedupe silently
    if d.time_msc.duplicated().any():
        raise ValueError('duplicate time_msc rows; resolve/export unique tick timestamps before simulation')
    if (d.bid<=0).any() or (d.ask<d.bid).any(): raise ValueError('invalid bid/ask')
    d['gap_ms']=d.time_msc.diff().fillna(0)
    d['gap_over_5s']=d.gap_ms>5000
    return d

def detect_crosses(d, patterns):
    """patterns require pattern_id,arm_time_msc,trigger,direction,sl,fibo100.
    Returns exact causal touch row per pattern; none for prior-to-arm crosses."""
    out=[]; ms=d.time_msc.to_numpy(); bid=d.bid.to_numpy(); ask=d.ask.to_numpy()
    for p in patterns.itertuples(index=False):
        i0=max(1,int(np.searchsorted(ms,int(p.arm_time_msc),side='left')))
        found=None
        for i in range(i0,len(d)):
            if p.direction>0:
                crossed=ask[i-1]<p.trigger and ask[i]>=p.trigger
            else:
                crossed=bid[i-1]>p.trigger and bid[i]<=p.trigger
            if crossed: found=i;break
        if found is not None:
            out.append(dict(pattern_id=p.pattern_id,tick_index=found,touch_time_msc=int(ms[found]),
                            bid=float(bid[found]),ask=float(ask[found]),trigger=float(p.trigger),
                            direction=int(p.direction),precut_time_msc=int(ms[found])-2000))
    return pd.DataFrame(out)

def provisional_m1(d):
    mid=(d.bid+d.ask)/2
    t=pd.to_datetime(d.time_msc,unit='ms',utc=True)
    key=t.dt.floor('min')
    return pd.DataFrame({'time':t,'mid':mid,'minute':key}).groupby('minute').mid.agg(open='first',high='max',low='min',close='last').reset_index()

def causal_sentiment(d, end_ms, direction, sec=2):
    # strictly slice data no later than decision tick; pre-touch may be before retained buffer
    subset=d[d.time_msc<=end_ms].reset_index(drop=True)
    tw=sentiment.TickWindow(subset)
    return sentiment.calc_sent_at(tw,direction,sec,int(end_ms))

def structural_trace(d, cross, pattern, expiry_ms=600000):
    """Structural-only states. No FT order/trade is ever emitted."""
    i=int(cross.tick_index); direction=int(pattern.direction); fib=float(pattern.fibo100)
    bid=d.bid.to_numpy();ask=d.ask.to_numpy();ms=d.time_msc.to_numpy()
    state='TT_AUTOCUT'; max_ext=0.; fib_ms=None; brake='NO_BRAKE'
    start=max(0,i); end=np.searchsorted(ms,ms[i]+expiry_ms,side='right')
    prev_v=None; v_at_fibo=None; post_v=None
    for k in range(i+1,end):
        px=bid[k] if direction>0 else ask[k]
        reached=(px>=fib) if direction>0 else (px<=fib)
        if reached and fib_ms is None:
            fib_ms=int(ms[k]);state='TT_FIBO100_REACHED'
            prevpx=bid[k-1] if direction>0 else ask[k-1]
            v_at_fibo=direction*(px-prevpx)/max((ms[k]-ms[k-1])/1000,1e-3)
        if fib_ms is not None:
            if direction>0:max_ext=max(max_ext,max(0.,(px-fib)/float(pattern.A)))
            else:max_ext=max(max_ext,max(0.,(fib-px)/float(pattern.A)))
            if max_ext>0:state='TT_EXTENSION'
            if v_at_fibo is not None and k>np.searchsorted(ms,fib_ms):
                prevpx=bid[k-1] if direction>0 else ask[k-1]
                post_v=direction*(px-prevpx)/max((ms[k]-ms[k-1])/1000,1e-3)
                if post_v < v_at_fibo*.5: brake='SOFT_BRAKE';state='TT_BRAKE_OBSERVED'
    return dict(state=state,fibo100_reached=fib_ms is not None,fibo100_time_msc=fib_ms,
                max_extension_A=max_ext,velocity_fibo=v_at_fibo,velocity_post=post_v,
                brake_label=brake,zsf=None,rpcn=None,iit=None,brake_metrics='tick velocity only; indicators require valid 60s window')

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--ticks',required=True);ap.add_argument('--patterns',required=True)
    ap.add_argument('--out',default='tm3_tt_tick_events.csv');a=ap.parse_args()
    d=load_ticks(a.ticks); p=pd.read_csv(a.patterns)
    crosses=detect_crosses(d,p)
    rows=[]
    for x in crosses.itertuples(index=False):
        patt=p[p.pattern_id==x.pattern_id].iloc[0]
        pre=causal_sentiment(d,x.precut_time_msc,x.direction,2)
        at=causal_sentiment(d,x.touch_time_msc,x.direction,2)
        structure=structural_trace(d,x,patt)
        rows.append(dict(**x._asdict(),pre_zvl=pre['zvl'],pre_rer=pre['rer'],pre_irpl=pre['irpl'],
                         touch_zvl=at['zvl'],touch_rer=at['rer'],touch_irpl=at['irpl'],
                         touch_zsf=at['zsf'],touch_rpcn=at['rpcn'],touch_iit=at['iit'],
                         nr=at['nr'],ns=at['ns'],**structure))
    pd.DataFrame(rows).to_csv(a.out,index=False)
    print(f'real ticks={len(d)} gaps>5s={int(d.gap_over_5s.sum())}; autocuts={len(crosses)}; FT orders=0; wrote {a.out}')
if __name__=='__main__':main()
