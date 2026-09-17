// =============================================================================
// PUBLICADOR DEL DATASET DE RATINGBET
// -----------------------------------------------------------------------------
// Resuelve la pregunta: "¿por que al pulsar Actualizar salen los mismos partidos?"
//
//   La web NO consulta ratingbet en vivo (Cloudflare bloquea cualquier fetch de
//   servidor: 403 challenge). Consume un DATASET capturado por el scraper con un
//   Chrome real. Ese dataset puede llegar a la API de dos formas:
//
//     A) EMBEBIDO en el despliegue (ratingbet_fixtures_data.js)
//        -> el scraper lo actualiza, pero la web solo lo ve TRAS REDESPLEGAR.
//
//     B) REMOTO (variable RATINGBET_DATASET_URL en Vercel)
//        -> la API lo descarga en cada refresco: la web se actualiza SIN
//           redeploy, en cuanto este script publica una captura nueva.
//
// Este script automatiza la via B: ejecuta el scraper y publica el JSON en una
// URL estable. Modos disponibles:
//
//   --modo=info      solo ejecuta el scraper y explica que falta (defecto)
//   --modo=gist      publica/actualiza un GitHub Gist (URL raw estable)
//   --modo=fichero   copia el JSON a una carpeta publica/sincronizada (Dropbox,
//                    OneDrive, carpeta servida por un servidor web propio...)
//
// USO
//   node tools_publicar_dataset.js --modo=gist --gist=<ID> --token=<PAT>
//   node tools_publicar_dataset.js --modo=fichero --destino="C:\public\dataset.json"
//   node tools_publicar_dataset.js                 (solo regenera + diagnostico)
//
// Las credenciales tambien se pueden poner en .env:
//   GITHUB_TOKEN=ghp_...
//   GITHUB_GIST_ID=abc123...
//
// NO se hace red si no se pide un modo que la requiera.
// =============================================================================
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const arg = (nombre, porDefecto) => {
    const hit = process.argv.find(a => a.startsWith('--' + nombre + '='));
    return hit ? hit.split('=').slice(1).join('=') : porDefecto;
};
const flag = (nombre) => process.argv.includes('--' + nombre);

// --- Carga de .env (sin dependencias) ---------------------------------------
function cargarEnv() {
    const out = {};
    for (const f of ['.env', '.env.local']) {
        try {
            if (!fs.existsSync(f)) continue;
            for (const linea of fs.readFileSync(f, 'utf-8').split(/\r?\n/)) {
                const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
                if (!m) continue;
                out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
            }
        } catch (e) { /* .env opcional */ }
    }
    return out;
}

const ENV = cargarEnv();
const env = (k) => process.env[k] || ENV[k] || '';

const FICHERO_JSON = arg('auditoria', 'ratingbet_fixtures.json');
const FICHERO_JS = arg('salida', 'ratingbet_fixtures_data.js');
const MODO = arg('modo', 'info');
const DIAS = arg('dias', '2');
const SIN_SCRAPE = flag('sin-scrape');
// --publico: el gist se crea PUBLICO (URL raw legible por cualquiera, que es lo
// que permite a Vercel leer el dataset SIN token). Un gist privado NO se puede
// leer desde Vercel sin RATINGBET_DATASET_TOKEN.
const PUBLICO = flag('publico') || env('RATINGBET_GIST_PUBLICO') === '1';

function titulo(t) { console.log('\n=== ' + t + ' ==='); }

// -----------------------------------------------------------------------------
// 1) EJECUTAR EL SCRAPER (Chrome real; es lo unico que atraviesa Cloudflare)
// -----------------------------------------------------------------------------
function ejecutarScraper() {
    titulo('1) Capturando datos reales de ratingbet.com');
    if (SIN_SCRAPE) {
        console.log(' Omitido (--sin-scrape): se reutiliza el dataset existente.');
        return true;
    }
    const r = spawnSync(process.execPath, ['scrape_ratingbet.js', '--dias=' + DIAS], {
        stdio: 'inherit'
    });
    if (r.status !== 0) {
        console.error('\nFALLO el scraper (codigo ' + r.status + '). No se publica nada.');
        console.error('Causas habituales: Cloudflare ha rate-limitado la IP o no hay Chrome instalado.');
        return false;
    }
    return true;
}

