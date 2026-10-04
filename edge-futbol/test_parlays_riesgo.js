// TEST: motor de combinadas por nivel de riesgo (construirParlayRiesgo)
// Uso: node test_parlays_riesgo.js   (exit 0 = todo OK)
import {
    construirParlayRiesgo, seleccionDeFixture, BANDAS_RIESGO
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
    return {
        clave: o.clave || 'fx-' + Math.random().toString(36).slice(2),
        partido: o.nombre || 'Equipo A vs Equipo B',
        local: 'Equipo A', visitante: 'Equipo B',
        liga: 'Espana: LaLiga', ligaCorta: 'LaLiga',
        hora: '18:00', horaLabel: 'Hoy 15/09 - 18:00', dia: 'Hoy', fechaCorta: '15/09',
        kickoffMs: kickoffMs, kickoffIsoUtc: new Date(kickoffMs).toISOString(),
        mercado: o.mercado || 'Over 1.5 Goles',
        cuota: o.cuota !== undefined ? o.cuota : 1.5,
        modelProb: o.modelProb === undefined ? null : o.modelProb,
        edgePuntos: o.modelProb !== undefined ? (o.modelProb - 80) : null,
        justificacion: o.justificacion || 'prueba',
        modoAnalisis: o.modelProb !== undefined ? 'ia' : 'solo-cuotas',
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

console.log('\n--- 1) BANDAS DE CUOTA CORRECTAS (picks con IA) ---');
{
    const pool = [
        fixture({ clave: 'a', nombre: 'A vs B', cuota: 1.25, modelProb: 92 }),
        fixture({ clave: 'b', nombre: 'C vs D', cuota: 1.55, modelProb: 84 }),
        fixture({ clave: 'c', nombre: 'E vs F', cuota: 1.80, modelProb: 78 }),
        fixture({ clave: 'd', nombre: 'G vs H', cuota: 1.35, modelProb: 88 })
    ];
    const bajo = construirParlayRiesgo(pool, 'bajo', NOW);
    ok(bajo.estado === 'ok', 'riesgo BAJO produce combinada');
    ok(bajo.cuotaTotal < 2.00, 'cuota BAJO cae en su banda (< 2.00)', bajo.cuotaTotal);
    ok(bajo.cuotaTotal === producto(bajo.picks), 'cuota BAJO = producto exacto de las cuotas', bajo.cuotaTotal);

    const medio = construirParlayRiesgo(pool, 'medio', NOW);
    ok(medio.estado === 'ok' && medio.cuotaTotal >= 2.00 && medio.cuotaTotal <= 3.00, 'cuota MEDIO cae en su banda (2.00-3.00)', medio.cuotaTotal);

    const alto = construirParlayRiesgo(pool, 'alto', NOW);
    ok(alto.estado === 'ok' && alto.cuotaTotal > 3.00, 'cuota ALTO cae en su banda (> 3.00)', alto.cuotaTotal);

    ok(bajo.probabilidadReal > 0 && bajo.probabilidadReal <= 100, 'probabilidad combinada en rango (0-100]', bajo.probabilidadReal + '%');
    ok(bajo.picks.every(p => Number.isFinite(p.probPct) && p.probPct > 0), 'NINGUN pick con probPct nula (adios null%)');
    ok(bajo.picks.every(p => p.probBase === 'modelo-ia') && bajo.probBase === 'modelo-ia', 'probBase etiquetada como modelo-ia');
    ok(bajo.picks.every((p, i) => p.orden === i + 1), 'picks numerados en orden', '1..' + bajo.picks.length);
}

console.log('\n--- 2) MODO SIN IA: usa el tip de ratingbet, nunca inventa ---');
{
    const pool = [
        fixture({ clave: 't1', nombre: 'A vs B', tip15: 'O1.5', tipProb15: 84, cuotaO15: 1.30 }),
        fixture({ clave: 't2', nombre: 'C vs D', tip15: 'O1.5', tipProb15: 80, cuotaO15: 1.40 }),
        fixture({ clave: 't3', nombre: 'E vs F', tip15: 'U1.5', tipProb15: 75, cuotaO15: 1.60 })
    ];
    const sel = seleccionDeFixture(pool[0]);
    ok(sel.probBase === 'analisis-tip' && sel.probPct === 84, 'seleccion usa tip + prob del proveedor', sel.probPct + '%');
    ok(sel.mercado === 'Over 1.5 Goles', 'mercado del tip O1.5 correcto', sel.mercado);

    const bajo = construirParlayRiesgo(pool, 'bajo', NOW);
    ok(bajo.estado === 'ok' && bajo.cuotaTotal < 2.00, 'combinada BAJO sin IA tambien funciona', bajo.cuotaTotal);
    ok(bajo.picks.every(p => p.modelProb === null), 'modelProb queda null (no se disfraza de IA)');
    ok(bajo.probBase === 'analisis-tip' || bajo.probBase === 'mixta', 'probBase honra la procedencia', bajo.probBase);
}

console.log('\n--- 3) FALLBACK MERCADO JUSTO (sin IA y sin tip) ---');
{
    const pool = [
        fixture({ clave: 'm1', cuotaO15: 1.22, nombre: 'A vs B' }),
        fixture({ clave: 'm2', cuotaO15: 1.28, nombre: 'C vs D' }),
        fixture({ clave: 'm3', cuotaO15: 1.33, nombre: 'E vs F' })
    ];
    const sel = seleccionDeFixture(pool[0]);
    ok(sel.probBase === 'mercado-justo', 'fallback etiquetado mercado-justo', sel.probBase);
    ok(sel.probPct > 50 && sel.probPct < 100, 'prob justa derivada de la cuota real', sel.probPct + '%');
    // CONTRATO REAL DEL MOTOR (no un fallo): con probabilidades de MERCADO JUSTO
    // (margen de la casa eliminado) la cuota justa derivada SIEMPRE supera a la
    // cuota ofrecida, asi que el guardia de valor del motor
    // ("cuota total >= producto de cuotas implicitas por probabilidad") rechaza
    // cualquier combinada. El resultado honesto es 'sin-combinada' con motivo
    // auditable, nunca una cifra inventada.
    const r = construirParlayRiesgo(pool, 'bajo', NOW);
    ok(r.estado === 'sin-combinada' && r.cuotaTotal === null && r.probabilidadReal === null,
        'solo con mercado justo NO se ofrece combinada (no hay valor que vender)',
        r.estado + ' | ' + r.motivo);
    ok(/^sin-combinacion-en-la-banda/.test(String(r.motivo)), 'motivo auditable de la banda', r.motivo);

    // Y en cuanto un pick trae senal de valor real (tip por encima de la
    // implicita), la misma banda SI se llena: el guardia es un filtro de valor,
    // no una puerta cerrada.
    const conValor = [
        fixture({ clave: 'v1', cuotaO15: 1.22, tip15: 'O1.5', tipProb15: 90, nombre: 'A vs B' }),
        fixture({ clave: 'v2', cuotaO15: 1.28, tip15: 'O1.5', tipProb15: 85, nombre: 'C vs D' })
    ];
    const rv = construirParlayRiesgo(conValor, 'bajo', NOW);
    ok(rv.estado === 'ok' && rv.cuotaTotal < 2.00,
        'con un tip de valor la banda BAJO si produce combinada', rv.cuotaTotal);
    ok(Number.isFinite(rv.probabilidadReal) && rv.probabilidadReal > 0,
        'y con probabilidad real calculada (nunca null%)', rv.probabilidadReal + '%');
}

console.log('\n--- 4) HONESTIDAD: sin combinada posible NO se inventa nada ---');
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

console.log('\n--- 5) FILTRO TEMPORAL: solo futuros ---');
{
    const pool = [
        fixture({ clave: 'p1', cuota: 1.25, modelProb: 92, offsetMin: -60 }),   // ya empezo
        fixture({ clave: 'p2', cuota: 1.30, modelProb: 90, offsetMin: 120 }),   // futuro
        fixture({ clave: 'p3', cuota: 1.30, modelProb: 90, offsetMin: 240 }),   // futuro
        fixture({ clave: 'p4', cuota: 1.35, modelProb: 88, offsetMin: 360 })    // futuro
    ];
    const r = construirParlayRiesgo(pool, 'bajo', NOW);
    ok(r.estado === 'ok' && r.picks.every(p => p.clave !== 'p1'), 'el partido en juego NO entra en la combinada');
}

console.log('\n--- 6) NIVELES DESCONOCIDOS: cae a MEDIO de forma segura ---');
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