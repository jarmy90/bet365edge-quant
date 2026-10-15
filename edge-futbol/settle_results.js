// =============================================================================
// LIQUIDACION DE PICKS -> TRACK-RECORD (Node puro, sin dependencias)
// -----------------------------------------------------------------------------
// 1. Descarga los picks publicados de /api/parlays-by-risk (bandas bajo, medio,
//    alto + destacados con edge>0) y los registra en el track (dedupe por id:
//    solo la primera publicacion cuenta).
// 2. Liquida los picks pendientes con kickoff hace mas de 3h buscando el
//    resultado final en football-data.org (sin match -> 'sin-datos', que NO
//    cuenta en las estadisticas).
// 3. Recalcula el resumen (hit%, yield, por modelo, por banda, calibracion).
//
// USO
//   node edge-futbol/settle_results.js
//
// ENV
//   FOOTBALL_DATA_API_KEY (o FD_KEY): clave de https://api.football-data.org/v4
//   TRACK_FILE: ruta del track (defecto: edge-futbol/data/track-record.json
//     relativo a la raiz del repo)
//   API_BASE: base de la API publicada (defecto: https://edge.futbol)
//
// Las funciones puras (pickId, emparejarEquipos, matchOutcome, settlePick,
// calcResumen) se exportan para test_settlement.js (mocks, cero red).
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_BASE_DEFAULT = 'https://edge.futbol';
const FD_BASE = 'https://api.football-data.org/v4';
const FD_COMPS = ['PL', 'PD', 'BL1', 'SA', 'FL1', 'CL', 'ELC', 'DED', 'PPL', 'ECL', 'EL', 'SD'];
const BANDAS_API = ['bajo', 'medio', 'alto'];
const DIA_MS = 86400000;
const SETTLE_DELAY_MS = 3 * 3600000; // liquidar solo si el kickoff fue hace >3h

const STOPWORDS_EQ = ['fc', 'cf', 'afc', 'ac', 'sc', 'fk', 'sk', 'if'];
const RANGOS_CAL = ['50-60', '60-70', '70-80', '80-90', '90-100'];

function r1(x) { return Math.round(x * 10) / 10; }
function r2(x) { return Math.round(x * 100) / 100; }

// Raiz del repo = directorio padre de edge-futbol/ (donde vive este script)
export function rutaTrackDefecto() {
    const dirScript = path.dirname(fileURLToPath(import.meta.url));
    return path.join(dirScript, '..', 'edge-futbol', 'data', 'track-record.json');
}

// id estable: clave|mercado|fechaCorta
export function pickId(pick) {
    return [pick.clave, pick.mercado, pick.fechaCorta].map(function (x) { return String(x || ''); }).join('|');
}

// Empareja nombres de equipo: tokens en minuscula sin stopwords y coincidencia
// por inclusion en cualquier direccion (ambos conjuntos no vacios).
export function emparejarEquipos(a, b) {
    function toks(s) {
        return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .split(/[^a-z0-9]+/).filter(function (w) { return w.length >= 2 && STOPWORDS_EQ.indexOf(w) === -1; });
    }
    const ta = toks(a), tb = toks(b);
    if (!ta.length || !tb.length) return false;
    const enB = ta.every(function (t) { return tb.indexOf(t) !== -1; });
    const enA = tb.every(function (t) { return ta.indexOf(t) !== -1; });
    return enA || enB;
}

// 'ganado' | 'perdido' a partir del marcador final. null si no se puede decidir.
export function matchOutcome(linea, lado, golesLocal, golesVisitante) {
    // Number(null) === 0: rechazar vacios antes de convertir.
    const vacio = function (v) { return v === null || v === undefined || v === ''; };
    if (vacio(golesLocal) || vacio(golesVisitante) || vacio(linea)) return null;
    const gl = Number(golesLocal), gv = Number(golesVisitante);
    const ln = parseFloat(linea);
    const up = String(lado || '').toUpperCase();
    if (!Number.isFinite(gl) || !Number.isFinite(gv) || !Number.isFinite(ln)) return null;
    if (up !== 'OVER' && up !== 'UNDER') return null;
    const total = gl + gv;
    if (total === ln) return null; // push (imposible en lineas x.5, por seguridad)
    const win = up === 'OVER' ? total > ln : total < ln;
    return win ? 'ganado' : 'perdido';
}

