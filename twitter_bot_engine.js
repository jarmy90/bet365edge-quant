// =============================================================================
// TWITTER / X AUTO-PUBLISHER BOT v2.0 - CORE ENGINE
// -----------------------------------------------------------------------------
// MOTOR PRINCIPAL CON STEALTH AVANZADO, ROTACIÓN DE PLANTILLAS Y 48H HISTORIAL
// =============================================================================

import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getRandomViewport, getRandomUserAgent, delay, randomDelay, typeLikeHuman } from './utils/stealth.js';
import { getRandomTemplate } from './utils/templates.js';
import { generateMatchCardImage } from './utils/imageGenerator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const CONFIG = {
    username: process.env.X_USERNAME || '',
    password: process.env.X_PASSWORD || '',
    email: process.env.X_EMAIL || '',
    apiUrl: process.env.EDGE_API_URL || 'https://edge.futbol/api/fixtures-hoy',
    headless: process.env.HEADLESS !== 'false',
    minEdge: parseFloat(process.env.MIN_EDGE_PERCENT || '3.0'),
    userDataDir: path.join(DATA_DIR, 'x_session_data'),
    historyFile: path.join(DATA_DIR, 'twitter_posted_history.json'),
    tempCardPath: path.join(DATA_DIR, 'match_card_temp.png'),
    historyHours: 48 // 48 horas de ventana para desduplicar
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

function log(msg, level = 'INFO') {
    const time = new Date().toISOString().replace('T', ' ').substring(0, 19);
    console.log(`[${time}] [${level}] ${msg}`);
}

function findChromePath() {
    for (const p of CHROME_PATHS) {
        if (p && fs.existsSync(p)) return p;
    }
    throw new Error('No se encontró ejecutable de Chrome o Edge en el sistema.');
}

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

async function fetchTopOpportunities() {
    log(`Consultando API de oportunidades: ${CONFIG.apiUrl}`);
    const res = await fetch(CONFIG.apiUrl);
    if (!res.ok) throw new Error(`API error HTTP ${res.status}`);
    const data = await res.json();
    
    if (!data.ok || !Array.isArray(data.fixtures) || data.fixtures.length === 0) {
        log('No se encontraron partidos futuros en la API en este momento.', 'WARN');
        return [];
    }

    const valid = data.fixtures.filter(f => {
        const edgeVal = parseFloat(f.edgeNum || f.edge || 0);
        return edgeVal >= CONFIG.minEdge;
    });

    valid.sort((a, b) => (parseFloat(b.edgeNum || b.edge || 0) - parseFloat(a.edgeNum || a.edge || 0)));
    return valid;
}

async function publishToTwitter(tweetText, imagePath, isDryRun, isLoginOnly, isHeaded) {
    const chromePath = findChromePath();
    const viewport = getRandomViewport();
    const userAgent = getRandomUserAgent();

    log(`Iniciando navegador Stealth (Viewport: ${viewport.width}x${viewport.height})...`);

    const browser = await puppeteer.launch({
        executablePath: chromePath,
        headless: isHeaded ? false : (isLoginOnly ? false : CONFIG.headless),
        userDataDir: CONFIG.userDataDir,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            `--window-size=${viewport.width},${viewport.height}`
        ]
    });

    const page = await browser.newPage();
    await page.setUserAgent(userAgent);
    await page.setViewport(viewport);

    // Evitar que sitios detecten navigator.webdriver
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    try {
        log('Navegando a https://x.com/home...');
        await page.goto('https://x.com/home', { waitUntil: 'networkidle2', timeout: 45000 });
        await randomDelay(2200, 4500);

        // Detectar Captcha o bloqueo de seguridad
        const hasCaptcha = await page.$('iframe[src*="captcha"], input[name="captcha"], [data-testid="challenge"]');
        if (hasCaptcha) {
            log('CRÍTICO: Se ha detectado un reto/captcha de seguridad en X. El bot se detiene por seguridad.', 'ERROR');
            await browser.close();
            return false;
        }

        const currentUrl = page.url();
        const isLoggedIn = currentUrl.includes('/home') || (await page.$('[data-testid="SideNav_NewTweet_Button"], [data-testid="tweetTextarea_0"]')) !== null;

        if (!isLoggedIn) {
            log('Sesión no activa. Iniciando proceso de login seguro...', 'WARN');
            await page.goto('https://x.com/i/flow/login', { waitUntil: 'networkidle2' });
            await randomDelay(3000, 5500);

            if (!CONFIG.username || !CONFIG.password) {
                log('CRÍTICO: No se han configurado X_USERNAME y X_PASSWORD en .env.', 'ERROR');
                log('Para loguearte por primera vez ejecuta: node twitter_bot_engine.js --login', 'IMPORTANT');
                await browser.close();
                return false;
            }

            log(`Introduciendo usuario: ${CONFIG.username}`);
            const userInputSelector = 'input[autocomplete="username"]';
            await page.waitForSelector(userInputSelector, { timeout: 20000 });
            await typeLikeHuman(page, userInputSelector, CONFIG.username);
            await randomDelay(1500, 3000);
            await page.keyboard.press('Enter');
            await randomDelay(3000, 5000);

            const extraVerification = await page.$('input[data-testid="ocfEnterTextTextInput"]');
            if (extraVerification && CONFIG.email) {
                log('X solicita verificación adicional...');
                await typeLikeHuman(page, 'input[data-testid="ocfEnterTextTextInput"]', CONFIG.email);
                await page.keyboard.press('Enter');
                await randomDelay(3000, 5000);
            }

            log('Introduciendo contraseña...');
            const passSelector = 'input[name="password"]';
            await page.waitForSelector(passSelector, { timeout: 20000 });
            await typeLikeHuman(page, passSelector, CONFIG.password);
            await randomDelay(1500, 3000);
            await page.keyboard.press('Enter');

            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
            await randomDelay(4000, 7000);
            log('Login completado y sesión guardada en data/x_session_data.');
        } else {
            log('Sesión activa detectada en data/x_session_data.');
        }

        if (isLoginOnly) {
            log('Modo --login finalizado con éxito. Sesión almacenada.', 'SUCCESS');
            await browser.close();
            return true;
        }

        if (isDryRun) {
            log('[DRY-RUN] Simulación completa. Tuit generado:', 'INFO');
            console.log('--------------------------------------------------');
            console.log(tweetText);
            console.log('--------------------------------------------------');
            if (imagePath && fs.existsSync(imagePath)) {
                log(`[DRY-RUN] Imagen guardada en: ${imagePath}`);
            } else {
                log('[DRY-RUN] Publicación simulada sólo con texto (fallback).');
            }
            await browser.close();
            return true;
        }

        log('Abriendo compositor de publicaciones...');
        await page.goto('https://x.com/compose/post', { waitUntil: 'networkidle2' });
        await randomDelay(2500, 4800);

        const tweetInputSelector = '[data-testid="tweetTextarea_0"]';
        await page.waitForSelector(tweetInputSelector, { timeout: 20000 });
        await page.click(tweetInputSelector);
        await randomDelay(1000, 2000);

        log('Mecanografiando tuit con ritmo humano natural...');
        await typeLikeHuman(page, tweetInputSelector, tweetText);
        await randomDelay(2000, 4500);

        if (imagePath && fs.existsSync(imagePath)) {
            log('Adjuntando tarjeta de imagen PNG...');
            const fileInputSelector = 'input[data-testid="fileInput"]';
            const fileInput = await page.$(fileInputSelector);
            if (fileInput) {
                await fileInput.uploadFile(imagePath);
                await randomDelay(3500, 6000);
            }
        }

        log('Pulsando botón de Publicar...');
        const postButtonSelector = '[data-testid="tweetButton"]';
        await page.waitForSelector(postButtonSelector, { timeout: 10000 });
        
        // Pausa justo antes de enviar
        await randomDelay(1800, 4200);
        await page.click(postButtonSelector);

        await randomDelay(5000, 8000);
        log('¡Tuit publicado exitosamente en X!', 'SUCCESS');

        await browser.close();
        return true;

    } catch (err) {
        log(`Error durante la publicación: ${err.message}`, 'ERROR');
        await browser.close();
        return false;
    }
}

