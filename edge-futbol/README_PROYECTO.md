# Edge.futbol — web (carpeta del proyecto)

Todo lo de la web vive aquí. Trabajar siempre desde esta carpeta:

```powershell
cd edge-futbol
npm ci
npm test
```

- API web: `api/index.js` + `worker.js` (Vercel). En el dashboard de Vercel pon **Root Directory = `edge-futbol`**.
- Scraper/dataset: `scrape_ratingbet.js`, `tools_publicar_dataset.js`, `ratingbet_fixtures.json`, `ratingbet_fixtures_data.js`.
- Bot X: `twitter_bot_engine.js`, `twitter_cron_runner.js`, `utils/`, `data/`.
- CI: `.github/workflows/captura-ratingbet.yml` y `twitter_bot.yml` (en la raíz del repo) ya apuntan a `edge-futbol/`.
- Rama `dataset`: el fichero versionado es `edge-futbol/ratingbet_fixtures.json`.
- Secretos locales (`.env`, `.vercel`, `.wrangler`, `wrangler.toml`, `data/x_session_data/`) quedan dentro de esta carpeta y NO se suben (ver `.gitignore` raíz).
