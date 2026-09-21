// =============================================================================
// TWITTER / X AUTO-PUBLISHER BOT FOR EDGE.FUTBOL (100% FREE VIA PUPPETEER)
// -----------------------------------------------------------------------------
// CARACTERÍSTICAS:
//   1. 100% Gratuito: Usa Puppeteer con Chrome Real (sin API de pago de X).
//   2. Sesión Persistente: Guarda cookies en ./x_session_data para no volver a loguearse.
//   3. Delays Humanos / Anti-Ban: Pausas aleatorias de simulación de mecanografiado.
//   4. Fuente de Datos: Lee directamente de https://edge.futbol/api/fixtures-hoy.
//   5. Desduplicación: Mantiene twitter_posted_history.json para no repetir tuits.
//   6. Generación de Imagen: Crea una tarjeta visual del partido (PNG) al vuelo.
//
// USO:
//   node twitter_bot_engine.js                 # Buscar y publicar 1 oportunidad
//   node twitter_bot_engine.js --dry-run       # Simular todo sin publicar en X
//   node twitter_bot_engine.js --headed        # Abrir el navegador visible para ver las acciones
//   node twitter_bot_engine.js --login-only    # Iniciar sesión manual por primera vez y guardar cookies
// =============================================================================

import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cargar variables de .env o process.env
function loadEnv() {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf-8');
        content.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
                const [k, ...v] = trimmed.split('=');
                if (!process.env[k.trim()]) {
                    process.env[k.trim()] = v.join('=').trim();
                }
            }
        });
    }
}
loadEnv();

// Configuración predeterminada
const CONFIG = {
    username: process.env.X_USERNAME || '',
    password: process.env.X_PASSWORD || '',
    email: process.env.X_EMAIL || '',
    apiUrl: process.env.EDGE_API_URL || 'https://edge.futbol/api/fixtures-hoy',
    headless: process.env.HEADLESS !== 'false',
    minEdge: parseFloat(process.env.MIN_EDGE_PERCENT || '3.0'),
    userDataDir: path.join(__dirname, 'x_session_data'),
    historyFile: path.join(__dirname, 'twitter_posted_history.json'),
    tempCardPath: path.join(__dirname, 'match_card_temp.png')
};

const CHROME_PATHS = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium'
].filter(Boolean);

// Emojis dinámicos para diversificar los tuits y evitar detección de duplicados por X
const EMOJI_TEMPLATES = [
    { header: "🔥 Oportunidad detectada (+EV)", target: "Mercado", icon: "📊" },
    { header: "⚡ Señal Quant Cuantitativa", target: "Pick de Valor", icon: "🎯" },
    { header: "⚽ Ventaja Estadística Aisla", target: "Línea de Goles", icon: "🟢" },
    { header: "🚀 Value Betting Alert", target: "Mercado Seleccionado", icon: "📈" }
];

