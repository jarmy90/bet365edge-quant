// =============================================================================
// TEST: MODELO POISSON DETERMINISTA (ciego a la cuota) + su seleccion
// -----------------------------------------------------------------------------
// Spec:
//   modeloPoisson(stats): L = Lh + La
//     P(Over 1.5) = 1 - e^-L * (1 + L)
//     P(Over 2.5) = 1 - e^-L * (1 + L + L^2/2)
//   salida en %, clamp 1..99.5, null si stats insuficientes (<3 partidos)
//   seleccionDeFixture con stats validos -> probBase 'modelo-poisson' y
//   edgePuntos = (cuotaCasa - 100/prob) * 100
//
// Uso: node test_modelo_poisson.js   (exit 0 = todo OK)
import { modeloPoisson, seleccionDeFixture } from './ratingbet_pipeline.js';

let pasan = 0, fallan = 0;
const fallos = [];
const TOL = 0.05;

function ok(cond, nombre, detalle) {
    if (cond) { pasan++; console.log('  PASS  ' + nombre + (detalle !== undefined ? '   [' + detalle + ']' : '')); }
    else { fallan++; fallos.push(nombre); console.log('  FAIL  ' + nombre + (detalle !== undefined ? '   [' + detalle + ']' : '')); }
}
function cerca(v, esperado) {
    return Number.isFinite(v) && Math.abs(v - esperado) <= TOL;
}

// ---------------------------------------------------------------------------
// 1) CASO L = 2.5 -> Over 1.5 = 71.3%, Over 2.5 = 45.6%
// ---------------------------------------------------------------------------
console.log('\n--- 1) L = 2.5 (caso numerico exacto) ---');
const s25 = { avgH: 1.25, avgA: 1.25, attH: 1, attA: 1, defH: 1, defA: 1, nH: 10, nA: 10 };
const m25 = modeloPoisson(s25);
ok(!!m25, 'el modelo devuelve resultado con stats completos');
if (m25) {
    ok(cerca(m25.p15, 71.3), 'P(Over 1.5) con L=2.5 = 71.3%', m25.p15);
    ok(cerca(m25.p25, 45.6), 'P(Over 2.5) con L=2.5 = 45.6%', m25.p25);
    ok(cerca(m25.lambdaTotal, 2.5) && cerca(m25.lambdaH, 1.25) && cerca(m25.lambdaA, 1.25),
        'lambdas: Lh=1.25, La=1.25, L=2.5',
        'Lh=' + m25.lambdaH + ' La=' + m25.lambdaA + ' L=' + m25.lambdaTotal);
    ok(m25.p15 >= 1 && m25.p15 <= 99.5 && m25.p25 >= 1 && m25.p25 <= 99.5,
        'salida en % dentro del clamp 1..99.5', m25.p15 + '% / ' + m25.p25 + '%');
    ok(m25.p15 > m25.p25, 'P(Over 1.5) siempre > P(Over 2.5)', m25.p15 + ' > ' + m25.p25);
}

// ---------------------------------------------------------------------------
// 2) CASO L = 1.0 -> Over 1.5 = 26.4%, Over 2.5 = 8.0%
// ---------------------------------------------------------------------------
console.log('\n--- 2) L = 1.0 (caso numerico exacto) ---');
const s10 = { avgH: 0.5, avgA: 0.5, attH: 1, attA: 1, defH: 1, defA: 1, nH: 10, nA: 10 };
const m10 = modeloPoisson(s10);
ok(!!m10, 'el modelo devuelve resultado con L=1.0');
if (m10) {
    ok(cerca(m10.p15, 26.4), 'P(Over 1.5) con L=1.0 = 26.4%', m10.p15);
    ok(cerca(m10.p25, 8.0), 'P(Over 2.5) con L=1.0 = 8.0%', m10.p25);
    ok(cerca(m10.lambdaTotal, 1.0), 'lambdaTotal = 1.0', m10.lambdaTotal);
    ok(m10.p25 >= 1, 'el clamp inferior 1% respeta tambien a la baja', m10.p25);
}

