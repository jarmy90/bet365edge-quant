"""Adapter for project's real Dukascopy .ticks (20-byte big-endian records).
Known source from mt5-explorer/tm3_pf/dl_duka_ticks.py: USATECHIDXUSD, point=1000.
Output schema compatible with tm3_tt_tick_engine: time_msc,bid,ask,last,volume.
Ticks are Dukascopy quotes, not MT5/IC Markets fills. No synthetic ticks are created.
"""
import argparse, glob, os, re, struct
from datetime import datetime, timezone
import pandas as pd

FILE_RE=re.compile(r'^(\d{4}-\d{2}-\d{2})_(\d{2})\.ticks$')
POINT=1000.0
RECORD=struct.Struct('>iiiff')

def decode_file(path):
    name=os.path.basename(path); m=FILE_RE.match(name)
    if not m: raise ValueError(f'unrecognized Dukascopy hourly tick filename: {name}')
    day,hour=m.group(1),int(m.group(2))
    raw=open(path,'rb').read()
    if len(raw)%RECORD.size: raise ValueError(f'{name}: {len(raw)} bytes is not divisible by 20')
    dt=datetime.strptime(day+f' {hour:02d}','%Y-%m-%d %H').replace(tzinfo=timezone.utc)
    base_ms=int(dt.timestamp()*1000)
    rows=[]
    for pos in range(0,len(raw),RECORD.size):
        ms,ask_i,bid_i,vol_ask,vol_bid=RECORD.unpack_from(raw,pos)
        if ms<0 or ms>=3_600_000: raise ValueError(f'{name}: invalid within-hour ms={ms}')
        ask=ask_i/POINT;bid=bid_i/POINT
        if bid<=0 or ask<bid: raise ValueError(f'{name}: invalid bid/ask at record {pos//20}')
        rows.append((base_ms+ms,bid,ask,(bid+ask)*.5,float(vol_ask+vol_bid)))
    return rows

def convert(input_dir,output_path,start=None,end=None):
    files=sorted(glob.glob(os.path.join(input_dir,'*.ticks')))
    rows=[]
    for f in files:
        m=FILE_RE.match(os.path.basename(f))
        if not m: continue
        day=m.group(1)
        if start and day<start: continue
        if end and day>end: continue
        rows.extend(decode_file(f))
    if not rows: raise ValueError('no .ticks files in requested range')
    d=pd.DataFrame(rows,columns=['time_msc','bid','ask','last','volume'])
    d=d.sort_values('time_msc',kind='stable').reset_index(drop=True)
    # exact duplicates are rejected by tick engine; preserve them in output to expose data issue
    d.to_csv(output_path,index=False)
    print(f'files={len(files)} ticks={len(d)} unique_days={pd.to_datetime(d.time_msc,unit="ms",utc=True).dt.date.nunique()}')
    print(f'utc={pd.to_datetime(d.time_msc.min(),unit="ms",utc=True)} .. {pd.to_datetime(d.time_msc.max(),unit="ms",utc=True)}')
    print(f'spread median={((d.ask-d.bid).median()):.4f} max={((d.ask-d.bid).max()):.4f}; duplicates={int(d.time_msc.duplicated().sum())}')
    print('source= Dukascopy USATECHIDXUSD quotes; NOT IC Markets MT5 export or SPX/USD ticks')
    return d

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--input',default='../tm3_pf/duka_ticks');ap.add_argument('--output',default='duka_ustec_ticks.csv')
    ap.add_argument('--from',dest='start');ap.add_argument('--to',dest='end');a=ap.parse_args()
    convert(a.input,a.output,a.start,a.end)
