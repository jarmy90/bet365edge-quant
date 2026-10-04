// Prueba de validacion temporal (PASO 2) - MOTOR v3 (LEGADO).
// La fuente de fixtures era el agente Omniroute (LLM) simulada via
// env.__FIXTURES_LLM_STUB. En el motor v4/v5 ese mecanismo se ELIMINO: ahora
// TODO fixture viene del dataset real del scraper (ratingbet.com) y las
// garantias de validacion temporal se cubren en:
//   - test_ratingbet_pipeline.js  (validacion temporal, frescura, dedupe)
//   - test_parlays_riesgo.js      (combinadas por riesgo, solo futuros)
// Invariante central que sigue vigente: NINGUN partido pasado se "re-fecha".
// Ejecutar: node test_temporal_validation.js
import assert from 'node:assert';
import worker from './worker.js';

// Preflight: si el motor ya no acepta __FIXTURES_LLM_STUB (v4+), este test
// carece de objeto y termina OK apuntando a sus sustitutos.
{
    const probe = await worker.fetch(new Request('http://test.local/api/version'), {}, {});
    const probeBody = await probe.json();
    if (String(probeBody.origenDatos || '').indexOf('ratingbet.com') !== -1) {
        console.log('SKIP: test del motor v3 (stub LLM). El motor actual (' + probeBody.build +
            ') usa dataset real de ratingbet; garantias cubiertas por test_ratingbet_pipeline.js y test_parlays_riesgo.js');
        process.exit(0);
    }
}

const RealDate = Date;
const MARGEN_MS = 2.5 * 3600 * 1000;
const FUENTE = 'ratingbet.com (1.5 + 2.5, scraper con navegador real, huso Europe/Madrid)';

function makeFakeDate(isoNow) {
    const fixedMs = new RealDate(isoNow).getTime();
    class FakeDate extends RealDate {
        constructor(...args) {
            if (args.length === 0) super(fixedMs);
            else super(...args);
        }
        static now() { return fixedMs; }
    }
    return FakeDate;
}

function madridHHMM(ms) {
    const out = {};
    new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Madrid',
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new RealDate(ms)).forEach(function (p) { if (p.type !== 'literal') out[p.type] = p.value; });
    return { fecha: out.day + '/' + out.month, horaReal: out.hour.padStart(2, '0') + ':' + out.minute };
}

let contador = 0;

// fixturesCrudos = respuesta simulada del LLM. Si se omite, no hay stub ni clave:
// el worker debe degradar a VACIO (nunca a un catalogo ficticio).
async function pedir(isoNow, path, fixturesCrudos) {
    globalThis.Date = makeFakeDate(isoNow);
    contador++;
    const mod = await import('./worker.js?cache=' + contador + '-' + Math.random());
    const env = {};
    if (fixturesCrudos !== undefined) {
        env.__FIXTURES_LLM_STUB = JSON.stringify({ fixtures: fixturesCrudos });
    }
    const res = await mod.default.fetch(new Request('http://test.local' + path), env, {});
    const body = await res.json();
    globalThis.Date = RealDate;
    return { status: res.status, body, headers: res.headers };
}

function fx(partido, liga, kickoffIso, extra) {
    return Object.assign({
        partido: partido,
        liga: liga,
        kickoffIso: kickoffIso,
        mercado: 'Over 1.5 Goles',
        cuota: 1.12,
        modelProb: 88.0,
        houseProb: 82.0,
        justificacion: 'test'
    }, extra || {});
}

// =========================================================================
// Escenario 1: 08:00 Madrid - solo sobreviven los fixtures futuros validos
// =========================================================================
console.log('=== Escenario 1: 08:00 Madrid (matriz de rechazos) ===');
const S1 = '2026-09-14T06:00:00Z'; // 08:00 Madrid

const r1 = await pedir(S1, '/api/fixtures-hoy', [
    fx('SC Heerenveen vs Telstar', 'Países Bajos: Eredivisie', '2026-09-14T12:30:00Z'), // 14:30 Madrid -> VALIDO
    fx('Coventry vs Brighton', 'Inglaterra: Premier League', '2026-09-14T15:00:00Z'),   // 17:00 Madrid -> VALIDO
    fx('SC Heerenveen vs Telstar', 'Países Bajos: Eredivisie', '2026-09-14T12:30:00Z'), // DUPLICADO
    fx('Partido De Ayer', 'España: LaLiga', '2026-09-13T20:00:00Z'),                    // AYER
    fx('Partido Ya Empezado', 'Italia: Serie A', '2026-09-14T07:00:00Z'),               // < 2,5 h
    fx('Sin Fecha ISO', 'Francia: Ligue 1', ''),                                        // sin kickoffIso
    fx('Fecha Sin Zona', 'Alemania: Bundesliga', '2026-09-14T14:30:00'),                // sin zona horaria
    fx('Fecha Absurda', 'Portugal: Primeira Liga', '2026-10-30T12:00:00Z')              // > 14 dias
]);

