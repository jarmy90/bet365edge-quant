#!/usr/bin/env python3
"""Small-sample TT detector using real Dukascopy-node quotes only.
Builds bid M1 OHLC from real quote ticks for structural levels. It does not create ticks.
The autocut is exact for the Dukascopy quote feed (ask-up / bid-down) after pattern arm.
No FT trades or economic ladder simulation are produced.
"""
import argparse,glob,os
import pandas as pd
from zoneinfo import ZoneInfo
NY=ZoneInfo('America/New_York')

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--input-dir',default='duka_raw/usatechidxusd');ap.add_argument('--out-dir',default='duka_audit');ap.add_argument('--reward-min',type=float,default=6);ap.add_argument('--sl-min',type=float,default=5);a=ap.parse_args()
 rows=[]
 for f in sorted(glob.glob(os.path.join(a.input_dir,'*','*_tick.csv'))):
  d=pd.read_csv(f);d['datetime_utc']=pd.to_datetime(d.timestamp,unit='ms',utc=True);d['datetime_new_york']=d.datetime_utc.dt.tz_convert(NY)
  # Retain original quotes; bid price is used for the bar convention, ask and bid remain separate for crossing.
  d=d.sort_values('timestamp',kind='stable').reset_index(drop=True)
  d['bar_utc']=d.datetime_utc.dt.floor('min')
  bars=d.groupby('bar_utc').agg(open=('bidPrice','first'),high=('bidPrice','max'),low=('bidPrice','min'),close=('bidPrice','last')).reset_index()
  # Map tick timestamps to bar indices; levels only become known after n+1 bar closes.
  baridx={t:i for i,t in enumerate(bars.bar_utc)}
  for i in range(2,len(bars)):
   n=i-2;n1=i-1;bn=bars.iloc[n];bn1=bars.iloc[n1]
   direction=1 if bn.close>bn.open else -1
   A=(bn.high-bn1.low) if direction>0 else (bn1.high-bn.low)
   if A<=0:continue
   trigger=bn.high if direction>0 else bn.low
   sl=bn1.low if direction>0 else bn1.high
   if abs(trigger-sl)<a.sl_min:sl=trigger-direction*a.sl_min
   risk=abs(trigger-sl)
   if A<risk or A<a.reward_min:continue
   arm_time=bars.iloc[i].bar_utc
   after=d[d.bar_utc>=arm_time]
   touch=None
   prev_ask=prev_bid=None
   for r in after.itertuples(index=False):
    ask=float(r.askPrice);bid=float(r.bidPrice)
    cross=(prev_ask is not None and prev_ask<trigger<=ask) if direction>0 else (prev_bid is not None and prev_bid>trigger>=bid)
    if cross:touch=r;break
    prev_ask,prev_bid=ask,bid
   if touch is None:continue
   touch_ts=pd.Timestamp(touch.datetime_utc)
   # Structural fibo observation only after exact quote crossing; no trade generated.
   fibo=trigger+direction*A; fibo_ts=None; state='TT_AUTOCUT';maxext=0.
   future=d[d.timestamp>int(touch.timestamp)]
   for r in future.itertuples(index=False):
    px=float(r.bidPrice if direction>0 else r.askPrice)
    slhit=px<=sl if direction>0 else px>=sl
    fibhit=px>=fibo if direction>0 else px<=fibo
    if slhit:state='TT_EXPIRED';break
    if fibhit:
     fibo_ts=pd.Timestamp(r.datetime_utc);state='TT_FIBO100_REACHED';break
   if fibo_ts is not None:
    extprices=future[future.datetime_utc>=fibo_ts]
    if not extprices.empty:
     ext=((extprices.bidPrice.max()-fibo)/A) if direction>0 else ((fibo-extprices.askPrice.min())/A)
     maxext=max(0,float(ext));
     if maxext>0:state='TT_EXTENSION'
   rows.append(dict(source_file=os.path.basename(f),pattern_bar_n=str(bn.bar_utc),pattern_bar_n1=str(bn1.bar_utc),
    arm_time_utc=str(arm_time),direction=direction,A=float(A),trigger=float(trigger),sl=float(sl),risk=float(risk),fibo100=float(fibo),
    autocut_time_utc=str(touch_ts),bid=float(touch.bidPrice),ask=float(touch.askPrice),spread=float(touch.askPrice-touch.bidPrice),
    state=state,fibo100_time_utc=str(fibo_ts) if fibo_ts is not None else '',max_extension_A=maxext,
    FT_allowed=bool(fibo_ts is not None),FT_orders=0))
 out=pd.DataFrame(rows);os.makedirs(a.out_dir,exist_ok=True);path=os.path.join(a.out_dir,'tt_sample_events.csv');out.to_csv(path,index=False)
 print(f'events={len(out)} output={path} FT orders=0')
 print(out.groupby(['source_file','state']).size().to_string() if len(out) else 'No TT autocuts in sample')
if __name__=='__main__':main()
