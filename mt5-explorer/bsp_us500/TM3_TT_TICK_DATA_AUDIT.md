# Auditoría de ticks locales

## Encontrados
- Directorio: `mt5-explorer/tm3_pf/duka_ticks/`
- Formato binario Dukascopy `.ticks`, registro big-endian de 20 bytes: `int32 ms, int32 ask, int32 bid, float32 volAsk, float32 volBid`.
- Fuente declarada por `dl_duka_ticks.py`: **USATECHIDXUSD**, point value 1000 (Nasdaq 100 CFD Dukascopy).
- Ficheros de datos: 80 (más ledger auxiliar). Integridad estructural: todos tienen bytes divisibles por 20; 1.511.218 quotes; 0 timestamps duplicados al consolidar.
- Cobertura: 25 días de trading, 2025-07-01 a 2025-09-17; horas 13,14,15,16 UTC (faltan horas/días y sesiones enteras). Quotes observados entre 2025-07-01 13:00:00.144 UTC y 2025-09-17 13:59:59.991 UTC.
- Spread observado consolidado: mediana 1.227 puntos, máximo 18.362; los outliers deben filtrarse/auditarse, no ocultarse.
- Volúmenes de origen son campos float pequeños reportados por Dukascopy; no se interpretan como volumen bursátil.

## Conversión
`tm3_tt_duka_adapter.py` decodifica los bytes existentes y produce `duka_ustec_ticks.csv` con
`time_msc,bid,ask,last,volume`; `last` se guarda como mid quote calculado, no como trade print.
No hay ticks inventados. El CSV sirve para probar el lector/cálculos de quotes, pero no para afirmar
fills de MT5 ni equivalencia con el precio de `SPX/USD` M1.

## Conclusión de uso
Los ticks no son un export de MT5/IC Markets, no cubren 2023–2026, y el símbolo fuente no coincide
con HistData SPX/USD. No ejecutar con ellos el ranking final del contrato del usuario. Sí pueden
servir, claramente etiquetados, para pruebas unitarias de causalidad y un estudio exploratorio
separado de USATECHIDXUSD/Dukascopy en el periodo parcial.
