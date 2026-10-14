# Cálculo de Edge (+EV) — referencia oficial edge.futbol

Versión: v9.8 (modelo ciego a la cuota + edge solo de IA).

## 1. Definiciones

- `cuotaCasa`: cuota Over/Under 1.5 o 2.5 publicada por ratingbet (scraper con Show more, `scrape_ratingbet.js`).
- `probModelo`: probabilidad del modelo para ese mercado.
  - **`probBase = 'modelo-ia'`**: `probModelo = modelProb`.
    El mega-prompt es **ciego a la cuota**: no recibe precios ni probabilidades
    implícitas, solo identidad del partido, horario y qué líneas existen
    (`construirPromptAnalisis()`). Estima con forma, xG, bajas, clima, localía y H2H.
  - **`probBase = 'modelo-poisson'`**: `probModelo` sale del modelo Poisson
    determinista con stats reales (ver §6). También ciego a la cuota.
  - Sin modelo **no se inventa**: el tip de ratingbet o el mercado justo
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

Positivo = valor. Negativo = sin ventaja. **Solo se publican picks de modelo
(`probBase = 'modelo-ia'` o `'modelo-poisson'`) con `edgePuntos > 0`**; sin
modelo el pipeline devuelve estado `sin-combinada` con motivo auditable.

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
los picks son de modelo con `edgePuntos > 0` (apartado 2).

Variable Vercel: `RATINGBET_COMBO_BOOST_PCT` (0-50, por defecto 0).
Código: `construirParlayRiesgo()` + `comboBoostPct()` + `edgePorCuotas()`.

## 4. Flujo

1. `scrape_ratingbet.js` captura todo (Show more) → gist + rama dataset.
2. `worker.js` → `getFutureMatchesPool` (fixtures con IA ×24, cache 5 min).
3. `/api/parlays-by-risk` reutiliza pool con veredictos (sin re-llamar al LLM; en cold start usa ligero, nunca 504).
4. Frontend muestra `Casa / Modelo / Edge` con esta misma fórmula.

## 5. Estabilidad (clientes de pago)

- Puerta de frescura: dataset >180 min avisa, >48h bloquea (`DATOS.md`).
- Sin veredicto de modelo no se inventa edge: se declara `sin-combinada` con motivo.
- Ni el prompt de IA ni el Poisson filtran precios, así que `probModelo` no puede
  "copiar" la cuota del mercado (modelo realmente independiente).
- Stats con <3 partidos → `null` y se sale a la ruta honesta sin edge.

## 6. Modelo Poisson (respaldo determinista cuando no hay IA)

`modeloPoisson(stats)` en `ratingbet_pipeline.js`: puro, determinista y también
**ciego a la cuota** (solo mira goles esperados; las cuotas entran después,
en el `edgePuntos` del apartado 2).

### 6.1. Fórmula

```
Lh = avgH * attH * defA        (goles esperados del local)
La = avgA * attA * defH        (goles esperados del visitante)
L  = Lh + La

P(Over 1.5) = 1 - e^-L * (1 + L)
P(Over 2.5) = 1 - e^-L * (1 + L + L^2/2)
```

Salida en **% con 1 decimal y clamp 1..99.5**; `null` si los stats son
insuficientes (`nH` o `nA` **< 3 partidos**, media/lambdas `<= 0` o campos no
numéricos). Ejemplos: `L = 2.5` → `71.3 %` / `45.6 %`; `L = 1.0` → `26.4 %` / `8.0 %`.

`seleccionDeFixture()` lo usa como respaldo: con stats válidos devuelve
`probBase = 'modelo-poisson'` + `edgePuntos = (cuotaCasa - 100/prob) * 100`
(el mismo edge, la misma fórmula). El veredicto IA, si existe, tiene prioridad.

### 6.2. Fuentes de datos

- **football-data.org** (API v4 pública): `standings` + últimos `results` por
  competición, los dos `fetch` que nutren las stats de ataque/defensa/medias.
- Fuerzas ya normalizadas contra la media de la liga (`attH = gfH/avgH`, etc.)
  y adjuntadas al fixture como `c.stats = {attH, defH, attA, defA, avgH, avgA, nH, nA}`.
- **Cache 6 h** (`STATS_CACHE_MS` en `worker.js`): cada refresco no repite
  llamadas dentro de la ventana.

### 6.3. Cobertura (honestidad)

- El tier gratuito cubre solo las competiciones configuradas en `FD_LEAGUES`:
  **Premier League, LaLiga, Bundesliga, Serie A, Ligue 1 y Champions League (6)**.
- El resto de ligas/mercados **no reciben stats → `modeloPoisson` devuelve
  `null` → sin veredicto Poisson**: se cae a tip/mercado-justo con
  `edgePuntos = null` y, en combinadas, a `sin-combinada`. Nunca se rellena
  con una probabilidad inventada.

### 6.4. Cadencia y presupuesto de llamadas

- Refresco cada **6 h** (una pasada por ciclo; el cache sirve el resto).
- **2 req por competición y ciclo** (standings + results).
- **Budget / 6 h = nº competiciones × 2 = 6 × 2 = 12 req** (≈ 48 req/día),
  muy por debajo del límite de 10 req/min del tier gratuito. Con
  `FOOTBALL_DATA_API_KEY` el mismo cálculo vale para el tier con token.

## 7. Tests

- `test_parlays_riesgo.js` → 46/46.
- `test_ratingbet_pipeline.js` → 92/92 (modelo ciego, edge de cliente, caso 1.60/61 % y 1.60/65 %, EV%).
- `test_modelo_poisson.js` → casos `L = 2.5`, `L = 1.0`, stats insuficientes y `seleccionDeFixture` con Poisson.
