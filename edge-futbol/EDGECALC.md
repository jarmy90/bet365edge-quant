# Cálculo de Edge (+EV) — referencia oficial edge.futbol

Versión: v9.8 (modelo ciego a la cuota + edge solo de IA).

## 1. Definiciones

- `cuotaCasa`: cuota Over/Under 1.5 o 2.5 publicada por ratingbet (scraper con Show more, `scrape_ratingbet.js`).
- `probModelo`: probabilidad del modelo para ese mercado.
  - **Solo si hay veredicto IA** (`probBase = 'modelo-ia'`): `probModelo = modelProb`.
    El mega-prompt es **ciego a la cuota**: no recibe precios ni probabilidades
    implícitas, solo identidad del partido, horario y qué líneas existen
    (`construirPromptAnalisis()`). Estima con forma, xG, bajas, clima, localía y H2H.
  - Sin IA **no se inventa modelo**: el tip de ratingbet o el mercado justo
    (`analisis-tip` / `mercado-justo`) quedan como información con
    `edgePuntos = null`; nunca generan pick publicable.
- `cuotaModelo = 100 / probModelo`.

## 2. Edge por pick (puntos)

```
edgePuntos = redondeo1((cuotaCasa - cuotaModelo) * 100)
           = redondeo1((cuotaCasa - 100 / probModelo) * 100)
```

Caso conocido con `cuotaCasa = 1.60`:

| probModelo | cuotaModelo | edgePuntos | resultado |
|---|---|---|---|
| 61.0 % | 1.639 | **-3.9** (≈ -4.0) | sin ventaja: NO se publica |
| 65.0 % | 1.538 | **+6.2** | valor: elegible para publicar |

Positivo = valor. Negativo = sin ventaja. **Solo se publican picks con
`probBase = 'modelo-ia'` y `edgePuntos > 0`**; sin IA el pipeline devuelve
estado `sin-combinada` con motivo auditable.

Código: `seleccionDeFixture()` y `aplicarVeredictos()` en `ratingbet_pipeline.js`.

### 2b. Métrica alterna: EV%

Otra lectura del mismo valor, en tanto por uno sobre la stake:

```
EV% = probModelo * cuotaCasa - 1
```

Ejemplo: casa `1.60` y `probModelo = 60.98 %` → `0.6098 * 1.60 - 1 = -2.43 %` → **EV -2.4 %**
(la casa gana 2.4 % de media: no es apuesta con valor). Con `65 % * 1.60 = +4.0 %` sí lo es.
Código: `valorEsperado(probPct, cuota)`.

## 3. Edge de combinada (con boost bet365)

```
cuotaTotal = producto(cuotas picks)
cuotaBoosted = round2(cuotaTotal * (1 + RATINGBET_COMBO_BOOST_PCT/100))
cuotaModeloTotal = round2(producto(100/probModelo de cada pick))
edgeTotal = redondeo1((cuotaBoosted - cuotaModeloTotal) * 100)
```

Solo hay combinada publicable (`estado = 'ok'`) si **`edgeTotal > 0`** y todos
los picks cumplen lo del apartado 2 (IA + edge positivo).

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
- El prompt de análisis no filtra precios, así que `probModelo` no puede
  "copiar" la cuota del mercado (modelo realmente independiente).
- Tests: `npm test` (incluye `test_parlays_riesgo.js` y
  `test_ratingbet_pipeline.js`, con el caso conocido 1.60/61 % y 1.60/65 %).
