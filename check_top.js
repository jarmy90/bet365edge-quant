const fs = require('fs');
const path = require('path');

const parsedMatches = JSON.parse(fs.readFileSync(path.join(__dirname, 'parsed_matches.json'), 'utf-8'));

// Comprobar qué partidos de ligas top existen en parsed_matches
const topMatchesAll = parsedMatches.filter(m => {
    const l = m.liga.toUpperCase();
    return l.includes('PREMIER LEAGUE') || l.includes('LALIGA') || l.includes('BUNDESLIGA') || l.includes('SERIE A') || l.includes('LIGUE 1') || l.includes('EREDIVISIE') || l.includes('PRIMEIRA LIGA') || l.includes('PRO LEAGUE');
});

console.log('Total partidos en Ligas Top:', topMatchesAll.length);
topMatchesAll.slice(0, 10).forEach(m => {
    const rbProb = m.probRBOver / 100;
    console.log(`${m.local} vs ${m.visitante} (${m.liga}) | Linea: ${m.linea} | Cuota Over: ${m.cuotaOver} | ProbRB: ${m.probRBOver}%`);
});
