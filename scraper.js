const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ALT_CHROME_PATH = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';

function getChromePath() {
    if (fs.existsSync(CHROME_PATH)) return CHROME_PATH;
    if (fs.existsSync(ALT_CHROME_PATH)) return ALT_CHROME_PATH;
    return null;
}

async function scrapePage(page, url) {
    console.log(`Navegando a ${url}...`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    
    // Esperar a que desaparezca Cloudflare si aparece (hasta 15 seg)
    for (let i = 0; i < 15; i++) {
        const text = await page.evaluate(() => document.body.innerText || '');
        if (!text.includes('Verificación de seguridad en curso') && !text.includes('Cloudflare')) {
            break;
        }
        console.log('Esperando paso de Cloudflare...');
        await new Promise(r => setTimeout(r, 1000));
    }

    // Esperar a que la tabla de partidos esté presente
    try {
        await page.waitForSelector('.total-goals-item, .game-item, table, [class*="match"]', { timeout: 15000 });
    } catch (e) {
        console.log('Esperando renderizado de partidos...');
    }

    // Hacer clic en la pestaña "Today" / "Hoy" y VERIFICARLO (evita partidos de ayer)
    const infoTab = { intentado: true, clickeado: false, verificado: false, texto: null, motivo: null };
    try {
        const resultado = await page.evaluate(() => {
            const normalizar = (t) => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
            const candidatos = Array.from(document.querySelectorAll('a, button, li, span, div, label'));
            const coincidencias = candidatos.filter(el => {
                const t = normalizar(el.textContent);
                return t === 'today' || t === 'hoy' || t === 'today.' || t === 'hoy.';
            });
            if (!coincidencias.length) return { clic: false, texto: null, motivo: 'sin-coincidencias' };
            coincidencias.sort((a, b) => (a.children.length - b.children.length) || (a.outerHTML.length - b.outerHTML.length));
            const objetivo = coincidencias[0];
            objetivo.click();
            return { clic: true, texto: (objetivo.textContent || '').trim(), motivo: 'ok' };
        });

        infoTab.clickeado = !!resultado.clic;
        infoTab.texto = resultado.texto;
        infoTab.motivo = resultado.motivo;

        if (resultado.clic) {
            console.log(`Pestana "Today / Hoy" clickeada (texto: "${resultado.texto}").`);
            await new Promise(r => setTimeout(r, 3000));

            infoTab.verificado = await page.evaluate(() => {
                const normalizar = (t) => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
                const activos = Array.from(document.querySelectorAll('*')).filter(el => {
                    const cls = el.className && el.className.toString ? el.className.toString().toLowerCase() : '';
                    const t = normalizar(el.textContent);
                    const esTab = cls.includes('active') || cls.includes('selected') || cls.includes('current') || cls.includes('tab--active');
                    return esTab && (t === 'today' || t === 'hoy');
                });
                return activos.length > 0;
            });
            console.log(infoTab.verificado
                ? 'Verificado: la pestana HOY esta activa en el DOM.'
                : 'Aviso: no se pudo confirmar visualmente la pestana HOY (se validara por hora de los partidos).');
        } else {
            console.log('No se encontro la pestana Today/Hoy:', resultado.motivo);
        }
    } catch (e) {
        infoTab.motivo = e.message;
        console.log('Error al seleccionar la pestana Today:', e.message);
    }

    await new Promise(r => setTimeout(r, 2000));

    let clickCount = 0;
    while (clickCount < 10) {
        try {
            const found = await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button, a, div.btn, span'));
                const target = buttons.find(b => {
                    const txt = (b.textContent || '').toLowerCase().trim();
                    return txt.includes('show more') || txt.includes('cargar más') || txt.includes('mostrar más');
                });
                if (target) {
                    target.click();
                    return true;
                }
                return false;
            });
            if (!found) break;
            console.log(`Clic en Show More (${clickCount + 1})...`);
            clickCount++;
            await new Promise(r => setTimeout(r, 2500));
        } catch (e) {
            break;
        }
    }

    await new Promise(r => setTimeout(r, 2000));

    const pageText = await page.evaluate(() => document.body.innerText);
    return { texto: pageText, infoTab };
}

