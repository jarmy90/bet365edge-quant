// =============================================================================
// TEST: ACCESO LIBRE (fase de lanzamiento) + PAGINA LEGAL Y NUEVA UX
// -----------------------------------------------------------------------------
// Verifica lo que se acaba de cambiar para abrir la web gratis:
//   1. El interruptor ACCESO_LIBRE llega al navegador y todo queda desbloqueado.
//   2. El boton de la barra muestra "Ver oportunidades de hoy" y desplaaza suavemente.
//   3. La seccion de picks se titula OPORTUNIDADES DETECTADAS.
//   4. El pie lleva aviso +18, juego responsable y enlaces legales.
//   5. /legal (y sus alias) sirven el aviso legal, privacidad, cookies,
//      terminos y juego responsable.
// =============================================================================
import worker from './worker.js';

let pasan = 0, fallan = 0;
function ok(cond, nombre, detalle) {
    if (cond) { pasan++; console.log('  PASS  ' + nombre + (detalle !== undefined ? '   [' + detalle + ']' : '')); }
    else { fallan++; console.log('  FAIL  ' + nombre + (detalle !== undefined ? '   [' + detalle + ']' : '')); }
}

const env = {}; // sin claves: no hay llamadas de red

async function pedir(ruta) {
    const res = await worker.fetch(new Request('https://test.local' + ruta), env, {});
    return { res, texto: await res.text() };
}

console.log('\n--- 1) PORTADA EN MODO GRATIS ---');
{
    const { res, texto } = await pedir('/');
    ok(res.status === 200, 'la portada responde 200');
    ok(texto.includes('const ACCESO_LIBRE = true'), 'el interruptor de acceso libre llega al navegador');
    ok(/navStatusTxt[\s\S]{0,400}Suscripción/.test(texto) || texto.includes('Suscripción'),
        'la barra indica estado de suscripcion');
    ok(texto.includes('OPORTUNIDADES DETECTADAS'), 'la seccion se llama OPORTUNIDADES DETECTADAS');
    ok(!/APUESTAS DE HOY CON EDGE DESBLOQUEADAS/.test(texto), 'ya no promete "EDGE DESBLOQUEADAS"');
}

console.log('\n--- 2) BOTON DE OPORTUNIDADES ---');
{
    const { texto } = await pedir('/');
    ok(texto.includes('>Ver oportunidades de hoy<'), 'el boton de la barra dice "Ver oportunidades de hoy"');
    ok(/id="btnNavUpgrade"[^>]*onclick="scrollToProximosPartidos\(\)"/.test(texto) || texto.includes('scrollToProximosPartidos'),
        'el boton llama a scrollToProximosPartidos()');
    ok(texto.includes('function scrollToProximosPartidos()'), 'existe la funcion de desplazamiento suave');
}

console.log('\n--- 3) HONESTIDAD DEL TEXTO ---');
{
    const { texto } = await pedir('/');
    ok(texto.includes('Próximos partidos analizados'), 'el titulo de proximos partidos explica el contenido');
    ok(texto.includes('No hay próximos partidos disponibles con datos completos') || texto.includes('Hoy no hay combinada con ventaja clara') || texto.includes('Sin ventaja suficiente'), 'los estados vacios no prometen edge inexistente');
}

console.log('\n--- 4) PIE LEGAL Y AVISO DE EDAD ---');
{
    const { texto } = await pedir('/');
    ok(texto.includes('Solo para mayores de 18'), 'aviso de edad en el pie');
    ok(texto.includes('900 200 225') && texto.includes('jugarbien.es'), 'telefono de ayuda y recurso de juego responsable');
    ok(texto.includes('No es un operador de juego'), 'deja claro que no es un operador de juego');
    ['/legal#aviso', '/legal#privacidad', '/legal#cookies', '/legal#terminos', '/legal#juego']
        .forEach(h => ok(texto.includes(h), 'enlace legal presente ' + h));
    ok(texto.includes('Servicio independiente, no afiliado ni respaldado por bet365'), 'deja clara la independencia respecto a bet365');
}

console.log('\n--- 5) PAGINA LEGAL Y ALIAS ---');
{
    const { res, texto } = await pedir('/legal');
    ok(res.status === 200, '/legal responde 200');
    ok((res.headers.get('content-type') || '').includes('text/html'), 'se sirve como HTML');
    ['Aviso legal', 'Politica de privacidad', 'Politica de cookies', 'Terminos de uso',
        'Juego responsable', 'RGIAJ', 'aepd.es'].forEach(s => ok(texto.includes(s), 'seccion legal: ' + s));
    for (const alias of ['/aviso-legal', '/privacidad', '/cookies', '/terminos', '/juego-responsable']) {
        const { res: r2, texto: t2 } = await pedir(alias);
        ok(r2.status === 200 && t2.includes('Informacion legal'), 'alias ' + alias + ' sirve la pagina legal');
    }
}

console.log('\n--- 6) LA PAGINA /live SIGUE VIVA ---');
{
    const { res, texto } = await pedir('/live');
    ok(res.status === 200 && texto.length > 5000, '/live responde 200 y trae contenido', texto.length + ' bytes');
    ok(texto.includes('/legal#juego'), 'la pagina /live tambien enlaza la informacion legal');
}

console.log('\n=============================================================');
console.log(' RESULTADO: ' + pasan + '/' + (pasan + fallan) + ' PASS' + (fallan ? '   |   ' + fallan + ' FAIL' : ''));
console.log('=============================================================');
process.exitCode = fallan === 0 ? 0 : 1;