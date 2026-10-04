# Resultados BSP Zeiierman en ES=F (Yahoo Finance, gratis sin registro)

## Datos usados (repos públicos intentados)
- Stooq (`stooq.com/q/d/l/?s=%5Espx`): bloqueado por anti-bot (challenge JS).
- FirstRateData: endpoints de descarga rotos (404 en assets).
- HF Data Library (1.6B barras, SPY incluido): requiere registro + API key (no se hizo).
- **Yahoo Finance v8 (SI funciona, sin registro)**: ES=F (futuro S&P500, proxy US500 ICMarkets).
  - `es_15m.json`: 5760 barras 15m (~60 días).
  - `es_1h.json`: 17406 barras 1H (~2 años).
  - `es_1d.json`: 2517 barras diarias (~10 años, pendiente: tarda >30s por el perfil 600x72).
- Ficheros: `es_15m.json`, `es_1h.json`, `es_1d.json` + trades `es_15m_bsp_trades.csv` (8475 filas), `es_1h_bsp_trades.csv` (28620 filas).
- Motor: `backtest_bsp.py` replica Pine v6 (perfil 600x72, pull 0.85*clip(ev/0.65), score 100*(0.5ev+0.2abs+0.15vol+0.15wick), stop raw pivot -0.25 ATR, 2 entradas x 15 salidas, stop-first conservador, slip 2 pts de 0.25).

## TOP 1H (min 20 trades)
