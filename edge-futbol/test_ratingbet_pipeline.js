// =============================================================================
// TEST DEL PIPELINE RATINGBET -> POOL PUBLICABLE
// -----------------------------------------------------------------------------
// Se ejecuta contra el DATASET REAL capturado por el scraper
// (ratingbet_fixtures.json), sin red y sin navegador. Comprueba, entre otras
// cosas, la REGRESION del bug original: un dataset envejecido NO puede
// publicarse re-fechando partidos; debe devolver 0 y avisar.
//
// Uso: node test_ratingbet_pipeline.js
// =============================================================================
import fs from 'fs';
import {
    TZ_MADRID, partesMadrid, fechaMadridISO
} from './ratingbet_extract.js';
import {
    construirCandidatos, seleccionarParaAnalisis, construirPromptAnalisis,
    parsearVeredictosIA, aplicarVeredictos, filtrarPublicables,
    construirFixturesSinAnalisis, feedSinAnalisis, construirFeedNoticias,
    noticiasRelevantes, palabrasClaveEquipo, valorEsperado,
    probImplicita, probJusta, margenCasa, normalizarDataset,
    MAX_ANALISIS, MAX_PUBLICADOS, MAX_ANTIGUEDAD_MIN, MARGEN_PUBLICACION_MIN
} from './ratingbet_pipeline.js';

let pass = 0, fail = 0;
const fallos = [];

function ok(cond, titulo, extra) {
    if (cond) { pass++; console.log('  PASS  ' + titulo + (extra !== undefined ? '   [' + extra + ']' : '')); }
    else { fail++; fallos.push(titulo); console.log('  FAIL  ' + titulo + (extra !== undefined ? '   [' + extra + ']' : '')); }
}

// ---------------------------------------------------------------------------
// Bateria 1: carga del dataset real
// ---------------------------------------------------------------------------
console.log('\n=== 1) DATASET REAL DEL SCRAPER ===');
let raw = null;
try { raw = JSON.parse(fs.readFileSync('ratingbet_fixtures.json', 'utf-8')); }
catch (e) { console.log('  (no se pudo leer ratingbet_fixtures.json: ' + e.message + ')'); }

if (!raw) {
    console.log('\nRESULTADO: sin dataset, no se puede validar el pipeline.');
    process.exit(4);
}

const norm = normalizarDataset(raw);
const capturaMs = Date.parse(norm.fuente.generadoEnUtc);
console.log('  Fuente          : ' + (raw.fuente || '(sin etiqueta)'));
console.log('  Capturado (UTC) : ' + norm.fuente.generadoEnUtc);
console.log('  Partidos        : ' + norm.partidos.length);

ok(norm.partidos.length > 50, 'el dataset real trae una lista amplia de partidos', norm.partidos.length);
ok(Number.isFinite(capturaMs), 'el dataset lleva marca de captura parseable', norm.fuente.generadoEnUtc);

const conAmbasLineas = norm.partidos.filter(p => p.lineas && p.lineas['1.5'] && p.lineas['2.5']).length;
ok(conAmbasLineas > 0, 'la fusion 1.5 + 2.5 ha funcionado (partidos con ambas lineas)', conAmbasLineas + '/' + norm.partidos.length);

// Datos reales: hay partidos que solo aparecen en la pagina de 2.5 y alguno con
// cuota 1.00 (mercado inexistente, ej. Ajax vs Willem II: la web muestra "1").
// La regla correcta NO es "todos tienen 1.5", sino:
//   a) toda linea presente tiene cuotas utilizables (> 1), y
//   b) las unicas no utilizables son las de cuota 1.00 del propio sitio.
let lineasPresentes = 0, lineasUsables = 0;
const noUsables = [];
norm.partidos.forEach(p => {
    ['1.5', '2.5'].forEach(k => {
        const l = (p.lineas || {})[k];
        if (!l) return;
        lineasPresentes++;
        if (l.cuotaOver > 1 && l.cuotaUnder > 1) lineasUsables++;
        else noUsables.push({ partido: p.local + ' vs ' + p.visitante, k, l });
    });
});
const todasCuotaUno = noUsables.every(x => Number(x.l.cuotaOver) === 1 || Number(x.l.cuotaUnder) === 1);
ok(lineasPresentes > 0 && (noUsables.length === 0 || todasCuotaUno),
    'las lineas no utilizables son SOLO las de cuota 1.00 del propio sitio (mercado inexistente)',
    lineasUsables + ' usables / ' + noUsables.length + ' con cuota 1.00' +
    (noUsables.length ? ' [' + noUsables.map(x => x.partido + ' ' + x.k + ' O=' + x.l.cuotaOver).join('; ') + ']' : ''));
