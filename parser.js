const fs = require('fs');
const path = require('path');

const rawFile = path.join(__dirname, 'ratingbet_raw_data.txt');
const rawText = fs.readFileSync(rawFile, 'utf-8');
const rawLines = rawText.split('\n');

const matches = [];
let currentBlock = '1.5';
let currentLeague = 'LIGA NO ESPECIFICADA';

// ---- Sello de captura (imprescindible para no publicar partidos de ayer) ----
const capturaMatch = rawText.match(/^=== CAPTURA: (.+?) ===$/m);
let captura = { capturadoEn: null, capturadoEnMadrid: null, fechaMadrid: null, zonaHoraria: 'Europe/Madrid', tabHoy: null };
if (capturaMatch) {
    const linea = capturaMatch[1];
    captura.capturadoEn = (linea.match(/(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/) || [])[1] || null;
    captura.capturadoEnMadrid = (linea.match(/(\d{2}\/\d{2}\/\d{4} \d{2}:\d{2})/) || [])[1] || null;
    captura.fechaMadrid = (linea.match(/FECHA:\s*(\d{2}\/\d{2}\/\d{4})/) || [])[1] || null;
    const tab = (linea.match(/TAB_HOY:\s*(true|false)/i) || [])[1];
    captura.tabHoy = tab === undefined ? null : (tab.toLowerCase() === 'true');
}
console.log(`Sello de captura del raw: ${captura.capturadoEnMadrid || 'NO DISPONIBLE (ejecuta scraper.js de nuevo)'} | pestana HOY: ${captura.tabHoy}`);

for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].replace('\r', '').trim();

    if (line.includes('=== BLOQUE 1: OVER/UNDER 1.5 GOLES ===')) {
        currentBlock = '1.5';
        continue;
    }
    if (line.includes('=== BLOQUE 2: OVER/UNDER 2.5 GOLES ===')) {
        currentBlock = '2.5';
        continue;
    }

    // Cabecera de liga auténtica (contiene dos puntos y está en mayúsculas o con nombres de país)
    if (line.includes(':') && !line.includes('===') && !line.includes('Total') && !line.includes('Line') && !line.includes('Match') && !/^\d{2}:\d{2}$/.test(line)) {
        if (line === line.toUpperCase() || line.includes('LEAGUE') || line.includes('SPAIN') || line.includes('FRANCE') || line.includes('GERMANY')) {
            currentLeague = line;
        }
    }

    if (/^\d{2}:\d{2}$/.test(line)) {
        const time = line;
        const home = (rawLines[i + 1] || '').replace('\r', '').trim();
        const away = (rawLines[i + 3] || '').replace('\r', '').trim();
        const cuotaOver = parseFloat((rawLines[i + 5] || '').replace('\r', '').trim());
        const pctOver = (rawLines[i + 6] || '').replace('\r', '').trim();
        const cuotaUnder = parseFloat((rawLines[i + 7] || '').replace('\r', '').trim());
        const pctUnder = (rawLines[i + 8] || '').replace('\r', '').trim();
        const lineaGoles = (rawLines[i + 9] || '').replace('\r', '').trim();

        if (!isNaN(cuotaOver) && !isNaN(cuotaUnder) && home.length > 0 && away.length > 0 && home !== '-' && away !== '-') {
            const probRBOver = 1 / cuotaOver;
            const probRBUnder = 1 / cuotaUnder;
            const margen = probRBOver + probRBUnder;

            matches.push({
                liga: currentLeague,
                hora: time,
                capturadoEn: captura.capturadoEn,
                fechaCaptura: captura.fechaMadrid,
                tabHoy: captura.tabHoy,
                local: home,
                visitante: away,
                linea: lineaGoles.includes('1.5') ? '1.5' : (lineaGoles.includes('2.5') ? '2.5' : currentBlock),
                cuotaOver,
                pctOver,
                cuotaUnder,
                pctUnder,
                probRBOver: Math.round(probRBOver * 10000) / 100,
                probRBUnder: Math.round(probRBUnder * 10000) / 100,
                margen: Math.round(margen * 100) / 100
            });
        }
    }
}

fs.writeFileSync(path.join(__dirname, 'parsed_matches.json'), JSON.stringify(matches, null, 2), 'utf-8');
console.log(`Partidos correctamente parseados con liga: ${matches.length}`);
