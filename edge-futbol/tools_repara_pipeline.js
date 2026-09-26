// REPARACION: elimina de ratingbet_pipeline.js el bloque redundante insertado por
// error (seleccionarDestacados / PROMPT_EDGE_VERSION / construirPromptEdge), que
// ademas partia en dos el cuerpo de construirCandidatos y rompia la sintaxis.
//
// El pipeline correcto es el que ya existia y esta cubierto por
// test_ratingbet_pipeline.js (seleccionarParaAnalisis, construirPromptAnalisis,
// parsearVeredictosIA, aplicarVeredictos, filtrarPublicables, construirFeedNoticias).
//
// Uso: node tools_repara_pipeline.js   (idempotente: avisa si no encuentra el bloque)
import fs from 'fs';

const FICHERO = 'ratingbet_pipeline.js';
const MARCA_INICIO = '// 2) SELECCION DE DESTACADOS';
const MARCA_FIN = 'export function construirPromptEdge';

const original = fs.readFileSync(FICHERO, 'utf-8');
const lineas = original.split(/\r?\n/);

const iMarca = lineas.findIndex(l => l.includes(MARCA_INICIO));
if (iMarca === -1) {
    console.log('NADA QUE HACER: el bloque redundante ya no esta en ' + FICHERO);
    process.exit(0);
}

// Incluye la linea separadora "// ----" inmediatamente anterior
let inicio = iMarca;
while (inicio > 0 && /^\/\/ -{3,}\s*$/.test(lineas[inicio - 1])) inicio--;

const iFn = lineas.findIndex((l, i) => i > iMarca && l.startsWith(MARCA_FIN));
if (iFn === -1) {
    console.error('ERROR: no se localiza el final del bloque (' + MARCA_FIN + '). Abortado sin tocar el fichero.');
    process.exit(1);
}

// Fin del bloque = primera linea "}" a columna 0 despues del inicio de la funcion
let fin = -1;
for (let i = iFn; i < lineas.length; i++) {
    if (lineas[i] === '}') { fin = i; break; }
}
if (fin === -1) {
    console.error('ERROR: no se localiza el cierre de construirPromptEdge. Abortado sin tocar el fichero.');
    process.exit(1);
}

const eliminadas = fin - inicio + 1;
console.log('Bloque localizado: lineas ' + (inicio + 1) + ' a ' + (fin + 1) + ' (' + eliminadas + ' lineas)');
console.log('  primera: ' + lineas[inicio].trim().slice(0, 70));
console.log('  ultima : ' + lineas[fin].trim().slice(0, 70));
console.log('  antes  : ' + lineas[inicio - 1].trim().slice(0, 70));
console.log('  despues: ' + lineas[fin + 1].trim().slice(0, 70));

const resultado = lineas.slice(0, inicio).concat(lineas.slice(fin + 1)).join('\n');
fs.writeFileSync(FICHERO, resultado, 'utf-8');
console.log('OK: ' + FICHERO + ' reparado. Lineas: ' + lineas.length + ' -> ' + resultado.split('\n').length);