// Inspecciona como obtiene el worker el dataset de ratingbet (embebido vs remoto)
import fs from 'fs';
const t = fs.readFileSync('worker.js', 'utf8');
const lineas = t.split('\n');

console.log('=== ocurrencias (nº de linea) ===');
['RATINGBET_DATASET_URL', 'datasetCache', 'DATASET_CACHE_MS', 'ratingbet_fixtures_data', 'origenDataset', 'modoDataset', 'frescura']
    .forEach(s => {
        const idx = [];
        let i = -1;
        while ((i = t.indexOf(s, i + 1)) >= 0) idx.push(lineas.slice(0, i).join('\n').split('\n').length);
        console.log('  ' + s + ' -> ' + idx.length + (idx.length ? '  [' + idx.join(', ') + ']' : ''));
    });

const anchor = lineas.findIndex(l => l.includes('DATASET_CACHE_MS'));
const desde = Math.max(0, anchor - 8);
console.log('\n=== bloque del cargador de dataset (lineas ' + (desde + 1) + '-) ===');
console.log(lineas.slice(desde, desde + 95).map((l, n) => (desde + n + 1) + '| ' + l).join('\n'));