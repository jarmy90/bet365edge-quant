// Valida el HTML servido por el worker: filas dinamicas, etiquetas temporales y sintaxis del JS inline
// Ejecutar: node test_frontend_validation.js
import assert from 'node:assert';

const RealDate = Date;
const fixedMs = new RealDate('2026-09-14T06:00:00Z').getTime();
class FakeDate extends RealDate {
    constructor(...args) { if (args.length === 0) super(fixedMs); else super(...args); }
    static now() { return fixedMs; }
}
globalThis.Date = FakeDate;

const mod = await import('./worker.js?front=1');
const worker = mod.default;

const resHome = await worker.fetch(new Request('http://test.local/'), {}, {});
const html = await resHome.text();
assert.strictEqual(resHome.status, 200);

console.log('Tamano del HTML principal: ' + html.length + ' bytes');
assert.ok(html.includes('id="heroFixtureBody"'), 'la tabla debe ser dinamica (heroFixtureBody)');
assert.ok(html.includes('VALIDACION TEMPORAL 2.5H'), 'debe existir el badge de validacion temporal');
assert.ok(html.includes('id="heroFixtureStamp"'), 'debe existir el sello de ultima actualizacion');
assert.ok(html.includes('id="hpFeedUpdated"'), 'el feed debe mostrar su ultima actualizacion');
assert.ok(html.includes('iniciarPanelLive()'), 'debe inicializarse el panel live con fixtures reales');
assert.ok(html.includes('horaLabel'), 'el modal debe usar la etiqueta con dia + hora');
assert.ok(!html.includes('Futuro (+3h)') && !html.includes('Futuro (+6.5h)'), 'no deben quedar filas estaticas antiguas');
assert.ok(html.includes('Actualizado ') , 'debe etiquetar la ultima actualizacion');

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
console.log('Bloques <script> inline encontrados: ' + scripts.length);
scripts.forEach((code, i) => {
    try {
        new Function(code);
    } catch (e) {
        console.log('ERROR de sintaxis en el script #' + i + ': ' + e.message);
        throw e;
    }
});

const liveHtml = await (await worker.fetch(new Request('http://test.local/live'), {}, {})).text();
const liveScripts = [...liveHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
liveScripts.forEach((code, i) => {
    try { new Function(code); } catch (e) { console.log('ERROR en el script #' + i + ' de /live: ' + e.message); throw e; }
});
console.log('Sintaxis JS: OK (principal ' + scripts.length + ' bloques, /live ' + liveScripts.length + ' bloques)');

globalThis.Date = RealDate;
console.log('\nOK: frontend del worker validado (dia + hora reales, sin filas estaticas).\n');
