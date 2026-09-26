//+------------------------------------------------------------------+
//| QNT_BSP_MTF_Close_Intrabar_Explorer.mq5                          |
//| Research script only. No OrderSend, no CTrade, no live execution.|
//| Logic inspired by Zeiierman's CC BY-NC-SA 4.0 published script.  |
//+------------------------------------------------------------------+
#property strict
#property script_show_inputs
#property version "2.10"

input group "History"
input int MaxBars=12000;
input int WarmupBars=700;
input string CsvPrefix="QNT_BSP_MTF";
input bool UseRealVolume=false;
input int MaxHoldBars=240;
input double SlippagePoints=2.0;

input group "Profile engine"
input int ProfileLookback=600;
input int ProfileRows=72;
input int SwingLength=5;
input int VolumeLength=40;
input int AtrLength=14;
input double SearchATR=1.20;
input double MinNode=0.08;
input double MinEvidence=0.22;
input double ProfilePull=0.85;
input double MinScore=30.0;
input double BreakATR=0.10;

input group "Entry exploration"
input bool ExploreCloseEntry=true;
input bool ExploreIntrabarEntry=true;
input int RetestBars=30;
input double RetestToleranceATR=0.10;
input bool RequireRetestReaction=true;

input group "Initial stop"
enum STOP_MODE { STOP_RAW_PIVOT=0,STOP_FINAL_LEVEL=1,STOP_FIXED_ATR=2 };
input STOP_MODE StopMode=STOP_RAW_PIVOT;
input double StopBufferATR=0.25;
input double FixedStopATR=1.50;

input group "Exit parameters"
input double TP1_R=1.0;
input double TP2_R=2.0;
input double TP3_R=3.0;
input double TP1_ATR=1.0;
input double TP2_ATR=2.0;
input double Trail1_ATR=1.0;
input double Trail2_ATR=2.0;
input double BE_TriggerR=1.0;
input double BE_LockR=0.10;
input int TimeExitFast=24;
input int TimeExitSlow=72;
input int EMAPeriod=20;
input int SwingTrailBars=5;

#define EXIT_COUNT 15
enum ENTRY_MODE { ENTRY_CLOSE=0,ENTRY_INTRABAR=1 };

struct PROF { double bot,step,poc,mx; double tot[]; double buy[]; };
struct SIG { int pivot,confirm,entry; bool buy_side; double raw,node,level,evid,nstr,absorb,vscore,wscore,score,atr,poc; };
struct RESULT { int outbar; double entry,stop0,out,pnl_pts,r,mfe,mae; string reason; };

MqlRates R[];
double ATR[],AV[],EMA[];
int N=0;
ENUM_TIMEFRAMES TF=PERIOD_CURRENT;

double Clip(double x){return MathMax(0.0,MathMin(1.0,x));}
double Vol(int i){if(UseRealVolume && R[i].real_volume>0)return (double)R[i].real_volume;return (double)R[i].tick_volume;}
double BuyFill(double p){return p+SlippagePoints*_Point;}
double SellFill(double p){return p-SlippagePoints*_Point;}
string EntryName(ENTRY_MODE m){return m==ENTRY_CLOSE?"CLOSE_CONFIRM":"INTRABAR_RETEST";}
string ExitName(int m){string a[15]={"TP_1R","TP_2R","TP_3R","TP_1ATR","TP_2ATR","TRAIL_1ATR","TRAIL_2ATR","BE_THEN_2R","BE_THEN_TRAIL","STEP_TRAIL","TIME_FAST","TIME_SLOW","EMA_CLOSE","SWING_TRAIL","LEVEL_INVALIDATION"};return a[m];}
void Series()
{
 ArrayResize(ATR,N);ArrayResize(AV,N);ArrayResize(EMA,N);double alpha=2.0/(EMAPeriod+1.0);
 for(int i=0;i<N;i++)
 {
  double sum=0;int c=0;for(int j=MathMax(0,i-VolumeLength+1);j<=i;j++){sum+=Vol(j);c++;}AV[i]=c>0?sum/c:Vol(i);
  double tr=R[i].high-R[i].low;if(i>0)tr=MathMax(tr,MathMax(MathAbs(R[i].high-R[i-1].close),MathAbs(R[i].low-R[i-1].close)));
  ATR[i]=i==0?tr:(ATR[i-1]*(AtrLength-1)+tr)/AtrLength;
  EMA[i]=i==0?R[i].close:alpha*R[i].close+(1-alpha)*EMA[i-1];
 }
}
bool PivotLow(int p){if(p-SwingLength<0||p+SwingLength>=N)return false;for(int j=p-SwingLength;j<=p+SwingLength;j++)if(j!=p&&R[j].low<=R[p].low)return false;return true;}
bool PivotHigh(int p){if(p-SwingLength<0||p+SwingLength>=N)return false;for(int j=p-SwingLength;j<=p+SwingLength;j++)if(j!=p&&R[j].high>=R[p].high)return false;return true;}

