// =============================================================================
// DIAGNOSTICO DE CLOUDFLARE (informativo, no modifica nada)
// -----------------------------------------------------------------------------
// Responde a una pregunta clave para la captura en la nube:
//   "¿la IP desde la que se ejecuta esto puede hablar con ratingbet.com?"
//
// Un fetch normal (sin navegador) NUNCA obtiene los partidos: Cloudflare
// devuelve 403 + challenge ("Just a moment..."). Eso NO es un fallo del
// scraper: el scraper usa Chrome real y por eso si funciona.
//
// Lo que este script aporta en CI es la prueba escrita de que la IP es de
// datacenter y de como responde Cloudflare (codigo, cabecera cf-mitigated y
// titulo). Si en el log aparece "retos resueltos por el navegador", el propio
// scraper lo dira mas abajo con las filas extraidas.
//
// USO:  node tools_diag_cloudflare.js
// =============================================================================

const URL_PRUEBA = 'https://ratingbet.com/football/goals-over-under/';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

console.log('=== DIAGNOSTICO CLOUDFLARE ===');
console.log(' URL   : ' + URL_PRUEBA);
console.log(' Agente: fetch sin navegador (a proposito)');

const t0 = Date.now();
try {
    const res = await fetch(URL_PRUEBA, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9' }
    });
    const cuerpo = await res.text();
    const titulo = (cuerpo.match(/<title[^>]*>([^<]*)</i) || [])[1] || 'n/d';
    const reto = /Just a moment|Verificaci|Attention Required|Checking your browser/i.test(cuerpo);

    console.log(' HTTP          : ' + res.status + ' ' + res.statusText);
    console.log(' server        : ' + (res.headers.get('server') || 'n/d'));
    console.log(' cf-mitigated  : ' + (res.headers.get('cf-mitigated') || 'n/d'));
    console.log(' cf-ray        : ' + (res.headers.get('cf-ray') || 'n/d'));
    console.log(' ms            : ' + (Date.now() - t0));
    console.log(' bytes         : ' + cuerpo.length);
    console.log(' titulo        : ' + titulo);
    console.log(' es challenge  : ' + (reto ? 'SI' : 'NO'));

    if (reto || res.status === 403 || res.status === 503) {
        console.log('');
        console.log(' LECTURA: Cloudflare ha bloqueado este fetch sin navegador.');
        console.log('          Es ESPERADO y NO invalida la captura: el scraper usa');
        console.log('          Chrome real (--headless) y resuelve el challenge.');
        console.log('          Mira mas abajo las lineas "[1.5] ... filas N".');
        console.log('          Si esas filas son 0, entonces si es un bloqueo real.');
    } else {
        console.log('');
        console.log(' LECTURA: este origen no ha recibido challenge en un fetch plano.');
        console.log('          Aun asi el scraper es la unica fuente valida de filas.');
    }
} catch (e) {
    console.log(' ERROR de red: ' + (e && e.message ? e.message : e));
    console.log(' (informativo: no afecta al resto del workflow)');
}

// Nunca se devuelve codigo de error: es un diagnostico, no una comprobacion.
process.exit(0);