async function main() {
    const isDryRun = process.argv.includes('--dry-run');
    const isLoginOnly = process.argv.includes('--login-only') || process.argv.includes('--login');
    const isHeaded = process.argv.includes('--headed');

    log('=============================================================================');
    log('🤖 EDGE.FUTBOL - AUTO-PUBLISHER BOT DE TWITTER / X (v2.0 STEALTH)');
    log('=============================================================================');

    if (isLoginOnly) {
        log('Modo inicio de sesión manual (--login).');
        await publishToTwitter('', '', false, true, true);
        return;
    }

    const opportunities = await fetchTopOpportunities();
    if (opportunities.length === 0) {
        log('Sin oportunidades en este momento. Finalizando ejecucion.');
        return;
    }

    const history = getHistory();
    const now = Date.now();
    const cutoff = now - CONFIG.historyHours * 60 * 60 * 1000; // 48 horas

    let selectedFixture = null;
    for (const f of opportunities) {
        const key = `${f.partido || (f.local + '-' + f.visitante)}_${f.mercado || 'O25'}_${f.cuota365 || f.cuota || ''}`;
        const postedRecently = history.some(h => h.key === key && h.timestamp > cutoff);
        if (!postedRecently) {
            selectedFixture = f;
            selectedFixture._key = key;
            break;
        }
    }

    if (!selectedFixture) {
        log(`Todos los partidos analizados ya han sido publicados en las ultimas ${CONFIG.historyHours}h.`, 'INFO');
        return;
    }

    log(`Seleccionada mejor oportunidad: ${selectedFixture.partido} (${selectedFixture.mercadoNombre || selectedFixture.mercado}) - Edge: ${selectedFixture.edgeFormat}`);

    // Intentar generar tarjeta de imagen (con fallback a texto solo si falla)
    const chromePath = findChromePath();
    let imagePath = null;
    try {
        const tempBrowser = await puppeteer.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox'] });
        const tempPage = await tempBrowser.newPage();
        imagePath = await generateMatchCardImage(tempPage, selectedFixture, CONFIG.tempCardPath);
        await tempBrowser.close();
    } catch (e) {
        log(`No se pudo generar la imagen: ${e.message}. Continuando con publicar sólo texto.`, 'WARN');
    }

    const tweetText = getRandomTemplate(selectedFixture);

    const ok = await publishToTwitter(tweetText, imagePath, isDryRun, false, isHeaded);

    if (ok && !isDryRun) {
        history.push({
            key: selectedFixture._key,
            match: selectedFixture.partido,
            market: selectedFixture.mercado,
            odds: selectedFixture.cuota365 || selectedFixture.cuota,
            edge: selectedFixture.edgeFormat,
            timestamp: now,
            dateIso: new Date(now).toISOString()
        });
        saveHistory(history);
        log(`Historial actualizado. Registros acumulados: ${history.length}`);
    }

    if (fs.existsSync(CONFIG.tempCardPath)) {
        try { fs.unlinkSync(CONFIG.tempCardPath); } catch (_) {}
    }

    log('Ejecución finalizada correctamente.');
}

main().catch(err => {
    log(`Excepción en main: ${err.stack}`, 'ERROR');
    process.exit(1);
});