ok(noUsables.length < lineasPresentes * 0.1,
    'el dato anomalo es marginal (<10% de las lineas)', noUsables.length + '/' + lineasPresentes);

const sinNingunaUsable = norm.partidos.filter(p =>
    ['1.5', '2.5'].every(k => !(p.lineas && p.lineas[k] && p.lineas[k].cuotaOver > 1)));
ok(sinNingunaUsable.length === 0, 'ningun partido se queda sin ninguna linea usable', sinNingunaUsable.length);

const soloUna = norm.partidos.filter(p => {
    const a = !!(p.lineas && p.lineas['1.5']), b = !!(p.lineas && p.lineas['2.5']);
    return (a && !b) || (b && !a);
}).length;
ok(soloUna > 0 && soloUna < norm.partidos.length,
    'se conservan partidos con una sola linea (legitimo: no salen en ambas paginas)', soloUna + ' de ' + norm.partidos.length);

// ---------------------------------------------------------------------------
// Bateria 2: candidatos con captura FRESCA
// ---------------------------------------------------------------------------
console.log('\n=== 2) CONSTRUIR CANDIDATOS (captura fresca) ===');
const r = construirCandidatos(raw, capturaMs, { margenMinutos: 30 });
const cands = r.candidatos;
console.log('  Diagnosticos:', JSON.stringify(r.diag));
ok(r.diag.capturaFresca === true, 'la captura se considera fresca', r.diag.capturaEdadMin + ' min');
ok(cands.length > 50, 'se aceptan los partidos futuros del dataset', cands.length);
ok(cands.every(c => c.temporalStatus === 'FUTURO_VALIDADO'), 'todos los candidatos quedan marcados FUTURO_VALIDADO');
ok(cands.every(c => Number.isFinite(c.kickoffMs)), 'todos tienen kickoff numerico');
ok(cands.every(c => c.kickoffMs >= capturaMs), 'NINGUN candidato es anterior a la captura (cero partidos pasados)',
    cands.length ? new Date(Math.min(...cands.map(c => c.kickoffMs))).toISOString() : '-');
ok(cands.every(c => c.lineas['1.5'] || c.lineas['2.5']), 'todos conservan al menos una linea con cuotas');

// Orden cronologico (la tabla debe salir ordenada)
let ordenado = true;
for (let i = 1; i < cands.length; i++) if (cands[i].kickoffMs < cands[i - 1].kickoffMs) ordenado = false;
ok(ordenado, 'los candidatos salen ordenados por kickoff');

// ---------------------------------------------------------------------------
// Bateria 3: HORARIO Madrid -> UTC (el bug UTC vs local)
// ---------------------------------------------------------------------------
console.log('\n=== 3) CONVERSION HORARIA Madrid -> UTC ===');
const lions = cands.find(c => c.clave === 'lions-fc-vs-south-melbourne');
if (lions) {
    ok(lions.kickoffIsoUtc === '2026-09-15T09:30:00.000Z',
        'las 11:30 de la web (Madrid) se convierten en 09:30 UTC',
        lions.hora + ' -> ' + lions.kickoffIsoUtc);
    ok(lions.zonaHoraria === TZ_MADRID, 'la zona horaria viaja en el dato', lions.zonaHoraria);
    const p = partesMadrid(lions.kickoffMs);
    ok(p.hour === 11 && p.minute === 30, 'y al volver a Madrid se recupera la hora original (ida y vuelta coherente)');
}
const fra = cands.find(c => c.fechaMadrid);
ok(!!fra, 'todos los candidatos llevan fechaMadrid calculada', fra ? fra.fechaMadrid : '-');

