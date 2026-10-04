// =============================================================================
// GENERADOR DE DATASET PARA EL API
// -----------------------------------------------------------------------------
// Convierte la captura de auditoria (ratingbet_fixtures.json, escrita por
// scrape_ratingbet.js o por tools_valida_extractor.js) en el MODULO ES que
// consume el API: ratingbet_fixtures_data.js
//
// POR QUE UN MODULO ES Y NO UN JSON LEIDO EN RUNTIME:
//   El API corre en Vercel Edge y Cloudflare Workers. En ambos el sistema de
//   ficheros no existe en runtime. Un modulo ES se BUNDLEA en el build, asi que
//   el dato esta disponible como codigo. Es la unica via sin almacenamiento
//   externo (KV/D1/S3).
//
// CONSECUENCIA DE DISENO (importante):
//   El dato viaja CONGELADO en el despliegue. Por eso el pipeline aplica una
//   PUERTA DE FRESCURA: si la captura tiene mas de MAX_ANTIGUEDAD_MIN minutos,
//   el API NO publica nada y avisa. Este es el candado que impide volver al bug
//   original de "partidos de ayer" re-fechados.
//
// USO:
//   node tools_genera_dataset.js                          # entrada y salida por defecto
//   node tools_genera_dataset.js --in=x.json --out=y.js
// =============================================================================
import fs from 'fs';

function arg(nombre, porDefecto) {
    const hit = process.argv.find(a => a.startsWith('--' + nombre + '='));
    return hit ? hit.split('=').slice(1).join('=') : porDefecto;
}

const ENTRADA = arg('in', 'ratingbet_fixtures.json');
const SALIDA = arg('out', 'ratingbet_fixtures_data.js');

if (!fs.existsSync(ENTRADA)) {
    console.error('ERROR: no existe ' + ENTRADA + '. Ejecuta antes: node scan_ratingbet.js  (o node scrape_ratingbet.js)');
    process.exit(2);
}

const d = JSON.parse(fs.readFileSync(ENTRADA, 'utf-8'));
const partidos = Array.isArray(d.PARTIDOS) ? d.PARTIDOS : (Array.isArray(d.partidos) ? d.partidos : []);
if (partidos.length === 0) {
    console.error('ERROR: el dataset no contiene partidos. No se genera el modulo.');
    process.exit(3);
}

// Marca de frescura: es EL campo critico. Si falta, el API no publicara nada.
const fuenteBruta = (d.CAPTURA && d.CAPTURA.fuente) || (typeof d.fuente === 'object' ? d.fuente : null) || {};
const generadoEnUtc = fuenteBruta.generadoEnUtc || d.generadoEn || null;
if (!generadoEnUtc || !Number.isFinite(Date.parse(generadoEnUtc))) {
    console.error('ERROR: el dataset no tiene marca de captura valida (generadoEnUtc / generadoEn).');
    console.error('       Sin esa marca el API rechazaria el catalogo por seguridad.');
    process.exit(4);
}

// Validacion de esquema minima del partido: el API asume esta forma
const obligatorios = ['clave', 'local', 'visitante', 'kickoffIsoUtc', 'lineas'];
const malos = partidos.filter(p => !p || obligatorios.some(k => !p[k]));
if (malos.length) {
    console.error('ERROR: ' + malos.length + ' partidos no cumplen el esquema (' + obligatorios.join(', ') + ').');
    process.exit(5);
}

const fuente = Object.assign({}, fuenteBruta, {
    generadoEnUtc: generadoEnUtc,
    generadoEnMadrid: fuenteBruta.generadoEnMadrid || new Intl.DateTimeFormat('es-ES', {
        timeZone: 'Europe/Madrid', dateStyle: 'full', timeStyle: 'medium'
    }).format(new Date(Date.parse(generadoEnUtc))),
    origen: fuenteBruta.origen || 'ratingbet.com',
    zonaHorariaNegocio: 'Europe/Madrid',
    totalPartidos: partidos.length
});

const edadMin = Math.round((Date.now() - Date.parse(generadoEnUtc)) / 60000);

const modulo = [
    '// =============================================================================',
    '// GENERADO AUTOMATICAMENTE por tools_genera_dataset.js - NO EDITAR A MANO',
    '// -----------------------------------------------------------------------------',
    '// Capturado : ' + fuente.generadoEnMadrid,
    '// UTC       : ' + generadoEnUtc,
    '// Partidos  : ' + partidos.length,
    '// Zona      : ' + fuente.zonaHorariaNegocio + ' (la web declara data-user-timezone="auto")',
    '// Origen    : ' + fuente.origen,
    '//',
    '// Para refrescar:',
    '//   1. node scrape_ratingbet.js          (captura real con Chrome)',
    '//   2. node tools_genera_dataset.js      (regenera este modulo)',
    '//   3. redeploy',
    '// =============================================================================',
    '',
    'export const CAPTURA = ' + JSON.stringify(Object.assign({}, d.CAPTURA || {}, { fuente: fuente }), null, 2) + ';',
    '',
    '// Partidos reales con cuotas 1.5 y 2.5 (local/visitante tomados del slug de la URL)',
    'export const PARTIDOS = ' + JSON.stringify(partidos, null, 2) + ';',
    '',
    'export default { CAPTURA, PARTIDOS };',
    ''
].join('\n');

fs.writeFileSync(SALIDA, modulo, 'utf-8');

console.log('=============================================================');
console.log(' DATASET GENERADO');
console.log('=============================================================');
console.log(' Entrada : ' + ENTRADA);
console.log(' Salida  : ' + SALIDA + ' (' + Math.round(modulo.length / 1024) + ' KB)');
console.log(' Partidos: ' + partidos.length);
console.log(' Captura : ' + fuente.generadoEnMadrid);
console.log(' Edad    : ' + edadMin + ' min');
console.log('');

// Aviso de frescura: si la captura ya es vieja, el API publicara vacio (por diseno)
const MAX_ANTIGUEDAD_MIN = 180;
if (edadMin > MAX_ANTIGUEDAD_MIN) {
    console.log(' AVISO: la captura tiene ' + edadMin + ' min (limite ' + MAX_ANTIGUEDAD_MIN + ').');
    console.log('        El API la rechazara por la puerta de frescura y mostrara el aviso de');
    console.log('        "no hay partidos futuros". Vuelve a capturar antes de desplegar.');
} else {
    console.log(' OK: captura fresca (' + edadMin + ' min <= ' + MAX_ANTIGUEDAD_MIN + ' min).');
}
console.log('');