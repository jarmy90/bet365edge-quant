# BSP US500 (ICMarketsEU) — Explorer del indicador Zeiierman

Carpeta del nuevo explorer. Flujo:

1. Copia `../explorers/QNT_BSP_MTF_Close_Intrabar_Explorer.mq5` a `MQL5/Scripts/` de tu MT5 (ICMarketsEU).
2. Abre US500, adjunta el script (es solo research: no envía órdenes, escribe CSV en `MQL5/Files/`).
3. El CSV sale como `QNT_BSP_MTF_US500_M5_M15_M30_H1_<stamp>.csv` (4 TF x 2 entradas x 15 salidas).
4. Cópialo aquí (`mt5-explorer/bsp_us500/`) y audita:

```powershell
cd mt5-explorer/bsp_us500
python audit_bsp_us500.py QNT_BSP_MTF_US500_M5_M15_M30_H1_<stamp>.csv
```

## Qué audita

- Top combinaciones TF x entrada (CLOSE_CONFIRM vs INTRABAR_RETEST) x salida (15 modelos).
- Salidas coherentes pedidas: TP fijos en R (1R/2R/3R), TP en ATR, trailing ATR (1/2), BE+2R, BE+trail, step-trail 0/1/2/3R, tiempo (fast/slow), EMA, swing-trail, invalidación de nivel.
- Concentración top3, MFE/MAE (¿hay recorrido para trailing?), score Pine vs R.

## Licencia del indicador

El Pine original es de Zeiierman con licencia CC BY-NC-SA 4.0 (ver cabecera del script). Este explorer es implementación propia inspirada en su lógica, solo para research, sin ejecución.
