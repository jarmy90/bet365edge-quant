# MT5 Explorer — Explorador de estrategias MT5 (DAX / DE40)

Carpeta independiente del explorador MT5. No depende de `edge-futbol`.

- `download/` → CSVs de precios DAX (H1, M5, M15, M30). Datos pesados: no subir a git por defecto.
- `vdpm_results/` → resultados del Explorer VDPM:
  - `*.mq5` / `*.ex5` → Expert Advisors.
  - `*_trades.csv`, `*_signals.csv`, `*_summary.csv` → salidas del backtest.
  - `*.log` → logs de MT5/terminal.
  - `audit_vdpm.py` → auditoría Fase 1: `python audit_vdpm.py` (requiere pandas/numpy).

Flujo sugerido: poner CSVs nuevos en `download/`, correr el EA/explorer en MT5, exportar a `vdpm_results/` y auditar con el script.
