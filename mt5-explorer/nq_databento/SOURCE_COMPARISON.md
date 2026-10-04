# Comparación de fuentes — estado

| Fuente | Instrumento/feed | Periodo disponible en workspace | Quotes/ticks | Uso permitido | Estado |
|---|---|---|---|---|---|
| IC Markets MT5 | pendiente de confirmar símbolo exacto | No hay export CSV local | desconocido | Economía del símbolo exacto tras export/spec | pendiente |
| Dukascopy-node | `USATECH.IDX/USD` — US 100 Tech Index CFD | muestra 2025-07-01/02, descargada | 456.625 quotes; bid/ask; no trade print | robustez estructural/microestructura aproximada | muestra inicial válida técnicamente, pero con huecos del feed |
| HistData | SPX/USD M1 | 2023-01 a 2026-09 parcial | OHLC M1, no quotes | preselección geométrica solamente | no comparar como USTEC/NQ |

## No mezclar
Los resultados de cada feed deben mantenerse separados. Dukascopy CFD no es IC Markets USTEC ni CME NQ.
HistData SPX/USD no es Nasdaq. En ausencia de sesiones realmente coincidentes y del mismo instrumento,
no tiene sentido publicar tablas de diferencias de precio/triggers como comparación proveedor-a-proveedor.

## Comparativa pendiente
Al recibir export MT5, filtrar intersección UTC/ET y comparar solo sesiones comunes y contratos/símbolos
compatibles. Reportar OHLC, conteo, spread, TT autocuts, fibo100, diferencia temporal/precio. No sumar PnL
ni convertir VPT entre feeds.
