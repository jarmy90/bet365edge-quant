// PRUEBA DE INTEGRACION OFFLINE: llama al worker real con env local (sin IA,
// dataset embebido del scraper) y comprueba los endpoints de combinadas.
import worker from './worker.js';

const env = {}; // sin OMNIROUTE_API_KEY -> modo solo-cuotas-reales (honesto)
const rutas = [
    '/api/version',
    '/api/parlays-by-risk?risk=bajo',
    '/api/parlays-by-risk?risk=medio',
    '/api/parlays-by-risk?risk=alto'
];

for (const ruta of rutas) {
    const res = await worker.fetch(new Request('https://test.local' + ruta), env, {});
    const j = await res.json();
    console.log('\n=== ' + ruta + ' -> HTTP ' + res.status + ' ===');
    if (ruta === '/api/version') {
        console.log('build:', j.build, '| fixturesFuturos:', j.fixturesFuturos);
        continue;
    }
    console.log('estado:', j.estado, '| riesgo:', j.nombreRiesgo, '| banda:', j.banda);
    if (j.estado === 'ok') {
        console.log('cuotaTotal:', j.cuotaTotal, '| probReal:', j.probabilidadReal + '%',
            '| probCasa:', j.probabilidadCasa + '%', '| edge:', j.edgeTotal, '| base:', j.probBase);
        j.picks.forEach(p => console.log('   ' + p.orden + ') ' + p.partido + ' — ' + p.mercado +
            ' @ ' + p.cuota.toFixed(2) + ' [' + p.probEtiqueta + ' ' + p.probPct + '%] ' + p.horaLabel));
        const prod = Math.round(j.picks.reduce((a, p) => a * p.cuota, 1) * 100) / 100;
        console.log('verificacion producto = ' + prod + (prod === j.cuotaTotal ? ' (OK)' : ' (MISMATCH!)'));
        // ninguna probabilidad nula pintable
        const nulos = j.picks.filter(p => p.probPct === null || p.probPct === undefined).length;
        console.log('picks con prob nula: ' + nulos + (nulos === 0 ? ' (OK)' : ' (FALLO)'));
    } else {
        console.log('motivo:', j.motivo, '| advertencia:', (j.advertenciaTemporal || '').slice(0, 120));
    }
}