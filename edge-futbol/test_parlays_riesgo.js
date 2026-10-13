// TEST: motor de combinadas por nivel de riesgo (construirParlayRiesgo)
// -----------------------------------------------------------------------------
// Contrato (spec de publicacion):
//   - El modelo es CIEGO a la cuota: la IA solo aporta probModelo.
//   - Edge por pick  = (cuotaCasa - 100/probModelo) * 100.
//   - Edge combinada = (cuotaBoosted - cuotaModeloTotal) * 100,
//     con cuotaBoosted = cuotaTotal * (1 + RATINGBET_COMBO_BOOST_PCT/100).
//   - Solo se publican picks con probBase 'modelo-ia' y edgePuntos > 0.
//     Sin IA (tip / mercado-justo) -> estado 'sin-combinada', nunca una cifra inventada.
//
// Uso: node test_parlays_riesgo.js   (exit 0 = todo OK)
import {
    construirParlayRiesgo, seleccionDeFixture, comboBoostPct, BANDAS_RIESGO
} from './ratingbet_pipeline.js';

const NOW = Date.parse('2026-09-15T12:00:00Z'); // instante fijo y determinista
let pasan = 0, fallan = 0;

function ok(cond, nombre, detalle) {
    if (cond) { pasan++; console.log('  PASS  ' + nombre + (detalle !== undefined ? '   [' + detalle + ']' : '')); }
    else { fallan++; console.log('  FAIL  ' + nombre + (detalle !== undefined ? '   [' + detalle + ']' : '')); }
}

// Fabrica un fixture publicable sintetico con la misma forma que produce el pipeline
function fixture(opts) {
    const o = opts || {};
    const offMin = o.offsetMin !== undefined ? o.offsetMin : 240; // kickoff por defecto: +4 h
    const kickoffMs = NOW + offMin * 60000;
    const ln = (cuotaO, cuotaU, tip, tipProb) => ({
        cuotaOver: cuotaO, cuotaUnder: cuotaU,
        pOverJusta: Math.round((1 / cuotaO) / (1 / cuotaO + 1 / cuotaU) * 1000) / 10,
        pUnderJusta: Math.round((1 / cuotaU) / (1 / cuotaO + 1 / cuotaU) * 1000) / 10,
        margenCasa: 5.5, tipRatingbet: tip || null, tipProbPct: tipProb === undefined ? null : tipProb
    });
    const cuota = o.cuota !== undefined ? o.cuota : 1.5;
    // Edge del pipeline: (cuotaCasa - 100/probModelo) * 100, redondeado a 1 decimal.
    const edgePuntos = o.modelProb !== undefined && Number.isFinite(cuota) && cuota > 1
        ? Math.round((cuota - (100 / o.modelProb)) * 1000) / 10
        : null;
    return {
        clave: o.clave || 'fx-' + Math.random().toString(36).slice(2),
        partido: o.nombre || 'Equipo A vs Equipo B',
        local: 'Equipo A', visitante: 'Equipo B',
        liga: 'Espana: LaLiga', ligaCorta: 'LaLiga',
        hora: '18:00', horaLabel: 'Hoy 15/09 - 18:00', dia: 'Hoy', fechaCorta: '15/09',
        kickoffMs: kickoffMs, kickoffIsoUtc: new Date(kickoffMs).toISOString(),
        mercado: o.mercado || 'Over 1.5 Goles',
        cuota: cuota,
        modelProb: o.modelProb === undefined ? null : o.modelProb,
        edgePuntos: o.edgePuntos !== undefined ? o.edgePuntos : edgePuntos,
        justificacion: o.justificacion || 'prueba',
        modoAnalisis: o.modelProb !== undefined ? 'modelo-ia' : 'solo-cuotas',
        lineas: o.lineas || {
            '1.5': ln(o.cuotaO15 || 1.5, 2.6, o.tip15, o.tipProb15),
            '2.5': ln(o.cuotaO25 || 2.7, 1.45, o.tip25, o.tipProb25)
        },
        jugado: o.jugado || false
    };
}

function producto(picks) {
    return Math.round(picks.reduce((acc, p) => acc * p.cuota, 1) * 100) / 100;
}

