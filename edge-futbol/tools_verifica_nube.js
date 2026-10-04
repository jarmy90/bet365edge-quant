// =============================================================================
// VERIFICADOR DE LA NUBE (diagnostico end-to-end, no modifica nada)
// -----------------------------------------------------------------------------
// Comprueba las DOS piezas de la captura en la nube:
//   1. El dataset publicado (RATINGBET_DATASET_URL) responde y trae partidos.
//   2. La antiguedad de la captura esta dentro de la ventana del pipeline.
//   3. La API desplegada (https://bet365edge-quant.vercel.app/api/version)
//      informa de que esta leyendo el dataset REMOTO y cuantos partidos acepta.
//
// USO
//   node tools_verifica_nube.js
//   node tools_verifica_nube.js --url=https://raw.githubusercontent.com/.../ratingbet_fixtures.json
//   $env:RATINGBET_DATASET_TOKEN='<PAT>'   (repo privado; opcional si es publico)
//
// Devuelve exit 0 si todo cuadra, 1 si algo falla (util en CI).
// =============================================================================

const arg = (nombre, porDefecto) => {
    const hit = process.argv.find(a => a.startsWith('--' + nombre + '='));
    return hit ? hit.split('=').slice(1).join('=') : porDefecto;
};

const URL_DATASET_CFG = arg('url', process.env.RATINGBET_DATASET_URL || '');
const TOKEN = process.env.RATINGBET_DATASET_TOKEN || process.env.DATASET_TOKEN || '';
const API_VERSION = arg('api', 'https://bet365edge-quant.vercel.app/api/version');

// Si no se pasa URL, se DESCUBRE la que usa realmente la API desplegada: asi el
// verificador funciona sin argumentos y comprueba exactamente lo que ve el
// usuario, no una URL escrita a mano que podria estar desactualizada.
async function urlDesdeApi() {
    try {
        const j = await fetch(API_VERSION, { headers: { 'Accept': 'application/json' } }).then(r => r.json());
        const dd = (j.diagnosticoFuente && j.diagnosticoFuente.diagDataset) || j.diagDataset || null;
        return (dd && dd.url) || '';
    } catch (e) {
        return '';
    }
}

// Umbral de aviso del pipeline (ratingbet_pipeline.js: MAX_ANTIGUEDAD_MIN)
const AVISO_MIN = 180;
// Umbral de bloqueo duro (ratingbet_pipeline.js: MAX_ANTIGUEDAD_CRITICA_MIN)
const BLOQUEO_MIN = 2880;

let fallos = 0;
function linea(ok, texto) {
    console.log(' ' + (ok ? 'OK   ' : 'FALLO') + ' ' + texto);
    if (!ok) fallos++;
}

function edadDesdeCaptura(payload) {
    // Se prefiere la fecha REAL de captura declarada en el fichero.
    const iso = payload && payload.fuente && payload.fuente.generadoEnUtc;
    if (iso) {
        const t = Date.parse(iso);
        if (Number.isFinite(t)) return Math.round((Date.now() - t) / 60000);
    }
    return null;
}

