// VALIDACION OFFLINE DEL EXTRACTOR contra HTML REAL de ratingbet (guardado)
// No usa red: inyecta el HTML real en un navegador y ejecuta EXTRACTOR_FN.
// Uso: node tools_valida_extractor.js
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import {
    EXTRACTOR_FN, normalizarPartido, fusionarLineas, validarTemporal, fechaMadridISO
} from './ratingbet_extract.js';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const CASOS = [
    { etiqueta: '1.5', fichero: 'tools_dom2_1_5.html', linea: '1.5', fecha: '2026-09-15' },
    { etiqueta: '2.5', fichero: 'tools_dom2_2_5.html', linea: '2.5', fecha: '2026-09-15' }
];

const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
});

const meta = { capturadoEnUtc: new Date().toISOString(), capturadoEnMadrid: '2026-09-15 captura real' };
const porLinea = {};

for (const c of CASOS) {
    if (!fs.existsSync(c.fichero)) { console.log(`SKIP ${c.fichero} (no existe)`); continue; }
    const html = fs.readFileSync(c.fichero, 'utf-8');
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    const filas = await page.evaluate(EXTRACTOR_FN);
    await page.close();

    console.log(`\n=== ${c.etiqueta} (${c.fichero}) ===`);
    console.log(`Filas extraidas por EXTRACTOR_FN: ${filas.length}`);

    const normalizadas = filas.map(f => normalizarPartido(f, c.fecha, c.linea, meta)).filter(Boolean);
    console.log(`Normalizadas: ${normalizadas.length}`);

    const conLiga = normalizadas.filter(p => p.liga && p.liga !== 'LIGA DESCONOCIDA').length;
    const conCuotas = normalizadas.filter(p => p.cuotaOver !== null && p.cuotaUnder !== null).length;
    const invertidas = normalizadas.filter(p => p.ordenDomCoincideSlug === false).length;
    const jugados = normalizadas.filter(p => p.jugado).length;
    console.log(`  con liga: ${conLiga} | con cuotas O/U: ${conCuotas} | slug invertido (corregido): ${invertidas} | marcados jugados: ${jugados}`);
    console.log(`  ejemplo: ${normalizadas[0].local} vs ${normalizadas[0].visitante} | ${normalizadas[0].hora} Madrid = ${normalizadas[0].kickoffIsoUtc} UTC | licencia=${normalizadas[0].liga}`);

    porLinea[c.linea] = normalizadas;
}

await browser.close();

// ---- FUSION ----
const fusion = fusionarLineas(porLinea['1.5'] || [], porLinea['2.5'] || []);
console.log(`\n=== FUSION 1.5 + 2.5 ===`);
console.log(`Partidos unicos: ${fusion.length}`);
const conAmbas = fusion.filter(p => p.lineas['1.5'] && p.lineas['2.5']).length;
console.log(`Con AMBAS lineas (1.5 y 2.5): ${conAmbas}`);
console.log(`Solo 1.5: ${fusion.filter(p => p.lineas['1.5'] && !p.lineas['2.5']).length} | Solo 2.5: ${fusion.filter(p => !p.lineas['1.5'] && p.lineas['2.5']).length}`);

const muestra = fusion.find(p => p.lineas['1.5'] && p.lineas['2.5']);
if (muestra) {
    console.log(`\nEJEMPLO FUSIONADO:`);
    console.log(`  ${muestra.local} vs ${muestra.visitante} (${muestra.liga})`);
    console.log(`  ${muestra.fecha} ${muestra.hora} Madrid -> ${muestra.kickoffIsoUtc} UTC`);
    console.log(`  1.5 -> Over ${muestra.lineas['1.5'].cuotaOver} (${muestra.lineas['1.5'].probCasaOverPct}%) | Under ${muestra.lineas['1.5'].cuotaUnder} (${muestra.lineas['1.5'].probCasaUnderPct}%) | tip ${muestra.lineas['1.5'].tip}`);
    console.log(`  2.5 -> Over ${muestra.lineas['2.5'].cuotaOver} (${muestra.lineas['2.5'].probCasaOverPct}%) | Under ${muestra.lineas['2.5'].cuotaUnder} (${muestra.lineas['2.5'].probCasaUnderPct}%) | tip ${muestra.lineas['2.5'].tip}`);
}

// ---- VALIDACION TEMPORAL ----
// Simulamos "ahora" = 2026-09-15 10:00 Madrid para comprobar el filtrado
const ahoraMs = Date.UTC(2026, 8, 15, 8, 0, 0);
const v = validarTemporal(fusion, { ahoraMs, margenMinutos: 30, maxDias: 14 });
console.log(`\n=== VALIDACION TEMPORAL (ahora simulado 2026-09-15 10:00 Madrid) ===`);
console.log(JSON.stringify(v.resumen, null, 2));
const porMotivo = {};
v.descartados.forEach(d => { porMotivo[d.motivo] = (porMotivo[d.motivo] || 0) + 1; });
console.log('Descartados por motivo:', JSON.stringify(porMotivo, null, 2));
console.log(`\nPrimeros 3 aceptados:`);
v.aceptados.slice(0, 3).forEach(p => console.log(`  ${p.fecha} ${p.hora} | ${p.local} vs ${p.visitante} | ${p.liga} | lineas=${Object.keys(p.lineas).join('+')}`));
if (v.descartados.length) {
    console.log(`Primeros 3 descartados:`);
    v.descartados.slice(0, 3).forEach(d => console.log(`  ${d.hora} | ${d.local} vs ${d.visitante} -> ${d.motivo}`));
}

fs.writeFileSync('ratingbet_fixtures.json', JSON.stringify({
    generadoEn: new Date().toISOString(),
    fuente: 'ratingbet.com (validacion offline de extractor)',
    totalFusionados: fusion.length,
    validacion: v.resumen,
    partidos: v.aceptados
}, null, 2), 'utf-8');
console.log('\nEscrito ratingbet_fixtures.json');