// Liquida un pick con un score {golesLocal, golesVisitante} o null.
// Devuelve el objeto RESULT del contrato.
export function settlePick(pick, score, settledEnUtc) {
    const sello = settledEnUtc || new Date().toISOString();
    if (!score || !Number.isFinite(Number(score.golesLocal)) || !Number.isFinite(Number(score.golesVisitante))) {
        return { estado: 'sin-datos', golesLocal: null, golesVisitante: null, profit: null, settledEnUtc: sello };
    }
    const gl = Number(score.golesLocal), gv = Number(score.golesVisitante);
    const estado = matchOutcome(pick.linea, pick.lado, gl, gv);
    if (!estado) {
        return { estado: 'sin-datos', golesLocal: gl, golesVisitante: gv, profit: null, settledEnUtc: sello };
    }
    const cuota = Number(pick.cuota);
    const profit = estado === 'ganado'
        ? (Number.isFinite(cuota) && cuota > 1 ? r2(cuota - 1) : null)
        : -1;
    return { estado: estado, golesLocal: gl, golesVisitante: gv, profit: profit, settledEnUtc: sello };
}

function grupoVacio() {
    return { n: 0, settled: 0, ganados: 0, hitPct: 0, yieldPct: 0 };
}

// Resumen sobre picks (cada uno con .result). Solo 'ganado'/'perdido' cuentan
// como settled; 'sin-datos' y 'pendiente' se excluyen de hit% y yield.
export function calcResumen(picks) {
    const lista = Array.isArray(picks) ? picks : [];
    const res = {
        n: lista.length, settled: 0, ganados: 0, hitPct: 0, yieldPct: 0,
        porModelo: { ia: grupoVacio(), poisson: grupoVacio() },
        porBanda: { bajo: grupoVacio(), medio: grupoVacio(), alto: grupoVacio(), destacado: grupoVacio() },
        calibracion: RANGOS_CAL.map(function (rango) { return { rango: rango, n: 0, hits: 0, hitPct: 0 }; })
    };
    let sumaProfit = 0;
    const sumas = { ia: 0, poisson: 0, bajo: 0, medio: 0, alto: 0, destacado: 0 };
    lista.forEach(function (p) {
        const r = p.result || { estado: 'pendiente' };
        if (r.estado !== 'ganado' && r.estado !== 'perdido') return;
        const ganado = r.estado === 'ganado' ? 1 : 0;
        const profit = Number(r.profit);
        res.settled++;
        res.ganados += ganado;
        if (Number.isFinite(profit)) sumaProfit += profit;
        const mk = p.model === 'modelo-ia' ? 'ia' : (p.model === 'modelo-poisson' ? 'poisson' : null);
        if (mk) {
            const g = res.porModelo[mk];
            g.settled++; g.ganados += ganado;
            if (Number.isFinite(profit)) sumas[mk] += profit;
        }
        if (res.porBanda[p.banda]) {
            const gb = res.porBanda[p.banda];
            gb.settled++; gb.ganados += ganado;
            if (Number.isFinite(profit)) sumas[p.banda] += profit;
        }
        const prob = Number(p.probModelo);
        if (Number.isFinite(prob)) {
            const idx = prob < 60 ? 0 : prob < 70 ? 1 : prob < 80 ? 2 : prob < 90 ? 3 : 4;
            const cal = res.calibracion[idx];
            cal.n++; cal.hits += ganado;
        }
    });
    function cierra(g, suma) {
        // n lo fija el llamante por grupo (no pisar con el total)
        if (g.settled > 0) {
            g.hitPct = r1((g.ganados / g.settled) * 100);
            g.yieldPct = r1((suma / g.settled) * 100);
        }
        return g;
    }
    Object.keys(res.porModelo).forEach(function (k) {
        res.porModelo[k].n = lista.filter(function (p) { return (k === 'ia' ? p.model === 'modelo-ia' : p.model === 'modelo-poisson'); }).length;
        cierra(res.porModelo[k], sumas[k]);
    });
    Object.keys(res.porBanda).forEach(function (k) {
        res.porBanda[k].n = lista.filter(function (p) { return p.banda === k; }).length;
        cierra(res.porBanda[k], sumas[k]);
    });
    if (res.settled > 0) {
        res.hitPct = r1((res.ganados / res.settled) * 100);
        res.yieldPct = r1((sumaProfit / res.settled) * 100);
    }
    res.calibracion.forEach(function (c) {
        if (c.n > 0) c.hitPct = r1((c.hits / c.n) * 100);
    });
    return res;
}

export function plantillaTrack() {
    return {
        version: 1,
        actualizadoEnUtc: null,
        picks: [],
        resumen: calcResumen([]),
        nota: 'Track-record de picks publicados (modelo-ia y modelo-poisson). Solo la primera publicacion de cada pick cuenta; sin-datos no entra en hit%/yield. Generado por edge-futbol/settle_results.js.'
    };
}