// Replica la convencion del cliente sobre el resultado ya construido:
//   cuotaBoosted = round2(cuotaTotal * (1 + boost/100))
//   cuotaModeloTotal = round2(prod(100/probPct))
//   edgeTotal = round1((cuotaBoosted - cuotaModeloTotal) * 100)
function esperarEdgeTotal(r) {
    const boost = Number.isFinite(r.boostPct) ? r.boostPct : 0;
    const cuotaBoosted = Math.round(r.cuotaTotal * (1 + boost / 100) * 100) / 100;
    const cuotaModeloTotal = Math.round(r.picks.reduce((acc, p) => acc * (100 / p.probPct), 1) * 100) / 100;
    return Math.round((cuotaBoosted - cuotaModeloTotal) * 1000) / 10;
}

console.log('\n--- 1) BANDAS DE CUOTA CORRECTAS (picks con IA, edgeTotal > 0) ---');
{
    const pool = [
        fixture({ clave: 'a', nombre: 'A vs B', cuota: 1.25, modelProb: 92 }),
        fixture({ clave: 'b', nombre: 'C vs D', cuota: 1.55, modelProb: 84 }),
        fixture({ clave: 'c', nombre: 'E vs F', cuota: 1.80, modelProb: 78 }),
        fixture({ clave: 'd', nombre: 'G vs H', cuota: 1.35, modelProb: 88 })
    ];
    const bajo = construirParlayRiesgo(pool, 'bajo', NOW);
    ok(bajo.estado === 'ok', 'riesgo BAJO produce combinada', bajo.estado + ' | ' + (bajo.motivo || ''));
    if (bajo.estado === 'ok') {
        ok(bajo.cuotaTotal < 2.00, 'cuota BAJO cae en su banda (< 2.00)', bajo.cuotaTotal);
        ok(bajo.cuotaTotal === producto(bajo.picks), 'cuota BAJO = producto exacto de las cuotas', bajo.cuotaTotal);
        ok(bajo.probabilidadReal > 0 && bajo.probabilidadReal <= 100, 'probabilidad combinada en rango (0-100]', bajo.probabilidadReal + '%');
        ok(bajo.picks.every(p => Number.isFinite(p.probPct) && p.probPct > 0), 'NINGUN pick con probPct nula (adios null%)');
        ok(bajo.picks.every(p => p.probBase === 'modelo-ia') && bajo.probBase === 'modelo-ia', 'probBase etiquetada como modelo-ia');
        ok(bajo.picks.every(p => Number.isFinite(p.edgePuntos) && p.edgePuntos > 0),
            'todos los picks de la combinada tienen edgePuntos > 0',
            bajo.picks.map(p => p.clave + ':' + p.edgePuntos).join(' '));
        ok(bajo.picks.every((p, i) => p.orden === i + 1), 'picks numerados en orden', '1..' + bajo.picks.length);

        // FÓRMULA DEL EDGE COMBINADA (con boost = 0 por defecto)
        const teo0 = esperarEdgeTotal(bajo);
        ok(bajo.edgeTotal === teo0 && Number.isFinite(bajo.edgeTotal),
            'edgeTotal = (cuotaBoosted - cuotaModeloTotal) * 100 (boost 0)', bajo.edgeTotal + ' vs ' + teo0);
        ok(bajo.edgeTotal > 0, 'solo hay combinada publicable si edgeTotal > 0', bajo.edgeTotal);
        ok(bajo.cuotaTotalBoosted === bajo.cuotaTotal, 'sin boost configurado la boosted es la propia cuota', bajo.cuotaTotalBoosted);
    }

    const medio = construirParlayRiesgo(pool, 'medio', NOW);
    ok(medio.estado === 'ok' && medio.cuotaTotal >= 2.00 && medio.cuotaTotal <= 3.00, 'cuota MEDIO cae en su banda (2.00-3.00)', medio.cuotaTotal);

    const alto = construirParlayRiesgo(pool, 'alto', NOW);
    ok(alto.estado === 'ok' && alto.cuotaTotal > 3.00, 'cuota ALTO cae en su banda (> 3.00)', alto.cuotaTotal);
}

