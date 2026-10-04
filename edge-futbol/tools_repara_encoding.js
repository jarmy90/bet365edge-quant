// REPARACION: revierte la triple codificacion (UTF-8 leido como CP1252) causada
// por los roundtrips Get-Content/Set-Content de PowerShell sobre el fichero.
import fs from 'fs';

// tabla inversa CP1252 (0x80-0x9F): char unicode -> byte original
const CP1252 = {
    0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85,
    0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A,
    0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92,
    0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
    0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C,
    0x017E: 0x9E, 0x0178: 0x9F
};

function revierte(s) {
    const bytes = [];
    for (const ch of s) {
        const c = ch.codePointAt(0);
        if (CP1252[c] !== undefined) bytes.push(CP1252[c]);
        else if (c < 256) bytes.push(c);
        else return null; // char no representable: parar
    }
    return Buffer.from(bytes).toString('utf8');
}

const fichero = process.argv[2];
const txt = fs.readFileSync(fichero, 'utf8');
const lineas = txt.split('\n');
let reparadas = 0, pendientes = [];

// Solo se intenta revertir lineas con marcadores de mojibake; las lineas
// limpias (incluidas las que tienen emojis legitimos) no se tocan.
const sospechosa = (l) => /Ã|â€|âš|Ã¢/.test(l);

const salida = lineas.map(function (l, i) {
    if (!sospechosa(l)) return l;
    let actual = l;
    for (let r = 0; r < 3 && sospechosa(actual); r++) {
        const t = revierte(actual);
        if (t === null) break;
        actual = t;
    }
    if (sospechosa(actual)) { pendientes.push(i + 1); return l; }
    reparadas++;
    return actual;
});
fs.writeFileSync(fichero, salida.join('\n'));
const resto = salida.filter(sospechosa).length;
console.log('lineas reparadas: ' + reparadas + ' | pendientes manuales: ' + (pendientes.join(',') || 'ninguna'));
process.exit(resto === 0 ? 0 : 1);