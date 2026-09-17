// =============================================================================
// TEST: LECTURA DEL DATASET REMOTO (camino "todo en la nube")
// -----------------------------------------------------------------------------
// Comprueba, con un servidor HTTP local (sin tocar internet), las cuatro
// situaciones del cargador de dataset del worker:
//   1. JSON en crudo sin autenticacion          -> modo 'remoto'
//   2. JSON en crudo detras de Bearer (repo PRIVADO) -> modo 'remoto' con token
//   3. Ese mismo origen SIN token                -> fallback honesto al embebido
//   4. Respuesta de la API de contenidos de GitHub ({content: base64}) -> 'remoto'
// Tambien verifica que se envia un cache-buster ('cb') en la peticion: sin el,
// un CDN intermedio puede servir una captura vieja (el bug original).
//
// USO: node test_dataset_remoto.js     (exit 0 = todo OK)
// =============================================================================
import http from 'http';
import fs from 'fs';

const FICHERO = 'ratingbet_fixtures.json';
const TOKEN = 's3creto-de-prueba';

let pasan = 0, fallan = 0;
function ok(cond, nombre, detalle) {
    if (cond) { pasan++; console.log('  PASS  ' + nombre + (detalle !== undefined ? '   [' + detalle + ']' : '')); }
    else { fallan++; console.log('  FAIL  ' + nombre + (detalle !== undefined ? '   [' + detalle + ']' : '')); }
}

// --- Servidor de prueba ------------------------------------------------------
const crudo = fs.readFileSync(FICHERO, 'utf-8');
const N_PARTIDOS = (JSON.parse(crudo).partidos || []).length;
const base64 = Buffer.from(crudo, 'utf-8').toString('base64');

const peticiones = [];   // auditoria: que recibio el servidor

const servidor = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    peticiones.push({
        ruta: u.pathname,
        cb: u.searchParams.get('cb'),
        authorization: req.headers['authorization'] || null
    });

    const json = (code, cuerpo) => {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(cuerpo);
    };

    // 1) Publico en crudo
    if (u.pathname === '/raw') return json(200, crudo);

    // 2 y 3) Privado: exige Bearer, como un repo privado de GitHub
    if (u.pathname === '/privado' || u.pathname === '/privado-sin-token') {
        if (u.pathname === '/privado' && req.headers['authorization'] !== 'Bearer ' + TOKEN) {
            return json(401, JSON.stringify({ message: 'Requires authentication' }));
        }
        if (u.pathname === '/privado-sin-token') {
            return json(401, JSON.stringify({ message: 'Requires authentication' }));
        }
        return json(200, crudo);
    }

    // 4) Envoltorio de la API de contenidos de GitHub
    if (u.pathname === '/envuelto') {
        return json(200, JSON.stringify({
            name: 'ratingbet_fixtures.json', path: 'ratingbet_fixtures.json',
            encoding: 'base64', content: base64, size: crudo.length
        }));
    }

    return json(404, JSON.stringify({ message: 'not found' }));
});

await new Promise(r => servidor.listen(0, '127.0.0.1', r));
const PUERTO = servidor.address().port;
const base = 'http://127.0.0.1:' + PUERTO;

console.log('\n--- SERVIDOR DE PRUEBA ---');
console.log('  ' + base + '  (' + N_PARTIDOS + ' partidos en ' + FICHERO + ')');

const worker = (await import('./worker.js')).default;

// Ejecuta /api/version con un env concreto y devuelve el diagnostico real
async function diagCon(env) {
    const req = new Request('https://local.test/api/version?force=1', { method: 'GET' });
    const res = await worker.fetch(req, env, {});
    const j = await res.json();
    const df = j.diagnosticoFuente || {};
    return { dd: df.diagDataset || null, dc: df.diagCandidatos || null, build: j.build };
}

// --- 1) Crudo, sin autenticacion ---------------------------------------------
console.log('\n--- 1) JSON CRUDO PUBLICO (raw.githubusercontent) ---');
{
    const { dd } = await diagCon({
        RATINGBET_DATASET_URL: base + '/raw',
        __FIXTURES_LLM_STUB: ''
    });
    ok(!!dd, 'hay diagnostico de dataset');
    ok(dd && dd.modo === 'remoto', 'modo = remoto', dd && dd.modo);
    ok(dd && dd.partidosRecibidos === N_PARTIDOS, 'partidos recibidos = ' + N_PARTIDOS, dd && dd.partidosRecibidos);
    ok(dd && dd.error === null, 'sin error', dd && dd.error);
    ok(dd && dd.autenticado === false, 'marcado como no autenticado');
    ok(dd && dd.bytes > 1000, 'bytes > 1000', dd && dd.bytes);
    const p = peticiones.find(x => x.ruta === '/raw');
    ok(!!(p && p.cb), 'la peticion lleva cache-buster (cb)');
}

