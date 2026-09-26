// DIAGNOSTICO 4: aislar la causa de ERR_CONNECTION_CLOSED / ERR_QUIC en headless
// Uso: node tools_probe_dom4.js
import puppeteer from 'puppeteer-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'https://ratingbet.com/football/goals-over-under-1-5/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const BASE_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'];

const VARIANTES = [
    { nombre: 'A: headless=new + args base', headless: 'new', args: BASE_ARGS },
    { nombre: 'B: headless=new + disable-quic', headless: 'new', args: [...BASE_ARGS, '--disable-quic'] },
    { nombre: 'C: headless=new + disable-http2', headless: 'new', args: [...BASE_ARGS, '--disable-http2'] },
    { nombre: 'D: headless=shell', headless: 'shell', args: BASE_ARGS },
    { nombre: 'E: headless=false (visible)', headless: false, args: [...BASE_ARGS, '--window-size=1280,900'] }
];

async function probarVariante(v) {
    let browser;
    try {
        browser = await puppeteer.launch({ executablePath: CHROME, headless: v.headless, args: v.args, defaultViewport: { width: 1366, height: 850 } });
        const page = await browser.newPage();
        await page.setUserAgent(UA);
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8' });

        const t0 = Date.now();
        const res = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
        let titulo = await page.title();
        // esperar challenge
        for (let k = 0; k < 20 && /Just a moment|Verificaci/i.test(titulo); k++) {
            await new Promise(r => setTimeout(r, 800));
            titulo = await page.title();
        }
        await new Promise(r => setTimeout(r, 2000));
        const filas = await page.$$eval('.match-item__link', els => els.length).catch(() => 0);
        const horas = await page.$$eval('.match-item__time', els => [...new Set(els.map(e => e.textContent.trim()))].slice(0, 5)).catch(() => []);
        console.log(`  ${v.nombre}: OK en ${Date.now() - t0}ms | HTTP ${res ? res.status() : '?'} | titulo="${titulo.slice(0, 55)}" | filas=${filas} | horas=${horas.join(',')}`);
        await browser.close();
        return true;
    } catch (e) {
        console.log(`  ${v.nombre}: FALLO -> ${e.message.slice(0, 90)}`);
        if (browser) await browser.close().catch(() => {});
        return false;
    }
}

for (const v of VARIANTES) {
    await probarVariante(v);
    await new Promise(r => setTimeout(r, 6000)); // pausa anti rate-limit
}
console.log('FIN variantes');