function log(msg, level = 'INFO') {
    const time = new Date().toISOString().replace('T', ' ').substring(0, 19);
    console.log(`[${time}] [${level}] ${msg}`);
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay(minMs = 1500, maxMs = 4000) {
    const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return delay(ms);
}

function findChromePath() {
    for (const p of CHROME_PATHS) {
        if (p && fs.existsSync(p)) return p;
    }
    throw new Error('No se encontró ejecutable de Chrome o Edge en el sistema.');
}

// Historial para desduplicar partidos publicados
function getHistory() {
    try {
        if (fs.existsSync(CONFIG.historyFile)) {
            return JSON.parse(fs.readFileSync(CONFIG.historyFile, 'utf-8'));
        }
    } catch (e) {
        log('Error leyendo archivo de historial, iniciando nuevo.', 'WARN');
    }
    return [];
}

function saveHistory(history) {
    fs.writeFileSync(CONFIG.historyFile, JSON.stringify(history, null, 2), 'utf-8');
}

// 1. Obtener oportunidades desde la API oficial de edge.futbol
async function fetchTopOpportunities() {
    log(`Consultando API de oportunidades: ${CONFIG.apiUrl}`);
    const res = await fetch(CONFIG.apiUrl);
    if (!res.ok) throw new Error(`API error HTTP ${res.status}`);
    const data = await res.json();
    
    if (!data.ok || !Array.isArray(data.fixtures) || data.fixtures.length === 0) {
        log('No se encontraron partidos futuros en la API en este momento.', 'WARN');
        return [];
    }

    // Filtrar fixtures que tengan edge positivo aceptable (+EV)
    const valid = data.fixtures.filter(f => {
        const edgeVal = parseFloat(f.edgeNum || f.edge || 0);
        return edgeVal >= CONFIG.minEdge;
    });

    // Ordenar de mayor a menor ventaja (+EV)
    valid.sort((a, b) => (parseFloat(b.edgeNum || b.edge || 0) - parseFloat(a.edgeNum || a.edge || 0)));
    return valid;
}

// 2. Generar tarjeta visual estática/dinámica (PNG) del partido usando Puppeteer Canvas en memoria
async function generateMatchCardImage(page, fixture) {
    const matchName = fixture.partido || `${fixture.local} vs ${fixture.visitante}`;
    const league = fixture.liga || 'Liga de Fútbol';
    const market = fixture.mercadoNombre || fixture.mercado || 'Más de 2.5 Goles';
    const odds = fixture.cuota365 || fixture.cuota || '1.90';
    const edge = fixture.edgeFormat || `+${fixture.edgeNum || 5.0}%`;
    const dateStr = fixture.horaLabel || `${fixture.dia || 'Hoy'} ${fixture.hora || ''}`;

    const cardHtml = `<!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body { margin:0; padding:0; width:1200px; height:675px; background:#06070a; font-family:'Segoe UI', Roboto, sans-serif; color:#fff; display:flex; flex-direction:column; justify-content:space-between; box-sizing:border-box; padding:50px; }
            .badge { display:inline-block; background:rgba(13,242,166,0.15); border:1.5px solid #0df2a6; color:#0df2a6; font-weight:800; font-size:22px; padding:8px 20px; border-radius:12px; letter-spacing:1px; }
            .league { font-size:24px; color:#94a3b8; font-weight:600; text-transform:uppercase; margin-top:15px; }
            .title { font-size:52px; font-weight:900; margin:15px 0 25px 0; color:#ffffff; line-height:1.1; }
            .metrics-grid { display:grid; grid-template-columns:1fr 1fr; gap:25px; margin-bottom:20px; }
            .metric-box { background:#0d0f15; border:1px solid rgba(255,255,255,0.1); border-radius:20px; padding:25px; text-align:center; }
            .metric-label { font-size:20px; color:#64748b; font-weight:700; margin-bottom:8px; text-transform:uppercase; }
            .metric-val { font-size:48px; font-weight:900; font-family:monospace; }
            .footer { display:flex; justify-content:space-between; align-items:center; border-top:1px solid rgba(255,255,255,0.1); padding-top:25px; font-size:22px; color:#94a3b8; }
            .brand { color:#0df2a6; font-weight:900; font-size:28px; }
        </style>
    </head>
    <body>
        <div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span class="badge">🔥 +EV VALUE BETTING</span>
                <span style="color:#64748b; font-size:22px; font-weight:700;">${dateStr}</span>
            </div>
            <div class="league">${league}</div>
            <div class="title">${matchName}</div>
        </div>

        <div class="metrics-grid">
            <div class="metric-box">
                <div class="metric-label">Mercado Selección</div>
                <div class="metric-val" style="color:#00d4ff;">${market}</div>
            </div>
            <div class="metric-box">
                <div class="metric-label">Cuota / Ventaja (+EV)</div>
                <div class="metric-val" style="color:#0df2a6;">${odds} <span style="font-size:32px;">(${edge})</span></div>
            </div>
        </div>

        <div class="footer">
            <span>Análisis cuantitativo libre en tiempo real</span>
            <span class="brand">EDGE.FUTBOL</span>
        </div>
    </body>
    </html>`;

    await page.setViewport({ width: 1200, height: 675 });
    await page.setContent(cardHtml, { waitUntil: 'load' });
    await page.screenshot({ path: CONFIG.tempCardPath, type: 'png' });
    log(`Tarjeta gráfica visual generada exitosamente en ${CONFIG.tempCardPath}`);
}

// 3. Formatear texto del Tuit
function formatTweetText(fixture) {
    const template = EMOJI_TEMPLATES[Math.floor(Math.random() * EMOJI_TEMPLATES.length)];
    const matchName = fixture.partido || `${fixture.local} vs ${fixture.visitante}`;
    const market = fixture.mercadoNombre || fixture.mercado || 'Más de 2.5 Goles';
    const odds = fixture.cuota365 || fixture.cuota || '1.90';
    const edge = fixture.edgeFormat || `+${fixture.edgeNum || 5.0}%`;
    const league = fixture.ligaShort || fixture.liga || '';

    return `${template.header}

⚽ ${matchName}${league ? ` (${league})` : ''}
${template.icon} ${template.target}: ${market}
💰 Cuota: ${odds} | Edge: ${edge}

📊 Análisis cuantitativo 24/7 en directo:
👉 https://edge.futbol

#ApuestasDeportivas #Futbol #ValueBetting #Picks #Bet365`;
}

// 4. Mecanografía simulada para comportamiento humano
async function typeLikeHuman(page, selector, text) {
    await page.focus(selector);
    for (const char of text) {
        await page.keyboard.sendCharacter(char);
        await delay(Math.floor(Math.random() * 50) + 20);
    }
}

// 5. Automatización del flujo de publicación en Twitter/X con Puppeteer
async function publishToTwitter(tweetText, imagePath, isDryRun, isLoginOnly, isHeaded) {
    const chromePath = findChromePath();
    log(`Iniciando navegador con ejecutable: ${chromePath}`);

    const browser = await puppeteer.launch({
        executablePath: chromePath,
        headless: isHeaded ? false : (isLoginOnly ? false : CONFIG.headless),
        userDataDir: CONFIG.userDataDir,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1280,800'
        ]
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 800 });

    try {
        log('Navegando a https://x.com/home...');
        await page.goto('https://x.com/home', { waitUntil: 'networkidle2', timeout: 45000 });
        await randomDelay(2000, 4000);

        // Verificar si la sesión está iniciada
        const currentUrl = page.url();
        const isLoggedIn = currentUrl.includes('/home') || (await page.$('[data-testid="SideNav_NewTweet_Button"], [data-testid="tweetTextarea_0"]')) !== null;

        if (!isLoggedIn) {
            log('Sesión no detectada. Iniciando proceso de login...', 'WARN');
            await page.goto('https://x.com/i/flow/login', { waitUntil: 'networkidle2' });
            await randomDelay(3000, 5000);

            if (!CONFIG.username || !CONFIG.password) {
                log('CRÍTICO: No se han configurado X_USERNAME y X_PASSWORD en el archivo .env.', 'ERROR');
                log('Para loguearte la primera vez, ejecuta: node twitter_bot_engine.js --login-only', 'IMPORTANT');
                await browser.close();
                return false;
            }

            // Paso 1: Introducir usuario / email
            log(`Introduciendo usuario: ${CONFIG.username}`);
            const userInputSelector = 'input[autocomplete="username"]';
            await page.waitForSelector(userInputSelector, { timeout: 20000 });
            await typeLikeHuman(page, userInputSelector, CONFIG.username);
            await randomDelay(1000, 2000);

            // Pulsar "Siguiente"
            await page.keyboard.press('Enter');
            await randomDelay(2500, 4000);

            // Verificar si X pide email/teléfono de verificación adicional
            const extraVerification = await page.$('input[data-testid="ocfEnterTextTextInput"]');
            if (extraVerification && CONFIG.email) {
                log('X solicita verificación adicional (email/teléfono)...');
                await typeLikeHuman(page, 'input[data-testid="ocfEnterTextTextInput"]', CONFIG.email);
                await page.keyboard.press('Enter');
                await randomDelay(2500, 4000);
            }

            // Paso 2: Introducir contraseña
            log('Introduciendo contraseña...');
            const passSelector = 'input[name="password"]';
            await page.waitForSelector(passSelector, { timeout: 20000 });
            await typeLikeHuman(page, passSelector, CONFIG.password);
            await randomDelay(1000, 2000);
            await page.keyboard.press('Enter');

            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
            await randomDelay(4000, 6000);
            log('Login completado y sesión guardada en x_session_data.');
        } else {
            log('Sesión activa detectada (cookies cargadas de x_session_data).');
        }

        if (isLoginOnly) {
            log('Modo --login-only finalizado con éxito. Sesión guardada.', 'SUCCESS');
            await browser.close();
            return true;
        }

        if (isDryRun) {
            log('[DRY-RUN] Simulación completa. Tuit generado:', 'INFO');
            console.log('--------------------------------------------------');
            console.log(tweetText);
            console.log('--------------------------------------------------');
            log(`[DRY-RUN] Imagen guardada en: ${imagePath}`);
            await browser.close();
            return true;
        }

        // Proceso de publicación del Tuit en la interfaz de X
        log('Abriendo caja de redacción de tuit...');
        await page.goto('https://x.com/compose/post', { waitUntil: 'networkidle2' });
        await randomDelay(2000, 4000);

        const tweetInputSelector = '[data-testid="tweetTextarea_0"]';
        await page.waitForSelector(tweetInputSelector, { timeout: 20000 });
        await page.click(tweetInputSelector);
        await randomDelay(800, 1500);

        log('Escribiendo texto del tuit con mecanografía humana...');
        await typeLikeHuman(page, tweetInputSelector, tweetText);
        await randomDelay(1500, 3000);

        // Subir imagen si existe
        if (imagePath && fs.existsSync(imagePath)) {
            log('Adjuntando tarjeta de imagen al tuit...');
            const fileInputSelector = 'input[data-testid="fileInput"]';
            const fileInput = await page.$(fileInputSelector);
            if (fileInput) {
                await fileInput.uploadFile(imagePath);
                await randomDelay(3000, 5000); // Esperar a que se procese la carga de la imagen
            }
        }

        // Botón Publicar / Post
        log('Pulsando botón de Publicar...');
        const postButtonSelector = '[data-testid="tweetButton"]';
        await page.waitForSelector(postButtonSelector, { timeout: 10000 });
        await page.click(postButtonSelector);

        await randomDelay(4000, 7000);
        log('¡Tuit publicado exitosamente en X!', 'SUCCESS');

        await browser.close();
        return true;

    } catch (err) {
        log(`Error durante la automatización con Puppeteer: ${err.message}`, 'ERROR');
        await browser.close();
        return false;
    }
}

