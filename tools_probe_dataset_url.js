// Muestra el bloque de dataset remoto del worker y el final del scraper
import fs from 'fs';

function bloque(file, needle, antes, despues) {
    const t = fs.readFileSync(file, 'utf8');
    const i = t.indexOf(needle);
    console.log('\n########## ' + file + ' :: ' + needle + ' (idx ' + i + ') ##########');
    if (i < 0) return;
    console.log(t.slice(Math.max(0, i - antes), i + despues));
}

bloque('worker.js', 'RATINGBET_DATASET_URL', 1800, 2600);
bloque('scrape_ratingbet.js', 'writeFileSync', 1200, 2200);
bloque('tools_genera_dataset.js', 'export', 300, 1200);
