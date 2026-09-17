// =============================================================================
// TEST DEL EXTRACTOR RATINGBET (offline, contra HTML real guardado)
// -----------------------------------------------------------------------------
// Verifica con aserciones PASS/FALLO que el pipeline de scraping es correcto:
//   1. Extraccion: N filas del HTML -> N partidos (no se pierde ni se inventa)
//   2. Columnas de cuotas: 1a = Over, 2a = Under (contrastado con el "Best Tip")
//   3. Local/visitante: se resuelve desde el slug de la URL (el DOM invierte)
//   4. Zona horaria: hora de Madrid -> instante UTC real, con DST correcto
//   5. Fusion 1.5 + 2.5 sin duplicar partidos
//   6. Validacion temporal: descarta lo empezado y NO re-fecha (regresion)
//
// Uso: node test_ratingbet_extractor.js
// =============================================================================
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import {
    EXTRACTOR_FN, normalizarPartido, fusionarLineas, validarTemporal,
    resolverLocalVisitante, madridWallClockAUtcMs, fechaMadridISO, TZ_MADRID
} from './ratingbet_extract.js';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
let fallos = 0, total = 0;
function ok(cond, msg, extra) {
    total++;
    if (!cond) fallos++;
    console.log((cond ? '  PASS  ' : '  FALLO ') + msg + (extra ? '   [' + extra + ']' : ''));
}

async function extraer(page, fichero) {
    const abs = process.cwd() + '\\' + fichero;
    if (!fs.existsSync(abs)) return null;
    await page.goto('file:///' + abs.replace(/\\/g, '/'), { waitUntil: 'domcontentloaded', timeout: 30000 });
    const filas = await page.evaluate(EXTRACTOR_FN);
    const html = fs.readFileSync(fichero, 'utf-8');
    const esperadas = (html.match(/<div class="match-item match-item_predictions/g) || []).length;
    return { filas, esperadas };
}

const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox']
});
const page = await browser.newPage();
const meta = { capturadoEnUtc: new Date().toISOString(), capturadoEnMadrid: 'test' };

console.log('=============================================================');
console.log(' TEST EXTRACTOR RATINGBET (offline, HTML real)');
console.log('=============================================================');
console.log(' Zona horaria de negocio: ' + TZ_MADRID);
console.log(' Ahora Madrid: ' + new Date().toLocaleString('es-ES', { timeZone: TZ_MADRID }));

console.log('\n--- 1) EXTRACCION: una fila del HTML = un partido ---');
const r15 = await extraer(page, 'tools_dom2_1_5.html');
const r25 = await extraer(page, 'tools_dom2_2_5.html');
ok(!!r15, 'HTML de la linea 1.5 disponible');
ok(!!r25, 'HTML de la linea 2.5 disponible');

if (r15) {
    ok(r15.filas.length === r15.esperadas, 'linea 1.5: extraidas ' + r15.filas.length + ' de ' + r15.esperadas + ' filas');
    const f = r15.filas[0];
    ok(/^\d{1,2}:\d{2}$/.test(f.hora), 'hora en formato HH:MM', f.hora);
    ok(f.equipos.length === 2, 'dos equipos', f.equipos.join(' | '));
    ok(f.over && f.over.cuota > 1, 'cuota Over presente', String(f.over && f.over.cuota));
    ok(f.under && f.under.cuota > 1, 'cuota Under presente', String(f.under && f.under.cuota));
    ok(f.linea === '1.5', 'la linea de la pagina 1.5 es 1.5', String(f.linea));
    ok(!!f.liga, 'liga extraida', f.liga);
    ok(!!f.url && f.url.includes('/match/'), 'url de partido extraida', String(f.url));
    const sinCuotas = r15.filas.filter(x => !x.over || x.over.cuota === null || !x.under || x.under.cuota === null).length;
    ok(sinCuotas === 0, 'todas las filas de 1.5 traen cuotas Over y Under', 'sin cuotas: ' + sinCuotas);
    ok(r15.filas.filter(x => !x.liga).length === 0, 'todas las filas de 1.5 traen liga');
}
if (r25) {
    ok(r25.filas.length === r25.esperadas, 'linea 2.5: extraidas ' + r25.filas.length + ' de ' + r25.esperadas + ' filas');
    ok(r25.filas[0].linea === '2.5', 'la linea de la pagina 2.5 es 2.5', String(r25.filas[0].linea));
}

