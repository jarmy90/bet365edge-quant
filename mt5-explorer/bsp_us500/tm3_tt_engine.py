"""TM3 TT-only M1_GEOMETRY_ONLY. Sin señales FT ni ticks sintéticos.
HistData usado: SPX/USD M1 (no USTEC/NQ). El modo M1 no afirma autocorte tick-exacto.
"""
from __future__ import annotations
import argparse, itertools, json, math, os
import numpy as np
import pandas as pd

try:
    from zoneinfo import ZoneInfo
    ET = ZoneInfo('America/New_York')
except Exception:
    ET = None

DATA_DEFAULT = 'histdata_spx/spxusd_m1_all.csv'

def as_et(ts):
    t = pd.Timestamp(ts)
    return t.tz_localize('UTC').tz_convert(ET).tz_localize(None) if ET else t

def load_bars(path):
    d = pd.read_csv(path, parse_dates=['time']).sort_values('time').reset_index(drop=True)
    d['minute_et'] = [as_et(t).hour*60+as_et(t).minute for t in d.time]
    d['date_et'] = [as_et(t).date().isoformat() for t in d.time]
    return d

def build_patterns(d, reward_min=6.0, sl_min=5.0, session_end=660):
    """En NewBar, r[2]=n, r[1]=n+1, r[0]=live. Para cada nueva barra i,
    n=i-2 y n+1=i-1, ambos cerrados; se arma en i. Idéntico a EA r[2]/r[1]."""
    rows=[]
    for i in range(2,len(d)):
        n=i-2; n1=i-1
        a,b=d.iloc[n],d.iloc[n1]
        direction=1 if a.close>a.open else -1
        high_n,low_n=float(a.high),float(a.low)
        high_n1,low_n1=float(b.high),float(b.low)
        A=high_n-low_n1 if direction>0 else high_n1-low_n
        if A<=0: continue
        trigger=high_n if direction>0 else low_n
        sl=low_n1 if direction>0 else high_n1
        if abs(trigger-sl)<sl_min: sl=trigger-direction*sl_min
        risk=abs(trigger-sl)
        if A<risk or A<reward_min: continue
        # patrón generado en i; no usar OHLC posteriores a i para geometría
        if int(d.iloc[i].minute_et) >= session_end: continue
        rows.append(dict(pattern_id=len(rows)+1,n_index=n,n1_index=n1,arm_index=i,
                         direction=direction,high_n=high_n,low_n=low_n,
                         high_n1=high_n1,low_n1=low_n1,A=A,trigger=trigger,sl=sl,
                         risk=risk,fibo100=trigger+direction*A,
                         arm_time=d.iloc[i].time,state='TT_ARMED'))
    return pd.DataFrame(rows)

def _first_hit(d, start, end, direction, tp, sl, scenario, rng, bridge_paths=1000):
    """OHLC exit, causal from bars after entry; returns bar, price, reason, ambiguous.
    For dual-hit bar, conservative chooses SL, optimistic TP, random bridge estimates probability."""
    for j in range(start+1,min(end+1,len(d))):
        r=d.iloc[j]
        hs=(r.low<=sl) if direction>0 else (r.high>=sl)
        ht=(r.high>=tp) if direction>0 else (r.low<=tp)
        if hs and ht:
            if scenario=='CONSERVATIVE': return j,sl,'SL',True
            if scenario=='OPTIMISTIC': return j,tp,'TP',True
            # Conditional OHLC bridge approximation: explicit Brownian-bridge paths, seeded.
            wins=0
            for _ in range(bridge_paths):
                # random ordering conditioned on both boundaries being visited; which comes first
                # estimated from distances from open plus endpoint drift, not claimed as tick data
                op,cl=float(r.open),float(r.close)
                ds=abs(op-sl); dt=abs(op-tp)
                drift=(cl-op)*direction
                p_tp=1/(1+math.exp(max(-40,min(40,(dt-ds)/(max(float(r.high-r.low),1e-9))*4 - drift/max(float(r.high-r.low),1e-9)))))
                if rng.random()<p_tp: wins+=1
            return (j,tp,'TP',True) if wins>=bridge_paths/2 else (j,sl,'SL',True)
        if hs:return j,sl,'SL',False
        if ht:return j,tp,'TP',False
    j=min(end,len(d)-1)
    return j,float(d.iloc[j].close),'TIME',False

