#!/usr/bin/env python3
"""Audit real tick CSVs from Dukascopy-node or MT5 export. No data alteration."""
import argparse,hashlib,json,os
from pathlib import Path
import pandas as pd
from zoneinfo import ZoneInfo
NY=ZoneInfo('America/New_York')

def sha(path):
 h=hashlib.sha256()
 with open(path,'rb') as f:
  for b in iter(lambda:f.read(1<<20),b''):h.update(b)
 return h.hexdigest()
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--input',required=True);ap.add_argument('--out-dir',default='duka_audit')
 ap.add_argument('--format',choices=['duka-node','mt5'],default='duka-node');a=ap.parse_args()
 p=Path(a.input);d=pd.read_csv(p)
 if a.format=='duka-node':
  rename={'timestamp':'time_msc','bidPrice':'bid','askPrice':'ask','askVolume':'ask_volume','bidVolume':'bid_volume'}
  d=d.rename(columns=rename);d['last']=pd.NA
 required={'time_msc','bid','ask'}
 if not required<=set(d):raise SystemExit(f'missing: {sorted(required-set(d))}')
 ms=pd.to_numeric(d.time_msc,errors='coerce');t=pd.to_datetime(ms,unit='ms',utc=True,errors='coerce');et=t.dt.tz_convert(NY)
 gap=ms.diff()/1000;spread=pd.to_numeric(d.ask,errors='coerce')-pd.to_numeric(d.bid,errors='coerce')
 qvalid=pd.to_numeric(d.bid,errors='coerce').notna()&pd.to_numeric(d.ask,errors='coerce').notna()
 # Preserve timestamps; count dup/exact, never remove.
 ticks_sec=pd.Series(1,index=t.dt.floor('s')).groupby(level=0).sum()
 day_counts=pd.DataFrame({'trading_date_et':et.dt.date.astype(str),'hour':et.dt.hour,'minute':et.dt.minute})
 in_window=(et.dt.hour*60+et.dt.minute>=9*60+20)&(et.dt.hour*60+et.dt.minute<11*60+10)
 window=day_counts[in_window]
 report={'source_file':str(p.resolve()),'sha256':sha(p),'rows':int(len(d)),
  'timestamp_first_utc':str(t.min()),'timestamp_last_utc':str(t.max()),'sessions_et':int(et.dt.date.nunique()),
  'duplicate_timestamps_preserved':int(ms.duplicated().sum()),'exact_duplicate_rows':int(d.duplicated().sum()),
  'out_of_order_rows':int((gap<0).sum()),'gaps_gt_1s':int((gap>1).sum()),'gaps_gt_5s':int((gap>5).sum()),'gaps_gt_10s':int((gap>10).sum()),'gaps_gt_60s':int((gap>60).sum()),
  'bid_gt_ask':int((pd.to_numeric(d.bid,errors='coerce')>pd.to_numeric(d.ask,errors='coerce')).sum()),
  'spread_nonpositive':int((spread<=0).sum()),'spread_quantiles':{str(k):float(v) for k,v in spread.quantile([0,.01,.5,.95,.99,1]).items()},
  'valid_bid_ask_pct':round(100*qvalid.mean(),5),'trade_field_present_pct':round(100*d['last'].notna().mean(),5) if 'last' in d else 0,
  'ticks_per_second':{str(k):float(v) for k,v in ticks_sec.quantile([0,.5,.95,.99,1]).items()},
  'utc_offsets_new_york':sorted(set(et.map(lambda z:z.strftime('%z')))),
  'window_0920_1110_rows':int(in_window.sum()),'window_minutes_by_et_date':{str(k):int(v) for k,v in window.groupby('trading_date_et').size().items()}}
 out=Path(a.out_dir);out.mkdir(parents=True,exist_ok=True)
 (out/(p.stem+'_audit.json')).write_text(json.dumps(report,indent=2))
 print(json.dumps(report,indent=2))
if __name__=='__main__':main()