// ---------------------------------------------------------------------------
// 3) STATS INSUFICIENTES / LAMBDA CERO -> null (nunca inventa)
// ---------------------------------------------------------------------------
console.log('\n--- 3) Stats insuficientes -> null ---');
ok(modeloPoisson(null) === null, 'null -> null');
ok(modeloPoisson(undefined) === null, 'undefined -> null');
ok(modeloPoisson({}) === null, 'objeto vacio -> null');
ok(modeloPoisson('1.5') === null, 'no-objeto -> null');
ok(modeloPoisson(Object.assign({}, s25, { nH: 2 })) === null, 'nH = 2 (< 3 partidos) -> null');
ok(modeloPoisson(Object.assign({}, s25, { nA: 2 })) === null, 'nA = 2 (< 3 partidos) -> null');
ok(modeloPoisson(Object.assign({}, s25, { nH: 3, nA: 2 })) === null, 'con solo 3 partidos de un lado -> null');
ok(modeloPoisson(Object.assign({}, s25, { nH: 0, nA: 10 })) === null, 'nH = 0 -> null');
ok(modeloPoisson(Object.assign({}, s25, { avgH: 0 })) === null, 'lambda 0 (avgH = 0) -> null');
ok(modeloPoisson(Object.assign({}, s25, { avgA: 0 })) === null, 'lambda 0 (avgA = 0) -> null');
ok(modeloPoisson(Object.assign({}, s25, { attH: 0 })) === null, 'lambda 0 (attH = 0) -> null');
ok(modeloPoisson(Object.assign({}, s25, { defA: 0 })) === null, 'lambda 0 (defA = 0) -> null');
ok(modeloPoisson(Object.assign({}, s25, { avgH: -1 })) === null, 'media negativa -> null');
ok(modeloPoisson(Object.assign({}, s25, { attA: 'x' })) === null, 'campo no numerico -> null');
ok(modeloPoisson({ avgH: 1.25, avgA: 1.25, attH: 1, attA: 1, defH: 1, defA: 1 }) !== null,
    'sin nH/nA declarados no se bloquea (si los declara, exige >= 3)');
ok(modeloPoisson(Object.assign({}, s25, { nH: 3, nA: 3 })) !== null, 'exactamente 3 partidos por lado -> valido');

// ---------------------------------------------------------------------------
// 4) seleccionDeFixture con stats validos -> modelo-poisson + edge de cliente
// ---------------------------------------------------------------------------
console.log('\n--- 4) seleccionDeFixture con stats -> probBase modelo-poisson ---');
// L = 2.06 => P(Over 1.5) = 61.0% y P(Over 2.5) = 34.0%
const statsOk = { avgH: 1.03, avgA: 1.03, attH: 1, attA: 1, defH: 1, defA: 1, nH: 10, nA: 10 };
const ln = (o, u) => ({ cuotaOver: o, cuotaUnder: u, pOverJusta: 60, pUnderJusta: 40, margenCasa: 5.5, tipRatingbet: null, tipProbPct: null });
const fixturePoisson = {
    clave: 'poisson-caso', partido: 'A vs B', local: 'A', visitante: 'B',
    liga: 'England: Premier League', ligaCorta: 'Premier League',
    hora: '18:00', horaLabel: 'Hoy 18:00', dia: 'Hoy', fechaCorta: '15/09',
    kickoffMs: Date.parse('2026-09-15T16:00:00Z'), kickoffIsoUtc: '2026-09-15T16:00:00.000Z',
    mercado: 'Over 1.5 Goles', cuota: 1.60,
    modelProb: null, edgePuntos: null, modoAnalisis: 'solo-cuotas',
    stats: statsOk,
    // Cuotas elegidas para que el mejor edge sea Over 1.5 a 1.60 (el caso de la spec)
    lineas: { '1.5': ln(1.60, 2.35), '2.5': ln(1.50, 1.45) }
};
const sel = seleccionDeFixture(fixturePoisson);
ok(!!sel && sel.probBase === 'modelo-poisson', 'probBase = modelo-poisson',
    sel ? sel.probBase : 'null');
