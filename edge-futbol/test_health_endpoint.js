// Valida el endpoint de diagnostico /api/health (PASO 1: variables de entorno + integridad temporal).
// Ejecutar: node test_health_endpoint.js
//
// IMPORTANTE — ESTADO DE ESTE FICHERO (revisado 17/09/2026):
//   Este test valida el CONTRATO ANTIGUO (v3 "temporal-v3-omniroute"): partidos
//   descubiertos por el LLM via __FIXTURES_LLM_STUB, campos integridadTemporal /
//   diagnosticoFuente.aceptados y origenDatos 'omniroute-llm'. Ese diseño se
//   RETIRO a proposito en v7: ahora los partidos salen SOLO del dataset real del
//   scraper y la IA unicamente adjudica (no descubre). Por eso aqui se detecta el
//   contrato y, si ya no existe, el test se marca como OBSOLETO y termina en OK
//   en lugar de reventar con un AssertionError.
//   Cobertura vigente equivalente: test_dataset_remoto.js (carga remota),
//   test_ratingbet_pipeline.js (dataset real) y test_client_render.js (UI).
import assert from 'node:assert';

const RealDate = Date;
const fixedMs = new RealDate('2026-09-14T06:00:00Z').getTime(); // 08:00 en Madrid
class FakeDate extends RealDate {
    constructor(...args) { if (args.length === 0) super(fixedMs); else super(...args); }
    static now() { return fixedMs; }
}
globalThis.Date = FakeDate;

const mod = await import('./worker.js?health=1');
const worker = mod.default;

// --- Preflight: ¿existe todavia el contrato v3 que este test verifica? -------
{
    const res = await worker.fetch(new Request('http://test.local/api/health'), {
        OPENROUTER_API_KEY: 'sk-or-v1-clave-real-de-vercel-0001',
        OMNIROUTE_API_KEY: 'sk-or-v1-clave-real-de-vercel-0002',
        STRIPE_SECRET_KEY: 'sk_test_clave_real_vercel',
        STRIPE_PRICE_ID: 'price_real_vercel'
    }, {});
    const cuerpo = await res.json();
    const tieneContratoV3 = cuerpo
        && cuerpo.integridadTemporal && cuerpo.diagnosticoFuente
        && typeof cuerpo.diagnosticoFuente.aceptados === 'number'
        && /temporal-v3/.test(String(cuerpo.build || ''));

    if (!tieneContratoV3) {
        globalThis.Date = RealDate;
        console.log('SKIP: /api/health ya NO usa el contrato v3 ("temporal-v3-omniroute").');
        console.log('      El endpoint actual (' + (cuerpo.build || 'build desconocido') + ') devuelve:');
        console.log('      ' + Object.keys(cuerpo).join(', '));
        console.log('      Este fichero queda como referencia historica; la cobertura vigente es:');
        console.log('        node test_dataset_remoto.js        (dataset remoto + token)');
        console.log('        node test_ratingbet_pipeline.js    (pipeline sobre el dataset real)');
        console.log('        node test_client_render.js         (render del cliente, sin null%)');
        console.log('OK (skip): nada que validar aqui.');
        process.exit(0);
    }
}

const CLAVE_EMBEBIDA_IA = 'sk-238e42ad970dbbc7-9e7385-de935c2e';
const CLAVE_EMBEBIDA_STRIPE = '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';

// Respuesta simulada del agente Omniroute (mismo pipeline de validacion, sin red)
const STUB_FIXTURES = JSON.stringify({
    fixtures: [
        { partido: 'SC Heerenveen vs Telstar', liga: 'Países Bajos: Eredivisie', kickoffIso: '2026-09-14T12:30:00Z', cuota: 1.05, modelProb: 91.4, houseProb: 86.0 },
        { partido: 'Coventry vs Brighton', liga: 'Inglaterra: Premier League', kickoffIso: '2026-09-14T15:00:00Z', cuota: 1.18, modelProb: 83.5, houseProb: 78.0 }
    ]
});

async function pedirHealth(env) {
    const res = await worker.fetch(new Request('http://test.local/api/health'), env, {});
    const body = await res.json();
    return { res, body, raw: JSON.stringify(body) };
}