bool Profile(int first,int last,PROF &q)
{
 if(first<0||last<first||last>=N)return false;double lo=R[first].low,hi=R[first].high;
 for(int i=first;i<=last;i++){lo=MathMin(lo,R[i].low);hi=MathMax(hi,R[i].high);}double span=MathMax(hi-lo,_Point*ProfileRows);
 q.bot=lo;q.step=span/ProfileRows;ArrayResize(q.tot,ProfileRows);ArrayResize(q.buy,ProfileRows);ArrayInitialize(q.tot,0);ArrayInitialize(q.buy,0);
 for(int i=first;i<=last;i++)
 {
  double l=R[i].low,h=R[i].high,rg=h-l,v=MathMax(Vol(i),0.0),bs=rg>0?Clip((R[i].close-l)/rg):0.5;
  int r0=(int)MathFloor((l-q.bot)/q.step),r1=(int)MathFloor((h-q.bot)/q.step);r0=MathMax(0,MathMin(ProfileRows-1,r0));r1=MathMax(0,MathMin(ProfileRows-1,r1));
  for(int r=r0;r<=r1;r++){double rl=q.bot+r*q.step,ov=rg>0?MathMax(0.0,MathMin(h,rl+q.step)-MathMax(l,rl)):q.step,fr=rg>0?ov/rg:1.0;if(fr>0){double x=v*fr;q.tot[r]+=x;q.buy[r]+=x*bs;}}
 }
 int pc=0;q.mx=q.tot[0];for(int r=1;r<ProfileRows;r++)if(q.tot[r]>q.mx){q.mx=q.tot[r];pc=r;}q.poc=q.bot+(pc+0.5)*q.step;return q.mx>0;
}
void Features(int p,bool support,double &vs,double &ws,double &ab)
{
 double vr=AV[p]>0?Vol(p)/AV[p]:1.0;vs=Clip((vr-0.8)/1.4);double rg=MathMax(R[p].high-R[p].low,_Point);
 double wick=support?MathMin(R[p].open,R[p].close)-R[p].low:R[p].high-MathMax(R[p].open,R[p].close);ws=Clip((wick/rg)/0.5);ab=0;
 int rad=MathMin(3,SwingLength);for(int i=MathMax(0,p-rad);i<=MathMin(N-1,p+rad);i++){double cr=MathMax(R[i].high-R[i].low,_Point),v=AV[i]>0?Vol(i)/AV[i]:1.0,b=MathAbs(R[i].close-R[i].open)/cr;ab=MathMax(ab,MathSqrt(Clip((0.4-b)/0.4)*Clip((v-1.0)/0.5)));}
}
void Node(double raw,bool support,double atr,PROF &q,double &node,double &ev,double &ns)
{
 double rad=MathMax(atr*SearchATR,q.step*2),mx=MathMax(q.mx,1e-10);node=raw;ev=-1;ns=0;
 for(int r=0;r<ProfileRows;r++){double p=q.bot+(r+0.5)*q.step,d=MathAbs(p-raw);if(d>rad)continue;double rv=q.tot[r],str=rv/mx,l=r>0?q.tot[r-1]:rv,x=r<ProfileRows-1?q.tot[r+1]:rv,nav=MathMax((l+x)*0.5,mx*0.01),pk=Clip((rv/nav-0.85)/0.65),bs=rv>0?Clip(q.buy[r]/rv):0.5,dir=support?bs:1-bs,e=0.5*str+0.2*pk+0.2*dir+0.1*(1-d/rad);if(e>ev){ev=e;node=p;ns=str;}}
 ev=MathMax(0.0,ev);
bool MakeSignal(int p,bool support,SIG &s)
{
 int confirm=p+SwingLength;if(confirm>=N-1)return false;PROF q;if(!Profile(MathMax(0,p-ProfileLookback+1),p,q))return false;
 double raw=support?R[p].low:R[p].high,atr=MathMax(ATR[p],_Point),node,ev,ns,vs,ws,ab;Node(raw,support,atr,q,node,ev,ns);Features(p,support,vs,ws,ab);
 if(ns<MinNode||ev<MinEvidence)return false;double level=raw+(node-raw)*ProfilePull*Clip(ev/0.65),score=100*(0.5*ev+0.2*ab+0.15*vs+0.15*ws);if(score<MinScore)return false;
 s.pivot=p;s.confirm=confirm;s.entry=-1;s.buy_side=support;s.raw=raw;s.node=node;s.level=level;s.evid=ev;s.nstr=ns;s.absorb=ab;s.vscore=vs;s.wscore=ws;s.score=score;s.atr=atr;s.poc=q.poc;return true;
}
bool Entry(SIG &s,ENTRY_MODE mode,double &price)
{
 if(mode==ENTRY_CLOSE){s.entry=s.confirm;price=s.buy_side?BuyFill(R[s.confirm].close):SellFill(R[s.confirm].close);return true;}
 int a=s.confirm+1,b=MathMin(N-1,a+RetestBars-1);double tol=s.atr*RetestToleranceATR;
 for(int i=a;i<=b;i++){bool touch=R[i].low<=s.level+tol&&R[i].high>=s.level-tol;bool react=!RequireRetestReaction||(s.buy_side?R[i].close>=s.level:R[i].close<=s.level);if(touch&&react){s.entry=i;price=s.buy_side?BuyFill(s.level):SellFill(s.level);return true;}}return false;
}
double InitialStop(SIG &s,double e){if(StopMode==STOP_FIXED_ATR)return s.buy_side?e-FixedStopATR*s.atr:e+FixedStopATR*s.atr;if(StopMode==STOP_FINAL_LEVEL)return s.buy_side?s.level-StopBufferATR*s.atr:s.level+StopBufferATR*s.atr;return s.buy_side?s.raw-StopBufferATR*s.atr:s.raw+StopBufferATR*s.atr;}
double SwingStop(bool buy,int i){int a=MathMax(0,i-SwingTrailBars+1);double x=buy?R[a].low:R[a].high;for(int j=a+1;j<=i;j++)x=buy?MathMin(x,R[j].low):MathMax(x,R[j].high);return x;}
}

