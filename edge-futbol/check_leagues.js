const fs = require('fs');
const path = require('path');

const parsedMatches = JSON.parse(fs.readFileSync(path.join(__dirname, 'parsed_matches.json'), 'utf-8'));

// Mostrar las ligas unicas que hay en parsed_matches
const leagues = [...new Set(parsedMatches.map(m => m.liga))];
console.log('Total ligas parseadas:', leagues.length);
console.log('Ligas:', leagues.slice(0, 30));