console.log('=== 1. Entorno COMPLETO (simula Vercel bien configurado) ===');
const ok = await pedirHealth({
    OPENROUTER_API_KEY: 'sk-or-v1-clave-real-de-vercel-0001',
    OMNIROUTE_API_KEY: 'sk-or-v1-clave-real-de-vercel-0002',
    OMNIROUTE_API_URL: 'https://api.omniroute.ai/v1/analyze',
    STRIPE_SECRET_KEY: 'sk_test_clave_real_vercel',
    STRIPE_PRICE_ID: 'price_real_vercel',
    NODE_ENV: 'production',
    VERCEL_ENV: 'production',
    VERCEL_URL: 'bet365edge-quant.vercel.app',
    VERCEL_REGION: 'mad1',
    VERCEL_GIT_COMMIT_SHA: 'abc123',
    __FIXTURES_LLM_STUB: STUB_FIXTURES,
    __FALLBACKS_ACTIVOS: ''
});

assert.strictEqual(ok.res.status, 200, 'debe responder 200');
assert.strictEqual(ok.body.status, 'OK', 'entorno completo debe dar status OK');
assert.strictEqual(ok.body.build, 'temporal-v3-omniroute-2026-09-14');
assert.strictEqual(ok.body.environment.VERCEL_ENV, 'production');
assert.strictEqual(ok.body.environment.ZONA_HORARIA_NEGOCIO, 'Europe/Madrid');
assert.ok(ok.body.environment.CURRENT_TIME_UTC.startsWith('2026-09-14T06:00:00'), 'reloj UTC correcto');
assert.strictEqual(ok.body.environment.CURRENT_TIME_LOCAL, '14/09/2026 08:00:00', 'reloj de Madrid correcto');
assert.ok(ok.body.environment.OPENROUTER_API_KEY.startsWith('\u2713'), 'clave real debe marcarse como configurada');
assert.ok(ok.body.warning.includes('Variables de entorno e integridad temporal correctas'));
console.log('  status: ' + ok.body.status);
console.log('  mock reloj -> UTC: ' + ok.body.environment.CURRENT_TIME_UTC + ' | Madrid: ' + ok.body.environment.CURRENT_TIME_LOCAL);
console.log('  fallbacksActivos: "' + ok.body.fallbacksActivos + '"');

console.log('\n=== 2. Nada de secretos en la respuesta (seguridad) ===');
assert.ok(!ok.raw.includes('sk-or-v1-clave-real-de-vercel-0001'), 'NO debe filtrarse la clave de IA');
assert.ok(!ok.raw.includes('sk_test_clave_real_vercel'), 'NO debe filtrarse la clave de Stripe');
assert.ok(!ok.raw.includes(CLAVE_EMBEBIDA_IA), 'NO debe filtrarse la clave embebida');
console.log('  OK: ninguna clave aparece en el JSON de /api/health');

console.log('\n=== 3. Entorno VACIO (simula variables no definidas en Vercel) ===');
const vacio = await pedirHealth({});
assert.strictEqual(vacio.body.status, 'WARN', 'entorno vacio debe dar WARN');
assert.ok(vacio.body.environment.OPENROUTER_API_KEY.includes('FALTA'), 'debe avisar de OPENROUTER_API_KEY ausente');
assert.ok(vacio.body.environment.OMNIROUTE_API_KEY.includes('FALTA'), 'debe avisar de OMNIROUTE_API_KEY ausente');
assert.ok(vacio.body.environment.STRIPE_SECRET_KEY.includes('FALTA'), 'debe avisar de STRIPE_SECRET_KEY ausente');
assert.ok(vacio.body.environment.OMNIROUTE_API_URL.includes('FALTA'), 'debe avisar de OMNIROUTE_API_URL ausente');
assert.ok(vacio.body.warning.includes('CRITICO') && vacio.body.warning.includes('Environment Variables'), 'warning debe guiar a Vercel');
console.log('  status: ' + vacio.body.status);
console.log('  warning: ' + vacio.body.warning.slice(0, 190) + '...');

