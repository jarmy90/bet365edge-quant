# TM3 TT-only — Resultado del reinicio

## Veredicto

# NO GO — NO EXISTE CONFIGURACIÓN GANADORA VALIDADA

Se detuvo el motor anterior y se descartaron sus rankings FT. El nuevo motor está en fase de
construcción/auditoría; los tests geométricos básicos pasan, pero no se han certificado todos los
tests de aceptación, ni se ejecutaron Train/Validation/Test/Forward. No se afirma rentabilidad.

## Instrumento y periodo

- Histórico: HistData **SPX/USD M1**, 2023-01-02 23:00 UTC → 2026-09-18 21:13 UTC.
- No representa USTEC/NSX, US500 de un broker ni futuro NQ automáticamente.
- ZIPs existentes fueron verificados CRC OK; 1.198.934 barras en serie consolidada, 45/45 meses,
  septiembre 2026 incompleto al día 18.
- HistData M1 es OHLC. Además se encontraron 80 ficheros `.ticks` Dukascopy `USATECHIDXUSD`: 1.511.218 quotes en 25 días del 2025-07-01 al 2025-09-17, horas 13–16 UTC con cobertura incompleta. No son ticks de IC Markets/MT5 ni del símbolo SPX/USD M1; no completan los periodos walk-forward.
- Se adaptaron fielmente a `duka_ustec_ticks.csv` con `tm3_tt_duka_adapter.py`; no se generaron ticks sintéticos. No se han usado para declarar un ranking.

## Causalidad y límites

- La geometría de vela n / n+1 se puede verificar con M1 cerrada.
- El autocorte M1 es inferido desde un rango OHLC, no es cruce exacto por quote; si trigger/SL o
  TP/SL caen en la misma vela, el orden no es identificable. Se requiere etiquetar la ambigüedad.
- ZVL/RER/IRPL de 2s, FT sentiment de 3s, spread real, latencia y ejecución bid/ask exacta requieren
  ticks reales. No se inventan.
- `RANDOM_BRIDGE` es escenario estocástico hipotético, no una observación tick.
- No existe especificación real de IC Markets. Cualquier VPT sería paramétrico; `PRICE_ONLY` no son
  euros/dólares.

## Resultados

No se generaron rankings por periodo, estrés ni Monte Carlo: el motor no había superado aún todos los
acceptance tests, por lo que se detuvo antes de ejecutar Train. No se rellenan tablas con resultados
antiguos ni con números inventados.

| Apartado solicitado | Estado |
|---|---|
| Train 2023 | no ejecutado (gate de auditoría) |
| Validation 2024 | no ejecutado |
| Test 2025 | no ejecutado |
| Forward 2026-01 a 2026-09-18 | no ejecutado |
| Mejor neto / PF / DD / neto-DD / estabilidad | no declarado |
| Configuración imposible por cap | será `INVALID_CONFIGURATION` en matriz paramétrica nueva; no ranking previo válido |
| Fibo100 y frenazo | estructura preparada; M1 no entrega velocidad/indicadores tick exactos |
| TIME | políticas NO_TIME, TIME_CONTINUE y TIME_SAME_STEP previstas; no se elige una por ranking |
| Monte Carlo de secuencias | no ejecutado sin secuencias TT validadas |
| Capital recomendado | no estimable sin valor contractual de símbolo y distribución validada |

## Resultados anteriores invalidados

No son candidatos operativos: `REC60_FT15_10`, `REC60_FT12_10`, `REC60_FT10_10`,
`REC60_FT_STRICT`, `REC40_FT10_10`. FT no abre operaciones en este modelo; solo puede recibir
etiquetas analíticas tras alcanzar fibo100 y observar un frenazo causal. El TP monetario de la
escalera nunca activa fibo100. `REC_TT_DINAMICO` y `REC_TT_OBJ05` quedan solo como referencias
históricas y requieren recalcularse bajo el ledger sequence_pnl correcto.

## Archivos preparados

- `tm3_tt_engine.py` — prototipo nuevo M1 TT-only.
- `tm3_tt_tick_engine.py` — lector REAL_TICK TT-only; no inventa ticks.
- `test_tm3_tt_engine.py` — tests sintéticos de geometría/estructura/economía.
- `TM3_TT_PARIDAD_MQL5_PYTHON.md` — definiciones MQL5 y paridad explícita.
- `TM3_TT_AUDITORIA.md` — auditoría del corte y del dataset.
- `SYMBOL_SPEC_REQUIRED.json` — plantilla pendiente de export broker.

## Próximos datos necesarios

1. Para un resultado de IC Markets: tick export MT5 del símbolo exacto. Los ticks Dukascopy localizados son de otro feed/símbolo y cobertura parcial; no sustituyen ese requisito.
2. Export de propiedades de ese símbolo: `tick_size`, `tick_value_profit`, `tick_value_loss`,
   `contract_size`, `volume_min`, `volume_step`, `volume_max`, `account_currency`, `profit_currency`.
3. Confirmar spread/slippage/comisión aplicables a la cuenta concreta.

Hasta superar acceptance tests y walk-forward sin contaminación temporal, no se ejecuta optimización
ni se recomienda uso real.
