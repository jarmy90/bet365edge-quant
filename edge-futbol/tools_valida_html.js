// =============================================================================
// VALIDADOR DE BALANCE DE ETIQUETAS DEL HTML EMBEBIDO EN worker.js
// -----------------------------------------------------------------------------
// El HTML de la web vive como string dentro de worker.js, asi que un </div> de
// menos rompe el layout sin que ningun test lo detecte. Este script extrae el
// fragmento <body ...> ... </body>, ignora <script>/<style>/comentarios y cuenta
// aperturas vs cierres de las etiquetas estructurales.
// Uso: node tools_valida_html.js
// =============================================================================
import fs from 'fs';

const fuente = fs.readFileSync('worker.js', 'utf-8');

// El HTML se construye dentro de una funcion devuelve... ; buscamos el bloque
// que empieza en "<!DOCTYPE html>" y acaba en "</html>" (puede haber varios).
const bloques = [];
const rx = /<!DOCTYPE html>[\s\S]*?<\/html>/g;
let m;
while ((m = rx.exec(fuente)) !== null) bloques.push({ texto: m[0], offset: m.index });

if (!bloques.length) {
    console.error('ERROR: no se ha encontrado ningun bloque <!DOCTYPE html> en worker.js');
    process.exit(2);
}

console.log('Bloques HTML encontrados: ' + bloques.length);

const ESTRUCTURALES = ['div', 'section', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'span', 'button', 'ul', 'li', 'a', 'p'];
let fallos = 0;

bloques.forEach((b, idx) => {
    let limpio = b.texto;
    // Quitar comentarios HTML y el contenido de script/style (su JS contiene
    // cadenas con '<div>' que falsearian el conteo)
    limpio = limpio.replace(/<!--[\s\S]*?-->/g, '');
    limpio = limpio.replace(/<script[\s\S]*?<\/script>/gi, '');
    limpio = limpio.replace(/<style[\s\S]*?<\/style>/gi, '');

    const lineaBase = fuente.slice(0, b.offset).split('\n').length;
    const resultados = [];
    let globalOk = true;

    ESTRUCTURALES.forEach(tag => {
        const abre = (limpio.match(new RegExp('<' + tag + '(?=[\\s>/])', 'gi')) || []).length;
        const cierra = (limpio.match(new RegExp('</' + tag + '\\s*>', 'gi')) || []).length;
        // Etiquetas opcionales que el navegador autocierra: solo avisamos
        const diferencia = abre - cierra;
        if (diferencia !== 0) {
            globalOk = false;
            resultados.push({ tag, abre, cierra, diferencia });
        }
    });

    console.log('\n--- Bloque ' + (idx + 1) + ' (empieza en la linea ' + lineaBase + ' de worker.js) ---');
    if (globalOk) {
        console.log('  OK: todas las etiquetas estructurales balanceadas');
    } else {
        fallos++;
        resultados.forEach(r => {
            console.log('  DESBALANCE <' + r.tag + '>: abre=' + r.abre + ' cierra=' + r.cierra + ' diferencia=' + (r.diferencia > 0 ? '+' + r.diferencia : r.diferencia));
        });
    }
});

console.log('\n=============================================================');
if (fallos) {
    console.log(' RESULTADO: ' + fallos + ' bloque(s) con desbalance');
    process.exit(1);
}
console.log(' RESULTADO: HTML balanceado en todos los bloques');
process.exit(0);
