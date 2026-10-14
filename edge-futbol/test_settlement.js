// =============================================================================
// TEST: LIQUIDACION DE PICKS -> TRACK-RECORD (settle_results.js)
// -----------------------------------------------------------------------------
// Cero red: fetch siempre mockeado e inyectado; FS fake en memoria.
// Casos:
//   1) outcome 2-1 vs O1.5 -> ganado | 0-0 vs O1.5 -> perdido | 1-1 vs U2.5 -> ganado
//   2) emparejarEquipos (stopwords + inclusion) y pickId
//   3) dedupe: dos pasadas con el mismo payload no duplican
//   4) sin-datos excluido del yield (no cuenta como settled)
//   5) calibracion y yield exactos en dataset sintetico
//   6) settlePick: profit exacto (cuota-1 | -1 | null)
//
// Uso: node test_settlement.js   (exit 0 = todo OK)
// =============================================================================
import {
    pickId, emparejarEquipos, matchOutcome, settlePick, calcResumen,
    pickDesdeSeleccion, run
} from './settle_results.js';

let pasan = 0, fallan = 0;
const fallos = [];
function ok(cond, nombre, detalle) {
    if (cond) { pasan++; console.log('  PASS  ' + nombre + (detalle !== undefined ? '   [' + detalle + ']' : '')); }
    else { fallan++; fallos.push(nombre); console.log('  FAIL  ' + nombre + (detalle !== undefined ? '   [' + detalle + ']' : '')); }
}
function cerca(v, esperado, tol) {
    return Number.isFinite(v) && Math.abs(v - esperado) <= (tol === undefined ? 0.051 : tol);
}

// ---------------------------------------------------------------------------
// 1) OUTCOMES
// ---------------------------------------------------------------------------
console.log('\n--- 1) matchOutcome ---');
ok(matchOutcome('1.5', 'OVER', 2, 1) === 'ganado', '2-1 vs Over 1.5 -> ganado');
ok(matchOutcome('1.5', 'OVER', 0, 0) === 'perdido', '0-0 vs Over 1.5 -> perdido');
ok(matchOutcome('2.5', 'UNDER', 1, 1) === 'ganado', '1-1 vs Under 2.5 -> ganado');
ok(matchOutcome('2.5', 'OVER', 1, 1) === 'perdido', '1-1 vs Over 2.5 -> perdido');
ok(matchOutcome('2.5', 'UNDER', 3, 0) === 'perdido', '3-0 vs Under 2.5 -> perdido');
ok(matchOutcome('1.5', 'OVER', null, 1) === null, 'score incompleto -> null');
ok(matchOutcome('1.5', 'LADO', 2, 1) === null, 'lado invalido -> null');

// ---------------------------------------------------------------------------
// 2) EMPAREJAR EQUIPOS + PICKID
// ---------------------------------------------------------------------------
console.log('\n--- 2) emparejarEquipos + pickId ---');
ok(emparejarEquipos('Real Madrid CF', 'Real Madrid') === true, 'Real Madrid CF ~= Real Madrid');
ok(emparejarEquipos('Arsenal FC', 'Arsenal') === true, 'Arsenal FC ~= Arsenal');
ok(emparejarEquipos('Atlético de Madrid', 'Atletico Madrid') === true, 'tildes y stopwords ~=');
ok(emparejarEquipos('FC Barcelona', 'Barcelona') === true, 'FC Barcelona ~= Barcelona');
ok(emparejarEquipos('FC Barcelona', 'Real Madrid') === false, 'Barcelona != Real Madrid');
ok(emparejarEquipos('Manchester City', 'Manchester United') === false, 'City != United');
ok(emparejarEquipos('', 'Arsenal') === false, 'vacio no empareja');
ok(pickId({ clave: 'a-b', mercado: 'Over 1.5 Goles', fechaCorta: '04/10' }) === 'a-b|Over 1.5 Goles|04/10',
    'pickId = clave|mercado|fechaCorta');

