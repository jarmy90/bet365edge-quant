const fs = require('fs');
const path = require('path');

const parsedMatches = JSON.parse(fs.readFileSync(path.join(__dirname, 'parsed_matches.json'), 'utf-8'));

// Grandes Ligas (Betfair y Polymarket España)
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

function isTopTierLeague(league) {
    const l = (league || '').toUpperCase();
    return TOP_LEAGUES_PATTERNS.some(p => l.includes(p));
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

    // Margen de seguridad: 2.5 horas = 150 minutos
    const safetyMarginMin = 150;

    if (matchTotalMin <= currentTotalMin + safetyMarginMin) {
        console.log(`[VALIDACIÓN TEMPORAL] Descartado partido pasado o cercano (<2.5h): ${match.local} vs ${match.visitante} (${hora})`);
        return false;
    }
    return true;
}

// Analizador de ESTRATEGIA COMBINADA PARLAY (+EV Cuotas Bajas / Alta Probabilidad)
function analyzeAccumulatorEV(match) {
    const { liga, local, visitante, linea, cuotaOver, cuotaUnder, probRBOver } = match;

    if (!isTopTierLeague(liga)) return null;

    // Rango de cuotas individuales ideales para armar una combinada de 2 o 3 partidos con cuota total entre 2.00 y 3.00:
    // Cuotas individuales entre 1.18 y 1.45 (Probabilidad Implícita: 69% a 85%)
    if (cuotaOver < 1.18 || cuotaOver > 1.48) return null;

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

    // CÁLCULO DEL EDGE INDIVIDUAL
    const edgePct = Math.round((probRealDecimal - rbProbDecimal) * 10000) / 100;

    // Exigimos EDGE positivo
    if (edgePct < 2.5) return null;

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
