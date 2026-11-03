#!/usr/bin/env node
// =============================================================================
// CONSTRUYE data/stats.json (goles casa/fuera por equipo) PARA EL MODELO POISSON
// -----------------------------------------------------------------------------
// POR QUE EXISTE
//   El modelo Poisson necesita saber cuantos goles mete y recibe cada equipo en
//   casa y fuera. football-data.org solo cubre grandes ligas; ratingbet publica
//   sobre todo ligas menores (Venezuela, Paraguay, Colombia...). Este script
//   usa TheSportsDB (gratuito, clave publica '123') para TODAS las ligas de la
//   captura y deja el resultado en un JSON estatico que consume la web.
//
// POR QUE NO SE HACE EN CALIENTE (en Vercel)
//   La clave publica limita a ~30 peticiones/minuto y responde 429 en cuanto se
//   hacen varias. Preguntar desde el edge daria partidos sin estadisticas y
//   latencia. Se precalcula cada 6 h en GitHub Actions.
//
// CACHES (evitan el 429 en ejecuciones consecutivas)
//   data/tsdb_ligas.json       catalogo de ligas por pais    (7 dias)
//   data/tsdb_temporadas.json  eventos por liga+temporada    (12 h)
//
// USO
//   node tools_build_stats.js [--dataset=<url>] [--min-partidos=2]
//                             [--salida=data/stats.json] [--dias=3]
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TSDB = 'https://www.thesportsdb.com/api/v1/json/123';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const IGNORAR = ['liga', 'league', 'division', 'divisions', 'de', 'del', 'la', 'el',
    'the', 'soccer', 'football', 'campeonato', 'torneo', 'trophy'];
const COPA = ['copa', 'cup', 'supercopa', 'superliga', 'supercup', 'recopa', 'champions'];
const PAUSA_MS = 2500;
const CATALOGO_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TEMPORADA_TTL_MS = 12 * 60 * 60 * 1000;

// Ligas cuyo nombre en ratingbet NO se parece al de TheSportsDB.
// clave: "pais|nombre normalizado" -> fragmento del strLeague de TheSportsDB
const ALIAS = [
    { pais: 'colombia', nuestro: 'primera a', tsdb: 'liga dimayor' },
    { pais: 'colombia', nuestro: 'primera b', tsdb: 'torneo dimayor' },
    { pais: 'argentina', nuestro: 'liga profesional', tsdb: 'primera division' },
    { pais: 'argentina', nuestro: 'primera nacional', tsdb: 'primera b nacional' },
    { pais: 'usa', nuestro: 'mls', tsdb: 'major league soccer' },
    { pais: 'usa', nuestro: 'usl', tsdb: 'usl championship' },
    { pais: 'mexico', nuestro: 'liga mx', tsdb: 'liga mx' },
    { pais: 'international', nuestro: '', tsdb: '' }
];

function arg(nombre, def) {
    const p = process.argv.find(function (a) { return a.indexOf('--' + nombre + '=') === 0; });
    return p ? p.split('=').slice(1).join('=') : def;
}

