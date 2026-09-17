// =============================================================================
// EXTRACTOR RATINGBET (modulo compartido)
// -----------------------------------------------------------------------------
// Este fichero cumple dos funciones:
//   1. EXTRACTOR_FN: funcion AUTOCONTENIDA que se inyecta en la pagina con
//      page.evaluate(). Es la MISMA que se usa en produccion y en los tests
//      offline (tools_valida_extractor.js), para que lo validado sea lo que corre.
//   2. Utilidades Node: conversion de hora local Madrid -> UTC real, resolucion
//      de local/visitante a partir del slug canonico y fusion de lineas 1.5/2.5.
//
// ESTRUCTURA REAL DE UNA FILA (verificada sobre HTML de ratingbet.com):
//   <div class="match-item match-item_predictions ...">          <- contenedor
//     <a class="match-item__link" href="/football/match/A-vs-B/"> <- slug canonico
//       <span class="match-item__time">19:00</span>
//       <div class="match-item__team host|guest">
//         <span class="team-header__team-title">Nombre</span>
//         <div class="team-score planed">-</div>       <- "-" = no jugado
//     </a>
//     <div class="match-item__markets">
//       <div class="match-item-market math">            <- 1a columna = OVER
//         <span class="match-item-market__odd">1.26</span>
//       <div class="match-item-market math">            <- 2a columna = UNDER
//         <span class="match-item-market__odd block_white-border">3.4</span>
//       <div class="match-item-market line math">       <- LA LINEA (1.5 / 2.5)
//     <div class="match-value-tip">
//       <div class="match-value-tip__market">Total : O1.5</div>   <- BEST TIP
//       <span class="match-value-tip__winrate-value">73%</span>
//   </div>
//
// AGRUPACION POR LIGA (clases reales verificadas):
//   <div class="robobet-game-section js-sticky-section by-league ...">
//     <div class="robobet-game-section__head-wrapper"> ... </div>
//     <div class="robobet-game-section__title mb-16">
//       <a class="robobet-game-section__tournament-link" href="/football/spain-laliga/">
//         <span class="section-title">Spain: LaLiga Spain</span>
//
// ZONA HORARIA: la pagina declara data-user-timezone="auto", es decir, renderiza
//   las horas en la zona del NAVEGADOR. Por eso el scraper fija
//   Europe/Madrid + idioma es-ES, y asi "19:00" es hora de Madrid garantizada.
//   La fecha se toma de la URL (que ya es la fecha de Madrid) y no del reloj.
// =============================================================================

