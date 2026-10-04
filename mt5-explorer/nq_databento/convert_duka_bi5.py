#!/usr/bin/env python3
"""Decode Dukascopy hourly .bi5 tick files (raw format preserved separately).
Record layout: >iiiff (milliseconds from hour, ask int, bid int, ask volume, bid volume).
Instrument price scale varies: set --price-scale from verified instrument metadata; never guess.
"""
import argparse,glob,lzma,os,re,struct
from datetime import datetime,timezone
import pandas as pd

RX=re.compile(r'(?P<date>\d{4}-\d{2}-\d{2})_(?P<hour>\d{2})\.bi5$')
REC=struct.Struct('>iiiff')

def decode(path,scale):
    m=RX.search(os.path.basename(path))
    if not m: raise ValueError(f'unrecognized hourly BI5 name: {path}')
    with open(path,'rb') as f: raw=lzma.decompress(f.read(),format=lzma.FORMAT_ALONE)
    if len(raw)%REC.size: raise ValueError(f'{path}: decompressed bytes not multiple of 20')
    base=datetime.strptime(m['date']+m['hour'],'%Y-%m-%d%H').replace(tzinfo=timezone.utc)
    base_ms=int(base.timestamp()*1000); rows=[]
    for pos in range(0,len(raw),REC.size):
        ms,ask_i,bid_i,va,vb=REC.unpack_from(raw,pos)
        if not 0<=ms<3_600_000: raise ValueError(f'{path}: invalid ms offset {ms}')
        ask=ask_i/scale;bid=bid_i/scale
        rows.append((base_ms+ms,bid,ask,None,float(va+vb),va,vb))
    return rows

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--input',required=True);ap.add_argument('--output',required=True)
    ap.add_argument('--price-scale',required=True,type=float);ap.add_argument('--glob',default='*.bi5');a=ap.parse_args()
    files=sorted(glob.glob(os.path.join(a.input,a.glob)))
    if not files: raise SystemExit('No BI5 files found')
    rows=[]
    for f in files: rows.extend(decode(f,a.price_scale))
    d=pd.DataFrame(rows,columns=['time_msc','bid','ask','last','volume','volume_ask','volume_bid'])
    # Stable ordering only. Same timestamp records are legitimate and remain untouched.
    d=d.sort_values('time_msc',kind='stable').reset_index(drop=True)
    d['time_ns_utc']=d.time_msc.astype('int64')*1_000_000
    d.to_parquet(a.output,index=False)
    print(f'files={len(files)} ticks={len(d)} duplicate timestamps={int(d.time_msc.duplicated().sum())}; not removed')
    print(f'first={pd.to_datetime(d.time_msc.min(),unit="ms",utc=True)} last={pd.to_datetime(d.time_msc.max(),unit="ms",utc=True)}')
if __name__=='__main__':main()
