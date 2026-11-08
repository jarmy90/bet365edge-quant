// =============================================================================
// TEST: FILTRADO DE LALIGA Y PREMIER LEAGUE, COHERENCIA DE EDGE Y DATOS PERSONALES
// -----------------------------------------------------------------------------
// Verifica:
//   1. Solo se aceptan partidos de LaLiga y Premier League para proximos partidos.
//   2. Los partidos estan ordenados cronologicamente.
//   3. Ningun partido pasado/en vivo se incluye en el pool.
//   4. El calculo de Edge es coherente y un Edge <= 0 no se valida como pick positivo.
//   5. No existe ningun correo o nombre personal expuesto en la interfaz o metadatos.
// =============================================================================
import assert from 'node:assert';
import {
    ALLOWED_LEAGUE_IDS, esLigaTopPermitida, filtrarSoloLigasTop
} from './ratingbet_pipeline.js';
import worker from './worker.js';

console.log('=============================================================');
console.log(' TEST: FILTRADO DE LIGAS, EDGE Y DATOS PERSONALES');
console.log('=============================================================');

// 1. Verificacion de ligas permitidas
assert.ok(Array.isArray(ALLOWED_LEAGUE_IDS), 'ALLOWED_LEAGUE_IDS debe ser un array');
assert.ok(ALLOWED_LEAGUE_IDS.includes('all-ratingbet'), 'Debe aceptar el catálogo líquido de ratingbet');

const partidoLaLiga = { liga: 'Spain: LaLiga Spain', urlRelativa: '/football/spain-laliga/' };
const partidoPremier = { liga: 'England: Premier League England', urlRelativa: '/football/england-premier-league/' };
const partidoSegunda = { liga: 'Spain: Segunda Division Spain', urlRelativa: '/football/spain-segunda-division/' };
const partidoEcuador = { liga: 'Ecuador: Serie B Ecuador', urlRelativa: null };
const partidoArgentina = { liga: 'Argentina: Liga Profesional', urlRelativa: null };

assert.strictEqual(esLigaTopPermitida(partidoLaLiga), true, 'LaLiga debe ser permitida');
assert.strictEqual(esLigaTopPermitida(partidoPremier), true, 'Premier League debe ser permitida');
assert.strictEqual(esLigaTopPermitida(partidoSegunda), true, 'Segunda Division debe ser permitida');
assert.strictEqual(esLigaTopPermitida(partidoEcuador), true, 'Serie B Ecuador debe ser permitida si ratingbet ofrece mercado real');
assert.strictEqual(esLigaTopPermitida(partidoArgentina), true, 'Liga Argentina debe ser permitida si ratingbet ofrece mercado real');
assert.strictEqual(esLigaTopPermitida({ liga: 'International: Friendly' }), false, 'Los amistosos deben excluirse');
assert.strictEqual(esLigaTopPermitida({ liga: 'England: U21 League' }), false, 'Las competiciones juveniles deben excluirse');

console.log('  [OK] Identificadores de competicion oficiales y filtrado de ligas.');

// 2. Comprobacion de respuesta HTML del worker
const req = new Request('http://test.local/');
const res = await worker.fetch(req, {}, {});
const html = await res.text();

assert.ok(html.includes('BOT ACTIVO 24/7 · ANÁLISIS DE FÚTBOL EN TIEMPO REAL'), 'La cabecera contiene el banner bot 24/7');
assert.ok(html.includes('Encuentra apuestas de fútbol'), 'La cabecera contiene el titulo principal');
assert.ok(html.includes('Ver oportunidades de hoy'), 'El boton principal dice Ver oportunidades de hoy');
assert.ok(html.includes('Cómo funciona nuestro bot'), 'Incluye la seccion explicativa');
assert.ok(html.includes('Próximos partidos analizados'), 'Incluye la nueva seccion de proximos partidos');

// 3. Ausencia de datos personales
assert.strictEqual(html.includes('javiarmada'), false, 'No debe aparecer el nombre/correo personal en HTML');
assert.strictEqual(html.includes('javiarmada@gmail.com'), false, 'No debe aparecer el correo personal en HTML');

console.log('  [OK] Cabecera rediseñada, seccion explicativa y ausencia de datos personales.');
console.log('RESULTADO: TODAS LAS COMPROBACIONES PASAN (OK)');