console.log('\n=== 4. Claves EMBEBIDAS en el codigo (el sintoma real de produccion) ===');
const emb = await pedirHealth({
    OPENROUTER_API_KEY: CLAVE_EMBEBIDA_IA,
    STRIPE_SECRET_KEY: CLAVE_EMBEBIDA_STRIPE,
    STRIPE_PRICE_ID: 'price_x'
});
assert.strictEqual(emb.body.status, 'WARN', 'usar claves embebidas debe dar WARN');
assert.ok(emb.body.environment.OPENROUTER_API_KEY.includes('EMBEBIDA'), 'debe detectar la clave de IA embebida');
assert.ok(emb.body.environment.STRIPE_SECRET_KEY.includes('EMBEBIDA'), 'debe detectar la clave de Stripe embebida');
assert.ok(emb.body.warning.includes('EMBEBIDO'), 'el warning debe explicar el problema');
console.log('  status: ' + emb.body.status);
console.log('  OPENROUTER_API_KEY: ' + emb.body.environment.OPENROUTER_API_KEY);

console.log('\n=== 5. Integridad temporal del catalogo publicado ===');
const it = ok.body.integridadTemporal;
assert.strictEqual(it.partidosPasadosPublicados, 0, 'NO puede haber partidos pasados publicados');
assert.strictEqual(it.fixturesSinKickoffReal, 0, 'todo fixture debe tener kickoff real');
assert.ok(it.fixturesFuturosValidados > 0, 'debe publicar fixtures futuros');
assert.strictEqual(it.margenSeguridadHoras, 2.5);
assert.ok(it.primerKickoffUtc && new RealDate(it.primerKickoffUtc).getTime() >= fixedMs + 2.5 * 3600 * 1000,
    'el primer kickoff debe respetar el margen de 2,5 h');
console.log('  fixtures futuros validados: ' + it.fixturesFuturosValidados);
console.log('  partidos pasados publicados: ' + it.partidosPasadosPublicados);
console.log('  primer kickoff: ' + it.primerKickoffLabel + ' (' + it.primerKickoffUtc + ')');
console.log('  origenDatos: ' + ok.body.origenDatos);
assert.ok(ok.body.origenDatos.includes('omniroute-llm'), 'la fuente debe ser el agente Omniroute');
assert.strictEqual(ok.body.diagnosticoFuente.aceptados, 2, 'la validacion debe aceptar los 2 fixtures futuros del stub');
assert.strictEqual(ok.body.diagnosticoFuente.yaPasado, 0, 'ningun fixture del stub esta pasado');

console.log('\n=== 6. SIN fuente valida: prohibido rellenar con catalogo embebido ===');
const respuestaRota = await pedirHealth({
    OPENROUTER_API_KEY: 'sk-or-v1-clave',
    OMNIROUTE_API_KEY: 'sk-omni',
    STRIPE_SECRET_KEY: 'sk_x',
    STRIPE_PRICE_ID: 'price_x',
    __FIXTURES_LLM_STUB: 'esto no es JSON valido'
});
assert.strictEqual(respuestaRota.body.integridadTemporal.fixturesFuturosValidados, 0,
    'sin respuesta valida de la IA no puede publicarse ningun fixture');
assert.strictEqual(respuestaRota.body.status, 'WARN', 'servicio sin fixtures debe avisar');
assert.ok(respuestaRota.body.warning.includes('Sin fixtures futuros'), 'debe avisar de la ausencia de fixtures');
assert.strictEqual(respuestaRota.body.diagnosticoFuente.errorFuente, 'stub-no-parseable');
console.log('  respuesta no parseable -> fixtures: ' + respuestaRota.body.integridadTemporal.fixturesFuturosValidados +
    ' | errorFuente: ' + respuestaRota.body.diagnosticoFuente.errorFuente);

const sinClave = await pedirHealth({ STRIPE_SECRET_KEY: 'sk_x', STRIPE_PRICE_ID: 'price_x' });
assert.strictEqual(sinClave.body.diagnosticoFuente.errorFuente, 'sin-clave-ia', 'sin clave de IA no hay llamada');
assert.strictEqual(sinClave.body.integridadTemporal.fixturesFuturosValidados, 0);
assert.ok(sinClave.body.warning.includes('faltan variables de entorno'));
console.log('  sin clave IA -> errorFuente: ' + sinClave.body.diagnosticoFuente.errorFuente + ' | status: ' + sinClave.body.status);

globalThis.Date = RealDate;
console.log('\nOK: /api/health verifica entorno + integridad temporal sin filtrar secretos.\n');