const fs = require('fs');
const path = require('path');

const valueMatches = JSON.parse(fs.readFileSync(path.join(__dirname, 'value_matches.json'), 'utf-8'));

// Filtrar por ligas conocidas con volumen de datos sólido
const topQualifying = valueMatches.filter(m => {
    return m.edgePct >= 6.0 && m.edgePct <= 20.0;
}).slice(0, 5);

console.log(JSON.stringify(topQualifying, null, 2));
