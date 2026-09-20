// Ejecuta el JS real del worker en un DOM simulado y comprueba el render de dia + hora.
// Ejecutar: node test_client_render.js
import assert from 'node:assert';
import vm from 'node:vm';
import dataset from './ratingbet_fixtures_data.js';

const RealDate = Date;

// El dataset es REAL y se recaptura cada 3 h, asi que los dias concretos cambian.
// El reloj simulado se ANCLA al primer kickoff del propio dataset (3 h antes) en
// lugar de a una fecha fija: asi las etiquetas "Hoy"/"Manana" siguen teniendo
// sentido con cualquier captura y el test no hay que editarlo cada dia.
function relojAncladoAlDataset() {
    const kickoffs = (dataset.PARTIDOS || [])
        .map(p => Date.parse(p.kickoffIsoUtc))
        .filter(t => Number.isFinite(t));
    if (!kickoffs.length) return new RealDate('2026-09-14T06:00:00Z').getTime(); // respaldo
    return Math.min.apply(null, kickoffs) - 3 * 3600 * 1000;
}

const fixedMs = relojAncladoAlDataset();
class FakeDate extends RealDate {
    constructor(...args) { if (args.length === 0) super(fixedMs); else super(...args); }
    static now() { return fixedMs; }
}
globalThis.Date = FakeDate;

console.log('Reloj simulado: ' + new RealDate(fixedMs).toISOString()
    + ' (primer kickoff del dataset - 3 h)');

const mod = await import('./worker.js?client=1');
const worker = mod.default;

// Fuente de fixtures simulada: recorre el MISMO pipeline de validacion del worker
// (env.__FIXTURES_LLM_STUB), sin red y sin catalogo embebido.
const STUB_LLM = JSON.stringify({
    fixtures: [
        { partido: 'SC Heerenveen vs Telstar', liga: 'Países Bajos: Eredivisie', kickoffIso: '2026-09-17T18:30:00Z', mercado: 'Over 1.5 Goles', cuota: 1.05, modelProb: 91.4, houseProb: 86.0, justificacion: 'La liga neerlandesa supera la linea de 1.5 goles.' },
        { partido: 'Coventry vs Brighton', liga: 'Inglaterra: Premier League', kickoffIso: '2026-09-17T20:00:00Z', mercado: 'Over 1.5 Goles', cuota: 1.18, modelProb: 83.5, houseProb: 78.0, justificacion: 'Brighton genera 1.84 xG por encuentro.' },
        { partido: 'Manchester United vs Manchester City', liga: 'Inglaterra: Premier League', kickoffIso: '2026-09-17T20:30:00Z', mercado: 'Over 1.5 Goles', cuota: 1.12, modelProb: 87.2, houseProb: 81.0, justificacion: 'Derby con media combinada de 3.2 xG.' }
    ]
});
const ENV = { __FIXTURES_LLM_STUB: STUB_LLM, RATINGBET_MAX_ANTIGUEDAD_MIN: '999999' };

const html = await (await worker.fetch(new Request('http://test.local/'), ENV, {})).text();
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1])[0];

const fixtures = [
    { partido: 'Real Madrid vs Barcelona', liga: 'Spain: LaLiga Spain', urlRelativa: '/football/spain-laliga/', ligaCorta: 'LaLiga • España', dia: 'Hoy', fechaCorta: '17/09', hora: '21:00', mercado: 'Over 1.5 Goles', cuota: 1.28, modelProb: 88.5, edge: '+6.2%' },
    { partido: 'Manchester United vs Manchester City', liga: 'England: Premier League England', urlRelativa: '/football/england-premier-league/', ligaCorta: 'Premier League • England', dia: 'Mañana', fechaCorta: '18/09', hora: '18:30', mercado: 'Over 2.5 Goles', cuota: 1.65, modelProb: 68.0, edge: '+4.5%' }
];

function crearEl(id) {
    return {
        id: id, innerHTML: '', textContent: '', value: '', checked: false,
        style: { cssText: '' }, dataset: {}, children: [], disabled: false,
        classList: { add() {}, remove() {}, contains() { return false; } },
        appendChild(c) { this.children.push(c); },
        insertBefore(c) { this.children.unshift(c); },
        removeChild(c) { this.children.pop(); },
        getContext() { return {}; },
        setAttribute() {}, addEventListener() {}, focus() {}, reset() {}
    };
}

