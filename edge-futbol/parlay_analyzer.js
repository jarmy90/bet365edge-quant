const fs = require('fs');
const path = require('path');

const parsedMatches = JSON.parse(fs.readFileSync(path.join(__dirname, 'parsed_matches.json'), 'utf-8'));

// Grandes Ligas + MODO PARON SELECCIONES (cuando no hay top, usa break con penalizacion)
const TOP_LEAGUES_PATTERNS = [
    'ENGLISH PREMIER LEAGUE', 'ENGLISH CHAMPIONSHIP',
    'LALIGA SPAIN', 'SEGUNDA DIVISION', 'LALIGA 2',
    'SERIE A ITALY', 'SERIE B ITALY',
    'BUNDESLIGA GERMANY', '2. BUNDESLIGA',
    'LIGUE 1 FRANCE', 'LIGUE 2 FRANCE',
    'PRIMEIRA LIGA PORTUGAL',
    'EREDIVISIE NETHERLANDS',
    'PRO LEAGUE BELGIUM',
    'LIGA PROFESIONAL ARGENTINA',
    'SERIE A BRAZIL'
];
// Ligas break: liquidez aceptable cuando no hay top (Champions, MLS, Championship ya esta arriba)
const BREAK_LEAGUES_PATTERNS = [
    'CHAMPIONS LEAGUE', 'EUROPA LEAGUE', 'CONFERENCE LEAGUE',
    'EFL CHAMPIONSHIP', 'MLS USA', '3. LIGA GERMANY',
    '1. DIVISJON NORWAY', 'ELITESERIEN NORWAY',
    'PRIMERA A COLOMBIA', 'BETWAY PREMIERSHIP'
];

function isTopTierLeague(league) {
    const l = (league || '').toUpperCase();
    return TOP_LEAGUES_PATTERNS.some(p => l.includes(p));
}
function isBreakLeague(league) {
    const l = (league || '').toUpperCase();
    return BREAK_LEAGUES_PATTERNS.some(p => l.includes(p));
}

// Función de Validación Temporal Crítica (Margen de seguridad: 2.5 horas)
function getFutureMatchesPool(match) {
    const { hora } = match;
    if (!hora || !/^\d{2}:\d{2}$/.test(hora)) return true;

    const [matchH, matchM] = hora.split(':').map(Number);
    const now = new Date();
    const currentH = now.getHours();
    const currentM = now.getMinutes();

    const matchTotalMin = matchH * 60 + matchM;
    const currentTotalMin = currentH * 60 + currentM;

    // Margen de seguridad: 60 min en modo break, 150 normal
    const safetyMarginMin = process.env.BREAK_MODE === '1' ? 60 : 150;

    if (matchTotalMin <= currentTotalMin + safetyMarginMin) {
        console.log(`[VALIDACIÓN TEMPORAL] Descartado partido pasado o cercano (<2.5h): ${match.local} vs ${match.visitante} (${hora})`);
        return false;
    }
    return true;
}

