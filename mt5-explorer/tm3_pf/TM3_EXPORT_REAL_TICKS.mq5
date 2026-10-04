//+------------------------------------------------------------------+
//| TM3_EXPORT_REAL_TICKS.mq5                                        |
//| Exporta ticks reales del símbolo del chart vía CopyTicksRange.   |
//| No sintetiza, ajusta ni rellena precios. Fechas input en UTC.     |
//+------------------------------------------------------------------+
#property strict
#property script_show_inputs
#property version "1.00"
#property description "Export real CopyTicksRange ticks to CSV; date inputs are UTC"

input datetime InpFromUTC=D'2025.07.01 00:00:00';
input datetime InpToUTC=D'2025.07.02 00:00:00'; // exclusive
input int InpBlockMinutes=5;
input string InpPrefix=""; // optional prefix before SYMBOL_YYYYMMDD_YYYYMMDD
input bool InpExportSpec=true;
input int InpMaxTicksPerBlock=200000;

string SafeSymbol(string s){StringReplace(s,"/","_");StringReplace(s,"\\","_");StringReplace(s," ","_");return s;}
string DateTag(datetime t){MqlDateTime x;TimeToStruct(t,x);return StringFormat("%04d%02d%02d",x.year,x.mon,x.day);}
string OutName(){string p=(InpPrefix==""?"":InpPrefix+"_");return p+SafeSymbol(_Symbol)+"_ICMARKETS_TICKS_"+DateTag(InpFromUTC)+"_"+DateTag(InpToUTC)+".csv";}

void WriteSpec()
{
   string fn="SYMBOL_SPEC.json";int h=FileOpen(fn,FILE_WRITE|FILE_TXT|FILE_ANSI);
   if(h==INVALID_HANDLE){Print("No se pudo crear SYMBOL_SPEC.json error=",GetLastError());return;}
   FileWriteString(h,"{\n");
   FileWriteString(h,"  \"symbol\": \""+_Symbol+"\",\n");
   FileWriteString(h,"  \"digits\": "+IntegerToString((int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS))+",\n");
   FileWriteString(h,"  \"tick_size\": "+DoubleToString(SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE),10)+",\n");
   FileWriteString(h,"  \"tick_value\": "+DoubleToString(SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_VALUE),8)+",\n");
   FileWriteString(h,"  \"tick_value_profit\": "+DoubleToString(SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_VALUE_PROFIT),8)+",\n");
   FileWriteString(h,"  \"tick_value_loss\": "+DoubleToString(SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_VALUE_LOSS),8)+",\n");
   FileWriteString(h,"  \"contract_size\": "+DoubleToString(SymbolInfoDouble(_Symbol,SYMBOL_TRADE_CONTRACT_SIZE),8)+",\n");
   FileWriteString(h,"  \"volume_min\": "+DoubleToString(SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN),4)+",\n");
   FileWriteString(h,"  \"volume_step\": "+DoubleToString(SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP),4)+",\n");
   FileWriteString(h,"  \"volume_max\": "+DoubleToString(SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX),4)+",\n");
   FileWriteString(h,"  \"currency_profit\": \""+SymbolInfoString(_Symbol,SYMBOL_CURRENCY_PROFIT)+"\",\n");
   FileWriteString(h,"  \"currency_base\": \""+SymbolInfoString(_Symbol,SYMBOL_CURRENCY_BASE)+"\",\n");
   FileWriteString(h,"  \"currency_margin\": \""+SymbolInfoString(_Symbol,SYMBOL_CURRENCY_MARGIN)+"\",\n");
   FileWriteString(h,"  \"account_currency\": \""+AccountInfoString(ACCOUNT_CURRENCY)+"\",\n");
   FileWriteString(h,"  \"exported_utc\": \""+TimeToString(TimeGMT(),TIME_DATE|TIME_SECONDS)+"\",\n");
   FileWriteString(h,"  \"source\": \"MT5 SymbolInfo; verify symbol/server in terminal\"\n}\n");
   FileClose(h);
}

void WriteAudit(string fn,long count,datetime first,datetime last,long gaps1,long gaps5,long gaps60,long exact)
{
   string afn="MT5_TICK_AUDIT.md";int h=FileOpen(afn,FILE_WRITE|FILE_TXT|FILE_ANSI);
   if(h==INVALID_HANDLE){Print("No se pudo crear auditoria error=",GetLastError());return;}
   FileWriteString(h,"# Auditoría de exportación MT5\n\n");
   FileWriteString(h,"- Archivo: `"+fn+"`\n- Símbolo MT5: `"+_Symbol+"`\n");
   FileWriteString(h,"- Ventana UTC solicitada: "+TimeToString(InpFromUTC,TIME_DATE|TIME_SECONDS)+" .. "+TimeToString(InpToUTC,TIME_DATE|TIME_SECONDS)+" (fin exclusivo)\n");
   FileWriteString(h,"- Ticks exportados: "+(string)count+"\n");
   FileWriteString(h,"- Primer tick (terminal/server time): "+(first>0?TimeToString(first,TIME_DATE|TIME_SECONDS):"none")+"\n");
   FileWriteString(h,"- Último tick (terminal/server time): "+(last>0?TimeToString(last,TIME_DATE|TIME_SECONDS):"none")+"\n");
   FileWriteString(h,"- Huecos entre ticks >1s / >5s / >60s: "+(string)gaps1+" / "+(string)gaps5+" / "+(string)gaps60+"\n");
   FileWriteString(h,"- Registros exactamente repetidos consecutivos: "+(string)exact+" (no se eliminaron)\n\n");
   FileWriteString(h,"## Notas\n- CopyTicksRange se consultó en bloques UTC no solapados; no se deduplicó por timestamp.\n");
   FileWriteString(h,"- Las fechas sin ticks se conservan como faltantes; no se rellenó ningún hueco.\n");
   FileWriteString(h,"- `time_server` es conversión de `time_msc` a datetime del terminal y debe comprobarse frente a GMT/server offset.\n");
   FileWriteString(h,"- La disponibilidad del historial depende del broker, símbolo seleccionado y caché MT5.\n");
   FileClose(h);
}