// Convierte un pick de la API (parlay o destacado) al formato PICK.
// Devuelve null si no es un pick de modelo (sin probBase ia/poisson) o si el
// mercado no es una linea 1.5/2.5 parseable.
export function pickDesdeSeleccion(s, banda, publicadoEnUtc) {
    if (!s || (s.probBase !== 'modelo-ia' && s.probBase !== 'modelo-poisson')) return null;
    const m = /^\s*(Over|Under)\s+(1\.5|2\.5)\b/i.exec(String(s.mercado || ''));
    if (!m) return null;
    const cuota = Number(s.cuota);
    const prob = Number(s.probPct);
    if (!Number.isFinite(cuota) || cuota <= 1 || !Number.isFinite(prob)) return null;
    return {
        id: pickId({ clave: s.clave, mercado: s.mercado, fechaCorta: s.fechaCorta }),
        partido: s.partido || null,
        local: s.local || null,
        visitante: s.visitante || null,
        liga: s.liga || null,
        mercado: s.mercado,
        linea: m[2],
        lado: m[1].toUpperCase(),
        cuota: cuota,
        probModelo: Math.round(prob * 10) / 10,
        edgePuntos: Number.isFinite(Number(s.edgePuntos)) ? Number(s.edgePuntos) : null,
        model: s.probBase,
        banda: banda,
        publicadoEnUtc: publicadoEnUtc,
        kickoffMs: Number.isFinite(Number(s.kickoffMs)) ? Number(s.kickoffMs) : null,
        result: { estado: 'pendiente', golesLocal: null, golesVisitante: null, profit: null, settledEnUtc: null }
    };
}