// Analizador de ESTRATEGIA COMBINADA PARLAY (+EV Cuotas Bajas / Alta Probabilidad)
function analyzeAccumulatorEV(match) {
    const { liga, local, visitante, linea, cuotaOver, cuotaUnder, probRBOver } = match;

    const isBreak = isBreakLeague(liga);
    if (!isTopTierLeague(liga) && !isBreak) return null;

    // Rango de cuotas: 1.15-1.60 en break, 1.18-1.48 en normal
    const lo = process.env.BREAK_MODE === '1' ? 1.15 : 1.18;
    const hi = process.env.BREAK_MODE === '1' ? 1.60 : 1.48;
    if (cuotaOver < lo || cuotaOver > hi) return null;

    const rbProbDecimal = probRBOver / 100;
    const lUpper = liga.toUpperCase();
    const locUpper = local.toUpperCase();
    const visUpper = visitante.toUpperCase();

    // Probabilidad Base Institucional (Alta Seguridad)
    let baseProb = (linea === '1.5') ? 0.81 : 0.62;

    // Ajustes por Liga
    if (lUpper.includes('BUNDESLIGA') || lUpper.includes('NETHERLANDS') || lUpper.includes('PREMIER LEAGUE') || lUpper.includes('BELGIUM')) {
        baseProb += (linea === '1.5') ? 0.04 : 0.06;
    } else if (lUpper.includes('LALIGA') || lUpper.includes('SERIE A') || lUpper.includes('ARGENTINA')) {
        baseProb -= (linea === '1.5') ? 0.03 : 0.04;
    }

    // Equipos ofensivos
    const eliteTeams = ['BAYERN MUNICH', 'MANCHESTER CITY', 'BARCELONA', 'PARIS SAINT-GERMAIN', 'REAL MADRID', 'PSV EINDHOVEN', 'FEYENOORD', 'LIVERPOOL', 'BRIGHTON', 'CLUB BRUGGE', 'BENFICA', 'SPORTING CP', 'DORTMUND', 'LEVERKUSEN', 'INTER', 'ATALANTA', 'RB LEIPZIG', 'LENS'];

    let teamAdj = 0;
    if (eliteTeams.some(t => locUpper.includes(t) || visUpper.includes(t))) {
        teamAdj += (linea === '1.5') ? 0.04 : 0.07;
    }

    // Ponderación escéptica (70% Modelo / 30% Cuota RB)
    const probRealDecimal = Math.min(0.95, (baseProb + teamAdj) * 0.70 + rbProbDecimal * 0.30);
    const probRealPct = Math.round(probRealDecimal * 10000) / 100;

    // Exigimos EDGE positivo (1.0 en break, 2.5 normal). Penaliza break -1.5pts.
    const minEdge = process.env.BREAK_MODE === '1' ? 1.0 : 2.5;
    let edgePct = Math.round((probRealDecimal - rbProbDecimal) * 10000) / 100;
    if (isBreak && !TOP_LEAGUES_PATTERNS.some(p => lUpper.includes(p))) edgePct -= 1.5;
    if (edgePct < minEdge) return null;

    let confianza = (probRealPct >= 80.0) ? 'ALTA' : 'MEDIA';

    return {
        ...match,
        probRealPct,
        edgePct,
        confianza,
        clasificacion: (confianza === 'ALTA') ? 'COMBINADA_TOP' : 'COMBINADA_MODERADA',
        parlayScore: Math.round((probRealPct * 0.5 + edgePct * 5) * 100) / 100
    };
}

const parlayResults = parsedMatches
    .filter(getFutureMatchesPool)
    .map(analyzeAccumulatorEV)
    .filter(m => m !== null)
    .sort((a, b) => b.parlayScore - a.parlayScore);

// SELECCIONAR EXACTAMENTE LOS MEJORES 2 A 3 PARTIDOS
const topParlayMatches = parlayResults.slice(0, 3).map(m => ({
    ...m,
    hora: `⏱️ Hoy ${m.hora}`
}));

// Calcular cuota total de la combinada y probabilidad acumulada
let totalQuota = 1.0;
let totalProbReal = 1.0;
let totalProbRB = 1.0;

topParlayMatches.forEach(m => {
    totalQuota *= m.cuotaOver;
    totalProbReal *= (m.probRealPct / 100);
    totalProbRB *= (m.probRBOver / 100);
});

console.log(`Partidos candidatos de Grandes Ligas hallados: ${parlayResults.length}`);
console.log('\n--- SELECCIÓN COMBINADA MÁX 3 PARTIDOS (CUOTA FINAL ~2.00 A 3.00) ---');
console.log(JSON.stringify(topParlayMatches, null, 2));

console.log(`\nCuota Total Combinada: ${totalQuota.toFixed(2)}`);
console.log(`Probabilidad Implícita Casa (RatingBet): ${(totalProbRB * 100).toFixed(2)}%`);
console.log(`Probabilidad Real Estimada (Modelo): ${(totalProbReal * 100).toFixed(2)}%`);
console.log(`EDGE TOTAL COMBINADA: +${((totalProbReal - totalProbRB) * 100).toFixed(2)}%`);

const advertencia = topParlayMatches.length === 0 ? "⚠️ ADVERTENCIA: No hay partidos futuros disponibles en este momento. Los partidos mostrados anteriormente ya han comenzado o finalizado. Intente más tarde." : null;

fs.writeFileSync(path.join(__dirname, 'parlay_matches.json'), JSON.stringify({
    selecciones: topParlayMatches,
    cuotaTotal: topParlayMatches.length > 0 ? Math.round(totalQuota * 100) / 100 : 1.0,
    probRealCombinadaPct: topParlayMatches.length > 0 ? Math.round(totalProbReal * 10000) / 100 : 0,
    probRBCombinadaPct: topParlayMatches.length > 0 ? Math.round(totalProbRB * 10000) / 100 : 0,
    edgeTotalPct: topParlayMatches.length > 0 ? Math.round((totalProbReal - totalProbRB) * 10000) / 100 : 0,
    advertenciaTemporal: advertencia
}, null, 2), 'utf-8');