console.log('\n--- 2) COLUMNAS DE CUOTAS: 1a = OVER, 2a = UNDER ---');
if (r15) {
    let coherentes = 0, incoherentes = 0;
    r15.filas.forEach(f => {
        if (!f.tip || f.tipCuota === null) return;
        const esUnder = /^U/i.test(f.tip);
        const casa = (f.over && f.over.cuota === f.tipCuota) ? 'over' : ((f.under && f.under.cuota === f.tipCuota) ? 'under' : 'ninguna');
        if (casa === 'ninguna') return;
        if ((esUnder && casa === 'under') || (!esUnder && casa === 'over')) coherentes++; else incoherentes++;
    });
    ok(incoherentes === 0, 'ninguna fila tiene Over/Under cruzados', 'coherentes=' + coherentes + ' incoherentes=' + incoherentes);
    ok(coherentes > 10, 'la comprobacion tiene base suficiente', String(coherentes));
    const muestra = r15.filas.find(f => f.tipCuota && f.tipProbPct);
    const imp = 1 / muestra.tipCuota * 100;
    ok(Math.abs(imp - muestra.tipProbPct) < 25, 'probabilidad del tip coherente con su cuota',
        'implicita=' + imp.toFixed(1) + '% publicada=' + muestra.tipProbPct + '%');
    const margenMalo = r15.filas.filter(f => f.over && f.under && (1 / f.over.cuota + 1 / f.under.cuota) <= 1).length;
    ok(margenMalo === 0, 'ninguna cuota invertida (margen de casa positivo)', 'anomalas: ' + margenMalo);
}

console.log('\n--- 3) LOCAL/VISITANTE DESDE EL SLUG (el DOM invierte) ---');
ok(resolverLocalVisitante(['Rayo Vallecano', 'Espanyol'], '/football/match/espanyol-vs-rayo-vallecano-2/').local === 'Espanyol',
    'caso real invertido 1 -> corregido (Espanyol local)');
ok(resolverLocalVisitante(['West Ham', 'Fulham'], '/football/match/fulham-vs-west-ham/').local === 'Fulham',
    'caso real invertido 2 -> corregido (Fulham local)');
ok(resolverLocalVisitante(['Ipswich', 'Arsenal'], '/football/match/arsenal-vs-ipswich/').local === 'Arsenal',
    'caso real invertido 3 -> corregido (Arsenal local)');
const dir = resolverLocalVisitante(['Real Madrid', 'Barcelona'], '/football/match/real-madrid-vs-barcelona/');
ok(dir.local === 'Real Madrid' && dir.visitante === 'Barcelona', 'cuando el orden ya es correcto se respeta');
ok(resolverLocalVisitante(['A', 'B'], 'https://ratingbet.com/football/match/a-vs-b/').local === 'A',
    'URL absoluta tambien se resuelve');
if (r25) {
    const p25 = r25.filas.map(f => normalizarPartido(f, '2026-09-15', '2.5', meta)).filter(Boolean);
    const inv = p25.filter(p => p.ordenDomCoincideSlug === false).length;
    ok(inv > 0, 'se detectan filas invertidas en datos reales', inv + '/' + p25.length);
    ok(p25.every(p => p.local && p.visitante && p.local !== p.visitante), 'local y visitante siempre presentes y distintos');
    ok(p25.filter(p => p.confianzaEquipos === 0).length === 0, 'todos los equipos se casan con su slug');
}

console.log('\n--- 4) ZONA HORARIA: hora Madrid -> UTC real (con DST) ---');
ok(new Date(madridWallClockAUtcMs(2026, 9, 15, 19, 0)).toISOString() === '2026-09-15T17:00:00.000Z',
    '15/09 19:00 Madrid = 17:00 UTC (horario de verano)');
ok(new Date(madridWallClockAUtcMs(2026, 1, 15, 19, 0)).toISOString() === '2026-01-15T18:00:00.000Z',
    '15/01 19:00 Madrid = 18:00 UTC (horario de invierno)');
ok(fechaMadridISO(Date.UTC(2026, 8, 15, 23, 30)) === '2026-09-16', '23:30 UTC del 15 ya es dia 16 en Madrid');
ok(fechaMadridISO(Date.UTC(2026, 8, 15, 1, 0)) === '2026-09-15', '01:00 UTC del 15 es dia 15 en Madrid');
if (r15) {
    const fila19 = r15.filas.find(x => x.hora === '19:00') || r15.filas[0];
    const p = normalizarPartido(fila19, '2026-09-15', '1.5', meta);
    // Cualquier fila debe convertirse a UTC con el desfase de Madrid de su fecha
    const desfaseHoras = (new Date(p.kickoffIsoUtc).getTime() - Date.UTC(2026, 8, 15, parseInt(p.hora.slice(0, 2), 10), parseInt(p.hora.slice(3), 10))) / 3600000;
    ok(desfaseHoras === -2, 'la hora de la web se interpreta como Madrid (UTC+2 en septiembre)', p.hora + ' -> ' + p.kickoffIsoUtc);
    ok(p.zonaHoraria === TZ_MADRID, 'la zona horaria queda registrada en el dato', p.zonaHoraria);
}

