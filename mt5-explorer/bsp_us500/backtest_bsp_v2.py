import json, math, os, time, argparse
import pandas as pd
import numpy as np
P = dict(profLb=600, profRows=72, swingLen=5, volLen=40, atrLen=14,
         searchAtr=1.20, minNode=0.08, minEv=0.22, pullMax=0.85,
         minScore=30.0, absRad=3, pivVolX=2.2, absBodyMax=0.40, absVolX=1.5,
         retestBars=30, stopBufAtr=0.25, maxHold=240)
BASE6 = [("SHORT","TP_1ATR"),("SHORT","TP_2ATR"),("SHORT","TIME_FAST"),
         ("SHORT","SWING_TRAIL"),("LONG","TP_2ATR"),("LONG","BE_THEN_TRAIL")]
ENTRIES = ["RETEST_TOUCH","RETEST_CONFIRMED","CLOSE_CONFIRM"]
def load_yahoo(path):
    d = json.load(open(path))
    r = d["chart"]["result"][0]
    q = r["indicators"]["quote"][0]
    df = pd.DataFrame({"time": pd.to_datetime(r["timestamp"], unit="s"),
                       "open": q["open"],"high": q["high"],"low": q["low"],
                       "close": q["close"],"vol": q.get("volume")})
    df = df.dropna(subset=["open","high","low","close"]).reset_index(drop=True)
    df["vol"] = df["vol"].fillna(0)
    return df
def wilder_atr(h,l,c,n):
    tr = np.maximum(h-l, np.maximum(np.abs(h-np.roll(c,1)), np.abs(l-np.roll(c,1))))
    tr[0]=h[0]-l[0]
    atr = np.empty_like(tr,dtype=float); atr[0]=tr[0]
    for i in range(1,len(tr)): atr[i]=(atr[i-1]*(n-1)+tr[i])/n
    return atr
def profile_fast(lo,hi,cl,vv,first,last,rows):
    seg_lo=lo[first:last+1].min(); seg_hi=hi[first:last+1].max()
    span=max(seg_hi-seg_lo,1e-9*rows); bot=seg_lo; step=span/rows
    tot=np.zeros(rows); buy=np.zeros(rows)
    L=lo[first:last+1]; H=hi[first:last+1]; C=cl[first:last+1]
    V=np.maximum(vv[first:last+1],0.0)
    rg=H-L
    bs=np.where(rg>0,np.clip((C-L)/np.maximum(rg,1e-9),0,1),0.5)
    r0=np.clip(np.floor((L-bot)/step).astype(int),0,rows-1)
    r1=np.clip(np.floor((H-bot)/step).astype(int),0,rows-1)
    sing=(r0==r1)|(rg<=0)
    np.add.at(tot,r0[sing],V[sing]); np.add.at(buy,r0[sing],V[sing]*bs[sing])
    for k in np.where(~sing)[0]:
        a,b=r0[k],r1[k]; _rg=rg[k]; _v=V[k]; _b=bs[k]
        for rr in range(a,b+1):
            ov=max(0.0,min(H[k],bot+(rr+1)*step)-max(L[k],bot+rr*step))
            fr=ov/_rg if _rg>0 else 1.0
            if fr>0: tot[rr]+=_v*fr; buy[rr]+=_v*fr*_b
    return bot,step,tot,buy,tot.max()
