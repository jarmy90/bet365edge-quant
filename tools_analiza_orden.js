// ANALISIS OFFLINE: ?el orden DOM (host/guest) coincide con el slug de la URL?
// Uso: node tools_analiza_orden.js tools_dom2_2_5.html
import fs from 'fs';

const fichero = process.argv[2] || 'tools_dom2_2_5.html';
const html = fs.readFileSync(fichero, 'utf-8');

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');

// Partir el HTML por filas de partido
const filas = html.split(/<div class="match-item match-item_predictions/).slice(1);
console.log(`Filas detectadas: ${filas.length}`);

let coinciden = 0, invertidas = 0, ambiguas = 0;
const ejemplos = [];

for (const bloque of filas) {
    const mUrl = bloque.match(/(?:data-)?href="(\/football\/match\/([^"]+)\/)"/);
    if (!mUrl) continue;
    const slug = mUrl[2];
    const partes = slug.split('-vs-');
    if (partes.length !== 2) { ambiguas++; continue; }

    const equipos = [...bloque.matchAll(/match-item__team (host|guest)[^>]*>[\s\S]*?team-header__team-title team-name one-row">\s*([^<]+?)\s*</g)]
        .map(m => ({ rol: m[1], nombre: m[2].trim() }));

    if (equipos.length < 2) { ambiguas++; continue; }

    const [a, b] = partes.map(norm);
    const n1 = norm(equipos[0].nombre), n2 = norm(equipos[1].nombre);
    const primeroEsLocal = a.includes(n1) || n1.includes(a.split('-')[0]);
    const segundoEsVisitante = b.includes(n2) || n2.includes(b.split('-')[0]);

    if (primeroEsLocal && segundoEsVisitante) coinciden++;
    else if ((b.includes(n1) || n1.includes(b.split('-')[0])) && (a.includes(n2) || n2.includes(a.split('-')[0]))) {
        invertidas++;
        if (ejemplos.length < 5) ejemplos.push(`  slug=${slug} | dom=${equipos[0].nombre}(${equipos[0].rol}) vs ${equipos[1].nombre}(${equipos[1].rol})`);
    } else ambiguas++;
}

console.log(`\nRESULTADO (${fichero}):`);
console.log(`  slug coincide con DOM [host|guest] : ${coinciden}`);
console.log(`  INVERTIDAS (DOM al reves del slug): ${invertidas}`);
console.log(`  ambiguas (nombres no casan)        : ${ambiguas}`);
if (ejemplos.length) { console.log('\nEjemplos invertidos:'); ejemplos.forEach(e => console.log(e)); }