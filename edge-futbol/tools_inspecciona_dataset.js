// Inspeccion del dataset generado por el scraper
// Uso: node tools_inspecciona_dataset.js
import mod from './ratingbet_fixtures_data.js';

const d = mod && mod.default ? mod.default : mod;
console.log('Tipo de export :', typeof d, Array.isArray(d) ? '(array)' : '');
console.log('Claves         :', Array.isArray(d) ? '(array)' : Object.keys(d).join(', '));

const arr = Array.isArray(d) ? d : (d.PARTIDOS || d.partidos || d.fixtures || d.matches || []);
console.log('Cantidad       :', arr.length);
if (!arr.length) process.exit(0);

const muestra = arr[0];
console.log('\nClaves de un partido:', Object.keys(muestra).join(', '));
console.log('Ejemplo:', JSON.stringify({
    local: muestra.local, visitante: muestra.visitante, liga: muestra.liga,
    hora: muestra.hora, lineas: muestra.lineas
}, null, 2).slice(0, 700));

const incompletos = arr.filter(p => {
    for (const k of ['1.5', '2.5']) {
        const l = (p.lineas || {})[k];
        if (l && (l.cuotaOver === null || l.cuotaOver === undefined || l.cuotaUnder === null || l.cuotaUnder === undefined)) return true;
    }
    return false;
});
console.log('\nPartidos con linea INCOMPLETA:', incompletos.length);
incompletos.slice(0, 10).forEach(p =>
    console.log('  - ' + p.local + ' vs ' + p.visitante + ' | ' + p.liga + ' | url=' + p.url +
        ' | lineas=' + JSON.stringify(p.lineas)));

const sinNinguna = arr.filter(p => !(p.lineas && (p.lineas['1.5'] || p.lineas['2.5'])));
console.log('\nPartidos sin NINGUNA linea:', sinNinguna.length);
sinNinguna.slice(0, 10).forEach(p =>
    console.log('  * ' + p.local + ' vs ' + p.visitante + ' | ' + p.liga + ' | url=' + p.url));

// Sin cuota Under en concreto
const sinUnder = arr.filter(p => {
    const l = (p.lineas || {})['1.5'] || (p.lineas || {})['2.5'];
    return l && (l.cuotaUnder === null || l.cuotaUnder === undefined);
});
console.log('\nPartidos sin cuota UNDER:', sinUnder.length);