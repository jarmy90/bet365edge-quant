#!/usr/bin/env python3
"""Post-process MT5 exporter files without changing price/tick rows."""
import argparse,hashlib,json,os
from pathlib import Path
import pandas as pd

def digest(path):
 h=hashlib.sha256()
 with open(path,'rb') as f:
  for b in iter(lambda:f.read(1<<20),b''):h.update(b)
 return h.hexdigest()

def main():
 ap=argparse.ArgumentParser();ap.add_argument('csv');ap.add_argument('--spec',default='SYMBOL_SPEC.json');ap.add_argument('--audit',default='MT5_TICK_AUDIT.md');a=ap.parse_args()
 p=Path(a.csv);d=pd.read_csv(p)
 required={'time_msc','time_server','bid','ask','last','volume','volume_real','flags','spread','symbol','digits','tick_size','tick_value','tick_value_profit','tick_value_loss','contract_size','volume_min','volume_step','currency_profit','currency_base','currency_margin','account_currency'}
 miss=required-set(d.columns)
 if miss: raise SystemExit(f'Missing columns: {sorted(miss)}')
 t=pd.to_numeric(d.time_msc,errors='coerce');dt=pd.to_datetime(t,unit='ms',utc=True,errors='coerce');g=t.diff()/1000
 exact=int(d.duplicated().sum());dup_ms=int(t.duplicated().sum())
 report={'file':str(p.resolve()),'sha256':digest(p),'rows':len(d),'symbol_values':sorted(d.symbol.dropna().astype(str).unique()),
  'first_utc':str(dt.min()),'last_utc':str(dt.max()),'duplicate_rows_exact':exact,'duplicate_time_msc_rows_preserved':dup_ms,
  'out_of_order':int((g<0).sum()),'gaps_gt_1s':int((g>1).sum()),'gaps_gt_5s':int((g>5).sum()),'gaps_gt_60s':int((g>60).sum()),
  'bid_gt_ask':int((d.bid>d.ask).sum()),'spread_min':float(d.spread.min()),'spread_median':float(d.spread.median()),'spread_max':float(d.spread.max()),
  'trade_last_pct':float(100*d['last'].notna().mean()),'account_currency':sorted(d.account_currency.dropna().astype(str).unique())}
 Path(a.spec).write_text(json.dumps({k:(v[0] if isinstance(v,list) and len(v)==1 else v) for k,v in report.items() if k in []},indent=2)) if False else None
 # Copy first stable symbol spec row from export; values come from MT5 exporter, not inference.
 r=d.iloc[0]
 spec={k:r[k] for k in ['symbol','digits','tick_size','tick_value','tick_value_profit','tick_value_loss','contract_size','volume_min','volume_step','currency_profit','currency_base','currency_margin','account_currency']}
 spec['source']='MT5 SymbolInfo export';spec['csv_sha256']=report['sha256'];Path(a.spec).write_text(json.dumps(spec,indent=2,default=str))
 lines=['# MT5 real tick export audit','',f"- File: `{p}`",f"- SHA-256: `{report['sha256']}`",f"- Rows: {len(d)}",f"- Symbols: {report['symbol_values']}",f"- Coverage UTC: {report['first_utc']} .. {report['last_utc']}",f"- Exact duplicate rows: {exact}; duplicate timestamps preserved: {dup_ms}",f"- Out of order: {report['out_of_order']}",f"- Gaps >1/5/60 sec: {report['gaps_gt_1s']}/{report['gaps_gt_5s']}/{report['gaps_gt_60s']}",f"- Bid>ask: {report['bid_gt_ask']}",f"- Spread min/median/max: {report['spread_min']}/{report['spread_median']}/{report['spread_max']}",f"- Rows with trade last: {report['trade_last_pct']:.3f}%",'', 'The CSV was not modified; duplicate timestamps are not removed. Check MT5 time_server against UTC before strategy evaluation.']
 Path(a.audit).write_text('\n'.join(lines)+'\n')
 print(json.dumps(report,indent=2))
if __name__=='__main__':main()
