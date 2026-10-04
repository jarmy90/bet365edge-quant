#!/usr/bin/env python3
"""Databento GLBX.MDP3 NQ MBP-1 acquisition and audit pipeline.

This script intentionally does not download without an API key and an explicit cost ceiling.
It never requests a continuous/adjusted contract. Costs are checked before any data request.
"""
from __future__ import annotations
import argparse, hashlib, json, os, sys
from pathlib import Path
from datetime import datetime, date, time, timedelta, timezone
from zoneinfo import ZoneInfo

import pandas as pd

ROOT=Path(__file__).resolve().parent
NY=ZoneInfo('America/New_York')
DATASET='GLBX.MDP3'; SCHEMA='mbp-1'
START_DEFAULT='2025-07-01'; END_EXCLUSIVE_DEFAULT='2026-09-25'
FIELDS=['ts_event','ts_recv','raw_symbol','instrument_id','bid_px_00','ask_px_00',
        'bid_sz_00','ask_sz_00','price','size','action','side','flags','sequence']


def get_client():
    key=os.environ.get('DATABENTO_API_KEY')
    if not key:
        raise RuntimeError('DATABENTO_API_KEY missing. Do not pass API keys in CLI/chat; set it locally.')
    try: import databento as db
    except ImportError as e: raise RuntimeError('Install the official `databento` Python client in the selected environment.') from e
    return db,db.Historical(key)

def get_cost(client,symbols,start,end,schema=SCHEMA):
    # The authenticated estimate endpoint returns the charge for uncompressed bytes.
    return client.metadata.get_cost(dataset=DATASET,symbol= symbols, stype_in='raw_symbol',
                                    schema=schema,start=start,end=end)

def check_max_cost(cost,max_cost):
    amount=float(cost)
    if max_cost is None: raise RuntimeError(f'Estimate is ${amount:.2f}; pass --max-cost-usd and rerun to authorize.')
    if amount>max_cost: raise RuntimeError(f'Estimate ${amount:.2f} exceeds --max-cost-usd ${max_cost:.2f}; stopping before download.')
    return amount

def sample_sessions(start='2025-07-01'):
    # Known weekdays, but not assume CME holiday calendar; API availability validates sessions.
    d=date.fromisoformat(start); out=[]
    while len(out)<2:
        if d.weekday()<5: out.append(d.isoformat())
        d+=timedelta(days=1)
    return out