async function fetchJson(fetchFn, url) {
    const r = await fetchFn(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error('http-' + r.status);
    return r.json();
}

// 1) Descarga picks de las 3 bandas + destacados y los añade al track (dedupe).
export async function descargarPicks(track, apiBase, fetchFn, ahoraIso) {
    const vistos = {};
    track.picks.forEach(function (p) { vistos[p.id] = true; });
    let nuevos = 0;
    const diag = { bandas: {}, destacados: 0, errores: [] };
    for (const risk of BANDAS_API) {
        let data = null;
        try {
            data = await fetchJson(fetchFn, apiBase + '/api/parlays-by-risk?risk=' + risk);
        } catch (e) {
            diag.errores.push(risk + ':' + (e && e.message ? e.message : 'fetch-fallo'));
            diag.bandas[risk] = 'error';
            continue;
        }
        diag.bandas[risk] = (data && data.estado) || 'vacio';
        const lista = [];
        if (data && data.estado === 'ok' && Array.isArray(data.picks)) {
            data.picks.forEach(function (s) {
                const pk = pickDesdeSeleccion(s, risk, ahoraIso);
                if (pk && !vistos[pk.id]) { vistos[pk.id] = true; lista.push(pk); }
            });
        }
        (Array.isArray(data && data.destacados) ? data.destacados : []).forEach(function (s) {
            if (!Number.isFinite(Number(s.edgePuntos)) || Number(s.edgePuntos) <= 0) return;
            const pk = pickDesdeSeleccion(s, 'destacado', ahoraIso);
            if (pk && !vistos[pk.id]) { vistos[pk.id] = true; lista.push(pk); }
        });
        diag.destacados += lista.filter(function (p) { return p.banda === 'destacado'; }).length;
        track.picks = track.picks.concat(lista);
        nuevos += lista.length;
    }
    return { nuevos: nuevos, diag: diag };
}

// 2) Liquida pendientes con kickoff hace >3h usando football-data.org.
// Salta competiciones que fallen; sin match -> 'sin-datos'.
export async function liquidarPendientes(track, fdKey, fetchFn, ahoraMs) {
    const hasta = new Date(ahoraMs).toISOString().slice(0, 10);
    const desde = new Date(ahoraMs - 7 * DIA_MS).toISOString().slice(0, 10);
    const headers = fdKey ? { 'X-Auth-Token': fdKey } : {};
    const partidos = [];
    const diag = { compsOk: 0, compsFallo: 0 };
    for (const comp of FD_COMPS) {
        try {
            const r = await fetchFn(FD_BASE + '/competitions/' + comp +
                '/matches?status=FINISHED&dateFrom=' + desde + '&dateTo=' + hasta,
                { headers: headers, signal: AbortSignal.timeout(10000) });
            if (!r.ok) throw new Error('http-' + r.status);
            const data = await r.json();
            (Array.isArray(data.matches) ? data.matches : []).forEach(function (m) {
                if (!m || !m.score || !m.score.fullTime) return;
                const gh = m.score.fullTime.home, ga = m.score.fullTime.away;
                if (!Number.isFinite(gh) || !Number.isFinite(ga)) return;
                const ms = Date.parse(m.utcDate);
                if (!Number.isFinite(ms)) return;
                partidos.push({
                    local: (m.homeTeam && m.homeTeam.name) || '',
                    visitante: (m.awayTeam && m.awayTeam.name) || '',
                    gh: gh, ga: ga, ms: ms
                });
            });
            diag.compsOk++;
        } catch (_) { diag.compsFallo++; }
    }
    let liquidados = 0, sinDatos = 0;
    const sello = new Date(ahoraMs).toISOString();
    track.picks.forEach(function (p) {
        if (!p.result) return;
        const est = p.result.estado;
        if (est !== 'pendiente' && est !== 'sin-datos') return;
        if (!Number.isFinite(p.kickoffMs) || p.kickoffMs >= ahoraMs - SETTLE_DELAY_MS) return;
        // Reintento acotado: un 'sin-datos' prematuro (marcador aun no publicado)
        // se reintenta mientras el kickoff tenga <7 dias. Mas alla, queda final.
        if (est === 'sin-datos' && ahoraMs - p.kickoffMs >= 7 * DIA_MS) return;
        let hit = null;
        for (const m of partidos) {
            if (Math.abs(p.kickoffMs - m.ms) > DIA_MS) continue;
            if (emparejarEquipos(p.local, m.local) && emparejarEquipos(p.visitante, m.visitante)) { hit = m; break; }
        }
        if (!hit) {
            p.result = settlePick(p, null, sello);
            sinDatos++;
        } else {
            p.result = settlePick(p, { golesLocal: hit.gh, golesVisitante: hit.ga }, sello);
            liquidados++;
        }
    });
    return { liquidados: liquidados, sinDatos: sinDatos, diag: diag };
}

// Pipeline completo con dependencias inyectables (tests) o reales (CLI).
export async function run(opts) {
    const o = opts || {};
    const ahoraMs = Number.isFinite(o.nowMs) ? o.nowMs : Date.now();
    const ahoraIso = new Date(ahoraMs).toISOString();
    const apiBase = o.apiBase || API_BASE_DEFAULT;
    const fdKey = o.fdKey || '';
    const fetchFn = o.fetchFn || fetch;
    const readF = o.readFile || fs.readFileSync;
    const writeF = o.writeFile || fs.writeFileSync;
    const trackPath = o.trackPath || rutaTrackDefecto();

    let track = null;
    try {
        track = JSON.parse(readF(trackPath, 'utf-8'));
        if (!track || !Array.isArray(track.picks)) track = plantillaTrack();
    } catch (_) { track = plantillaTrack(); }

    const descarga = await descargarPicks(track, apiBase, fetchFn, ahoraIso);
    let liquidacion = { liquidados: 0, sinDatos: 0, diag: { compsOk: 0, compsFallo: 0 } };
    try {
        liquidacion = await liquidarPendientes(track, fdKey, fetchFn, ahoraMs);
    } catch (e) {
        liquidacion.error = (e && e.message) || 'liquidacion-fallo';
    }
    track.resumen = calcResumen(track.picks);
    track.actualizadoEnUtc = ahoraIso;
    writeF(trackPath, JSON.stringify(track, null, 2) + '\n', 'utf-8');
    return { trackPath: trackPath, nuevos: descarga.nuevos, diagDescarga: descarga.diag, liquidacion: liquidacion, resumen: track.resumen };
}

async function main() {
    const env = (typeof process !== 'undefined' && process.env) || {};
    const out = await run({
        apiBase: env.API_BASE || API_BASE_DEFAULT,
        fdKey: env.FOOTBALL_DATA_API_KEY || env.FD_KEY || '',
        trackPath: env.TRACK_FILE || rutaTrackDefecto()
    });
    console.log('TRACK: ' + out.trackPath);
    console.log('Nuevos picks: ' + out.nuevos + ' | Liquidados: ' + out.liquidacion.liquidados +
        ' | Sin datos: ' + out.liquidacion.sinDatos);
    console.log('Resumen: n=' + out.resumen.n + ' settled=' + out.resumen.settled +
        ' ganados=' + out.resumen.ganados + ' hit=' + out.resumen.hitPct + '% yield=' + out.resumen.yieldPct + '%');
}

const esCliDirecto = typeof process !== 'undefined' && process.argv && process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (esCliDirecto) {
    main().catch(function (e) { console.error('FALLO settle_results: ' + ((e && e.stack) || e)); process.exit(1); });
}