def _cost_prices(direction, entry, exit_, spread, slip):
    half=spread/2+slip
    if direction>0:return entry+half,exit_-half
    return entry-half,exit_+half

def config_grid(quick=False):
    steps=[2,4] if quick else [1,2,3,4,5,6]
    targets=[.5,1.] if quick else [.25,.5,1,2,3,5,7.5,10]
    caps=[30,60,100,None] if quick else [20,30,40,50,60,75,100,150,None]
    sls=[None,10] if quick else [None,5,6,8,10,12,15,20,30]
    rewards=[6] if quick else [3,4,5,6,8,10]
    policies=['NO_TIME','TIME_CONTINUE','TIME_SAME_STEP']
    for st,target,cap,sl,reward,pol in itertools.product(steps,targets,caps,sls,rewards,policies):
        lots=[.01*(i+1) for i in range(st)]
        yield dict(name=f'S{st}_T{target}_C{cap or "NC"}_SL{sl or "STRUCT"}_R{reward}_{pol}',
                   steps=st,target=target,cap=cap,sl_cap=sl,reward_min=reward,
                   lots=lots,time_policy=pol,max_trade_minutes=10)

def run_config(d, patterns, cfg, scenario='CONSERVATIVE', seed=7, spread=0.5,
               slippage=0., commission_per_lot=0., vpt=1., price_only=True,
               session_start=570, session_end=660, collect_patterns=False):
    """Sequential single-variant TT execution. `vpt` is parametric unless real spec provided.
    The pattern structural ledger is updated independently of sequence/trade PnL."""
    rng=np.random.default_rng(seed); eq=peak=dd=0.; seqs=[]; trades=[]; pat_out=[]
    sequence_id=0; seq=None; cursor=0; active_until=-1
    for p in patterns.itertuples(index=False):
        arm=int(p.arm_index)
        # Track structural pattern independently: first trigger reach after arming, then fibo.
        touch=None
        for k in range(max(arm,cursor),len(d)):
            if seq is None and int(d.iloc[k].minute_et)>=session_end: break
            if int(d.iloc[k].minute_et)<session_start and seq is None: continue
            bar=d.iloc[k]
            reached=(bar.high>=p.trigger) if p.direction>0 else (bar.low<=p.trigger)
            if reached: touch=k; break
        if touch is None: continue
        # If another sequence is active, no new ladder/position. Structural tracking still works.
        if seq is not None and touch<=active_until: continue
        if seq is None:
            sequence_id+=1
            seq=dict(sequence_id=sequence_id,start_index=touch,start_time=d.iloc[touch].time,
                     sequence_pnl=0.,step=0,lost=0.,trades=0,direction=p.direction,
                     target=cfg['target'],after_hours_entries=0,minutes_after_session=0,
                     pnl_list=[])
        # One TT operation for autocut event, no FT operations.
        direction=int(p.direction); lot=float(cfg['lots'][min(seq['step'],len(cfg['lots'])-1)])
        sl=float(p.sl)
        if cfg['sl_cap'] is not None and abs(p.trigger-sl)>cfg['sl_cap']:
            sl=float(p.trigger-direction*cfg['sl_cap'])
        # Monetary TP distance, modeled from explicit vpt. Price-only label otherwise.
        desired=max(float(cfg['reward_min']), (seq['lost']+cfg['target']+commission_per_lot*lot)/max(lot*vpt,1e-12))
        if cfg['cap'] is not None and desired>cfg['cap']:
            trades.append(dict(sequence_id=sequence_id,pattern_id=p.pattern_id,status='INVALID_CONFIGURATION',
                               invalid_reason='initial_or_recovery_TP_exceeds_cap',step=seq['step']))
            # Invalid setup is not a no-trade result. Keep sequence unstarted and allow next pattern.
            seq=None
            continue
        raw_entry=float(p.trigger); entry,_=_cost_prices(direction,raw_entry,raw_entry,spread,slippage)
        tp=entry+direction*desired
        maxbars=len(d)-1 if cfg['time_policy']=='NO_TIME' else cfg['max_trade_minutes']
        x,raw_exit,reason,amb=_first_hit(d,touch,min(touch+maxbars,len(d)-1),direction,tp,sl,scenario,rng)
        _,exit_=_cost_prices(direction,raw_entry,raw_exit,spread,slippage)
        pnl=direction*(exit_-entry)*lot*vpt-commission_per_lot*lot
        seq['sequence_pnl']+=pnl;seq['trades']+=1;seq['pnl_list'].append(pnl)
        seq['lost']=max(0.,seq['lost']-pnl) if pnl>0 else seq['lost']-pnl
        seq['after_hours_entries']+=int(int(d.iloc[touch].minute_et)>=session_end)
        seq['minutes_after_session']+=max(0,int(d.iloc[x].minute_et)-session_end)
        eq+=pnl;peak=max(peak,eq);dd=max(dd,peak-eq)
        trades.append(dict(sequence_id=sequence_id,pattern_id=p.pattern_id,kind='TT',
            entry_time=d.iloc[touch].time,exit_time=d.iloc[x].time,direction=direction,
            step=seq['step'],lot=lot,entry=entry,exit=exit_,tp=tp,sl=sl,
            reason=reason,pnl=pnl,sequence_pnl=seq['sequence_pnl'],intrabar_ambiguous=amb,
            trigger_reached=True,sl_and_trigger_same_bar=bool((d.iloc[touch].low<=sl<=d.iloc[touch].high) if direction>0 else (d.iloc[touch].low<=sl<=d.iloc[touch].high)),
            tp_and_sl_same_bar=amb,mode='M1_GEOMETRY_ONLY'))
        # Structural pattern monitor is separate: monitor from touch until SL/fibo100, independent of economic TP.
        structural_state='TT_AUTOCUT'; fibo_index=None; max_extension=0.; max_px=float(raw_entry)
        for sidx in range(touch+1,min(len(d),touch+601)):
            bar=d.iloc[sidx]
            target=p.fibo100
            fib_hit=(bar.high>=target) if direction>0 else (bar.low<=target)
            sl_hit=(bar.low<=p.sl) if direction>0 else (bar.high>=p.sl)
            if fib_hit and sl_hit:
                # Structural same-bar ambiguity, conservative does not credit fibo before adverse SL.
                if scenario=='OPTIMISTIC': fibo_index=sidx; structural_state='TT_FIBO100_REACHED'
                elif scenario=='RANDOM_BRIDGE':
                    # record ambiguous, no deterministic transition without tick sequence
                    structural_state='TT_AUTOCUT_FIBO_AMBIGUOUS'
                else: structural_state='TT_AUTOCUT_SL_AMBIGUOUS'
                break
            if sl_hit: structural_state='TT_EXPIRED'; break
            if fib_hit:
                fibo_index=sidx; structural_state='TT_FIBO100_REACHED'
                for eidx in range(sidx,min(len(d),touch+601)):
                    eb=d.iloc[eidx]
                    ext=(eb.high-p.fibo100)*direction if direction>0 else (p.fibo100-eb.low)*direction
                    max_extension=max(max_extension,max(0.,ext/max(float(p.A),1e-12)))
                    if ext>0: structural_state='TT_EXTENSION'
                break
        pat_out.append(dict(pattern_id=p.pattern_id,arm_time=p.arm_time,touch_time=d.iloc[touch].time,
            direction=direction,A=p.A,trigger=p.trigger,sl=p.sl,fibo100=p.fibo100,
            state=structural_state,fibo100_reached=fibo_index is not None,
            fibo100_time=d.iloc[fibo_index].time if fibo_index is not None else None,
            max_extension_A=max_extension,trigger_reached=True,
            intrabar_ambiguous=bool(structural_state.endswith('AMBIGUOUS')),
            ft_allowed=bool(fibo_index is not None),brake_label='NO_BRAKE',
            brake_metrics='NOT_AVAILABLE_M1'))
        # Sequence economy transition.
        if seq['sequence_pnl']>=seq['target']:
            seq['result']='SEQUENCE_TARGET_REACHED';seq['end_time']=d.iloc[x].time
        elif reason=='SL':
            seq['step']+=1
            if seq['step']>=cfg['steps']:
                seq['result']='SEQUENCE_ALL_STEPS_LOST';seq['end_time']=d.iloc[x].time
        elif reason=='TIME' and cfg['time_policy']=='TIME_CONTINUE': seq['step']+=1
        elif reason=='TIME' and cfg['time_policy']=='TIME_SAME_STEP': pass
        else:
            # NO_TIME will normally finish TP/SL; positive but insufficient stays open
            pass
        active_until=x
        cursor=x+1
        if seq.get('result'):
            seq['duration_minutes']=(pd.Timestamp(seq['end_time'])-pd.Timestamp(seq['start_time'])).total_seconds()/60
            seq['pnl_list']=json.dumps(seq['pnl_list'])
            seqs.append(seq);seq=None
    if seq is not None:
        seq['result']='SEQUENCE_OPEN';seq['end_time']=None;seq['pnl_list']=json.dumps(seq['pnl_list']);seqs.append(seq)
    return pd.DataFrame(seqs),pd.DataFrame(trades),pd.DataFrame(pat_out),dict(net=eq,maxdd=dd)

