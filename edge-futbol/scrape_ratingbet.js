// =============================================================================
// SCRAPER RATINGBET (Over/Under 1.5 + 2.5) - pipeline real end-to-end
// -----------------------------------------------------------------------------
// QUE HACE:
//   1. Abre Chrome REAL (headless). ratingbet.com esta tras Cloudflare: ningun
//      fetch de servidor puede leerla (devuelve 403 challenge). Solo un navegador
//      que resuelva el challenge y ejecute el JS obtiene el HTML real.
//   2. Fija zona horaria Europe/Madrid + idioma es-ES, porque la pagina declara
//      data-user-timezone="auto": renderiza las horas en la zona del navegador.
//      Fijandola, "19:00" es hora de Madrid garantizada.
//   3. Navega a la URL POR FECHA (la fecha va en la propia URL, no en una pestana):
//        /football/goals-over-under-1-5/2026-09-15/
//      Asi el filtrado por fecha no depende de pulsar tabs.
//   4. Pulsa "Show more" (.js-show-all-btn) hasta que desaparece:
//      1.5 pasa de ~103 a ~253 filas; 2.5 de ~103 a ~267.
//   5. Extrae cada fila con EXTRACTOR_FN (mismo codigo que validan los tests).
//   6. Normaliza: local/visitante desde el SLUG de la URL (el DOM lo invierte en
//      ~57% de las filas), hora Madrid -> instante UTC real, y valida que la
//      primera columna de cuotas sea Over (contrastando con el "Best Tip").
//   7. Fusiona 1.5 y 2.5 en un unico registro por partido.
//   8. VALIDA TEMPORALMENTE: descarta partidos ya empezados o fuera de ventana.
//   9. Escribe ratingbet_fixtures_data.js (modulo ES para la API) y
//      ratingbet_fixtures.json (auditoria humana).
//
// USO:
//   node scrape_ratingbet.js                 # hoy + manana, 1.5 y 2.5
//   node scrape_ratingbet.js --dias=3        # 3 dias de calendario
//   node scrape_ratingbet.js --headed        # ver el navegador
//   node scrape_ratingbet.js --margen=60     # margen de seguridad en minutos
// =============================================================================

import puppeteer from 'puppeteer-core';
import fs from 'fs';
import {
    EXTRACTOR_FN, normalizarPartido, fusionarLineas, validarTemporal,
    fechaMadridISO, TZ_MADRID
} from './ratingbet_extract.js';

const CHROME_CANDIDATOS = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium'
];

