# TM3 TT-only — Paridad MQL5/Python

## Índices exactos de velas

En `NewBar()`, MQL5 solicita rates en modo series:

- `r[0]`: vela nueva en curso.
- `r[1]`: última vela cerrada, denominada aquí **n+1**.
- `r[2]`: vela cerrada anterior, denominada aquí **n**.

El EA asigna la dirección por `r[2].close/open` (vela n), usa `r[2].high/low` como trigger y combina la vela siguiente `r[1]` en A y SL. Al activarse el nuevo bar, ambas están cerradas, así que no hay look-ahead para la geometría.

| Componente | MQL5 v2.21 | Motor TT-only | Paridad / limitación |
|---|---|---|---|
| Dirección | `r[2].close > r[2].open ? +1 : -1` | vela n, misma regla | exacta |
| High/Low n | `hi=r[2].high`, `lo=r[2].low` | mismas columnas | exacta |
| High/Low n+1 | `hi1=r[1].high`, `lo1=r[1].low` | vela inmediatamente posterior, ya cerrada | exacta |
| A alcista | `hi - lo1` | misma fórmula | exacta |
| A bajista | `hi1 - lo` | misma fórmula | exacta |
| Trigger | alcista `hi`; bajista `lo` (de n) | igual | M1 solo detecta que el OHLC contiene el precio, no el cruce tick exacto |
| SL estructural | alcista `lo1`; bajista `hi1` | igual | exacta |
| SL mínimo | si `abs(trigger-SL)<InpSLMin`, `SL=trigger-dir*SLMin` | igual, parámetro | exacta |
| Risk | `abs(trigger-SL)` | igual | exacta |
| Armado | `A>=risk && A>=InpRewardMin` | igual | exacta |
| Autocorte | cruza `prevAsk/ask` (long), `prevBid/bid` (short) | M1: trigger alcanzado/ambiguo; tick: cruce literal | no equiparar M1 a tick |
| SL/TP patrón | seguimiento `CheckOutcomes`: TP estructural `trig+dir*A`, SL estructural | independiente del TP económico | estados estructurales no mutan por escalera |
| TP monetario | solo salida de operación virtual | solo cierre de trade TT | no activa fibo100, nunca dispara operación FT |
| Escalera | variante mantiene step/lost; legado MQL5 trata cualquier PnL>0 como recuperación | motor nuevo usa sequence_pnl>=target, con TIME policies declaradas | gestión económica nueva solicitada; no es paridad legacy deliberadamente |
| TIME | EA `ManageTrades` cierra en max trade seconds; `CloseVirtual` reset si pnl>0 | NO_TIME / TIME_CONTINUE / TIME_SAME_STEP | reportadas por separado; ninguna TIME positiva cierra sin target acumulado |
| Horario | fijo `InpServerMinusET=7` no modela DST; primera secuencia solo sesión, pending puede continuar | America/New_York con DST | calendario temporal corregido; diferencias estacionales con offset EA |
| FT | EA abre operaciones FT al TP estructural | FT solo etiquetas analíticas posteriores a fibo100 | todas las variantes FT anteriores fuera de ranking operativo |
| Spread/ejecución | gate `Spread()<=InpSpreadMax`; ask para compra, bid para venta, cierres al lado opuesto | OHLC HistData sin bid/ask: escenarios de spread paramétrico | M1 no permite reconstrucción exacta de quote spread |
| Conversión | `InpValorPuntoLote` y comisión | PRICE_ONLY / PARAMETRIC_VPT / BROKER_SPEC validado | falta spec IC Markets; moneda no afirmada |
| Métricas | GP/GL; equity y DD por variante | trade/sequence ledger auditable | comparar solo bajo misma definición y datos |

## Resolución M1

HistData es `SPX/USD` M1, no USTEC/NSX ni futuro NQ. La fila OHLC que contiene trigger no determina
si el precio se cruzó desde el lado correcto, ni el orden entre trigger y SL. Se conservan flags
`trigger_reached`, `intrabar_ambiguous`, `sl_and_trigger_same_bar`, `tp_and_sl_same_bar`.
Los escenarios CONSERVATIVE/OPTIMISTIC/RANDOM_BRIDGE son cotas/análisis hipotético, no ejecución exacta.

## Estados independientes

- Structural: `TT_ARMED → TT_AUTOCUT → TT_FIBO100_REACHED → TT_EXTENSION → TT_BRAKE_OBSERVED → TT_EXPIRED`.
- Economic: `SEQUENCE_OPEN → SEQUENCE_TARGET_REACHED` o `SEQUENCE_ALL_STEPS_LOST`.
- Brake: `NO_BRAKE/SOFT_BRAKE/STRONG_BRAKE/CONFIRMED_REVERSAL`; etiqueta observacional, sin PnL.

Enlaces entre máquinas: el autocorte inicia la observación geométrica y puede habilitar trade TT;
solo precio puede llevar patrón a fibo100. PnL, TP monetario o cierre de secuencia no alteran estructura.

Tests de paridad: `test_tm3_tt_engine.py` cubre geometría, causalidad, estados separados, target de secuencia,
ambigüedad, horario, conservación de libros y ausencia de FT trades. Tick parity requiere CSV de ticks reales.