async function comprobarDataset() {
    console.log('\n=== 1) DATASET PUBLICADO ===');
    let URL_DATASET = URL_DATASET_CFG;
    if (!URL_DATASET) {
        URL_DATASET = await urlDesdeApi();
        if (URL_DATASET) console.log(' URL descubierta desde /api/version: ' + URL_DATASET);
    }
    if (!URL_DATASET) {
        linea(false, 'No hay URL: la API no declara dataset remoto. Define RATINGBET_DATASET_URL o usa --url=');
        return null;
    }
    console.log(' URL: ' + URL_DATASET);

    let res;
    try {
        res = await fetch(URL_DATASET + (URL_DATASET.includes('?') ? '&' : '?') + 'cb=' + Date.now(), {
            headers: Object.assign(
                { 'Accept': 'application/json' },
                TOKEN ? { 'Authorization': 'Bearer ' + TOKEN } : {}
            )
        });
    } catch (e) {
        linea(false, 'Error de red: ' + (e && e.message ? e.message : e));
        return null;
    }

    linea(res.ok, 'HTTP ' + res.status + (TOKEN ? ' (con token)' : ' (sin token)'));
    if (!res.ok) {
        if (!TOKEN) console.log('        PISTA: si el repositorio es privado hay que pasar el token.');
        return null;
    }

    const txt = await res.text();
    let payload = null;
    try { payload = JSON.parse(txt.replace(/^\uFEFF/, '').trim()); } catch (e) { /* no json */ }
    linea(!!payload, 'La respuesta es JSON parseable (' + txt.length + ' bytes)');
    if (!payload) {
        console.log('        Primeros 200 caracteres: ' + txt.slice(0, 200).replace(/\s+/g, ' '));
        return null;
    }

    const partidos = payload.partidos || payload.PARTIDOS || [];
    linea(partidos.length > 0, 'Partidos en el dataset: ' + partidos.length);
    console.log(' Captura declarada: ' + ((payload.fuente && payload.fuente.generadoEnMadrid) || 'n/d'));

    const edad = edadDesdeCaptura(payload);
    if (edad === null) {
        console.log(' AVISO: el dataset no declara fuente.generadoEnUtc; no se puede medir la edad.');
        return payload;
    }
    linea(edad < BLOQUEO_MIN, 'Edad de la captura: ' + edad + ' min (< ' + BLOQUEO_MIN + ' = se publica)');
    if (edad >= AVISO_MIN) {
        console.log(' AVISO: supera los ' + AVISO_MIN + ' min: el pipeline avisara de datos viejos.');
        console.log('        Con captura cada 3 h conviene RATINGBET_MAX_ANTIGUEDAD_MIN=300 en Vercel.');
    }
    return payload;
}


async function comprobarApi() {
    console.log('\n=== 2) API DESPLEGADA (' + API_VERSION + ') ===');
    let j = null;
    try {
        const res = await fetch(API_VERSION, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) { linea(false, 'HTTP ' + res.status); return; }
        j = await res.json();
    } catch (e) {
        linea(false, 'No se pudo leer /api/version: ' + (e && e.message ? e.message : e));
        return;
    }

    console.log(' build: ' + (j.build || 'n/d'));
    const df = j.diagnosticoFuente || {};
    const dd = df.diagDataset || j.diagDataset || null;
    const dc = df.diagCandidatos || j.diagCandidatos || null;

    if (dd) {
        console.log(' modo dataset : ' + dd.modo + (dd.url ? ' -> ' + dd.url : ''));
        if (dd.error) console.log(' error dataset: ' + dd.error);
        linea(dd.modo === 'remoto', 'La API usa el dataset REMOTO (modo=' + dd.modo + ')');
    } else {
        linea(false, 'La API no informa de diagDataset');
    }

    if (dc) {
        console.log(' candidatos   : ' + dc.recibidos + ' recibidos / ' + dc.aceptados + ' aceptados / '
            + dc.descartados + ' descartados');
        if (dc.motivos) console.log(' motivos      : ' + JSON.stringify(dc.motivos));
        console.log(' edad dataset : ' + (dc.capturaEdadMin === null || dc.capturaEdadMin === undefined
            ? 'n/d' : dc.capturaEdadMin + ' min'));
        linea(dc.aceptados > 0, 'La API publica partidos (' + dc.aceptados + ' aceptados)');
    }
}

console.log('=============================================================');
console.log(' VERIFICADOR DE LA NUBE');
console.log('=============================================================');
console.log(' Ahora (Madrid): ' + new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid', hour12: false }));

await comprobarDataset();
await comprobarApi();

console.log('\n=============================================================');
console.log(fallos === 0 ? ' RESULTADO: TODO OK' : ' RESULTADO: ' + fallos + ' COMPROBACION(ES) FALLIDA(S)');
console.log('=============================================================');
// exitCode en lugar de process.exit(): en Windows process.exit() mientras el
// cliente HTTP cierra sus conexiones provoca un assertion de libuv (UV_HANDLE_CLOSING).
process.exitCode = fallos === 0 ? 0 : 1;