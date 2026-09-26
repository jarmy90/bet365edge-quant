// DIAGNOSTICO 3: HTML completo de fila, agrupacion por liga, URLs por fecha y zona horaria
// Uso: node tools_probe_dom3.js
import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE_15 = 'https://ratingbet.com/football/goals-over-under-1-5/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// La CDN de Cloudflare corta conexiones de forma intermitente: reintentar es obligatorio
async function gotoConRetry(page, url, intentos = 4) {
    let ultimo;
    for (let i = 1; i <= intentos; i++) {
        try {
            const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            // Esperar a que el challenge de Cloudflare se resuelva
            for (let k = 0; k < 25; k++) {
                const t = await page.title().catch(() => '');
                if (!/Just a moment|Verificaci/i.test(t)) break;
                await new Promise(r => setTimeout(r, 800));
            }
            await new Promise(r => setTimeout(r, 2200));
            return res;
        } catch (e) {
            ultimo = e;
            console.log(`   (intento ${i}/${intentos} fallido: ${e.message.slice(0, 60)})`);
            await new Promise(r => setTimeout(r, 2500 * i));
        }
    }
    throw ultimo;
}

async function main() {
    const browser = await puppeteer.launch({
        executablePath: CHROME, headless: 'new',
        defaultViewport: { width: 1440, height: 900 },
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--disable-quic', '--no-first-run']
    });

    const ahora = new Date();
    console.log('AHORA local :', ahora.toString());
    console.log('AHORA UTC   :', ahora.toISOString());
    console.log('AHORA Madrid:', ahora.toLocaleString('es-ES', { timeZone: 'Europe/Madrid' }));

    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
    await page.setUserAgent(UA);

    console.log('\n===== A) FILA COMPLETA =====');
    await gotoConRetry(page, BASE_15);

    const filaCompleta = await page.evaluate(() => {
        const fila = document.querySelector('.match-item__link');
        if (!fila) return null;
        let cont = fila;
        for (let i = 0; i < 4; i++) {
            if (cont.parentElement && /match-item/.test((cont.parentElement.className || '').toString())) cont = cont.parentElement;
        }
        return { html: cont.outerHTML };
    });
    console.log(filaCompleta ? filaCompleta.html.replace(/\s+/g, ' ') : '(no encontrada)');
    fs.writeFileSync('tools_fila_completa.html', filaCompleta ? filaCompleta.html : '', 'utf-8');

    console.log('\n===== B) ANCESTROS DE LA FILA =====');
    const ancestros = await page.evaluate(() => {
        const fila = document.querySelector('.match-item__link');
        if (!fila) return [];
        const out = [];
        let el = fila;
        while (el && el.tagName !== 'BODY') {
            out.push({
                tag: el.tagName,
                cls: (el.className || '').toString().slice(0, 110),
                dataHref: el.getAttribute('data-href'),
                nHijos: el.children.length,
                primerTexto: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80)
            });
            el = el.parentElement;
        }
        return out;
    });
    console.log(JSON.stringify(ancestros, null, 2));

    const cabeceras = await page.evaluate(() => {
        const re = /^[A-Z]{2,}[A-Z\s]*:\s*.+$/;
        const nodos = Array.from(document.querySelectorAll('div,span,a,h2,h3,h4'));
        return nodos.map(n => (n.textContent || '').replace(/\s+/g, ' ').trim())
            .filter(t => t.length > 5 && t.length < 70 && re.test(t))
            .filter((t, i, a) => a.indexOf(t) === i)
            .slice(0, 15);
    });
    console.log('CABECERAS DE LIGA (muestra):', JSON.stringify(cabeceras, null, 2));

    // ---------- C) ELEMENTOS CON TEXTO DENTRO DE LA FILA (cuotas) ----------
    console.log('\n===== C) HOJAS DE TEXTO DENTRO DE LA FILA =====');
    const cuotas = await page.evaluate(() => {
        const fila = document.querySelector('.match-item__link');
        if (!fila) return [];
        const out = [];
        fila.querySelectorAll('*').forEach(el => {
            if (el.children.length === 0) {
                const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
                if (t) out.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 70), texto: t.slice(0, 30) });
            }
        });
        return out;
    });
    console.log(JSON.stringify(cuotas, null, 2));

    // ---------- D) URLs POR FECHA ----------
    console.log('\n===== D) PRUEBA DE URLs POR FECHA =====');
    const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
    const manana = new Date(Date.now() + 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
    const candidatas = [
        ['hoy ISO', BASE_15 + hoy + '/'],
        ['manana ISO', BASE_15 + manana + '/'],
        ['tomorrow', BASE_15 + 'tomorrow/'],
        ['base', BASE_15]
    ];
    for (const [nombre, u] of candidatas) {
        try {
            const res = await gotoConRetry(page, u, 2);
            const info = await page.evaluate(() => {
                const norm = (t) => (t || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
                const n = document.querySelectorAll('.match-item__link').length;
                const horas = [...new Set(Array.from(document.querySelectorAll('.match-item__time')).map(e => norm(e.textContent)))];
                const activo = Array.from(document.querySelectorAll('.category-links__item')).find(a => /active|selected|current/i.test((a.className || '').toString()));
                return { n, horas: horas.slice(0, 6), activo: activo ? norm(activo.textContent) : null, h1: norm((document.querySelector('h1') || {}).textContent) };
            });
            console.log(`  [${nombre}] HTTP ${res ? res.status() : '?'} | filas=${info.n} | tabActivo=${info.activo} | h1="${info.h1}"`);
            console.log(`     primerHora=${info.horas[0] || '-'} | horas: ${info.horas.join(', ')}`);
        } catch (e) {
            console.log(`  [${nombre}] ERROR ${e.message.slice(0, 70)}`);
        }
    }

    // ---------- E) INDICIOS DE ZONA HORARIA ----------
    console.log('\n===== E) INDICIOS DE ZONA HORARIA =====');
    const tz = await page.evaluate(() => {
        const txt = document.body.innerText || '';
        return {
            mencionaUTCenTexto: (txt.match(/(?:UTC|GMT|CET|CEST)[^\n]{0,20}/gi) || []).slice(0, 5),
            cookies: document.cookie.slice(0, 200),
            locale: navigator.language,
            tzNavegador: Intl.DateTimeFormat().resolvedOptions().timeZone
        };
    });
    console.log(JSON.stringify(tz, null, 2));

    await browser.close();
    console.log('FIN');
}

main().catch(e => { console.error('ERROR GLOBAL:', e.message); process.exit(1); });