console.log('\n--- 2) BOOST bet365: RATINGBET_COMBO_BOOST_PCT entra en la formula ---');
{
    const pool = [
        fixture({ clave: 'a', nombre: 'A vs B', cuota: 1.25, modelProb: 92 }),
        fixture({ clave: 'b', nombre: 'C vs D', cuota: 1.55, modelProb: 84 })
    ];
    delete process.env.RATINGBET_COMBO_BOOST_PCT;
    const sinBoost = construirParlayRiesgo(pool, 'bajo', NOW);
    const anterior = process.env.RATINGBET_COMBO_BOOST_PCT;
    process.env.RATINGBET_COMBO_BOOST_PCT = '5';
    try {
        ok(comboBoostPct() === 5, 'comboBoostPct lee el 5% del entorno', comboBoostPct());
        const conBoost = construirParlayRiesgo(pool, 'bajo', NOW);
        if (sinBoost.estado === 'ok' && conBoost.estado === 'ok') {
            ok(conBoost.boostPct === 5, 'el resultado declara boostPct = 5', conBoost.boostPct);
            ok(conBoost.cuotaTotalBoosted === Math.round(conBoost.cuotaTotal * 1.05 * 100) / 100,
                'cuotaBoosted = cuotaTotal * 1.05', conBoost.cuotaTotalBoosted + ' sobre ' + conBoost.cuotaTotal);
            const teo = esperarEdgeTotal(conBoost);
            ok(conBoost.edgeTotal === teo,
                'edgeTotal = (cuotaBoosted - cuotaModeloTotal) * 100 CON boost',
                conBoost.edgeTotal + ' vs ' + teo + ' (sin boost: ' + sinBoost.edgeTotal + ')');
            // El boost solo aporta cuotaTotal*boostPct/100 a la boosted (redondeada
            // a 2 decimales), asi que el edge combinada sube esa misma cantidad.
            const boostedTeo = Math.round(conBoost.cuotaTotal * (1 + 5 / 100) * 100) / 100;
            const delta = conBoost.edgeTotal - sinBoost.edgeTotal;
            const deltaTeorico = (boostedTeo - conBoost.cuotaTotal) * 100;
            ok(Math.abs(delta - deltaTeorico) < 0.05,
                'el boost SUBE el edge combinada en la cuantia del propio boost',
                'delta ' + delta.toFixed(1) + ' pts vs ' + deltaTeorico.toFixed(2) + ' pts teoricos');
        } else {
            ok(false, 'la misma banda produce combinada con y sin boost',
                'sinBoost=' + sinBoost.estado + ' conBoost=' + conBoost.estado);
        }
    } finally {
        if (anterior === undefined) delete process.env.RATINGBET_COMBO_BOOST_PCT;
        else process.env.RATINGBET_COMBO_BOOST_PCT = anterior;
    }
}

