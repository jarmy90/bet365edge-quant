# Cálculo de Edge (+EV) — referencia oficial edge.futbol

Versión: v9.7+ (convención pro del operador).

## 1. Definiciones

- `cuotaCasa`: cuota Over/Under 1.5 o 2.5 publicada por ratingbet (scraper con Show more, `scrape_ratingbet.js`).
- `probModelo`: probabilidad del modelo para ese mercado.
  - Si hay veredicto IA (`modoAnalisis = modelo-ia`): `probModelo = modelProb` (mega-prompt ciego a cuota: historial, bajas, clima, localía; 24 partidos por ciclo).
  - Si no: `probModelo = tipProbPct` de ratingbet, o `pJusta` (margen eliminado).
- `cuotaModelo = 100 / probModelo`.

## 2. Edge por pick (puntos)

```
edgePuntos = redondeo1((cuotaCasa - cuotaModelo) * 100)
```

Ejemplo: casa `1.64`, modelo `1.60` → `(1.64-1.60)*100 = +4.0`.
Positivo = valor. Negativo = sin ventaja (no se vende como pick).

Código: `seleccionDeFixture()` en `ratingbet_pipeline.js`.

## 3. Edge de combinada (con boost bet365)

```
cuotaTotal = producto(cuotas picks)
cuotaBoosted = cuotaTotal * (1 + RATINGBET_COMBO_BOOST_PCT/100)
cuotaModeloTotal = producto(100/probModelo de cada pick)
edgeTotal = redondeo1((cuotaBoosted - cuotaModeloTotal) * 100)
```

Variable Vercel: `RATINGBET_COMBO_BOOST_PCT` (0-50, por defecto 0).
Código: `construirParlayRiesgo()` + `comboBoostPct()` + `edgePorCuotas()`.

## 4. Flujo

1. `scrape_ratingbet.js` captura todo (Show more) → gist + rama dataset.
2. `worker.js` → `getFutureMatchesPool` (fixtures con IA ×24, cache 5 min).
3. `/api/parlays-by-risk` reutiliza pool con veredictos (sin re-llamar al LLM; en cold start usa ligero, nunca 504).
4. Frontend muestra `Casa / Modelo / Edge` con esta misma fórmula.

## 5. Estabilidad (clientes de pago)

- Puerta de frescura: dataset >180 min avisa, >48h bloquea (`DATOS.md`).
- Sin veredicto IA no se inventa edge: se declara `sin-combinada` con motivo.
- Tests: `npm test` (incluye `test_parlays_riesgo.js`).
