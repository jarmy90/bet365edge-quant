// =============================================================================
// PIPELINE RATINGBET -> POOL PUBLICABLE
// -----------------------------------------------------------------------------
// Convierte el dataset capturado por scrape_ratingbet.js (partidos REALES con
// cuotas REALES 1.5 y 2.5) en el pool que publica /api/fixtures-hoy.
//
// PRINCIPIOS DE DISENO (por que esto arregla los "partidos de ayer"):
//   1. El pool se construye SOLO desde el dataset capturado. La IA no inventa
//      partidos: recibe la lista real y solo EMITE VEREDICTOS sobre ella
//      (clave + linea + lado + probabilidad). Si la IA alucina una clave que no
//      existe, el veredicto se descarta. Asi es imposible publicar un fixture
//      ficticio.
//   2. PUERTA DE FRESCURA: si el dataset tiene mas de MAX_ANTIGUEDAD_MIN
//      minutos, NO se publica nada. Un catalogo congelado re-fechado era
//      exactamente el bug original; aqui preferimos vacio + aviso.
//   3. Validacion temporal por partido: kickoff >= ahora + margen de seguridad.
//   4. La zona horaria es Europe/Madrid de extremo a extremo (la web declara
//      data-user-timezone="auto", asi que el scraper fija ese huso).
//
// Este modulo es PURO (sin red, sin DOM): se puede testear sin navegador.
// =============================================================================
import {
    TZ_MADRID, partesMadrid, fechaMadridISO, normalizarTexto
} from './ratingbet_extract.js';

export { TZ_MADRID };

export const RATINGBET_FUENTE = 'ratingbet.com (1.5 + 2.5, scraper con navegador real, huso Europe/Madrid)';

// Puerta de frescura: cuanto puede envejecer la captura antes de dejar de publicarse
export const MAX_ANTIGUEDAD_MIN = 180;      // 3 horas (umbral de AVISO, no de bloqueo)
export const MAX_ANTIGUEDAD_CRITICA_MIN = 20160; // 14 dias: bloqueo solo si el dataset es absurdamente viejo
export const MARGEN_SEGURIDAD_MIN = 30;     // no publicar lo que empieza en < 30 min
export const MAX_VENTANA_DIAS = 14;         // anti-fechas absurdas
export const MAX_PUBLICADOS = 24;           // tope de fixtures en la tabla

// Filtro mínimo: acepta TODO lo que ratingbet publica excepto partidos
// irrelevantes (amistosos, reservas, sub-17/19/21, competiciones de islas
// sin liquidez). El negocio es el edge sobre las cuotas reales de ratingbet,
// no una selección de ligas.
export const ALLOWED_LEAGUE_IDS = ['all-ratingbet'];

export function esLigaTopPermitida(match) {
    if (!match) return false;
    const liga = String(match.liga || match.league || match.ligaCorta || '').toLowerCase();
    const url  = String(match.urlRelativa || match.ligaUrl || match.url || '').toLowerCase();
    const combined = (liga + ' ' + url).toLowerCase();

    // Solo excluimos lo que NO tiene valor de apuesta:
    const exclusiones = [
        'friendly', 'amistoso', 'friendlies',
        'reserve', 'reserves', 'reserva',
        'youth', 'juvenil', 'juvenil',
        'u17', 'u18', 'u19', 'u20', 'u21', 'u23',
        'femenino', 'women', 'feminine', 'femeni',
        'beach soccer', 'futsal', 'indoor',
        'virtual', 'esport'
    ];
    return !exclusiones.some(ex => combined.includes(ex));
}

export function filtrarSoloLigasTop(partidos) {
    if (!Array.isArray(partidos)) return [];
    return partidos.filter(esLigaTopPermitida);
}



const DIAS_ES = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];

function pad2(n) { return (n < 10 ? '0' : '') + n; }

export function probImplicita(cuota) {
    const c = parseFloat(cuota);
    return (Number.isFinite(c) && c > 1) ? (100 / c) : null;
}

// Margen (overround) de la casa en un mercado de dos lados, en %
export function margenCasa(pOver, pUnder) {
    if (pOver === null || pUnder === null) return null;
    return Math.round((pOver + pUnder - 100) * 100) / 100;
}

// Probabilidad "justa" (sin margen) a partir de las cuotas de ratingbet
export function probJusta(cuotaLado, cuotaContraria) {
    const a = probImplicita(cuotaLado);
    const b = probImplicita(cuotaContraria);
    if (a === null || b === null) return null;
    const suma = a + b;
    if (suma <= 0) return null;
    return Math.round((a / suma) * 1000) / 10;
}

export function etiquetaDia(nowMs, targetMs) {
    const a = partesMadrid(nowMs), b = partesMadrid(targetMs);
    if (a.year === b.year && a.month === b.month && a.day === b.day) return 'Hoy';
    const manana = partesMadrid(nowMs + 86400000);
    if (manana.year === b.year && manana.month === b.month && manana.day === b.day) return 'Mañana';
    return DIAS_ES[new Date(targetMs).getUTCDay()];
}

export function ligaCorta(liga) {
    const partes = String(liga || '').split(':');
    return partes.length === 2 ? (partes[1].trim() + ' • ' + partes[0].trim()) : String(liga || '').trim();
}

// Normaliza cualquiera de los dos formatos de dataset que escriben las
// herramientas (scrape_ratingbet.js y tools_valida_extractor.js)
export function normalizarDataset(dataset) {
    const d = dataset || {};
    const partidos = Array.isArray(d.PARTIDOS) ? d.PARTIDOS : (Array.isArray(d.partidos) ? d.partidos : []);
    const fuenteBruta = (d.CAPTURA && d.CAPTURA.fuente) || (typeof d.fuente === 'object' ? d.fuente : null) || {};
    // Marca de captura: se acepta tanto fuente.generadoEnUtc (scraper) como el
    // generadoEn de nivel superior (herramienta de validacion offline).
    const generadoEnUtc = fuenteBruta.generadoEnUtc || d.generadoEn || null;
    const fuente = Object.assign({}, fuenteBruta, { generadoEnUtc: generadoEnUtc });
    return { partidos: partidos, fuente: fuente || {} };
}

// -----------------------------------------------------------------------------
// 2) PROMPT OMNIROUTE: la IA NO descubre partidos, solo EMITE VEREDICTOS
//    Recibe los candidatos reales con cuotas reales y decide, por cada uno, si
//    hay edge y de que lado. Cualquier clave inventada se descarta al aplicar.
// -----------------------------------------------------------------------------
export function systemPromptEdge() {
    return [
        'Eres el motor cuantitativo de edge de una terminal de apuestas Over/Under.',
        'Recibiras una lista de partidos REALES con cuotas REALES de casa (mercados 1.5 y 2.5).',
        'NO inventes partidos ni cuotas: solo puedes emitir veredictos sobre las claves ("clave") que recibas.',
        'Responde EXCLUSIVAMENTE con un objeto JSON valido, sin prosa ni vallas de codigo.',
        'METODO (obligatorio, en este orden):',
        '1. Convierte cada cuota en probabilidad implicita: p = 100 / cuota.',
        '2. Normaliza el margen de la casa (overround) dividiendo cada p por la suma de las dos p del mismo mercado.',
        '3. Estima TU probabilidad con criterio cuantitativo: medias de goles por equipo, ritmo anotador reciente,',
        '   contexto (local/visitante), estilo defensivo/ofensivo, y el tip publicado por la casa solo como referencia secundaria.',
        '4. edge = tu probabilidad - probabilidad justa del mercado. Si ambos lados tienen |edge| < 1.5 puntos, descarta el partido.',
        '5. Selecciona SIEMPRE el lado con mayor edge positivo. Si no hay edge positivo claro, descarta.',
        '6. Se conservador: es mejor devolver 3 veredictos solidos que 30 inventados.',
        'FORMATO DE SALIDA:',
        '{"veredictos":[{"clave":"slug-del-partido","linea":"1.5","lado":"OVER","probModelo":88.4,',
        '"confianza":"ALTA","horasRestantes":12.3,"argumento":"2 frases con fundamento estadistico"}],',
        '"descartados":[{"clave":"slug","motivo":"sin edge suficiente"}]}',
        '"confianza" solo admite ALTA, MEDIA-ALTA o MEDIA.',
        'Si no puedes evaluar nada con criterio, devuelve {"veredictos":[],"descartados":[]}.'
    ].join('\n');
}