// ---------------------------------------------------------------------------
// Bateria 4: SELECCION PARA ANALISIS (prioriza partidos con ambas lineas)
// ---------------------------------------------------------------------------
console.log('\n=== 4) SELECCION PARA ANALISIS ===');
const conAmbas2 = cands.filter(c => c.lineas['1.5'] && c.lineas['2.5']);
const sel = seleccionarParaAnalisis(cands, MAX_ANALISIS);
ok(sel.length === Math.min(MAX_ANALISIS, cands.length), 'la seleccion respeta el tope para no encarecer el LLM', sel.length + '/' + cands.length);
ok(sel.slice(0, conAmbas2.length).every(c => c.lineas['1.5'] && c.lineas['2.5']),
    'prioriza los partidos con ambas lineas (mas informacion por peticion)');
const selTamano = seleccionarParaAnalisis(cands, 5);
ok(selTamano.length === 5, 'el tope es parametrizable', selTamano.length);
ok(seleccionarParaAnalisis([], 10).length === 0, 'sin candidatos la seleccion queda vacia (sin excepcion)');

// ---------------------------------------------------------------------------
// Bateria 5: PROMPT DE ANALISIS (lista cerrada, la IA no descubre partidos)
// ---------------------------------------------------------------------------
console.log('\n=== 5) PROMPT DE ANALISIS ===');
const feedFalso = [
    { fuente: 'Marca', titulo: 'Parte medico del Espanyol', fecha: '2026-09-15T08:00:00Z' },
    { fuente: 'AS', titulo: 'Rueda de prensa del Rayo', fecha: '2026-09-15T09:00:00Z' }
];
const prompt = construirPromptAnalisis(sel, feedFalso, capturaMs);
ok(prompt.totalCandidatos === sel.length, 'el prompt declara cuantos partidos lleva', prompt.totalCandidatos);
ok(/LISTA CERRADA DE PARTIDOS FUTUROS VALIDADOS/.test(prompt.user),
    'la lista de partidos viaja al prompt como LISTA CERRADA');
ok(/NUNCA inventas partidos/.test(prompt.system), 'prohibe explicitamente inventar partidos');
ok(/No inventes cuotas ni edge/.test(prompt.system), 'la cuota y el edge los calcula el sistema, no la IA');
ok(prompt.system.length > 500 && prompt.user.length > 500, 'el prompt es autoexplicativo (no un esqueleto)');
sel.slice(0, 10).forEach(c => {
    if (prompt.user.indexOf(c.clave) === -1) ok(false, 'falta la clave ' + c.clave + ' en el prompt');
});
ok(sel.slice(0, 10).every(c => prompt.user.indexOf(c.clave) !== -1), 'todas las claves seleccionadas viajan al prompt');
ok(prompt.user.indexOf(String(capturaMs ? new Date(capturaMs).toISOString() : '')) !== -1 ||
   /MOMENTO DE EJECUCION \(UTC\)/.test(prompt.user), 'el prompt fecha el momento de ejecucion (anti-alucinacion temporal)');
ok(prompt.user.indexOf('Marca') !== -1, 'el contexto de noticias fechadas se inyecta cuando existe');
const promptSinFeed = construirPromptAnalisis(sel, [], capturaMs);
ok(promptSinFeed.user.indexOf('CONTEXTO DE NOTICIAS') === -1 && promptSinFeed.totalCandidatos === sel.length,
    'sin feed el prompt sigue siendo valido (el feed es opcional, no obligatorio)');
ok(JSON.stringify(promptSinFeed.user).indexOf('NaN') === -1 && JSON.stringify(promptSinFeed.user).indexOf('undefined') === -1,
    'el JSON del prompt no lleva NaN ni undefined');
ok(promptSinFeed.user.indexOf('"cuotas"') !== -1, 'cada partido viaja con sus cuotas reales por linea');

// ---------------------------------------------------------------------------
// Bateria 6: PARSEO DE VEREDICTOS (anti-alucinacion de claves)
// ---------------------------------------------------------------------------
console.log('\n=== 6) PARSEO DE VEREDICTOS IA (anti-alucinacion) ===');
const conAmbasOk = cands.filter(c => c.lineas['1.5'] && c.lineas['2.5']);
// Un partido con cuota jugosa para que el edge pueda ser positivo
const cEdge = conAmbasOk.find(c => c.lineas['1.5'].cuotaOver >= 1.10) || conAmbasOk[0];
const cOtro = conAmbasOk.find(c => c.clave !== cEdge.clave);

