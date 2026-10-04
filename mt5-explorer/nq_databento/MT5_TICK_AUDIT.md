# MT5 IC Markets real ticks — instrucciones y estado

## Estado
No se ha adjuntado un CSV exportado desde MT5 en este workspace. Por tanto no hay cobertura IC Markets
validada, tick count ni hash exportado. `SYMBOL_SPEC.json` permanece como plantilla vacía.

## Exportador
`mt5-explorer/tm3_pf/TM3_EXPORT_REAL_TICKS.mq5` es un Script MQL5 para correr en el terminal y símbolo
exactos de IC Markets:

1. Abrir MetaEditor, compilar el script y ejecutarlo sobre el chart del símbolo objetivo.
2. Inputs `InpFromUTC`, `InpToUTC` (fin exclusivo), bloque en minutos; `CopyTicksRange` recibe milisegundos.
3. Salidas a `MQL5/Files`: CSV incremental, `SYMBOL_SPEC.json` y este informe.
4. Copiar el CSV sin modificar al proyecto y ejecutar:
   `python export_mt5_ticks.py <archivo.csv> --spec SYMBOL_SPEC.json --audit MT5_TICK_AUDIT.md`
5. El auxiliar verifica encabezados, cobertura, huecos, timestamps repetidos, bid/ask, spread y SHA-256.

Advertencia temporal: `CopyTicksRange` usa timestamps de servidor en epoch ms; `time_server` solo es una
representación del terminal. Para resolver UTC de manera exacta, comparar con `TimeGMT()`/offset del servidor
por fecha; los offsets pueden cambiar con DST. No asumir offset constante entre años.

El exportador escribe registros cronológicamente como los devuelve MT5 en bloques no solapados. No elimina
registros con igual `time_msc`. El cache/disponibilidad depende del historial de ticks que MT5/broker proporcione;
si el broker no tiene parte del intervalo, el CSV mostrará el tramo realmente obtenido y los huecos.
