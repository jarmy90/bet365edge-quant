// DIAGNOSTICO DOM: descubrir selectores reales y comportamiento del boton "Show more"
// Uso: node tools_probe_dom.js
import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL_15 = 'https://ratingbet.com/football/goals-over-under-1-5/';

async function main() {
    const browser = await puppeteer.launch({
        executablePath: CHROME,
        headless: 'new',
        defaultViewport: { width: 1440, height: 900 },
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

    console.log('Navegando a', URL_15);
    await page.goto(URL_15, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Esperar a que Cloudflare resuelva el challenge
    for (let i = 0; i < 30; i++) {
        const t = await page.title();
        const body = await page.evaluate(() => document.body ? (document.body.innerText || '').slice(0, 200) : '');
        if (!/Just a moment|Verificaci/i.test(t + body)) {
            console.log(`Challenge resuelto tras ${i}s. Titulo: "${t}"`);
            break;
        }
        if (i % 5 === 0) console.log(`  esperando challenge... ${i}s titulo="${t}"`);
        await new Promise(r => setTimeout(r, 1000));
    }

    const estado = await page.evaluate(() => ({
        title: document.title,
        url: location.href,
        listo: document.readyState,
        textoMuestra: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 300)
    }));
    console.log('\nESTADO:', JSON.stringify(estado, null, 2));
    fs.writeFileSync('tools_dom_1_5.html', await page.content(), 'utf-8');

    // Contadores de selectores candidatos
    const conteos = await page.evaluate(() => {
        const sel = ['table', 'table tbody tr', '[class*="total-goals"]', '[class*="total_goals"]',
            '[class*="game"]', '[class*="match"]', '[class*="event"]', 'article', 'li'];
        const out = {};
        sel.forEach(s => { try { out[s] = document.querySelectorAll(s).length; } catch (e) { out[s] = 'err'; } });
        return out;
    });
    console.log('\nCONTEO SELECTORES:', JSON.stringify(conteos, null, 2));

    // Buscar botones tipo "Show more"
    const botones = await page.evaluate(() => {
        const re = /show\s*more|load\s*more|cargar\s*m[aá]s|ver\s*m[aá]s|m[aá]s\s*partidos|show\s*all/i;
        return Array.from(document.querySelectorAll('a,button,div,span,li,input'))
            .filter(el => re.test((el.textContent || el.value || '').trim()) && el.children.length <= 1)
            .map(el => ({
                tag: el.tagName, cls: (el.className || '').toString().slice(0, 120),
                id: el.id, texto: (el.textContent || el.value || '').trim().slice(0, 60),
                href: el.getAttribute && el.getAttribute('href'),
                visible: !!(el.offsetParent || el.getClientRects().length)
            })).slice(0, 15);
    });
    console.log('\nBOTONES "SHOW MORE":', JSON.stringify(botones, null, 2));

    // Texto completo para localizar "Matches found" y ver cuantos partidos hay
    const inner = await page.evaluate(() => (document.body.innerText || ''));
    const mf = inner.match(/Matches found[^\n]*/i);
    console.log('\nMATCHES FOUND:', mf ? mf[0] : '(no encontrado)');
    console.log('HORAS EN TEXTO:', (inner.match(/\b([01]\d|2[0-3]):[0-5]\d\b/g) || []).length);
    console.log('LINEAS totales:', inner.split('\n').length);

    fs.writeFileSync('tools_dom_1_5.txt', inner, 'utf-8');
    console.log('DOM y texto guardados en tools_dom_1_5.html / tools_dom_1_5.txt');

    await browser.close();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });