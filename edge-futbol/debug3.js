const fs = require('fs');
const path = require('path');

const rawText = fs.readFileSync(path.join(__dirname, 'ratingbet_raw_data.txt'), 'utf-8');
const rawLines = rawText.split('\n');

for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].replace('\r', '').trim();
    if (/^\d{2}:\d{2}$/.test(line)) {
        console.log(`\nMatch candidate at line ${i + 1}: ${line}`);
        const home = (rawLines[i + 1] || '').replace('\r', '').trim();
        const away = (rawLines[i + 3] || '').replace('\r', '').trim();
        const cOverStr = (rawLines[i + 5] || '').replace('\r', '').trim();
        const cOver = parseFloat(cOverStr);
        const cUnderStr = (rawLines[i + 7] || '').replace('\r', '').trim();
        const cUnder = parseFloat(cUnderStr);

        console.log(`  home: '${home}'`);
        console.log(`  away: '${away}'`);
        console.log(`  cOverStr: '${cOverStr}' -> float: ${cOver}`);
        console.log(`  cUnderStr: '${cUnderStr}' -> float: ${cUnder}`);
        console.log(`  isNaN cOver: ${isNaN(cOver)}, isNaN cUnder: ${isNaN(cUnder)}`);
        break;
    }
}
