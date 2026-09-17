// HARNESS LOCAL: ejecuta worker.fetch sin red externa y muestra el resultado real.
// Uso: node tools_harness_worker.js
import worker from './worker.js';
import dataset from './ratingbet_fixtures_data.js';

const env = {
    // Sin claves: fuerza el modo degradado (modelo estadistico) y evita llamadas de red
    __FIXTURES_LLM_STUB: ''
};

const RUTAS = ['/', '/api/version', '/api/fixtures-hoy', '/api/health'];

for (const ruta of RUTAS) {
    const req = new Request('https://local.test' + ruta, { method: 'GET' });
    try {
        const res = await worker.fetch(req, env, {});
        const ct = res.headers.get('content-type') || '';
        const txt = await res.text();
        console.log(`\n=== ${ruta} -> HTTP ${res.status} | ${ct.split(';')[0]} | ${txt.length} bytes`);
        if (ct.includes('json')) {
            console.log(txt.slice(0, 1400));
        } else {
            console.log('(html) ' + txt.slice(0, 200).replace(/\s+/g, ' '));
        }
    } catch (e) {
        console.log(`\n=== ${ruta} -> EXCEPCION`);
        console.log('   ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n   ') : e));
    }
}
console.log('\n=== DATASET ===');
console.log('claves:', Object.keys(dataset));
console.log('PARTIDOS:', (dataset.PARTIDOS || []).length);
console.log('CAPTURA:', JSON.stringify(dataset.CAPTURA));
console.log('primer partido:', JSON.stringify((dataset.PARTIDOS || [])[0], null, 1));