function dormir(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function leerJson(ruta, def) {
    try { return JSON.parse(fs.readFileSync(ruta, 'utf8')); } catch (_) { return def; }
}
function escribirJson(ruta, datos) {
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    fs.writeFileSync(ruta, JSON.stringify(datos, null, 1), 'utf8');
}

let peticiones = 0;
let bloqueos429 = 0;
async function tsdbGet(ruta, intentos) {
    const max = intentos || 3;
    for (let i = 0; i < max; i++) {
        peticiones++;
        try {
            const r = await fetch(TSDB + ruta, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
            if (r.status === 429) {
                bloqueos429++;
                if (bloqueos429 > 6) return null;      // el resto del run no sirve: se corta
                await dormir(10000 * (i + 1));
                continue;
            }
            if (!r.ok) return null;
            return await r.json();
        } catch (e) {
            await dormir(3000 * (i + 1));
        }
    }
    return null;
}

function tokens(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .split(/[^a-z0-9]+/).filter(function (w) { return w.length >= 1 && IGNORAR.indexOf(w) === -1; });
}
function tokenIgual(a, b) {
    if (a === b) return true;
    const min = Math.min(a.length, b.length);
    if (min < 4) return false;
    return a.indexOf(b) === 0 || b.indexOf(a) === 0;
}
function coincideLiga(nuestra, candidata) {
    const a = tokens(nuestra), b = tokens(candidata);
    if (!a.length || !b.length) return 0;
    let comunes = 0;
    a.forEach(function (t) { if (b.some(function (u) { return tokenIgual(t, u); })) comunes++; });
    let p = comunes / Math.max(a.length, b.length);
    const cCand = b.some(function (t) { return COPA.indexOf(t) !== -1; });
    const cNuestra = a.some(function (t) { return COPA.indexOf(t) !== -1; });
    if (cCand && !cNuestra) p *= 0.2;
    return p;
}
function esCopa(strLeague) {
    return tokens(strLeague).some(function (t) { return COPA.indexOf(t) !== -1; });
}
function aliasDe(pais, nombre) {
    const p = String(pais).toLowerCase();
    const n = String(nombre).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    for (const a of ALIAS) {
        if (a.pais === p && a.nuestro && n.indexOf(a.nuestro) !== -1) return a.tsdb;
    }
    return null;
}
function elegirLiga(catalogo, pais, nombre) {
    const noCopas = catalogo.filter(function (L) { return !esCopa(L.strLeague); });
    const alias = aliasDe(pais, nombre);
    if (alias) {
        let hit = null, hitP = 0;
        catalogo.forEach(function (L) {
            const s = String(L.strLeague || '').toLowerCase();
            const p = (s.indexOf(alias) !== -1) ? 1 : coincideLiga(alias, L.strLeague);
            if (p > hitP) { hitP = p; hit = L; }
        });
        if (hit && hitP >= 0.6) return { liga: hit, como: 'alias' };
    }
    let mejor = null, mejorP = 0;
    catalogo.forEach(function (L) {
        const p = coincideLiga(nombre, L.strLeague);
        if (p > mejorP) { mejorP = p; mejor = L; }
    });
    if (mejor && mejorP >= 0.5) return { liga: mejor, como: 'nombre' };
    // Fallback: si el pais tiene UNA sola liga domestica (sin copas), es esa.
    if (noCopas.length === 1) return { liga: noCopas[0], como: 'unica' };
    return null;
}
// TheSportsDB etiqueta la temporada como "2026", "2026-2027" o al reves segun
// la liga. Si la temporada declarada no devuelve eventos, se prueban variantes
// (una sola vez por liga; el resultado queda cacheado 12h).
function variantesTemporada(t) {
    const out = [];
    const push = function (x) { if (x && out.indexOf(x) === -1) out.push(x); };
    const s = String(t || '').trim();
    push(s);
    const m = s.match(/^(\d{4})-(\d{4})$/);
    if (m) { push(m[1]); push(m[2]); }
    if (/^\d{4}$/.test(s)) push(s + '-' + (Number(s) + 1));
    const y = new Date().getUTCFullYear();
    push(String(y)); push(y + '-' + (y + 1)); push((y - 1) + '-' + y);
    return out;
}
function temporadaAnterior(t) {
    const s = String(t || '').trim();
    const m = s.match(/^(\d{4})-(\d{4})$/);
    if (m) return (Number(m[1]) - 1) + '-' + (Number(m[2]) - 1);
    if (/^\d{4}$/.test(s)) return String(Number(s) - 1);
    return null;
}
function paisDeLiga(liga) {
    const s = String(liga || '');
    const i = s.indexOf(':');
    return (i > 0 ? s.slice(0, i) : s).trim().replace(/\s+/g, ' ');
}
function nombreLigaSinPais(liga) {
    return String(liga || '').replace(/^[^:]*:\s*/, '').trim();
}
function normalizarPartidos(json) {
    if (!json) return [];
    if (Array.isArray(json)) return json;
    const claves = ['partidos', 'PARTIDOS', 'fixtures', 'data', 'matches'];
    for (let i = 0; i < claves.length; i++) {
        if (Array.isArray(json[claves[i]])) return json[claves[i]];
    }
    if (json.fuente && Array.isArray(json.fuente.partidos)) return json.fuente.partidos;
    return [];
}
async function cargarDataset(url) {
    if (url) {
        const r = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': UA } });
        if (!r.ok) throw new Error('dataset http-' + r.status);
        return normalizarPartidos(await r.json());
    }
    const local = path.join(__dirname, 'ratingbet_fixtures.json');
    if (!fs.existsSync(local)) throw new Error('no existe ' + local + ' (usa --dataset=<url>)');
    return normalizarPartidos(JSON.parse(fs.readFileSync(local, 'utf8')));
}
function msKickoff(p) {
    const c = p.kickoffMs || p.KICKOFF_MS || p.startTimestamp || p.timestamp;
    if (Number.isFinite(Number(c)) && Number(c) > 1e12) return Number(c);
    const iso = p.kickoffIsoUtc || p.KICKOFF || p.fechaHoraUtc || p.datetime || null;
    const ms = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(ms) ? ms : null;
}

async function main() {
    const url = arg('dataset', '');
    const minPartidos = Number(arg('min-partidos', '2')) || 2;
    const dias = Number(arg('dias', '3')) || 3;
    const salida = arg('salida', path.join(__dirname, 'data', 'stats.json'));
    const fLigas = path.join(__dirname, 'data', 'tsdb_ligas.json');
    const fTemp = path.join(__dirname, 'data', 'tsdb_temporadas.json');
    const cacheLigas = leerJson(fLigas, {});
    const cacheTemp = leerJson(fTemp, {});

    const todos = await cargarDataset(url);
    const ahora = Date.now();
    const partidos = todos.filter(function (p) {
        const ms = msKickoff(p);
        return ms === null || (ms > ahora && ms < ahora + dias * 86400000);
    });
    console.log('[stats] dataset=' + todos.length + ' proximos=' + partidos.length + ' (ventana ' + dias + 'd)');
    if (!partidos.length) throw new Error('sin partidos proximos');

    const porPais = new Map();
    partidos.forEach(function (p) {
        const liga = p.liga || p.LEAGUE || p.league || '';
        const local = p.local || p.HOME || p.home || '';
        const visitante = p.visitante || p.AWAY || p.away || '';
        if (!liga || !local || !visitante) return;
        const pais = paisDeLiga(liga);
        if (!pais) return;
        if (!porPais.has(pais)) porPais.set(pais, new Map());
        const ligas = porPais.get(pais);
        const nombre = nombreLigaSinPais(liga);
        if (!ligas.has(nombre)) ligas.set(nombre, 0);
        ligas.set(nombre, ligas.get(nombre) + 1);
    });

    const salidaLigas = {};
    let sinLiga = 0, sinDatos = 0;

    for (const pais of Array.from(porPais.keys())) {
        const clavePais = 'p:' + pais.toLowerCase();
        let cat = cacheLigas[clavePais];
        if (!cat || (ahora - cat.at) > CATALOGO_TTL_MS) {
            await dormir(PAUSA_MS);
            const j = await tsdbGet('/search_all_leagues.php?c=' + encodeURIComponent(pais) + '&s=Soccer');
            cat = { at: ahora, ligas: (j && Array.isArray(j.countries)) ? j.countries : [] };
            cacheLigas[clavePais] = cat;
            escribirJson(fLigas, cacheLigas);
        }
        if (!cat.ligas.length) {
            console.log('[stats] ' + pais + ': sin catalogo (429). Se reintentara en la proxima ejecucion.');
            continue;
        }

        for (const [nombre, nPartidos] of Array.from(porPais.get(pais).entries())) {
            const elegida = elegirLiga(cat.ligas, pais, nombre);
            if (!elegida) {
                sinLiga++;
                console.log('[stats] ' + pais + ' / ' + nombre + ': sin liga equivalente (' + nPartidos + ' partidos)');
                continue;
            }
            const L = elegida.liga;
            const temporadas = [L.strCurrentSeason];
            const prev = temporadaAnterior(L.strCurrentSeason);
            if (prev) temporadas.push(prev);

            const agg = new Map();
            let nEventos = 0, totCasa = 0, totFuera = 0;
            for (const t of temporadas) {
                const clave = 's:' + L.idLeague + ':' + t;
                let cache = cacheTemp[clave];
                if (!cache || (ahora - cache.at) > TEMPORADA_TTL_MS) {
                    await dormir(PAUSA_MS);
                    const ev = await tsdbGet('/eventsseason.php?id=' + L.idLeague + '&s=' + encodeURIComponent(t || ''));
                    cache = { at: ahora, eventos: (ev && Array.isArray(ev.events)) ? ev.events : [] };
                    cacheTemp[clave] = cache;
                    escribirJson(fTemp, cacheTemp);
                }
                cache.eventos.forEach(function (e) {
                    if (!e) return;
                    const st = String(e.strStatus || '');
                    if (st !== 'FT' && st !== 'AET' && st !== 'PEN') return;
                    const h = parseInt(e.intHomeScore, 10), a = parseInt(e.intAwayScore, 10);
                    if (!Number.isFinite(h) || !Number.isFinite(a)) return;
                    const casa = String(e.strHomeTeam || '').trim();
                    const fuera = String(e.strAwayTeam || '').trim();
                    if (!casa || !fuera) return;
                    nEventos++; totCasa += h; totFuera += a;
                    function acc(k) {
                        if (!agg.has(k)) agg.set(k, { gfH: 0, gaH: 0, nH: 0, gfA: 0, gaA: 0, nA: 0 });
                        return agg.get(k);
                    }
                    const ch = acc(casa); ch.gfH += h; ch.gaH += a; ch.nH += 1;
                    const cf = acc(fuera); cf.gfA += a; cf.gaA += h; cf.nA += 1;
                });
            }

            if (!nEventos) {
                sinDatos++;
                console.log('[stats] ' + pais + ' / ' + L.strLeague + ': 0 resultados (' + nPartidos + ' partidos)');
                continue;
            }

            const avgH = totCasa / nEventos, avgA = totFuera / nEventos;
            const equipos = {};
            let utiles = 0;
            agg.forEach(function (s, equipo) {
                if (s.nH < minPartidos || s.nA < minPartidos) return;
                equipos[equipo] = { gfH: s.gfH, gaH: s.gaH, nH: s.nH, gfA: s.gfA, gaA: s.gaA, nA: s.nA };
                utiles++;
            });
            const claveLiga = String(L.idLeague);
            const previa = salidaLigas[claveLiga];
            if (previa && Object.keys(previa.equipos).length >= utiles) continue;
            salidaLigas[claveLiga] = {
                nombre: L.strLeague, pais: pais,
                avgH: Math.round(avgH * 1000) / 1000, avgA: Math.round(avgA * 1000) / 1000,
                actualizadoEnUtc: new Date().toISOString(),
                equipos: equipos
            };
            console.log('[stats] ' + pais + ' / ' + L.strLeague + ' (' + elegida.como + '): ' +
                nEventos + ' partidos, ' + utiles + ' equipos utiles, avgH=' + avgH.toFixed(2) + ' avgA=' + avgA.toFixed(2));
        }
    }

    const doc = {
        generadoEnUtc: new Date().toISOString(),
        fuente: 'thesportsdb (clave publica)',
        minPartidos: minPartidos,
        peticiones: peticiones,
        sinLiga: sinLiga, sinDatos: sinDatos,
        ligas: salidaLigas
    };
    escribirJson(salida, doc);

    const totalEquipos = Object.keys(salidaLigas).reduce(function (n, k) {
        return n + Object.keys(salidaLigas[k].equipos).length;
    }, 0);
    console.log('[stats] escrito ' + salida + ' | ligas=' + Object.keys(salidaLigas).length +
        ' equipos=' + totalEquipos + ' peticiones=' + peticiones);
    if (!totalEquipos) {
        console.error('[stats] AVISO: ninguna liga con equipos utiles.');
        process.exitCode = 2;
    }
}

main().catch(function (e) {
    console.error('[stats] ERROR: ' + (e && e.stack || e));
    process.exit(1);
});