// Mensaje de usuario con los candidatos REALES (payload compacto y auditable)
export function userPromptEdge(candidatos, nowMs) {
    const reducidos = candidatos.map(function (c) {
        const salida = {
            clave: c.clave,
            partido: c.partido,
            liga: c.liga,
            local: c.local,
            visitante: c.visitante,
            kickoffIsoUtc: c.kickoffIsoUtc,
            horaMadrid: c.horaLabel,
            horasRestantes: c.horasRestantes,
            mercados: {}
        };
        ['1.5', '2.5'].forEach(function (L) {
            const l = c.lineas && c.lineas[L];
            if (l && l.cuotaOver !== null) {
                salida.mercados['o' + L] = {
                    cuotaOver: l.cuotaOver,
                    cuotaUnder: l.cuotaUnder,
                    probCasaOver: l.pOverCasa,
                    probJustaOver: l.pOverJusta,
                    margenCasa: l.margenCasa,
                    tipCasa: l.tipRatingbet
                };
            }
        });
        return salida;
    });

    return [
        'INSTANTE DE EJECUCION (UTC): ' + new Date(nowMs).toISOString(),
        'ZONA HORARIA DE NEGOCIO: ' + TZ_MADRID,
        'PARTIDOS REALES VALIDADOS (todos con kickoff futuro; NO los cambies):',
        JSON.stringify({ partidos: reducidos }),
        'Emite ahora tu objeto JSON de veredictos.'
    ].join('\n');
}

// Extrae el objeto JSON de la respuesta del LLM (tolerante a prosa y vallas)
export function parseVeredictos(texto) {
    if (!texto || typeof texto !== 'string') return null;
    const limpio = texto.replace(/```json/gi, '').replace(/```/g, '').trim();
    const intentos = [limpio];
    const i = limpio.indexOf('{'), j = limpio.lastIndexOf('}');
    if (i !== -1 && j > i) intentos.push(limpio.slice(i, j + 1));
    for (const t of intentos) {
        try {
            const p = JSON.parse(t);
            if (p && (Array.isArray(p.veredictos) || Array.isArray(p.descartados))) return p;
        } catch (e) { /* siguiente intento */ }
    }
    return null;
}
// -----------------------------------------------------------------------------
// 1) CANDIDATOS: partidos REALES con cuotas REALES, filtrados temporalmente
// -----------------------------------------------------------------------------

export function construirCandidatos(dataset, nowMs, opts) {
    const o = opts || {};
    const margenMin = o.margenMinutos !== undefined ? o.margenMinutos : MARGEN_SEGURIDAD_MIN;
    const maxDias = o.maxDias !== undefined ? o.maxDias : MAX_VENTANA_DIAS;
    const maxAntiguedadMin = o.maxAntiguedadMin !== undefined ? o.maxAntiguedadMin : MAX_ANTIGUEDAD_MIN;

    const { partidos, fuente } = normalizarDataset(dataset);
    const diag = {
        recibidos: partidos.length,
        aceptados: 0,
        descartados: 0,
        motivos: {},
        capturaUtc: null,
        capturaEdadMin: null,
        capturaFresca: false,
        origenDatos: RATINGBET_FUENTE
    };

    // Marca de captura: la primera fecha valida disponible en el dataset
    let capturaMs = null;
    const candidatasFecha = [fuente.generadoEnUtc, fuente.generadoEn, partidos[0] && partidos[0].capturadoEnUtc];
    for (const c of candidatasFecha) {
        const t = Date.parse(c);
        if (Number.isFinite(t)) { capturaMs = t; break; }
    }
    if (capturaMs !== null) {
        diag.capturaUtc = new Date(capturaMs).toISOString();
        diag.capturaEdadMin = Math.round((nowMs - capturaMs) / 60000);
        diag.capturaFresca = diag.capturaEdadMin <= maxAntiguedadMin;
    }

    const pool = [];
    const vistos = Object.create(null);
    const margenMs = margenMin * 60000;
    const horizonteMs = maxDias * 86400000;

    function rechazar(motivo) {
        diag.descartados++;
        diag.motivos[motivo] = (diag.motivos[motivo] || 0) + 1;
    }

    // ---------------------------------------------------------------------------
    // FRESCURA DEL DATASET: SEÑAL, NO BLOQUEO
    // ---------------------------------------------------------------------------
    // La GARANTIA DE CORRECCION (nunca publicar un partido ya empezado) la da la
    // re-validacion POR PARTIDO en tiempo de peticion (MARGEN_PUBLICACION_MIN).
    // Bloquear todo el pool por antiguedad del dataset vaciaba la web a las 3 h,
    // aunque la mayoria de partidos siguieran siendo futuros y perfectamente
    // publicables. Por eso:
    //   - dataset mas viejo que MAX_ANTIGUEDAD_CRITICA_MIN -> SI se bloquea
    //     (el catalogo ya no representa nada util)
    //   - entre MAX_ANTIGUEDAD_MIN y el limite critico -> se publica lo que siga
    //     siendo futuro, con AVISO auditable
    //   - sin marca de captura -> se bloquea (no se puede auditar la procedencia)
    if (capturaMs === null) {
        // Sin marca de captura: añadir advertencia pero NO bloquear.
        // La validacion por partido (kickoffMs > ahora) es la guardia real.
        diag.advertenciaDataset = 'Dataset sin marca de captura: no se puede auditar la procedencia. Conviene relanzar el scraper.';
    }

    if (capturaMs !== null && diag.capturaEdadMin > MAX_ANTIGUEDAD_CRITICA_MIN) {
        // Solo bloquear si el dataset es absurdamente viejo (> 14 dias)
        diag.motivoBloqueo = 'dataset-caducado-critico (' + diag.capturaEdadMin + ' min > ' + MAX_ANTIGUEDAD_CRITICA_MIN + ' min = 14 dias)';
        diag.descartados = partidos.length;
        diag.motivos['dataset-caducado-critico'] = partidos.length;
        return { candidatos: [], diag: diag };
    }

    if (!diag.capturaFresca) {
        // Se continua: la re-validacion por partido descartara lo ya comenzado.
        diag.advertenciaDataset = 'Dataset de ratingbet con ' + diag.capturaEdadMin +
            ' min de antiguedad (umbral de frescura: ' + maxAntiguedadMin +
            ' min). Se publican solo los partidos que siguen siendo futuros; conviene relanzar el scraper.';
    }

    for (const p of partidos) {
        const clave = String(p.clave || '');
        if (!clave || vistos[clave]) { rechazar('duplicado'); continue; }

        const kickoffMs = Number.isFinite(p.kickoffMs) ? p.kickoffMs : Date.parse(p.kickoffIsoUtc);
        if (!Number.isFinite(kickoffMs)) { rechazar('sin-kickoff'); continue; }
        if (p.jugado) { rechazar('ya-jugado'); continue; }
        if (kickoffMs < nowMs + margenMs) { rechazar('pasado-o-dentro-del-margen'); continue; }
        if (kickoffMs > nowMs + horizonteMs) { rechazar('fuera-de-horizonte'); continue; }

        const lineas = p.lineas || {};
        const tiene15 = lineas['1.5'] && probImplicita(lineas['1.5'].cuotaOver) !== null;
        const tiene25 = lineas['2.5'] && probImplicita(lineas['2.5'].cuotaOver) !== null;
        if (!tiene15 && !tiene25) { rechazar('sin-cuotas-utilizables'); continue; }
        if (!p.local || !p.visitante) { rechazar('equipos-incompletos'); continue; }

        vistos[clave] = true;
        const k = partesMadrid(kickoffMs);
        const hora = pad2(k.hour) + ':' + pad2(k.minute);
        const fechaCorta = pad2(k.day) + '/' + pad2(k.month);

        function prepararLinea(l) {
            if (!l) return null;
            const pOver = probImplicita(l.cuotaOver);
            const pUnder = probImplicita(l.cuotaUnder);
            return {
                linea: l.linea,
                cuotaOver: l.cuotaOver,
                cuotaUnder: l.cuotaUnder,
                pOverCasa: pOver === null ? null : Math.round(pOver * 10) / 10,
                pUnderCasa: pUnder === null ? null : Math.round(pUnder * 10) / 10,
                pOverJusta: probJusta(l.cuotaOver, l.cuotaUnder),
                pUnderJusta: probJusta(l.cuotaUnder, l.cuotaOver),

                margenCasa: margenCasa(pOver, pUnder),
                tipRatingbet: l.tip || null,
                tipProbPct: l.tipProbPct === undefined ? null : l.tipProbPct
            };
        }

        pool.push({
            clave: clave,
            partido: p.local + ' vs ' + p.visitante,
            local: p.local,
            visitante: p.visitante,
            liga: p.liga || 'LIGA DESCONOCIDA',
            ligaCorta: ligaCorta(p.liga),
            urlRelativa: p.url || null,
            kickoffMs: kickoffMs,
            kickoffIsoUtc: new Date(kickoffMs).toISOString(),
            hora: hora,
            horaLabel: etiquetaDia(nowMs, kickoffMs) + ' ' + fechaCorta + ' - ' + hora,
            dia: etiquetaDia(nowMs, kickoffMs),
            fecha: fechaCorta + '/' + k.year,
            fechaCorta: fechaCorta,
            fechaMadrid: fechaMadridISO(kickoffMs),
            horasRestantes: Math.round(((kickoffMs - nowMs) / 3600000) * 10) / 10,
            zonaHoraria: TZ_MADRID,
            temporalStatus: 'FUTURO_VALIDADO',
            fuenteDatos: 'ratingbet.com',
            lineas: { '1.5': prepararLinea(lineas['1.5']), '2.5': prepararLinea(lineas['2.5']) }
        });
    }

    pool.sort((a, b) => a.kickoffMs - b.kickoffMs);
    diag.aceptados = pool.length;
    return { candidatos: pool, diag: diag };
}

