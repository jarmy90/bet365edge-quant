# Auditoría TM3 TT-only — reinicio del estudio

## Estado
**Backtest/ranking detenido antes de Train. No hay ranking operativo nuevo.** La solicitud nueva
invalida los resultados previos con FT. Los CSV `tm3_wf_*.csv`, `tm3_sim_*` y el antiguo
`RESULTADOS_TM3.md` son históricos, no evidencia del modelo TT-only, y no se deben usar para
seleccionar una estrategia.

## Instrumento y datos
- HistData: **SPX/USD**, M1, 2023-01-02 23:00 UTC a 2026-09-18 21:13 UTC.
- No es USTEC/NSX ni futuro NQ; no se transportan conclusiones ni valor monetario a esos símbolos.
- CRC de los ZIP fue verificado previamente; la serie fusionada contiene 1,198,934 filas y 45/45
  meses con dato. La última mensualidad está incompleta.
- Sí hay ticks locales en `mt5-explorer/tm3_pf/duka_ticks/*.ticks`: 81 ficheros (80 de datos + ledger), 1.511.218 registros, 25 días entre 2025-07-01 y 2025-09-17, horas parciales 13–16 UTC. Son quotes Dukascopy `USATECHIDXUSD` (Nasdaq 100), no export MT5/IC Markets ni SPX/USD. No cubren el periodo walk-forward completo.
- El adaptador `tm3_tt_duka_adapter.py` los convirtió sin sintetizar datos a `duka_ustec_ticks.csv` en columnas `time_msc,bid,ask,last,volume`; 0 timestamps duplicados. Spread mediano 1.227 y máximo 18.362 puntos, que requiere depuración/auditoría de outliers antes de ejecución.
- HistData M1 SPX/USD sigue sin bid/ask tick y no se puede combinar como si fuera el mismo símbolo. El CSV M1 tampoco permite calcular indicadores de 2s/3s.

## Hallazgos que invalidan la primera versión externa
1. `tm3_sim.py` no es un backtester comparable con el EA: inventaba filtros TT/FT con velas M1,
   usaba barras futuras para su filtro y resolvía tick-sentiment con proxies. Sus resultados FT no
   son candidatos operativos.
2. `tm3_backtest_engine.py` también fue detenido: mezclaba TT/FT, tenía contabilidad incompleta de
   escaleras, FT podía depender del TP del trade, y sus métricas de PF/sequence no eran confiables.
   No se reutilizan sus resultados.
3. En el EA real, `CheckOutcomes` actualiza el patrón con TP estructural `trig+dir*A` y luego `CheckBands`
   gestiona FT. En el nuevo modelo FT solo es observación posterior a fibo100, cero operaciones.
4. Gestión económica solicitada difiere del legado EA: el nuevo ledger termina secuencia solo cuando
   PnL acumulado alcanza target o agota pasos. No se cuenta una salida TIME positiva como recovery.

## Implementación iniciada
- `tm3_tt_engine.py`: nuevo núcleo M1 TT-only; ledger estructural separado del económico; no contiene
  órdenes FT; escenarios de ambigüedad; PRICE_ONLY/paramétrico por valor punto.
- `tm3_tt_tick_engine.py`: lector REAL_TICK, validación de duplicados, detección bid/ask y estructura;
  exige CSV real. No hay ticks reales adjuntos, por tanto no genera resultado tick.
- `TM3_TT_PARIDAD_MQL5_PYTHON.md`: tabla de paridad y definiciones n/n+1.
- `SYMBOL_SPEC_REQUIRED.json`: requiere export real de IC Markets; no se sustituye por VPT inventado.
- `test_tm3_tt_engine.py`: tests sintéticos actuales.

## Gate antes de simulación
Los tests geométricos iniciales pasan, pero **no certifican los 20 criterios de aceptación**. Además,
el motor necesita mejorar la máquina de repetición de pasos y la detección de autocorte M1 causal:
OHLC que contiene trigger no prueba que venía desde el lado correcto. Por tanto, no se lanzó Train,
Validation, Test ni Forward. No se generaron rankings ni estrés/Monte Carlo falsamente precisos.

## Conclusión actual
**NO GO / estudio inconcluso.** Esto no prueba que TT sea rentable ni que no lo sea; prueba que con
la evidencia disponible no es legítimo declarar una configuración ganadora. Próxima entrada necesaria:
CSV ticks MT5 (`time_msc,bid,ask,last,volume`) para REAL_TICK y export de especificación del símbolo
IC Markets. Hasta entonces, solo cabe desarrollar/verificar la geometría M1 y mostrar escenarios de
ambigüedad, sin claims de rendimiento operativo.
