// =============================================================================
// LANZADOR DE PRUEBAS (una sola orden, con codigo de salida real)
// -----------------------------------------------------------------------------
// Ejecuta todas las suites del proyecto en orden, muestra el resumen y sale con
// codigo distinto de cero si alguna falla. Antes no existia: algunas suites
// imprimian FAIL y terminaban en 0, asi que un despliegue podia publicarse con
// pruebas rojas sin que nadie se enterara.
//
// USO
//   node tools_run_tests.js
//   node tools_run_tests.js --solo=parlays      (filtra por fragmento de nombre)
//   npm test
// =============================================================================
import { spawnSync } from 'child_process';
import fs from 'fs';

const SUITES = [
    { fichero: 'test_ratingbet_extractor.js', que: 'extractor de filas del DOM' },
    { fichero: 'test_ratingbet_pipeline.js', que: 'pipeline dataset real -> pool publicable' },
    { fichero: 'test_parlays_riesgo.js', que: 'combinadas por nivel de riesgo' },
    { fichero: 'test_dataset_remoto.js', que: 'carga del dataset remoto (nube)' },
    { fichero: 'test_client_render.js', que: 'render del cliente (sin null%)' },
    { fichero: 'test_acceso_libre.js', que: 'acceso libre + pagina legal (+18, privacidad, cookies)' },
    { fichero: 'test_temporal_validation.js', que: 'validacion temporal (motor v3)' },
    { fichero: 'test_health_endpoint.js', que: '/api/health (contrato v3)' },
    { fichero: 'test_frontend_validation.js', que: 'validacion del frontend' },
    { fichero: 'test_laliga_premier_filter.js', que: 'filtrado LaLiga/Premier, Edge y privacidad' }
];

const filtro = (() => {
    const hit = process.argv.find(a => a.startsWith('--solo='));
    return hit ? hit.split('=')[1] : '';
})();

const resultados = [];
console.log('=============================================================');
console.log(' SUITE COMPLETA DE PRUEBAS');
console.log('=============================================================');

for (const s of SUITES) {
    if (filtro && s.fichero.indexOf(filtro) === -1) continue;
    if (!fs.existsSync(s.fichero)) {
        resultados.push({ ...s, estado: 'AUSENTE', detalle: 'el fichero no existe' });
        console.log('\n--- ' + s.fichero + ' -> AUSENTE');
        continue;
    }

    const t0 = Date.now();
    const r = spawnSync(process.execPath, [s.fichero], { encoding: 'utf-8', timeout: 180000 });
    const salida = String(r.stdout || '') + String(r.stderr || '');
    const ms = Date.now() - t0;
    const resumen = (salida.match(/RESULTADO:.*/g) || []).pop()
        || (salida.match(/\d+\/\d+ (PASS|COMPROBACIONES)/g) || []).pop()
        || (salida.match(/OK \(skip\).*/g) || []).pop()
        || '';
    const skip = /SKIP/i.test(salida) || /no se ejecuta/i.test(salida);

    let estado;
    if (r.status === 0) estado = skip ? 'SKIP' : 'OK';
    else estado = 'FALLO';

    resultados.push({ ...s, estado, detalle: (resumen || 'sin resumen').trim(), ms: ms });

    console.log('\n--- ' + s.fichero + '  [' + estado + ']  (' + ms + ' ms)');
    console.log('    ' + s.que);
    if (resumen) console.log('    ' + (resumen || '').trim());
    if (estado === 'FALLO') {
        const fallos = (salida.match(/^\s*(FAIL|FALLO)[^\n]*/gm) || []).slice(0, 8);
        fallos.forEach(f => console.log('   ' + f.trim()));
        if (!fallos.length) console.log('    ' + salida.trim().split('\n').slice(-6).join('\n    '));
    }
}

const cuenta = { OK: 0, SKIP: 0, FALLO: 0, AUSENTE: 0 };
resultados.forEach(r => { cuenta[r.estado] = (cuenta[r.estado] || 0) + 1; });

console.log('\n=============================================================');
console.log(' RESUMEN: ' + cuenta.OK + ' OK | ' + cuenta.SKIP + ' SKIP | '
    + cuenta.FALLO + ' FALLO | ' + cuenta.AUSENTE + ' AUSENTE');
resultados.filter(r => r.estado === 'FALLO' || r.estado === 'AUSENTE')
    .forEach(r => console.log('   - ' + r.fichero + ' [' + r.estado + '] ' + r.detalle));
console.log('=============================================================');
process.exitCode = (cuenta.FALLO === 0 && cuenta.AUSENTE === 0) ? 0 : 1;