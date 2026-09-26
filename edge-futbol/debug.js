const fs = require('fs');
const path = require('path');

const rawText = fs.readFileSync(path.join(__dirname, 'ratingbet_raw_data.txt'), 'utf-8');
const lines = rawText.split('\n');

console.log('Total raw lines:', lines.length);

for (let i = 0; i < 150; i++) {
    const trimmed = lines[i].replace('\r', '').trim();
    if (/^\d{2}:\d{2}$/.test(trimmed)) {
        console.log(`Match time found at raw line ${i + 1}: '${trimmed}'`);
        for (let j = 0; j < 12; j++) {
            console.log(`  +${j}: '${(lines[i + j] || '').replace('\r', '').trim()}'`);
        }
        break;
    }
}