// -----------------------------------------------------------------------------
// 2) VALIDAR EL DATASET GENERADO (nunca publicar algo vacio o viejo)
// -----------------------------------------------------------------------------
function leerDataset() {
    titulo('2) Validando el dataset generado');
    if (!fs.existsSync(FICHERO_JSON)) {
        console.error(' No existe ' + FICHERO_JSON + '. Ejecuta el scraper primero.');
        return null;
    }
    const stat = fs.statSync(FICHERO_JSON);
    const payload = JSON.parse(fs.readFileSync(FICHERO_JSON, 'utf-8'));
    const n = (payload.partidos || []).length;
    const edadMin = Math.round((Date.now() - stat.mtimeMs) / 60000);

    console.log(' Fichero   : ' + FICHERO_JSON + ' (' + Math.round(stat.size / 1024) + ' KB)');
    console.log(' Capturado : ' + ((payload.fuente && payload.fuente.generadoEnMadrid) || 'n/d'));
    console.log(' Partidos  : ' + n);
    console.log(' Escrito   : hace ' + edadMin + ' min');

    if (n === 0) {
        console.error(' ABORTADO: el dataset no tiene partidos. No se publica (evita vaciar la web).');
        return null;
    }
    return { payload: payload, partidos: n, edadMin: edadMin };
}
// -----------------------------------------------------------------------------
// 3) PUBLICAR EN UN GITHUB GIST (URL raw ESTABLE, sin redeploy de Vercel)
// -----------------------------------------------------------------------------
// Se usa la URL raw "sin sha" (https://gist.githubusercontent.com/<user>/<id>/raw/<fichero>)
// porque redirige SIEMPRE a la ultima revision; la raw_url que devuelve la API
// incluye el sha y cambiaria en cada actualizacion.
const NOMBRE_GIST = 'ratingbet_fixtures.json';

function urlRawEstable(gist) {
    if (!gist) return null;
    const m = String(gist.html_url || '').match(/gist\.github\.com\/([^/]+)\/([0-9a-f]+)/i);
    if (!m) return null;
    return 'https://gist.githubusercontent.com/' + m[1] + '/' + m[2] + '/raw/' + NOMBRE_GIST;
}

async function publicarGist(contenido) {
    titulo('3) Publicando en GitHub Gist');
    const token = arg('token', env('GITHUB_TOKEN'));
    const gistId = arg('gist', env('GITHUB_GIST_ID'));

    if (!token) {
        console.error(' FALTA el token: usa --token=<PAT> o define GITHUB_TOKEN en .env');
        console.error(' El PAT necesita permiso "gist" (crear/editar gists).');
        return null;
    }

    const cuerpo = {
        description: 'Dataset ratingbet (Over/Under 1.5 y 2.5) - generado ' + new Date().toISOString(),
        files: {}
    };
    cuerpo.files[NOMBRE_GIST] = { content: contenido };
    if (!gistId) cuerpo.public = PUBLICO;

    const url = gistId ? 'https://api.github.com/gists/' + gistId : 'https://api.github.com/gists';
    const metodo = gistId ? 'PATCH' : 'POST';

    let res;
    try {
        res = await fetch(url, {
            method: metodo,
            headers: {
                'Authorization': 'Bearer ' + token,
                'Accept': 'application/vnd.github+json',
                'Content-Type': 'application/json',
                'User-Agent': 'bet365edge-publisher'
            },
            body: JSON.stringify(cuerpo)
        });
    } catch (e) {
        console.error(' Error de red publicando el gist: ' + e.message);
        return null;
    }

    const txt = await res.text();
    if (!res.ok) {
        console.error(' GitHub respondio HTTP ' + res.status + ': ' + txt.slice(0, 200));
        if (res.status === 401) console.error(' Token invalido o caducado.');
        if (res.status === 404) console.error(' El gist indicado no existe o el token no lo puede editar.');
        return null;
    }

    let json = null;
    try { json = JSON.parse(txt); } catch (e) { /* respuesta no JSON */ }
    const raw = urlRawEstable(json);

    console.log(' OK: gist ' + (gistId ? 'actualizado' : 'creado') + ' -> ' + (json && json.html_url ? json.html_url : 'n/d'));
    if (soloInfoGist(json)) {
        console.log(' VISIBILIDAD: gist PUBLICO. Cualquiera con la URL puede leer el dataset');
        console.log('   (es lo que permite a Vercel leerlo SIN token). Solo contiene cuotas');
        console.log('   de partidos de ratingbet: no hay ningun secreto dentro.');
    } else {
        console.log(' VISIBILIDAD: gist PRIVADO.');
        console.log('   Vercel NO podra leerlo sin definir RATINGBET_DATASET_TOKEN.');
        console.log('   Si lo que quieres es el camino sin token, crea el gist con --publico.');
    }
    return raw;
}

function soloInfoGist(json) {
    return !!(json && json.public === true);
}

