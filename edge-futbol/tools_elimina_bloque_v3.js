// Elimina el bloque v3 MUERTO de worker.js (fixtureSystemPrompt, parseAiFixtures,
// validateFixtures, pedirFixturesAOmniroute) que quedo tras migrar al pipeline v4.
// Ese bloque referencia identificadores que ya no existen (FIXTURES_MAX,
// MAX_HORIZON_MS, SAFETY_MARGIN_MS) y por eso no debe llegar a produccion.
// Uso: node tools_elimina_bloque_v3.js
import fs from 'fs';

const RUTA = 'worker.js';
const lineas = fs.readFileSync(RUTA, 'utf-8').split(/\r?\n/);

const idx = (n) => n - 1;   // 1-based -> 0-based
const INICIO = 437;
const FIN = 604;            // el 604 esta en blanco; el 605 abre el bloque v4

const primera = (lineas[idx(INICIO)] || '').trim();
const ultima = (lineas[idx(FIN)] || '').trim();
const siguiente = (lineas[idx(605)] || '').trim();

console.log('--- VERIFICACION DE LIMITES ---');
console.log(' 437 (inicio)   : ' + primera);
console.log(' 604 (fin)      : "' + ultima + '"');
console.log(' 605 (siguiente): ' + siguiente.slice(0, 60));

if (!/^function fixtureSystemPrompt\(\)/.test(primera)) {
    console.error('ABORTADO: la linea 437 no es fixtureSystemPrompt. No se toca el fichero.');
    process.exit(1);
}
if (ultima !== '') {
    console.error('ABORTADO: la linea 604 no esta en blanco. No se toca el fichero.');
    process.exit(1);
}
if (!/^\/\/\s*=+/.test(siguiente)) {
    console.error('ABORTADO: la linea 605 no abre el bloque v4. No se toca el fichero.');
    process.exit(1);
}

// Comprobacion de seguridad: nada de lo que se borra puede estar referenciado fuera
const eliminado = lineas.slice(idx(INICIO), idx(FIN) + 1).join('\n');
const restante = lineas.filter((_, i) => i < idx(INICIO) || i > idx(FIN)).join('\n');
const nombres = ['fixtureSystemPrompt', 'parseAiFixtures', 'validateFixtures', 'pedirFixturesAOmniroute'];
let peligro = false;
for (const n of nombres) {
    const refsFuera = (restante.match(new RegExp('\\b' + n + '\\b', 'g')) || []).length;
    console.log(` referencias a ${n} fuera del bloque: ${refsFuera}`);
    if (refsFuera > 0) peligro = true;
}
if (peligro) {
    console.error('ABORTADO: hay referencias externas. Revisar antes de borrar.');
    process.exit(1);
}

// Copia de seguridad y escritura
fs.writeFileSync(RUTA + '.bak_v3', fs.readFileSync(RUTA, 'utf-8'), 'utf-8');
const nuevas = lineas.filter((_, i) => i < idx(INICIO) || i > idx(FIN));
fs.writeFileSync(RUTA, nuevas.join('\n'), 'utf-8');

console.log('\n--- RESULTADO ---');
console.log(' lineas antes : ' + lineas.length);
console.log(' eliminadas   : ' + (eliminado.split('\n').length));
console.log(' lineas ahora : ' + nuevas.length);
console.log(' copia de seguridad: worker.js.bak_v3');