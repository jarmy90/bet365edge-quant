// =============================================================================
// REPARACION: emojis de 4 bytes destrozados por los roundtrips de PowerShell
// -----------------------------------------------------------------------------
// Que paso:
//   Las cirugias anteriores reescribieron el fichero con Get-Content/Set-Content,
//   que leen en CP1252. Los emojis de 4 bytes (y su selector de variacion U+FE0F)
//   se guardaron como si fueran caracteres CP1252 sueltos:
//
//     🛡️  (F0 9F 9B A1 EF B8 8F)  ->  <F0><178><203A><A1><EF><B8><8F>
//     🚀  (F0 9F 9A 80)           ->  <F0><178><161><20AC>
//
//   Se veia como basura en la interfaz (los niveles de riesgo "🛡️/🚀").
//
// Por que este script identifica por PUNTOS DE CODIGO y no por texto:
//   Copiar y pegar el texto danado depende de la codificacion de la consola
//   (que fue justo la causa del dano). Construyendo la secuencia con
//   String.fromCodePoint el emparejamiento es exacto e independiente del editor.
//
// USO
//   node tools_repara_emoji_bandas.js            (informa, sin escribir)
//   node tools_repara_emoji_bandas.js --aplicar  (escribe y verifica)
// =============================================================================
import fs from 'fs';

const APLICAR = process.argv.includes('--aplicar');
const FICHERO = process.argv.find(a => a.endsWith('.js') && a !== process.argv[1]) || 'ratingbet_pipeline.js';

// --- Secuencias danadas (construidas por codepoints) -------------------------
const BASURA_ESCUDO = String.fromCodePoint(0xF0, 0x178, 0x203A, 0xA1, 0xEF, 0xB8, 0x8F);
const BASURA_COHETE = String.fromCodePoint(0xF0, 0x178, 0x161, 0x20AC);

const CORRECCIONES = [
    { basura: BASURA_ESCUDO, correcto: '\u{1F6E1}\uFE0F', que: 'escudo (RIESGO BAJO) 🛡️' },
    { basura: BASURA_COHETE, correcto: '\u{1F680}', que: 'cohete (RIESGO ALTO) 🚀' }
];

let texto = fs.readFileSync(FICHERO, 'utf-8');
console.log('=== REPARACION DE EMOJIS ===');
console.log(' Fichero : ' + FICHERO + ' (' + texto.length + ' caracteres)');
console.log(' Modo    : ' + (APLICAR ? 'APLICAR (escribe)' : 'solo informe'));

let total = 0;
for (const c of CORRECCIONES) {
    let n = 0, idx = texto.indexOf(c.basura);
    while (idx !== -1) {
        n++; total++;
        texto = texto.slice(0, idx) + c.correcto + texto.slice(idx + c.basura.length);
        idx = texto.indexOf(c.basura);
    }
    console.log(' ' + (n > 0 ? 'ENCONTRADO' : 'no aparece') + '  ' + c.que + '   x' + n);
}

// --- Barrido final: ¿queda algun marcador de dano? ---------------------------
const MARCA_4BYTES = String.fromCodePoint(0xF0, 0x178);          // 'F0 9F' leidos como CP1252
const restoEmoji = texto.split(MARCA_4BYTES).length - 1;
const restoAcentos = (texto.match(/\u00C3[\u0192\u2030\u2039\u00A1\u00A2\u00A3]/g) || []).length;

console.log('');
console.log(' Marcadores de emoji danado restantes : ' + restoEmoji);
console.log(' Marcadores de acento danado restantes: ' + restoAcentos);
console.log(' Total corregido en esta pasada      : ' + total);

if (APLICAR) {
    if (total > 0) {
        fs.writeFileSync(FICHERO, texto, 'utf-8');
        console.log(' ESCRITO en UTF-8.');
    } else {
        console.log(' Nada que escribir.');
    }
} else if (total > 0) {
    console.log(' Vuelve a ejecutarlo con --aplicar para corregirlo.');
}

// Para el CI: acentos danados = fallo; emojis danados = se informan.
process.exit(restoEmoji === 0 && restoAcentos === 0 ? 0 : 1);