console.log('\n--- 3) SIN IA: tip/mercado no inventa modelo ni combinada ---');
{
    const pool = [
        fixture({ clave: 't1', nombre: 'A vs B', tip15: 'O1.5', tipProb15: 84, cuotaO15: 1.30 }),
        fixture({ clave: 't2', nombre: 'C vs D', tip15: 'O1.5', tipProb15: 80, cuotaO15: 1.40 }),
        fixture({ clave: 't3', nombre: 'E vs F', tip15: 'U1.5', tipProb15: 75, cuotaO15: 1.60 })
    ];
    // (a) seleccionDeFixture en ruta tip: probBase real, edgePuntos NULL (no hay modelo)
    const selTip = seleccionDeFixture(pool[0]);
    ok(selTip.probBase === 'analisis-tip' && selTip.probPct === 84, 'seleccion usa tip + prob del proveedor', selTip.probPct + '%');
    ok(selTip.mercado === 'Over 1.5 Goles', 'mercado del tip O1.5 correcto', selTip.mercado);
    ok(selTip.edgePuntos === null, 'ruta tip: edgePuntos NULL (el tip NO es un modelo)', selTip.edgePuntos);
    ok(selTip.modelProb === undefined, 'ruta tip: no expone modelProb disfrazado');

    // (b) pool SOLO con tips -> sin IA -> sin-combinada (motivo auditable, sin cifras)
    const bajo = construirParlayRiesgo(pool, 'bajo', NOW);
    ok(bajo.estado === 'sin-combinada',
        'pool sin IA -> sin-combinada (solo se publican picks modelo-ia)',
        bajo.estado + ' | ' + (bajo.motivo || ''));
    ok(bajo.cuotaTotal === null && bajo.probabilidadReal === null && bajo.edgeTotal === null,
        'sin cifras fabricadas (cuota/prob/edge en null)', String(bajo.cuotaTotal) + '/' + String(bajo.edgeTotal));
    ok((bajo.picks || []).length === 0, 'ningun pick sin IA entra en la combinada');
    ok(!bajo.motivo || /^(pocos-partidos-validos|sin-combinacion-en-la-banda|sin-edge-positivo)/.test(String(bajo.motivo)),
        'motivo auditable de por que no hay combinada', bajo.motivo);
    // Los destacados tampoco pueden traer picks sin IA
    ok((bajo.destacados || []).every(d => d.probBase === 'modelo-ia' && Number.isFinite(d.edgePuntos) && d.edgePuntos > 0),
        'los destacados solo pueden ser picks IA con edge > 0',
        (bajo.destacados || []).map(d => d.clave + ':' + d.probBase).join(' ') || 'ninguno');

    // (c) pool MIXTO: solo los picks IA con edge > 0 pueden salir
    const mixto = [
        fixture({ clave: 'mix-ia', nombre: 'IA vs B', cuota: 1.30, modelProb: 90 }),          // edge +7.7
        fixture({ clave: 'mix-tip', nombre: 'C vs D', tip15: 'O1.5', tipProb15: 84, cuotaO15: 1.30 }),
        fixture({ clave: 'mix-mj', nombre: 'E vs F', cuotaO15: 1.33 })
    ];
    const rMixto = construirParlayRiesgo(mixto, 'bajo', NOW);
    ok(rMixto.estado === 'sin-combinada',
        'pool mixto con UN solo pick IA no alcanza el minimo -> sin-combinada',
        rMixto.estado + ' | ' + (rMixto.motivo || ''));
    const destMixto = rMixto.destacados || [];
    ok(destMixto.length === 1 && destMixto[0].clave === 'mix-ia',
        'el unico destacado posible es el pick IA con edge > 0',
        destMixto.map(d => d.clave).join(',') || 'ninguno');
}

console.log('\n--- 4) FALLBACK MERCADO JUSTO (sin IA y sin tip): edgePuntos NULL ---');
{
    const pool = [
        fixture({ clave: 'm1', cuotaO15: 1.22, nombre: 'A vs B' }),
        fixture({ clave: 'm2', cuotaO15: 1.28, nombre: 'C vs D' }),
        fixture({ clave: 'm3', cuotaO15: 1.33, nombre: 'E vs F' })
    ];
    const sel = seleccionDeFixture(pool[0]);
    ok(sel.probBase === 'mercado-justo', 'fallback etiquetado mercado-justo', sel.probBase);
    ok(sel.probPct > 50 && sel.probPct < 100, 'prob justa derivada de la cuota real', sel.probPct + '%');
    ok(sel.edgePuntos === null, 'ruta mercado-justo: edgePuntos NULL (no se inventa modelo)', sel.edgePuntos);

    const r = construirParlayRiesgo(pool, 'bajo', NOW);
    ok(r.estado === 'sin-combinada' && r.cuotaTotal === null && r.probabilidadReal === null,
        'solo con mercado justo NO se ofrece combinada (sin IA no hay pick publicable)',
        r.estado + ' | ' + r.motivo);
    ok((r.destacados || []).length === 0, 'y sin IA no hay destacados que publicar');
}