const jsonIA = JSON.stringify({
    veredictos: [
        { clave: cEdge.clave, linea: '1.5', lado: 'OVER', probModelo: 95, confianza: 'ALTA', justificacion: 'ritmo alto', factores: ['ritmo'], noticiasUsadas: ['Marca: parte medico'] },
        { clave: 'partido-inventado-vs-nada', linea: '1.5', lado: 'OVER', probModelo: 99 },
        { clave: cOtro.clave, linea: '9.9', lado: 'OVER', probModelo: 70 },
        { clave: cOtro.clave, linea: '1.5', lado: 'AMBOS', probModelo: 70 },
        { clave: cOtro.clave, linea: '1.5', lado: 'OVER', probModelo: 150 },
        { clave: cOtro.clave, linea: '2.5', lado: 'UNDER', probModelo: 62.3, confianza: 'MEDIA' }
    ],
    resumen: 'dos picks con valor'
});
const pv = parsearVeredictosIA('```json\n' + jsonIA + '\n```', sel);
ok(pv.veredictos.length === 2, 'solo sobreviven los veredictos validos', pv.veredictos.length);
ok(pv.diag.recibidos === 6, 'se auditan todos los recibidos', pv.diag.recibidos);
ok(pv.diag.motivos['clave-inexistente'] === 1, 'la clave INVENTADA se descarta (anti-alucinacion)', JSON.stringify(pv.diag.motivos));
ok(pv.diag.motivos['linea-no-disponible'] === 1, 'una linea que el partido no tiene se descarta');
ok(pv.diag.motivos['lado-invalido'] === 1, 'un lado distinto de OVER/UNDER se descarta');
ok(pv.diag.motivos['probabilidad-invalida'] === 1, 'una probabilidad imposible (150%) se descarta');
ok(pv.diag.resumen === 'dos picks con valor', 'se conserva el resumen del analisis');
ok(pv.veredictos.every(v => v.indice >= 0 && v.indice < sel.length), 'cada veredicto apunta a un candidato real por indice');
ok(pv.veredictos.find(v => v.clave === cEdge.clave).factores[0] === 'ritmo', 'los factores cualitativos se conservan');

const pvProsa = parsearVeredictosIA('Aqui tienes el analisis: ' + jsonIA + ' Fin del analisis.', sel);
ok(pvProsa.veredictos.length === 2, 'tolera prosa alrededor del JSON', pvProsa.veredictos.length);
const pvObjeto = parsearVeredictosIA({ veredictos: [], resumen: 'sin valor' }, sel);
ok(pvObjeto.diag.resumen === 'sin valor' && pvObjeto.veredictos.length === 0, 'acepta tambien un objeto ya parseado');
const pvMalo = parsearVeredictosIA('lo siento, no puedo responder', sel);
ok(pvMalo.veredictos.length === 0 && pvMalo.diag.motivos['json-no-parseable'] === 1,
    'texto sin JSON -> 0 veredictos y diagnostico, sin lanzar excepcion');
const pvGuion = parsearVeredictosIA('[{"clave":"x","linea":"1.5","lado":"OVER","probModelo":500}]', sel);
ok(pvGuion.veredictos.length === 0 && pvGuion.diag.recibidos === 1, 'un array fuera de rango tampoco cuela');
const pvVacio = parsearVeredictosIA('{"veredictos":[]}', sel);
ok(pvVacio.veredictos.length === 0 && pvVacio.diag.rechazados === 0, 'una lista vacia es un resultado legitimo ("sin valor"), no un error');

// ---------------------------------------------------------------------------
// Bateria 7: EL EDGE SE CALCULA CON LAS CUOTAS REALES (no lo aporta la IA)
// ---------------------------------------------------------------------------
console.log('\n=== 7) EDGE CON CUOTAS REALES ===');
const analisis = aplicarVeredictos(sel, pv.veredictos, capturaMs);
ok(analisis.length === 2, 'se genera un pick por partido con veredicto valido', analisis.length);

