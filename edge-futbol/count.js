const fs = require('fs');
const path = require('path');

const rawFile = path.join(__dirname, 'ratingbet_raw_data.txt');
const rawText = fs.readFileSync(rawFile, 'utf-8');
const rawLines = rawText.split('\n');

let count = 0;
for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].replace('\r', '').trim();
    if (/^\d{2}:\d{2}$/.test(line)) {
        count++;
    }
}
console.log('Matches with time pattern:', count);