// 6. Función Principal de Control (Main)
async function main() {
    const isDryRun = process.argv.includes('--dry-run');
    const isLoginOnly = process.argv.includes('--login-only');
    const isHeaded = process.argv.includes('--headed');

    log('=============================================================================');
    log('🤖 EDGE.FUTBOL - AUTO-PUBLISHER BOT DE TWITTER / X (100% GRATIS)');
    log('=============================================================================');

    if (isLoginOnly) {
        log('Modo solo inicio de sesión seleccionado (--login-only).');
        await publishToTwitter('', '', false, true, true);
        return;
    }

    // 1. Obtener oportunidades
    const opportunities = await fetchTopOpportunities();
    if (opportunities.length === 0) {
        log('Sin oportunidades para publicar en esta ejecución.');
        return;
    }

    // 2. Comprobar historial para no repetir tuit
    const history = getHistory();
    const now = Date.now();
    
    // Buscar el primer partido que no se haya publicado recientemente
    let selectedFixture = null;
    for (const f of opportunities) {
        const key = `${f.partido || (f.local + '-' + f.visitante)}_${f.mercado || 'O25'}`;
        const alreadyPosted = history.some(h => h.key === key && (now - h.timestamp) < 24 * 60 * 60 * 1000);
        if (!alreadyPosted) {
            selectedFixture = f;
            selectedFixture._key = key;
            break;
        }
    }

    if (!selectedFixture) {
        log('Todas las oportunidades encontradas ya han sido publicadas en las últimas 24h.', 'INFO');
        return;
    }

    log(`Seleccionada oportunidad principal: ${selectedFixture.partido} (${selectedFixture.mercadoNombre || selectedFixture.mercado}) - Edge: ${selectedFixture.edgeFormat}`);

    // 3. Generar imagen dinámica
    const chromePath = findChromePath();
    const browserTemp = await puppeteer.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox'] });
    const pageTemp = await browserTemp.newPage();
    await generateMatchCardImage(pageTemp, selectedFixture);
    await browserTemp.close();

    // 4. Formatear Tuit
    const tweetText = formatTweetText(selectedFixture);

    // 5. Publicar en Twitter / X
    const ok = await publishToTwitter(tweetText, CONFIG.tempCardPath, isDryRun, false, isHeaded);

    if (ok && !isDryRun) {
        history.push({
            key: selectedFixture._key,
            match: selectedFixture.partido,
            market: selectedFixture.mercado,
            edge: selectedFixture.edgeFormat,
            timestamp: now,
            dateIso: new Date(now).toISOString()
        });
        saveHistory(history);
        log(`Historial actualizado. Total partidos publicados registrados: ${history.length}`);
    }

    // Limpiar imagen temporal
    if (fs.existsSync(CONFIG.tempCardPath)) {
        try { fs.unlinkSync(CONFIG.tempCardPath); } catch (e) {}
    }

    log('Ejecución del bot finalizada con éxito.');
}

main().catch(err => {
    log(`Excepción no controlada en main: ${err.stack}`, 'ERROR');
    process.exit(1);
});