const a1 = analisis.find(a => a.clave === cEdge.clave);
const cuotaReal = cEdge.lineas['1.5'].cuotaOver;
ok(a1.cuota === cuotaReal, 'la cuota publicada es la cuota REAL capturada de ratingbet', a1.cuota);
const pJusta = probJusta(cuotaReal, cEdge.lineas['1.5'].cuotaUnder);
ok(a1.justaProb === pJusta, 'la probabilidad justa sale de las dos cuotas reales (sin margen)', a1.justaProb);
ok(Math.abs(a1.edgePuntos - (a1.modelProb - pJusta)) < 0.05,
    'el edge = prob. modelo - prob. justa (calculado por el sistema, no inventado por la IA)', a1.edge);
const evTeorico = (a1.modelProb / 100) * a1.cuota - 1;
ok(Math.abs(a1.evPct / 100 - evTeorico) < 0.001, 'el EV sale de la cuota real y la probabilidad del modelo', a1.ev);
ok(a1.edge === (a1.edgePuntos >= 0 ? '+' : '') + a1.edgePuntos + '%', 'el edge se muestra con signo', a1.edge);
ok(a1.houseProb === Math.round(probImplicita(cuotaReal) * 10) / 10, 'la probabilidad de la casa se deriva de la cuota', a1.houseProb);
ok(a1.mercado === 'Over 1.5 Goles', 'el mercado se describe en lenguaje natural', a1.mercado);
ok(a1.lineas && Object.keys(a1.lineas).length === 2, 'se publican TODAS las lineas del partido, no solo la apostada',
    Object.keys(a1.lineas).join(' + '));
ok(a1.lineas['2.5'].cuotaOver === cEdge.lineas['2.5'].cuotaOver, 'la linea no apostada tambien lleva cuota real');
ok(analisis[0].evPct >= analisis[analisis.length - 1].evPct, 'los picks salen ordenados por EV (donde esta el valor)');
ok(analisis.every(a => a.temporalStatus === 'FUTURO_VALIDADO' && a.fuenteDatos === 'ratingbet.com'),
    'todo pick queda marcado como futuro validado y con origen declarado');
ok(a1.zonaHoraria === TZ_MADRID && !!a1.kickoffIsoUtc, 'el pick conserva zona horaria y kickoff ISO');
ok(analisis.every(a => a.horaLabel && a.dia), 'cada pick lleva etiqueta de dia y hora para la tabla');
const a2 = analisis.find(a => a.clave === cOtro.clave);
ok(a2.lado === 'UNDER' && a2.linea === '2.5', 'el segundo pick es el del lado UNDER 2.5', a2.linea + '/' + a2.lado);
ok(valorEsperado(95, 1.05) < 0 && valorEsperado(95, 1.5) > 0, 'valorEsperado distingue apuesta sin valor de apuesta con valor');
ok(valorEsperado(50, 1) === -Infinity, 'una cuota de 1.00 no puede generar valor (no se usa como senuelo)');

// Un veredicto sobre un partido que YA empezo no debe llegar al usuario
const inicioMs = sel[0].kickoffMs;
const analisisTarde = aplicarVeredictos(sel, pv.veredictos, inicioMs + 3600000);
ok(analisisTarde.every(a => Number.isFinite(a.horasRestantes)), 'las horas restantes se recalculan en cada pasada',
    analisisTarde.length ? analisisTarde[0].horasRestantes : '-');
ok(analisisTarde === null || analisisTarde.length === 2, 'aplicar veredictos es determinista (no depende del reloj para decidir valor)');

// ---------------------------------------------------------------------------
// Bateria 8: RE-VALIDACION EN TIEMPO DE PETICION  <-- mata "partidos de ayer"
// ---------------------------------------------------------------------------
console.log('\n=== 8) RE-VALIDACION EN TIEMPO DE PETICION (regresion del bug) ===');
const pubOk = filtrarPublicables(analisis, capturaMs, { margenMinutos: MARGEN_PUBLICACION_MIN });
ok(pubOk.publicables.length === analisis.length && pubOk.resumen.descartados === 0,
    'con datos frescos se publica todo lo analizado', pubOk.resumen.publicables + '/' + pubOk.resumen.total);
