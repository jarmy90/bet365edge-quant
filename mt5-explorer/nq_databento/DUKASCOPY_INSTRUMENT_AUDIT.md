# Dukascopy instrument audit

Inspección local de `dukascopy-node` (Node v24.14.0; documentación: Node 18+). Se enumeró la lista de
instrumentos exportada por el paquete y se leyó `instrumentMetaData`; no se adivinó el ticker.

| Término pedido | ID/candidato verificado | Descripción exacta | Tipo | Evaluación |
|---|---|---|---|---|
| NASDAQ 100 / US Tech 100 / USTEC | `usatechidxusd` (`USATECH.IDX-USD`) | US 100 Tech Index | CFD de índice Dukascopy | candidato de robustez estructural; no es NQ ni IC Markets |
| NQ | No hallado como futuro CME | No se identificó contrato CME NQ en el catálogo de Dukascopy-node | — | no atribuir estos ticks al futuro CME |
| `techususd` | descartado | BIO-TECHNE CORP | acción | falso positivo de búsqueda textual |
| `cndxgbusd` | descartado para índice CFD | iShares NASDAQ 100 UCITS ETF | ETF | otro instrumento |
| SPX/US500 | no seleccionado en esta prueba | — | probablemente productos distintos; requiere identificar descripción exacta | sin equivalencia asumida |

Metadata `usatechidxusd`: startHourForTicks `2013-01-01T05:44:03.105Z`; nombre `USATECH.IDX/USD`;
descripción `US 100 Tech Index`.

## Campos de muestra
La muestra `dukascopy-node` produce `timestamp,askPrice,bidPrice,askVolume,bidVolume`. `timestamp` es epoch
ms; bid y ask están disponibles. No hay trade prints en esta salida, por tanto last permanece vacío; no se
rellena con mid. Los volúmenes son quote volumes del feed, no volumen consolidado de CME.

## Muestra ejecutada
- 2025-07-01 UTC: 229,172 quotes, hash `d45b157261994e75b08b0d8a61f5416e39f051e365d56cd83db542fd37afab78`.
- 2025-07-02 UTC: 227,453 quotes, hash `0f45566621d14a53db4cf24f0a8e49e787e8703ef88d580fc3d89f72f1e60341`.
- Bid/ask presentes 100%, timestamps ordenados, 0 duplicados por timestamp, 0 bid>ask, sin spread no positivo.
- Spread mediano 1.526 / 1.569; max 3.580 puntos.
- Huecos >1 s: 15,117 / 14,289; >5 s: 540 / 586; >60 s: 2 / 1. No se eliminaron ni rellenaron.
- Fechas en verano ET con offset IANA -0400; se observó toda la jornada UTC y la ventana ET filtrada queda aparte.

## Equivalencia
No exacta con USTEC IC Markets, ni CME NQ. Úsese para robustez estructural/microestructura aproximada,
no para economía real del broker, tamaño contractual o slippage/fills de NQ.