def normalize_frame(df):
    """Normalize DBN/decoded dataframe. No ffill; preserve all source event rows."""
    x=df.copy()
    for col in FIELDS:
        if col not in x: x[col]=pd.NA
    # Databento ts_event is ns UTC. Do not round before ET session filtering.
    x['time_ns_utc']=pd.to_numeric(x['ts_event'],errors='coerce').astype('Int64')
    x['datetime_utc']=pd.to_datetime(x['time_ns_utc'],unit='ns',utc=True,errors='coerce')
    x['datetime_new_york']=x['datetime_utc'].dt.tz_convert(NY)
    et=x['datetime_new_york']
    x['time_msc']=(x['time_ns_utc']//1_000_000).astype('Int64')
    x=x[x['datetime_utc'].notna()].copy()
    et=x['datetime_new_york']
    # CME trading date: session starts prior evening. The requested cash window falls within same ET calendar date.
    x['trading_date_et']=et.dt.date.astype('string')
    # Only required window, timezone-aware; upper bound exclusive.
    sec=et.dt.hour*3600+et.dt.minute*60+et.dt.second+et.dt.microsecond/1e6
    x=x[(sec>=9*3600+20*60)&(sec<11*3600+10)].copy()
    for c in ['bid_px_00','ask_px_00','bid_sz_00','ask_sz_00','price','size']:
        x[c]=pd.to_numeric(x[c],errors='coerce')
    x['bid']=x.bid_px_00.where(x.bid_px_00>0)
    x['ask']=x.ask_px_00.where(x.ask_px_00>0)
    x['bid_size']=x.bid_sz_00
    x['ask_size']=x.ask_sz_00
    x['mid']=((x.bid+x.ask)/2).where(x.bid.notna()&x.ask.notna())
    x['spread']=(x.ask-x.bid).where(x.bid.notna()&x.ask.notna())
    x['last']=x.price.where(x.price>0)
    # MBP-1 records may be book updates without trades; do not infer a trade from non-null price.
    # Databento Mbo/MBP-1 action codes are retained in event_type; trade field only when action=T.
    trade_mask=x['action'].astype('string').str.upper().eq('T')
    x['last']=x['price'].where(trade_mask & (x['price']>0))
    x['last_size']=x['size'].where(x['last'].notna())
    x['last_size']=x['size']
    x['event_type']=x['action'].astype('string')
    cols=['time_ns_utc','time_msc','datetime_utc','datetime_new_york','trading_date_et','raw_symbol','instrument_id',
          'bid','ask','bid_size','ask_size','mid','spread','last','last_size','event_type','sequence','flags']
    return x[cols].sort_values(['time_ns_utc','sequence'],kind='stable').reset_index(drop=True)

def audit(df):
    if df.empty: return {'records':0,'sessions':0}
    t=pd.to_datetime(df.time_ns_utc,unit='ns',utc=True)
    d=df.copy();d['_t']=t
    dt_ns=d.time_ns_utc.astype('int64').diff()
    gaps=dt_ns.clip(lower=0)/1e9
    # Duplicate exact payload rows excluding timestamps? full normalized-row duplicate means exact retransmission candidate.
    exact=int(df.duplicated().sum())
    b=df.bid; a=df.ask; spread=df.spread
    valid=b.notna()&a.notna()
    outside_order=int((dt_ns<0).sum())
    return {
      'records':int(len(df)),'sessions':int(df.trading_date_et.nunique()),
      'first_utc':str(t.min()),'last_utc':str(t.max()),
      'out_of_order_rows':outside_order,'exact_duplicate_rows':exact,
      'gaps_gt_1s':int((gaps>1).sum()),'gaps_gt_5s':int((gaps>5).sum()),
      'gaps_gt_10s':int((gaps>10).sum()),'gaps_gt_60s':int((gaps>60).sum()),
      'bid_gt_ask':int((b>a).sum()),'spread_zero_or_negative':int((spread<=0).sum()),
      'quotes_valid_pct':round(100*valid.mean(),4),'trade_present_pct':round(100*df['last'].notna().mean(),4),
      'raw_symbols':sorted(map(str,df.raw_symbol.dropna().unique())),
      'spread_quantiles':{str(k):float(v) for k,v in spread.quantile([0,.01,.5,.95,.99,1]).items() if pd.notna(v)},
      'ticks_per_second_quantiles':{str(k):float(v) for k,v in df.assign(sec=t.dt.floor('s')).groupby('sec').size().quantile([0,.5,.95,.99,1]).items()},
      'dst_offsets':sorted(map(str,df.datetime_new_york.map(lambda x:x.strftime('%z')).unique()))
    }

def sha256(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--from',dest='start',default=START_DEFAULT);ap.add_argument('--to-exclusive',dest='end',default=END_EXCLUSIVE_DEFAULT)
    ap.add_argument('--sample',action='store_true');ap.add_argument('--estimate-only',action='store_true')
    ap.add_argument('--symbols',nargs='*',default=None,help='individual raw_symbol contracts only; required after symbology resolution')
    ap.add_argument('--max-cost-usd',type=float,default=None);ap.add_argument('--out-dir',default=str(ROOT/'data'))
    ap.add_argument('--confirm-full-download',action='store_true');a=ap.parse_args()
    db,client=get_client()
    start,end=a.start,a.end
    if a.sample:
        days=sample_sessions(start); start=days[0]+'T09:20:00 America/New_York'; end=days[-1]+'T11:10:00 America/New_York'
    if not a.symbols: raise RuntimeError('No raw_symbol contract list supplied. Resolve individual NQ contracts first; continuous symbols are prohibited.')
    cost=get_cost(client,a.symbols,start,end)
    print(json.dumps({'dataset':DATASET,'schema':SCHEMA,'symbols':a.symbols,'start':start,'end_exclusive':end,'estimated_cost_usd':cost},indent=2,default=str))
    if a.estimate_only:return
    amount=check_max_cost(cost,a.max_cost_usd)
    if not a.sample and not a.confirm_full_download:
        raise RuntimeError(f'Full period estimate is ${amount:.2f}; requires --confirm-full-download after human review.')
    out=Path(a.out_dir);out.mkdir(parents=True,exist_ok=True)
    # Keep original DBN chunks unmodified. Use DBN output and preserve chunk boundaries/files.
    store=client.timeseries.get_range(dataset=DATASET,symbol=a.symbols,stype_in='raw_symbol',schema=SCHEMA,
                                      start=start,end=end)
    raw=out/'NQ_MBP1_RAW.dbn';store.to_file(raw)
    frame=store.to_df().reset_index()
    norm=normalize_frame(frame)
    norm.to_parquet(out/'NQ_QUOTES_NORMALIZED.parquet',index=False)
    norm.to_csv(out/'NQ_QUOTES_NORMALIZED.csv.zst',index=False,compression={'method':'zstd','level':6})
    au=audit(norm);(out/'audit.json').write_text(json.dumps(au,indent=2,default=str))
    print(json.dumps({'cost_estimate_usd':amount,'actual_raw_bytes':raw.stat().st_size,'sha256_raw':sha256(raw),'audit':au},indent=2,default=str))

if __name__=='__main__':
    try:main()
    except Exception as e:
        print(f'STOP: {e}',file=sys.stderr);sys.exit(2)