// -----------------------------------------------------------------------------
// 2) SELECCION PARA EL ANALISIS: controla el tamano del prompt sin perder calidad
// -----------------------------------------------------------------------------
// Con ~250 partidos por captura, mandar todo al LLM es caro e impreciso. Se
// prioriza (a) tener AMBAS lineas (1.5 y 2.5) y (b) el kickoff mas proximo.
// Es una seleccion determinista y auditable, no un filtro de valor: el valor lo
// decide el analisis posterior.
export const MAX_ANALISIS = 60;

export function seleccionarParaAnalisis(candidatos, max) {
    const tope = max || MAX_ANALISIS;
    const conAmbas = candidatos.filter(c => c.lineas['1.5'] && c.lineas['2.5']);
    const soloUna = candidatos.filter(c => !(c.lineas['1.5'] && c.lineas['2.5']));
    return conAmbas.concat(soloUna).slice(0, tope);
}

// -----------------------------------------------------------------------------
// 3) PROMPT DE ANALISIS: la IA recibe la LISTA REAL y solo emite veredictos
// -----------------------------------------------------------------------------
export function construirPromptAnalisis(candidatos, feed, ahoraMs) {
    // MODELO CIEGO: el LLM NO ve cuotas ni probabilidades implícitas.
    // Solo recibe identidad + qué líneas existen, para que probModelo sea
    // una estimación independiente (forma, xG, bajas, clima, localía, H2H).
    const lista = candidatos.map(function (c) {
        const lineasDisponibles = [];
        if (c.lineas['1.5']) lineasDisponibles.push('1.5');
        if (c.lineas['2.5']) lineasDisponibles.push('2.5');
        return {
            clave: c.clave,
            partido: c.partido,
            local: c.local,
            visitante: c.visitante,
            liga: c.liga,
            kickoffIsoUtc: c.kickoffIsoUtc,
            horasRestantes: c.horasRestantes,
            lineasDisponibles: lineasDisponibles
        };
    });
    // Stats reales como DATOS (goles, forma, medias de liga). Nunca cuotas:
    // el modelo sigue ciego al precio; los stats solo informan su estimacion.
    lista.forEach(function (item, i) {
        const st = candidatos[i] && candidatos[i].stats;
        if (st && typeof st === 'object' && Number.isFinite(st.attH) && Number.isFinite(st.avgH)) {
            item.datos = {
                gfLocalCasa: st.gfH, gaLocalCasa: st.gaH, partidosLocalCasa: st.nH,
                gfVisitFuera: st.gfA, gaVisitFuera: st.gaA, partidosVisitFuera: st.nA,
                mediaGolesLocalLiga: st.avgH, mediaGolesVisitLiga: st.avgA,
                fuerzaAtaqueLocal: st.attH, fuerzaDefensaLocal: st.defH,
                fuerzaAtaqueVisit: st.attA, fuerzaDefensaVisit: st.defA
            };
        }
    });

    const noticias = (feed || []).slice(0, 30).map(function (n) {
        return (n.fecha || n.time || '') + ' | ' + (n.fuente || n.source || 'feed') + ' | ' + (n.titulo || n.title || '');
    });

    // =========================================================================
    // SYSTEM PROMPT — 8-pilar cuantitativo profesional
    // =========================================================================
    const systemLines = [
        'IDENTIDAD: Eres QUANT-EDGE-7, modelo de prediccion deportiva de elite de un sindicato profesional de apuestas.',
        'Mision exclusiva: estimar la probabilidad REAL de Over/Under goles para cada partido, superando la eficiencia del mercado.',
        '',
        '============================================================',
        'MARCO ANALITICO OBLIGATORIO — 8 PILARES:',
        '============================================================',
        '',
        'PILAR 1 — MODELO ESTADISTICO (base cuantitativa)',
        '  * Estima xG (expected goals) de cada equipo con datos historicos de la liga y temporada actual.',
        '  * Usa distribucion de Poisson bivariante: calcula P(total_goles >= 1.5) y P(total_goles >= 2.5).',
        '  * Considera: goles por partido (local y visitante por separado), tiros por 90 min,',
        '    goles concedidos del rival, ritmo de juego (posesion alta = mas control = potencialmente menos goles).',
        '  * Ajusta la estimacion por fuerza del rival usando ratings Elo publicos o tu propio ranking de fuerza.',
        '  * BMARKS historicos por liga: Premier 2.78 goles/partido, Bundesliga 3.10, LaLiga 2.60, Serie A 2.55,',
        '    Ligue 1 2.70, Eredivisie 3.20. Ajusta tu estimacion relativa al benchmark de la liga.',
        '',
        'PILAR 2 — FORMA RECIENTE Y RACHAS',
        '  * Ultimos 5-10 partidos de CADA equipo: goles marcados y recibidos (no solo W/D/L).',
        '  * Racha Over/Under: cuantos de los ultimos 5 partidos tuvieron +2.5 goles.',
        '  * Momentum: equipo en racha goleadora (mas confianza, mas apertura) vs equipo en crisis defensiva.',
        '  * H2H (historial directo): Over 2.5 en X de los ultimos 10 enfrentamientos directos.',
        '  * Media de goles en los ultimos 5 H2H entre estos dos equipos concretos.',
        '',
        'PILAR 3 — FACTOR LOCAL / VISITANTE',
        '  * El factor campo aporta ~+0.35 goles de media al local en ligas europeas.',
        '  * Distancia del desplazamiento del visitante: viajes intercontinentales o >1000km = fatiga significativa.',
        '  * Historial del local en casa (goles/partido como local) vs historial visitante fuera.',
        '  * Estadio grande con poca aficion = menos presion psicologica = partidos mas abiertos.',
        '',
        'PILAR 4 — PLANTILLA, BAJAS Y LESIONES',
        '  * Bajas en posiciones clave:',
        '    - Delantero goleador ausente: -0.4 a -0.6 xG estimado en el equipo atacante.',
        '    - Portero titular ausente: +0.3 a +0.5 xG estimado para el rival.',
        '    - Dos o mas defensas centrales titulares bajos: impacto muy alto en vulnerabilidad defensiva.',
        '  * Jugadores volviendo de lesion (en baja forma, minutos limitados, riesgo de recaida).',
        '  * Sancionados que no pueden jugar este partido.',
        '  * Usa el feed de noticias para detectar bajas confirmadas o alineaciones filtradas.',
        '',
        'PILAR 5 — CONTEXTO TACTICO Y ENTRENADOR',
        '  * Sistema tactico: 4-3-3 / 4-2-3-1 (ofensivo) vs 5-3-2 / 5-4-1 (defensivo).',
        '  * Pressing alto vs bloque bajo: el pressing alto genera mas transiciones y mas goles.',
        '  * Cambio de entrenador reciente: "efecto nuevo mister" — mejoran en las primeras 5 jornadas.',
        '  * Necesidad del resultado:',
        '    - Equipo que NECESITA ganar para no descender: sale mas abierto (+goles).',
        '    - Equipo lider comodo: puede jugar conservador (-goles).',
        '    - Partido de vuelta de eliminatoria: si va ganando, cierra; si va perdiendo, se abre.',
        '  * Derbis y rivalidades historicas: aumenta la tension, baja el ritmo, normalmente -0.3 goles.',
        '  * Congestion de calendario (3 partidos en 7 dias): mas rotaciones, mas errores = mas goles.',
        '',
        'PILAR 6 — CONDICIONES METEOROLOGICAS',
        '  * Lluvia intensa (>10mm): terreno pesado, menos tiros precisos, -0.4 goles/partido de media.',
        '  * Viento fuerte (>40 km/h): dificulta centros y balones largos, perjudica equipos con juego aereo.',
        '  * Calor extremo (>30C en verano): fatiga desde minuto 60-70, ritmo baja en 2a parte.',
        '  * Frio intenso (<3C en invierno): campo duro, mas lesiones, juego mas fisico = menos fluidez.',
        '  * Si no tienes datos de clima, infiere por la geografia (Escandinavia en sep = frio/lluvia; Espana sep = calor).',
        '',
        'PILAR 7 — TEMPORADA, FICHAJES Y CALENDARIO',
        '  * Inicio de temporada (agosto-septiembre): los equipos con muchos fichajes nuevos tienen menos cohesion.',
        '    El tiempo de integracion de un nuevo jugador clave es ~8-10 partidos.',
        '  * Mercado de transferencias: equipo que vende su goleador en verano pierde potencial ofensivo.',
        '  * Jornada de liga vs eliminatoria de copa: los equipos priorizan la liga y rotan en copa.',
        '  * Posicion en la tabla y objetivos: equipo en zona Champions juega para ganar; en zona descenso, a no perder.',
        '  * Segunda vuelta vs primera vuelta: los patrones cambian, los equipos se conocen mejor.',
        '',
        'PILAR 8 — CONTEXTO EXTERNO (SOLO SI EL FEED LO MENCIONA)',
        '  * Usa el feed de noticias para rumores, bajas de ultima hora o alineaciones filtradas.',
        '  * NO ves las cuotas del mercado: no analices movimientos de cuotas ni dinero apostado.',
        '  * Si el feed no menciona un partido, basate solo en los pilares 1-7.',
        '',
        '============================================================',
        'REGLAS DE ORO — OBLIGATORIAS SIN EXCEPCION:',
        '============================================================',
        'REGLA 1: Solo emites veredictos sobre claves EXACTAS de la lista recibida. NUNCA inventas partidos.',
        'REGLA 2: "probModelo" es tu estimacion independiente (0-99.5). NO ves las cuotas del mercado.',
        'REGLA 3: Estima probModelo de forma INDEPENDIENTE y ciega a la cuota, basandote solo en datos:',
        '         forma reciente, xG esperado, bajas y lesiones, clima, factor local/visitante e historial H2H.',
        '         NO puedes copiar el precio porque NO lo ves: cualquier parecido con la cuota es coincidencia.',
        '         Da tu probabilidad real del Over/Under indicado segun tu analisis cuantitativo (8 pilares).',
        'REGLA 4: Si no tienes datos cuantitativos suficientes para un partido, NO emitas veredicto.',
        'REGLA 5: El sistema calcula el edge con las cuotas reales. Tu solo das "probModelo". No inventes cuotas ni edge.',
        'REGLA 6: "confianza" ALTA si tienes >= 4 factores convergentes. MEDIA-ALTA con >= 2. MEDIA con al menos 1 solido.',
        'REGLA 7: La "justificacion" debe ser concreta y cuantitativa.',
        '         Correcto: "xG combinado 3.2, Over 2.5 en 7/10 H2H, sin portero titular rival, entrenador 4-3-3 ofensivo, racha 4 seguidos".',
        '         INCORRECTO: "equipo en buen momento" o "se esperan goles".',
        '',
        'FORMATO DE SALIDA — EXCLUSIVAMENTE JSON VALIDO (sin texto adicional, sin bloques de codigo):',
        '{"veredictos":[{"clave":"string","linea":"1.5|2.5","lado":"OVER|UNDER","probModelo":74.8,',
        '"confianza":"ALTA|MEDIA-ALTA|MEDIA","justificacion":"string concreto y cuantitativo",',
        '"factores":["factor1","factor2"],"noticiasUsadas":["fuente: titular si existe"]}],',
        '"resumen":"2 frases del panorama general de hoy"}'
    ];
    const system = systemLines.join('\n');

    const userLines = [
        '============================================================',
        'MOMENTO DE EJECUCION (UTC): ' + new Date(ahoraMs).toISOString(),
        'ZONA HORARIA: ' + TZ_MADRID,
        '============================================================',
        '',
        'LISTA CERRADA DE PARTIDOS FUTUROS VALIDADOS (' + lista.length + ' partidos):',
        '(SIN cuotas: estima tu probabilidad real de forma independiente con los 8 pilares)',
        JSON.stringify(lista, null, 2),
        ''
    ];

    if (noticias.length) {
        userLines.push('============================================================');
        userLines.push('FEED DE NOTICIAS DEPORTIVAS (usa solo si es relevante y esta fechado):');
        userLines.push('============================================================');
        userLines.push(noticias.join('\n'));
        userLines.push('');
    }

    userLines.push('============================================================');
    userLines.push('INSTRUCCION FINAL:');
    userLines.push('Aplica los 8 pilares a CADA partido de la lista. Emite veredicto con tu probModelo');
    userLines.push('independiente (ciega a la cuota) donde tengas conviccion cuantitativa. El sistema');
    userLines.push('calcula el edge con las cuotas reales y solo publica picks con edge positivo.');
    userLines.push('Si ningun partido merece veredicto, devuelve: {"veredictos":[],"resumen":"sin conviccion suficiente"}');
    userLines.push('Responde SOLO con el JSON. Sin explicaciones adicionales fuera del JSON.');

    return { system: system, user: userLines.join('\n'), totalCandidatos: lista.length };
}