def signal_at(o,h,l,c,v,av,atr,p,supp):
    n=len(c); first=max(0,p-P["profLb"]+1); last=p
    bot,step,tot,buy,mx=profile_fast(l,h,c,v,first,last,P["profRows"])
    if mx<=0: return None
    raw=l[p] if supp else h[p]
    atrp=max(atr[p],1e-9); rad=max(atrp*P["searchAtr"],step*2.0)
    be,bnode,bns=-1.0,raw,0.0
    for rr in range(P["profRows"]):
        pr=bot+(rr+0.5)*step; dd=abs(pr-raw)
        if dd>rad: continue
        rv=tot[rr]; s=rv/mx
        lv=tot[rr-1] if rr>0 else rv; xv=tot[rr+1] if rr<P["profRows"]-1 else rv
        nav=max((lv+xv)*0.5,mx*0.01); pk=np.clip((rv/nav-0.85)/0.65,0,1)
        bsv=np.clip(buy[rr]/rv,0,1) if rv>0 else 0.5
        dr=bsv if supp else 1-bsv
        e=0.5*s+0.2*pk+0.2*dr+0.1*(1-dd/rad)
        if e>be: be,bnode,bns=e,pr,s
    ev=max(be,0.0)
    if bns<P["minNode"] or ev<P["minEv"]: return None
    vr=v[p]/av[p] if av[p]>0 else 1.0
    vSc=np.clip((vr-0.8)/(P["pivVolX"]-0.8),0,1)
    rg=max(h[p]-l[p],1e-9)
    wk=(min(o[p],c[p])-l[p]) if supp else (h[p]-max(o[p],c[p]))
    wSc=np.clip((wk/rg)/0.50,0,1)
    ab=0.0
    for i in range(max(0,p-P["absRad"]),min(n,p+P["absRad"]+1)):
        cr=max(h[i]-l[i],1e-9); r2=v[i]/av[i] if av[i]>0 else 1.0
        b=abs(c[i]-o[i])/cr
        ab=max(ab,math.sqrt(np.clip((P["absBodyMax"]-b)/P["absBodyMax"],0,1)*np.clip((r2-1.0)/(P["absVolX"]-1.0),0,1)))
    lvl=raw+(bnode-raw)*P["pullMax"]*np.clip(ev/0.65,0,1)
    sc=100.0*(0.50*ev+0.20*ab+0.15*vSc+0.15*wSc)
    if sc<P["minScore"]: return None
    return dict(raw=raw,node=bnode,level=lvl,evid=ev,nstr=bns,abso=ab,score=sc,atrp=atrp)
def build_signals(df):
    o=df.open.values;h=df.high.values;l=df.low.values;c=df.close.values
    v=df.vol.values.astype(float); n=len(c); sw=P["swingLen"]
    if np.nanmax(v)<=0: v=np.ones(n)  # HistData SPX trae vol=0 -> peso uniforme
    av=pd.Series(v).rolling(P["volLen"],min_periods=1).mean().values
    atr=wilder_atr(h,l,c,P["atrLen"]); ema=pd.Series(c).ewm(span=20,adjust=False).mean().values
    is_lo=np.zeros(n,bool); is_hi=np.zeros(n,bool)
    for p in range(sw,n-sw):
        is_lo[p]=l[p]<l[p-sw:p].min() and l[p]<l[p+1:p+sw+1].min()
        is_hi[p]=h[p]>h[p-sw:p].max() and h[p]>h[p+1:p+sw+1].max()
    sigs=[]; t0=time.time(); start=max(700,P["profLb"]+sw)
    for p in range(start,n-sw-2):
        for supp in (True,False):
            if supp and not is_lo[p]: continue
            if not supp and not is_hi[p]: continue
            s=signal_at(o,h,l,c,v,av,atr,p,supp)
            if s is None: continue
            s.update(piv=p,supp=supp,conf=p+sw,piv_time=df.time.iloc[p],side="LONG" if supp else "SHORT")
            sigs.append(s)
    return sigs,o,h,l,c,v,atr,ema,time.time()-t0
def enter_px(sig,o,h,l,c,atr,n,cost,mode):
    lvl=sig["level"]; supp=sig["supp"]; conf=sig["conf"]; tol=atr[conf]*0.10
    lim=min(n,conf+1+P["retestBars"])
    if mode=="CLOSE_CONFIRM":
        ei=conf; return ei,(c[ei]+cost if supp else c[ei]-cost)
    for i in range(conf+1,lim):
        if not (l[i]<=lvl+tol and h[i]>=lvl-tol): continue
        if mode=="RETEST_TOUCH":
            return i,(lvl+cost if supp else lvl-cost)
        if ((c[i]>=lvl) if supp else (c[i]<=lvl)) and i+1<n:
            return i+1,(o[i+1]+cost if supp else o[i+1]-cost)
    return -1,None
