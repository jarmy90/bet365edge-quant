# TM3 v2.21 FAST TICK — Simulación offline sobre HistData SPX/USD M1 (2023-01 → 2026-09-18)

## Datos
- **Los históricos están BIEN.** 12 zips HistData SPX/USD M1 verificados con test CRC
  (`zipfile.testzip()` → todos OK). Tamaños coherentes (~18–22 MB año completo, ~1.8 MB/mes 2026).
  `spxusd_m1_all.csv` = **1.198.934 barras M1** (2023-01-02 23:00 UTC → 2026-09-18 21:13 UTC),
  45/45 meses, sin duplicados. Solo nota: **2026-09 viene corto** (hasta el 18-sep).
- Los intentos de Dukascopy fallaron (los `duka_groups.json` están vacíos y
  `duka_429_body.txt` es un error 503), pero no hacen falta: HistData cubre todo el periodo.

## Motor
`tm3_sim.py` (Python) replica `TM3_PF_OPTIMIZER_EXPLORER_v2_21_FAST_TICK.mq5`:
- 20 variantes idénticas a `InitVars`, martingala por pasos (`step`, `lost`, `seqfail`).
- Patrón TT: trigger = hi/lo de la vela r[2], SL = lo1/hi1 (o SLMin), TP = A, armado si A≥risk y A≥RewardMin.
- Escalera FT: bandas cada `Franja=3.0` tras TP + FT 2.56A en el patrón de las 9:30.
- Filtros TT/FT aproximados con velocidad M1 (proxy de los cálculos tick del EA: sin ticks
  reales, zvl/rer/irpl se estiman con las últimas velas M1).
- Coste 0.5 pt/lote (spread), comisión RT 0. Sesión 9:30–11:00 America/New_York (con DST).

## RESULTADO — Ranking por beneficio neto (coste 0.5)

| # | Variante | Trades | Win% | PF | Net | MaxDD | MaxStreak | Skipped | SeqFail |
|---|----------|--------|------|----|----|-------|-----------|---------|---------|
| 1 | **REC60_FT15_10** | 11.216 | 54.2 | 1.518 | **+331.95** | 5.02 | 11 | 1.463 | 374 |
| 2 | REC60_FT12_10 | 11.046 | 55.9 | 1.558 | +331.67 | 5.05 | 11 | 1.486 | 343 |
| 3 | REC60_FT10_10 | 10.833 | 57.8 | 1.568 | +313.06 | 5.48 | 11 | 1.512 | 309 |
| 4 | REC60_FT_STRICT | 8.215 | 59.8 | **1.695** | +278.30 | 7.65 | 11 | 1.568 | 218 |
| 5 | REC40_FT10_10 | 8.212 | 58.0 | 1.193 | +84.75 | 12.45 | 14 | 8.574 | 277 |
| 6 | REC_TT_DINAMICO | 831 | 55.2 | 1.843 | +70.24 | 3.43 | 10 | 25.365 | 31 |
| 7 | REC_TT_OBJ05 | 2.234 | 56.4 | 1.549 | +65.17 | 4.41 | 10 | 0 | 91 |
| — | Todas las CAP30–60 / OBJ20/30 / 3PASOS / 4PASOS / SL10-20 | **0** | — | — | 0 | — | 0 | 1.854 c/u | 0 |

## Lectura

1. **Las variantes que "ganan más" son las de escalera FT con cap 60**: `REC60_FT15_10`
   (net +331.95, PF 1.518) y `REC60_FT12_10` (net +331.67, PF 1.558) — prácticamente empatadas.
   `REC60_FT_STRICT` tiene el **mejor Profit Factor (1.695)** y mejor winrate (59.8%), pero menos
   trades (por el filtro estricto), así que net algo menor.
2. **REC_TT_DINAMICO es la mejor variante "pura martingala TT"** (PF 1.843, net +70, DD mínimo
   3.43) pero muy pocas operaciones: el lote dinámico casi siempre pide un TP > cap 60 y la salta
   (25.365 skips).
3. **Problema de configuración del EA**: con `InpLoteBase=0.01` y `InpValorPuntoLote=1`,
   recuperar el `obj=1` punto perdido exige TP = 100 pts → todas las variantes con
   cap ≤ 60 **nunca abren su primera operación** (1.854 patrones skipped por variante).
   Solo OBJ05 (cap que sí cubre 50 pts), DINAMICO y las FT (TP fijo 10–15) llegan a operar.
   **Recomendación: subir `InpValorPuntoLote` al valor real del contrato** o bajar `InpLoteBase`,
   para que `need/(sl*valor)` dé un TP alcanzable dentro del cap.
4. **Caution de la martingala**: MaxStreak 11 y 218–374 seqfail (secuencias de 4 pérdidas
   seguidas reiniciadas) en las FT — el edge existe pero hay rachas largas; el `LoteMax=0.04`
   limita el daño (4 pasos × 0.01→0.04).
5. **Limitaciones**: sin ticks reales, los filtros ZVL/RER/IRPL/IIT son proxies M1; el autocorte
   de 2 s y la precisión intravela del EA (cruce exacto del trigger con `prevAsk`) no son
   reproducibles con barras M1. Para confirmar hay que correr el EA en MT5 con datos tick de
   Dukascopy importados (los zips HistData no traen ticks, solo M1).

## Conclusión
**Configuración ganadora en simulación M1 HistData: `REC60_FT15_10` / `REC60_FT12_10`**
(cap 60, escalera FT con TP 15/12 y SL 10) por beneficio, y **`REC60_FT_STRICT`** por PF/winrate.
La martingala TT pura solo es viable como `REC_TT_DINAMICO` (PF 1.84) pero con muy poca frecuencia.
Arreglar primero `InpValorPuntoLote` para que las variantes CAP operen de verdad.

## Archivos
- `tm3_sim.py` — motor de simulación (Python).
- `tm3_sim_resumen.csv` — ranking completo.
- `tm3_sim_trades.csv` — log de todas las operaciones simuladas.
