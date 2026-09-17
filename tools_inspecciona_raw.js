// Inspeccion del JSON RAW del scraper (ratingbet_fixtures.json)
// Uso: node tools_inspecciona_raw.js
import fs from 'fs';

const raw = JSON.parse(fs.readFileSync('ratingbet_fixtures.json', 'utf-8'));
console.log('Claves top-level:', Object.keys(raw).join(', '));
console.log('fuente:', raw.fuente);
console.log('meta:', JSON.stringify(raw.meta || {}).slice(0, 200));

const arr = raw.partidos || raw.PARTIDOS || [];
console.log('partidos:', arr.length);

const soloUna = [];
const incompletas = [];
arr.forEach(p => {
    const l15 = (p.lineas || {})['1.5'];
    const l25 = (p.lineas || {})['2.5'];
    if (l15 && !l25) soloUna.push({ p, cual: 'solo-1.5' });
    if (l25 && !l15) soloUna.push({ p, cual: 'solo-2.5' });
    ['1.5', '2.5'].forEach(k => {
        const l = (p.lineas || {})[k];
        if (l && (l.cuotaOver === null || l.cuotaOver === undefined || l.cuotaUnder === null || l.cuotaUnder === undefined ||
            l.cuotaOver <= 1 || l.cuotaUnder <= 1)) {
            incompletas.push({ p, k, l });
        }
    });
});

console.log('\nPartidos con SOLO una linea:', soloUna.length);
soloUna.forEach(({ p, cual }) =>
    console.log('  - [' + cual + '] ' + p.local + ' vs ' + p.visitante + ' | ' + p.liga + ' | jugado=' + p.jugado));

console.log('\nLineas con cuotas invalidas o ausentes:', incompletas.length);
incompletas.forEach(({ p, k, l }) =>
    console.log('  - [' + k + '] ' + p.local + ' vs ' + p.visitante + ' -> ' + JSON.stringify(l)));