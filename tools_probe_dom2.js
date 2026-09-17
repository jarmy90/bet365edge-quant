// DIAGNOSTICO 2: estructura de filas, tabs de fecha y efecto del boton "Show more"
// Uso: node tools_probe_dom2.js
import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URLS = {
    '1.5': 'https://ratingbet.com/football/goals-over-under-1-5/',
    '2.5': 'https://ratingbet.com/football/goals-over-under/'
};

const LIMPIAR = (t) => (t || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

async function analizar(page, etiqueta, url) {
    console.log(`\n########## BLOQUE ${etiqueta} -> ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 2500));

    // 1) Tabs de fecha: enlaces con href
    const tabs = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href]')).map(a => ({
            texto: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
            href: a.getAttribute('href'),
            cls: (a.className || '').toString().slice(0, 90)
        })).filter(t => /yesterday|today|tomorrow|hoy|ayer|mañana|\d{1,2}\s*(sep|oct|nov|aug|jan|feb|mar|apr|may|jun|jul)/i.test(t.texto));
    });
    console.log('TABS DE FECHA:', JSON.stringify(tabs.slice(0, 12), null, 2));

    // 2) Localizar la fila de partido: contenedor minimo con "HH:MM" + equipos
    const muestraFilas = await page.evaluate(() => {
        const norm = (t) => (t || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        const candidatos = Array.from(document.querySelectorAll('div,li,tr,section'));
        const filas = candidatos.filter(el => {
            const t = norm(el.textContent);
            return /^\d{2}:\d{2}/.test(t) && t.includes('-') && t.length > 15 && t.length < 260 && el.children.length <= 60;
        });
        // las mas pequenas primero (hoja mas cercana a la fila)
        filas.sort((a, b) => a.textContent.length - b.textContent.length);
        const out = [];
        const vistos = new Set();
        for (const el of filas) {
            const t = norm(el.textContent);
            if (vistos.has(t)) continue;
            vistos.add(t);
            out.push({
                cls: (el.className || '').toString(),
                tag: el.tagName,
                nHijos: el.children.length,
                texto: t.slice(0, 200),
                html: el.outerHTML.slice(0, 1200)
            });
            if (out.length >= 3) break;
        }
        return out;
    });
    console.log(`FILAS DE MUESTRA (${muestraFilas.length}):`);
    muestraFilas.forEach((f, i) => {
        console.log(`--- fila ${i + 1} | tag=${f.tag} | hijos=${f.nHijos} | cls="${f.cls}"`);
        console.log(`    texto: ${f.texto}`);
        console.log(`    html : ${f.html.replace(/\s+/g, ' ')}`);
    });

    // 3) Contar filas y pulsar "Show more"
    const contar = () => page.evaluate(() => {
        const norm = (t) => (t || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        return Array.from(document.querySelectorAll('div,li,tr')).filter(el => /^\d{2}:\d{2}/.test(norm(el.textContent)) && norm(el.textContent).includes('-')).length;
    });

    const antes = await contar();
    let clics = 0;
    for (let i = 0; i < 12; i++) {
        const res = await page.evaluate(() => {
            const b = document.querySelector('.js-show-all-btn') || Array.from(document.querySelectorAll('button,a')).find(el => /show\s*more/i.test(el.textContent || ''));
            if (!b) return { ok: false, estado: 'sin-boton' };
            const deshabilitado = b.disabled || /disabled/.test((b.className || '').toString());
            b.scrollIntoView();
            b.click();
            return { ok: true, texto: (b.textContent || '').trim(), deshabilitado };
        });
        if (!res.ok) { console.log(`  click ${i + 1}: ${res.estado}`); break; }
        clics++;
        await new Promise(r => setTimeout(r, 900));
        const n = await contar();
        console.log(`  click ${clics}: filas=${n}`);
        if (res.deshabilitado) { console.log('  boton deshabilitado -> fin'); break; }
    }
    const despues = await contar();
    console.log(`RESUMEN BLOQUE ${etiqueta}: filas antes=${antes} despues=${despues} clics=${clics}`);

    const inner = await page.evaluate(() => document.body.innerText || '');
    fs.writeFileSync(`tools_dom2_${etiqueta.replace('.', '_')}.txt`, inner, 'utf-8');
    fs.writeFileSync(`tools_dom2_${etiqueta.replace('.', '_')}.html`, await page.content(), 'utf-8');
    console.log(`Textura texto (primeras 120 lineas) guardada. Lineas totales: ${inner.split('\n').length}`);
}

async function main() {
    const browser = await puppeteer.launch({
        executablePath: CHROME, headless: 'new',
        defaultViewport: { width: 1440, height: 900 },
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--disable-quic', '--no-first-run']
    });
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

    for (const [etiqueta, url] of Object.entries(URLS)) {
        try { await analizar(page, etiqueta, url); } catch (e) { console.log(`ERROR bloque ${etiqueta}: ${e.message}`); }
    }
    await browser.close();
}

main().catch(e => { console.error('ERROR GLOBAL:', e.message); process.exit(1); });