assert.strictEqual(r1.status, 200);
assert.strictEqual(r1.body.ok, true);
assert.ok(r1.headers.get('X-Bet365Edge-Build'), 'debe enviar la cabecera de build');
assert.strictEqual(r1.body.origenDatos, FUENTE);
assert.strictEqual(r1.body.fixtures.length, 2, 'solo los 2 fixtures validos');
assert.strictEqual(r1.body.advertenciaTemporal, null, 'hay fixtures: sin advertencia');

const d1 = r1.body.diagnosticoFuente;
assert.strictEqual(d1.recibidos, 8, 'deben auditarse los 8 candidatos');
assert.strictEqual(d1.aceptados, 2);
assert.strictEqual(d1.duplicado, 1, 'el duplicado debe descartarse');
assert.strictEqual(d1.yaPasado, 2, 'ayer + ya empezado');
assert.strictEqual(d1.sinFechaISO, 1, 'una hora suelta sin fecha debe descartarse');
assert.strictEqual(d1.fechaInvalida, 1, 'una fecha sin zona horaria debe descartarse');
assert.strictEqual(d1.fueraDeHorizonte, 1, 'una fecha a mas de 14 dias debe descartarse');
assert.strictEqual(d1.errorFuente, null, 'el stub no debe reportar error de fuente');
console.log('  rechazos: ' + JSON.stringify({ duplicado: d1.duplicado, yaPasado: d1.yaPasado, sinFechaISO: d1.sinFechaISO, fechaInvalida: d1.fechaInvalida, fueraDeHorizonte: d1.fueraDeHorizonte }));

const now1 = new RealDate(S1).getTime();
let previo = 0;
for (const f of r1.body.fixtures) {
    assert.ok(f.matchTimestamp >= now1 + MARGEN_MS, f.partido + ' incumple el margen de 2,5 h (' + f.horaLabel + ')');
    assert.ok(f.matchTimestamp >= previo, 'orden ascendente por kickoff real');
    previo = f.matchTimestamp;
    assert.ok(/^(Hoy|Mañana|Dom|Lun|Mar|Mié|Jue|Vie|Sáb) \d{2}\/\d{2} - \d{2}:\d{2}$/.test(f.horaLabel),
        'horaLabel invalido: ' + f.horaLabel);
    assert.strictEqual(f.temporalStatus, 'FUTURO_VALIDADO');
    assert.strictEqual(f.fuenteDatos, 'ratingbet.com');
    assert.ok(!('offsetHours' in f), 'no debe exponerse offsetHours');
    const real = madridHHMM(f.matchTimestamp);
    assert.strictEqual(real.horaReal, f.hora, 'la hora debe coincidir con la real de Madrid');
    assert.strictEqual(real.fecha, f.fechaCorta, 'la fecha debe coincidir con el dia real de Madrid');
    console.log('  ' + f.horaLabel + ' | ' + f.partido + ' | +' + f.horasRestantes + 'h');
}
assert.strictEqual(r1.body.fixtures[0].horaLabel, 'Hoy 14/09 - 14:30');
assert.strictEqual(r1.body.fixtures[1].horaLabel, 'Hoy 14/09 - 17:00');

// =========================================================================
// Escenario 2 (REGRESION): un partido ya jugado NO se re-fecha a mañana
// =========================================================================
console.log('\n=== Escenario 2 (REGRESION): 23:30 Madrid - lo de hoy NO se re-fecha ===');
const S2 = '2026-09-14T21:30:00Z'; // 23:30 Madrid

const r2 = await pedir(S2, '/api/fixtures-hoy', [
    fx('Partido De Hoy Noche', 'España: LaLiga', '2026-09-14T19:00:00Z'),                 // 21:00 Madrid: ya se jugo
    fx('SC Heerenveen vs Telstar', 'Países Bajos: Eredivisie', '2026-09-15T12:30:00Z')   // mañana 14:30
]);

assert.strictEqual(r2.body.fixtures.length, 1, 'el partido ya jugado no puede reaparecer');
assert.strictEqual(r2.body.diagnosticoFuente.yaPasado, 1, 'debe contarse como descartado');
assert.strictEqual(r2.body.fixtures[0].partido, 'SC Heerenveen vs Telstar');
assert.strictEqual(r2.body.fixtures[0].horaLabel, 'Mañana 15/09 - 14:30');
assert.strictEqual(r2.body.fixtures[0].dia, 'Mañana');
console.log('  publicado: ' + r2.body.fixtures[0].horaLabel);
console.log('  descartado SIN re-fechar: Partido De Hoy Noche (21:00 Madrid de hoy)');

