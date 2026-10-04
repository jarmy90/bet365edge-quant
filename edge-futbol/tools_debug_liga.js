// DEBUG: por que no se extrae la liga
import puppeteer from 'puppeteer-core';
import fs from 'fs';

const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setContent(fs.readFileSync('tools_dom2_2_5.html', 'utf-8'), { waitUntil: 'domcontentloaded' });

const info = await page.evaluate(() => {
    const filas = document.querySelectorAll('.match-item');
    const secciones = document.querySelectorAll('.game-section');
    const primera = filas[0];
    const ancestros = [];
    let el = primera ? primera.parentElement : null;
    while (el && ancestros.length < 8) {
        ancestros.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 100) });
        el = el.parentElement;
    }
    return {
        nFilas: filas.length,
        nSecciones: secciones.length,
        closestGameSection: primera && primera.closest ? (primera.closest('.game-section') || {}).className : 'sin-closest',
        ancestros: ancestros,
        linksTorneo: document.querySelectorAll('.game-section__tournament-link').length,
        primeros3Links: Array.from(document.querySelectorAll('.game-section__tournament-link')).slice(0, 3).map(a => a.textContent.trim()),
        titulos: document.querySelectorAll('.game-section__title').length,
        primerTitulo: (document.querySelector('.game-section__title') || {}).textContent
    };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();