def sim_px(o,h,l,c,atr,ei,ep,st0,risk,atrp,supp,ex,cost):
    sgn=1 if supp else -1
    tp=None
    if ex=="TP_1ATR": tp=ep+sgn*1.0*atrp
    elif ex=="TP_2ATR": tp=ep+sgn*2.0*atrp
    st_act=st0; st_nxt=st0
    lastb=min(len(c)-1,ei+P["maxHold"])
    for i in range(ei,lastb+1):
        if (supp and o[i]<st_act) or ((not supp) and o[i]>st_act):
            return (o[i]-cost if supp else o[i]+cost),i,"GAP_STOP"
        hs=(l[i]<=st_act) if supp else (h[i]>=st_act)
        ht=(tp is not None) and ((h[i]>=tp) if supp else (l[i]<=tp))
        if hs: return (st_act-cost if supp else st_act+cost),i,"STOP"
        if ht: return (tp-cost if supp else tp+cost),i,"TARGET"
        if ex=="TIME_FAST" and i-ei+1>=24:
            return (c[i]-cost if supp else c[i]+cost),i,"TIME_FAST"
        if i==lastb:
            return (c[i]-cost if supp else c[i]+cost),i,"MAX_HOLD"
        fav=(h[i]-ep) if supp else (ep-l[i]); fr=fav/risk
        cand=None
        if ex=="BE_THEN_TRAIL":
            if fr>=1.0: cand=ep+0.10*risk if supp else ep-0.10*risk
            if fr>=2.0:
                t2=c[i]-1.0*atr[i] if supp else c[i]+1.0*atr[i]
                cand=t2 if cand is None else (max(cand,t2) if supp else min(cand,t2))
        elif ex=="SWING_TRAIL":
            a=max(0,i-5); cand=l[a:i+1].min() if supp else h[a:i+1].max()
        if cand is not None: st_nxt=max(st_nxt,cand) if supp else min(st_nxt,cand)
        st_act=st_nxt
    return ep,ei,"NO_DATA"
def run_trades(sigs,o,h,l,c,atr,cost,minrisk,symbol="ES",tf="H1"):
    rows=[]; ninv=0; n=len(c)
    for s in sigs:
        supp=s["supp"]; atrp=s["atrp"]
        for (sd,ex) in BASE6:
            if (sd=="LONG")!=supp: continue
            for em in ENTRIES:
                ei,ep=enter_px(s,o,h,l,c,atr,n,cost,em)
                if ei<0: continue
                st0=s["raw"]-P["stopBufAtr"]*atrp if supp else s["raw"]+P["stopBufAtr"]*atrp
                if (supp and not st0<ep) or ((not supp) and not st0>ep):
                    ninv+=1; continue
                risk=abs(ep-st0)
                if risk<minrisk*atrp: continue
                px,ox,reason=sim_px(o,h,l,c,atr,ei,ep,st0,risk,atrp,supp,ex,cost)
                r=((px-ep) if supp else (ep-px))/risk
                rows.append(dict(signal_id="|".join([symbol,tf,str(s["piv_time"]),sd]),side=sd,entry_mode=em,exit_model=ex,pivot_time=str(s["piv_time"]),entry_idx=ei,exit_idx=ox,entry_px=ep,exit_px=px,stop0=st0,risk=risk,atrp=atrp,r_multiple=r,score=s["score"],evidence=s["evid"],node_strength=s["nstr"],absorption=s["abso"],bars_held=ox-ei+1,reason=reason))
    return pd.DataFrame(rows),ninv
def pf(x):
    x=np.asarray(x,float)
    pos=x[x>0].sum(); neg=abs(x[x<0].sum())
    return pos/neg if neg>0 else np.nan