console.log('\n--- 5) UNICAMENTE IA CON EDGE > 0 ENTRA EN LA COMBINADA ---');
{
    // Edge positivo: cuota 1.30 > 100/90 = 1.11  -> +18.9 pts
    const positivo = fixture({ clave: 'pos', cuota: 1.30, modelProb: 90 });
    // Edge negativo: cuota 1.20 < 100/85 = 1.18 ... no: 1.20 > 1.176 -> +2.3; usamos 1.15 < 1.176
    const negativo = fixture({ clave: 'neg', cuota: 1.15, modelProb: 85 }); // 100/85 = 1.176 -> edge -2.6
    ok(positivo.edgePuntos > 0, 'el pick A tiene edgePuntos > 0', positivo.edgePuntos);
    ok(negativo.edgePuntos < 0, 'el pick B tiene edgePuntos < 0', negativo.edgePuntos);

    const soloPositivo = construirParlayRiesgo([positivo, fixture({ clave: 'pos2', cuota: 1.35, modelProb: 88 })], 'bajo', NOW);
    ok(soloPositivo.estado === 'ok' && soloPositivo.picks.every(p => p.edgePuntos > 0),
        'con picks IA de edge positivo SI hay combinada', soloPositivo.estado);

    const conNegativo = construirParlayRiesgo([negativo, fixture({ clave: 'pos3', cuota: 1.35, modelProb: 88 })], 'bajo', NOW);
    const clavesNeg = (conNegativo.picks || []).map(p => p.clave);
    ok(clavesNeg.indexOf('neg') === -1,
        'un pick IA con edge NEGATIVO no puede entrar en la combinada',
        clavesNeg.join(',') || conNegativo.motivo);
}

console.log('\n--- 6) HONESTIDAD: sin combinada posible NO se inventa nada ---');
{
    const vacio = construirParlayRiesgo([], 'medio', NOW);
    ok(vacio.estado === 'sin-combinada', 'pool vacio -> sin-combinada');
    ok(vacio.cuotaTotal === null && vacio.probabilidadReal === null, 'sin cifras fabricadas (todo null)');
    ok(String(vacio.motivo).indexOf('pocos-partidos-validos') === 0, 'motivo auditable', vacio.motivo);

    const imposibles = [
        fixture({ clave: 'i1', cuota: 2.6, cuotaO15: 2.6, modelProb: 45 }),
        fixture({ clave: 'i2', cuota: 2.8, cuotaO15: 2.8, modelProb: 42 })
    ];
    const bajo = construirParlayRiesgo(imposibles, 'bajo', NOW);
    ok(bajo.estado === 'sin-combinada' && bajo.cuotaTotal !== 3.15, 'imposible BAJO: NO se fuerza cuota (adios 3.15 falso)');
    ok(String(bajo.motivo || '').indexOf('sin-combinacion-en-la-banda') === 0, 'motivo explica la banda', bajo.motivo);

    const medio = construirParlayRiesgo(imposibles, 'medio', NOW);
    ok(medio.estado === 'sin-combinada' || (medio.cuotaTotal >= 2.00 && medio.cuotaTotal <= 3.00), 'MEDIO: o banda real o sin-combinada', medio.cuotaTotal);
}

console.log('\n--- 7) FILTRO TEMPORAL: solo futuros ---');
{
    const pool = [
        fixture({ clave: 'p1', cuota: 1.25, modelProb: 92, offsetMin: -60 }),   // ya empezo
        fixture({ clave: 'p2', cuota: 1.30, modelProb: 90, offsetMin: 120 }),   // futuro
        fixture({ clave: 'p3', cuota: 1.30, modelProb: 90, offsetMin: 240 }),   // futuro
        fixture({ clave: 'p4', cuota: 1.35, modelProb: 88, offsetMin: 360 })    // futuro
    ];
    const r = construirParlayRiesgo(pool, 'bajo', NOW);
    ok(r.estado === 'ok' && r.picks.every(p => p.clave !== 'p1'), 'el partido en juego NO entra en la combinada', r.estado);
}

console.log('\n--- 8) NIVELES DESCONOCIDOS: cae a MEDIO de forma segura ---');
{
    const pool = [
        fixture({ clave: 'x1', cuota: 1.50, modelProb: 88 }),
        fixture({ clave: 'x2', cuota: 1.60, modelProb: 85 })
    ];
    const r = construirParlayRiesgo(pool, 'nivel-inexistente', NOW);
    ok(r.riskLevel === 'medio', 'nivel invalido -> medio', r.riskLevel);
}

console.log('\n=============================================================');
console.log(' RESULTADO: ' + pasan + '/' + (pasan + fallan) + ' COMPROBACIONES PASAN');
console.log('=============================================================');
process.exit(fallan === 0 ? 0 : 1);