// 4) PARSEO DE VEREDICTOS: tolerante al formato, ESTRICTO con las claves
// -----------------------------------------------------------------------------
export function parsearVeredictosIA(texto, candidatos) {
    const diag = { recibidos: 0, aceptados: 0, rechazados: 0, motivos: {}, resumen: null };

    let obj = null;
    if (texto && typeof texto === 'object') obj = texto;
    else {
        const s = String(texto || '');
        const limpio = s.replace(/```json/gi, '').replace(/```/g, '').trim();
        try { obj = JSON.parse(limpio); } catch (e) {
            const i = limpio.indexOf('{'), j = limpio.lastIndexOf('}');
            if (i !== -1 && j > i) { try { obj = JSON.parse(limpio.slice(i, j + 1)); } catch (e2) { obj = null; } }
        }
    }
    if (!obj) { diag.motivos['json-no-parseable'] = 1; return { veredictos: [], diag: diag }; }

    const bruto = Array.isArray(obj) ? obj : (Array.isArray(obj.veredictos) ? obj.veredictos : []);
    diag.resumen = typeof obj.resumen === 'string' ? obj.resumen : null;

    const indices = new Map();
    candidatos.forEach((c, i) => indices.set(c.clave, i));

    const veredictos = [];
    const rechazar = (m) => { diag.rechazados++; diag.motivos[m] = (diag.motivos[m] || 0) + 1; };

    bruto.forEach(function (v) {
        diag.recibidos++;
        if (!v || typeof v !== 'object') { rechazar('veredicto-malformado'); return; }

        const clave = String(v.clave || '').trim();
        if (!indices.has(clave)) { rechazar('clave-inexistente'); return; }   // anti-invencion

        const linea = String(v.linea || '').trim();
        const cand = candidatos[indices.get(clave)];
        if (!cand.lineas[linea]) { rechazar('linea-no-disponible'); return; }

        const lado = String(v.lado || '').trim().toUpperCase();
        if (lado !== 'OVER' && lado !== 'UNDER') { rechazar('lado-invalido'); return; }

        const prob = Number(v.probModelo);
        if (!Number.isFinite(prob) || prob < 1 || prob > 99.5) { rechazar('probabilidad-invalida'); return; }

        const conf = ['ALTA', 'MEDIA-ALTA', 'MEDIA'].indexOf(String(v.confianza || '').toUpperCase()) !== -1
            ? String(v.confianza).toUpperCase() : null;

        veredictos.push({
            clave: clave,
            indice: indices.get(clave),
            linea: linea,
            lado: lado,
            probModelo: Math.round(prob * 10) / 10,
            confianzaIA: conf,
            justificacion: String(v.justificacion || '').slice(0, 400),
            factores: Array.isArray(v.factores) ? v.factores.slice(0, 6).map(f => String(f).slice(0, 80)) : [],
            noticiasUsadas: Array.isArray(v.noticiasUsadas) ? v.noticiasUsadas.slice(0, 6).map(n => String(n).slice(0, 120)) : []
        });
    });

    diag.aceptados = veredictos.length;
    return { veredictos: veredictos, diag: diag };
}

// -----------------------------------------------------------------------------
// 5) APLICAR VEREDICTOS: el EDGE se calcula AQUI con las cuotas REALES
// -----------------------------------------------------------------------------
// La IA solo aporta "probModelo". La cuota, la probabilidad implicita, la
// probabilidad justa (sin margen), el edge en puntos y el valor esperado se
// derivan de las cuotas reales de ratingbet. Asi el edge no puede ser inventado.
export function cuotaDe(candidato, lado, linea) {
    const l = candidato.lineas[linea];
    if (!l) return null;
    return lado === 'OVER' ? l.cuotaOver : l.cuotaUnder;
}

// Valor esperado por unidad apostada (en tanto por uno)
export function valorEsperado(probPct, cuota) {
    const p = Number(probPct) / 100;
    const c = parseFloat(cuota);
    if (!Number.isFinite(p) || !Number.isFinite(c) || c <= 1) return -Infinity;
    return p * c - 1;
}

export function signoPct(x) {
    if (x === null || x === undefined || !Number.isFinite(x)) return '-';
    const v = Math.round(x * 10) / 10;
    return (v >= 0 ? '+' : '') + v + '%';
}

