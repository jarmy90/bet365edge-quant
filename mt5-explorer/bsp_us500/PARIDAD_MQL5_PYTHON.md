# PARIDAD MQL5 ↔ Python (tm3_sim.py v1) — Auditoría línea a línea

Referencia: `TM3_PF_OPTIMIZER_EXPLORER_v2_21_FAST_TICK.mq5` vs `tm3_sim.py` (motor previo,
conservado como referencia histórica). El nuevo motor es `tm3_backtest_engine.py`, que corrige
los defectos listados aquí.

Leyenda: ✅ equivalente · ⚠️ aproximación consciente (documentada) · ❌ discrepancia corregida en el nuevo motor.

| # | Componente | Comportamiento MQL5 | tm3_sim.py (v1) | Equiv. | Diferencia / Corrección en tm3_backtest_engine.py | Test |
|---|-----------|--------------------|-----------------|--------|---------------------------------------------------|------|
| 1 | Creación patrón TT | `NewBar()` con `CopyRates(...,3)`: r[2]=vela cerrada n, r[1]=n-1, r[0]=en curso. Armado si A≥risk y A≥RewardMin | usa velas i-2 (n) e i-3 (n-1) al procesar vela i | ⚠️ | misma geometría, retardo de 2 velas replicado; se procesa tras cierre de vela n (sin look-ahead) | T01 |
| 2 | Índices vela n / n+1 | n=r[2], n-1=r[1] | i-2 / i-3 | ✅ | idéntico tras mapeo de índices | T01 |
| 3 | Dirección | `close>open ? 1 : -1` de la vela n | igual | ✅ | — | T01 |
| 4 | Fórmula A | `A = hi[n]-lo[n-1]` (long) / `hi[n-1]-lo[n]` (short) | igual | ✅ | — | T01 |
| 5 | Trigger | `hi[n]` (long) / `lo[n]` (short) | igual | ✅ | — | T01 |
| 6 | SL estructural | `lo[n-1]` / `hi[n-1]` | igual | ✅ | — | T01 |
| 7 | SL mínimo | si `\|trig-sl\|<InpSLMin` → `sl = trig - dir*SLMin` | igual | ✅ | — | T01 |
| 8 | A ≥ risk | condición de armado | igual | ✅ | — | T01 |
| 9 | A ≥ RewardMin | condición de armado | igual | ✅ | — | T01 |
| 10 | Autocorte | tick a tick: `prevAsk<trig && ask>=trig` (long), con sentimiento pre-touch `touch-2000ms` | no existe: usa vela M1 que contiene el trigger | ❌ | **imposible con M1**. Nuevo motor marca `intrabar_ambiguous` y ejecuta CONSERVATIVE / OPTIMISTIC / RANDOM_BRIDGE. No se afirma autocorte exacto | T14/T15 |
| 11 | Gear escalera | `step`++ por pérdida; reset a 0 si step≥steps | igual | ✅ | — | T07 |
| 12 | Lote por paso | `base*(step+1)`, cap `LoteMax`, floor a `volume_step` | igual | ✅ | nuevo motor soporta escaleras de lotes explícitas y dinámico limitado por volume_min/step/max | T12b |
| 13 | Pérdida acumulada | `lost += -pnl` por pérdida; reset a 0 al ganar o al fallar secuencia | igual | ✅ | — | T07 |
| 14 | TP recuperación | `pts = max(RewardMin, (lost+obj+comisión)/(lot*VPT))`; `tp = en + dir*pts` | igual | ✅ | nuevo motor separa política STRICT_RECOVERY (objeto acumulado de secuencia, no solo trade) | T08 |
| 15 | Cap máximo | si `pts > cap` → skip (no abre) | igual | ✅ | nuevo motor pre-clasifica `INVALID_CONFIGURATION` cuando el TP requerido > cap de forma estructural | T-invalid |
| 16 | Reset tras ganancia | `lost=0, step=0, streak=0` | igual | ✅ | — | T07 |
| 17 | Reset tras perder pasos | `seqfail++, step=0, lost=0` | igual | ✅ | — | T07 |
| 18 | Salida TP | `px>=tp` (long) con bid | stop-first SL antes que TP | ⚠️ | nuevo motor marca barra ambigua y aplica 3 escenarios; stop-first solo en CONSERVATIVE | T15 |
| 19 | Salida SL | `px<=sl` con bid | igual que EA | ✅ | — | T15 |
| 20 | Salida TIME | `TimeCurrent()-ot >= InpMaxTradeSec` (600s), cierre a precio de mercado | igual (10 velas) | ⚠️ | **PROBLEMA TIME**: en el EA un TIME positivo cierra la escalera como ganada. Nuevo motor implementa 4 políticas separadas: LEGACY / STRICT_RECOVERY / CONTINUE_AFTER_TIME / NO_TIME | T06 |
| 21 | FT por bandas | tras TP del patrón: bandas `tp + dir*k*Franja` mientras `TimeCurrent()<ftend` (2 min); abre contra la banda con filtro FT | aproximado con 2 velas | ⚠️ | ventana FT configurable (60/120/180/300/600 s) en el nuevo motor; una entrada por banda (evita duplicación) | T16 |
| 22 | FT256 | solo patrón 9:30, nivel `trig+dir*2.56*A`, una vez | igual (condición minuto 9:30) | ✅ | — | T13 |
| 23 | Ventana FT | 2 minutos fijos tras TP | igual | ⚠️ | ahora parámetro | — |
| 24 | Una posición por variante | `HasOpen(vi)` impide segunda | igual | ✅ | — | T03 |
| 25 | Horario inicio | 9:30–11:00 ET vía `InpServerMinusET` fijo (sin DST) | zoneinfo America/New_York (con DST) | ⚠️ | el EA usa offset fijo del servidor; el motor usa DST real y documenta la diferencia. Sesión configurable 11:00/11:30 | T04 |
| 26 | Sin escaleras nuevas tras horario | `OpenVirtual` exige `InTradeTime()` para step==0 sin lost | igual | ✅ | — | T04 |
| 27 | Escalera pendiente continúa | `InpCompletarEscaleraTrasHora && Pending(vi)` permite seguir | igual | ✅ | — | T05 |
| 28 | Cierre diario | NO hay cierre forzado (`InpCerrarAlFinSesion=false`); memoria de escalera no se borra al cambiar de día (solo patrones/ticks) | igual | ✅ | nuevo motor además no transfiere secuencia incompleta al resumen diario (se contabiliza en su secuencia real) | T05 |
| 29 | Spread | `Spread()>InpSpreadMax` filtra entrada; ejecución a ask/bid | no modela spread de ejecución | ❌ | nuevo motor ejecuta long a ask/sale a bid, spread de estrés 0.5–3 pts, aplicado una sola vez | T09/T10 |
| 30 | Comisión | `InpComisionRTLote` por lote en cierre | cost fijo 0.5 sustituía spread+comisión mezclados | ❌ | separación explícita: spread y slippage por lado, comisión por lote una sola vez | T11 |
| 31 | Conversión monetaria | `pnl = pts * VPT * lot - comisión*lot` con VPT input | VPT=1 ciega | ❌ | 3 modos: BROKER_SPEC (JSON real), FIXED_VPT (sensibilidad), PRICE_POINTS_ONLY (por defecto sin spec) | T08 |
| 32 | Profit factor | gp/gl | igual | ✅ | — | T19 |
| 33 | Drawdown | peak-equity por variante | igual | ✅ | añade DD% y recovery_factor | T19 |
| 34 | Racha pérdidas | streak/maxstreak por variante | igual | ✅ | añade pérdidas consecutivas y escaleras fallidas consecutivas | T19 |
| 35 | Escaleras ganadas/fallidas | solo cuenta `seqfail` (pasos agotados); no distingue ganada por objetivo | TIME positivo la cerraba como ganada | ❌ | sequence_id + sequence_pnl acumulado; ganada solo si PnL acumulado ≥ objetivo | T06/T20 |

## Diferencias exactas Python↔MQL5 que el nuevo motor asume conscientemente

1. **Intrabar ordering**: MQL5 recibe ticks; M1 no permite saber si el TP precede al SL en la
   misma vela. Tratado con 3 escenarios (CONSERVATIVE por defecto en rankings).
2. **Sentimiento 2s/3s (ZVL, RER, IRPL, ZSF, RPCN, IIT)**: requieren ticks reales. En modo
   M1_GEOMETRY_ONLY no se calculan; se ejecutan las variantes "sin filtro" o se documenta el
   sesgo. `tm3_tick_sim.py` los implementa igual que MQL5 para cuando haya export de ticks.
3. **Vela provisional tick a tick** (`liveOpen/liveHigh/...`): no reproducible en M1; el
   autocorte usa la vela M1 cerrada del touch.
4. **Zona horaria**: EA con offset fijo; motor con DST real de America/New_York. Diferencia de
   1h durante ~34 semanas/año (DST) — documentada en resultados.
5. **Spread de entrada**: el EA bloquea si spread>2; el motor aplica spread de estrés al PnL
   pero el gate de spread>2 solo se aplica en el escenario nominal (coste 0.5).