export const EXTRACTOR_FN = function () {
    const norm = (t) => (t || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    const num = (t) => {
        const n = parseFloat(norm(t).replace('%', '').replace(',', '.'));
        return Number.isFinite(n) ? n : null;
    };

    return Array.from(document.querySelectorAll('.match-item')).map(function (fila) {
        const link = fila.querySelector('a.match-item__link[href], [data-href]');
        const url = link ? (link.getAttribute('href') || link.getAttribute('data-href')) : null;

        // Equipos: el DOM NO garantiza el orden local/visitante (se verifica en
        // Node contra el slug). Aqui solo se recoge el orden de presentacion.
        const equipos = Array.from(fila.querySelectorAll('.team-header__team-title'))
            .map(function (e) { return norm(e.textContent); });

        // Mercados: las columnas con class "math" (sin "line") son Over y Under,
        // en ese orden. La columna "line" contiene la linea de goles.
        const columnas = Array.from(fila.querySelectorAll('.match-item-market')).filter(function (m) {
            return m.classList.contains('math') && !m.classList.contains('line');
        }).map(function (m) {
            const oddEl = m.querySelector('.match-item-market__odd');
            const pctEl = m.querySelector('.match-item-market__percent');
            return { cuota: oddEl ? num(oddEl.textContent) : null, probPct: pctEl ? num(pctEl.textContent) : null };
        });

        const lineEl = fila.querySelector('.match-item-market.line .match-item-market__odd');
        const tipEl = fila.querySelector('.match-value-tip__market');
        const tipOddEl = fila.querySelector('.match-value-tip__odd');
        const tipProbEl = fila.querySelector('.match-value-tip__winrate-value');

        // Puntuacion: "-" o "planed" significa NO jugado (partido futuro)
        const scores = Array.from(fila.querySelectorAll('.team-score'))
            .map(function (e) { return norm(e.textContent); });

        // Liga: ancestro .robobet-game-section (en versiones antiguas, .game-section)
        let sec = null;
        if (fila.closest) {
            sec = fila.closest('.robobet-game-section') || fila.closest('.game-section');
        }
        if (!sec) {
            let el = fila.parentElement;
            while (el && !sec) {
                if (el.className && /(^|\s)\S*game-section(\s|$)/.test(el.className.toString())) sec = el;
                el = el.parentElement;
            }
        }
        const ligaEl = sec ? sec.querySelector('.robobet-game-section__tournament-link, .game-section__tournament-link') : null;
        const ligaTexto = ligaEl ? ligaEl.querySelector('.section-title') : null;
        const ligaTitulo = sec ? sec.querySelector('.robobet-game-section__title, .game-section__title') : null;
        const liga = ligaTexto ? norm(ligaTexto.textContent)
            : (ligaEl ? norm(ligaEl.textContent)
                : (ligaTitulo ? norm(ligaTitulo.textContent) : null));

        return {
            url: url,
            hora: norm((fila.querySelector('.match-item__time') || {}).textContent),
            equipos: equipos,
            over: columnas[0] || null,
            under: columnas[1] || null,
            linea: lineEl ? norm(lineEl.textContent) : null,
            tip: tipEl ? norm(tipEl.textContent).replace(/^Total\s*:?\s*/i, '') : null,
            tipCuota: tipOddEl ? num(tipOddEl.textContent) : null,
            tipProbPct: tipProbEl ? num(tipProbEl.textContent) : null,
            liga: liga,
            ligaUrl: ligaEl ? ligaEl.getAttribute('href') : null,
            scores: scores,
            jugado: scores.length > 0 && scores.some(function (s) { return /^\d+$/.test(s); })
        };
    }).filter(function (f) { return f.url && f.hora && f.equipos.length >= 2; });
};

export const TZ_MADRID = 'Europe/Madrid';

// -----------------------------------------------------------------------------
// UTILIDADES NODE
// -----------------------------------------------------------------------------

export function pad2(n) { return (n < 10 ? '0' : '') + n; }

// Descompone un instante en el calendario/reloj reales de Madrid
export function partesMadrid(ms) {
    const out = {};
    new Intl.DateTimeFormat('en-GB', {
        timeZone: TZ_MADRID, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).formatToParts(new Date(ms)).forEach(function (p) { if (p.type !== 'literal') out[p.type] = p.value; });
    return {
        year: parseInt(out.year, 10), month: parseInt(out.month, 10), day: parseInt(out.day, 10),
        hour: parseInt(out.hour, 10) % 24, minute: parseInt(out.minute, 10), second: parseInt(out.second, 10) % 60
    };
}

// Hora de reloj de pared de Madrid -> instante UTC real (iterativo: soporta DST)
export function madridWallClockAUtcMs(year, month, day, hour, minute) {
    const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
    let ts = wallAsUtc;
    for (let i = 0; i < 3; i++) {
        const p = partesMadrid(ts);
        const partsAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0);
        ts = wallAsUtc - (partsAsUtc - ts);
    }
    return ts;
}

// Fecha de Madrid en formato YYYY-MM-DD (la que usan las URLs de ratingbet)
export function fechaMadridISO(ms) {
    const p = partesMadrid(ms);
    return p.year + '-' + pad2(p.month) + '-' + pad2(p.day);
}

export function normalizarTexto(s) {
    return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');
}

// Local/visitante FIABLE: el slug de la URL es "local-vs-visitante" (verificado:
// en ratingbet el DOM invierte el orden en ~57% de las filas, el slug no).
export function resolverLocalVisitante(equipos, url) {
    const fallback = { local: equipos[0] || '', visitante: equipos[1] || '', coincideSlug: null, confianza: 0 };
    const m = String(url || '').match(/\/match\/([^/]+)\/?$/);
    if (!m || equipos.length < 2) return fallback;

    const partes = m[1].split('-vs-');
    if (partes.length !== 2) return fallback;

    const A = partes[0].replace(/-\d+$/, '');  // quita sufijos de deduplicacion (-2)
    const B = partes[1].replace(/-\d+$/, '');
    const nA = normalizarTexto(A), nB = normalizarTexto(B);
    const nEq = equipos.map(normalizarTexto);

    const puntua = (slugNorm, equipoNorm) => {
        if (!slugNorm || !equipoNorm) return 0;
        if (slugNorm === equipoNorm) return 100;
        if (slugNorm.includes(equipoNorm) || equipoNorm.includes(slugNorm)) return 80;
        const palabras = slugNorm.match(/[a-z0-9]{3,}/g) || [];
        const hits = palabras.filter(p => equipoNorm.includes(p)).length;
        return hits > 0 ? 40 + hits * 10 : 0;
    };

    const pDirecto = puntua(nA, nEq[0]) + puntua(nB, nEq[1]);
    const pInverso = puntua(nA, nEq[1]) + puntua(nB, nEq[0]);

    if (pDirecto === 0 && pInverso === 0) return fallback;
    if (pInverso > pDirecto) {
        return { local: equipos[1], visitante: equipos[0], coincideSlug: false, confianza: pInverso };
    }
    return { local: equipos[0], visitante: equipos[1], coincideSlug: true, confianza: pDirecto };
}
// -----------------------------------------------------------------------------
// NORMALIZACION Y FUSION DE LAS DOS LISTAS (1.5 y 2.5) POR PARTIDO
// -----------------------------------------------------------------------------
export function clavePartido(url) {
    const m = String(url || '').match(/\/match\/([^/]+)\/?$/);
    return m ? m[1].replace(/-\d+$/, '') : String(url || '');
}

// Convierte una fila extraida + fecha de pagina en un partido normalizado
export function normalizarPartido(fila, fechaISO, linea, meta) {
    const r = resolverLocalVisitante(fila.equipos, fila.url);
    const hm = String(fila.hora || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!hm) return null;

    const y = parseInt(fechaISO.slice(0, 4), 10);
    const mo = parseInt(fechaISO.slice(5, 7), 10);
    const d = parseInt(fechaISO.slice(8, 10), 10);
    const kickoffMs = madridWallClockAUtcMs(y, mo, d, parseInt(hm[1], 10), parseInt(hm[2], 10));

    // El tip ("O1.5"/"U2.5") confirma que columna es Over. Si no cuadra con la
    // primera columna, se comprueba si el sitio las invirtio antes de descartar.
    const tipNorm = String(fila.tip || '').toUpperCase();
    let over = fila.over, under = fila.under;
    if (fila.tipCuota !== null && /^U/.test(tipNorm)) {
        if (under && under.cuota === fila.tipCuota) {
            // coherente: 1a columna = Over
        } else if (over && over.cuota === fila.tipCuota) {
            const tmp = over; over = under; under = tmp;
        }
    }

    return {
        clave: clavePartido(fila.url),
        urlRelativa: fila.url,
        liga: fila.liga || 'LIGA DESCONOCIDA',
        ligaUrl: fila.ligaUrl || null,
        local: r.local,
        visitante: r.visitante,
        fecha: fechaISO,
        hora: fila.hora,
        kickoffIsoUtc: new Date(kickoffMs).toISOString(),
        kickoffMs: kickoffMs,
        zonaHoraria: TZ_MADRID,
        linea: linea,
        cuotaOver: over ? over.cuota : null,
        probCasaOverPct: over ? over.probPct : null,
        cuotaUnder: under ? under.cuota : null,
        probCasaUnderPct: under ? under.probPct : null,
        tip: fila.tip || null,
        tipCuota: fila.tipCuota,
        tipProbPct: fila.tipProbPct,
        jugado: !!fila.jugado,
        ordenDomCoincideSlug: r.coincideSlug,
        confianzaEquipos: r.confianza,
        capturadoEnUtc: meta.capturadoEnUtc,
        capturadoEnMadrid: meta.capturadoEnMadrid,
        origen: 'ratingbet.com (navegador real, zona horaria Europe/Madrid)'
    };
}

// Fusiona las dos listas: un unico partido con cuotas 1.5 y 2.5
export function fusionarLineas(partidos15, partidos25) {
    const mapa = new Map();
    const pon = (p) => {
        const actual = mapa.get(p.clave) || {
            clave: p.clave, url: p.urlRelativa, liga: p.liga, ligaUrl: p.ligaUrl,
            local: p.local, visitante: p.visitante, fecha: p.fecha, hora: p.hora,
            kickoffIsoUtc: p.kickoffIsoUtc, kickoffMs: p.kickoffMs,
            zonaHoraria: p.zonaHoraria, jugado: p.jugado,
            ordenDomCoincideSlug: p.ordenDomCoincideSlug, confianzaEquipos: p.confianzaEquipos,
            capturadoEnUtc: p.capturadoEnUtc, origen: p.origen, lineas: {}
        };
        actual.lineas['' + p.linea] = {
            linea: p.linea,
            cuotaOver: p.cuotaOver, probCasaOverPct: p.probCasaOverPct,
            cuotaUnder: p.cuotaUnder, probCasaUnderPct: p.probCasaUnderPct,
            tip: p.tip, tipCuota: p.tipCuota, tipProbPct: p.tipProbPct
        };
        if (p.jugado) actual.jugado = true;
        mapa.set(p.clave, actual);
    };
    partidos15.forEach(pon);
    partidos25.forEach(pon);
    return Array.from(mapa.values()).sort((a, b) => a.kickoffMs - b.kickoffMs);
}

// -----------------------------------------------------------------------------
// VALIDACION TEMPORAL: descarta partidos ya empezados o fuera de ventana
// -----------------------------------------------------------------------------
export function validarTemporal(partidos, opciones) {
    const opt = opciones || {};
    const ahora = opt.ahoraMs || Date.now();
    const margenMin = opt.margenMinutos !== undefined ? opt.margenMinutos : 30;
    const maxDias = opt.maxDias !== undefined ? opt.maxDias : 14;

    const aceptados = [], descartados = [];
    const limite = ahora + margenMin * 60 * 1000;
    const tope = ahora + maxDias * 86400000;

    for (const p of partidos) {
        let motivo = null;
        if (!p.kickoffMs || !Number.isFinite(p.kickoffMs)) motivo = 'sin-fecha-valida';
        else if (p.jugado) motivo = 'partido-ya-jugado';
        else if (p.kickoffMs < limite) motivo = 'ya-empezado-o-inminente (margen ' + margenMin + 'min)';
        else if (p.kickoffMs > tope) motivo = 'fuera-de-ventana (>' + maxDias + ' dias)';
        if (motivo) descartados.push({ clave: p.clave, local: p.local, visitante: p.visitante, hora: p.hora, motivo: motivo });
        else aceptados.push(p);
    }
    return {
        aceptados: aceptados,
        descartados: descartados,
        resumen: {
            total: partidos.length, aceptados: aceptados.length, descartados: descartados.length,
            ahoraUtc: new Date(ahora).toISOString(),
            ahoraMadrid: new Intl.DateTimeFormat('es-ES', { timeZone: TZ_MADRID, dateStyle: 'short', timeStyle: 'medium' }).format(new Date(ahora)),
            margenMinutos: margenMin, maxDias: maxDias
        }
    };
}