if (sel) {
    ok(sel.probPct === 61.0, 'probPct = 61.0% (L = 2.06)', sel.probPct);
    ok(sel.cuota === 1.60, 'la cuota elegida es la real 1.60', sel.cuota);
    const edgeTeo = (1.60 - 100 / sel.probPct) * 100;          // -3.93
    ok(Number.isFinite(sel.edgePuntos) && Math.abs(sel.edgePuntos - edgeTeo) <= 0.11,
        'edgePuntos = (cuotaCasa - 100/prob)*100', sel.edgePuntos + ' vs ' + edgeTeo.toFixed(2));
    ok(Math.abs(sel.edgePuntos - (-4.0)) <= 0.15,
        'el caso de la spec (cuota 1.60, prob 61.0 -> -4.0) se cumple', sel.edgePuntos);
    ok(sel.edgePuntos < 0, 'edge negativo NO es pick publicable (se calcula, no se recorta)', sel.edgePuntos);
    ok(/Poisson/.test(sel.justificacion) && /L=/.test(sel.justificacion),
        'la justificacion deja trazabilidad del modelo', sel.justificacion);
    ok(!!sel.lambdas && cerca(sel.lambdas.lambdaTotal, 2.06), 'lambdas adjuntas', JSON.stringify(sel.lambdas));
    ok(!!sel.stats && sel.stats.nH === 10, 'stats conservados para auditoria');
    // Regla de la spec: solo las rutas IA/Poisson llevan edge
    ok(sel.probBase === 'modelo-ia' || sel.probBase === 'modelo-poisson' || sel.edgePuntos === null,
        'ninguna otra ruta devuelve edge calculado', sel.probBase);
}

// Prioridad: el veredicto de la IA manda sobre Poisson
const fixtureConIA = Object.assign({}, fixturePoisson, {
    modelProb: 70.5, edgePuntos: 4.2, modoAnalisis: 'modelo-ia'
});
const selIA = seleccionDeFixture(fixtureConIA);
ok(!!selIA && selIA.probBase === 'modelo-ia' && selIA.probPct === 70.5,
    'con IA disponible gana modelo-ia (Poisson es respaldo)', selIA ? selIA.probBase : 'null');

// Guardia anti-contradiccion: IA y Poisson discrepan >15pts -> sin pick
const fixtureDesacuerdo = Object.assign({}, fixturePoisson, {
    modelProb: 88.0, edgePuntos: 5.0, modoAnalisis: 'modelo-ia',
    mercado: 'Over 1.5 Goles', cuota: 1.19, lado: 'OVER', linea: '1.5'
});
ok(seleccionDeFixture(fixtureDesacuerdo) === null,
    'desacuerdo IA(88) vs Poisson(61) -> se excluye (no Over en una pestana y Under en otra)',
    String(seleccionDeFixture(fixtureDesacuerdo)));
const fixtureAcuerdo = Object.assign({}, fixtureDesacuerdo, { modelProb: 65.0 });
const selAcuerdo = seleccionDeFixture(fixtureAcuerdo);
ok(!!selAcuerdo && selAcuerdo.probBase === 'modelo-ia',
    'acuerdo IA(65) vs Poisson(61) -> el pick IA se publica', selAcuerdo ? selAcuerdo.probBase : 'null');

// Stats insuficientes en el fixture: cae a mercado-justo con edgePuntos null
const fixtureMalo = Object.assign({}, fixturePoisson, {
    stats: { avgH: 1.03, avgA: 1.03, attH: 1, attA: 1, defH: 1, defA: 1, nH: 1, nA: 1 }
});
const selMalo = seleccionDeFixture(fixtureMalo);
ok(!!selMalo && selMalo.probBase !== 'modelo-poisson',
    'con <3 partidos NO se disfraza de modelo-poisson', selMalo ? selMalo.probBase : 'null');
ok(!!selMalo && selMalo.edgePuntos === null, 'y su edgePuntos queda null (sin IA no hay edge)', selMalo ? String(selMalo.edgePuntos) : '-');

// Sin stats en absoluto: tampoco hay modelo
const fixtureSinStats = Object.assign({}, fixturePoisson, { stats: undefined });
const selSinStats = seleccionDeFixture(fixtureSinStats);
ok(!!selSinStats && selSinStats.probBase === 'mercado-justo' && selSinStats.edgePuntos === null,
    'sin stats -> mercado-justo con edgePuntos null',
    selSinStats ? selSinStats.probBase + '/' + selSinStats.edgePuntos : 'null');

console.log('\n=============================================================');
console.log(' RESULTADO: ' + pasan + '/' + (pasan + fallan) + ' COMPROBACIONES PASAN');
if (fallan) console.log(' FALLOS: ' + fallos.join(' ; '));
console.log('=============================================================');
process.exit(fallan === 0 ? 0 : 1);