// --- 2) Privado CON token ----------------------------------------------------
console.log('\n--- 2) REPO PRIVADO CON TOKEN ---');
{
    const { dd } = await diagCon({
        RATINGBET_DATASET_URL: base + '/privado',
        RATINGBET_DATASET_TOKEN: TOKEN,
        __FIXTURES_LLM_STUB: ''
    });
    ok(dd && dd.modo === 'remoto', 'modo = remoto', dd && dd.modo);
    ok(dd && dd.partidosRecibidos === N_PARTIDOS, 'partidos recibidos = ' + N_PARTIDOS, dd && dd.partidosRecibidos);
    ok(dd && dd.autenticado === true, 'marcado como autenticado');

// --- 3) Privado SIN token -> fallback honesto --------------------------------
console.log('\n--- 3) REPO PRIVADO SIN TOKEN (debe avisar, no inventar) ---');
{
    const { dd, dc } = await diagCon({
        RATINGBET_DATASET_URL: base + '/privado-sin-token',
        __FIXTURES_LLM_STUB: ''
    });
    ok(dd && dd.modo === 'remoto-fallido->embebido', 'modo = remoto-fallido->embebido', dd && dd.modo);
    ok(dd && dd.error === 'http-401', 'error registrado = http-401', dd && dd.error);
    ok(dd && dd.autenticado === false, 'marcado como no autenticado');
    ok(dc && dc.capturaUtc !== undefined, 'se cae al dataset EMBEBIDO (hay captura declarada)',
        dc && dc.capturaUtc);
}

// --- 4) Envoltorio base64 de la API de contenidos de GitHub ------------------
console.log('\n--- 4) API DE CONTENIDOS DE GITHUB ({content: base64}) ---');
{
    const { dd } = await diagCon({
        RATINGBET_DATASET_URL: base + '/envuelto',
        __FIXTURES_LLM_STUB: ''
    });
    ok(dd && dd.modo === 'remoto', 'modo = remoto', dd && dd.modo);
    ok(dd && dd.partidosRecibidos === N_PARTIDOS,
        'base64 decodificado y parseado = ' + N_PARTIDOS + ' partidos', dd && dd.partidosRecibidos);
}

// --- 5) Sin URL remota: comportamiento de siempre ----------------------------
console.log('\n--- 5) SIN RATINGBET_DATASET_URL (dataset embebido) ---');
{
    const { dd } = await diagCon({ __FIXTURES_LLM_STUB: '' });
    ok(dd && dd.modo === 'modulo-embebido', 'modo = modulo-embebido', dd && dd.modo);
    ok(dd && dd.url === null, 'sin URL remota');
}

// --- 6) Auditoria de peticiones ---------------------------------------------
console.log('\n--- 6) AUDITORIA DE PETICIONES AL ORIGEN ---');
{
    ok(peticiones.length >= 4, 'el origen recibio ' + peticiones.length + ' peticiones');
    ok(peticiones.every(p => p.cb !== null), 'todas llevan cache-buster (ninguna puede quedar cacheada)');
    const conToken = peticiones.filter(p => p.authorization).length;
    ok(conToken === 1, 'solo 1 peticion llevo Authorization (la del caso 2)', conToken);
}

servidor.closeAllConnections();
await new Promise(r => servidor.close(r));

console.log('\n=============================================================');
console.log(' RESULTADO: ' + pasan + '/' + (pasan + fallan) + ' PASS'
    + (fallan ? '   |   ' + fallan + ' FAIL' : ''));
console.log('=============================================================');
process.exitCode = fallan === 0 ? 0 : 1;
    const p = peticiones.find(x => x.ruta === '/privado' && x.authorization);
    ok(!!p, 'el servidor recibio la cabecera Authorization');
    ok(p && p.authorization === 'Bearer ' + TOKEN, 'Authorization = Bearer <token>');
}
