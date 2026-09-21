// =============================================================================
// TWITTER / X CRON RUNNER & DAEMON FOR EDGE.FUTBOL
// -----------------------------------------------------------------------------
// Ejecuta el bot de Twitter en intervalos regulares (por defecto cada 4 horas)
// para mantener un flujo continuo de 3 a 5 publicaciones diarias.
//
// USO:
//   node twitter_cron_runner.js               # Ejecuta en bucle según POST_INTERVAL_HOURS
//   node twitter_cron_runner.js --now         # Ejecuta una vez de inmediato y luego sigue en bucle
// =============================================================================

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cargar variables de entorno
const envPath = path.join(__dirname, '.env');
let intervalHours = 4;

if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('POST_INTERVAL_HOURS=')) {
            const val = parseFloat(trimmed.split('=')[1]);
            if (val && val > 0) intervalHours = val;
        }
    });
}

const INTERVAL_MS = intervalHours * 60 * 60 * 1000;

function log(msg) {
    const time = new Date().toISOString().replace('T', ' ').substring(0, 19);
    console.log(`[CRON-RUNNER] [${time}] ${msg}`);
}

function runBotScript() {
    log('Iniciando ejecución programada de twitter_bot_engine.js...');
    const child = spawn('node', ['twitter_bot_engine.js'], {
        cwd: __dirname,
        stdio: 'inherit'
    });

    child.on('close', code => {
        log(`Proceso finalizado con código de salida: ${code}`);
        log(`Próxima publicación programada en ${intervalHours} horas (${new Date(Date.now() + INTERVAL_MS).toLocaleTimeString()}).`);
    });
}

log(`=== EDGE.FUTBOL TWITTER CRON DAEMON INICIADO ===`);
log(`Frecuencia de publicación configurada: Cada ${intervalHours} horas (${Math.round(24 / intervalHours)} tuits al día).`);

if (process.argv.includes('--now')) {
    runBotScript();
}

setInterval(runBotScript, INTERVAL_MS);
