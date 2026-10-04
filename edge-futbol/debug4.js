const fs = require('fs');
const path = require('path');

const rawFile = path.join(__dirname, 'ratingbet_raw_data.txt');
const rawText = fs.readFileSync(rawFile, 'utf-8');
const rawLines = rawText.split('\n');

for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].replace('\r', '').trim();
    if (/^\d{2}:\d{2}$/.test(line)) {
        console.log(`Checking match at index ${i}: ${line}`);
        const home = (rawLines[i + 1] || '').replace('\r', '').trim();
        const away = (rawLines[i + 3] || '').replace('\r', '').trim();
        const cuotaOver = parseFloat((rawLines[i + 5] || '').replace('\r', '').trim());
        const cuotaUnder = parseFloat((rawLines[i + 7] || '').replace('\r', '').trim());

        console.log(' home:', JSON.stringify(home), 'length:', home.length);
        console.log(' away:', JSON.stringify(away), 'length:', away.length);
        console.log(' cuotaOver:', cuotaOver);
        console.log(' cuotaUnder:', cuotaUnder);
        console.log(' cond1:', !isNaN(cuotaOver));
        console.log(' cond2:', !isNaN(cuotaUnder));
        console.log(' cond3:', home.length > 0);
        console.log(' cond4:', away.length > 0);
        console.log(' cond5:', home !== '-');
        console.log(' cond6:', away !== '-');
        break;
    }
}
