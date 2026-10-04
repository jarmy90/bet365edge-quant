# FREE_DATA_STATUS — TM3 TT

## Resultado
- **Databento detenido y no usado**: cero llamadas, cero API keys, cero coste.
- **MT5 IC Markets**: exportador listo (`mt5-explorer/tm3_pf/TM3_EXPORT_REAL_TICKS.mq5`), pero no hay CSV MT5 aportado aún; símbolo/cobertura broker pendientes.
- **Dukascopy-node**: instalado localmente (Node v24.14.0, paquete gratuito) y catálogo enumerado. Instrumento escogido por descripción oficial del catálogo: `usatechidxusd` = `USATECH.IDX/USD`, “US 100 Tech Index” (CFD índice, no CME NQ ni CFD IC Markets USTEC).
- **Muestra gratuita de dos sesiones/días UTC**: 2025-07-01 y 2025-07-02. No se descargó más histórico.

## Auditoría de muestra
| UTC date | Quotes | Bid/ask válidos | Orden | Dups timestamp | bid>ask | spread med/max | >1s / >5s / >60s |
|---|---:|---:|---|---:|---:|---:|---:|
| 2025-07-01 | 229,172 | 100% | ordenado | 0 | 0 | 1.526 / 3.580 | 15,117 / 540 / 2 |
| 2025-07-02 | 227,453 | 100% | ordenado | 0 | 0 | 1.569 / 3.580 | 14,289 / 586 / 1 |

No hay trade prints independientes en CSV del paquete; `last` queda vacío. UTC→New York usó zona IANA y dio EDT -0400 para la muestra. 09:20–11:10 ET produjo 37,860 y 36,717 quotes. No se eliminó ni rellenó ningún gap.

Hashes SHA-256 en `duka_audit/sample_hashes.json` y auditorías JSON separadas.

## Detector TT
`detect_tt_sample.py` corrió en modo exploratorio sobre bid/ask real Dukascopy y produjo 493 autocuts agregados,
con FT órdenes=0. **No es un resultado de estrategia certificado**: falta reconciliar patrón n/n+1 exactamente con
MQL5, validar el estado armado causal respecto al cierre de vela y comparar autocuts con una exportación MT5 en día
común. Por eso no se inicia descarga mensual ni se usa el conteo como evidencia operativa.

## ¿Sirve para variables 2s?
Sí para calcular variables sobre la secuencia de quotes del feed Dukascopy; no las convierte en variables del feed
IC Markets. Economía, spread efectivo, ejecución y contrato IC Markets no se validan con estos ticks.

## Archivos
- `download_duka_ticks.js`: enum local y descarga de una fecha; mensual bloqueado salvo `--sample-audited YES`.
- `convert_duka_bi5.py`: BI5→Parquet, requiere escala verificada; conserva duplicados temporales.
- `validate_ticks.py`: auditoría general y filtro horario NY reportado, no altera source.
- `detect_tt_sample.py`: TT exploratorio; FT no abre operaciones.
- `export_mt5_ticks.py` + `TM3_EXPORT_REAL_TICKS.mq5`: ruta para economía MT5 real.
- `SYMBOL_SPEC.json`: plantilla, no rellenada con valores Dukascopy.
- `DUKASCOPY_INSTRUMENT_AUDIT.md`, `MT5_TICK_AUDIT.md`, `SOURCE_COMPARISON.md`.

## Siguiente acción
1. Ejecutar exportador en MT5 del símbolo exacto IC Markets y aportar CSV/spec.
2. Corregir y testear paridad de patrón n/n+1 y detector causal con fixtures antes de interpretar los 493 eventos.
3. Comparar mismo día/feed común. Solo después decidir si autorizar descarga mensual Dukascopy gratuita para robustez.
