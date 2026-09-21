// =============================================================================
// TWITTER / X CRON RUNNER v2.0 (CON HORARIOS ALEATORIZADOS DE VENTANA)
// -----------------------------------------------------------------------------
// Ejecuta publicaciones aleatorias dentro de ventanas fijas al día
// para evitar que Twitter detecte horas exactas repetitivas.
// =============================================================================

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function log(msg) {
    const time = new Date().toISOString().replace('T', ' ').substring(0, 19);
    console.log(`[CRON-V2] [${time}] ${msg}`);
}

function runBotScript() {
    log('Iniciando ejecución de twitter_bot_engine.js...');
    const child = spawn('node', ['twitter_bot_engine.js'], {
        cwd: __dirname,
        stdio: 'inherit'
    });

    child.on('close', code => {
        log(`Ejecución del bot finalizada con código: ${code}`);
        scheduleNextRandomRun();
    });
}

function scheduleNextRandomRun() {
    // Frecuencia base 4 horas + variación aleatoria de +/- 45 minutos (en ms)
    const baseIntervalMs = 4 * 60 * 60 * 1000;
    const randomJitterMs = (Math.random() - 0.5) * 90 * 60 * 1000;
    const nextIntervalMs = Math.max(2.5 * 60 * 60 * 1000, Math.floor(baseIntervalMs + randomJitterMs));
    
    const nextDate = new Date(Date.now() + nextIntervalMs);
    log(`Próxima publicación programada de forma aleatoria para las ${nextDate.toLocaleTimeString()} (en ${Math.round(nextIntervalMs / 60000)} minutos).`);
    
    setTimeout(runBotScript, nextIntervalMs);
}

log('=== EDGE.FUTBOL TWITTER CRON DAEMON v2.0 (HORARIOS ALEATORIOS) ===');

if (process.argv.includes('--now')) {
    runBotScript();
} else {
    scheduleNextRandomRun();
}
