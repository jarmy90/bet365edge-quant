// Reemplaza las filas estaticas de la tabla "fixture" del worker por un contenedor dinamico.
// Uso: node tools_fix_hero_rows.js  (se elimina despues de usarlo)
import fs from 'node:fs';

const path = 'worker.js';
const buf = fs.readFileSync(path);
const hasBom = buf.length > 2 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
const text = buf.toString('utf8');
const eol = text.includes('\r\n') ? '\r\n' : '\n';

const openNeedle = '<tbody>';
const openIdx = text.indexOf(openNeedle);
const closeIdx = text.indexOf('</tbody>', openIdx);
if (openIdx === -1 || closeIdx === -1) throw new Error('No se encontro el bloque tbody esperado');

const antes = text.slice(openIdx, closeIdx + '</tbody>'.length);
console.log('Filas encontradas (preview):', JSON.stringify(antes.slice(0, 90)));

const i12 = '                            ';
const i16 = '                                ';
const nuevo = '<tbody id="heroFixtureBody">' + eol +
    i12 + '<!-- Filas generadas en tiempo real desde /api/fixtures-hoy (dia + hora reales, solo futuros) -->' + eol +
    i12 + '<tr>' + eol +
    i16 + '<td colspan="6" style="text-align:center; color:var(--text-muted); font-size:0.8rem; padding:16px;">Calculando validacion temporal (dia + hora reales de cada fixture)...</td>' + eol +
    i12 + '</tr>' + eol +
    '                        </tbody>';

const salida = text.slice(0, openIdx) + nuevo + text.slice(closeIdx + '</tbody>'.length);
fs.writeFileSync(path, (hasBom ? '\ufeff' : '') + salida, 'utf8');
console.log('OK: filas estaticas reemplazadas. BOM=' + hasBom + ' EOL=' + JSON.stringify(eol));