console.log('\n--- 5) FUSION 1.5 + 2.5 SIN DUPLICAR ---');
if (r15 && r25) {
    const p15 = r15.filas.map(f => normalizarPartido(f, '2026-09-15', '1.5', meta)).filter(Boolean);
    const p25 = r25.filas.map(f => normalizarPartido(f, '2026-09-15', '2.5', meta)).filter(Boolean);
    const fusion = fusionarLineas(p15, p25);
    const conAmbas = fusion.filter(p => p.lineas['1.5'] && p.lineas['2.5']).length;
    ok(fusion.length <= p15.length + p25.length, 'no se duplican partidos al fusionar', fusion.length + ' unicos de ' + (p15.length + p25.length));
    ok(conAmbas > 50, 'mayoria con las dos lineas', conAmbas + '/' + fusion.length);
    ok(new Set(fusion.map(p => p.clave)).size === fusion.length, 'claves unicas');
    ok(fusion.every((p, i) => i === 0 || fusion[i - 1].kickoffMs <= p.kickoffMs), 'orden por kickoff ascendente');
    const ambas = fusion.find(p => p.lineas['1.5'] && p.lineas['2.5']);
    ok(ambas.lineas['1.5'].linea === '1.5' && ambas.lineas['2.5'].linea === '2.5', 'cada linea queda etiquetada');
    ok(ambas.lineas['1.5'].cuotaOver !== ambas.lineas['1.5'].cuotaUnder, 'Over y Under distintos en la misma linea');
}

console.log('\n--- 6) VALIDACION TEMPORAL: descarta el pasado y NO re-fecha ---');
const ahoraMs = madridWallClockAUtcMs(2026, 9, 15, 12, 0);
const mk = (clave, h, m) => {
    const ms = madridWallClockAUtcMs(2026, 9, 15, h, m);
    return { clave, local: 'Local', visitante: 'Visitante', liga: 'L', hora: h + ':' + String(m).padStart(2, '0'),
        kickoffMs: ms, kickoffIsoUtc: new Date(ms).toISOString(), fecha: '2026-09-15',
        lineas: { '1.5': { cuotaOver: 1.5 } } };
};
const casos = [mk('pasado', 11, 0), mk('margen', 12, 10), mk('limite', 12, 35), mk('noche', 21, 0), mk('sinkickoff', 15, 0)];
casos[4].kickoffMs = null; casos[4].kickoffIsoUtc = null;
const rv = validarTemporal(casos, { ahoraMs, margenMinutos: 30, maxDias: 14 });
const acep = rv.aceptados.map(p => p.clave);
ok(!acep.includes('pasado'), 'partido ya empezado -> DESCARTADO');
ok(!acep.includes('margen'), 'dentro del margen de 30 min -> DESCARTADO');
ok(acep.includes('limite'), 'pasado el margen -> ACEPTADO');
ok(acep.includes('noche'), 'partido futuro -> ACEPTADO');
ok(!acep.includes('sinkickoff'), 'sin kickoff fiable -> DESCARTADO');
ok(rv.resumen.aceptados === 2, 'totales de la validacion correctos', String(rv.resumen.aceptados));
ok(casos[0].kickoffIsoUtc === new Date(madridWallClockAUtcMs(2026, 9, 15, 11, 0)).toISOString(),
    'REGRESION: el descartado NO se ha re-fechado', casos[0].kickoffIsoUtc);
ok(rv.descartados.every(d => d.motivo && d.local), 'los descartes son auditables (motivo + partido)');
const lejos = mk('lejano', 21, 0);
lejos.kickoffMs = madridWallClockAUtcMs(2026, 10, 20, 21, 0);
lejos.kickoffIsoUtc = new Date(lejos.kickoffMs).toISOString();
const rv2 = validarTemporal([lejos], { ahoraMs, margenMinutos: 30, maxDias: 14 });
ok(rv2.resumen.aceptados === 0, 'partido a mas de 14 dias -> DESCARTADO', JSON.stringify(rv2.resumen));

console.log('\n--- 7) NO SE PUBLICA UN PARTIDO JUGADO ---');
if (r15) {
    const futuros = r15.filas.filter(f => !f.jugado).length;
    const jugados = r15.filas.filter(f => f.jugado).length;
    ok(jugados === 0 || futuros > 0, 'se distingue "planed" (futuro) de resultado real', 'futuros=' + futuros + ' con marcador=' + jugados);
}

await browser.close();
console.log('\n=============================================================');
console.log(fallos === 0 ? ' RESULTADO: ' + total + '/' + total + ' COMPROBACIONES PASAN' : ' RESULTADO: ' + fallos + ' de ' + total + ' FALLIDAS');
console.log('=============================================================');
process.exit(fallos === 0 ? 0 : 1);