export function aplicarVeredictos(candidatos, veredictos, ahoraMs) {
    const nowMs = Number.isFinite(ahoraMs) ? ahoraMs : Date.now();

    // Si hay varios veredictos para el mismo partido, gana el de mayor valor esperado
    const mejor = new Map();
    veredictos.forEach(function (v) {
        const c = candidatos[v.indice];
        const ev = valorEsperado(v.probModelo, cuotaDe(c, v.lado, v.linea));
        const actual = mejor.get(v.clave);
        if (!actual || ev > actual.ev) mejor.set(v.clave, { v: v, ev: ev });
    });

    const salida = [];
    mejor.forEach(function (entrada) {
        const v = entrada.v;
        const c = candidatos[v.indice];
        const l = c.lineas[v.linea];
        const cuota = cuotaDe(c, v.lado, v.linea);
        const cuotaContraria = cuotaDe(c, v.lado === 'OVER' ? 'UNDER' : 'OVER', v.linea);

        const pCasa = probImplicita(cuota);
        const pJusta = probJusta(cuota, cuotaContraria);
        const evPct = entrada.ev * 100;
        // Convención del cliente: edge por pick = (cuotaCasa - cuotaModelo) * 100,
        // con cuotaModelo = 100 / probModelo. Positivo = valor.
        const cuotaModelo = (Number.isFinite(v.probModelo) && v.probModelo > 0) ? (100 / v.probModelo) : null;
        const edgePuntos = (cuotaModelo === null || cuotaModelo <= 1 || !Number.isFinite(cuota) || cuota <= 1)
            ? null : Math.round((cuota - cuotaModelo) * 1000) / 10;

        const k = partesMadrid(c.kickoffMs);

        // Transparencia: se publican AMBAS lineas del partido aunque el veredicto
        // sea sobre una sola, para que el usuario vea el mercado completo.
        const lineasTodas = {};
        ['1.5', '2.5'].forEach(function (ln) {
            if (!c.lineas[ln]) return;
            lineasTodas[ln] = {
                cuotaOver: c.lineas[ln].cuotaOver,
                cuotaUnder: c.lineas[ln].cuotaUnder,
                pOverJusta: c.lineas[ln].pOverJusta,
                pUnderJusta: c.lineas[ln].pUnderJusta,
                margenCasa: c.lineas[ln].margenCasa,
                tipRatingbet: c.lineas[ln].tipRatingbet,
                tipProbPct: c.lineas[ln].tipProbPct === undefined ? null : c.lineas[ln].tipProbPct
            };
        });

        salida.push({
            // --- identidad del fixture (real, del scraper) ---
            clave: c.clave,
            partido: c.partido,
            local: c.local,
            visitante: c.visitante,
            liga: c.liga,
            ligaCorta: c.ligaCorta,
            urlRelativa: c.urlRelativa,
            // --- tiempo (Madrid + UTC) ---
            kickoffMs: c.kickoffMs,
            kickoffIsoUtc: c.kickoffIsoUtc,
            hora: pad2(k.hour) + ':' + pad2(k.minute),
            horaLabel: c.horaLabel,
            dia: c.dia,
            diaSemana: DIAS_ES[new Date(c.kickoffMs).getUTCDay()],
            fechaCorta: pad2(k.day) + '/' + pad2(k.month),
            fecha: c.fecha,
            horasRestantes: Math.round(((c.kickoffMs - nowMs) / 3600000) * 10) / 10,
            zonaHoraria: TZ_MADRID,
            // --- recomendacion (cuota y edge calculados con datos reales) ---
            linea: v.linea,
            lado: v.lado,
            mercado: (v.lado === 'OVER' ? 'Over ' : 'Under ') + v.linea + ' Goles',
            cuota: cuota,
            modelProb: v.probModelo,
            houseProb: pCasa === null ? null : Math.round(pCasa * 10) / 10,
            justaProb: pJusta,
            edgePuntos: edgePuntos,
            edge: signoPct(edgePuntos),
            evPct: Math.round(evPct * 10) / 10,
            ev: signoPct(evPct),
            confianza: v.confianzaIA || (v.probModelo >= 88 ? 'ALTA' : (v.probModelo >= 84 ? 'MEDIA-ALTA' : 'MEDIA')),
            justificacion: v.justificacion,
            factores: v.factores,
            noticiasUsadas: v.noticiasUsadas,
            lineas: lineasTodas,
            stats: c.stats || null,
            temporalStatus: 'FUTURO_VALIDADO',
            fuenteDatos: 'ratingbet.com'
        });
    });

    // Orden por valor esperado: es el ranking que busca el usuario (donde hay edge)
    salida.sort((a, b) => b.evPct - a.evPct || a.kickoffMs - b.kickoffMs);
    return salida;
}

// -----------------------------------------------------------------------------
// 6) RE-VALIDACION EN TIEMPO DE PETICION  <-- mata el bug de "partidos de ayer"
// -----------------------------------------------------------------------------
// Un analisis cacheado envejece. Si un partido ya empezo, se cae de la lista en
// la MISMA peticion, sin depender de que el cron vuelva a correr. Esta es la
// garantia que impide volver a publicar partidos de ayer.
export const MARGEN_PUBLICACION_MIN = 15;

export function filtrarPublicables(lista, nowMs, opts) {
    const o = opts || {};
    const margenMin = o.margenMinutos !== undefined ? o.margenMinutos : MARGEN_PUBLICACION_MIN;
    const max = o.max || MAX_PUBLICADOS;
    const margenMs = margenMin * 60000;

    const acep = [], desc = [];
    (lista || []).forEach(function (x) {
        const t = Number.isFinite(x.kickoffMs) ? x.kickoffMs : Date.parse(x.kickoffIsoUtc);
        if (!Number.isFinite(t)) { desc.push({ partido: x.partido, motivo: 'sin-kickoff' }); return; }
        if (x.jugado) { desc.push({ partido: x.partido, motivo: 'ya-jugado' }); return; }
        if (t < nowMs + margenMs) { desc.push({ partido: x.partido, motivo: 'pasado-o-inminente' }); return; }
        acep.push(Object.assign({}, x, {
            kickoffMs: t,
            kickoffIsoUtc: new Date(t).toISOString(),
            horasRestantes: Math.round(((t - nowMs) / 3600000) * 10) / 10,
            temporalStatus: 'FUTURO_VALIDADO'
        }));
    });

    return {
        publicables: acep.slice(0, max),
        descartados: desc,
        resumen: {
            ahoraUtc: new Date(nowMs).toISOString(),
            ahoraMadrid: new Intl.DateTimeFormat('es-ES', { timeZone: TZ_MADRID, dateStyle: 'short', timeStyle: 'medium' }).format(new Date(nowMs)),
            margenMinutos: margenMin,
            total: (lista || []).length,
            publicables: Math.min(acep.length, max),
            descartados: desc.length
        }
    };
}

// -----------------------------------------------------------------------------
// 8) PUBLICACION SIN ANALISIS IA (modo degradado honesto)
// -----------------------------------------------------------------------------
// Si el agente IA no esta disponible (sin clave, 401, timeout, JSON invalido) NO
// se inventa nada y NO se cae la tabla: se publican los partidos futuros REALES
// con sus cuotas REALES y el mercado completo (1.5 y 2.5). Las columnas que
// dependen del modelo van vacias (null / "-"), nunca rellenadas con ruido.
// Requisito del negocio: la web debe mostrar SIEMPRE partidos reales que aun no
// han empezado, incluso sin IA.
export function construirFixturesSinAnalisis(candidatos, nowMs, opts) {
    const o = opts || {};
    const max = o.max || MAX_PUBLICADOS;

    return candidatos.slice(0, max).map(function (c) {
        const k = partesMadrid(c.kickoffMs);
        const l15 = c.lineas['1.5'], l25 = c.lineas['2.5'];

        const lineasTodas = {};
        ['1.5', '2.5'].forEach(function (ln) {
            if (!c.lineas[ln]) return;
            lineasTodas[ln] = {
                cuotaOver: c.lineas[ln].cuotaOver,
                cuotaUnder: c.lineas[ln].cuotaUnder,
                pOverJusta: c.lineas[ln].pOverJusta,
                pUnderJusta: c.lineas[ln].pUnderJusta,
                margenCasa: c.lineas[ln].margenCasa,
                tipRatingbet: c.lineas[ln].tipRatingbet,
                tipProbPct: c.lineas[ln].tipProbPct === undefined ? null : c.lineas[ln].tipProbPct
            };
        });

        const trozos = [];
        if (l15) trozos.push('O1.5 @ ' + l15.cuotaOver + ' / U1.5 @ ' + l15.cuotaUnder);
        if (l25) trozos.push('O2.5 @ ' + l25.cuotaOver + ' / U2.5 @ ' + l25.cuotaUnder);

        return {
            clave: c.clave,
            partido: c.partido,
            local: c.local,
            visitante: c.visitante,
            liga: c.liga,
            ligaCorta: c.ligaCorta,
            urlRelativa: c.urlRelativa,
            kickoffMs: c.kickoffMs,
            kickoffIsoUtc: c.kickoffIsoUtc,
            hora: c.hora,
            horaLabel: c.horaLabel,
            dia: etiquetaDia(nowMs, c.kickoffMs),
            diaSemana: DIAS_ES[new Date(c.kickoffMs).getUTCDay()],
            fechaCorta: pad2(k.day) + '/' + pad2(k.month),
            fecha: c.fecha,
            horasRestantes: Math.round(((c.kickoffMs - nowMs) / 3600000) * 10) / 10,
            zonaHoraria: TZ_MADRID,
            linea: '1.5/2.5',
            lado: null,
            mercado: trozos.join('  |  ') || 'Sin cuotas disponibles',
            cuota: (l15 && l15.cuotaOver) || (l25 && l25.cuotaOver) || null,
            modelProb: null,          // sin analisis: NO se inventa probabilidad
            houseProb: null,
            justaProb: null,
            edgePuntos: null,
            edge: '-',
            evPct: null,
            ev: '-',
            confianza: 'SIN ANALISIS',
            justificacion: 'Partido real verificado en feeds en vivo. Pendiente de analisis de edge (ciclo de analisis en curso).',
            factores: [],
            noticiasUsadas: [],
            lineas: lineasTodas,
            stats: c.stats || null,
            modoAnalisis: 'solo-cuotas',
            temporalStatus: 'FUTURO_VALIDADO',
            fuenteDatos: 'ratingbet.com'
        };
    });
}
// -----------------------------------------------------------------------------
// 8b) COMBINADAS POR NIVEL DE RIESGO (picks reales; probabilidades NUNCA inventadas)
// -----------------------------------------------------------------------------
// Reglas de negocio del cliente:
//   RIESGO BAJO : cuota combinada < 2.00
//   RIESGO MEDIO: cuota combinada entre 2.00 y 3.00
//   RIESGO ALTO : cuota combinada > 3.00
// Probabilidad de cada pick, por orden de calidad (todas reales):
//   1) probModelo de la IA (veredicto sobre cuotas reales de ratingbet)
//   2) probabilidad del tip publicado por ratingbet (tipProbPct)
//   3) probabilidad JUSTA del mercado (margen de casa eliminado, derivada de la cuota)
// Si no existe combinacion para la banda se devuelve estado 'sin-combinada' con
// su motivo: NO se fuerza ninguna cuota (el bug anterior inventaba un 3.15 fijo).
export const BANDAS_RIESGO = {
    bajo: { nombre: 'RIESGO BAJO', icono: '🛡️', descripcion: 'Cuota total < 2.00',
            min: 1.01, max: 2.00, minExclusivo: false, maxExclusivo: true, tamanos: [2, 3, 4] },
    medio: { nombre: 'RIESGO MEDIO', icono: '⚡', descripcion: 'Cuota total 2.00 - 3.00',
            min: 2.00, max: 3.00, minExclusivo: false, maxExclusivo: false, tamanos: [2, 3] },
    alto: { nombre: 'RIESGO ALTO', icono: '🚀', descripcion: 'Cuota total > 3.00',
            min: 3.00, max: 15.00, minExclusivo: true, maxExclusivo: false, tamanos: [3, 4] }
};

