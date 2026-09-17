const fs = require('fs');
const path = require('path');

const matches = JSON.parse(fs.readFileSync(path.join(__dirname, 'parsed_matches.json'), 'utf-8'));

// Modelo cualitativo-cuantitativo de probabilidad real de goles
function estimateRealProbability(match) {
    const { liga, local, visitante, linea, cuotaOver, cuotaUnder, probRBOver } = match;

    // Factores base por tipo de liga (promedio histórico de goles)
    let baseProb15 = 0.78; // Promedio general de Over 1.5 en fútbol profesional
    let baseProb25 = 0.52; // Promedio general de Over 2.5 en fútbol profesional

    const leagueUpper = liga.toUpperCase();

    // Ajustes por estilo de liga
    if (leagueUpper.includes('PREMIER LEAGUE') || leagueUpper.includes('BUNDESLIGA') || leagueUpper.includes('NETHERLANDS') || leagueUpper.includes('DENMARK') || leagueUpper.includes('BELGIUM')) {
        baseProb15 += 0.05;
        baseProb25 += 0.08;
    } else if (leagueUpper.includes('LALIGA') || leagueUpper.includes('SERIE A') || leagueUpper.includes('ARGENTINA') || leagueUpper.includes('BRAZIL') || leagueUpper.includes('ALBANIA')) {
        baseProb15 -= 0.04;
        baseProb25 -= 0.06;
    }

    // Ajustes por equipos de alto perfil ofensivo vs defensivo
    const highScorers = ['BAYERN MUNICH', 'MANCHESTER CITY', 'BARCELONA', 'PARIS SAINT-GERMAIN', 'REAL MADRID', 'PSV EINDHOVEN', 'FEYENOORD', 'LIVERPOOL', 'BRIGHTON', 'CLUB BRUGGE', 'BENFICA', 'SPORTING CP'];
    const lowScorers = ['GETAFE', 'ATLETICO MADRID', 'LECCE', 'LOS ANDES', 'ACASSUSO', 'LACI', 'TIGRE', 'SARMIENTO', 'MONZA'];

    const localUpper = local.toUpperCase();
    const visUpper = visitante.toUpperCase();

    let teamAdj15 = 0;
    let teamAdj25 = 0;

    if (highScorers.some(t => localUpper.includes(t) || visUpper.includes(t))) {
        teamAdj15 += 0.08;
        teamAdj25 += 0.12;
    }
    if (lowScorers.some(t => localUpper.includes(t) || visUpper.includes(t))) {
        teamAdj15 -= 0.06;
        teamAdj25 -= 0.10;
    }

    // Señal implícita de RatingBet frente al modelo
    const rbProbDecimal = probRBOver / 100;
    
    // Estimación combinada ponderada (70% modelo contextual / 30% mercado)
    let realProbOver;
    if (linea === '1.5') {
        const rawProb = (baseProb15 + teamAdj15) * 0.70 + rbProbDecimal * 0.30;
        realProbOver = Math.min(0.95, Math.max(0.40, rawProb));
    } else {
        const rawProb = (baseProb25 + teamAdj25) * 0.70 + rbProbDecimal * 0.30;
        realProbOver = Math.min(0.90, Math.max(0.25, rawProb));
    }

    const edge = realProbOver - rbProbDecimal;
    const edgePct = edge * 100;

    // Validación y confianza
    let confianza = 'MEDIA';
    let clasificacion = 'SIN_VALOR';

    if (edgePct >= 6) {
        if (edgePct > 20) {
            clasificacion = 'POSIBLE_ERROR';
            confianza = 'BAJA';
        } else if (highScorers.some(t => localUpper.includes(t) || visUpper.includes(t)) || leagueUpper.includes('BUNDESLIGA') || leagueUpper.includes('NETHERLANDS')) {
            clasificacion = 'EDGE_FUERTE';
            confianza = 'ALTA';
        } else if (edgePct >= 10) {
            clasificacion = 'EDGE_MODERADO';
            confianza = 'MEDIA';
        } else {
            clasificacion = 'EDGE_ESPECULATIVO';
            confianza = 'BAJA';
        }
    }

    return {
        ...match,
        probRealPct: Math.round(realProbOver * 10000) / 100,
        edgePct: Math.round(edgePct * 100) / 100,
        confianza,
        clasificacion
    };
}

const analyzedMatches = matches.map(estimateRealProbability);
const valueMatches = analyzedMatches.filter(m => m.edgePct >= 6.0).sort((a, b) => b.edgePct - a.edgePct);

console.log(`Total de partidos analizados: ${analyzedMatches.length}`);
console.log(`Partidos con EDGE > 6%: ${valueMatches.length}`);

fs.writeFileSync(path.join(__dirname, 'value_matches.json'), JSON.stringify(valueMatches, null, 2), 'utf-8');
