# DATOS.md — De dónde salen los partidos (y por qué no se actualizaban)

## El problema en una frase

La web **no puede leer ratingbet.com en vivo**: ratingbet está detrás de Cloudflare y
responde **403 + challenge** ("Just a moment...") a cualquier petición de servidor.
Solo un **navegador real** (Chrome) atraviesa ese challenge, y Vercel **no tiene
navegador**. Por eso la API consume un *dataset* capturado por el scraper.

Comprueba el bloqueo tú mismo:

```
npm run diag:cloudflare
```

## Arquitectura (todo en la nube)

```
┌─────────────────────────────┐
│ GitHub Actions (cada 3 h)   │   ubuntu-latest + Google Chrome real
│  node scrape_ratingbet.js   │   Cloudflare solo se deja pasar por navegador
└──────────────┬──────────────┘
               │ escribe ratingbet_fixtures.json
               ├──────────────────────────────────────────────┐
               ▼                                              ▼
┌─────────────────────────────┐              ┌──────────────────────────────┐
│ GIST PUBLICO (principal)    │              │ Rama 'dataset' del repo      │
│ gist.githubusercontent.com  │              │ (respaldo + historial)       │
│ URL raw estable, SIN token  │              │ raw.githubusercontent.com    │
└──────────────┬──────────────┘              └──────────────────────────────┘
               │ RATINGBET_DATASET_URL
               ▼
┌─────────────────────────────┐
│ API en Vercel (worker.js)   │   caché 5 min + cache-buster 'cb' en cada petición
│  /api/version /api/parlays  │   si la remota falla -> cae al módulo embebido y LO DICE
└─────────────────────────────┘
```

Piezas y ficheros:

| Pieza | Fichero | Notas |
|---|---|---|
| Captura | `scrape_ratingbet.js` | Chrome real, zona horaria Europe/Madrid, Over/Under 1.5 y 2.5 |
| Orquestación | `.github/workflows/captura-ratingbet.yml` | cron `23 */3 * * *` (UTC) + lanzamiento manual |
| Publicación principal | Gist **público** | `tools_publicar_dataset.js --modo=gist --publico`; Vercel lo lee **sin token** |
| Publicación de respaldo | rama `dataset` del repo | sin secretos extra (token interno de Actions); guarda historial |
| Lectura | `worker.js` → `cargarDatasetRatingbet()` | acepta token opcional en `Authorization: Bearer` |
| Consumo local | `tools_publicar_dataset.js --modo=info` | regenera el módulo embebido |
| Verificación | `tools_verifica_nube.js` | comprueba URL publicada **y** `/api/version` |

## Puerta de frescura (el candado anti-mentira)

Definida en `ratingbet_pipeline.js`:

| Edad de la captura | Efecto |
|---|---|
| < 180 min (`MAX_ANTIGUEDAD_MIN`) | normal |
| 180 – 2880 min | **se publica** pero con aviso de datos viejos |
| > 2880 min (`MAX_ANTIGUEDAD_CRITICA_MIN`) | **NO se publica nada**: la tabla queda vacía con aviso |

Con captura cada 3 h, lo recomendable es `RATINGBET_MAX_ANTIGUEDAD_MIN=300` en Vercel
para no mostrar el aviso a mitad de ciclo.

## Variables de entorno en Vercel (Settings > Environment Variables)

| Variable | Para qué |
|---|---|
| `RATINGBET_DATASET_URL` | URL del JSON publicado. **Sin ella la web usa el dataset congelado en el despliegue.** |
| `RATINGBET_DATASET_TOKEN` | Token de solo lectura si el repositorio es **privado** (se envía como Bearer) |
| `RATINGBET_MAX_ANTIGUEDAD_MIN` | Umbral de aviso de antigüedad (por defecto 180) |
| `RATINGBET_MARGEN_MIN` | Minutos de margen antes del kickoff (por defecto 30) |
| `RATINGBET_VENTANA_DIAS` | Días de ventana hacia el futuro |

## Operación diaria

```
npm test                 # todas las suites (6 OK / 2 SKIP esperados)
npm run verifica:nube    # ¿la web está leyendo datos frescos?
npm run diag:cloudflare  # ¿esta IP pasa Cloudflare sin navegador? (siempre NO)
```

Captura manual (equivale a lo que hace GitHub Actions):

```
node tools_publicar_dataset.js --modo=info --dias=2      # captura + módulo embebido
node scrape_ratingbet.js --dias=3 --headed               # ver el navegador, 3 días
```

## Diagnóstico de "siguen saliendo los mismos partidos"

El botón "🔄 Actualizar datos" (`?force=1`) **solo salta la caché de 5 minutos del
servidor**: nunca puede capturar. Si los partidos no cambian, mira en este orden:

1. `npm run verifica:nube` → ¿`modo` del dataset es `remoto` y la edad < 180 min?
2. GitHub → Actions → "Captura ratingbet" → ¿la última ejecución fue OK?
3. Log del workflow, paso "Diagnostico Cloudflare (informativo)".
4. Si el paso de captura falló: ¿Cloudflare ha bloqueado la IP del runner? Es el
   único riesgo real del montaje en la nube (se mitiga con un proxy o cambiando a
   un capturador con IP residencial).

## Historial de decisiones

- **v7**: los partidos salen SOLO del dataset real del scraper; la IA únicamente
  adjudica (no descubre). Antes el LLM podía inventar fixtures.
- **v7.4** (17/09/2026): soporte de `RATINGBET_DATASET_TOKEN`, cache-buster en la
  lectura remota, respaldo base64 para la API de contenidos de GitHub, emojis de
  `BANDAS_RIESGO` reparados y `tools_run_tests.js` con código de salida real.