const MAX_CANDIDATOS_COMBINADA = 10;   // acota la explosion combinatoria (fix 504 Vercel)
const MAX_COMBOS = 2000;

function enBanda(banda, cuota) {
    const infOk = banda.minExclusivo ? cuota > banda.min : cuota >= banda.min;
    const supOk = banda.maxExclusivo ? cuota < banda.max : cuota <= banda.max;
    return infOk && supOk;
}

// Seleccion de mercado de un fixture publicado. Devuelve SIEMPRE una
// probabilidad real (IA / tip / mercado justo) o null si no hay cuotas validas.
// Boost bet365 por combinada (ej 5 = +5% sobre cuota total). Configurable via RATINGBET_COMBO_BOOST_PCT.
export function comboBoostPct() {
    const v = parseFloat((typeof process !== 'undefined' && process.env && process.env.RATINGBET_COMBO_BOOST_PCT) || '');
    return Number.isFinite(v) && v >= 0 && v <= 50 ? v : 0;
}
export function edgePorCuotas(cuotaCasa, cuotaJustaModelo) {
    if (!Number.isFinite(cuotaCasa) || !Number.isFinite(cuotaJustaModelo) || cuotaCasa <= 1 || cuotaJustaModelo <= 1) return null;
    return Math.round((cuotaCasa / cuotaJustaModelo - 1) * 1000) / 10;
}
// -----------------------------------------------------------------------------
// MODELO POISSON DETERMINISTA (independiente de la cuota, nunca la ve)
// -----------------------------------------------------------------------------
// stats: {attH, defH, attA, defA, avgH, avgA, nH, nA} con fuerzas ya
// normalizadas vs la media de la liga (las adjunta el worker desde
// football-data.org). Lh = avgH * attH * defA; La = avgA * attA * defH;
// L = Lh + La. P(Over 1.5) = 1 - e^-L * (1 + L);
// P(Over 2.5) = 1 - e^-L * (1 + L + L^2/2).
// Devuelve {p15, p25, lambdaH, lambdaA, lambdaTotal} en % (1 decimal,
// clamp 1..99.5), o null si los stats son insuficientes. Puro y testeable.
export function modeloPoisson(stats) {
    if (!stats || typeof stats !== 'object') return null;
    const attH = Number(stats.attH), defH = Number(stats.defH);
    const attA = Number(stats.attA), defA = Number(stats.defA);
    const avgH = Number(stats.avgH), avgA = Number(stats.avgA);
    const vals = [attH, defH, attA, defA, avgH, avgA];
    if (!vals.every(function (v) { return Number.isFinite(v) && v > 0; })) return null;
    if (stats.nH !== undefined || stats.nA !== undefined) {
        const nH = Number(stats.nH), nA = Number(stats.nA);
        if (!Number.isFinite(nH) || !Number.isFinite(nA) || nH < 3 || nA < 3) return null;
    }
    const Lh = avgH * attH * defA;
    const La = avgA * attA * defH;
    if (!Number.isFinite(Lh) || !Number.isFinite(La) || Lh <= 0 || La <= 0) return null;
    const L = Lh + La;
    const eL = Math.exp(-L);
    function clamp1(x) { return Math.min(99.5, Math.max(1, Math.round(x * 10) / 10)); }
    return {
        p15: clamp1((1 - eL * (1 + L)) * 100),
        p25: clamp1((1 - eL * (1 + L + (L * L) / 2)) * 100),
        lambdaH: Math.round(Lh * 100) / 100,
        lambdaA: Math.round(La * 100) / 100,
        lambdaTotal: Math.round(L * 100) / 100
    };
}
export function seleccionDeFixture(f) {
    if (!f || !f.lineas) return null;
    // 1) veredicto de la IA sobre el fixture
    if (Number.isFinite(f.modelProb) && Number.isFinite(f.cuota) && f.cuota > 1 && f.modoAnalisis !== 'solo-cuotas') {
        return {
            mercado: f.mercado, cuota: f.cuota, probPct: f.modelProb, probBase: 'modelo-ia',
            edgePuntos: Number.isFinite(f.edgePuntos) ? f.edgePuntos : null,
            justificacion: f.justificacion || ''
        };
    }
    // 1b) modelo Poisson determinista con stats reales (football-data.org).
    //     Ciego a la cuota: solo estima P(Over) por linea; el edge se calcula
    //     aqui con la convencion del cliente. Incluye stats y lambdas para
    //     trazabilidad. Sin stats validos -> null (no inventa).
    if (f.stats && typeof f.stats === 'object') {
        const mp = modeloPoisson(f.stats);
        if (mp) {
            const pOverPorLinea = { '1.5': mp.p15, '2.5': mp.p25 };
            let mejorP = null;
            ['1.5', '2.5'].forEach(function (ln) {
                const l = f.lineas[ln];
                const pOver = pOverPorLinea[ln];
                if (!l || !Number.isFinite(pOver)) return;
                [[ 'OVER', l.cuotaOver, pOver ], [ 'UNDER', l.cuotaUnder, 100 - pOver ]].forEach(function (op) {
                    const lado = op[0], cuota = op[1], prob = op[2];
                    if (!Number.isFinite(cuota) || cuota <= 1) return;
                    if (!Number.isFinite(prob) || prob < 1 || prob > 99.5) return;
                    const edge = Math.round((cuota - (100 / prob)) * 1000) / 10;
                    if (!mejorP || edge > mejorP.edgePuntos) {
                        mejorP = { linea: ln, lado: lado, cuota: cuota,
                            prob: Math.round(prob * 10) / 10, edgePuntos: edge };
                    }
                });
            });
            if (mejorP) {
                return {
                    mercado: (mejorP.lado === 'OVER' ? 'Over ' : 'Under ') + mejorP.linea + ' Goles',
                    cuota: mejorP.cuota, probPct: mejorP.prob,
                    probBase: 'modelo-poisson', edgePuntos: mejorP.edgePuntos,
                    justificacion: 'Modelo Poisson (L=' + mp.lambdaTotal + '): P(Over 1.5)=' + mp.p15 +
                        '%, P(Over 2.5)=' + mp.p25 + '%.',
                    stats: f.stats,
                    lambdas: { lambdaH: mp.lambdaH, lambdaA: mp.lambdaA, lambdaTotal: mp.lambdaTotal }
                };
            }
        }
    }
    // 2) tip de ratingbet (su recomendacion publicada con su probabilidad)
    //     NO es modelo: nunca devuelve edge positivo ni se disfraza de modelo.
    const lineas = ['1.5', '2.5'];
    for (let i = 0; i < lineas.length; i++) {
        const l = f.lineas[lineas[i]];
        if (!l) continue;
        const tip = String(l.tipRatingbet || '').toUpperCase().replace(/\s+/g, '');
        const mTip = tip.match(/^([OU])(1\.5|2\.5)$/);
        if (!mTip) continue;
        const esOver = mTip[1] === 'O';
        const cuota = esOver ? l.cuotaOver : l.cuotaUnder;
        if (!Number.isFinite(cuota) || cuota <= 1) continue;
        const pJusta = esOver ? l.pOverJusta : l.pUnderJusta;
        const pTip = Number.isFinite(l.tipProbPct) ? l.tipProbPct : null;
        const probUsada = pTip !== null ? pTip : pJusta;
        return {
            mercado: (esOver ? 'Over ' : 'Under ') + mTip[2] + ' Goles', cuota: cuota,
            probPct: probUsada,
            probBase: pTip !== null ? 'analisis-tip' : 'mercado-justo',
            edgePuntos: null,
            justificacion: 'Seleccion informativa del tip/mercado (' + (esOver ? 'Over' : 'Under') + ' ' + mTip[2] + '), sin edge de modelo.'
        };
    }
    // 3) fallback: Over 1.5 con probabilidad justa derivada de la cuota real.
    //     Tampoco es modelo: edgePuntos = null.
    const l15 = f.lineas['1.5'];
    if (l15 && Number.isFinite(l15.cuotaOver) && l15.cuotaOver > 1) {
        const probFallback = Number.isFinite(l15.pOverJusta) ? l15.pOverJusta : probImplicita(l15.cuotaOver);
        return {
            mercado: 'Over 1.5 Goles', cuota: l15.cuotaOver,
            probPct: probFallback,
            probBase: 'mercado-justo', edgePuntos: null,
            justificacion: 'Mercado Over 1.5 con probabilidad derivada del precio del mercado, sin edge de modelo.'
        };
    }
    return null;
}
// Construye la mejor combinada para un nivel de riesgo.
// Criterio: dentro de la banda de cuota, MAXIMIZA la probabilidad combinada real.
export function construirParlayRiesgo(pool, riskLevel, ahoraMs) {
    const nowMs = Number.isFinite(ahoraMs) ? ahoraMs : Date.now();
    const nivel = BANDAS_RIESGO[riskLevel] ? riskLevel : 'medio';
    const banda = BANDAS_RIESGO[nivel];
    const sizeMin = banda.tamanos[0];
    const sizeMax = banda.tamanos[banda.tamanos.length - 1];

    const base = {
        riskLevel: nivel, nombreRiesgo: banda.nombre, iconoRiesgo: banda.icono,
        descripcionRiesgo: banda.descripcion, banda: banda.descripcion,
        estado: 'sin-combinada', motivo: null,
        picks: [], partidos: [],
        cuotaTotal: null, probabilidadReal: null, probabilidadCasa: null,
        edgeTotal: null, probBase: null, generadoEnUtc: new Date(nowMs).toISOString()
    };

    // 1) candidatos con seleccion valida
    const candidatos = [];
    (pool || []).forEach(function (f) {
        if (!f || f.jugado) return;
        if (!Number.isFinite(f.kickoffMs) || f.kickoffMs < nowMs) return;
        const s = seleccionDeFixture(f);
        // Solo combinan picks del modelo IA con edge positivo: el tip y el mercado
        // justo NO son modelo y no pueden publicarse como combinada con valor.
        if (s && s.probBase === 'modelo-ia' && Number.isFinite(s.probPct) && s.probPct > 0 && s.probPct <= 100
            && Number.isFinite(s.edgePuntos) && s.edgePuntos > 0) {
            candidatos.push({ f: f, s: s });
        }
    });
    if (candidatos.length < sizeMin) {
        base.motivo = 'pocos-partidos-validos (' + candidatos.length + ' < ' + sizeMin + ')';
        const destPool = [];
        (pool || []).forEach(function (f) {
            if (!f || f.jugado) return;
            if (!Number.isFinite(f.kickoffMs) || f.kickoffMs < nowMs) return;
            const s = seleccionDeFixture(f);
            if (s && (s.probBase === 'modelo-ia' || s.probBase === 'modelo-poisson') && Number.isFinite(s.probPct) && s.probPct > 0 && Number.isFinite(s.edgePuntos) && s.edgePuntos > 0) {
                destPool.push({ f: f, s: s });
            }
        });
        destPool.sort(function (a, b) { return b.s.edgePuntos - a.s.edgePuntos; });
        const dest = destPool.slice(0, 3).map(function (e, idx) {
            return {
                clave: e.f.clave, partido: e.f.partido || (e.f.local && e.f.visitante ? (e.f.local + ' vs ' + e.f.visitante) : 'Partido'), local: e.f.local, visitante: e.f.visitante,
                liga: e.f.liga, ligaCorta: e.f.ligaCorta,
                hora: e.f.hora, horaLabel: e.f.horaLabel, dia: e.f.dia, fechaCorta: e.f.fechaCorta,
                kickoffIsoUtc: e.f.kickoffIsoUtc, kickoffMs: e.f.kickoffMs,
                orden: idx + 1,
                mercado: e.s.mercado, cuota: e.s.cuota,
                modelProb: e.s.probBase === 'modelo-ia' ? e.s.probPct : null,
                probPct: e.s.probPct, probBase: e.s.probBase,
                probEtiqueta: e.s.probBase === 'modelo-ia' ? 'IA' : 'estimada',
                edgePuntos: e.s.edgePuntos,
                edge: Number.isFinite(e.s.edgePuntos) ? signoPct(e.s.edgePuntos) : null,
                justificacion: e.s.justificacion,
                temporalStatus: 'FUTURO_VALIDADO'
            };
        });
        base.destacados = dest;
        base.partidos = dest;
        return base;
    }
    // Ordenar por edge real: nuestra prob% - prob implicita del bookie.
    // Picks con edge positivo (bookie subestima la prob) van primero.
    candidatos.sort(function (a, b) {
        const implA = a.s.cuota > 0 ? (1 / a.s.cuota) * 100 : 0;
        const implB = b.s.cuota > 0 ? (1 / b.s.cuota) * 100 : 0;
        const ea = Number.isFinite(a.s.edgePuntos) ? a.s.edgePuntos : (a.s.probPct - implA);
        const eb = Number.isFinite(b.s.edgePuntos) ? b.s.edgePuntos : (b.s.probPct - implB);
        return eb - ea;
    });
    const corta = candidatos.slice(0, MAX_CANDIDATOS_COMBINADA);
    const n = corta.length;

    // 2) busqueda combinatoria acotada: MAXIMIZA edgeTotal dentro de la banda.
    // Convención del cliente: edgeTotal = (cuotaBoosted - cuotaModeloTotal) * 100,
    // cuotaBoosted = cuotaTotal * (1 + boost/100), cuotaModeloTotal = prod(100/probPct).
    // Solo hay combinada publicable ('ok') si edgeTotal > 0.
    let mejor = null;
    let combos = 0;
    const boostCfg = comboBoostPct();
    function evaluar(elegidos) {
        let cuota = 1, prob = 1, casa = 1, cuotaModelo = 1;
        for (let i = 0; i < elegidos.length; i++) {
            if (!Number.isFinite(elegidos[i].s.probPct) || elegidos[i].s.probPct <= 0) return;
            cuota *= elegidos[i].s.cuota;
            prob *= elegidos[i].s.probPct / 100;
            cuotaModelo *= 100 / elegidos[i].s.probPct;
            const pc = probImplicita(elegidos[i].s.cuota);
            casa *= (pc === null ? 0 : pc / 100);
        }
        cuota = Math.round(cuota * 100) / 100;
        if (!enBanda(banda, cuota)) return;
        const cuotaBoosted = Math.round(cuota * (1 + boostCfg / 100) * 100) / 100;
        cuotaModelo = Math.round(cuotaModelo * 100) / 100;
        const edgeTotal = Math.round((cuotaBoosted - cuotaModelo) * 1000) / 10;
        const pReal = Math.round(prob * 1000) / 10;
        const pCasa = Math.round(casa * 1000) / 10;
        if (!mejor || edgeTotal > mejor.edgeTotal) {
            mejor = { elegidos: elegidos.slice(), cuota: cuota, pReal: pReal, pCasa: pCasa,
                cuotaModeloTotal: cuotaModelo, cuotaBoosted: cuotaBoosted, edgeTotal: edgeTotal };
        }
    }
    (function recorre(inicio, elegidos, prod) {
        if (elegidos.length >= sizeMin) evaluar(elegidos);
        if (elegidos.length >= sizeMax || prod >= banda.max || combos > MAX_COMBOS) return;
        for (let i = inicio; i < n; i++) {
            combos++;
            if (combos > MAX_COMBOS) return;
            elegidos.push(corta[i]);
            recorre(i + 1, elegidos, prod * corta[i].s.cuota);
            elegidos.pop();
        }
    })(0, [], 1);

    if (!mejor || !Number.isFinite(mejor.edgeTotal) || mejor.edgeTotal <= 0) {
        base.motivo = !mejor
            ? 'sin-combinacion-en-la-banda (' + banda.descripcion + ')'
            : 'sin-edge-positivo (mejor edgeTotal ' + mejor.edgeTotal + ' <= 0)';

        // Recopilar los partidos futuros mas destacados de la jornada.
        // Solo picks del modelo IA con edge positivo: nada de tip/mercado-justo.
        const destacadosPool = [];
        (pool || []).forEach(function (f) {
            if (!f || f.jugado) return;
            if (!Number.isFinite(f.kickoffMs) || f.kickoffMs < nowMs) return;
            const s = seleccionDeFixture(f);
            if (s && (s.probBase === 'modelo-ia' || s.probBase === 'modelo-poisson') && Number.isFinite(s.probPct) && s.probPct > 0 && Number.isFinite(s.edgePuntos) && s.edgePuntos > 0) {
                destacadosPool.push({ f: f, s: s });
            }
        });

        destacadosPool.sort(function (a, b) { return b.s.edgePuntos - a.s.edgePuntos; });
        const destacados = destacadosPool.slice(0, 3).map(function (e, idx) {
            return {
                clave: e.f.clave, partido: e.f.partido || (e.f.local && e.f.visitante ? (e.f.local + ' vs ' + e.f.visitante) : 'Partido'), local: e.f.local, visitante: e.f.visitante,
                liga: e.f.liga, ligaCorta: e.f.ligaCorta,
                hora: e.f.hora, horaLabel: e.f.horaLabel, dia: e.f.dia, fechaCorta: e.f.fechaCorta,
                kickoffIsoUtc: e.f.kickoffIsoUtc, kickoffMs: e.f.kickoffMs,
                orden: idx + 1,
                mercado: e.s.mercado, cuota: e.s.cuota,
                modelProb: e.s.probBase === 'modelo-ia' ? e.s.probPct : null,
                probPct: e.s.probPct, probBase: e.s.probBase,
                probEtiqueta: e.s.probBase === 'modelo-ia' ? 'IA' : 'estimada',
                edgePuntos: e.s.edgePuntos,
                edge: Number.isFinite(e.s.edgePuntos) ? signoPct(e.s.edgePuntos) : null,
                justificacion: e.s.justificacion,
                temporalStatus: 'FUTURO_VALIDADO'
            };
        });

        base.destacados = destacados;
        base.partidos = destacados;
        return base;
    }

    // 3) salida (compatible con el frontend legacy: picks === partidos)
    const picks = mejor.elegidos.map(function (e, idx) {
        return {
            clave: e.f.clave, partido: e.f.partido || (e.f.local && e.f.visitante ? (e.f.local + ' vs ' + e.f.visitante) : 'Partido'), local: e.f.local, visitante: e.f.visitante,
            liga: e.f.liga, ligaCorta: e.f.ligaCorta,
            hora: e.f.hora, horaLabel: e.f.horaLabel, dia: e.f.dia, fechaCorta: e.f.fechaCorta,
            kickoffIsoUtc: e.f.kickoffIsoUtc, kickoffMs: e.f.kickoffMs,
            orden: idx + 1,
            mercado: e.s.mercado, cuota: e.s.cuota,
            modelProb: e.s.probBase === 'modelo-ia' ? e.s.probPct : null,
            probPct: e.s.probPct, probBase: e.s.probBase,
            probEtiqueta: e.s.probBase === 'modelo-ia' ? 'IA' : 'estimada',
            edgePuntos: e.s.edgePuntos,
            edge: Number.isFinite(e.s.edgePuntos) ? signoPct(e.s.edgePuntos) : null,
            justificacion: e.s.justificacion,
            temporalStatus: 'FUTURO_VALIDADO'
        };
    });
    const conIA = picks.every(function (p) { return p.probBase === 'modelo-ia'; });

    base.estado = 'ok';
    base.picks = picks;
    base.partidos = picks;
    base.cuotaTotal = mejor.cuota;
    base.probabilidadReal = mejor.pReal;
    base.probabilidadCasa = mejor.pCasa;
    base.cuotaModeloTotal = mejor.cuotaModeloTotal;
    // EdgeTotal por convención del cliente: (cuotaBoosted - cuotaModeloTotal) * 100.
    const boost = comboBoostPct();
    const cuotaBoosted = mejor.cuotaBoosted;
    base.cuotaTotalBoosted = cuotaBoosted;
    base.boostPct = boost;
    base.edgeTotal = mejor.edgeTotal;
    base.probBase = conIA ? 'modelo-ia' : 'mixta';
    return base;
}