// ---------------------------------------------------------------------------
// 3) SETTLEPICK: profit exacto
// ---------------------------------------------------------------------------
console.log('\n--- 3) settlePick ---');
const pkBase = { linea: '1.5', lado: 'OVER', cuota: 1.9 };
const rWin = settlePick(pkBase, { golesLocal: 2, golesVisitante: 1 }, '2026-01-01T00:00:00.000Z');
ok(rWin.estado === 'ganado' && rWin.profit === 0.9, 'win @1.9 -> profit 0.9', rWin.profit);
ok(rWin.golesLocal === 2 && rWin.golesVisitante === 1, 'goles registrados');
const rLoss = settlePick(pkBase, { golesLocal: 0, golesVisitante: 0 }, '2026-01-01T00:00:00.000Z');
ok(rLoss.estado === 'perdido' && rLoss.profit === -1, 'loss -> profit -1', rLoss.profit);
const rNo = settlePick(pkBase, null, '2026-01-01T00:00:00.000Z');
ok(rNo.estado === 'sin-datos' && rNo.profit === null, 'sin score -> sin-datos, profit null');

// ---------------------------------------------------------------------------
// 4) CALCRESUMEN sintetico: yield y calibracion exactos
// ---------------------------------------------------------------------------
console.log('\n--- 4) calcResumen sintetico ---');
function mkPick(id, model, banda, prob, estado, profit) {
    return {
        id: id, model: model, banda: banda, probModelo: prob,
        result: { estado: estado, golesLocal: 1, golesVisitante: 1, profit: profit, settledEnUtc: 'x' }
    };
}
const sint = [
    mkPick('a', 'modelo-ia', 'bajo', 75, 'ganado', 0.9),
    mkPick('b', 'modelo-poisson', 'medio', 65, 'ganado', 0.9),
    mkPick('c', 'modelo-ia', 'alto', 85, 'perdido', -1),
    mkPick('d', 'modelo-poisson', 'bajo', 55, 'perdido', -1),
    mkPick('e', 'modelo-ia', 'bajo', 70, 'sin-datos', null),   // excluido
    mkPick('f', 'modelo-ia', 'bajo', 70, 'pendiente', null)    // excluido
];
const rs = calcResumen(sint);
ok(rs.n === 6, 'n total = 6', rs.n);
ok(rs.settled === 4, 'settled = 4 (sin-datos y pendiente excluidos)', rs.settled);
ok(rs.ganados === 2, 'ganados = 2', rs.ganados);
ok(rs.hitPct === 50, 'hitPct = 50%', rs.hitPct);
ok(cerca(rs.yieldPct, -5), 'yieldPct = (0.9+0.9-1-1)/4*100 = -5%', rs.yieldPct);
ok(rs.porModelo.ia.settled === 2 && rs.porModelo.ia.ganados === 1, 'porModelo ia 1/2', rs.porModelo.ia.ganados + '/' + rs.porModelo.ia.settled);
ok(rs.porModelo.poisson.settled === 2 && rs.porModelo.poisson.ganados === 1, 'porModelo poisson 1/2');
ok(cerca(rs.porModelo.ia.yieldPct, -5), 'yield ia = (0.9-1)/2*100 = -5%', rs.porModelo.ia.yieldPct);
ok(rs.porBanda.bajo.settled === 2, 'porBanda bajo settled = 2', rs.porBanda.bajo.settled);
const cal = {};
rs.calibracion.forEach(function (c) { cal[c.rango] = c; });
ok(cal['50-60'].n === 1 && cal['50-60'].hits === 0, 'cal 50-60: 0/1', cal['50-60'].hits + '/' + cal['50-60'].n);
ok(cal['60-70'].n === 1 && cal['60-70'].hits === 1 && cal['60-70'].hitPct === 100, 'cal 60-70: 1/1 = 100%');
ok(cal['70-80'].n === 1 && cal['70-80'].hits === 1, 'cal 70-80: 1/1');
ok(cal['80-90'].n === 1 && cal['80-90'].hits === 0 && cal['80-90'].hitPct === 0, 'cal 80-90: 0/1 = 0%');
ok(cal['90-100'].n === 0, 'cal 90-100 vacio');
const rsVacio = calcResumen([]);
ok(rsVacio.settled === 0 && rsVacio.hitPct === 0 && rsVacio.yieldPct === 0, 'resumen vacio a ceros (sin NaN)');

