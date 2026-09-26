# Proyectos: edge-futbol + mt5-explorer (monorepo con 2 proyectos independientes)

> **Regla nº1 para IA y humanos: son 2 proyectos SEPARADOS. Nunca mezcles ficheros entre `edge-futbol/` y `mt5-explorer/`. Antes de tocar nada, identifica en qué proyecto estás y trabaja SOLO dentro de su carpeta.**

## Router rápido (¿dónde trabajo?)

| Si quieres... | Ve a... | Comando base |
|---|---|---|
| Web edge.futbol, API, scraper ratingbet, bot X, Vercel/Cloudflare | `edge-futbol/` | `cd edge-futbol` → `npm ci` → `npm test` |
| Estrategias MT5, DAX, Explorer VDPM, `.mq5`, CSVs, auditoría Python | `mt5-explorer/` | `cd mt5-explorer/vdpm_results` → `python audit_vdpm.py` |
| CI (GitHub Actions), gitignore global, este README | raíz `./` | — |

## Estructura

```
./                              ← SOLO config compartida: .gitignore, .github/, .vscode/, este README
├── edge-futbol/                ← PROYECTO 1: web edge.futbol (Node.js). Ver edge-futbol/README_PROYECTO.md
│   ├── api/index.js + worker.js  (API Vercel/Cloudflare)
│   ├── scrape_ratingbet.js, tools_*.js, test_*.js, ratingbet_fixtures*.json*
│   ├── twitter_bot_engine.js, twitter_cron_runner.js, utils/, data/
│   ├── package.json, vercel.json, wrangler.toml, .env* (local, NO se sube)
│   └── node_modules/, .vercel/, .wrangler/ (local, NO se sube)
└── mt5-explorer/               ← PROYECTO 2: explorador MT5 (Python/MQL5, SIN npm). Ver mt5-explorer/README.md
    ├── download/                 CSVs DAX (pesados, ignorados por git)
    └── vdpm_results/             .mq5 (sí se versiona), .ex5/.log/trades/signals grandes (no), audit_vdpm.py, *_summary.csv
```

## Límites entre proyectos (contrato)

- **Prohibido**: importar/copiar ficheros de un proyecto en el otro; mover ficheros entre carpetas; añadir dependencias cruzadas.
- **Compartido solo**: `.gitignore`, `.github/workflows/` (cada workflow declara su `working-directory`), `.vscode/`, este README.
- Los secretos (`.env`, `wrangler.toml`, `.vercel/`, `data/x_session_data/`) viven en `edge-futbol/` y **nunca** se suben ni se copian a `mt5-explorer/`.
- Los CSVs pesados de MT5 **nunca** van a `edge-futbol/` ni a git (ver `.gitignore`).

## Instrucciones para la IA (prompt de arranque sugerido)

> "Trabaja SOLO en `<edge-futbol|mt5-explorer>`. No leas ni modifiques la otra carpeta salvo que te lo pida explícitamente. Usa rutas absolutas bajo esa carpeta, respeta su README y su stack (`edge-futbol`=Node.js+Vercel, `mt5-explorer`=Python+MQL5). Si un cambio afecta a `.github/` o `.gitignore` de raíz, avísame antes."

## Comandos habituales

```powershell
# Proyecto 1 — web
cd edge-futbol; npm ci; npm test
node tools_publicar_dataset.js --modo=info --dias=2   # captura (desde edge-futbol/)
node tools_verifica_nube.js                           # verifica nube

# Proyecto 2 — MT5
cd mt5-explorer/vdpm_results; python audit_vdpm.py
```

## Despliegues / CI

- Vercel: **Root Directory = `edge-futbol`**.
- Cloudflare Worker (`edge-futbol/wrangler.toml`, ignorado por git): desplegar desde `edge-futbol/`.
- Workflows en `.github/workflows/` ya usan `working-directory: edge-futbol`.
- Rama `dataset`: el fichero es `edge-futbol/ratingbet_fixtures.json`.
- Futuro opcional: separar cada carpeta en su propio repo si los despliegues/secretos chocan.