// -----------------------------------------------------------------------------
// 7b) FEED EN MODO DEGRADADO: informa de los fixtures sin inventar picks
// -----------------------------------------------------------------------------
export function feedSinAnalisis(fixtures, ahoraMs) {
    const nowMs = Number.isFinite(ahoraMs) ? ahoraMs : Date.now();
    const k = partesMadrid(nowMs);
    const sello = pad2(k.hour) + ':' + pad2(k.minute);
    const items = [];

    (fixtures || []).slice(0, 6).forEach(function (f) {
        items.push({
            tag: 'FIXTURE ' + String(f.dia || '').toUpperCase(),
            tagBg: 'rgba(0,212,255,0.15)',
            tagColor: '#00d4ff',
            title: f.partido + ' - ' + f.dia + ' ' + f.fechaCorta + ' a las ' + f.hora,
            desc: f.ligaCorta + ' | cuotas reales: ' + f.mercado + ' | sin analisis de edge en este ciclo',
            time: sello
        });
    });

    if (items.length) {
        items.push({
            tag: 'AVISO',
            tagBg: 'rgba(248,113,113,0.15)',
            tagColor: '#f87171',
            title: 'Cuotas reales publicadas sin analisis de edge',
            desc: 'El agente de IA no ha devuelto veredictos en este ciclo. Se muestran los partidos y cuotas reales; las columnas de modelo y edge quedan vacias a proposito para no publicar datos inventados.',
            time: sello
        });
    }

    return items;
}
//    consume el frontend ({tag, tagBg, tagColor, title, desc, time})
// -----------------------------------------------------------------------------
const PALABRAS_VACIAS = /^(fc|cf|ac|sc|afc|club|de|del|la|el|los|las|city|town|united|real|sport|sporting|athletic|atletico|olympique|ks|fk|sk|if|bk)$/;

