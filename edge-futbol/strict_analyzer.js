const fs = require('fs');
const path = require('path');

const parsedMatches = JSON.parse(fs.readFileSync(path.join(__dirname, 'parsed_matches.json'), 'utf-8'));

// Selección estricta de Grandes Ligas disponibles en Betfair y Polymarket España
// (Inglaterra 1 y 2, España 1 y 2, Italia 1 y 2, Alemania 1 y 2, Francia 1 y 2, Holanda 1, Portugal 1, Bélgica 1, Argentina 1, Brasil 1)
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

// Algoritmo institucional ajustado para Grandes Ligas
function calculateStrictEV(match) {
    const { liga, local, visitante, linea, cuotaOver, cuotaUnder, probRBOver } = match;

    if (!isTopTierLeague(liga)) return null;

    const rbProbDecimal = probRBOver / 100;
    const lUpper = liga.toUpperCase();
    const locUpper = local.toUpperCase();
    const visUpper = visitante.toUpperCase();

    // Probabilidad Base
    let baseProb = (linea === '1.5') ? 0.77 : 0.51;

    // Ajustes de Liga
    if (lUpper.includes('BUNDESLIGA') || lUpper.includes('NETHERLANDS') || lUpper.includes('PREMIER LEAGUE') || lUpper.includes('BELGIUM')) {
        baseProb += (linea === '1.5') ? 0.04 : 0.07;
    } else if (lUpper.includes('LALIGA') || lUpper.includes('SERIE A') || lUpper.includes('ARGENTINA')) {
        baseProb -= (linea === '1.5') ? 0.03 : 0.05;
    }

    // Ajustes por Equipos Top / Ofensivos
    const eliteTeams = ['BAYERN MUNICH', 'MANCHESTER CITY', 'BARCELONA', 'PARIS SAINT-GERMAIN', 'REAL MADRID', 'PSV EINDHOVEN', 'FEYENOORD', 'LIVERPOOL', 'BRIGHTON', 'CLUB BRUGGE', 'BENFICA', 'SPORTING CP', 'DORTMUND', 'LEVERKUSEN', 'INTER', 'ATALANTA', 'RB LEIPZIG'];
    const defensiveTeams = ['GETAFE', 'ATLETICO MADRID', 'LECCE', 'TIGRE', 'SARMIENTO', 'JUVENTUS', 'MONZA', 'DEPORTIVO DE A CORUNA'];

    let teamAdj = 0;
    if (eliteTeams.some(t => locUpper.includes(t) || visUpper.includes(t))) {
        teamAdj += (linea === '1.5') ? 0.06 : 0.10;
    }
    if (defensiveTeams.some(t => locUpper.includes(t) || visUpper.includes(t))) {
        teamAdj -= (linea === '1.5') ? 0.05 : 0.08;
    }

    // Estimación escéptica (75% Modelo / 25% Cuota RB)
    const probRealDecimal = (baseProb + teamAdj) * 0.75 + rbProbDecimal * 0.25;
    const probRealPct = Math.round(probRealDecimal * 10000) / 100;

    // CÁLCULO DEL EDGE
    const edgePct = Math.round((probRealDecimal - rbProbDecimal) * 10000) / 100;

    // Filtros estrictos de calidad:
    // 1. EDGE >= 6.0% (Mínimo exigido)
    // 2. Cuotas viables en mercado profesional:
    //    - Over 1.5: cuota >= 1.15 y <= 1.85 (evitar <1.15 donde no hay valor real en Betfair)
    //    - Over 2.5: cuota >= 1.40 y <= 2.80
    if (edgePct < 6.0 || edgePct > 18.0) return null;
    if (linea === '1.5' && (cuotaOver < 1.15 || cuotaOver > 1.85)) return null;
    if (linea === '2.5' && (cuotaOver < 1.40 || cuotaOver > 2.80)) return null;

    let confianza = 'MEDIA';
    if (edgePct >= 8.5 && eliteTeams.some(t => locUpper.includes(t) || visUpper.includes(t))) {
        confianza = 'ALTA';
    }

    let clasificacion = (confianza === 'ALTA') ? 'EDGE_FUERTE' : 'EDGE_MODERADO';

    return {
        ...match,
        probRealPct,
        edgePct,
        confianza,
        clasificacion,
        score: Math.round((edgePct + (confianza === 'ALTA' ? 4 : 0)) * 100) / 100
    };
}

const topResults = parsedMatches
    .map(calculateStrictEV)
    .filter(m => m !== null)
    .sort((a, b) => b.score - a.score);

// MÁXIMO 6 PARTIDOS SELECCIONADOS
const max6Matches = topResults.slice(0, 6);

console.log(`Partidos de Grandes Ligas que superan el filtro estricto +EV: ${topResults.length}`);
console.log('\n--- SELECCIÓN TOP MÁXIMO 6 PARTIDOS ---');
console.log(JSON.stringify(max6Matches, null, 2));

fs.writeFileSync(path.join(__dirname, 'strict_top_matches.json'), JSON.stringify(max6Matches, null, 2), 'utf-8');