def agg_combo(x):
    r=x["r_multiple"].values; tot=float(r.sum()); n=len(r)
    w=float(np.sort(r)[-5:].sum()) if n>=5 else tot
    clip=np.clip(r,-5,5); k=max(1,int(0.05*n))
    trim=float(np.sort(r)[k:n-k].mean()) if n-2*k>0 else float(r.mean())
    return pd.Series({"n_signals":x["signal_id"].nunique(),"trades":len(x),"net_R":tot,"avg_R":float(r.mean()),"mediana_R":float(np.median(r)),"trim5":trim,"win%":float((r>0).mean()*100),"PF":pf(r),"avg_bars":float(x["bars_held"].mean()),"net_exTop5":tot-w,"%top5":100*w/tot if tot!=0 else np.nan,"net_winsor5":float(clip.sum()),"avg_winsor5":float(clip.mean())})
def boot_stats(r,nboot=1000,seed=7):
    rng=np.random.default_rng(seed); n=len(r)
    if n==0: return (np.nan,)*6
    samp=r[rng.integers(0,n,(nboot,n))]
    nets=samp.sum(axis=1); pfs=np.array([pf(s) for s in samp])
    return float(nets.mean()),float(np.percentile(nets,5)),float(np.percentile(nets,95)),float(np.nanmean(pfs)),float(np.nanpercentile(pfs,5)),float(np.nanpercentile(pfs,95))
