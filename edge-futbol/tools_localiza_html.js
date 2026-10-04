// =============================================================================
// LOCALIZADOR DE DESBALANCE HTML (linea exacta)
// -----------------------------------------------------------------------------
// Recorre la portada embebida en worker.js manteniendo una pila de etiquetas y
// reporta:
//   - cierres huerfanos (no hay apertura que corresponda)
//   - pila sin vaciar al final (aperturas sin cerrar)
// Ignora <script>, <style>, comentarios y etiquetas void.
// Uso: node tools_localiza_html.js
// =============================================================================
import fs from 'fs';

const EST = new Set(['div', 'section', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'span', 'button', 'ul', 'li', 'a', 'p', 'nav', 'header', 'footer']);
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'path', 'circle', 'line', 'rect', 'stop', 'polyline', 'use', 'area', 'base', 'col', 'embed', 'track', 'wbr', 'text']);

const fuente = fs.readFileSync('worker.js', 'utf-8');
const rxBloques = /<!DOCTYPE html>[\s\S]*?<\/html>/g;
const bloques = [];
let mb;
while ((mb = rxBloques.exec(fuente)) !== null) {
    bloques.push({ texto: mb[0], offset: mb.index });
}
// La portada es el bloque que contiene el titulo de la terminal cuantitativa
const elegido = bloques.find(b => b.texto.includes('Terminal Cuantitativa'));
if (!elegido) { console.error('No se ha encontrado la portada'); process.exit(2); }

const bloque = elegido.texto;
const lineaBase = fuente.slice(0, elegido.offset).split('\n').length;
console.log('Portada: ' + bloque.length + ' bytes, empieza en la linea ' + lineaBase + ' de worker.js\n');

// Trocear respetando script/style/comentarios para no contar dentro de ellos
const avisos = [];
const pila = [];
const lineaDe = (pos) => lineaBase + bloque.slice(0, pos).split('\n').length - 1;

const rx = /<!--[\s\S]*?-->|<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<\/([a-zA-Z][a-zA-Z0-9]*)\s*>|<([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
let t;
while ((t = rx.exec(bloque)) !== null) {
    if (t[0].startsWith('<!--') || /^<script/i.test(t[0]) || /^<style/i.test(t[0])) continue;

    if (t[1]) {                                  // cierre
        const tag = t[1].toLowerCase();
        if (!EST.has(tag)) continue;
        // Desapilar hasta encontrar su apertura (permite autocierres intermedios)
        let encontrado = -1;
        for (let i = pila.length - 1; i >= 0; i--) { if (pila[i].tag === tag) { encontrado = i; break; } }
        if (encontrado === -1) {
            avisos.push('CIERRE HUERFANO </' + tag + '> en la linea ' + lineaDe(t.index));
        } else {
            if (encontrado !== pila.length - 1) {
                avisos.push('CIERRE FUERA DE ORDEN </' + tag + '> linea ' + lineaDe(t.index) +
                    ' (queda abierto <' + pila[pila.length - 1].tag + '> de la linea ' + pila[pila.length - 1].linea + ')');
            }
            pila.length = encontrado;
        }
        continue;
    }

    const tag = (t[2] || '').toLowerCase();
    if (!tag || VOID.has(tag) || !EST.has(tag)) continue;
    const autoCierra = /\/\s*$/.test(t[3] || '');
    if (!autoCierra) pila.push({ tag, linea: lineaDe(t.index) });
}

console.log('--- INCIDENCIAS ---');
if (!avisos.length && !pila.length) {
    console.log(' Ninguna: HTML perfectamente anidado');
    process.exit(0);
}
avisos.slice(0, 25).forEach(a => console.log(' ' + a));
if (avisos.length > 25) console.log(' ... y ' + (avisos.length - 25) + ' mas');
if (pila.length) {
    console.log('\n ETIQUETAS SIN CERRAR (' + pila.length + '):');
    pila.slice(-12).forEach(p => console.log('   <' + p.tag + '> abierta en la linea ' + p.linea));
}
process.exit(1);