const nodos = {};
const handlers = {};
const el = (id) => (nodos[id] = nodos[id] || crearEl(id));

class ChartStub {
    constructor(ctx, cfg) { this.data = cfg.data; this.options = cfg.options; }
    update() {}
}

const sandbox = {
    console: console,
    Date: FakeDate,
    Math: Math,
    JSON: JSON,
    parseInt: parseInt,
    parseFloat: parseFloat,
    isNaN: isNaN,
    String: String,
    Number: Number,
    Object: Object,
    Array: Array,
    Promise: Promise,
    Error: Error,
    RegExp: RegExp,
    encodeURIComponent: encodeURIComponent,
    Chart: ChartStub,
    setInterval: () => 0,
    clearInterval: () => 0,
    setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 0; },
    requestAnimationFrame: () => 0,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { userAgent: 'node-test' },
    location: { href: 'http://test.local/', search: '', hostname: 'test.local' },
    Event: function (t) { this.type = t; },
    alert: () => {},
    fetch: async (url) => {
        if (String(url).indexOf('/api/fixtures-hoy') !== -1) {
            return { ok: true, json: async () => fixtures };
        }
        return { ok: true, json: async () => ({}) };
    },
    document: {
        getElementById: el,
        querySelectorAll: () => [],
        querySelector: () => null,
        createElement: () => crearEl('nuevo'),
        addEventListener: (n, cb) => { (handlers[n] = handlers[n] || []).push(cb); },
        body: crearEl('body'),
        cookie: ''
    }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.window.addEventListener = (n, cb) => { (handlers[n] = handlers[n] || []).push(cb); };

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'worker-inline.js' });

(handlers['DOMContentLoaded'] || []).forEach((cb) => cb());
await new Promise((r) => setImmediate(r));
await new Promise((r) => setImmediate(r));

const fila = nodos['heroFixtureBody'];
assert.ok(fila && fila.innerHTML.length > 100, 'la tabla de fixtures debe haberse rellenado');
// Nota: el dataset es REAL (scraper de ratingbet), asi que los nombres/fechas
// concretos varian cada dia. Se valida la FORMA, no fixtures concretos.
assert.ok(/Hoy|Mañana|Manana/.test(fila.innerHTML), 'las filas muestran el dia real', 'Hoy/Mañana');
assert.ok(/vs/.test(fila.innerHTML), 'las filas muestran partidos (local vs visitante)');
assert.ok(/\d{2}:\d{2}/.test(fila.innerHTML), 'debe mostrar la hora real del kickoff');
assert.ok(!fila.innerHTML.includes('Calculando'), 'el placeholder debe ser sustituido');
assert.ok(!fila.innerHTML.includes('null%'), 'ninguna probabilidad nula pintada (null%)');

assert.ok(nodos['mainPageTicker'].innerHTML.length > 20, 'el ticker debe estar poblado');
const stampTxt = (nodos['heroFixtureStamp'].innerHTML || '') + ' ' + (nodos['heroFixtureStamp'].textContent || '');
assert.ok(/sincronizados hace|sin marca de frescura|capturados hace/i.test(stampTxt),
    'el sello debe indicar DE CUANDO es la captura (frescura del dato)');
assert.ok(!stampTxt.includes('Calculando'), 'el sello no debe quedarse en el estado inicial');
assert.ok(nodos['hpFeedUpdated'].textContent.includes('Actualizado'), 'el feed debe marcar su actualizacion');

const feed = nodos['homeLiveNewsFeed'];
assert.ok(feed.children.length > 0, 'el feed de noticias debe tener entradas');
const primero = feed.children[0];
assert.ok(primero.innerHTML.includes('Madrid') || primero.innerHTML.includes('Hoy'), 'cada entrada debe llevar sello temporal real');

console.log('Filas renderizadas: ' + (fila.innerHTML.match(/<tr>/g) || []).length);
console.log('Ticker: ' + nodos['mainPageTicker'].innerHTML.slice(0, 180).replace(/<[^>]+>/g, '') + '...');
console.log('Sello: ' + (nodos['heroFixtureStamp'].innerHTML || nodos['heroFixtureStamp'].textContent).replace(/<[^>]+>/g, ''));
console.log('Entradas en el feed: ' + feed.children.length);
console.log('Primera entrada: ' + primero.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 170));