void OnStart()
{
   if(InpToUTC<=InpFromUTC){Print("ERROR: InpToUTC debe ser posterior a InpFromUTC");return;}
   if(InpBlockMinutes<1||InpMaxTicksPerBlock<1){Print("ERROR: parámetros de bloque inválidos");return;}
   if(InpExportSpec)WriteSpec();
   string fn=OutName();
   int f=FileOpen(fn,FILE_WRITE|FILE_CSV|FILE_ANSI,',');
   if(f==INVALID_HANDLE){Print("FileOpen failed ",fn," error=",GetLastError());return;}
   FileWrite(f,"time_msc","time_server","bid","ask","last","volume","volume_real","flags","spread","symbol","digits","tick_size","tick_value","tick_value_profit","tick_value_loss","contract_size","volume_min","volume_step","currency_profit","currency_base","currency_margin","account_currency");
   long from_ms=(long)InpFromUTC*1000;
   long end_ms=(long)InpToUTC*1000; // exclusive
   long block_ms=(long)InpBlockMinutes*60*1000;
   long total=0,g1=0,g5=0,g60=0,exact=0;long prev_ms=-1;
   datetime first=0,last=0;MqlTick arr[];
   int digits=(int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS);
   double tick_size=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE);
   double tick_value=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_VALUE);
   double tick_value_profit=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_VALUE_PROFIT);
   double tick_value_loss=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_VALUE_LOSS);
   double contract=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_CONTRACT_SIZE);
   double vmin=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN),vstep=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
   string cp=SymbolInfoString(_Symbol,SYMBOL_CURRENCY_PROFIT),cb=SymbolInfoString(_Symbol,SYMBOL_CURRENCY_BASE),cm=SymbolInfoString(_Symbol,SYMBOL_CURRENCY_MARGIN),ac=AccountInfoString(ACCOUNT_CURRENCY);
   for(long b=from_ms;b<end_ms;)
   {
      long e=MathMin(b+block_ms-1,end_ms-1); // inclusive endpoint; next block begins e+1ms
      ArrayFree(arr);
      int got=CopyTicksRange(_Symbol,arr,COPY_TICKS_ALL,(ulong)b,(ulong)e);
      if(got<0){Print("CopyTicksRange error at ",b," err=",GetLastError());b=e+1;continue;}
      if(got>InpMaxTicksPerBlock){Print("WARNING block ticks ",got," > configured max ",InpMaxTicksPerBlock,"; memory could be high");}
      for(int i=0;i<got;i++)
      {
         long ms=arr[i].time_msc;
         if(ms<b||ms>end_ms-1)continue;
         // CopyTicksRange should be chronological; preserve source order and log any disorder.
         if(prev_ms>=0&&ms<prev_ms)Print("WARNING out-of-order tick ",ms," after ",prev_ms);
         if(prev_ms>=0){long gap=ms-prev_ms;if(gap>1000)g1++;if(gap>5000)g5++;if(gap>60000)g60++;}
         datetime ts=(datetime)(ms/1000);
         if(first==0)first=ts;last=ts;
         double spr=arr[i].ask-arr[i].bid;
         FileWrite(f,ms,TimeToString(ts,TIME_DATE|TIME_SECONDS),
                   DoubleToString(arr[i].bid,digits),DoubleToString(arr[i].ask,digits),
                   (arr[i].last>0?DoubleToString(arr[i].last,digits):""),
                   DoubleToString(arr[i].volume,8),DoubleToString(arr[i].volume_real,8),
                   (string)arr[i].flags,DoubleToString(spr,digits),_Symbol,digits,
                   DoubleToString(tick_size,10),DoubleToString(tick_value,8),DoubleToString(tick_value_profit,8),
                   DoubleToString(tick_value_loss,8),DoubleToString(contract,8),DoubleToString(vmin,4),DoubleToString(vstep,4),cp,cb,cm,ac);
         total++;prev_ms=ms;
      }
      FileFlush(f); // incremental durability
      b=e+1;
      Print("ticks exported=",total," next_ms=",b);
   }
   FileClose(f);
   WriteAudit(fn,total,first,last,g1,g5,g60,exact);
   Print("DONE file=",fn," ticks=",total," first=",first," last=",last,
         " gaps>1s/5s/60s=",g1,"/",g5,"/",g60);
}
//+------------------------------------------------------------------+