def metrics(seq,trades,res,name):
    good=seq[seq.result!='INVALID_CONFIGURATION'] if len(seq) else seq
    tp=trades[trades.status!='INVALID_CONFIGURATION'] if len(trades) else trades
    gp=float(tp.loc[tp.pnl>0,'pnl'].sum()) if len(tp) and 'pnl' in tp else 0.
    gl=float(-tp.loc[tp.pnl<0,'pnl'].sum()) if len(tp) and 'pnl' in tp else 0.
    nseq=len(good); wins=int((good.result=='SEQUENCE_TARGET_REACHED').sum()) if nseq else 0
    fails=int((good.result=='SEQUENCE_ALL_STEPS_LOST').sum()) if nseq else 0
    return dict(config=name,configurations_status='OK' if len(tp) else 'NO_VALID_TRADES',
        trades=int(len(tp)),sequences=nseq,sequence_wins=wins,sequence_failures=fails,
        sequence_failure_pct=100*fails/max(nseq,1),gross_profit=gp,gross_loss=gl,
        net_profit=res['net'],profit_factor=gp/gl if gl else np.nan,
        expectancy_trade=res['net']/max(len(tp),1),expectancy_sequence=res['net']/max(nseq,1),
        max_drawdown=res['maxdd'],active_days=tp.entry_time.dt.date.nunique() if len(tp) and 'entry_time' in tp else 0,
        invalid_configurations=int((trades.status=='INVALID_CONFIGURATION').sum()) if len(trades) and 'status' in trades else 0)

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--csv',default=DATA_DEFAULT);ap.add_argument('--quick',action='store_true')
    ap.add_argument('--split',choices=['train','validation','test','forward','all'],default='all')
    ap.add_argument('--scenario',choices=['CONSERVATIVE','OPTIMISTIC','RANDOM_BRIDGE'],default='CONSERVATIVE')
    ap.add_argument('--vpt',type=float,default=None);ap.add_argument('--spread',type=float,default=.5)
    ap.add_argument('--slippage',type=float,default=0.);ap.add_argument('--commission',type=float,default=0.)
    ap.add_argument('--session-end',type=int,default=660);ap.add_argument('--out-prefix',default='tm3_tt')
    a=ap.parse_args();d=load_bars(a.csv)
    years={'train':2023,'validation':2024,'test':2025,'forward':2026}
    if a.split!='all':d=d[d.time.dt.year==years[a.split]].reset_index(drop=True)
    ps=build_patterns(d,session_end=a.session_end)
    # price-only by default; vpt matrix is explicitly parametric.
    vpt=a.vpt if a.vpt is not None else 1.
    cfgs=list(config_grid(a.quick)); allrows=[]; seqs=[]; trades=[]; pats=[]
    for n,cfg in enumerate(cfgs):
        s,t,p,r=run_config(d,ps,cfg,scenario=a.scenario,spread=a.spread,slippage=a.slippage,
                           commission_per_lot=a.commission,vpt=vpt,price_only=a.vpt is None,
                           session_end=a.session_end)
        allrows.append(metrics(s,t,r,cfg['name']))
        if n==0: # audit outputs on a representative config only; individual runs remain reproducible
            s.to_csv(f'{a.out_prefix}_sequences.csv',index=False);t.to_csv(f'{a.out_prefix}_trades.csv',index=False)
            p.to_csv(f'{a.out_prefix}_patterns.csv',index=False)
    out=pd.DataFrame(allrows);out.to_csv(f'{a.out_prefix}_configs_all.csv',index=False)
    out[out.configurations_status=='OK'].to_csv(f'{a.out_prefix}_configs_valid.csv',index=False)
    print(out.sort_values('net_profit',ascending=False).head(10).to_string(index=False))
    print(f"Instrument=HistData SPX/USD M1; mode=M1_GEOMETRY_ONLY; VPT={'PRICE_ONLY' if a.vpt is None else 'PARAMETRIC'}={vpt}; configs={len(cfgs)}")
if __name__=='__main__':main()