// Palabras significativas del nombre de un equipo (>=4 letras, sin sufijos)
export function palabrasClaveEquipo(nombre) {
    return String(nombre || '').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9 ]+/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 4 && !PALABRAS_VACIAS.test(w));
}

// Noticias del feed externo que mencionan a alguno de los equipos implicados
export function noticiasRelevantes(feedExterno, fixtures) {
    const out = [];
    (feedExterno || []).forEach(function (n) {
        const texto = String((n.titulo || n.title || '') + ' ' + (n.resumen || n.desc || '')).toLowerCase();
        const equipos = [];
        (fixtures || []).forEach(function (f) {
            [f.local, f.visitante].forEach(function (eq) {
                const pals = palabrasClaveEquipo(eq);
                const hit = pals.some(p => texto.indexOf(p) !== -1);
                if (hit && equipos.indexOf(eq) === -1) equipos.push(eq);
            });
        });
        if (equipos.length) {
            out.push({
                fuente: n.fuente || n.source || 'feed',
                titulo: String(n.titulo || n.title || '').slice(0, 220),
                fecha: n.fecha || n.pubDate || n.time || null,
                url: n.url || n.link || null,
                equipos: equipos.slice(0, 4)
            });
        }
    });
    return out;
}

export function construirFeedNoticias(analisis, fixtures, ahoraMs) {
    const nowMs = Number.isFinite(ahoraMs) ? ahoraMs : Date.now();
    const k = partesMadrid(nowMs);
    const sello = pad2(k.hour) + ':' + pad2(k.minute);
    const items = [];

    // 1) Los picks con valor, ordenados por EV (lo que interesa al usuario)
    (analisis || []).filter(a => a.evPct > 0).slice(0, 8).forEach(function (a) {
        items.push({
            tag: 'EDGE ' + a.linea + ' / ' + a.lado,
            tagBg: a.lado === 'OVER' ? 'rgba(13,242,166,0.15)' : 'rgba(0,212,255,0.15)',
            tagColor: a.lado === 'OVER' ? '#0df2a6' : '#00d4ff',
            title: a.partido + ' - ' + a.dia + ' ' + a.fechaCorta + ' a las ' + a.hora,
            desc: a.ligaCorta + ' | ' + a.mercado + ' cuota ' + a.cuota + ' | prob. modelo ' + a.modelProb
                + '% vs justa ' + a.justaProb + '% | edge ' + a.edge + ' | EV ' + a.ev
                + (a.justificacion ? ' | ' + a.justificacion : ''),
            time: sello
        });
    });

    // 2) Trazabilidad temporal: si algo se descarto, se dice (nunca ocultar)
    const descartados = (fixtures || []).filter(f => f.temporalStatus && f.temporalStatus !== 'FUTURO_VALIDADO');
    if (descartados.length) {
        items.push({
            tag: 'CONTROL TEMPORAL',
            tagBg: 'rgba(248,113,113,0.15)', tagColor: '#f87171',
            title: descartados.length + ' partidos descartados por validacion temporal',
            desc: 'No se publican partidos ya iniciados ni a menos de ' + MARGEN_PUBLICACION_MIN + ' min del kickoff.',
            time: sello
        });
    }

    return items;
}