// ---- Sello de captura (evita mostrar partidos de ayer) ----------------------
function partesEnMadrid(ms) {
    const out = {};
    new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new Date(ms)).forEach(p => { if (p.type !== 'literal') out[p.type] = p.value; });
    return out;
}

function selloCaptura(ms) {
    const p = partesEnMadrid(ms);
    return {
        capturadoEn: new Date(ms).toISOString(),
        capturadoEnMadrid: `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`,
        fechaMadrid: `${p.day}/${p.month}/${p.year}`,
        zonaHoraria: 'Europe/Madrid'
    };
}

// Comprueba si la primera hora encontrada en el texto ya ha pasado (indicio de datos de ayer)
function primerHoraEnTexto(texto) {
    const m = (texto || '').match(/\b([01]\d|2[0-3]):([0-5]\d)\b/);
    return m ? { hora: m[0], minutos: parseInt(m[1], 10) * 60 + parseInt(m[2], 10) } : null;
}

async function run() {
    const chromePath = getChromePath();
    if (!chromePath) {
        console.error('No se encontró Google Chrome en las rutas estándar.');
        return;
    }

    console.log('Iniciando navegador Chrome...');
    const browser = await puppeteer.launch({
        executablePath: chromePath,
        headless: false,
        defaultViewport: null,
        args: [
            '--start-maximized',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    try {
        const pages = await browser.pages();
        const page = pages.length > 0 ? pages[0] : await browser.newPage();

        // Ocultar webdriver
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });

        console.log('--- EXTRACCIÓN OVER/UNDER 1.5 ---');
        const res15 = await scrapePage(page, 'https://ratingbet.com/football/goals-over-under-1-5/');

        console.log('--- EXTRACCIÓN OVER/UNDER 2.5 ---');
        const res25 = await scrapePage(page, 'https://ratingbet.com/football/goals-over-under/');

        const sello = selloCaptura(Date.now());
        const tabHoy = !!(res15.infoTab.clickeado && res15.infoTab.verificado);

        const cabecera = `=== CAPTURA: ${sello.capturadoEn} | ${sello.capturadoEnMadrid} (${sello.zonaHoraria}) | FECHA: ${sello.fechaMadrid} | TAB_HOY: ${tabHoy} ===\n\n`;
        const combinedText = cabecera + `=== BLOQUE 1: OVER/UNDER 1.5 GOLES ===\n\n${res15.texto}\n\n=== BLOQUE 2: OVER/UNDER 2.5 GOLES ===\n\n${res25.texto}`;

        const outputPath = path.join(process.cwd(), 'ratingbet_raw_data.txt');
        fs.writeFileSync(outputPath, combinedText, 'utf-8');

        // Metadatos de captura: permiten descartar datos de ayer en el analizador
        const meta = {
            ...sello,
            tabHoy: tabHoy,
            infoTabBloque1: res15.infoTab,
            infoTabBloque2: res25.infoTab,
            primerHoraBloque1: primerHoraEnTexto(res15.texto),
            primerHoraBloque2: primerHoraEnTexto(res25.texto)
        };
        fs.writeFileSync(path.join(process.cwd(), 'scrape_meta.json'), JSON.stringify(meta, null, 2), 'utf-8');

        console.log(`\n¡Éxito! Datos guardados en: ${outputPath}`);
        console.log(`Sello de captura: ${sello.capturadoEnMadrid} (${sello.zonaHoraria}) | Pestana HOY verificada: ${tabHoy}`);
        if (!tabHoy) {
            console.log('ATENCION: no se pudo confirmar la pestana HOY en el DOM. El analizador descartara por fecha/hora cualquier partido ya iniciado.');
        }

    } catch (err) {
        console.error('Error durante la extracción:', err);
    } finally {
        await browser.close();
    }
}

run();