// -----------------------------------------------------------------------------
// 4) PUBLICAR COMO FICHERO (carpeta sincronizada o servida por un web propio)
// -----------------------------------------------------------------------------
function publicarFichero() {
    titulo('3) Copiando el dataset a la ruta de publicacion');
    const destino = arg('destino', env('RATINGBET_DATASET_DESTINO'));
    if (!destino) {
        console.error(' FALTA el destino: usa --destino="C:\\\\ruta\\\\dataset.json"');
        return null;
    }
    try {
        const carpeta = path.dirname(destino);
        if (!fs.existsSync(carpeta)) fs.mkdirSync(carpeta, { recursive: true });
        fs.copyFileSync(FICHERO_JSON, destino);
        const kb = Math.round(fs.statSync(destino).size / 1024);
        console.log(' OK: ' + destino + ' (' + kb + ' KB)');
        console.log(' Recuerda que esa ruta debe ser accesible por HTTPS para Vercel.');
        return destino;
    } catch (e) {
        console.error(' No se pudo copiar: ' + e.message);
        return null;
    }
}
// -----------------------------------------------------------------------------
// 4b) VERIFICAR LA URL PUBLICADA (comprobar que sirve la captura NUEVA)
// -----------------------------------------------------------------------------
// Evita el fallo silencioso tipico: publicar "OK" y que la URL siga sirviendo
// una version cacheada antigua (raw de GitHub cachea unos minutos).
async function verificarRemota(url, partidosEsperados) {
    if (!url) return false;
    titulo('4) Verificando que la URL sirve el dataset nuevo');
    console.log(' URL: ' + url);
    for (let intento = 1; intento <= 3; intento++) {
        try {
            const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'cb=' + Date.now(), {
                headers: { 'Accept': 'application/json' }
            });
            if (!res.ok) {
                console.log('  Intento ' + intento + ': HTTP ' + res.status);
            } else {
                const txt = await res.text();
                let j = null;
                try { j = JSON.parse(txt.replace(/^\uFEFF/, '').trim()); } catch (e) { /* no json */ }
                if (!j) {
                    console.log('  Intento ' + intento + ': la respuesta no es JSON');
                } else {
                    const n = (j.partidos || j.PARTIDOS || []).length;
                    const gen = (j.fuente && j.fuente.generadoEnMadrid) || 'n/d';
                    console.log('  Intento ' + intento + ': ' + n + ' partidos | captura ' + gen);
                    if (n > 0) {
                        console.log(' OK: la URL ya sirve la captura nueva (' + n + ' partidos).');
                        return true;
                    }
                    if (n === 0 && partidosEsperados > 0) {
                        console.log('  AVISO: sirve 0 partidos; puede seguir la version antigua en cache.');
                    }
                }
            }
        } catch (e) {
            console.log('  Intento ' + intento + ': error ' + e.message);
        }
        await new Promise(r => setTimeout(r, 4000));
    }
    console.log(' NO se ha podido confirmar la publicacion. Revisa la URL en el navegador.');
    return false;
}

// -----------------------------------------------------------------------------
// 5) MAIN
// -----------------------------------------------------------------------------
async function main() {
    console.log('=============================================================');
    console.log(' PUBLICADOR DEL DATASET RATINGBET');
    console.log('=============================================================');
    console.log(' Ahora (Madrid): ' + new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid', hour12: false }));
    console.log(' Modo          : ' + MODO);

    // 1) Capturar
    if (!ejecutarScraper()) process.exit(2);

    // 2) Validar (aborta si esta vacio: nunca se vacia la web)
    const info = leerDataset();
    if (!info) process.exit(3);

    // 3) Publicar
    let urlPublicada = null;
    if (MODO === 'gist') {
        const contenido = fs.readFileSync(FICHERO_JSON, 'utf-8');
        urlPublicada = await publicarGist(contenido);
        if (!urlPublicada) process.exit(4);
    } else if (MODO === 'fichero') {
        urlPublicada = publicarFichero();
        if (!urlPublicada) process.exit(4);
    } else {
        titulo('3) Modo "info" (sin publicacion)');
        console.log(' El dataset embebido ya esta actualizado: ' + FICHERO_JS);
        console.log(' Para que la web lo muestre SIN redeploy, publica en remoto y define');
        console.log(' RATINGBET_DATASET_URL en Vercel:');
        console.log('   node tools_publicar_dataset.js --modo=gist --gist=<ID> --token=<PAT>');
        console.log('   node tools_publicar_dataset.js --modo=fichero --destino="C:\\ruta\\dataset.json"');
    }

    // 4) Verificar (solo en modos remotos)
    if (urlPublicada && /^https?:/i.test(urlPublicada)) {
        await verificarRemota(urlPublicada, info.partidos);
        titulo('URL PARA VERCEL');
        console.log(' RATINGBET_DATASET_URL = ' + urlPublicada);
        console.log(' (Settings > Environment Variables; aplica a Production y Preview)');
    } else if (urlPublicada) {
        titulo('RUTA PUBLICADA');
        console.log(' Sirve ese fichero por HTTPS y define en Vercel:');
        console.log(' RATINGBET_DATASET_URL = https://tu-dominio/dataset.json');
    }

    titulo('RESUMEN');
    console.log(' Partidos publicados : ' + info.partidos);
    console.log(' Captura             : ' + ((info.payload.fuente && info.payload.fuente.generadoEnMadrid) || 'n/d'));
    console.log(' Edad del fichero    : hace ' + info.edadMin + ' min');
    console.log(' Recomendacion       : programar este script cada 15-30 min (ver tools_programar_captura.ps1)');
    console.log('');
}

main().catch(e => {
    console.error('ERROR NO CONTROLADO: ' + (e && e.stack ? e.stack : e));
    process.exit(1);
});