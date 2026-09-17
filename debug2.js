const fs = require('fs');
const path = require('path');

const rawText = fs.readFileSync(path.join(__dirname, 'ratingbet_raw_data.txt'), 'utf-8');
const lines = rawText.split('\n');

const timeIdx = 64; // Linea 65 es 0-indexed 64
console.log('line[64]:', JSON.stringify(lines[timeIdx]));
console.log('regex test:', /^\d{2}:\d{2}$/.test(lines[timeIdx].replace('\r', '').trim()));