// =========================================================================
// Escenario 3: 02:30 Madrid (cruza medianoche)
// =========================================================================
console.log('\n=== Escenario 3: 02:30 Madrid (cruza medianoche) ===');
const S3 = '2026-09-15T00:30:00Z';

const r3 = await pedir(S3, '/api/fixtures-hoy', [
    fx('SC Heerenveen vs Telstar', 'Países Bajos: Eredivisie', '2026-09-15T12:30:00Z')
]);
assert.strictEqual(r3.body.fixtures.length, 1);
assert.strictEqual(r3.body.fixtures[0].horaLabel, 'Hoy 15/09 - 14:30');
assert.strictEqual(r3.body.fixtures[0].dia, 'Hoy');
console.log('  ' + r3.body.fixtures[0].horaLabel + ' (el 15/09 ya es "Hoy" a esa hora)');

// =========================================================================
// Escenario 4 y 5: SIN fixtures validos no se publica NADA (sin catalogo de reserva)
// =========================================================================
console.log('\n=== Escenario 4/5: sin catalogo embebido de reserva ===');
const r4 = await pedir(S1, '/api/fixtures-hoy', []);
assert.strictEqual(r4.body.fixtures.length, 0, 'lista vacia de la IA -> cero partidos publicados');
assert.ok(r4.body.advertenciaTemporal.includes('No hay partidos futuros disponibles'));
console.log('  IA devuelve {"fixtures":[]} -> publicados: ' + r4.body.fixtures.length);

const r5 = await pedir(S1, '/api/fixtures-hoy');
assert.strictEqual(r5.body.fixtures.length, 0, 'sin fuente disponible debe degradar a VACIO');
assert.strictEqual(r5.body.diagnosticoFuente.errorFuente, 'sin-clave-ia');
console.log('  sin clave de IA -> publicados: ' + r5.body.fixtures.length + ' | errorFuente: ' + r5.body.diagnosticoFuente.errorFuente);

// =========================================================================
// Escenario 6: combinadas y endpoint de version
// =========================================================================
console.log('\n=== Escenario 6: combinadas y /api/version ===');
const parlay = await pedir(S1, '/api/parlays-by-risk?risk=medio', [
    fx('SC Heerenveen vs Telstar', 'Países Bajos: Eredivisie', '2026-09-14T12:30:00Z'),
    fx('Coventry vs Brighton', 'Inglaterra: Premier League', '2026-09-14T15:00:00Z'),
    fx('Levante vs Barcelona', 'España: LaLiga', '2026-09-14T17:00:00Z')
]);
assert.strictEqual(parlay.status, 200);
assert.strictEqual(parlay.body.warning, undefined, 'sin warning cuando hay fixtures');
assert.ok(parlay.body.meta && parlay.body.meta.generadoEnMadrid, 'debe incluir meta temporal');
assert.strictEqual(parlay.body.meta.validacionTemporal, true);
assert.strictEqual(parlay.body.meta.margenSeguridadHoras, 2.5);
assert.strictEqual(parlay.body.partidos.length, 3);
for (const p of parlay.body.partidos) {
    assert.ok(p.dia && p.hora && p.fechaCorta, 'cada pick debe incluir dia, hora y fecha');
    assert.ok(p.matchTimestamp >= new RealDate(S1).getTime() + MARGEN_MS, 'pick fuera de la ventana de seguridad');
}
console.log('  picks validados: ' + parlay.body.partidos.length + ' | primer pick: ' + parlay.body.partidos[0].horaLabel);

const parlayVacio = await pedir(S1, '/api/parlays-by-risk?risk=medio', []);
assert.strictEqual(parlayVacio.body.temporalStatus, 'SIN_PARTIDOS_FUTUROS');
assert.ok(parlayVacio.body.warning.includes('No hay partidos futuros disponibles'), 'debe advertir al usuario');
console.log('  combinada sin fixtures -> temporalStatus: ' + parlayVacio.body.temporalStatus);

const ver = await pedir(S1, '/api/version', [
    fx('SC Heerenveen vs Telstar', 'Países Bajos: Eredivisie', '2026-09-14T12:30:00Z')
]);
assert.strictEqual(ver.body.build, 'temporal-v3-omniroute-2026-09-14');
assert.strictEqual(ver.body.origenDatos, FUENTE);
assert.ok(ver.body.diagnosticoFuente.aceptados >= 1);
console.log('  build: ' + ver.body.build + ' | primer fixture: ' + ver.body.primerFixture.horaLabel);

console.log('\nOK: validacion temporal PASO 2 (fecha ISO + margen 2,5 h + anti-duplicado) sin partidos pasados ni re-fechado.\n');