if __name__=="__main__":
    ap=argparse.ArgumentParser()
    ap.add_argument("--file",default="es_1h.json"); ap.add_argument("--cost",type=float,default=0.5)
    ap.add_argument("--minrisk",type=float,default=0.30); ap.add_argument("--nboot",type=int,default=1000)
    ap.add_argument("--csv",default=None); ap.add_argument("--out",default=None); ap.add_argument("--md",default=None)
    ap.add_argument("--symbol",default="ES"); ap.add_argument("--tf",default="H1")
    a=ap.parse_args()
    tA=time.time()
    if a.csv: df=pd.read_csv(a.csv,parse_dates=["time"]); df["vol"]=df["vol"].fillna(0)
    else: df=load_yahoo(a.file)
    print("barras=%d %s->%s" % (len(df),df.time.min(),df.time.max()),flush=True)
    sigs,o,h,l,c,v,atr,ema,tsig=build_signals(df)
    print("signals=%d t_signals=%.1fs" % (len(sigs),tsig),flush=True)
    t,inv=run_trades(sigs,o,h,l,c,atr,a.cost,a.minrisk,symbol=a.symbol,tf=a.tf)
    print("trades=%d invalid_stop=%d t_total=%.1fs" % (len(t),inv,time.time()-tA),flush=True)
    t.to_csv(a.out or os.path.splitext(a.csv or a.file)[0]+"_v2_trades.csv",index=False,sep=";")
    M=open(a.md or "RESULTADOS_V2.md","w"); W=M.write
    W("# BSP v2 cost=%s minrisk=%s\n\nbarras=%d signals=%d trades=%d invalid_stop=%d\n\n" % (a.cost,a.minrisk,len(df),len(sigs),len(t),inv))
    g=t.groupby(["side","entry_mode","exit_model"]).apply(agg_combo,include_groups=False).reset_index()
    W("## (a) Top combos\n\n"+g.sort_values("net_R",ascending=False).round(3).to_string(index=False)+"\n\n")
    print(g.sort_values("net_R",ascending=False).round(3).to_string(index=False),flush=True)
    cols=["side","entry_mode","exit_model","trades","net_R","net_exTop5","%top5","net_winsor5","avg_winsor5","mediana_R","PF"]
    W("## (a2) Sin top5/winsor\n\n"+g.sort_values("net_exTop5",ascending=False)[cols].round(3).to_string(index=False)+"\n\n")
    e=t.groupby("entry_mode").apply(agg_combo,include_groups=False).reset_index()
    W("## (b) Entradas\n\n"+e.round(3).to_string(index=False)+"\n\n"); print(e.round(3).to_string(index=False),flush=True)
    srows=[]
    for mr in [0.20,0.30,0.40]:
        for co in [0.25,0.50,0.75]:
            tt,_=run_trades(sigs,o,h,l,c,atr,co,mr)
            if len(tt)==0: continue
            gg=tt.groupby(["side","entry_mode","exit_model"]).apply(agg_combo,include_groups=False).reset_index()
            for _,r in gg.iterrows():
                srows.append(dict(cost=co,minrisk=mr,combo="%s|%s|%s" % (r["side"],r["entry_mode"],r["exit_model"]),trades=int(r["trades"]),net=round(float(r["net_R"]),2),avg=round(float(r["avg_R"]),3)))
    S=pd.DataFrame(srows)
    W("## (c) Sensibilidad\n\n"+S.round(3).to_string(index=False)+"\n\n"); print(S.round(3).to_string(index=False),flush=True)
    sig_order=sorted(t["signal_id"].unique())
    q1=int(len(sig_order)*0.5); q2=int(len(sig_order)*0.75)
    segm={s:k for k,ss in {"dev":sig_order[:q1],"val":sig_order[q1:q2],"test":sig_order[q2:]}.items() for s in ss}
    t["seg"]=t["signal_id"].map(segm)
    pv=t.groupby(["side","entry_mode","exit_model","seg"]).r_multiple.sum().unstack(fill_value=0)
    W("## (d1) Temporal dev/val/test net_R\n\n"+pv.round(2).to_string()+"\n\n"); print(pv.round(2).to_string(),flush=True)
    t["month"]=pd.to_datetime(t["pivot_time"]).dt.to_period("M").astype(str)
    t["quarter"]=pd.to_datetime(t["pivot_time"]).dt.to_period("Q").astype(str)
    mrows=[]
    for k,x in t.groupby(["side","entry_mode","exit_model"]):
        mn=x.groupby("month").r_multiple.sum(); qt=x.groupby("quarter").r_multiple.sum()
        tot=x.r_multiple.sum(); t5=x.r_multiple.sort_values(ascending=False).head(5).sum()
        mrows.append(dict(combo="|".join(k),meses_pos=int((mn>0).sum()),meses_tot=int(mn.count()),trim_pos=int((qt>0).sum()),trim_tot=int(qt.count()),mejor_trim=round(float(qt.max()),2),peor_trim=round(float(qt.min()),2),pct_top5=round(100*t5/tot,1) if tot!=0 else np.nan))
    MD=pd.DataFrame(mrows)
    W("## (d2) Mensual/trimestral\n\n"+MD.round(2).to_string(index=False)+"\n\n"); print(MD.round(2).to_string(index=False),flush=True)
    B=[]
    for k,x in t.groupby(["side","entry_mode","exit_model"]):
        by=x.groupby("signal_id").r_multiple.sum().values
        m,p5,p95,mpf,f5,f95=boot_stats(by,a.nboot)
        B.append(dict(combo="|".join(k),n=len(by),boot_mean=round(m,2),net_p5=round(p5,2),net_p95=round(p95,2),pf_mean=round(mpf,3),pf_p5=round(f5,3),pf_p95=round(f95,3)))
    BD=pd.DataFrame(B)
    W("## (e) Bootstrap x signal_id\n\n"+BD.round(3).to_string(index=False)+"\n\n"); print(BD.round(3).to_string(index=False),flush=True)
    F=["\n## (f) Score vs R (terciles, sin filtrar)\n\n"]
    for col in ["evidence","node_strength","absorption","score"]:
        F.append("corr(%s,R)=%.4f\n" % (col,t[col].corr(t["r_multiple"])))
        try:
            qq=pd.qcut(t[col],3,duplicates="drop")
            labs=["T%d"%(i+1) for i in range(len(qq.cat.categories))]
            t["q"]=qq.cat.rename_categories(labs)
            F.append(t.groupby("q",observed=True).r_multiple.agg(["count","mean","sum"]).round(3).to_string()+"\n")
        except Exception as ex:
            F.append("qcut fallo: %s\n" % ex)
    W("".join(F)+"\n## (g) Veredicto: si net_exTop5<0 y p5 bootstrap<0 en todos los combos, el edge NO sobrevive a costes.\n")
    print("".join(F),flush=True); M.close(); print("OK csv+md escritos",flush=True)