void Sim(SIG &s,double entry,int m,RESULT &z)
{
 bool L=s.buy_side;double st0=InitialStop(s,entry),st=st0,risk=MathAbs(entry-st0),tp=0;z.entry=entry;z.stop0=st0;z.outbar=s.entry;z.out=entry;z.reason="NO_DATA";z.mfe=0;z.mae=0;if(risk<_Point){z.reason="INVALID_STOP";return;}
 if(m==0)tp=entry+(L?1:-1)*TP1_R*risk;if(m==1)tp=entry+(L?1:-1)*TP2_R*risk;if(m==2)tp=entry+(L?1:-1)*TP3_R*risk;if(m==3)tp=entry+(L?1:-1)*TP1_ATR*s.atr;if(m==4)tp=entry+(L?1:-1)*TP2_ATR*s.atr;if(m==7)tp=entry+(L?1:-1)*2*risk;
 int last=MathMin(N-1,s.entry+MaxHoldBars);
 for(int i=s.entry;i<=last;i++)
 {
  double fav=L?R[i].high-entry:entry-R[i].low,adv=L?entry-R[i].low:R[i].high-entry,fr=fav/risk;z.mfe=MathMax(z.mfe,fav/_Point);z.mae=MathMax(z.mae,adv/_Point);
  if(m==5&&i>s.entry)st=L?MathMax(st,R[i-1].close-Trail1_ATR*ATR[i-1]):MathMin(st,R[i-1].close+Trail1_ATR*ATR[i-1]);
  if(m==6&&i>s.entry)st=L?MathMax(st,R[i-1].close-Trail2_ATR*ATR[i-1]):MathMin(st,R[i-1].close+Trail2_ATR*ATR[i-1]);
  if((m==7||m==8)&&fr>=BE_TriggerR)st=L?MathMax(st,entry+BE_LockR*risk):MathMin(st,entry-BE_LockR*risk);
  if(m==8&&fr>=2)st=L?MathMax(st,R[i].close-Trail1_ATR*ATR[i]):MathMin(st,R[i].close+Trail1_ATR*ATR[i]);
  if(m==9){double lock=-1;if(fr>=1)lock=0;if(fr>=2)lock=1;if(fr>=3)lock=2;if(lock>=0)st=L?MathMax(st,entry+lock*risk):MathMin(st,entry-lock*risk);}
  if(m==13&&i>s.entry){double x=SwingStop(L,i-1);st=L?MathMax(st,x):MathMin(st,x);}if(m==14)st=L?s.level-BreakATR*ATR[i]:s.level+BreakATR*ATR[i];
  bool hs=L?R[i].low<=st:R[i].high>=st,ht=tp>0&&(L?R[i].high>=tp:R[i].low<=tp);
  if(hs){z.outbar=i;z.out=L?SellFill(st):BuyFill(st);z.reason="STOP_FIRST_CONSERVATIVE";break;}if(ht){z.outbar=i;z.out=L?SellFill(tp):BuyFill(tp);z.reason="TARGET";break;}
  bool close=false;if(m==10&&i-s.entry+1>=TimeExitFast){close=true;z.reason="TIME_FAST";}if(m==11&&i-s.entry+1>=TimeExitSlow){close=true;z.reason="TIME_SLOW";}if(m==12&&((L&&R[i].close<EMA[i])||(!L&&R[i].close>EMA[i]))){close=true;z.reason="EMA_CLOSE";}
  if(close){z.outbar=i;z.out=L?SellFill(R[i].close):BuyFill(R[i].close);break;}if(i==last){z.outbar=i;z.out=L?SellFill(R[i].close):BuyFill(R[i].close);z.reason="MAX_HOLD";}
 }
 double pnl=L?z.out-entry:entry-z.out;z.pnl_pts=pnl/_Point;z.r=pnl/risk;
}
void Header(int f){FileWrite(f,"symbol","timeframe","pivot_time","confirm_time","entry_time","exit_time","side","entry_mode","exit_model","raw","node","level","poc","evidence","node_strength","absorption","volume_score","wick_score","score","entry","stop0","exit","pnl_points","r_multiple","mfe_points","mae_points","bars_held","reason");}
void Row(int f,SIG &s,ENTRY_MODE em,int m,RESULT &z){FileWrite(f,_Symbol,EnumToString(TF),TimeToString(R[s.pivot].time,TIME_DATE|TIME_MINUTES),TimeToString(R[s.confirm].time,TIME_DATE|TIME_MINUTES),TimeToString(R[s.entry].time,TIME_DATE|TIME_MINUTES),TimeToString(R[z.outbar].time,TIME_DATE|TIME_MINUTES),s.buy_side?"LONG":"SHORT",EntryName(em),ExitName(m),DoubleToString(s.raw,_Digits),DoubleToString(s.node,_Digits),DoubleToString(s.level,_Digits),DoubleToString(s.poc,_Digits),s.evid,s.nstr,s.absorb,s.vscore,s.wscore,s.score,DoubleToString(z.entry,_Digits),DoubleToString(z.stop0,_Digits),DoubleToString(z.out,_Digits),z.pnl_pts,z.r,z.mfe,z.mae,z.outbar-s.entry+1,z.reason);}
void Process(int f,ENUM_TIMEFRAMES tf,int &cases,int &rows)
{
 TF=tf;ArrayFree(R);ArrayFree(ATR);ArrayFree(AV);ArrayFree(EMA);ArraySetAsSeries(R,false);N=CopyRates(_Symbol,tf,0,MathMax(MaxBars,WarmupBars+100),R);if(N<WarmupBars+100){Print("Skip ",EnumToString(tf),": solo ",N," barras");return;}Series();int local=0;
 for(int p=MathMax(WarmupBars,ProfileLookback+SwingLength);p<N-SwingLength-2;p++)
 {
  bool lo=PivotLow(p),hi=PivotHigh(p);
  for(int side=0;side<2;side++){bool support=side==0;if((support&&!lo)||(!support&&!hi))continue;SIG base;if(!MakeSignal(p,support,base))continue;
   for(int e=0;e<2;e++){ENTRY_MODE em=(ENTRY_MODE)e;if(em==ENTRY_CLOSE&&!ExploreCloseEntry)continue;if(em==ENTRY_INTRABAR&&!ExploreIntrabarEntry)continue;
    SIG s=base;double ep;if(!Entry(s,em,ep))continue;cases++;local++;for(int m=0;m<EXIT_COUNT;m++){RESULT z;Sim(s,ep,m,z);Row(f,s,em,m,z);rows++;}}}}
 Print(EnumToString(tf)," entry cases: ",local);
}
void OnStart()
{
 if(ProfileRows<24||ProfileLookback<100||SwingLength<2){Print("Entradas invalidas");return;}
 string stamp=TimeToString(TimeCurrent(),TIME_DATE|TIME_MINUTES);StringReplace(stamp,".","");StringReplace(stamp,":","");StringReplace(stamp," ","_");
 string fn=CsvPrefix+"_"+_Symbol+"_M5_M15_M30_H1_"+stamp+".csv";int f=FileOpen(fn,FILE_WRITE|FILE_CSV|FILE_ANSI,';');
 if(f==INVALID_HANDLE){Print("Error CSV ",GetLastError());return;}
 Header(f);int cases=0,rows=0;ENUM_TIMEFRAMES t[4]={PERIOD_M5,PERIOD_M15,PERIOD_M30,PERIOD_H1};
 for(int i=0;i<4;i++)Process(f,t[i],cases,rows);FileClose(f);
 Print("DONE cases=",cases," rows=",rows," file=MQL5/Files/",fn);Print("4 TF x 2 entradas x 15 salidas. Sin ordenes.");
}