// ===========================================================================
// ACTUALIZACION DE DATOS (boton "Actualizar datos" / fuerza de cache)
// ===========================================================================
console.log('\n--- ACTUALIZACION DE DATOS ---');

assert.ok(!/\bsetInterval\(\s*cargarFixturesValidadas\s*,/.test(code),
    'REGRESION: setInterval NO debe pasar el id del temporizador como 3er argumento "force"');
assert.ok(/setInterval\(function \(\) \{[\s\S]{0,180}cargarFixturesValidadas\(false\)/.test(code),
    'el auto-refresco debe pedir sin force (respeta la cache del servidor)');

assert.ok(html.includes('id="btnRefreshDatos"'), 'la interfaz debe ofrecer el boton de actualizar datos');
assert.ok(html.includes('onclick="actualizarDatosAhora()"'), 'el boton debe invocar actualizarDatosAhora()');
assert.ok(typeof sandbox.actualizarDatosAhora === 'function', 'existe actualizarDatosAhora()');
assert.ok(typeof sandbox.renderFrescuraDatos === 'function', 'existe renderFrescuraDatos()');

// force=1 debe saltarse la cache del servidor y exponer la frescura del dato
const fresh = JSON.parse(await (await worker.fetch(
    new Request('http://test.local/api/fixtures-hoy?force=1'), ENV, {})).text());
assert.ok(fresh.ok === true, 'el endpoint responde ok con force=1');
assert.ok(fresh.frescura && typeof fresh.frescura === 'object', 'la respuesta expone el bloque "frescura"');
assert.ok(fresh.frescura.capturadoEnUtc || fresh.frescura.edadMin === null,
    'la frescura trae la marca temporal de la captura o la declara ausente');
assert.ok(typeof fresh.frescura.limiteMin === 'number', 'la frescura publica el limite de caducidad (min)');
assert.ok(['remoto', 'modulo-embebido'].includes(fresh.frescura.modoDataset),
    'la frescura declara el modo de datos (remoto = se actualiza sin redeploy)', String(fresh.frescura.modoDataset));

// El sello debe avisar SOLO cuando la captura esta caducada (dato congelado):
// se prueba con un objeto caducado y otro fresco (determinista, sin depender del reloj).
const salidaCaducada = renderFrescuraDatosSalida({
    capturadoEnUtc: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    edadMin: 180, limiteMin: 45, fresca: false, modoDataset: 'modulo-embebido'
});
assert.ok(/caducada/i.test(salidaCaducada), 'una captura caducada debe avisarse en rojo/ambar al cliente');
assert.ok(/180\s*min/.test(salidaCaducada), 'el aviso debe decir cuantos minutos tiene la captura', salidaCaducada);

const salidaFresca = renderFrescuraDatosSalida({
    capturadoEnUtc: new Date().toISOString(),
    edadMin: 2, limiteMin: 45, fresca: true, modoDataset: 'remoto'
});
assert.ok(!/caducada/i.test(salidaFresca), 'una captura fresca NO debe mostrar aviso de caducidad');
assert.ok(/remoto/.test(salidaFresca), 'el sello debe indicar que el dato se actualiza sin redeploy');

const salidaSinMarca = renderFrescuraDatosSalida(null);
assert.ok(/sin marca de frescura/i.test(salidaSinMarca), 'sin marca de captura se declara explicitamente');

function renderFrescuraDatosSalida(f) {
    const fake = {
        innerHTML: '', textContent: '', style: {}, dataset: {}, children: [],
        classList: { add() {}, remove() {}, contains() { return false; } },
        setAttribute() {}, addEventListener() {}
    };
    const realGet = sandbox.document.getElementById;
    sandbox.document.getElementById = (id) => (id === 'heroFixtureStamp' ? fake : realGet(id));
    try { sandbox.renderFrescuraDatos(f); } finally { sandbox.document.getElementById = realGet; }
    return fake.innerHTML;
}
globalThis.Date = RealDate;
console.log('\nOK: render cliente validado con dia + hora reales.\n');