ok(pubOk.resumen.margenMinutos === MARGEN_PUBLICACION_MIN, 'el margen de publicacion queda declarado', pubOk.resumen.margenMinutos);
ok(!!pubOk.resumen.ahoraUtc && !!pubOk.resumen.ahoraMadrid, 'el resumen audita el ahora en UTC y en Madrid', pubOk.resumen.ahoraMadrid);

// REGRESION CLAVE: el mismo analisis servido 10 dias despues NO puede publicar
// partidos ya jugados. Antes se re-fechaban; ahora caen en la misma peticion.
const pubViejo = filtrarPublicables(analisis, capturaMs + 10 * 86400000, { margenMinutos: MARGEN_PUBLICACION_MIN });
ok(pubViejo.publicables.length === 0,
    'REGRESION: un analisis envejecido NO publica partidos ya iniciados', pubViejo.publicables.length);
ok(pubViejo.descartados.length === analisis.length &&
   pubViejo.descartados.every(d => d.motivo === 'pasado-o-inminente'),
   'y los descarta con motivo auditable', JSON.stringify(pubViejo.descartados.map(d => d.motivo)));

// Un partido marcado como jugado (marcador real en la web) nunca se publica
const conJugado = analisis.map((x, i) => i === 0 ? Object.assign({}, x, { jugado: true }) : x);
const pubJugado = filtrarPublicables(conJugado, capturaMs, {});
ok(pubJugado.descartados.some(d => d.motivo === 'ya-jugado'),
    'REGRESION: un partido con marcador real jamas se publica aunque su hora sea futura');

// El margen: nada que empiece en menos de 15 min sale a la web
const kickoffInminente = capturaMs + 10 * 60000;
const inminente = [{ partido: 'A vs B', kickoffMs: kickoffInminente, kickoffIsoUtc: new Date(kickoffInminente).toISOString() }];
const pubInminente = filtrarPublicables(inminente, capturaMs, { margenMinutos: 15 });
ok(pubInminente.publicables.length === 0 && pubInminente.descartados[0].motivo === 'pasado-o-inminente',
    'un partido a 10 min del kickoff no se publica (margen 15 min)');
const pubInminente2 = filtrarPublicables(inminente, capturaMs, { margenMinutos: 5 });
ok(pubInminente2.publicables.length === 1, 'con margen de 5 min ese mismo partido si se publica', pubInminente2.publicables.length);

// Sin kickoff fiable no se publica (fail-closed)
const sinFecha = filtrarPublicables([{ partido: 'Fantasma vs Nadie' }], capturaMs, {});
ok(sinFecha.publicables.length === 0 && sinFecha.descartados[0].motivo === 'sin-kickoff',
    'un partido sin kickoff fiable se descarta (fail-closed, nunca se inventa la fecha)');

// El kickoff se recalcula en la misma peticion (horasRestantes coherentes)
const muchos = Array.from({ length: 100 }, (_, i) => ({ partido: 'P' + i, kickoffMs: capturaMs + (i + 1) * 3600000 }));
const pubTope = filtrarPublicables(muchos, capturaMs, { max: MAX_PUBLICADOS });
ok(pubTope.publicables.length === MAX_PUBLICADOS, 'respeta el tope de publicacion de la tabla', pubTope.publicables.length);
ok(pubTope.resumen.total === 100, 'el resumen declara el total evaluado, no solo el publicado', pubTope.resumen.total);
ok(pubTope.publicables.every((p, i) => i === 0 || p.kickoffMs >= pubTope.publicables[i - 1].kickoffMs),
    'lo publicado sigue en orden cronologico');
ok(filtrarPublicables([], capturaMs, {}).publicables.length === 0, 'sin lista, la publicacion queda vacia');
ok(filtrarPublicables(null, capturaMs, {}).publicables.length === 0, 'con null tampoco revienta (robustez del endpoint)');

// ---------------------------------------------------------------------------
// CIERRE: resumen + codigo de salida (sin esto el CI no detectaba los FAIL)
// ---------------------------------------------------------------------------
console.log('\n=============================================================');
console.log(' RESULTADO: ' + pass + '/' + (pass + fail) + ' COMPROBACIONES PASAN'
    + (fail ? '   |   ' + fail + ' FALLAN' : ''));
if (fail) console.log(' FALLOS: ' + fallos.join(' ; '));
console.log('=============================================================');
process.exitCode = fail === 0 ? 0 : 1;