# NQ MBP-1 Databento — Estado de adquisición

## Solicitud
- Fuente obligatoria: Databento, `GLBX.MDP3`, `mbp-1`.
- Producto NQ CME Globex, contratos individuales (sin continuous/back adjustment).
- Ventana por trading date: 09:20–11:10 `America/New_York` con DST IANA.
- Rango pretendido: 2025-07-01 hasta 2026-09-24 inclusive. API usa fin exclusivo `2026-09-25`.
- Muestra previa: dos sesiones completas. Extensión a 2024 apagada.

## Acceso / coste
El usuario confirma que no hay API key local configurada. El pipeline se detuvo sin solicitar datos,
por lo que coste real estimado y coste facturado son **no disponibles**. No se descargó nada. Databento
expone un endpoint autenticado de estimación de coste (`metadata.get_cost`); según su documentación,
la tarifa histórica por uso depende del tamaño binario descomprimido. No es responsable adivinar un
importe para el periodo largo sin una estimación válida de la cuenta.

## Archivos
No se generaron `NQ_MBP1_RAW.parquet`, `NQ_QUOTES_NORMALIZED.parquet`,
`NQ_QUOTES_NORMALIZED.csv.zst`, cobertura ni rollover: no existen datos de Databento descargados.
No hay hashes para datos no adquiridos.

## Pipeline reproducible
- `nq_databento_pipeline.py`: gate API key, coste estimado, límite de gasto, muestra, guarda DBN raw,
  normaliza sin ffill ni deduplicación por timestamp, aplica ventana ET y genera auditoría.
- `README.md`: instrucciones y advertencias.
- La API key debe configurarse localmente en `DATABENTO_API_KEY`, nunca en el script ni en el repo.

## Bloqueos antes de muestra
1. Crear/proveer key de Databento en el entorno local sin copiarla al chat.
2. Resolver los `raw_symbol` contract months individuales de NQ dentro del rango (con metadata y
   symbology de Databento). El pipeline exige raw symbols y no acepta continuous symbols.
3. Consultar estimate para exactamente dos sesiones y contratos candidatos.
4. Compartir/confirmar el estimate y el límite de gasto antes de bajar muestra.

## Calidad / causalidad
No se evaluó cobertura, rollovers, anomalías, zona ET ni cálculos TM3 porque no hubo muestra. El
pipeline no debe usarse para el ranking económico hasta completar y auditar esos pasos.