// ---------------------------------------------------------------------------
// 5) RUN end-to-end con mocks: descarga + dedupe + liquidacion
// ---------------------------------------------------------------------------
console.log('\n--- 5) run() con fetch mockeado ---');
const AHORA = Date.parse('2026-10-14T12:00:00.000Z');
const KICK = Date.parse('2026-10-13T20:00:00.000Z'); // hace >3h -> liquidable
function selPick(clave, mercado, cuota, prob, base, edge) {
    return {
        clave: clave, partido: 'Arsenal vs Chelsea', local: 'Arsenal', visitante: 'Chelsea',
        liga: 'England: Premier League', mercado: mercado, cuota: cuota,
        probPct: prob, probBase: base, edgePuntos: edge,
        kickoffMs: KICK, kickoffIsoUtc: new Date(KICK).toISOString(), fechaCorta: '13/10'
    };
}
const parlayOk = {
    estado: 'ok', cuotaTotal: 2.1,
    picks: [selPick('arsenal-vs-chelsea', 'Over 1.5 Goles', 1.9, 75, 'modelo-poisson', 4.2)],
    destacados: [Object.assign(selPick('real-madrid-vs-betis', 'Over 2.5 Goles', 2.0, 60, 'modelo-ia', 3.1),
        { clave: 'real-madrid-vs-betis', partido: 'Real Madrid vs Betis', local: 'Real Madrid CF', visitante: 'Real Betis' })],
    partidos: []
};
function mockFetch(url) {
    const u = String((url && url.url) || url);
    if (u.indexOf('/api/parlays-by-risk') !== -1) {
        return Promise.resolve({ ok: true, json: function () { return Promise.resolve(parlayOk); } });
    }
    if (u.indexOf('api.football-data.org') !== -1) {
        return Promise.resolve({
            ok: true,
            json: function () {
                return Promise.resolve({
                    matches: [
                        { utcDate: '2026-10-13T20:00:00Z', status: 'FINISHED',
                          homeTeam: { name: 'Arsenal FC' }, awayTeam: { name: 'Chelsea FC' },
                          score: { fullTime: { home: 2, away: 1 } } },
                        { utcDate: '2026-10-13T20:05:00Z', status: 'FINISHED',
                          homeTeam: { name: 'Real Madrid CF' }, awayTeam: { name: 'Real Betis Balompié' },
                          score: { fullTime: { home: 0, away: 0 } } }
                    ]
                });
            }
        });
    }
    return Promise.resolve({ ok: false, status: 404, json: function () { return Promise.resolve({}); } });
}
let disco = {};
function fakeRead(p) {
    if (disco[p] === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return disco[p];
}
function fakeWrite(p, contenido) { disco[p] = String(contenido); }

const llamadasFetch = [];
function mockContado(url, init) { llamadasFetch.push(String((url && url.url) || url)); return mockFetch(url, init); }

const out1 = await run({ fetchFn: mockContado, readFile: fakeRead, writeFile: fakeWrite, nowMs: AHORA, trackPath: '/mem/track.json', apiBase: 'https://mock.local', fdKey: 'K' });
ok(out1.nuevos === 2, 'primera pasada registra 2 picks (1 parlay + 1 destacado)', out1.nuevos);
const t1 = JSON.parse(disco['/mem/track.json']);
ok(t1.picks.length === 2, 'track con 2 picks', t1.picks.length);
ok(t1.picks.every(function (p) { return p.id && p.id.indexOf('|') !== -1; }), 'picks con id clave|mercado|fecha');
const pkO = t1.picks.filter(function (p) { return p.model === 'modelo-poisson'; })[0];
const pkI = t1.picks.filter(function (p) { return p.model === 'modelo-ia'; })[0];
ok(pkO && pkO.banda === 'bajo' && pkO.result.estado === 'ganado' && pkO.result.profit === 0.9,
    'poisson O1.5 con 2-1 -> ganado, profit 0.9', pkO ? (pkO.banda + '/' + pkO.result.estado + '/' + pkO.result.profit) : '-');
ok(pkI && pkI.banda === 'destacado' && pkI.result.estado === 'perdido' && pkI.result.profit === -1,
    'destacado IA O2.5 con 0-0 -> perdido, profit -1', pkI ? (pkI.banda + '/' + pkI.result.estado) : '-');
ok(t1.resumen.settled === 2 && t1.resumen.hitPct === 50, 'resumen: settled 2, hit 50%', t1.resumen.settled + '/' + t1.resumen.hitPct);
ok(cerca(t1.resumen.yieldPct, -5), 'resumen: yield -5%', t1.resumen.yieldPct);

const out2 = await run({ fetchFn: mockContado, readFile: fakeRead, writeFile: fakeWrite, nowMs: AHORA, trackPath: '/mem/track.json', apiBase: 'https://mock.local', fdKey: 'K' });
ok(out2.nuevos === 0, 'segunda pasada no duplica (dedupe por id)', out2.nuevos);
const t2 = JSON.parse(disco['/mem/track.json']);
ok(t2.picks.length === 2, 'track sigue con 2 picks', t2.picks.length);

// pick sin match en FD -> sin-datos, excluido del yield
const parlaySolo = {
    estado: 'ok', picks: [selPick('x-vs-y', 'Over 1.5 Goles', 1.5, 80, 'modelo-ia', 5)], destacados: [], partidos: []
};
function mockSinMatch(url) {
    const u = String((url && url.url) || url);
    if (u.indexOf('/api/parlays-by-risk') !== -1) {
        return Promise.resolve({ ok: true, json: function () { return Promise.resolve(parlaySolo); } });
    }
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ matches: [] }); } });
}
let disco2 = {};
const out3 = await run({
    fetchFn: mockSinMatch,
    readFile: function (p) { if (disco2[p] === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return disco2[p]; },
    writeFile: function (p, c) { disco2[p] = String(c); },
    nowMs: AHORA, trackPath: '/mem/t2.json', apiBase: 'https://mock.local', fdKey: 'K'
});
const t3 = JSON.parse(disco2['/mem/t2.json']);
ok(t3.picks.length === 1 && t3.picks[0].result.estado === 'sin-datos', 'sin match FD -> sin-datos', t3.picks[0].result.estado);
ok(t3.resumen.settled === 0 && t3.resumen.yieldPct === 0, 'sin-datos excluido del yield', t3.resumen.settled + '/' + t3.resumen.yieldPct);

// pick con kickoff reciente (<3h) no se liquida
const KICK_NOW = AHORA - 3600000;
const parlayRec = {
    estado: 'ok',
    picks: [Object.assign(selPick('a-vs-b', 'Over 1.5 Goles', 1.5, 80, 'modelo-ia', 5), { kickoffMs: KICK_NOW })],
    destacados: [], partidos: []
};
function mockRec(url) {
    const u = String((url && url.url) || url);
    if (u.indexOf('/api/parlays-by-risk') !== -1) {
        return Promise.resolve({ ok: true, json: function () { return Promise.resolve(parlayRec); } });
    }
    return Promise.resolve({ ok: false, status: 500, json: function () { return Promise.resolve({}); } });
}
let disco3 = {};
await run({
    fetchFn: mockRec,
    readFile: function (p) { if (disco3[p] === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return disco3[p]; },
    writeFile: function (p, c) { disco3[p] = String(c); },
    nowMs: AHORA, trackPath: '/mem/t3.json', apiBase: 'https://mock.local', fdKey: 'K'
});
const t4 = JSON.parse(disco3['/mem/t3.json']);
ok(t4.picks.length === 1 && t4.picks[0].result.estado === 'pendiente', 'kickoff <3h queda pendiente', t4.picks[0].result.estado);

// pick no-modelo (tip) no se registra
ok(pickDesdeSeleccion({ mercado: 'Over 1.5 Goles', cuota: 1.3, probPct: 70, probBase: 'mercado-justo' }, 'bajo', 'x') === null,
    'seleccion sin modelo (mercado-justo) no entra al track');

console.log('\n=============================================================');
console.log(' RESULTADO: ' + pasan + '/' + (pasan + fallan) + ' COMPROBACIONES PASAN');
if (fallan) console.log(' FALLOS: ' + fallos.join(' ; '));
console.log('=============================================================');
process.exit(fallan === 0 ? 0 : 1);