const BASES = {
    '1.5': 'https://ratingbet.com/football/goals-over-under-1-5/',
    '2.5': 'https://ratingbet.com/football/goals-over-under/'
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MAX_CLICS_SHOW_MORE = 15;

function arg(nombre, porDefecto) {
    const hit = process.argv.find(a => a.startsWith('--' + nombre + '='));
    return hit ? hit.split('=').slice(1).join('=') : porDefecto;
}
const flag = (nombre) => process.argv.includes('--' + nombre);

const DIAS = parseInt(arg('dias', '2'), 10);
const MARGEN_MIN = parseInt(arg('margen', '30'), 10);
const MAX_DIAS_VENTANA = parseInt(arg('ventana', '14'), 10);
const HEADED = flag('headed');
// --publicar: sube el dataset al destino remoto al terminar (gist o URL), usando
// GITHUB_TOKEN + RATINGBET_GIST_ID / RATINGBET_PUBLISH_URL del entorno. Sin esta
// bandera el scraper solo escribe los ficheros locales.
// NOTA: esta constante faltaba y provocaba "ReferenceError: PUBLICAR is not
// defined" al final de cada captura (el JSON ya estaba escrito, pero el proceso
// salia con codigo 1 y el CI lo interpretaba como fallo total).
const PUBLICAR = flag('publicar');
const SALIDA_JS = arg('salida', 'ratingbet_fixtures_data.js');
const SALIDA_JSON = arg('auditoria', 'ratingbet_fixtures.json');

function buscarChrome() {
    for (const c of CHROME_CANDIDATOS) { try { if (fs.existsSync(c)) return c; } catch (e) { } }
    return null;
}

// Navega con reintentos: la CDN corta conexiones de forma intermitente y aplica
// rate-limit si se piden demasiadas paginas seguidas.
async function navegar(page, url, intentos = 4) {
    let ultimo = null;
    for (let i = 1; i <= intentos; i++) {
        try {
            const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            // Esperar a que el challenge de Cloudflare se resuelva
            for (let k = 0; k < 30; k++) {
                const t = await page.title().catch(() => '');
                if (!/Just a moment|Verificaci|Attention Required/i.test(t)) break;
                await new Promise(r => setTimeout(r, 800));
            }
            await new Promise(r => setTimeout(r, 1800));
            return res;
        } catch (e) {
            ultimo = e;
            console.log('      reintento ' + i + '/' + intentos + ' (' + String(e.message).slice(0, 55) + ')');
            await new Promise(r => setTimeout(r, 4000 * i));
        }
    }
    throw ultimo;
}

async function pulsarShowMore(page) {
    let clics = 0;
    for (let i = 0; i < MAX_CLICS_SHOW_MORE; i++) {
        const r = await page.evaluate(() => {
            const b = document.querySelector('.js-show-all-btn');
            if (!b) return { hay: false };
            const visible = !!(b.offsetParent || b.getClientRects().length);
            if (!visible) return { hay: false };
            b.scrollIntoView({ block: 'center' });
            b.click();
            return { hay: true };
        }).catch(() => ({ hay: false }));
        if (!r.hay) break;
        clics++;
        await new Promise(r2 => setTimeout(r2, 1000));
    }
    return clics;
}

// Recoleccion de una combinacion (fecha, linea)
async function recoger(page, fechaISO, linea) {
    const url = BASES[linea] + fechaISO + '/';
    const res = await navegar(page, url);
    const status = res ? res.status() : null;

    const clics = await pulsarShowMore(page);
    const filas = await page.evaluate(EXTRACTOR_FN);
    const titulo = await page.title();

    console.log('   [' + linea + '] ' + fechaISO + ' HTTP ' + status + ' | filas ' + filas.length + ' | show-more x' + clics);

    return { filas: filas, clics: clics, status: status, titulo: titulo, url: url, ok: filas.length > 0 };
}
// ---------------------------------------------------------------------------
// PUBLICACION DEL DATASET (actualizacion SIN redeploy)
// ---------------------------------------------------------------------------
// La API en Vercel lee por defecto el modulo EMBEBIDO (congelado en el
// despliegue). Si se define la variable de entorno RATINGBET_DATASET_URL, la API
// prefiere esa copia REMOTA: asi cada scrape nuevo se refleja en la web sin
// volver a desplegar.
//
// Destino A) GitHub Gist (recomendado: gratis, sin servidor):
//        GITHUB_TOKEN      = token con permiso 'gist'
//        RATINGBET_GIST_ID = id del gist (si falta, se crea uno y se imprime)
// Destino B) Cualquier URL que acepte un PUT/POST del JSON:
//        RATINGBET_PUBLISH_URL   = endpoint destino
//        RATINGBET_PUBLISH_TOKEN = token opcional (Authorization: Bearer ...)
// ---------------------------------------------------------------------------
async function publicarDataset(json) {
    const gistId = process.env.RATINGBET_GIST_ID || '';
    const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
    const destino = process.env.RATINGBET_PUBLISH_URL || '';
    const token = process.env.RATINGBET_PUBLISH_TOKEN || '';

    if (!gistId && !ghToken && !destino) {
        console.log('\n--- PUBLICACION ---');
        console.log(' Omitida: no hay destino configurado.');
        console.log(' La web seguira mostrando la captura EMBEBIDA en el despliegue.');
        console.log(' Para actualizarla sin redeploy, define (ver DATOS.md):');
        console.log('   GITHUB_TOKEN + RATINGBET_GIST_ID   -> publica en un Gist');
        console.log('   RATINGBET_PUBLISH_URL [+ _TOKEN]   -> sube el JSON a tu URL');
        console.log(' y en Vercel: RATINGBET_DATASET_URL = <URL raw de ese JSON>');
        return { publicado: false, motivo: 'sin-destino-configurado' };
    }

    const cuerpo = JSON.stringify(json, null, 2);
    const nombreFichero = 'ratingbet_fixtures.json';
    const cabecerasGist = {
        'Authorization': 'Bearer ' + ghToken,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'bet365edge-scraper'
    };

    try {
        // --- A) GitHub Gist ---
        if (ghToken) {
            const payload = {
                description: 'Captura ratingbet Over/Under 1.5-2.5 (' + json.fuente.generadoEnMadrid + ')',
                public: false,
                files: {}
            };
            payload.files[nombreFichero] = { content: cuerpo };

            const esNuevo = !gistId;
            const endpoint = esNuevo ? 'https://api.github.com/gists' : 'https://api.github.com/gists/' + gistId;
            const r = await fetch(endpoint, {
                method: esNuevo ? 'POST' : 'PATCH',
                headers: cabecerasGist,
                body: JSON.stringify(payload)
            });
            if (!r.ok) throw new Error('gist-http-' + r.status + ' ' + (await r.text()).slice(0, 120));
            const d = await r.json();
            const raw = (d.files && d.files[nombreFichero] && d.files[nombreFichero].raw_url) || '';

            console.log('\n--- PUBLICACION ---');
            console.log(esNuevo ? ' Gist CREADO: ' + d.html_url : ' Gist actualizado: ' + d.html_url);
            if (esNuevo) {
                console.log(' Guarda el id para las proximas veces:');
                console.log('   RATINGBET_GIST_ID=' + d.id);
            }
            console.log(' En Vercel > Settings > Environment Variables:');
            console.log('   RATINGBET_DATASET_URL = ' + raw);
            return { publicado: true, modo: esNuevo ? 'gist-creado' : 'gist-actualizado', gistId: d.id, url: raw, htmlUrl: d.html_url };
        }

        // --- B) URL generica ---
        const cab = Object.assign({ 'Content-Type': 'application/json' }, token ? { 'Authorization': 'Bearer ' + token } : {});
        let r = await fetch(destino, { method: 'PUT', headers: cab, body: cuerpo });
        if (!r.ok && r.status !== 204) {
            // Reintento como POST: algunos endpoints no aceptan PUT
            r = await fetch(destino, { method: 'POST', headers: cab, body: cuerpo });
        }
        if (!r.ok && r.status !== 204) throw new Error('publish-http-' + r.status);
        console.log('\n--- PUBLICACION ---');
        console.log(' Dataset publicado en: ' + destino);
        console.log(' Recuerda: RATINGBET_DATASET_URL debe apuntar a la URL RAW de ese JSON.');
        return { publicado: true, modo: 'url', url: destino };
    } catch (e) {
        const msg = String(e && e.message ? e.message : e);
        console.log('\n--- PUBLICACION ---');
        console.log(' FALLO al publicar: ' + msg);
        console.log(' El dataset local SI se ha escrito; solo no se ha publicado en remoto.');
        return { publicado: false, motivo: msg };
    }
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
async function main() {
    const chrome = buscarChrome();
    if (!chrome) {
        console.error('ERROR: no se ha encontrado Chrome/Edge. Instala Google Chrome o pasa una ruta valida.');
        process.exit(2);
    }

    const ahoraMs = Date.now();
    const meta = {
        capturadoEnUtc: new Date(ahoraMs).toISOString(),
        capturadoEnMadrid: new Intl.DateTimeFormat('es-ES', { timeZone: TZ_MADRID, dateStyle: 'full', timeStyle: 'medium' }).format(new Date(ahoraMs))
    };

    console.log('=============================================================');
    console.log(' SCRAPER RATINGBET  (Over/Under 1.5 + 2.5)');
    console.log('=============================================================');
    console.log(' Zona horaria de negocio : ' + TZ_MADRID);
    console.log(' Ahora (Madrid)          : ' + meta.capturadoEnMadrid);
    console.log(' Ahora (UTC)             : ' + meta.capturadoEnUtc);
    console.log(' Chrome                  : ' + chrome);
    console.log(' Dias a recoger          : ' + DIAS);
    console.log(' Margen de seguridad     : ' + MARGEN_MIN + ' min');
    console.log('');

    // Fechas de Madrid (la fecha va en la URL de ratingbet)
    const fechas = [];
    for (let d = 0; d < DIAS; d++) {
        fechas.push(fechaMadridISO(ahoraMs + d * 86400000));
    }
    console.log(' Fechas objetivo: ' + fechas.join(', '));
    console.log('');

    const browser = await puppeteer.launch({
        executablePath: chrome,
        headless: HEADED ? false : 'new',
        defaultViewport: { width: 1440, height: 900 },
        args: [
            '--no-sandbox', '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--lang=es-ES', '--no-first-run', '--disable-dev-shm-usage',
            '--force-fieldtrials=QUIC/Enabled'
        ]
    });

    const page = await browser.newPage();
    // CLAVE: fijar zona horaria y idioma ANTES de navegar. La web declara
    // data-user-timezone="auto": sin esto las horas saldrian en la zona del host
    // (UTC en un servidor) y el desfase romperia la validacion temporal.
    await page.emulateTimezone(TZ_MADRID);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8' });
    await page.setUserAgent(UA);
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    const porLinea = { '1.5': [], '2.5': [] };
    const incidentes = [];

    try {
        for (const fechaISO of fechas) {
            for (const linea of ['1.5', '2.5']) {
                try {
                    const r = await recoger(page, fechaISO, linea);
                    if (!r.ok) {
                        incidentes.push(fechaISO + ' ' + linea + ': pagina sin partidos (HTTP ' + r.status + ')');
                        continue;
                    }
                    // Normalizar cada fila con LA fecha de la URL de la que procede
                    const norm = r.filas
                        .map(f => normalizarPartido(f, fechaISO, linea, meta))
                        .filter(Boolean);
                    porLinea[linea] = porLinea[linea].concat(norm);
                } catch (e) {
                    incidentes.push(fechaISO + ' ' + linea + ': ' + String(e.message).slice(0, 90));
                    console.log('   [' + linea + '] ' + fechaISO + ' FALLO: ' + String(e.message).slice(0, 80));
                }
                // Pausa entre peticiones: evita el rate-limit de la CDN
                await new Promise(r => setTimeout(r, 3000));
            }
        }
    } finally {
        await browser.close();
    }

    console.log('\n--- NORMALIZACION ---');
    console.log(' Filas 1.5 normalizadas: ' + porLinea['1.5'].length);
    console.log(' Filas 2.5 normalizadas: ' + porLinea['2.5'].length);

    const fusion = fusionarLineas(porLinea['1.5'], porLinea['2.5']);
    const conAmbas = fusion.filter(p => p.lineas['1.5'] && p.lineas['2.5']).length;
    console.log(' Partidos unicos (fusion 1.5+2.5): ' + fusion.length + ' | con ambas lineas: ' + conAmbas);

    // Duplicados entre fechas (si el sitio repite un partido al cambiar de dia)
    const claves = new Set();
    let duplicados = 0;
    fusion.forEach(p => { if (claves.has(p.clave)) duplicados++; else claves.add(p.clave); });

    const v = validarTemporal(fusion, { ahoraMs, margenMinutos: MARGEN_MIN, maxDias: MAX_DIAS_VENTANA });

    console.log('\n--- VALIDACION TEMPORAL ---');
    console.log(' Aceptados: ' + v.resumen.aceptados + ' | Descartados: ' + v.resumen.descartados);
    const porMotivo = {};
    v.descartados.forEach(d => { porMotivo[d.motivo] = (porMotivo[d.motivo] || 0) + 1; });
    Object.keys(porMotivo).forEach(k => console.log('   - ' + k + ': ' + porMotivo[k]));
    if (duplicados) console.log('   - duplicados entre fechas: ' + duplicados);

    if (v.aceptados.length === 0) {
        console.error('\nERROR: 0 partidos validos. No se sobrescribe la salida para no publicar datos vacios.');
        if (incidentes.length) console.error('Incidentes: ' + incidentes.join(' | '));
        process.exit(3);
    }

    // -----------------------------------------------------------------------
    // SALIDAS
    // -----------------------------------------------------------------------
    const fuente = {
        generadoEnUtc: meta.capturadoEnUtc,
        generadoEnMadrid: meta.capturadoEnMadrid,
        zonaHorariaNegocio: TZ_MADRID,
        margenMinutos: MARGEN_MIN,
        ventanaMaxDias: MAX_DIAS_VENTANA,
        fechas: fechas,
        lineas: ['1.5', '2.5'],
        totalPartidos: v.aceptados.length,
        totalCapturadosBrutos: fusion.length,
        descartados: v.resumen.descartados,
        muestraDescartados: v.descartados.slice(0, 25),
        incidentes: incidentes.slice(0, 20)
    };

    const payload = {
        version: 'ratingbet-fixtures-v1',
        fuente: fuente,
        partidos: v.aceptados
    };

    fs.writeFileSync(SALIDA_JSON, JSON.stringify(payload, null, 2), 'utf-8');

    const modulo = [
        '// GENERADO AUTOMATICAMENTE por scrape_ratingbet.js - NO EDITAR A MANO',
        '// Capturado: ' + fuente.generadoEnMadrid + ' (' + fuente.generadoEnUtc + ')',
        '// Origen: ratingbet.com con Chrome real (Cloudflare requiere navegador)',
        '// Partidos futuros validados: ' + fuente.totalPartidos + ' de ' + fuente.totalCapturadosBrutos + ' capturados',
        '// Zona horaria de negocio: ' + TZ_MADRID + ' | margen: ' + MARGEN_MIN + ' min',
        '',
        'export const CAPTURA = ' + JSON.stringify({ fuente: fuente }, null, 2) + ';',
        '',
        'export const PARTIDOS = ' + JSON.stringify(v.aceptados, null, 2) + ';',
        '',
        'export default { CAPTURA, PARTIDOS };',
        ''
    ].join('\n');
    fs.writeFileSync(SALIDA_JS, modulo, 'utf-8');

    // -----------------------------------------------------------------------
    // RESUMEN LEGIBLE
    // -----------------------------------------------------------------------
    console.log('\n=============================================================');
    console.log(' LISTO');
    console.log('=============================================================');
    console.log(' ' + SALIDA_JS + '   (' + v.aceptados.length + ' partidos)');
    console.log(' ' + SALIDA_JSON);
    console.log('');

    const porLiga = {};
    v.aceptados.forEach(p => { porLiga[p.liga] = (porLiga[p.liga] || 0) + 1; });
    const top = Object.entries(porLiga).sort((a, b) => b[1] - a[1]).slice(0, 12);
    console.log(' Ligas: ' + Object.keys(porLiga).length + ' | top: ' + top.map(x => x[0].slice(0, 26) + ' (' + x[1] + ')').join(', '));

    console.log('\n PROXIMOS 15 PARTIDOS:');
    console.log(' ' + 'KICKOFF MADRID'.padEnd(18) + 'LIGA'.padEnd(24) + 'PARTIDO'.padEnd(42) + 'O1.5   U1.5   O2.5   U2.5   TIP');
    // Formateo a prueba de campos ausentes: antes se leia 'p.horaMadrid' (campo
    // que NO existe: el real es 'p.hora'), lo que lanzaba
    // "TypeError: Cannot read properties of undefined (reading 'padEnd')" y
    // abortaba la publicacion del dataset aunque el JSON ya estuviera escrito.
    const texto = (v, porDefecto) => (v === null || v === undefined || v === '' ? (porDefecto || 'n/d') : String(v));
    const ancho = (v, n, porDefecto) => texto(v, porDefecto).slice(0, n).padEnd(n);
    v.aceptados.slice(0, 15).forEach(p => {
        const lineas = p.lineas || {};
        const l15 = lineas['1.5'] || {}, l25 = lineas['2.5'] || {};
        const col = (x) => (x === null || x === undefined ? '-' : String(x)).padEnd(7);
        const partido = texto(p.local, '?') + ' - ' + texto(p.visitante, '?');
        const tip = l15.tip || l25.tip || '-';
        console.log(' ' + ancho(p.hora || p.horaMadrid, 18) + ancho(p.liga, 24) + ancho(partido, 42)
            + col(l15.cuotaOver) + col(l15.cuotaUnder) + col(l25.cuotaOver) + col(l25.cuotaUnder) + texto(tip, '-'));
    });
    if (v.aceptados.length) {
        console.log('\n Inicio (UTC): ' + v.aceptados[0].kickoffIsoUtc
            + ' | Fin: ' + v.aceptados[v.aceptados.length - 1].kickoffIsoUtc);
    }

    const sospechosos = v.aceptados.filter(p => p.ordenDomCoincideSlug === false).length;
    console.log(' Filas donde el DOM venia invertido respecto al slug (corregidas): ' + sospechosos);

    // -----------------------------------------------------------------------
    // PUBLICACION REMOTA (opcional): permite que la web use datos nuevos SIN
    // redeploy, definiendo en Vercel RATINGBET_DATASET_URL = esta URL.
    // -----------------------------------------------------------------------
    if (PUBLICAR) {
        const p = await publicarDataset(payload);
        if (!p.publicado) console.log(' (publicacion no realizada: ' + p.motivo + ')');
    } else {
        console.log('\n--- PUBLICACION ---');
        console.log(' Omitida (usa --publicar para subirla). Recuerda que sin URL remota,');
        console.log(' la web solo vera estos datos cuando se redespliegue el modulo embebido.');
    }
}

main().catch(e => { console.error('ERROR FATAL: ' + (e && e.stack ? e.stack : e)); process.exit(1); });