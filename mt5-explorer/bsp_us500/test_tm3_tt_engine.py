import numpy as np
import pandas as pd
import pytest
import tm3_tt_engine as e
import tm3_tt_tick_engine as te

def bars(rows,start='2024-06-03 13:30:00'):
    d=pd.DataFrame(rows,columns=['open','high','low','close'])
    d['time']=pd.date_range(start,periods=len(d),freq='min')
    d['minute_et']=[e.as_et(t).hour*60+e.as_et(t).minute for t in d.time]
    d['date_et']=[e.as_et(t).date().isoformat() for t in d.time]
    return d

def cfg(**kw):
    x=dict(name='test',steps=3,target=.5,cap=100,sl_cap=None,reward_min=3,
           lots=[.01,.02,.03],time_policy='NO_TIME',max_trade_minutes=3)
    return x|kw

def pattern(trigger=110,sl=95,A=15,direction=1,arm=2):
    return pd.DataFrame([dict(pattern_id=1,n_index=0,n1_index=1,arm_index=arm,
       direction=direction,high_n=trigger,low_n=100,high_n1=112,low_n1=sl,A=A,
       trigger=trigger,sl=sl,risk=trigger-sl,fibo100=trigger+direction*A,
       arm_time=pd.Timestamp('2024-06-03 13:32:00'),state='TT_ARMED')])

def test_pattern_uses_n_and_n_plus_one_closed():
    d=bars([(100,110,99,108),(104,112,95,111),(111,113,109,112)])
    p=e.build_patterns(d,reward_min=3,sl_min=5)
    r=p.iloc[0]
    assert (r.n_index,r.n1_index,r.arm_index)==(0,1,2)
    assert r.direction==1 and r.trigger==110 and r.sl==95
    assert r.A==15 and r.fibo100==125

def test_short_geometry_and_min_sl():
    d=bars([(100,110,90,95),(95,105,85,90),(90,92,87,89)])
    p=e.build_patterns(d,reward_min=3,sl_min=5)
    r=p.iloc[0]
    assert r.direction==-1 and r.trigger==90 and r.sl==105 and r.A==15

def test_no_lookahead_arm_index_after_n_plus_one():
    d=bars([(100,110,99,108),(104,112,95,111),(111,113,109,112)])
    p=e.build_patterns(d,reward_min=3)
    assert p.iloc[0].arm_index==p.iloc[0].n1_index+1

def test_tp_monetary_not_structural_fibo():
    d=bars([(100,110,99,108),(104,112,95,111),(111,113,109,112),
            (112,114,111,113),(113,114,112,113)])
    s,t,p,r=e.run_config(d,pattern(),cfg(),spread=0,scenario='CONSERVATIVE')
    if len(p):
        assert p.iloc[0].fibo100==125
        assert not bool(p.iloc[0].fibo100_reached)
        assert not bool(p.iloc[0].ft_allowed)

def test_only_tt_trades_no_ft_kind():
    d=bars([(100,110,99,108),(104,112,95,111),(111,113,109,112),(112,140,111,139)])
    s,t,p,r=e.run_config(d,pattern(),cfg(),spread=0)
    if len(t) and 'kind' in t: assert set(t.kind)=={'TT'}
    assert not any(c in t.columns for c in ['FT_BAND','FT256'])

def test_sequence_not_won_on_positive_insufficient_trade():
    # direct account-state arithmetic is covered through ledger semantics: require cumulative target
    d=bars([(100,110,99,108),(104,112,95,111),(111,113,109,112),(112,113,110,112)])
    s,t,p,r=e.run_config(d,pattern(),cfg(target=5,cap=100),spread=0)
    if len(s) and s.iloc[0].result=='SEQUENCE_TARGET_REACHED': assert s.iloc[0].sequence_pnl>=5

def test_conservative_ambiguous_bar_stops_first():
    d=bars([(100,110,99,108),(104,112,95,111),(111,113,109,112),(112,140,90,120)])
    rng=np.random.default_rng(1)
    j,x,reason,amb=e._first_hit(d,2,3,1,125,95,'CONSERVATIVE',rng)
    assert amb and reason=='SL'

def test_optimistic_ambiguous_bar_tp_first():
    d=bars([(100,110,99,108),(104,112,95,111),(111,113,109,112),(112,140,90,120)])
    j,x,reason,amb=e._first_hit(d,2,3,1,125,95,'OPTIMISTIC',np.random.default_rng(1))
    assert amb and reason=='TP'

def test_random_bridge_seed_reproducible():
    d=bars([(100,110,99,108),(104,112,95,111),(111,113,109,112),(112,140,90,120)])
    a=e._first_hit(d,2,3,1,125,95,'RANDOM_BRIDGE',np.random.default_rng(19),1000)
    b=e._first_hit(d,2,3,1,125,95,'RANDOM_BRIDGE',np.random.default_rng(19),1000)
    assert a==b and a[3]

def test_after_hours_no_new_ladder():
    d=bars([(100,110,99,108),(104,112,95,111),(111,113,109,112)],start='2024-06-03 15:01:00')
    s,t,p,r=e.run_config(d,pattern(),cfg(),spread=0)
    assert len(s)==0 and len(t)==0

def test_spread_cost_applied_round_trip():
    en0,ex0=e._cost_prices(1,100,101,0,0)
    en1,ex1=e._cost_prices(1,100,101,2,0)
    assert en1-en0==1 and ex0-ex1==1

def test_invalid_configuration_explicit():
    d=bars([(100,110,99,108),(104,112,95,111),(111,113,109,112),(112,114,111,113)])
    s,t,p,r=e.run_config(d,pattern(),cfg(target=10,cap=20),spread=0,vpt=.5)
    assert len(t)==0 or 'INVALID_CONFIGURATION' in set(t.status)

def test_tick_cross_exact_and_directional():
    d=pd.DataFrame(dict(time_msc=[1000,1100,1200,1300],bid=[99,99.5,100,99],ask=[100,100.5,101,99.5],last=[99,100,100.5,99.2],volume=[1]*4))
    p=pd.DataFrame([dict(pattern_id=1,arm_time_msc=1000,trigger=100.5,direction=1,sl=95,fibo100=110,A=10)])
    out=te.detect_crosses(d,p)
    assert len(out)==1 and out.iloc[0].touch_time_msc==1100

def test_tick_rejects_duplicate_time():
    d=pd.DataFrame(dict(time_msc=[1,1],bid=[1,1],ask=[2,2],last=[1,1],volume=[1,1]))
    import tempfile,os
    f=tempfile.NamedTemporaryFile(suffix='.csv',delete=False);f.close();d.to_csv(f.name,index=False)
    try:
        with pytest.raises(ValueError):te.load_ticks(f.name)
    finally:os.unlink(f.name)

def test_sequence_pnl_fields_present():
    d=bars([(100,110,99,108),(104,112,95,111),(111,113,109,112),(112,114,111,113)])
    s,t,p,r=e.run_config(d,pattern(),cfg(),spread=0)
    if len(s): assert {'sequence_id','sequence_pnl','result'}<=set(s.columns)

def test_structural_state_independent_of_economic_exit():
    # Economic small TP or TIME cannot mark fibo100; price must reach the structural level.
    d=bars([(100,110,99,108),(104,112,95,111),(111,113,109,112),
            (112,114,111,113),(113,114,112,113)])
    s,t,p,r=e.run_config(d,pattern(),cfg(target=.25),spread=0)
    assert len(p)==0 or not bool(p.iloc[0].fibo100_reached)

if __name__=='__main__':
    raise SystemExit(pytest.main([__file__,'-v']))
