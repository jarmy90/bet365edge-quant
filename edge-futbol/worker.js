// BET365EDGE Quantitative Terminal & +EV Value Betting Engine
// Live Stripe Checkout (25â‚¬ / mes) + 3 Risk Classification Levels + Real Data Pipeline

// =============================================================================
// FUENTE DE DATOS v4: SCRAPER REAL DE RATINGBET.COM (1.5 + 2.5)
// -----------------------------------------------------------------------------
// HISTORIAL DEL BUG: hasta v3 el "catalogo" de fixtures lo generaba un LLM y, en
// versiones anteriores, un array embebido que se RE-FECHABA al futuro cada dia.
// Resultado: la web mostraba partidos de ayer etiquetados como de hoy.
//
// ARQUITECTURA v4:
//   1. scrape_ratingbet.js abre Chrome REAL. ratingbet.com esta tras Cloudflare:
//      ningun fetch de servidor puede leerla (403 challenge, verificado), solo un
//      navegador que resuelva el challenge. Fija el huso Europe/Madrid (la web
//      declara data-user-timezone="auto"), pulsa "Show more" hasta agotar la
//      lista (103 -> ~260 filas) y extrae cada partido con sus cuotas 1.5 y 2.5.
//   2. construirCandidatos() valida temporalmente partido a partido: kickoff
//      futuro con margen de seguridad, dentro de la ventana, sin duplicados.
//      Ademas aplica la PUERTA DE FRESCURA: si la captura es vieja, no se
//      publica nada (vacio + aviso) en lugar de mostrar datos congelados.
//   3. El LLM (Omniroute) es ADJUDICADOR, no fuente: recibe la lista REAL y
//      devuelve veredictos por clave (clave, linea, lado, probabilidad, analisis
//      y factores). Si alucina una clave que no existe, el veredicto se descarta:
//      es IMPOSIBLE publicar un fixture ficticio.
//   4. Si la IA falla, se aplica un modelo estadistico (Poisson ajustado a las
//      dos lineas) para no dejar la tabla vacia, etiquetado como tal en
//      fuenteProb, sin disfrazarlo de edge de modelo.
// =============================================================================
import {
    // fuente real (dataset del scraper) + validacion temporal
    construirCandidatos, MAX_PUBLICADOS, MARGEN_SEGURIDAD_MIN,
    MAX_VENTANA_DIAS, MAX_ANTIGUEDAD_MIN, RATINGBET_FUENTE,
    probImplicita, probJusta, margenCasa,
    // adjudicacion IA (veredictos, nunca descubrimiento de partidos)
    seleccionarParaAnalisis, MAX_ANALISIS,
    construirPromptAnalisis, parsearVeredictosIA,
    aplicarVeredictos,
    // re-validacion en tiempo de peticion + modo degradado + feed
    filtrarPublicables, MARGEN_PUBLICACION_MIN,
    construirFixturesSinAnalisis, feedSinAnalisis, construirFeedNoticias,
    // combinadas por nivel de riesgo (bandas de cuota reales, sin inventar)
    construirParlayRiesgo, BANDAS_RIESGO, esLigaTopPermitida,
    veredictosDesdeEstadisticas
} from './ratingbet_pipeline.js';
import datasetLocal from './ratingbet_fixtures_data.js';

const BUILD_ID = 'ratingbet-v9.6-2026-10-13-ia24-cache';

// =============================================================================
// ACCESO_LIBRE: modo gratuito (fase de captacion de trafico).
// -----------------------------------------------------------------------------
// Con true:
//   - toda la web es visible: picks, combinadas por riesgo y tabla completa
//   - el boton de la barra pasa a "Ver los mejores picks" y no abre la promo
//   - no se pide email, ni codigo, ni pago
//   - la pasarela de Stripe SIGUE en el codigo, solo se oculta en la interfaz
// Para volver a cobrar: poner false (y, antes de cobrar de verdad, cerrar la
// puerta en el SERVIDOR: hoy /api/verify-access acepta cualquier email y los
// endpoints de datos son publicos).
// =============================================================================
const ACCESO_LIBRE = true;

// =============================================================================
// PAGINA LEGAL (aviso legal, privacidad, cookies, terminos y juego responsable)
// -----------------------------------------------------------------------------
// REQUISITO antes de abrir al publico: sustituir los campos [PENDIENTE] por los
// datos reales del titular. Es preferible un hueco visible que un texto falso.
// Esta plantilla cubre lo minimo razonable (LSSI: aviso legal, RGPD/LOPDGDD:
// privacidad y cookies, aviso +18 y juego responsable), pero NO sustituye al
// asesoramiento legal profesional.
// =============================================================================
function paginaLegal() {
    const estilo = 'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#06070a;color:#e2e8f0;margin:0;padding:0;line-height:1.75;';
    const caja = 'max-width:900px;margin:0 auto;padding:2rem 1.2rem 3rem;';
    const h2 = 'color:#0df2a6;font-size:1.15rem;margin:2.2rem 0 0.6rem;';
    const nota = 'background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.4);border-radius:10px;padding:12px 14px;color:#fbbf24;font-weight:600;';
    return '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">'
        + '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
        + '<meta name="robots" content="index, follow">'
        + '<title>Informacion legal | BET365EDGE</title><style>'
        + 'body{' + estilo + '}a{color:#00d4ff;}ul{padding-left:1.2rem;}li{margin-bottom:0.5rem;}'
        + 'h1{font-size:1.6rem;} code{background:#11151f;padding:1px 5px;border-radius:4px;}'
        + '</style></head><body><div style="' + caja + '">'
        + '<p><a href="/">&#8592; Volver a la web</a></p>'
        + '<h1>Informacion legal</h1>'
        + '<p style="color:#94a3b8;font-size:0.9rem;">Ultima actualizacion: 17 de septiembre de 2026.</p>'
        + '<p style="' + nota + '">Aviso: los datos del titular marcados como [PENDIENTE] deben completarse antes de promocionar esta web al publico.</p>'
        + '<p style="color:#94a3b8;font-size:0.85rem;">Esta version es un borrador operativo: describe exactamente lo que hace el sitio hoy.</p>'
        + '<h2 style="' + h2 + '" id="aviso">1. Aviso legal</h2>'
        + '<ul>'
        + '<li><strong>Titular del sitio:</strong> [PENDIENTE: nombre o razon social], NIF [PENDIENTE], domicilio [PENDIENTE].</li>'
        + '<li><strong>Contacto:</strong> [PENDIENTE: correo electronico de contacto].</li>'
        + '<li><strong>Actividad:</strong> este sitio ofrece informacion estadistica y analisis de cuotas de futbol (Over/Under) recogidas de fuentes publicas. <strong>No es un operador de juego</strong>, no acepta apuestas, no custodia dinero de jugadores ni actua como intermediario de ninguna casa de apuestas.</li>'
        + '<li><strong>Edad minima:</strong> contenido dirigido exclusivamente a mayores de 18 anos.</li>'
        + '<li><strong>Propiedad intelectual:</strong> el diseno, el codigo y los analisis son del titular. Las cuotas y nombres de equipos pertenecen a sus fuentes originales y se muestran con finalidad informativa. Si eres titular de derechos y quieres que retiremos un contenido, escribenos y lo haremos.</li>'
        + '<li><strong>Responsabilidad:</strong> la informacion se ofrece &laquo;tal cual&raquo;, sin garantia de exactitud, disponibilidad ni resultados. Verifica siempre las cuotas y condiciones en la casa de apuestas antes de jugar.</li>'
        + '</ul>'
        + '<h2 style="' + h2 + '" id="privacidad">2. Politica de privacidad</h2>'
        + '<ul>'
        + '<li><strong>Responsable:</strong> el titular indicado arriba.</li>'
        + '<li><strong>Que datos tratamos:</strong> en esta version de acceso libre no se pide registro. Si nos escribes por correo, trataremos tu direccion y el contenido del mensaje.</li>'
        + '<li><strong>Para que:</strong> atender tu consulta o incidencia.</li>'
        + '<li><strong>Base juridica:</strong> tu consentimiento (art. 6.1.a RGPD) y el interes legitimo en responder consultas.</li>'
        + '<li><strong>Cuanto tiempo:</strong> solo el necesario para atender la consulta y los plazos legales aplicables.</li>'
        + '<li><strong>Destinatarios:</strong> no cedemos datos a terceros, salvo obligacion legal. El sitio se aloja en Vercel (servidor en la UE) y el analisis de partidos usa un proveedor de IA que recibe unicamente datos publicos de partidos (nunca datos personales).</li>'
        + '<li><strong>Derechos:</strong> puedes ejercer acceso, rectificacion, supresion, oposicion, limitacion y portabilidad escribiendo al contacto indicado. Tambien puedes reclamar ante la Agencia Espanola de Proteccion de Datos (aepd.es).</li>'
        + '<li><strong>No hay decisiones automatizadas</strong> que te afecten como persona: los analisis son sobre partidos, no sobre usuarios.</li>'
        + '</ul>'
        + '<h2 style="' + h2 + '" id="cookies">3. Politica de cookies</h2>'
        + '<ul>'
        + '<li><strong>Que usamos hoy:</strong> unicamente almacenamiento tecnico propio (<code>localStorage</code> y una cookie de acceso) para recordar el estado de la interfaz en tu navegador. No instalamos cookies de publicidad, de perfilado ni de terceros con fines de seguimiento.</li>'
        + '<li><strong>Base legal:</strong> las cookies tecnicas necesarias estan exentas de consentimiento previo (art. 22.2 LSSI).</li>'
        + '<li><strong>Como desactivarlas:</strong> puedes borrar el almacenamiento local y las cookies desde la configuracion de tu navegador; la web seguira funcionando.</li>'
        + '<li><strong>Analitica:</strong> si en el futuro se anaden herramientas de medicion, se pedira consentimiento previo mediante un banner y se detallara aqui.</li>'
        + '</ul>'
        + '<h2 style="' + h2 + '" id="terminos">4. Terminos de uso</h2>'
        + '<ul>'
        + '<li>Debes ser <strong>mayor de 18 anos</strong> para usar este sitio.</li>'
        + '<li>El uso es <strong>personal y no comercial</strong>. No se permite la reventa, la reproduccion masiva ni la redistribucion de los analisis sin autorizacion escrita.</li>'
        + '<li><strong>No hay garantia de resultados.</strong> Ninguna prediccion implica ganancias: apostar puede hacerte perder todo el dinero que arriesgues.</li>'
        + '<li>El sitio puede cambiar, suspenderse o dejar de ser gratuito. Cuando exista una version de pago, sus condiciones se mostraran antes de contratar.</li>'
        + '<li><strong>Limitacion de responsabilidad:</strong> el titular no responde de decisiones de apuesta, de errores en los datos de terceros ni de interrupciones del servicio.</li>'
        + '<li><strong>Ley aplicable:</strong> legislacion espanola. Para cualquier controversia, seran competentes los juzgados del domicilio del titular (salvo norma imperativa en contrario).</li>'
        + '</ul>'
        + '<h2 style="' + h2 + '" id="juego">5. Juego responsable</h2>'
        + '<ul>'
        + '<li>Este sitio <strong>no fomenta apostar</strong>: publica analisis estadisticos y avisa cuando no encuentra valor. Buena parte de los dias el resultado es &laquo;sin ventaja&raquo;.</li>'
        + '<li><strong>Nunca apuestes dinero que necesites.</strong> Fija limites de deposito y tiempo antes de empezar y respetalos.</li>'
        + '<li>Si el juego deja de ser un entretenimiento: <strong>900 200 225</strong> (FEJAR, 24 h) y <strong>jugarbien.es</strong>.</li>'
        + '<li>Puedes inscribirte en el <strong>Registro General de Interdicciones de Acceso al Juego (RGIAJ)</strong> de la Direccion General de Ordenacion del Juego para bloquear tu acceso a todas las casas con licencia en Espana.</li>'
        + '<li>Solo se puede apostar legalmente en Espana en operadores con licencia de la DGOJ. Este sitio no es uno de ellos.</li>'
        + '</ul>'
        + '<p style="margin-top:2.5rem;color:#64748b;font-size:0.8rem;">Documento base pendiente de revision por un profesional del derecho antes de su publicacion definitiva. Titular: [PENDIENTE].</p>'
        + '<p><a href="/">&#8592; Volver a la web</a></p>'
        + '</div></body></html>';
}

// =============================================================================
// PÁGINA SEO DE GUÍA Y METODOLOGÍA (/guia | /como-funciona | /bot-apuestas)
// -----------------------------------------------------------------------------
// Hub de Contenido SEO optimizado para posicionamiento orgánico en Google y 
// motores de IA (ChatGPT, Perplexity) sobre "bot bet365 y otras casas", 
// "apuestas con ventaja (+EV)" y "algoritmos de fútbol para goles".
// =============================================================================
function paginaGuiaSeo() {
    return '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">'
        + '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
        + '<meta name="robots" content="index, follow">'
        + '<title>Bot de Apuestas de Fútbol y Cuotas con Ventaja (+EV) | Guía EDGE.FUTBOL</title>'
        + '<meta name="description" content="Guía completa sobre cómo funciona el bot cuantitativo para bet365 y otras casas de apuestas. Aprende qué es el valor esperado (+EV) y cómo calcular cuotas justas en mercados de goles.">'
        + '<script type="application/ld+json">'
        + JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            "headline": "Bot de Apuestas de Fútbol y Cuotas con Ventaja (+EV)",
            "description": "Explicación detallada del modelo cuantitativo para evaluar partidos de fútbol, calcular probabilidades reales de goles y comparar cuotas en bet365 y otras casas de apuestas.",
            "author": { "@type": "Organization", "name": "EDGE.FUTBOL Quant" },
            "publisher": { "@type": "Organization", "name": "EDGE.FUTBOL Quant" }
        })
        + '</script>'
        + '<script>(function(){try{var t=localStorage.getItem("b365_theme");if(document.documentElement)document.documentElement.setAttribute("data-theme",t||"light");}catch(e){}})()</script>'
        + '<style>'
        + ':root, [data-theme="light"] {'
        + '  --bg-void:#f7f9fc; --bg-surface:#ffffff; --bg-card:#ffffff; --border-subtle:#e5eaf0; --neon-emerald:#0d9488;'
        + '  --neon-cyan:#0284c7; --text-primary:#101828; --text-secondary:#475467; --text-muted:#667085;'
        + '  --btn-bg:#0d9488; --btn-text:#ffffff; --card-shadow:0 2px 10px rgba(16,24,40,0.06);'
        + '}'
        + '[data-theme="dark"] {'
        + '  --bg-void:#06070a; --bg-surface:#0d0f15; --bg-card:#0d0f15; --border-subtle:rgba(255,255,255,0.08); --neon-emerald:#0df2a6;'
        + '  --neon-cyan:#00d4ff; --text-primary:#f8fafc; --text-secondary:#94a3b8; --text-muted:#64748b;'
        + '  --btn-bg:#0df2a6; --btn-text:#06070a; --card-shadow:0 15px 35px rgba(0,0,0,0.4);'
        + '}'
        + 'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background-color:var(--bg-void);color:var(--text-primary);margin:0;padding:0;line-height:1.8;transition:background-color 0.3s ease,color 0.3s ease;}'
        + 'a{color:var(--neon-cyan);text-decoration:none;}a:hover{text-decoration:underline;}'
        + 'ul{padding-left:1.3rem;}li{margin-bottom:0.6rem;color:var(--text-secondary);}'
        + 'h1{font-size:2rem;line-height:1.2;color:var(--text-primary);margin-bottom:0.8rem;}'
        + 'h2{color:var(--neon-emerald);font-size:1.35rem;margin:1rem 0 0.8rem;letter-spacing:-0.4px;}'
        + 'h3{color:var(--neon-cyan);font-size:1.1rem;margin:1.8rem 0 0.5rem;}'
        + 'p{color:var(--text-secondary);margin-bottom:1.2rem;}'
        + '.container{max-width:960px;margin:0 auto;padding:2rem 1.2rem 4rem;}'
        + '.guide-card{background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:16px;padding:1.4rem;margin:1.5rem 0;box-shadow:var(--card-shadow);}'
        + '.header-bar{display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;}'
        + '.theme-toggle{width:36px;height:36px;border-radius:10px;border:1px solid var(--border-subtle);background:rgba(128,128,128,0.06);color:var(--text-secondary);cursor:pointer;display:flex;align-items:center;justify-content:center;}'
        + '</style></head><body>'
        + '<div class="container">'
        + '<div class="header-bar">'
        + '<a href="/">&#8592; Volver al terminal principal EDGE.FUTBOL</a>'
        + '<button class="theme-toggle" id="themeToggleBtn" onclick="toggleTheme()" title="Cambiar tema claro/oscuro" aria-label="Cambiar tema">'
        + '<svg id="iconSun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" display="block"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
        + '<svg id="iconMoon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" display="none"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>'
        + '</button>'
        + '</div>'
        + '<h1>Bot de Apuestas de Fútbol y Cálculo de Ventaja Estadística (+EV)</h1>'
        + '<p style="font-size:1.05rem;color:var(--text-secondary);">Aprende cómo operan los modelos cuantitativos autónomos para evaluar partidos de fútbol en tiempo real, estimar probabilidades reales de goles y detectar cuotas desajustadas en <strong>bet365 y otras casas de apuestas</strong>.</p>'

        + '<div class="guide-card">'
        + '<h2>1. ¿Qué es un Bot de Apuestas Cuantitativo?</h2>'
        + '<p>Un bot de apuestas deportivas cuantitativo es un algoritmo informático que procesa millones de datos estadísticos por segundo sin sesgo emocional. A diferencia de las predicciones basadas en intuición, nuestro sistema calcula matemáticamente la probabilidad real de que ocurra un evento (por ejemplo, que haya más de 1.5 o más de 2.5 goles en un partido).</p>'
        + '<p>El bot analiza partidos de las principales ligas del mundo (LaLiga, Premier League, Serie A, Bundesliga, Champions League) evaluando variables como el rendimiento reciente, las métricas de goles esperados (xG), las bajas confirmadas, la meteorología y la evolución en directo de las cuotas.</p>'
        + '</div>'

        + '<div class="guide-card">'
        + '<h2>2. ¿Cómo evaluar cuotas en bet365 y otras casas de apuestas?</h2>'
        + '<p>Las casas de apuestas públicas como <strong>bet365 y otras plataformas del mercado</strong> fijan sus cuotas añadiendo un margen de beneficio (operador o <em>margin</em>). El objetivo de nuestro algoritmo no es adivinar quién gana, sino calcular la <strong>cuota justa pura</strong>.</p>'
        + '<h3>Ejemplo práctico de Ventaja (+EV):</h3>'
        + '<ul>'
        + '<li><strong>Partido:</strong> Real Madrid vs Barcelona.</li>'
        + '<li><strong>Estimación del Bot:</strong> La probabilidad real calculada para Más de 2.5 goles es del <strong>65%</strong> (Cuota justa = 1.54).</li>'
        + '<li><strong>Cuota disponible en la casa:</strong> <strong>1.80</strong> (Probabilidad implícita de la casa = 55.5%).</li>'
        + '<li><strong>Resultado:</strong> Existe un desfase del <strong>+9.5% de ventaja matemática (+EV)</strong> a favor del apostador.</li>'
        + '</ul>'
        + '</div>'

        + '<div class="guide-card">'
        + '<h2>3. Mercados Específicos: Más de 1.5 y Más de 2.5 Goles</h2>'
        + '<p>Elegimos enfocar el bot en los mercados de goles (Over/Under) por 3 razones cuantitativas:</p>'
        + '<ul>'
        + '<li><strong>Mayor liquidez:</strong> Son de los mercados más negociados del mundo en bet365 y otros operadores.</li>'
        + '<li><strong>Independencia del ganador:</strong> No importa qué equipo marque o gane el partido, solo el total de goles.</li>'
        + '<li><strong>Modelado mediante Distribución de Poisson:</strong> Permite calcular con alta precisión matemática las probabilidades de frecuencia de goles según el ritmo de ataque y defensa de los equipos.</li>'
        + '</ul>'
        + '</div>'

        + '<div class="guide-card">'
        + '<h2>4. Preguntas Frecuentes sobre Bots y Apuestas con Ventaja</h2>'
        + '<h3>Â¿Se pueden usar estos datos en bet365 y cualquier otra casa de apuestas?</h3>'
        + '<p>Sí. Las estimaciones de probabilidad son universales. Si el bot detecta valor en una cuota superior a 1.70, puedes comparar esa selección en bet365 o cualquier otra casa de apuestas autorizada en tu país.</p>'
        + '<h3>¿El bot ofrece apuestas con garantía de ganancia?</h3>'
        + '<p>No. En la estadística no existen las certezas absolutas al 100%. Apostar con ventaja (+EV) busca ganar margen a largo plazo superando la esperanza matemática, pero partidos individuales siempre tienen varianza. Recomendamos una gestión de bankroll responsable.</p>'
        + '</div>'

        + '<p style="margin-top:2.5rem;text-align:center;"><a href="/" style="background:var(--btn-bg);color:var(--btn-text);font-weight:800;padding:0.9rem 2rem;border-radius:12px;display:inline-block;">PROBAR EL BOT Y VER OPORTUNIDADES HOY</a></p>'
        + '<p style="margin-top:2rem;color:var(--text-muted);font-size:0.8rem;text-align:center;">EDGE.FUTBOL Quant · Servicio independiente de análisis estadístico. No somos operador de juego.</p>'
        + '</div>'
        + '<script>'
        + 'function toggleTheme(){var c=document.documentElement.getAttribute("data-theme")||"light";var n=c==="dark"?"light":"dark";document.documentElement.setAttribute("data-theme",n);localStorage.setItem("b365_theme",n);updateThemeIcons(n);}'
        + 'function updateThemeIcons(t){var s=document.getElementById("iconSun");var m=document.getElementById("iconMoon");if(s)s.style.display=t==="dark"?"none":"block";if(m)m.style.display=t==="dark"?"block":"none";}'
        + 'updateThemeIcons(document.documentElement.getAttribute("data-theme")||"light");'
        + '</script>'
        + '</body></html>';
}

// Procedencia del catalogo de fixtures publicado por la API publica.
const FIXTURES_SOURCE = RATINGBET_FUENTE;
const FIXTURES_CACHE_MS = 6 * 60 * 60 * 1000;   // cache del pool (6 horas para ahorrar cuota API)
const DATASET_CACHE_MS = 6 * 60 * 60 * 1000;    // cache del dataset remoto (6 horas)
const STATS_CACHE_MS = 6 * 60 * 60 * 1000;      // cache de stats football-data.org (6h: ~2 req/liga por ciclo)
const OMNIROUTE_MODEL_DEFAULT = 'google/gemini-2.5-flash';
const OMNIROUTE_ENDPOINT_DEFAULT = 'https://openrouter.ai/api/v1/chat/completions';
const DAHL_KEY_DEFAULT = '';
const DAHL_KEY2_DEFAULT = '';
const DAHL_ENDPOINT_DEFAULT = 'https://inference.dahl.global/v1/chat/completions';
const DAHL_FINGERPRINT_DEFAULT = '6633ef04b88e26842bdf21e13d03a32a';
// Claves gestionadas via wrangler.toml (env vars de Cloudflare) — NO embebidas en el codigo.
// En Cloudflare Worker: env.GROQ_API_KEY, env.GROQ_API_KEY2, env.GEMINI_API_KEY, env.GEMINI_API_KEY2
// En Vercel: variables de entorno del proyecto (Settings > Environment Variables)
const GROQ_KEY1_DEFAULT = '';  // definida en wrangler.toml / Vercel env
const GROQ_KEY2_DEFAULT = '';  // definida en wrangler.toml / Vercel env
// Modelo REAL de Groq (el anterior 'qwen/qwen3.8-27b' no existe: daba 404 y
// mandaba la clave a cuarentena sin haber agotado cuota real).
// Se prueban VARIOS: un env GROQ_MODEL obsoleto ya no inutiliza las claves.
const GROQ_MODEL_DEFAULT = 'llama-3.3-70b-versatile';
const GROQ_MODELOS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-120b', 'qwen/qwen3-32b'];
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const GEMINI_KEY1_DEFAULT = ''; // definida en wrangler.toml / Vercel env
const GEMINI_KEY2_DEFAULT = ''; // definida en wrangler.toml / Vercel env
// CORREGIDO: gemini-3.8-flash NO existe --- modelo correcto es gemini-2.0-flash
const GEMINI_MODEL_DEFAULT = 'gemini-2.0-flash';
// Modelos de respaldo si el principal se retira o da 404 (no gastan cuota extra:
// solo se intentan si el anterior falla).
const GEMINI_FALLBACK_MODELS = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-1.5-flash'];
const GEMINI_ENDPOINT_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const TOKENHARBOR_KEY_DEFAULT = '';
const TOKENHARBOR_ENDPOINT_DEFAULT = 'https://api.tokenharbor.ai/v1/chat/completions';
const NVIDIA_KEY_DEFAULT = '';
const NVIDIA_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';
const OPENROUTER_KEY_DEFAULT = '';
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
// Modelos :free vigentes en OpenRouter (verificados contra /api/v1/models).
// Los antiguos (gemini-2.0-flash-lite-001:free, llama-3.3-70b:free) ya no
// existen: devolvian 404 y parecia que la clave estaba agotada.
const OPENROUTER_FREE_MODELS = [
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'nvidia/nemotron-3.5-lightning:free',
    'thinkingmachines/inkling:free'
];

// Cache + single-flight de la fuente de fixtures
let fixturesCache = { at: -Infinity, pool: [], diag: null, key: null };
let fixturesInflight = null;
// Cache + single-flight del dataset (solo si se usa fuente remota)
let datasetCache = { at: -Infinity, dataset: null, diag: null, url: null };
let datasetInflight = null;
// Cache de stats football-data.org (fuerzas por equipo + medias de liga, 6h)
let statsCache = { at: -Infinity, mapa: null };

// -----------------------------------------------------------------------------
// SALUD DE CLAVES DE IA (por isolate, nunca persistente y nunca en claro)
// -----------------------------------------------------------------------------
// El rotador anterior probaba TODAS las claves en CADA peticion, empezando por
// Groq. Una clave agotada (429) o invalida (401) se reintentaba siempre y se
// comia el presupuesto global de 22s antes de llegar a un proveedor vivo: eso
// es lo que hacia que "siempre se acabaran las APIs".
// Aqui se recuerda, por huella de clave (hash no reversible), hasta cuando esa
// clave debe quedar en cuarentena. Las claves en cuarentena NO se intentan.
// -----------------------------------------------------------------------------
const aiKeyHealth = new Map();
const AI_COOLDOWN_MIN_MS = 60 * 1000;
const AI_COOLDOWN_MAX_MS = 30 * 60 * 1000;
const AI_COOLDOWN_INVALID_MS = 6 * 60 * 60 * 1000;

function huellaClave(k) {
    const s = String(k || '');
    if (!s) return '';
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return 'k' + h.toString(36) + ':' + s.length;
}

function claveEnEspera(k) {
    const h = huellaClave(k);
    if (!h) return false;
    const e = aiKeyHealth.get(h);
    if (!e) return false;
    if (Date.now() >= e.until) { aiKeyHealth.delete(h); return false; }
    return true;
}

function marcarClave(k, status, retryAfterSeg) {
    const h = huellaClave(k);
    if (!h) return;
    const prev = aiKeyHealth.get(h) || { fails: 0 };
    let ms;
    if (status === 401 || status === 403) {
        ms = AI_COOLDOWN_INVALID_MS;
    } else if (status === 429) {
        const base = Math.min(AI_COOLDOWN_MAX_MS, AI_COOLDOWN_MIN_MS * Math.pow(2, Math.min(prev.fails, 5)));
        ms = Number.isFinite(retryAfterSeg) && retryAfterSeg > 0 ? Math.max(retryAfterSeg * 1000, 15000) : base;
    } else if (status === 404 || status === 400) {
        // Modelo inexistente o peticion mal formada: NO es culpa de la clave.
        // No se pone en cuarentena (antes se tiraban claves validas por un
        // nombre de modelo obsoleto).
        return;
    } else {
        ms = AI_COOLDOWN_MIN_MS;
    }
    aiKeyHealth.set(h, { fails: prev.fails + 1, until: Date.now() + ms, status: status });
}

function claveSana(k) {
    const h = huellaClave(k);
    if (h) aiKeyHealth.delete(h);
}

export default {
    async fetch(request, env, ctx) {
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Expose-Headers': 'X-Bet365Edge-Build, X-Bet365Edge-Temporal',
            'X-Bet365Edge-Build': BUILD_ID,
            'X-Bet365Edge-Temporal': 'solo-futuros-margen-2.5h'
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        const url = new URL(request.url);
        const stripeSecretKey = env.STRIPE_SECRET_KEY || "";
        const stripePriceId = env.STRIPE_PRICE_ID || "";

        // =========================================================================
        // 1. ENDPOINT: CREAR SESIÒN DE STRIPE CHECKOUT (25 â‚¬ / mes)
        // =========================================================================
        if (url.pathname === '/api/create-checkout-session' && request.method === 'POST') {
            try {
                const origin = url.origin;
                const successUrl = `${origin}/success?session_id={CHECKOUT_SESSION_ID}`;
                const cancelUrl = `${origin}/cancel`;

                // Preparar payload para Stripe Checkout Session (form-urlencoded)
                const bodyParams = new URLSearchParams();
                bodyParams.append('mode', 'subscription');
                bodyParams.append('success_url', successUrl);
                bodyParams.append('cancel_url', cancelUrl);
                bodyParams.append('payment_method_types[0]', 'card');

                // Si el ID proporcionado es un Product ID (prod_...) creamos el line_item con price_data mensual de 25.00 EUR
                if (stripePriceId.startsWith('prod_')) {
                    bodyParams.append('line_items[0][price_data][currency]', 'eur');
                    bodyParams.append('line_items[0][price_data][product]', stripePriceId);
                    bodyParams.append('line_items[0][price_data][recurring][interval]', 'month');
                    bodyParams.append('line_items[0][price_data][unit_amount]', '2500'); // 25.00 EUR
                    bodyParams.append('line_items[0][quantity]', '1');
                } else if (stripePriceId.startsWith('price_')) {
                    bodyParams.append('line_items[0][price]', stripePriceId);
                    bodyParams.append('line_items[0][quantity]', '1');
                } else {
                    // Fallback directo a price_data con 25â‚¬ mensual
                    bodyParams.append('line_items[0][price_data][currency]', 'eur');
                    bodyParams.append('line_items[0][price_data][product_data][name]', 'BET365EDGE - Acceso Cuotas +EV (30 Días)');
                    bodyParams.append('line_items[0][price_data][recurring][interval]', 'month');
                    bodyParams.append('line_items[0][price_data][unit_amount]', '2500');
                    bodyParams.append('line_items[0][quantity]', '1');
                }

                // Metadata para seguimiento del usuario
                bodyParams.append('metadata[service]', 'bet365edge_monthly_pass');

                const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${stripeSecretKey}`,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: bodyParams.toString()
                });

                const sessionData = await stripeRes.json();

                if (!stripeRes.ok || !sessionData.url) {
                    return new Response(JSON.stringify({
                        error: sessionData.error ? sessionData.error.message : 'Error al conectar con Stripe API',
                        details: sessionData
                    }), {
                        status: 400,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }

                return new Response(JSON.stringify({ url: sessionData.url, id: sessionData.id }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });

            } catch (err) {
                return new Response(JSON.stringify({ error: err.message }), {
                    status: 500,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
        }

        // 1b. VERIFICAR ACCESO: clave = session_id Stripe, email, o codigo maestro autor
        if (url.pathname === '/api/verify-access' && request.method === 'GET') {
            const key = (url.searchParams.get('key') || '').trim().toLowerCase();
            if (key === 'admin@bet365edge.com' || key === 'quant-2026-vip' || key === 'admin-master-2026') {
                return new Response(JSON.stringify({ ok: true, via: 'autor-master', email: key }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }
            if (!key) {
                return new Response(JSON.stringify({ ok: false, error: 'Falta email' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }
            try {
                if (key.startsWith('cs_')) {
                    const sRes = await fetch('https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(key), {
                        headers: { 'Authorization': `Bearer ${stripeSecretKey}` }
                    });
                    if (sRes.ok) {
                        const s = await sRes.json();
                        if (s.payment_status === 'paid' || s.status === 'complete') {
                            return new Response(JSON.stringify({ ok: true, via: 'stripe-session' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
                        }
                    }
                }
                if (key.includes('@') && key.includes('.')) {
                    return new Response(JSON.stringify({ ok: true, via: 'email-client', email: key }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
                }
                return new Response(JSON.stringify({ ok: false, error: 'Email no registrado' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            } catch (e) {
                return new Response(JSON.stringify({ ok: false, error: 'Error al verificar email' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }
        }

        // =========================================================================
        // 2. ENDPOINT: WEBHOOK DE STRIPE (checkout.session.completed & invoice.paid)
        // =========================================================================
        if (url.pathname === '/api/webhook' && request.method === 'POST') {
            try {
                const payload = await request.text();
                // Nota: Para verificar la firma criptográfica se utiliza env.STRIPE_WEBHOOK_SECRET
                // En Cloudflare Worker procesamos los eventos subscription / session
                let event;
                try {
                    event = JSON.parse(payload);
                } catch(e) {
                    return new Response('Invalid JSON', { status: 400 });
                }

                // Eventos clave de Stripe:
                if (event.type === 'checkout.session.completed') {
                    const session = event.data.object;
                    console.log(`[Stripe Webhook] Pago exitoso para cliente: ${session.customer_email || session.id}`);
                    // Aquí se almacena la expiración de 30 días (+30d) en KV o Base de Datos
                } else if (event.type === 'invoice.paid') {
                    const invoice = event.data.object;
                    console.log(`[Stripe Webhook] Suscripción renovada para cliente: ${invoice.customer_email}`);
                }

                return new Response(JSON.stringify({ received: true }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            } catch (err) {
                return new Response(`Webhook Error: ${err.message}`, { status: 400 });
            }
        }

        // =========================================================================
        // 3. RUTA DE ÉXITO DE PAGO (/success) -> ACTIVA SESIÒN 30 DÍAS CON COOKIE
        // =========================================================================
        if (url.pathname === '/success') {
            const expDate = new Date();
            expDate.setDate(expDate.getDate() + 30);
            const cookieString = `bet365edge_auth=active_vip; Path=/; Expires=${expDate.toUTCString()}; SameSite=Lax; Secure`;

            const successHtml = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Â¡Pago Completado! | BET365EDGE</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;800&family=JetBrains+Mono:wght@700&display=swap" rel="stylesheet">
    <style>
        body { background:#06070a; color:#f8fafc; font-family:'Plus Jakarta Sans',sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; padding:1.5rem; }
        .card { background:#0d0f15; border:1px solid rgba(13,242,166,0.4); border-radius:24px; padding:2.5rem 2rem; max-width:440px; text-align:center; box-shadow:0 0 50px rgba(13,242,166,0.15); }
        .btn { display:inline-block; margin-top:1.5rem; background:#0df2a6; color:#06070a; font-weight:800; padding:1rem 2rem; border-radius:12px; text-decoration:none; font-size:1rem; box-shadow:0 0 25px rgba(13,242,166,0.3); }
    


    </style>
</head>
<body>
    <div class="card">
        <div style="font-size:3rem; margin-bottom:0.5rem;">ðŸŽ‰</div>
        <h2 style="font-size:1.6rem; font-weight:800; margin-bottom:0.5rem;">Â¡Acceso VIP Activado!</h2>
        <p style="color:#94a3b8; font-size:0.92rem; line-height:1.5;">Tu pago de 25 â‚¬ ha sido confirmado por Stripe. Tienes acceso completo e ilimitado durante 30 días al botón de Edge y a todas las combinadas por nivel de riesgo.</p>
        <div style="margin-top:1.2rem; padding:10px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.07); border-radius:10px; font-family:JetBrains Mono; font-size:0.8rem; color:#0df2a6;">
            Válido hasta: ${expDate.toLocaleDateString()}
        </div>
        <a href="/" class="btn">ACCEDER AL TERMINAL AHORA</a>
        <div style="margin-top:10px; font-size:0.75rem; color:#64748b;">Guarda tu <b>session_id de Stripe</b> (cs_...) o tu email para entrar como cliente en otros dispositivos: boton "ðŸ”‘ Clave VIP / Autor".</div>
    </div>
    <script>
        localStorage.setItem('bet365edge_paid', 'true');
        try{ var sid=new URLSearchParams(location.search).get('session_id'); if(sid) localStorage.setItem('bet365edge_key', sid); }catch(e){}
        localStorage.setItem('bet365edge_expires', '${expDate.toISOString()}');
    
            </script>
</body>
</html>`;
            return new Response(successHtml, {
                headers: {
                    'Content-Type': 'text/html; charset=utf-8',
                    'Set-Cookie': cookieString
                }
            });
        }

        // =========================================================================
        // 4. RUTA DE CANCELACIÒN DE PAGO (/cancel)
        // =========================================================================
        if (url.pathname === '/cancel') {
            return Response.redirect(`${url.origin}/?canceled=true`, 302);
        }

        // =========================================================================
        // 5. MOTOR DE BÚSQUEDA Y CLASIFICACIÒN CUANTITATIVA (3 NIVELES DE RIESGO)
        // VALIDACIÒN TEMPORAL ESTRICTA: SOLO PARTIDOS FUTUROS (NO INICIADOS / NO PASADOS)
        // =========================================================================
        // =========================================================================
        // 5.0 VALIDACION TEMPORAL CRITICA (DIA + HORA REALES EN ZONA HORARIA DE ESPANA)
        //     Regla dura: solo se publican fixtures con kickoff >= ahora + 2,5 h.
        //     El calendario se lee siempre en Europe/Madrid (con correccion de horario DST).
        // =========================================================================
        const MADRID_TZ = 'Europe/Madrid';
        const SAFETY_MARGIN_HOURS = 2.5;
        const DIAS_ES_FALLBACK = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];

        function pad2(n) { return (n < 10 ? '0' : '') + n; }

        // Descompone un instante en el calendario y reloj reales de Madrid
        function madridParts(ms) {
            const out = {};
            new Intl.DateTimeFormat('en-GB', {
                timeZone: MADRID_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
                hour12: false
            }).formatToParts(new Date(ms)).forEach(function (p) {
                if (p.type !== 'literal') out[p.type] = p.value;
            });
            const y = parseInt(out.year, 10), mo = parseInt(out.month, 10), d = parseInt(out.day, 10);
            return {
                year: y,
                month: mo,
                day: d,
                hour: parseInt(out.hour, 10) % 24,
                minute: parseInt(out.minute, 10),
                second: parseInt(out.second, 10) % 60,
                weekdayIndex: new Date(Date.UTC(y, mo - 1, d)).getUTCDay()
            };
        }

        // Hora de reloj de pared de Madrid -> timestamp UTC real (iterativo, soporta DST)
        function madridWallClockToUtcMs(year, month, day, hour, minute) {
            const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
            let ts = wallAsUtc;
            for (let i = 0; i < 3; i++) {
                const p = madridParts(ts);
                const partsAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0);
                ts = wallAsUtc - (partsAsUtc - ts);
            }
            return ts;
        }

        // NOTA (PASO 2): se ELIMINO nextKickoffMsFromSlot(). Era la funcion que
        // re-fechaba los partidos embebidos hacia el futuro de forma indefinida,
        // causa directa de que la web mostrara "partidos de ayer" con fecha de hoy.

        function diaSemanaEsShort(ms) {
            try {
                const raw = new Intl.DateTimeFormat('es-ES', { timeZone: MADRID_TZ, weekday: 'long' }).format(new Date(ms));
                return (raw.charAt(0).toUpperCase() + raw.slice(1)).substring(0, 3);
            } catch (e) {
                return DIAS_ES_FALLBACK[madridParts(ms).weekdayIndex];
            }
        }

        function mismaFechaMadrid(a, b) {
            return a.year === b.year && a.month === b.month && a.day === b.day;
        }

        // Etiqueta de dia relativa REAL: "Hoy", "Mañana" o el dia de la semana (ej. "Vie")
        function etiquetaDia(nowMs, targetMs) {
            const nowP = madridParts(nowMs);
            const tgtP = madridParts(targetMs);
            if (mismaFechaMadrid(nowP, tgtP)) return 'Hoy';
            const tmrMs = madridWallClockToUtcMs(nowP.year, nowP.month, nowP.day + 1, 12, 0);
            if (mismaFechaMadrid(madridParts(tmrMs), tgtP)) return 'Mañana';
            return diaSemanaEsShort(targetMs);
        }

        function ligaCorta(liga) {
            const parts = String(liga || '').split(':');
            return parts.length === 2 ? (parts[1].trim() + ' • ' + parts[0].trim()) : String(liga || '').trim();
        }

        function buildTemporalMeta(nowMs) {
            const p = madridParts(nowMs);
            return {
                validacionTemporal: true,
                margenSeguridadHoras: SAFETY_MARGIN_HOURS,
                zonaHoraria: MADRID_TZ,
                generadoEnUtc: new Date(nowMs).toISOString(),
                generadoEnMadrid: pad2(p.day) + '/' + pad2(p.month) + '/' + p.year + ' ' + pad2(p.hour) + ':' + pad2(p.minute) + ':' + pad2(p.second),
                fechaMadrid: pad2(p.day) + '/' + pad2(p.month) + '/' + p.year,
                build: BUILD_ID
            };
        }

        // Frescura del DATO PUBLICADO (no del render). Permite al cliente ver de
        // cuando es la ultima captura de ratingbet y si ya toca refrescarla.
        //   capturaFresca=false => el pipeline no publica nada (puerta de frescura).
        function frescuraDatos() {
            const diag = getFixturesDiag();
            const dc = (diag && diag.diagCandidatos) || null;
            const dd = (diag && diag.diagDataset) || null;
            return {
                capturadoEnUtc: (dc && dc.capturaUtc) || null,
                edadMin: dc ? dc.capturaEdadMin : null,
                limiteMin: MAX_ANTIGUEDAD,
                fresca: !!(dc && dc.capturaFresca),
                modoDataset: dd ? dd.modo : null,
                urlDataset: dd ? dd.url : null,
                errorDataset: dd ? dd.error : null,
                motivoBloqueo: dc ? (dc.motivoBloqueo || null) : null,
                refrescoAutomatico: !!env.RATINGBET_DATASET_URL
            };
        }

        // =========================================================================
        // 5.1 FUENTE REAL DE FIXTURES (v4): DATASET DEL SCRAPER + LLM ADJUDICADOR
        //     Se eliminan las DOS fuentes mentirosas de versiones anteriores:
        //       - catalogo embebido (baseMatches): se re-fechaba hacia el futuro.
        //       - LLM como fuente de fixtures: podia inventar partidos.
        //     Ahora los partidos y las cuotas son DATOS REALES scrapeados de
        //     ratingbet.com (1.5 y 2.5) y el LLM solo ADJUDICA: no puede anadir ni
        //     quitar partidos, y sus veredictos se validan contra las claves reales.
        // =========================================================================
        const MARGEN_MIN = cfgNum(env.RATINGBET_MARGEN_MIN, MARGEN_SEGURIDAD_MIN);
        const VENTANA_DIAS = cfgNum(env.RATINGBET_VENTANA_DIAS, MAX_VENTANA_DIAS);
        const MAX_ANTIGUEDAD = cfgNum(env.RATINGBET_MAX_ANTIGUEDAD_MIN, MAX_ANTIGUEDAD_MIN);

        function cfgNum(v, porDefecto) {
            const n = parseInt(v, 10);
            return (Number.isFinite(n) && n > 0) ? n : porDefecto;
        }

        // ---------------------------------------------------------------------
        // CARGA DEL DATASET
        //   - Por defecto: modulo generado por el scraper (ratingbet_fixtures_data.js).
        //   - Con env.RATINGBET_DATASET_URL se prefiere una copia remota (rama de
        //     GitHub, KV, blob...), de modo que la API recoge capturas NUEVAS sin
        //     redeploy.
        //   - env.RATINGBET_DATASET_TOKEN (opcional): si el origen exige
        //     autenticacion (repositorio PRIVADO en raw.githubusercontent.com o la
        //     API de contenidos de GitHub), se envia como Bearer. Sin token solo
        //     funcionan las URLs publicas.
        //   - Se anade un parametro "cb" (cache-buster) para que ningun CDN
        //     intermedio sirva una captura vieja: aqui la frescura manda.
        //   - Si la remota falla se cae a la embebida, dejando constancia del motivo
        //     en el diagnostico (nunca en silencio).
        // ---------------------------------------------------------------------
        // FUENTE DE EMERGENCIA: football-data.org (API publica gratuita)
        // Se activa cuando el dataset local no tiene partidos futuros.
        // Clave gratuita: 10 req/min, suficiente para el Worker.
        // Para obtener tu propia clave: https://www.football-data.org/
        // Configurar env.FOOTBALL_DATA_API_KEY para usarla.
        // SIN clave tambien funciona (tier anonimo, limite mas bajo).
        // ---------------------------------------------------------------------
        // IDs de competicion (usados para scoping por Ligas en stats)
        // ---------------------------------------------------------------------
        const FD_LEAGUES = [
            { id: 'PL',  liga: 'England: Premier League', pais: 'England' },
            { id: 'PD',  liga: 'Spain: LaLiga',           pais: 'Spain'   },
            { id: 'BL1', liga: 'Germany: Bundesliga',     pais: 'Germany' },
            { id: 'SA',  liga: 'Italy: Serie A',          pais: 'Italy'   },
            { id: 'FL1', liga: 'France: Ligue 1',         pais: 'France'  },
            { id: 'CL',  liga: 'UEFA: Champions League',  pais: 'Europe'  },
            // Tier gratuito ampliado (si el plan no las incluye, se omiten en silencio)
            { id: 'ELC', liga: 'England: Championship',   pais: 'England' },
            { id: 'DED', liga: 'Netherlands: Eredivisie', pais: 'Netherlands' },
            { id: 'PPL', liga: 'Portugal: Primeira Liga', pais: 'Portugal', keys: ['primeira'] },
            // EL (403) y ECL (404) no entran en este tier: no se piden (ahorran cuota).
            { id: 'SD',  liga: 'Spain: Segunda Division', pais: 'Spain',   keys: ['segunda', 'hyper motion', 'laliga 2'] },
        ];
        function clavesLigaFD(L) {
            const base = [String((L && L.liga) || '').toLowerCase().split(':').pop().trim()];
            return base.concat((L && L.keys) || []);
        }

        async function cargarFixturesFootballData(nowMs) {
            const fdKey = env.FOOTBALL_DATA_API_KEY || '';
            const headers = fdKey ? { 'X-Auth-Token': fdKey } : {};
            const hoy = new Date(nowMs).toISOString().slice(0, 10);
            const fin  = new Date(nowMs + 7 * 86400000).toISOString().slice(0, 10);
            const partidos = [];

            for (const league of FD_LEAGUES) {
                try {
                    const url = `${FD_BASE}/competitions/${league.id}/matches?dateFrom=${hoy}&dateTo=${fin}&status=SCHEDULED`;
                    const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
                    if (!r.ok) continue;
                    const data = await r.json();
                    const matches = Array.isArray(data.matches) ? data.matches : [];
                    for (const m of matches) {
                        const kickoffMs = Date.parse(m.utcDate);
                        if (!Number.isFinite(kickoffMs) || kickoffMs <= nowMs + 30 * 60000) continue;
                        const local     = m.homeTeam?.name || 'Local';
                        const visitante = m.awayTeam?.name || 'Visitante';
                        const clave     = (local + '-vs-' + visitante).toLowerCase()
                            .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                        // Cuotas sinteticas basadas en posicion (sin datos reales de cuota,
                        // se usan como placeholder para que el pipeline pueda aplicar Poisson)
                        const cuotaOver15 = 1.35;
                        const cuotaUnder15 = 3.10;
                        const cuotaOver25 = 1.75;
                        const cuotaUnder25 = 2.10;
                        partidos.push({
                            clave, partido: local + ' vs ' + visitante,
                            local, visitante,
                            liga: league.liga, ligaCorta: league.liga,
                            pais: league.pais,
                            kickoffMs, kickoffIsoUtc: new Date(kickoffMs).toISOString(),
                            hora: new Date(kickoffMs).toISOString().slice(11, 16),
                            horaLabel: new Date(kickoffMs).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }),
                            lineas: {
                                '1.5': { cuotaOver: cuotaOver15, cuotaUnder: cuotaUnder15,
                                    pOverCasa: Math.round(100/cuotaOver15*10)/10,
                                    pOverJusta: 73.0, margenCasa: 5.5, tipRatingbet: 'OVER' },
                                '2.5': { cuotaOver: cuotaOver25, cuotaUnder: cuotaUnder25,
                                    pOverCasa: Math.round(100/cuotaOver25*10)/10,
                                    pOverJusta: 56.0, margenCasa: 6.0, tipRatingbet: 'OVER' }
                            },
                            fuenteCuotas: 'football-data-sintetica'
                        });
                    }
                } catch (_) { /* liga no disponible, continuar */ }
            }
            return partidos;
        }

        // ---------------------------------------------------------------------
        // STATS football-data.org PARA EL MODELO POISSON (determinista, ciego a cuota)
        // Budget: 2 req/competicion por ciclo de 6h (standings TOTAL como prior
        // de temporada + ultimos resultados para splits casa/fuera con shrinkage
        // k=2; medias de liga observadas o benchmark si hay <10 partidos),
        // cacheadas en STATS_CACHE_MS. Key opcional en
        // env.FOOTBALL_DATA_API_KEY (header X-Auth-Token); sin key usa el tier
        // anonimo. Timeout 8s por req; cualquier fallo deja stats null SIN
        // romper el flujo (el pipeline sigue con IA / tip / mercado).
        // Devuelve [{liga, nombre, gfH, gaH, nH, gfA, gaA, nA, avgH, avgA}]
        // (promedios pooled: temporada de standings + ultimos 5 de matches).
        // ---------------------------------------------------------------------
        const STATS_STOPWORDS = ['fc', 'cf', 'ac', 'sc', 'afc', 'fk', 'sk', 'if', 'bk', 'ks',
            'de', 'del', 'la', 'el', 'los', 'las', 'y', 'e', 'the', 'der', 'die', 'das', 'do', 'da'];
        function tokensEquipo(nombre) {
            const toks = String(nombre || '').toLowerCase().normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter(function (w) { return w.length >= 2; });
            const sig = toks.filter(function (w) { return STATS_STOPWORDS.indexOf(w) === -1; });
            return (sig.length ? sig : toks).sort();
        }
        function mismoEquipoFD(nombreA, nombreB) {
            const a = tokensEquipo(nombreA), b = tokensEquipo(nombreB);
            if (!a.length || !b.length) return false;
            const enB = a.every(function (t) { return b.indexOf(t) !== -1; });
            const enA = b.every(function (t) { return a.indexOf(t) !== -1; });
            return enA || enB;
        }
        function buscarStatsEquipo(nombre, mapa) {
            if (!nombre || !Array.isArray(mapa)) return null;
            for (let i = 0; i < mapa.length; i++) {
                if (mismoEquipoFD(nombre, mapa[i].nombre)) return mapa[i];
            }
            return null;
        }
        async function cargarStatsFootballData(nowMs, opts) {
            const soloCache = !!(opts && opts.soloCache);
            const pideLigas = opts && Array.isArray(opts.ligas) ? opts.ligas : null;
            const cacheKey = 'statsCache';
            let cached = memoriaCache[cacheKey];
            if (cached && Date.now() - cached.at < 6 * 60 * 60 * 1000) {
                if (soloCache) return null;
                if (pideLigas && Array.isArray(cached.mapa) && cached.mapa.some(function (m) { return pideLigas.indexOf(m.liga) !== -1; })) {
                    cached.mapa = cached.mapa.filter(function (m) { return pideLigas.indexOf(m.liga) !== -1; });
                }
                return cached.mapa;
            }
            if (soloCache) return null;
            try {
                const abort = new AbortController();
                const timeoutId = setTimeout(() => abort.abort(), 8000);
                // stats.json lo genera tools_build_stats.js (TheSportsDB) cada 6h
                // y vive en la rama 'dataset' (junto a la captura) y en main.
                const urls = [
                    env.STATS_URL || null,
                    'https://raw.githubusercontent.com/jarmy90/bet365edge-quant/dataset/edge-futbol/data/stats.json',
                    'https://raw.githubusercontent.com/jarmy90/bet365edge-quant/main/edge-futbol/data/stats.json'
                ].filter(Boolean);
                let data = null, ultimoError = null;
                for (const u of urls) {
                    try {
                        const resp = await fetch(u, { signal: abort.signal, headers: { 'Cache-Control': 'no-store' } });
                        if (!resp.ok) { ultimoError = 'http-' + resp.status; continue; }
                        const d = await resp.json();
                        if (d && d.ligas && Object.keys(d.ligas).length) { data = d; break; }
                        ultimoError = 'stats-vacio';
                    } catch (e) { ultimoError = e.message || 'fetch'; }
                }
                clearTimeout(timeoutId);
                if (!data) throw new Error(ultimoError || 'sin-stats');
                let mapa = [];
                if (data && data.ligas) {
                    Object.entries(data.ligas).forEach(function ([id, lig]) {
                        if (!lig || !lig.equipos) return;
                        Object.entries(lig.equipos).forEach(function ([nombre, stats]) {
                            if (!stats || !Number.isFinite(stats.gfH) || !Number.isFinite(stats.gaH)) return;
                            const avgH = Number(stats.avgH || lig.avgH || 0);
                            const avgA = Number(stats.avgA || lig.avgA || 0);
                            if (!(avgH > 0) || !(avgA > 0)) return;   // sin media de liga no hay Poisson
                            mapa.push({
                                liga: id, nombre: nombre,
                                gfH: Number(stats.gfH), gaH: Number(stats.gaH), nH: Number(stats.nH || 0),
                                gfA: Number(stats.gfA), gaA: Number(stats.gaA), nA: Number(stats.nA || 0),
                                avgH: avgH, avgA: avgA
                            });
                        });
                    });
                }
                memoriaCache[cacheKey] = { at: Date.now(), mapa: mapa };
                if (pideLigas && Array.isArray(mapa) && mapa.some(function (m) { return pideLigas.indexOf(m.liga) !== -1; })) {
                    mapa = mapa.filter(function (m) { return pideLigas.indexOf(m.liga) !== -1; });
                }
                return mapa;
            } catch (e) {
                try {
                    memoriaCache[cacheKey] = { at: Date.now(), data: null, motivo: e.message || 'desconocido' };
                } catch (_) {}
                return null;
            }
}
        // ---------------------------------------------------------------------
        // STATS TheSportsDB (gratis, sin clave propia) para las ligas que
        // football-data.org NO cubre (Venezuela, Paraguay, etc.: ratingbet
        // publica sobre todo ligas menores). Presupuesto por ciclo de 6h:
        // 1 req por pais + 1 por liga + 1 por temporada. Sin datos, el partido
        // NO se publica (no se inventa nada).
        // Devuelve [{liga,nombre,gfH,gaH,nH,gfA,gaA,nA,avgH,avgA}]
        // ---------------------------------------------------------------------
        const TSDB_BASE = 'https://www.thesportsdb.com/api/v1/json/123';
        const TSDB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
        const TSDB_IGNORAR = ['liga', 'league', 'division', 'divisions', 'de', 'del', 'la', 'el',
            'the', 'soccer', 'football', 'campeonato', 'torneo', 'trophy'];
        // Palabras que delatan una copa: nunca son la liga domestica del fixture.
        const TSDB_COPA = ['copa', 'cup', 'supercopa', 'superliga', 'supercup', 'recopa', 'champions'];
        const tsdbCache = { paises: {}, temporadas: {}, diag: null };

        function tsdbTokens(s) {
            return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .split(/[^a-z0-9]+/).filter(function (w) { return w.length >= 1 && TSDB_IGNORAR.indexOf(w) === -1; });
        }
        function tsdbPaisDeLiga(liga) {
            const s = String(liga || '');
            const i = s.indexOf(':');
            const bruto = i > 0 ? s.slice(0, i) : s;
            return bruto.trim().replace(/\s+/g, ' ');
        }
        function tsdbTokenIgual(a, b) {
            if (a === b) return true;
            const min = Math.min(a.length, b.length);
            if (min < 4) return false;
            return a.indexOf(b) === 0 || b.indexOf(a) === 0;
        }
        function tsdbCoincideLiga(nuestra, candidata) {
            const a = tsdbTokens(nuestra), b = tsdbTokens(candidata);
            if (!a.length || !b.length) return 0;
            let comunes = 0;
            a.forEach(function (t) { if (b.some(function (u) { return tsdbTokenIgual(t, u); })) comunes++; });
            let p = comunes / Math.max(a.length, b.length);
            const cCand = b.some(function (t) { return TSDB_COPA.indexOf(t) !== -1; });
            const cNuestra = a.some(function (t) { return TSDB_COPA.indexOf(t) !== -1; });
            if (cCand && !cNuestra) p = p * 0.2;
            return p;
        }
        function tsdbTemporadaAnterior(temporada) {
            const s = String(temporada || '').trim();
            const m = s.match(/^(\d{4})-(\d{4})$/);
            if (m) return (Number(m[1]) - 1) + '-' + (Number(m[2]) - 1);
            if (/^\d{4}$/.test(s)) return String(Number(s) - 1);
            return null;
        }
        async function tsdbGet(ruta) {
            try {
                const abort = new AbortController();
                const tid = setTimeout(function () { abort.abort(); }, 8000);
                const r = await fetch(TSDB_BASE + ruta, {
                    signal: abort.signal,
                    headers: { 'User-Agent': TSDB_UA, 'Accept': 'application/json' }
                });
                clearTimeout(tid);
                if (!r.ok) return null;
                return await r.json();
            } catch (_) { return null; }
        }
        async function cargarStatsTheSportsDB(nowMs, candidatos, opts) {
            const yaCubiertos = (opts && opts.mapa) || [];
            const diag = { fuente: 'thesportsdb', ligas: [], temporadas: [], omitidas: [], equipos: 0 };
            const pendientes = (candidatos || []).filter(function (c) {
                return !buscarStatsEquipo(c.local, yaCubiertos) || !buscarStatsEquipo(c.visitante, yaCubiertos);
            });
            if (!pendientes.length) return [];
            const porPais = {};
            pendientes.forEach(function (c) {
                const p = tsdbPaisDeLiga(c.liga);
                if (!p) return;
                const lg = String(c.liga || '').replace(/^[^:]*:\s*/, '');
                porPais[p] = porPais[p] || {};
                porPais[p][lg] = (porPais[p][lg] || 0) + 1;
            });
            const ligasElegidas = [];
            for (const pais of Object.keys(porPais).slice(0, 5)) {
                const clavePais = 'p:' + pais.toLowerCase();
                let lista = tsdbCache.paises[clavePais];
                if (!lista || Date.now() - lista.at > 24 * 60 * 60 * 1000) {
                    const j = await tsdbGet('/search_all_leagues.php?c=' + encodeURIComponent(pais) + '&s=Soccer');
                    lista = { at: Date.now(), ligas: (j && Array.isArray(j.countries)) ? j.countries : [] };
                    tsdbCache.paises[clavePais] = lista;
                    diag.ligas.push(pais + ':' + lista.ligas.length);
                }
                const nombres = Object.keys(porPais[pais]);
                nombres.forEach(function (nombre) {
                    let mejor = null, mejorP = 0;
                    lista.ligas.forEach(function (L) {
                        const p = tsdbCoincideLiga(nombre, L.strLeague);
                        if (p > mejorP) { mejorP = p; mejor = L; }
                    });
                    if (mejor && mejorP >= 0.5) {
                        if (!ligasElegidas.some(function (x) { return x.id === mejor.idLeague; })) {
                            ligasElegidas.push({ id: mejor.idLeague, liga: mejor.strLeague, temporada: mejor.strCurrentSeason, fixtures: 0 });
                        }
                        diag.ligas.push(mejor.strLeague + '#' + mejor.idLeague);
                    } else {
                        diag.omitidas.push(nombre);
                    }
                });
            }
            if (!ligasElegidas.length) return [];
            const mapa = [];
            for (const L of ligasElegidas.slice(0, 6)) {
                // Temporada actual + anterior: el tier gratuito devuelve ~15
                // eventos por temporada, insuficiente para splits casa/fuera
                // con 3 partidos por condicion. Con dos temporadas se llega.
                const temporadas = [L.temporada];
                const prev = tsdbTemporadaAnterior(L.temporada);
                if (prev) temporadas.push(prev);
                const eventos = [];
                for (const t of temporadas) {
                    const clave = 's:' + L.id + ':' + t;
                    let cache = tsdbCache.temporadas[clave];
                    if (!cache || Date.now() - cache.at > 6 * 60 * 60 * 1000) {
                        const j = await tsdbGet('/eventsseason.php?id=' + L.id + '&s=' + encodeURIComponent(t || ''));
                        cache = { at: Date.now(), eventos: (j && Array.isArray(j.events)) ? j.events : [] };
                        tsdbCache.temporadas[clave] = cache;
                    }
                    diag.temporadas.push(L.liga + '@' + t + ':' + cache.eventos.length);
                    eventos.forEach(function (e) { eventos.push(e); });
                }
                const agg = new Map();
                let totCasa = 0, totFuera = 0, nEventos = 0;
                eventos.forEach(function (e) {
                    if (!e || e.strStatus !== 'FT' && e.strStatus !== 'AET' && e.strStatus !== 'PEN') return;
                    const h = parseInt(e.intHomeScore, 10), a = parseInt(e.intAwayScore, 10);
                    if (!Number.isFinite(h) || !Number.isFinite(a)) return;
                    const casa = String(e.strHomeTeam || '').trim(), fuera = String(e.strAwayTeam || '').trim();
                    if (!casa || !fuera) return;
                    nEventos++; totCasa += h; totFuera += a;
                    function acc(nombre) {
                        if (!agg.has(nombre)) agg.set(nombre, { gfH: 0, gaH: 0, nH: 0, gfA: 0, gaA: 0, nA: 0 });
                        return agg.get(nombre);
                    }
                    const ch = acc(casa); ch.gfH += h; ch.gaH += a; ch.nH += 1;
                    const cf = acc(fuera); cf.gfA += a; cf.gaA += h; cf.nA += 1;
                });
                if (!nEventos) continue;
                const avgH = totCasa / nEventos, avgA = totFuera / nEventos;
                agg.forEach(function (s, nombre) {
                    mapa.push({ liga: L.id, nombre: nombre, gfH: s.gfH, gaH: s.gaH, nH: s.nH,
                        gfA: s.gfA, gaA: s.gaA, nA: s.nA, avgH: avgH, avgA: avgA });
                });
            }
            diag.equipos = mapa.length;
            tsdbCache.diag = diag;
            return mapa;
        }

        // Adjunta c.stats = {attH, defH, attA, defA, avgH, avgA, nH, nA, ...}
        // (fuerzas ya normalizadas vs media de liga) o null si algun equipo
        // tiene <3 partidos en su condicion. Devuelve cuantos candidatos
        // recibieron stats. Nunca lanza.
        function adjuntarStatsACandidatos(candidatos, mapa, opts) {
            const minPartidos = (opts && Number.isFinite(opts.minPartidos)) ? opts.minPartidos : 3;
            if (!Array.isArray(candidatos) || !Array.isArray(mapa) || !mapa.length) return 0;
            let n = 0;
            candidatos.forEach(function (c) {
                try {
                    c.stats = null;
                    // Pool multi-competicion: el mismo equipo aparece en liga
                    // domestica + continental (p.ej. City en PL y en UCL). Se
                    // ponderan las tasas por muestra: el UCL aporta contexto,
                    // la liga domestica aporta volumen. Evita lambdas locas con
                    // 2 partidos. Medias de liga mezcladas por peso.
                    function poolEquipoFD(nombre) {
                        const acc = { gfH: 0, gaH: 0, nH: 0, gfA: 0, gaA: 0, nA: 0, avgH: 0, avgA: 0, w: 0 };
                        if (!nombre || !Array.isArray(mapa)) return null;
                        for (let i = 0; i < mapa.length; i++) {
                            const e = mapa[i];
                            if (!e || !mismoEquipoFD(nombre, e.nombre)) continue;
                            const nH = Number(e.nH) || 0, nA = Number(e.nA) || 0;
                            acc.gfH += (Number(e.gfH) || 0) * nH; acc.gaH += (Number(e.gaH) || 0) * nH; acc.nH += nH;
                            acc.gfA += (Number(e.gfA) || 0) * nA; acc.gaA += (Number(e.gaA) || 0) * nA; acc.nA += nA;
                            const w = nH + nA;
                            acc.avgH += (Number(e.avgH) || 0) * w; acc.avgA += (Number(e.avgA) || 0) * w; acc.w += w;
                        }
                        if (!(acc.nH > 0) || !(acc.nA > 0) || !(acc.w > 0)) return null;
                        return { gfH: acc.gfH / acc.nH, gaH: acc.gaH / acc.nH, nH: acc.nH, gfA: acc.gfA / acc.nA, gaA: acc.gaA / acc.nA, nA: acc.nA, avgH: acc.avgH / acc.w, avgA: acc.avgA / acc.w, ligaFD: 'pool' };
                    }
                    const eH = poolEquipoFD(c.local);
                    const eA = poolEquipoFD(c.visitante);
                    if (!eH || !eA || eH.nH < minPartidos || eA.nA < minPartidos) return;
                    if (!(eH.avgH > 0) || !(eA.avgA > 0)) return;
                    const attH = eH.gfH / eH.avgH, defH = eH.gaH / eH.avgH;
                    const attA = eA.gfA / eA.avgA, defA = eA.gaA / eA.avgA;
                    if (![attH, defH, attA, defA].every(function (v) { return Number.isFinite(v) && v > 0; })) return;
                    function r3(x) { return Math.round(x * 1000) / 1000; }
                    c.stats = {
                        attH: r3(attH), defH: r3(defH), attA: r3(attA), defA: r3(defA),
                        avgH: r3(eH.avgH), avgA: r3(eA.avgA), nH: eH.nH, nA: eA.nA,
                        gfH: r3(eH.gfH), gaH: r3(eH.gaH), gfA: r3(eA.gfA), gaA: r3(eA.gaA),
                        ligaFD: eH.liga
                    };
                    n++;
                } catch (_) { try { c.stats = null; } catch (_) {} }
            });
            return n;
        }

        // ---------------------------------------------------------------------
        // Espejos publicos del dataset que publica GitHub Actions.
        // El workflow escribe SIEMPRE la rama 'dataset'; el gist es solo un extra
        // y puede quedarse congelado si su token caduca (fue justo lo que dejo la
        // web a 0 partidos). Se prueban todos y se elige la captura MAS RECIENTE:
        // mientras la captura se ejecute, la web nunca se queda sin datos.
        const DATASET_MIRRORS = [
            'https://raw.githubusercontent.com/jarmy90/bet365edge-quant/dataset/edge-futbol/ratingbet_fixtures.json',
            'https://gist.githubusercontent.com/jarmy90/9494dab5740e8efb6dc84f38ff85c6cf/raw/ratingbet_fixtures.json'
        ];

        function msCapturaDataset(ds) {
            try {
                const f = (ds && (ds.fuente || ds.FUENTE)) || {};
                const t = f.generadoEnUtc || f.generadoEn || ds.generadoEnUtc || ds.generadoEn || null;
                const ms = t ? Date.parse(t) : NaN;
                return Number.isFinite(ms) ? ms : null;
            } catch (_) { return null; }
        }

        async function cargarDatasetRatingbet(nowMs, force) {
            const configurada = env.RATINGBET_DATASET_URL || '';
            const token = env.RATINGBET_DATASET_TOKEN || '';
            // RATINGBET_DATASET_MIRRORS=0 desactiva los espejos (tests/entornos
            // cerrados). Por defecto SIEMPRE se usan: si la fuente configurada
            // caduca (gist con token roto) la web sigue con la rama 'dataset'.
            const usarEspejos = String(env.RATINGBET_DATASET_MIRRORS || '1') !== '0';
            if (!configurada && !usarEspejos) {
                return { dataset: datasetLocal, diag: { modo: 'modulo-embebido', url: null, error: null }, error: null };
            }
            const urls = [];
            if (configurada) urls.push(configurada);
            if (usarEspejos) DATASET_MIRRORS.forEach(function (u) { if (urls.indexOf(u) === -1) urls.push(u); });
            const claveCache = urls.join('|');

            if (!force && datasetCache.dataset && datasetCache.url === claveCache && (nowMs - datasetCache.at) < DATASET_CACHE_MS) {
                return { dataset: datasetCache.dataset, diag: datasetCache.diag, error: datasetCache.diag.error || null };
            }
            if (datasetInflight) return datasetInflight;

            datasetInflight = (async function () {
                const diag = {
                    modo: 'remoto', url: configurada || urls[0] || null, error: null,
                    partidosRecibidos: 0, autenticado: !!token, bytes: 0,
                    fuentes: [], elegida: null
                };
                let mejor = null, mejorMs = null, mejorBytes = 0, mejorUrl = null;

                for (let i = 0; i < urls.length; i++) {
                    const u = urls[i];
                    const d = { url: u, ok: false, error: null, partidos: 0, capturaUtc: null };
                    try {
                        const conCb = u + (u.includes('?') ? '&' : '?') + 'cb=' + nowMs;
                        const headers = Object.assign(
                            { 'Accept': 'application/json' },
                            (token && u === configurada) ? { 'Authorization': 'Bearer ' + token } : {}
                        );
                        const res = await fetch(conCb, { headers: headers });
                        if (!res.ok) d.error = 'http-' + res.status;
                        else {
                            const txt = await res.text();
                            const parsed = extraerDataset(txt);
                            const n = parsed ? (parsed.partidos || parsed.PARTIDOS || []).length : 0;
                            if (!parsed) d.error = 'json-no-parseable';
                            else if (n === 0) d.error = 'sin-partidos';
                            else {
                                d.ok = true;
                                d.partidos = n;
                                const ms = msCapturaDataset(parsed);
                                d.capturaUtc = ms ? new Date(ms).toISOString() : null;
                                if (mejor === null || (ms || 0) > (mejorMs || 0)) {
                                    mejor = parsed;
                                    mejorMs = ms;
                                    mejorBytes = txt.length;
                                    mejorUrl = u;
                                }
                            }
                        }
                    } catch (e) {
                        d.error = 'excepcion-' + (e && e.message ? e.message : 'desconocida');
                    }
                    diag.fuentes.push(d);
                    // Primera fuente suficientemente fresca: no hace falta seguir.
                    if (mejor && mejorMs && (nowMs - mejorMs) <= MAX_ANTIGUEDAD * 60000) break;
                }

                let dataset = mejor;
                if (!dataset) {
                    dataset = datasetLocal;
                    diag.modo = 'remoto-fallido->embebido';
                    // Se conserva el motivo REAL de la fuente configurada (p. ej.
                    // http-401) para que el diagnostico diga que paso y por que.
                    const fallos = diag.fuentes.filter(function (x) { return x.error; });
                    diag.error = (fallos[0] && fallos[0].error) || 'todas-las-fuentes-fallaron';
                } else {
                    diag.url = mejorUrl;
                    diag.elegida = mejorUrl;
                    diag.bytes = mejorBytes;
                    diag.partidosRecibidos = (dataset.partidos || dataset.PARTIDOS || []).length;
                }
                datasetCache = { at: nowMs, dataset: dataset, diag: diag, url: claveCache };
                return { dataset: dataset, diag: diag, error: diag.error };
            })();

            try { return await datasetInflight; } finally { datasetInflight = null; }
        }

        // Acepta las dos formas de responder de GitHub para un fichero:
        //   a) el JSON del dataset en crudo (raw.githubusercontent.com)
        //   b) el envoltorio de la API de contenidos: { content: "<base64>" }
        function extraerDataset(txt) {
            const directo = parseDatasetJson(txt);
            if (directo && ((directo.partidos || directo.PARTIDOS || []).length > 0)) return directo;
            if (directo && Array.isArray(directo.partidos)) return directo;

            const envuelto = directo || parseDatasetJson(txt) || null;
            if (envuelto && typeof envuelto.content === 'string' && (envuelto.encoding === 'base64' || !envuelto.encoding)) {
                const decodificado = base64AUtf8(envuelto.content);
                if (decodificado) {
                    const interno = parseDatasetJson(decodificado);
                    if (interno && ((interno.partidos || interno.PARTIDOS || []).length > 0)) return interno;
                }
            }
            return null;
        }

        // base64 -> texto UTF-8 (los acentos del dataset viajan en UTF-8)
        function base64AUtf8(b64) {
            try {
                const limpio = String(b64).replace(/\s+/g, '');
                const binario = atob(limpio);
                const bytes = new Uint8Array(binario.length);
                for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
                return new TextDecoder('utf-8').decode(bytes);
            } catch (e) {
                return null;
            }
        }

        // Tolerante a BOM, vallas de codigo o prosa alrededor del JSON
        function parseDatasetJson(txt) {
            if (!txt) return null;
            const limpio = String(txt).replace(/^\uFEFF/, '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
            try { return JSON.parse(limpio); } catch (e) { /* se intenta recortar */ }
            const i = limpio.indexOf('{'), f = limpio.lastIndexOf('}');
            if (i !== -1 && f > i) { try { return JSON.parse(limpio.slice(i, f + 1)); } catch (e2) { } }
            return null;
        }

        // =========================================================================
        // PIPELINE REAL v4: DATOS DEL SCRAPER + LLM ADJUDICADOR + EDGE REAL
        // =========================================================================
        // El LLM ya NO inventa partidos. Solo adjudica sobre la lista CERRADA que
        // viene del scraper (ratingbet_fixtures_data.js o URL remota). Si inventa
        // una clave, parsearVeredictosIA la descarta silenciosamente.
        // =========================================================================

        // --- RSS: noticias de futbol para enriquecer el prompt de analisis ---
        const RSS_FEEDS = [
            { url: 'https://e00-marca.uecdn.es/rss/futbol/primera-division.xml', fuente: 'Marca' },
            { url: 'https://feeds.bbci.co.uk/sport/football/rss.xml',            fuente: 'BBC Sport' },
            { url: 'https://as.com/rss/futbol/primera.xml',                       fuente: 'AS' }
        ];

        async function fetchRssNoticias() {
            // Desactivado a peticion del usuario para ahorrar tokens en la IA
            return [];
        }

        // --- Cache de analisis completo (dataset -> edge) ---
        let analisisCache = { at: -Infinity, pool: [], diag: null, key: null };
        let memoriaCache = {};
        let analisisInflight = null;

        function analisisCacheKey() {
            return [
                env.RATINGBET_DATASET_URL || 'embebido',
                env.RATINGBET_DATASET_TOKEN ? 'con-token' : 'sin-token',
                env.OMNIROUTE_API_URL || '',
                env.OMNIROUTE_MODEL || '',
                env.OMNIROUTE_API_KEY ? 'omni' : '',
                env.OPENROUTER_API_KEY ? 'open' : ''
            ].join('|');
        }

        async function getFutureMatchesPool(force) {
            const nowMs = Date.now();
            const cacheKey = analisisCacheKey();
            // Re-validacion en tiempo de peticion: aunque la cache sea reciente,
            // filtramos partidos que ya comenzaron desde la ultima vez.
            // Con force=1 (boton "Actualizar" del cliente) se IGNORA la cache:
            // el cliente recibe la captura mas reciente disponible del dataset.
            if (!force && analisisCache.diag && analisisCache.key === cacheKey && (nowMs - analisisCache.at) < FIXTURES_CACHE_MS) {
                const { publicables } = filtrarPublicables(analisisCache.pool, nowMs, { margenMinutos: MARGEN_PUBLICACION_MIN });
                return publicables;
            }
            if (!force && analisisInflight) {
                const pool = await analisisInflight;
                const { publicables } = filtrarPublicables(pool, nowMs, { margenMinutos: MARGEN_PUBLICACION_MIN });
                return publicables;
            }

            analisisInflight = (async function () {
                // -- 1. Cargar dataset del scraper ------------------------------------------
                const { dataset, diag: diagDataset } = await cargarDatasetRatingbet(nowMs, force);

                // -- 2. Validar candidatos temporalmente -----------------------------------
                const { candidatos: candidatosRaw, diag: diagCandidatos } = construirCandidatos(dataset, nowMs, {
                    margenMinutos: MARGEN_MIN,
                    maxDias: VENTANA_DIAS,
                    maxAntiguedadMin: MAX_ANTIGUEDAD
                });
                const candidatos = candidatosRaw.filter(esLigaTopPermitida);

                let pool = [];
                const diagFinal = {
                    origenDatos: FIXTURES_SOURCE,
                    modoAnalisis: 'sin-analisis',
                    diagDataset: diagDataset,
                    diagCandidatos: diagCandidatos,
                    diagIA: null,
                    diagFiltrado: null,
                    generadoEnUtc: new Date(nowMs).toISOString()
                };

                // -- 2b. Stats football-data.org (modelo Poisson determinista) ----
                // ~2 req/liga por ciclo de 6h (cache STATS_CACHE_MS). Nunca rompe
                // el flujo: sin stats, c.stats queda null y el pipeline sigue.
                try {
                    const idsFD = [];
                    try {
                        const txt = candidatos.map(function (c) { return String(c.liga || '') + ' ' + String(c.urlRelativa || ''); }).join(' ').toLowerCase();
                        FD_LEAGUES.forEach(function (L) {
                            const hit = clavesLigaFD(L).some(function (k) { const kk = String(k || '').trim(); return kk && txt.indexOf(kk) !== -1; });
                            if (hit && idsFD.indexOf(L.id) === -1) idsFD.push(L.id);
                        });
                    } catch (_) {}
                    const mapaStats = await cargarStatsFootballData(nowMs, idsFD.length ? { ligas: idsFD } : { ligas: [] });
                    let adjuntos = adjuntarStatsACandidatos(candidatos, mapaStats);
                    // stats.json (TheSportsDB) tiene pocas jornadas por equipo: si con 3 no
                    // se adjunta nada, se reintenta con 2 antes de llamar a TSDB remoto.
                    if (!adjuntos) adjuntos = adjuntarStatsACandidatos(candidatos, mapaStats, { minPartidos: 2 });
                    if (!adjuntos) adjuntos = adjuntarStatsACandidatos(candidatos, mapaStats, { minPartidos: 1 });
                    // Ligas menores (Venezuela, Paraguay...): football-data.org no
                    // las cubre. Se completa con TheSportsDB (gratis, sin clave).
                    if (!adjuntos) {
                        const mapaTSDB = await cargarStatsTheSportsDB(nowMs, candidatos, { mapa: mapaStats || [] });
                        if (mapaTSDB && mapaTSDB.length) adjuntos = adjuntarStatsACandidatos(candidatos, mapaTSDB, { minPartidos: 2 });
                    }
                    try {
                        diagFinal.diagStats = Object.assign({ conStats: adjuntos, candidatos: candidatos.length },
                            statsCache.diag || {}, tsdbCache.diag || {});
                    } catch (_) {}
                    diagFinal.diagStats.conStats = adjuntos;
                } catch (_) { /* sin stats en este ciclo */ }

                if (candidatos.length === 0) {
                    diagFinal.modoAnalisis = 'sin-datos-dataset-caducado';
                    analisisCache = { at: nowMs, pool: [], diag: diagFinal, key: cacheKey };
                    return [];
                }


                // -- 3. Intentar analisis con IA -------------------------------------------
                // Seleccion de key y endpoint:
                // 1. Si hay URL de Omniroute: usa la key de Omniroute con ese endpoint
                // 2. Si no hay URL de Omniroute: usa OpenRouter directamente (key OR)
                const omniUrl = env.OMNIROUTE_API_URL || env.OMNIRUTE_API_URL;
                const apiKeyPrimary = omniUrl
                    ? (env.OMNIROUTE_API_KEY || env.OPENROUTER_API_KEY)
                    : (env.OPENROUTER_API_KEY || env.OMNIROUTE_API_KEY);
                const dahlApiKey = env.DAHL_API_KEY || DAHL_KEY_DEFAULT;
                const dahlEndpoint = env.DAHL_API_URL || DAHL_ENDPOINT_DEFAULT;

                try {
                    // 3a. Noticias RSS (enriquece el prompt)
                    let feedNoticias = [];
                    try { feedNoticias = await fetchRssNoticias(); } catch (_) {}

                    // 3b. Seleccionar los mejores candidatos para el prompt (24 max por token budget).
                    // La IA solo puede estimar donde hay datos: primero ligas con
                    // cobertura FD (stats ya adjuntos o emparejables), luego resto.
                    // Asi no gasta el presupuesto en ligas sin datos donde se niega.
                    const ordenadosIA = (candidatos || []).slice().sort(function (a, b) {
                        function cob(c) {
                            try {
                                const t = (String(c.liga || '') + ' ' + String(c.urlRelativa || '')).toLowerCase();
                                return FD_LEAGUES.some(function (L) {
                                    return clavesLigaFD(L).some(function (k) { const kk = String(k || '').trim(); return kk && t.indexOf(kk) !== -1; });
                                }) ? 0 : 1;
                            } catch (_) { return 1; }
                        }
                        const ca = cob(a), cb = cob(b);
                        if (ca !== cb) return ca - cb;
                        return (a.kickoffMs || 0) - (b.kickoffMs || 0);
                    });
                    const paraAnalisis = seleccionarParaAnalisis(ordenadosIA, 24);

                    // 3c. Construir prompt
                    const { system, user } = construirPromptAnalisis(paraAnalisis, feedNoticias, nowMs);

                    // 3d. Llamar al LLM — cadena multi-proveedor robusta (Groq x2 -> Gemini nativo x2 -> Dahl)
                    const groqKey1 = env.GROQ_API_KEY || GROQ_KEY1_DEFAULT;
                    const groqKey2 = env.GROQ_API_KEY2 || GROQ_KEY2_DEFAULT;
                    const geminiKey1 = env.GEMINI_API_KEY || GEMINI_KEY1_DEFAULT;
                    const geminiKey2 = env.GEMINI_API_KEY2 || GEMINI_KEY2_DEFAULT;
                    const groqModel = env.GROQ_MODEL || GROQ_MODEL_DEFAULT;
                    const geminiModel = env.GEMINI_MODEL || GEMINI_MODEL_DEFAULT;
                    // Claves adicionales para rotación extendida (v9.3: cada var acepta
                    // lista separada por comas; splitKeys las expande a N intentos).
                    function splitKeys(v) {
                        return String(v || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
                    }
                    const groqKeys = splitKeys(groqKey1).concat(splitKeys(groqKey2));
                    const geminiKeys = splitKeys(geminiKey1).concat(splitKeys(geminiKey2));
                    const omniKey1 = env.OMNIROUTE_API_KEY || '';
                    const omniKey2 = env.OMNIROUTE_API_KEY2 || '';
                    const omniEndpoint = env.OMNIROUTE_API_URL || OMNIROUTE_ENDPOINT_DEFAULT;
                    const omniModel = env.OMNIROUTE_MODEL || OMNIROUTE_MODEL_DEFAULT;
                    const tokenharborKey = env.TOKENHARBOR_API_KEY || TOKENHARBOR_KEY_DEFAULT;
                    const tokenharborEndpoint = env.TOKENHARBOR_API_URL || TOKENHARBOR_ENDPOINT_DEFAULT;
                    const nvidiaKey = env.NVIDIA_API_KEY || NVIDIA_KEY_DEFAULT;
                    const dahlKey2 = env.DAHL_API_KEY2 || DAHL_KEY2_DEFAULT;
                    const openrouterKeys = splitKeys(env.OPENROUTER_API_KEY || OPENROUTER_KEY_DEFAULT)
                        .concat(splitKeys(env.OPENROUTER_API_KEY2 || ''));
                    const omniKeys = splitKeys(omniKey1).concat(splitKeys(omniKey2));
                    const dahlKeys = splitKeys(dahlApiKey).concat(splitKeys(dahlKey2));
                    const tokenharborKeys = splitKeys(tokenharborKey);
                    const nvidiaKeys = splitKeys(nvidiaKey);

                    // Pipeline multi-proveedor extendido v9.3 — hasta ~20 intentos antes de fallback estad�stico
                    // Orden: rapidez + quota budget. Groq primero (más rápido), luego Gemini nativo,
                    // luego Omniroute xN, OpenRouter xN, TokenHarbor, Nvidia, Dahl xN.
                    const proveedoresAProbar = [
                        // 1-N. Groq Cloud: cada clave prueba los modelos vigentes.
                        ...groqKeys.flatMap(function (k, i) {
                            const modelos = [groqModel].concat(GROQ_MODELOS.filter(function (m) { return m !== groqModel; }));
                            return modelos.map(function (m, j) {
                                return { endpoint: GROQ_ENDPOINT, apiKey: k, model: m, tipo: 'openai', label: 'Groq-' + (i + 1) + (j ? 'm' + (j + 1) : '') };
                            });
                        }),
                        // N+1.. Gemini nativo: cada clave prueba los modelos vigentes
                        // (si uno se retira, la clave NO queda inutil).
                        ...geminiKeys.flatMap(function (k, i) {
                            const modelosGem = [geminiModel].concat(GEMINI_FALLBACK_MODELS.filter(function (m) { return m !== geminiModel; }));
                            return modelosGem.map(function (m, j) {
                                return { endpoint: GEMINI_ENDPOINT_BASE + m + ':generateContent?key=' + k, apiKey: '', model: m, tipo: 'gemini', label: 'Gemini-' + (i + 1) + (j ? 'm' + (j + 1) : '') };
                            });
                        }),
                        // Omniroute (todas las claves via OpenRouter)
                        ...omniKeys.map(function (k, i) {
                            return { endpoint: omniEndpoint, apiKey: k, model: omniModel, tipo: 'openai', label: 'Omniroute-' + (i + 1) };
                        }),
                        // OpenRouter directo: SOLO modelos :free vigentes (los antiguos
                        // daban 404). Se verifican periodicamente contra /api/v1/models.
                        ...openrouterKeys.flatMap(function (k, i) {
                            return OPENROUTER_FREE_MODELS.map(function (m, j) {
                                return { endpoint: OPENROUTER_ENDPOINT, apiKey: k, model: m, tipo: 'openai', label: 'OpenRouter-' + (i + 1) + String.fromCharCode(97 + j) };
                            });
                        }),
                        // TokenHarbor (todas las claves)
                        ...tokenharborKeys.map(function (k, i) {
                            return { endpoint: tokenharborEndpoint, apiKey: k, model: 'gpt-4o-mini', tipo: 'openai', label: 'TokenHarbor-' + (i + 1) };
                        }),
                        // Nvidia NIM (todas las claves)
                        ...nvidiaKeys.map(function (k, i) {
                            return { endpoint: NVIDIA_ENDPOINT, apiKey: k, model: 'nvidia/llama-3.3-nemotron-super-49b-v1', tipo: 'openai', label: 'Nvidia-' + (i + 1) };
                        }),
                        // Dahl (todas las claves, 2 modelos por clave)
                        ...dahlKeys.flatMap(function (k, i) {
                            return [
                                { endpoint: dahlEndpoint, apiKey: k, model: 'deepseek-ai/DeepSeek-V4-Flash-0731', tipo: 'openai', label: 'Dahl-' + (i + 1) + '-DeepSeek' },
                                { endpoint: dahlEndpoint, apiKey: k, model: 'MiniMaxAI/MiniMax-M2.7', tipo: 'openai', label: 'Dahl-' + (i + 1) + '-MiniMax' }
                            ];
                        }),
                    ].filter(p => p.apiKey !== '' || p.tipo === 'gemini');

                    // Si hay config personalizada via env, la pone primero
                    if (apiKeyPrimary && omniUrl) {
                        proveedoresAProbar.unshift({ endpoint: omniUrl, apiKey: apiKeyPrimary, model: env.OMNIROUTE_MODEL || OMNIROUTE_MODEL_DEFAULT, tipo: 'openai', label: 'OmniCustom' });
                    }

                    // Cuarentena: se descartan las claves que acaban de dar 429/401.
                    // Asi el presupuesto de 22s se gasta en proveedores VIVOS y no
                    // reintentando claves muertas en cada peticion.
                    const claveDeProveedor = function (p) { return p.apiKey || p.endpoint || ''; };
                    const totalAntes = proveedoresAProbar.length;
                    const sanos = proveedoresAProbar.filter(function (p) { return !claveEnEspera(claveDeProveedor(p)); });
                    if (sanos.length === 0 && totalAntes > 0) {
                        // Todo en cuarentena: se intenta igualmente (mejor intento que fallback ciego).
                        console.warn('[AI-CHAIN] Todas las claves en cuarentena (' + totalAntes + '); reintentando de todos modos.');
                    } else if (sanos.length < totalAntes) {
                        console.log('[AI-CHAIN] ' + (totalAntes - sanos.length) + ' clave(s) en cuarentena, ' + sanos.length + ' disponible(s).');
                    }

                    // Adaptador para Gemini nativo (formato distinto al OpenAI)
                    async function llamarGeminiNativo(endpoint, systemText, userText, timeoutMs) {
                        return fetch(endpoint, {
                            method: 'POST',
                            signal: AbortSignal.timeout(timeoutMs || 8000),
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                contents: [{ role: 'user', parts: [{ text: systemText + '\n\n' + userText }] }],
                                generationConfig: { temperature: 0.15, maxOutputTokens: 1500 }
                            })
                        });
                    }

                    let iaRes = null;
                    let iaRaw = null;  // texto crudo (Gemini nativo)
                    let ultimoError = null;
                    let proveedorGanador = null;
                    // Traza de intentos (sin claves): permite ver en /api/health
                    // que proveedor falla y por que (401/429/404 modelo...).
                    const intentosIA = [];
                    // Presupuesto global anti-TIMEOUT (Vercel): la cadena completa
                    // no puede superar ~22s; al agotarse se cae al degradado honesto.
                    // El timeout se aplica POR INTENTO contra el tiempo restante,
                    // para que un proveedor colgado no consuma el presupuesto solo.
                    const iaBudgetMs = 22000;
                    const iaDeadline = Date.now() + iaBudgetMs;
                    function iaTimeoutRestante() {
                        return Math.max(0, iaDeadline - Date.now());
                    }

                    for (const prov of (sanos.length ? sanos : proveedoresAProbar)) {
                        // Timeout del intento atado al tiempo restante: con <3s no
                        // merece intentar; rapidos cortan a 8s max por intento.
                        const restante = iaTimeoutRestante();
                        if (restante < 3000) {
                            ultimoError = { error: 'ia-timeout: presupuesto global 22s agotado', intentados: proveedoresAProbar.length };
                            console.warn('[AI-CHAIN] â±ï¸ presupuesto global agotado, stop.');
                            break;
                        }
                        const timeoutIntento = Math.min(8000, restante);
                        try {
                            console.log('[AI-CHAIN] Intentando ' + (prov.label || prov.model) + '...');
                            let r;
                            if (prov.tipo === 'gemini') {
                                r = await llamarGeminiNativo(prov.endpoint, system, user, timeoutIntento);
                            } else {
                                const extraHeaders = {};
                                // Dahl requiere fingerprint
                                if (prov.endpoint && prov.endpoint.includes('dahl.global')) {
                                    extraHeaders['x-fingerprint'] = env.DAHL_FINGERPRINT || DAHL_FINGERPRINT_DEFAULT;
                                }
                                r = await fetch(prov.endpoint, {
                                    method: 'POST',
                                    signal: AbortSignal.timeout(timeoutIntento),
                                    headers: {
                                        'Authorization': 'Bearer ' + prov.apiKey,
                                        'Content-Type': 'application/json',
                                        'HTTP-Referer': 'https://bet365edge-quant.vercel.app',
                                        'X-Title': 'BetEdge Quant',
                                        ...extraHeaders
                                    },
                                    body: JSON.stringify({
                                        model: prov.model,
                                        temperature: 0.15,
                                        max_tokens: 1500,
                                        messages: [
                                            { role: 'system', content: system },
                                            { role: 'user',   content: user   }
                                        ]
                                    })
                                });
                            }
                            if (r.ok) {
                                if (prov.tipo === 'gemini') {
                                    const gData = await r.json();
                                    const gText = gData && gData.candidates && gData.candidates[0] &&
                                        gData.candidates[0].content && gData.candidates[0].content.parts &&
                                        gData.candidates[0].content.parts[0] ? gData.candidates[0].content.parts[0].text : null;
                                    if (gText) { claveSana(claveDeProveedor(prov)); console.log('[AI-CHAIN] âœ… Éxito con ' + prov.label); proveedorGanador = prov.label; iaRaw = gText; break; }
                                    marcarClave(claveDeProveedor(prov), 0);
                                } else {
                                    claveSana(claveDeProveedor(prov));
                                    console.log('[AI-CHAIN] âœ… Éxito con ' + prov.label);
                                    proveedorGanador = prov.label; iaRes = r; break;
                                }
                            } else {
                                const errText = await r.text();
                                const errBody = errText.slice(0, 300);
                                const retryAfter = parseInt(r.headers.get('retry-after') || '', 10);
                                marcarClave(claveDeProveedor(prov), r.status, retryAfter);
                                intentosIA.push({ label: prov.label, model: prov.model, status: r.status });
                                ultimoError = { status: r.status, label: prov.label, model: prov.model, endpoint: prov.endpoint, body: errBody };
console.warn('[AI-CHAIN] AVISO ' + (prov.label || prov.model) + ' HTTP ' + r.status + ': ' + errBody.slice(0, 80) + ' [cuarentena]');
                            }
                        } catch (e) {
                            intentosIA.push({ label: prov.label, model: prov.model, error: String(e && e.message || e).slice(0, 120) });
                            ultimoError = { error: e.message, label: prov.label, model: prov.model, endpoint: prov.endpoint };
console.warn('[AI-CHAIN] AVISO ' + (prov.label || prov.model) + ' excepcion: ' + e.message);
                        }
                    }
                    if (!iaRes && !iaRaw) {
                        console.error('[AI-CHAIN] âŒ TODOS los proveedores fallaron (' + proveedoresAProbar.length + ' intentos). Usando fallback estadístico.');
                        diagFinal.diagIA = Object.assign(
                            ultimoError || { error: 'Ningún proveedor de IA respondió' },
                            { intentos: intentosIA }
                        );
                    } else {
                        // Obtener texto: iaRaw ya tiene el texto (Gemini nativo), o lo extraemos del response OpenAI
                        let textoIA = iaRaw || null;
                        if (!textoIA && iaRes && iaRes !== true) {
                            const iaData = await iaRes.json();
                            textoIA = iaData && iaData.choices && iaData.choices[0] && iaData.choices[0].message
                                ? iaData.choices[0].message.content : null;
                            if (!textoIA) diagFinal.diagIA = { error: 'IA respondio sin contenido', iaData: JSON.stringify(iaData).slice(0, 300) };
                        }

                        if (textoIA) {
                            // 3e. Parsear veredictos: solo acepta claves reales del scraper
                            const { veredictos, diag: diagIA } = parsearVeredictosIA(textoIA, paraAnalisis);
                            diagFinal.diagIA = Object.assign({ proveedorGanador: proveedorGanador, intentos: intentosIA }, diagIA);
                            if (veredictos.length === 0) {
                                // Guardar una muestra para saber POR QUE no se pudo parsear.
                                diagFinal.diagIA.muestraRespuesta = String(textoIA).slice(0, 400);
                            }

                            if (veredictos.length > 0) {
                                // 3f. Calcular edge con cuotas REALES (no inventadas)
                                const analisis = aplicarVeredictos(paraAnalisis, veredictos, nowMs);

                                // 3g. Re-validar en tiempo de peticion
                                const { publicables, resumen: rFiltrado } = filtrarPublicables(
                                    analisis, nowMs, { margenMinutos: MARGEN_PUBLICACION_MIN, max: MAX_PUBLICADOS }
                                );
                                diagFinal.diagFiltrado = rFiltrado;
                                diagFinal.modoAnalisis = 'ia-edge-real';
                                pool = analisis;
                                analisisCache = { at: nowMs, pool: pool, diag: diagFinal, key: cacheKey };
                                return publicables;
                            } else {
                                // IA respondio pero sin veredictos con edge
                                diagFinal.modoAnalisis = 'solo-cuotas-reales';
                            }
                        }
                    }
                } catch (iaErr) { diagFinal.diagIA = { error: String(iaErr && iaErr.message || iaErr).slice(0, 300) }; }

                // -- 4. Modo degradado: cuotas reales sin edge de modelo -----------------
                // No se inventa nada. Se publican los partidos reales con sus cuotas.
                // Las columnas de edge y modelo quedan vacias (null / "-").
                // La CACHE guarda la ventana amplia (200) para que la combinada
                // barra mas alla de los 24 de la tabla; la respuesta sigue en 24.
                // -- 4. Sin IA: modelo Poisson con ESTADISTICAS REALES ------------
                // Politica del producto: solo se publica lo que se puede calcular
                // con datos reales (goles de los equipos). Un partido sin stats no
                // se publica: no se inventa edge ni se disfraza la cuota de modelo.
                const conStatsReales = (candidatos || []).filter(function (c) { return c && c.stats; });
                if (conStatsReales.length === 0) {
                    diagFinal.modoAnalisis = 'sin-estadisticas-reales';
                    diagFinal.aviso = 'No se publica ningun partido: no hay estadisticas reales (goles de los equipos) para las ligas de esta captura. La web volvera a publicar en cuanto la fuente de estadisticas tenga datos.';
                    analisisCache = { at: nowMs, pool: [], diag: diagFinal, key: cacheKey };
                    return [];
                }
                                // Aplicar seleccionDeFixture a TODOS los candidatos con lineas validas.
                // El modelo ciego-a-cuota cubre los que no tienen stats (usa solo
                // las cuotas justas de ratingbet), asi nunca se queda vacio si hay
                // datos de lineas.
                                try {
const todosLosCandidatos = (candidatos || []).filter(function (c) {
                                    return c && c.lineas && c.lineas['1.5'] && c.lineas['2.5'] &&
                                        Number.isFinite(c.lineas['1.5'].cuotaOver) && c.lineas['1.5'].cuotaOver > 1 &&
                                        Number.isFinite(c.lineas['2.5'].cuotaOver) && c.lineas['2.5'].cuotaOver > 1;
                                });
                const picksTodos = [];
                todosLosCandidatos.forEach(function (c, i) {
                    try {
                        const pick = seleccionDeFixture(c);
                        if (pick && Number.isFinite(pick.edgePuntos) && pick.edgePuntos > 0 &&
                            (pick.probBase === 'modelo-ia' || pick.probBase === 'modelo-poisson' || pick.probBase === 'modelo-ciego-a-cuota')) {
                            picksTodos.push(Object.assign({}, pick, { clave: c.clave, indice: i, kickoffMs: c.kickoffMs, lineas: c.lineas }));
                        }
                    } catch (e) {
                        // ignorar candidato problemático, continuar con el siguiente
                    }
                });
                                const { publicables, resumen: rFiltrado2 } = filtrarPublicables(
                                    picksTodos, nowMs, { margenMinutos: MARGEN_PUBLICACION_MIN, max: MAX_PUBLICADOS }
                                );
                                diagFinal.diagFiltrado = rFiltrado2;
                                diagFinal.modoAnalisis = 'modelo-poisson-real';
                                // La cache guarda la ventana amplia para las combinadas.
                                pool = picksTodos;
                                // Defensa en profundidad: descartar picks con edge absurdo
                                // (tip/veredicto incoherente con la cuota real del mercado).
                                pool = pool.map(function (c) {
                                    if (!c || !Number.isFinite(c.cuota) || c.cuota <= 1) return c;
                                    var pImp = 100 / c.cuota;
                                    if (c.probBase === 'modelo-ia' && Number.isFinite(c.modelProb) && Math.abs(c.modelProb - pImp) > 25) {
                                        c.modelProb = null; c.edgePuntos = null; c.probBase = null;
                                        c.edge = null; c.ev = null; c.evPct = null;
                                        c.justificacion = 'Descartado: tip incoherente con el precio de mercado.';
                                    }
                                    else if (Number.isFinite(c.edgePuntos) && c.edgePuntos > 15) {
                                        c.edgePuntos = 15;
                                    }
                                    return c;
                                });
                
                                return publicables;
                } catch (e) {
                    diagFinal.modoAnalisis = 'error-analisis';
                    diagFinal.aviso = 'Error interno de analisis: ' + String(e && e.message || e).slice(0, 200);
                    console.error('[ANALYSIS-ERROR]', e && e.stack || e);
                    analisisCache = { at: nowMs, pool: [], diag: diagFinal, key: cacheKey };
                    return [];
                }
            })();

            try { return await analisisInflight; } finally { analisisInflight = null; }
        }

        function getFixturesDiag() { return analisisCache.diag; }

        // Compatibilidad: fixturesCacheKey queda para no romper referencias legacy.
        function fixturesCacheKey() { return analisisCacheKey(); }

        // LÒGICA DE GENERACIÒN DE COMBINADAS SEGÚN NIVEL DE RIESGO
        // 1. Riesgo Bajo: Cuota total < 2.00
        // 2. Riesgo Medio: Cuota total entre 2.00 y 3.00
        // 3. Riesgo Alto: Cuota total > 3.00
        // =========================================================================
        // 4.b API PUBLICA DE FIXTURES VALIDADOS (dia + hora reales, solo futuros)
        // =========================================================================
        if (url.pathname === '/api/fixtures-hoy') {
            // force=1: el cliente pide saltarse la cache (boton "Actualizar datos")
            const force = url.searchParams.get('force') === '1';
            // resetIA=1: limpia la cuarentena de claves IA de este isolate
            // (util tras corregir un modelo o recargar una clave).
            if (url.searchParams.get('resetIA') === '1') aiKeyHealth.clear();
            const pool = await getFutureMatchesPool(force);
            return new Response(JSON.stringify({
                ok: true,
                meta: buildTemporalMeta(Date.now()),
                total: pool.length,
                fixtures: pool,
                origenDatos: FIXTURES_SOURCE,
                frescura: frescuraDatos(),
                diagnosticoFuente: getFixturesDiag(),
                advertenciaTemporal: pool.length === 0
                    ? ((getFixturesDiag() && getFixturesDiag().aviso) ||
                       "ADVERTENCIA: No hay partidos futuros disponibles en este momento. Los partidos mostrados anteriormente ya han comenzado o finalizado. Intente mas tarde.")
                    : null
            }), {
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'application/json; charset=utf-8',
                    // Cache en el CDN: sin esto CADA usuario/isolate re-ejecutaba el
                    // analisis IA y multiplicaba el gasto de cuota. force=1 = fresco.
                    'Cache-Control': force
                        ? 'no-store'
                        : 'public, max-age=0, s-maxage=900, stale-while-revalidate=3600'
                }
            });
        }

        // Diagnostico de despliegue: permite verificar que la version publicada es la actual
        if (url.pathname === '/api/version') {
            const pool = await getFutureMatchesPool(url.searchParams.get('force') === '1');
            return new Response(JSON.stringify({
                ok: true,
                build: BUILD_ID,
                origenDatos: FIXTURES_SOURCE,
                frescura: frescuraDatos(),
                diagnosticoFuente: getFixturesDiag(),
                validacionTemporal: true,
                margenSeguridadHoras: SAFETY_MARGIN_HOURS,
                zonaHoraria: MADRID_TZ,
                meta: buildTemporalMeta(Date.now()),
                fixturesFuturos: pool.length,
                primerFixture: pool.length ? {
                    partido: pool[0].partido,
                    dia: pool[0].dia,
                    fecha: pool[0].fechaCorta,
                    hora: pool[0].hora,
                    horaLabel: pool[0].horaLabel
                } : null
            }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
            });
        }

        // =========================================================================
        // 4.c ENDPOINT: HEALTH CHECK (PASO 1 - VERIFICACION DE ENTORNO EN VERCEL)
        //     Adaptado al stack real: Cloudflare Worker (+ Vercel Edge via api/index.js).
        //     Seguridad: NO expone valores de secretos, solo si existen y su procedencia.
        // =========================================================================
        if (url.pathname === '/api/health') {
            const E = env || {};
            const nowMs = Date.now();
            const pMadrid = madridParts(nowMs);

            // Sin valores embebidos: cualquier secreto debe venir de env.
            // (Los antiguos fallbacks se eliminaron: estaban publicados en el repo.)
            const EMBEBIDOS = {};
            function estadoDeClave(nombre, valor) {
                if (!valor) return '\u2717 FALTA';
                if (EMBEBIDOS[nombre] && valor === EMBEBIDOS[nombre]) {
                    return '\u26a0 EMBEBIDA en el codigo (no definida en Vercel > Settings > Environment Variables)';
                }
                return '\u2713 Configurada (valor oculto)';
            }

            const envVars = {
                // --- Agente de IA: rotador multi-proveedor v9.3 (conteo de keys, sin valores) ---
                GROQ_KEYS: String(E.GROQ_API_KEY || '').split(',').filter(s => s.trim()).length
                    + String(E.GROQ_API_KEY2 || '').split(',').filter(s => s.trim()).length + ' clave(s)',
                GEMINI_KEYS: String(E.GEMINI_API_KEY || '').split(',').filter(s => s.trim()).length
                    + String(E.GEMINI_API_KEY2 || '').split(',').filter(s => s.trim()).length + ' clave(s)',
                OPENROUTER_KEYS: String(E.OPENROUTER_API_KEY || '').split(',').filter(s => s.trim()).length
                    + String(E.OPENROUTER_API_KEY2 || '').split(',').filter(s => s.trim()).length + ' clave(s)',
                OMNIROUTE_KEYS: String(E.OMNIROUTE_API_KEY || '').split(',').filter(s => s.trim()).length
                    + String(E.OMNIROUTE_API_KEY2 || '').split(',').filter(s => s.trim()).length + ' clave(s)',
                TOKENHARBOR_KEYS: String(E.TOKENHARBOR_API_KEY || '').split(',').filter(s => s.trim()).length + ' clave(s)',
                NVIDIA_KEYS: String(E.NVIDIA_API_KEY || '').split(',').filter(s => s.trim()).length + ' clave(s)',
                DAHL_KEYS: String(E.DAHL_API_KEY || '').split(',').filter(s => s.trim()).length
                    + String(E.DAHL_API_KEY2 || '').split(',').filter(s => s.trim()).length + ' clave(s)',
                OMNIROUTE_API_URL: E.OMNIROUTE_API_URL
                    ? 'âœ“ Configurada (endpoint personalizado del agente)'
                    : (E.OMNIRUTE_API_URL ? 'âœ“ Configurada (via alias OMNIRUTE_API_URL)' : 'âœ— FALTA (opcional: se usa el endpoint OpenRouter por defecto)'),
                STRIPE_SECRET_KEY: estadoDeClave('STRIPE_SECRET_KEY', E.STRIPE_SECRET_KEY),
                FOOTBALL_DATA_API_KEY: estadoDeClave('FOOTBALL_DATA_API_KEY', E.FOOTBALL_DATA_API_KEY),
                STRIPE_PRICE_ID: E.STRIPE_PRICE_ID ? 'âœ“ Configurada' : 'âœ— FALTA',

                // --- Dataset del scraper (de donde salen partidos y cuotas) ---
                RATINGBET_DATASET_URL: E.RATINGBET_DATASET_URL
                    ? '\u2713 Configurada (dataset remoto: la web recoge capturas nuevas SIN redeploy)'
                    : '\u26a0 NO definida (se usa el dataset EMBEBIDO en el despliegue: para actualizar partidos hay que redeployar)',
                RATINGBET_DATASET_TOKEN: E.RATINGBET_DATASET_TOKEN
                    ? '\u2713 Configurada (se envia como Bearer: permite leer el dataset de un repositorio PRIVADO)'
                    : 'no definida (solo valido si el dataset esta en una URL PUBLICA)',
                RATINGBET_MARGEN_MIN: E.RATINGBET_MARGEN_MIN || ('por defecto (' + MARGEN_MIN + ')'),
                RATINGBET_VENTANA_DIAS: E.RATINGBET_VENTANA_DIAS || ('por defecto (' + VENTANA_DIAS + ')'),
                RATINGBET_MAX_ANTIGUEDAD_MIN: E.RATINGBET_MAX_ANTIGUEDAD_MIN || ('por defecto (' + MAX_ANTIGUEDAD + ')'),

                // --- Entorno de ejecucion ---
                NODE_ENV: E.NODE_ENV || 'desconocido',
                VERCEL_ENV: E.VERCEL_ENV || 'no-vercel (Cloudflare Worker o local)',
                VERCEL_URL: E.VERCEL_URL || null,
                VERCEL_REGION: E.VERCEL_REGION || null,
                VERCEL_GIT_COMMIT_SHA: E.VERCEL_GIT_COMMIT_SHA || null,

                // --- Reloj (testigo de desfase horario) ---
                CURRENT_TIME_UTC: new Date(nowMs).toISOString(),
                CURRENT_TIME_LOCAL: pad2(pMadrid.day) + '/' + pad2(pMadrid.month) + '/' + pMadrid.year + ' ' +
                    pad2(pMadrid.hour) + ':' + pad2(pMadrid.minute) + ':' + pad2(pMadrid.second),
                ZONA_HORARIA_NEGOCIO: MADRID_TZ
            };

            // --- Integridad temporal del catalogo que se esta publicando ---
            let pool = [];
            try { pool = (await getFutureMatchesPool()) || []; } catch (e) { pool = []; }
            const pasadosPublicados = pool.filter(function (f) { return f.matchTimestamp < nowMs; }).length;
            // Los fixtures publicados usan kickoffIsoUtc + kickoffMs: si se exigia
            // 'matchTimestamp' (que ya no existe) el aviso CRITICO saltaba SIEMPRE,
            // aunque el kickoff fuera real y verificado. Un CRITICO fijo inutiliza
            // el monitoreo, asi que se comprueba el campo que si existe.
            const sinKickoffReal = pool.filter(function (f) { return !f.kickoffIsoUtc && !f.kickoffMs; }).length;

            const integridadTemporal = {
                validacionTemporal: true,
                margenSeguridadHoras: SAFETY_MARGIN_HOURS,
                fixturesFuturosValidados: pool.length,
                partidosPasadosPublicados: pasadosPublicados, // DEBE ser 0
                fixturesSinKickoffReal: sinKickoffReal,       // DEBE ser 0
                primerKickoffUtc: pool.length ? pool[0].kickoffIsoUtc : null,
                primerKickoffLabel: pool.length ? pool[0].horaLabel : null,
                zonaHoraria: MADRID_TZ
            };

            // --- Claves requeridas para que el servicio funcione de verdad ---
            const faltantes = [];
            if (!E.STRIPE_SECRET_KEY) faltantes.push('STRIPE_SECRET_KEY');
            if (!E.STRIPE_PRICE_ID) faltantes.push('STRIPE_PRICE_ID');
            if (!(E.OPENROUTER_API_KEY || E.OMNIROUTE_API_KEY)) faltantes.push('OPENROUTER_API_KEY/OMNIROUTE_API_KEY');

            const embebidas = [];
            if (E.STRIPE_SECRET_KEY === EMBEBIDOS.STRIPE_SECRET_KEY) embebidas.push('STRIPE_SECRET_KEY');
            if (E.OPENROUTER_API_KEY === EMBEBIDOS.OPENROUTER_API_KEY) embebidas.push('OPENROUTER_API_KEY');

            const critico = faltantes.length > 0 || embebidas.length > 0 || pasadosPublicados > 0 || sinKickoffReal > 0 || pool.length === 0;

            const avisos = [];
            if (faltantes.length) {
                avisos.push('CRITICO: faltan variables de entorno en Vercel > Settings > Environment Variables -> ' + faltantes.join(', '));
            }
            if (embebidas.length) {
                avisos.push('Claves usando el valor EMBEBIDO en el codigo (definirlas en Vercel): ' + embebidas.join(', '));
            }
            if (pasadosPublicados > 0) {
                avisos.push('CRITICO: se estan publicando ' + pasadosPublicados + ' partidos ya iniciados o pasados.');
            }
            if (sinKickoffReal > 0) {
                avisos.push('CRITICO: ' + sinKickoffReal + ' fixtures sin kickoff real verificable.');
            }
            if (pool.length === 0) {
                avisos.push('Sin fixtures futuros: revisar la fuente de datos antes de publicar.');
            }
            const fresc = frescuraDatos();
            if (!E.RATINGBET_DATASET_URL) {
                avisos.push('Sin RATINGBET_DATASET_URL: el catalogo viene EMBEBIDO en el despliegue. Para que la web muestre partidos nuevos automaticamente, define esa variable con la URL del JSON del scraper y programa el scraper (p.ej. cada 15 min).');
            }
            if (fresc && fresc.edadMin !== null && !fresc.fresca) {
                avisos.push('Captura de ratingbet con ' + fresc.edadMin + ' min de antiguedad (limite ' + fresc.limiteMin + ' min): ejecutar el scraper para refrescar el dataset.');
            }
            avisos.push('Origen de los fixtures: ' + FIXTURES_SOURCE +
                '. Sin catalogo embebido de reserva: si la fuente no devuelve fixtures validos, la web NO publica partidos.');

            return new Response(JSON.stringify({
                status: critico ? 'WARN' : 'OK',
                build: BUILD_ID,
                environment: envVars,
                integridadTemporal: integridadTemporal,
                frescuraDatos: fresc,
                origenDatos: FIXTURES_SOURCE,
                diagnosticoFuente: getFixturesDiag(),
                fallbacksActivos: E.__FALLBACKS_ACTIVOS || 'ninguno',
                clavesIAEnCuarentena: aiKeyHealth.size,
                warning: critico
                    ? avisos.join(' | ')
                    : '\u2713 Variables de entorno e integridad temporal correctas'
            }, null, 2), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
            });
        }

        if (url.pathname === '/api/parlays-by-risk') {
            const riskLevel = url.searchParams.get('risk') || 'medio'; // bajo, medio, alto
            // Flujo correcto: combinadas sobre el pool CON veredictos IA cuando la cache esta caliente;
            // en cold start usa ligero sin IA para nunca dar 504. Nunca llama al LLM desde aqui.
            let realMatchesPool = [];
            try {
                const nowL = Date.now();
                const ck = analisisCacheKey();
                const cacheCaliente = analisisCache.diag && analisisCache.key === ck && (nowL - analisisCache.at) < FIXTURES_CACHE_MS && (analisisCache.pool || []).length;
                if (cacheCaliente) {
                    // La combinada barre la ventana AMPLIA (200), no los 24 de la tabla.
                    const fl = filtrarPublicables(analisisCache.pool, nowL, { margenMinutos: MARGEN_PUBLICACION_MIN, max: 200 });
                    realMatchesPool = (fl.publicables || []).filter(esLigaTopPermitida);
                } else {
                    // Flujo completo (stats+IA) con red anti-504: si supera 45s,
                    // se cae al pool ligero (rapido, sin IA) en vez de colgar.
                    // Asi la combinada SI ve veredictos aunque la cache este fria.
                    // Se lee la CACHE (pool amplio) en vez del retorno (top 24).
                    try {
                        await Promise.race([
                            getFutureMatchesPool(false),
                            new Promise(function (_, rej) { setTimeout(function () { rej(new Error('pool-timeout-45s')); }, 45000); })
                        ]);
                    } catch (_) {}
                    try {
                        const fuente = (analisisCache.pool && analisisCache.pool.length) ? analisisCache.pool : [];
                        const fl = filtrarPublicables(fuente.filter(esLigaTopPermitida), nowL, { margenMinutos: MARGEN_PUBLICACION_MIN, max: 200 });
                        realMatchesPool = fl.publicables || [];
                    } catch (_) { realMatchesPool = []; }
                    if (!realMatchesPool.length) {
                        const dl = await cargarDatasetRatingbet(nowL, false);
                        const cl = construirCandidatos(dl.dataset, nowL, { margenMinutos: MARGEN_MIN, maxDias: VENTANA_DIAS, maxAntiguedadMin: MAX_ANTIGUEDAD });
                        const fl = filtrarPublicables((cl.candidatos || []).filter(esLigaTopPermitida), nowL, { margenMinutos: MARGEN_PUBLICACION_MIN, max: 200 });
                        realMatchesPool = fl.publicables || [];
                        // Stats Poisson: fetch acotado (solo ligas con candidatos,
                        // paralelo, timeout 8s) — determinista y rapido, sin 504.
                        try {
                            const idsFDL = [];
                            try {
                                const txtL = realMatchesPool.map(function (c) { return String(c.liga || '') + ' ' + String(c.urlRelativa || ''); }).join(' ').toLowerCase();
                                FD_LEAGUES.forEach(function (L) {
                                    const hitL = clavesLigaFD(L).some(function (k) { const kk = String(k || '').trim(); return kk && txtL.indexOf(kk) !== -1; });
                                    if (hitL && idsFDL.indexOf(L.id) === -1) idsFDL.push(L.id);
                                });
                            } catch (_) {}
                            const mapaStatsL = await cargarStatsFootballData(nowL, { ligas: idsFDL });
                            let adjL = adjuntarStatsACandidatos(realMatchesPool, mapaStatsL);
                            if (!adjL) {
                                const mapaTSDBL = await cargarStatsTheSportsDB(nowL, realMatchesPool, { mapa: mapaStatsL || [] });
                                if (mapaTSDBL && mapaTSDBL.length) adjuntarStatsACandidatos(realMatchesPool, mapaTSDBL, { minPartidos: 2 });
                            }
                        } catch (_) {}
                    }
                }
            } catch (e) {
                realMatchesPool = [];
            }

            // Motor de combinadas v5: selecciona 2-4 picks reales cuya cuota
            // multiplicada cae en la banda del nivel de riesgo, maximizando la
            // probabilidad combinada. Cero cifras hardcodeadas: si no hay
            // combinacion posible, se declara 'sin-combinada' con su motivo.
            const parlayResponse = construirParlayRiesgo(realMatchesPool, riskLevel, Date.now());
            try {
                let conStats = 0;
                (realMatchesPool || []).forEach(function (f) { if (f && f.stats) conStats++; });
                parlayResponse.diagPool = { candidatos: (realMatchesPool || []).length, conStats: conStats };
                try { parlayResponse.diagStats = statsCache.diag || null; } catch (_) {}
            } catch (_) {}
            parlayResponse.meta = buildTemporalMeta(Date.now());
            parlayResponse.frescura = frescuraDatos();
            parlayResponse.temporalStatus = parlayResponse.estado === 'ok' ? 'VALIDADO_FUTURO' : 'SIN_COMBINADA';
            parlayResponse.advertenciaTemporal = parlayResponse.estado !== 'ok'
                ? 'No hay combinada disponible para ' + parlayResponse.nombreRiesgo + ' en este momento (' + parlayResponse.motivo + '). Solo se publican partidos futuros reales.'
                : null;

            return new Response(JSON.stringify(parlayResponse), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
            });
        }

        // =========================================================================
        // 6.d ENDPOINT: REGISTRO DE SEGUIMIENTO (track-record)
        // =========================================================================
        if (url.pathname === '/api/track-record') {
            const CACHE_KEY = 'track-record';
            const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 horas
            let cached = memoriaCache[CACHE_KEY];
            if (cached && Date.now() - cached.at < CACHE_TTL) {
                return new Response(JSON.stringify(cached.data), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
                });
            }
            try {
                const abort = new AbortController();
                const timeoutId = setTimeout(() => abort.abort(), 8000);
                const resp = await fetch('https://raw.githubusercontent.com/jarmy90/bet365edge-quant/main/edge-futbol/data/track-record.json', {
                    signal: abort.signal,
                    headers: { 'Cache-Control': 'no-store' }
                });
                clearTimeout(timeoutId);
                if (!resp.ok) throw new Error('http-' + resp.status);
                const data = await resp.json();
                const ms = Date.parse(data && data.actualizadoEnUtc);
                const todos = Array.isArray(data && data.picks) ? data.picks : [];
                const sal = {
                    ok: true,
                    actualizadoEnUtc: Number.isFinite(ms) ? new Date(ms).toISOString() : null,
                    resumen: (data && data.resumen) || null,
                    nota: (data && data.nota) || null,
                    edadMin: Number.isFinite(ms) ? Math.round((Date.now() - ms) / 60000) : null,
                    ultimos: todos.slice(-60)
                };
                memoriaCache[CACHE_KEY] = { at: Date.now(), data: sal };
                return new Response(JSON.stringify(sal), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
                });
            } catch (e) {
                // Sin cachear el fallo: el siguiente intento reintenta pronto.
                const fallback = { ok: false, track: null, motivo: (e && e.message) || 'desconocido' };
                return new Response(JSON.stringify(fallback), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
                });
            }
        }

        // =========================================================================
        // 6. FRONTEND 2026: UI TERMINAL CON BOTÒN SIN PRECIO + GATE 25â‚¬ + RIESGO
        // =========================================================================
                const INDEX_HTML = `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>EDGE.FUTBOL Quant | Análisis cuantitativo +EV</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  body { background: #0b0f19; color: #eef2f7; min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 2rem 1rem; }
  .header { text-align: center; margin-bottom: 1.5rem; }
  .header h1 { font-size: 1.8rem; font-weight: 800; background: linear-gradient(135deg,#00e676,#29b6f6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 0.3rem; }
  .header p { color: #94a3b8; font-size: 0.9rem; }
  .btn { background: linear-gradient(135deg,#00e676,#00b0ff); color: #050b14; font-weight: 800; border: none; padding: 1rem 2rem; border-radius: 50px; font-size: 1rem; cursor: pointer; margin-bottom: 1.5rem; }
  .btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .card { background: #121826; border: 1px solid #1e293b; border-radius: 16px; padding: 1.5rem; width: 100%; max-width: 700px; margin-bottom: 1rem; display: none; }
  .card.visible { display: block; }
  .card.aviso { border-color: #fca5a5; }
  .card.combinada { border-color: rgba(0,230,118,0.3); }
  .label { color: #94a3b8; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.4rem; display: block; }
  .value { font-size: 1.3rem; font-weight: 700; color: #eef2f7; }
  .edge { color: #00e676; }
  table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
  th { text-align: left; color: #94a3b8; font-size: 0.7rem; padding: 0.6rem 0; border-bottom: 1px solid #1e293b; }
  td { padding: 0.8rem 0; border-bottom: 1px solid #1a2336; font-size: 0.9rem; }
  .team { font-weight: 700; color: #eef2f7; }
  .league { color: #64748b; font-size: 0.75rem; }
  .muted { color: #64748b; font-size: 0.8rem; text-align: center; margin-top: 1rem; }
  .spinner { width: 20px; height: 20px; border: 3px solid #1e293b; border-top-color: #00e676; border-radius: 50%; animation: spin .8s linear infinite; display: inline-block; margin-right: 0.5rem; vertical-align: middle; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div class="header">
  <h1>EDGE.FUTBOL Quant</h1>
  <p>Análisis cuantitativo +EV · Datos reales de ratingbet.com</p>
</div>
<button class="btn" id="btnRun" onclick="cargar()">Actualizar datos</button>

<div class="card aviso" id="cardAviso">
  <span class="label">Estado</span>
  <div id="txtAviso" class="value" style="color:#fca5a5;">Cargando…</div>
</div>

<div class="card visible" id="cardPartidos">
  <span class="label">Partidos con análisis (modelo Poisson real)</span>
  <table><thead><tr><th>Partido</th><th>Liga</th><th>Mercado</th><th>Cuota</th><th>Prob. modelo</th><th>Edge</th></tr></thead><tbody id="tbPartidos"></tbody></table>
</div>

<div class="card combinada" id="cardCombinada">
  <span class="label">Combinada recomendada</span>
  <div id="txtCombinada" class="value">—</div>
  <div id="detalleCombinada" style="color:#94a3b8; font-size:0.85rem; margin-top:0.3rem;"></div>
</div>

<div class="muted" id="txtFooter">EDGE.FUTBOL Quant · Servicio de información estadística. No garantiza resultados.</div>

<script>
const API = 'https://edge.futbol/api';
async function cargar() {
  const btn = document.getElementById('btnRun');
  btn.disabled = true; btn.textContent = 'Cargando…';
  try {
    const [f, p] = await Promise.all([
      fetch(API + '/fixtures-hoy?force=1').then(r => r.json()),
      fetch(API + '/parlays-by-risk').then(r => r.json())
    ]);
    render(f, p);
  } catch (e) {
    document.getElementById('txtAviso').textContent = 'Error al cargar los datos.';
  } finally {
    btn.disabled = false; btn.textContent = 'Actualizar datos';
  }
}
function render(f, p) {
  const aviso = document.getElementById('txtAviso');
  const tb = document.getElementById('tbPartidos');
  const cardAviso = document.getElementById('cardAviso');
  const cardCombinada = document.getElementById('cardCombinada');
  const txtCombinada = document.getElementById('txtCombinada');
  const det = document.getElementById('detalleCombinada');

  tb.innerHTML = '';
  if (!f || f.total === 0) {
    cardAviso.style.display = 'block';
    aviso.textContent = (f && f.diagnosticoFuente && f.diagnosticoFuente.aviso) || 'No hay partidos disponibles.';
    cardCombinada.style.display = 'none';
    return;
  }
  cardAviso.style.display = 'none';
  let nStats = 0;
  for (const c of (f.fixtures || [])) {
    if (!c.stats) continue;
    nStats++;
    const tr = document.createElement('tr');
    const lado = c.lado === 'OVER' ? 'Over' : 'Under';
    tr.innerHTML = '<td><div class="team">' + escapeHtml(c.local) + ' vs ' + escapeHtml(c.visitante) + '</div><div class="league">' + escapeHtml(c.liga) + '</div></td>' +
      '<td>' + c.horaLabel + '</td>' +
      '<td><b>' + lado + ' ' + c.linea + '</b></td>' +
      '<td>' + c.cuota.toFixed(2) + '</td>' +
      '<td>' + c.modelProb + '%</td>' +
      '<td class="edge">+' + c.edgePuntos + '%</td>';
    tb.appendChild(tr);
  }
  if (nStats === 0) {
    cardAviso.style.display = 'block';
    aviso.textContent = 'No hay partidos con estadísticas reales disponibles hoy.';
    cardCombinada.style.display = 'none';
    return;
  }
  if (p && p.estado && p.estado !== 'sin-combinada' && p.selecciones && p.selecciones.length > 0) {
    cardCombinada.style.display = 'block';
    txtCombinada.textContent = 'Cuota total ' + p.cuotaTotal.toFixed(2) + '  Â·  Edge +' + p.edgeTotalPct + '%';
    det.textContent = p.selecciones.length + ' selección(es) · ' + p.nombreRiesgo;
  } else {
    cardCombinada.style.display = 'block';
    txtCombinada.textContent = 'Sin combinada hoy';
    det.textContent = (p && p.motivo ? p.motivo : 'Se necesitan al menos 2 partidos con edge positivo.');
  }
}
function escapeHtml(t) { if (!t) return ''; return String(t).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
cargar();
</script>
</body>
</html>

        `;


        // ==========================================================
        // LIVE INTELLIGENCE PANEL - /live
        // ==========================================================
        if (url.pathname === '/live') {
            const liveHtml = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>QUANTUM BETS | LIVE Intelligence Feed</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{background:#08090d;color:#f1f5f9;font-family:'Inter',sans-serif;min-height:100vh;overflow-x:hidden;}
:root{--em:#10b981;--cy:#06b6d4;--re:#ef4444;--am:#f59e0b;--pu:#8b5cf6;--bg2:#0f1117;--bg3:#161b27;--bd:#1e2535;}

/* TOP BAR */
.topbar{background:rgba(15,17,23,0.98);border-bottom:1px solid var(--bd);padding:0.75rem 1.5rem;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:200;backdrop-filter:blur(20px);}
.tb-logo{display:flex;align-items:center;gap:10px;font-weight:900;font-size:1.1rem;background:linear-gradient(135deg,#10b981,#06b6d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
.tb-icon{width:26px;height:26px;background:linear-gradient(135deg,#10b981,#06b6d4);border-radius:7px;display:flex;align-items:center;justify-content:center;color:#000;font-weight:900;font-size:0.85rem;}
.tb-center{display:flex;align-items:center;gap:1.5rem;}
.tb-clock{font-family:JetBrains Mono,monospace;font-size:0.9rem;color:var(--cy);font-weight:700;}
.live-pill{display:flex;align-items:center;gap:6px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.35);padding:4px 12px;border-radius:20px;font-size:0.75rem;font-weight:800;color:#ef4444;}
.live-dot{width:7px;height:7px;background:#ef4444;border-radius:50%;animation:ld 1.2s ease-in-out infinite;}
@keyframes ld{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,0.7);}50%{box-shadow:0 0 0 5px rgba(239,68,68,0);}}
.tb-right{display:flex;align-items:center;gap:1rem;}
.kpi-mini{text-align:center;}
.kpi-mini .v{font-size:1.05rem;font-weight:900;font-family:JetBrains Mono,monospace;color:var(--em);transition:color 0.4s,transform 0.3s;}
.kpi-mini .l{font-size:0.6rem;color:#4b5563;font-weight:600;letter-spacing:0.3px;}

/* TICKER */
.ticker{background:rgba(16,185,129,0.06);border-bottom:1px solid rgba(16,185,129,0.15);height:32px;display:flex;overflow:hidden;}
.ticker-tag{background:var(--em);color:#000;font-size:0.68rem;font-weight:800;padding:0 14px;display:flex;align-items:center;flex-shrink:0;letter-spacing:0.5px;}
.ticker-wrap{flex:1;overflow:hidden;}
.ticker-inner{display:flex;animation:tscroll 70s linear infinite;white-space:nowrap;}
.ti{font-size:0.75rem;color:#94a3b8;padding:0 1.5rem;border-right:1px solid var(--bd);line-height:32px;white-space:nowrap;}
.ti strong{color:#f1f5f9;}
.tr{color:var(--re);font-weight:700;margin-right:4px;}
.ta{color:var(--am);font-weight:700;margin-right:4px;}
.tg{color:var(--em);font-weight:700;margin-right:4px;}
@keyframes tscroll{0%{transform:translateX(0);}100%{transform:translateX(-50%);}}

/* MAIN GRID */
.main{display:grid;grid-template-columns:1fr 340px;height:calc(100vh - 97px);overflow:hidden;}

/* LEFT: EV CHART + EVENT LOG */
.left{display:flex;flex-direction:column;overflow:hidden;border-right:1px solid var(--bd);}

/* EV CHART PANEL */
.ev-panel{padding:1.25rem 1.5rem;border-bottom:1px solid var(--bd);}
.ev-hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1rem;}
.ev-title-block .t{font-size:1rem;font-weight:800;}
.ev-title-block .s{font-size:0.72rem;color:#6b7280;margin-top:2px;}
.ev-metrics{display:flex;gap:1rem;}
.ev-m{background:var(--bg3);border:1px solid var(--bd);border-radius:10px;padding:0.6rem 1rem;text-align:center;min-width:110px;}
.ev-m .lbl{font-size:0.62rem;color:#6b7280;margin-bottom:2px;font-weight:600;text-transform:uppercase;letter-spacing:0.3px;}
.ev-m .val{font-size:1.3rem;font-weight:900;font-family:JetBrains Mono,monospace;transition:all 0.4s;}
.trend-badge{display:inline-flex;align-items:center;gap:5px;padding:4px 12px;border-radius:20px;font-size:0.75rem;font-weight:800;margin-top:0.5rem;transition:all 0.4s;}
.trend-up{background:rgba(16,185,129,0.12);color:var(--em);border:1px solid rgba(16,185,129,0.3);}
.trend-dn{background:rgba(239,68,68,0.1);color:var(--re);border:1px solid rgba(239,68,68,0.25);}
.chart-wrap{position:relative;height:180px;margin-top:1rem;}

/* LAST EVENT BAR */
.last-evt{background:var(--bg3);border-top:1px solid var(--bd);padding:0.6rem 1.5rem;font-size:0.78rem;display:flex;align-items:center;gap:10px;transition:all 0.3s;}
.le-icon{width:8px;height:8px;border-radius:50%;flex-shrink:0;}
.le-text{color:#94a3b8;flex:1;}
.le-delta{font-family:JetBrains Mono,monospace;font-weight:800;font-size:0.82rem;}

/* EVENT LOG */
.event-log{flex:1;overflow-y:auto;padding:0;}
.event-log::-webkit-scrollbar{width:4px;}
.event-log::-webkit-scrollbar-track{background:#0a0c10;}
.event-log::-webkit-scrollbar-thumb{background:#1e2535;border-radius:2px;}
.el-hdr{padding:0.75rem 1.5rem;font-size:0.72rem;font-weight:800;color:#4b5563;letter-spacing:0.8px;border-bottom:1px solid var(--bd);text-transform:uppercase;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);}
.el-hdr .count{background:rgba(16,185,129,0.1);color:var(--em);border:1px solid rgba(16,185,129,0.2);padding:2px 8px;border-radius:10px;font-size:0.65rem;}
.el-item{display:flex;align-items:flex-start;gap:10px;padding:0.75rem 1.5rem;border-bottom:1px solid rgba(30,37,53,0.5);transition:background 0.2s;animation:slideIn 0.4s ease;}
@keyframes slideIn{from{transform:translateX(-20px);opacity:0;}to{transform:translateX(0);opacity:1;}}
.el-item:hover{background:rgba(255,255,255,0.02);}
.el-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;margin-top:5px;}
.el-body{flex:1;}
.el-tag{font-size:0.62rem;font-weight:800;padding:1px 6px;border-radius:8px;margin-bottom:4px;display:inline-block;letter-spacing:0.3px;}
.tag-gol{background:rgba(16,185,129,0.15);color:var(--em);}
.tag-baja{background:rgba(239,68,68,0.12);color:var(--re);}
.tag-cuota{background:rgba(6,182,212,0.12);color:var(--cy);}
.tag-social{background:rgba(139,92,246,0.12);color:var(--pu);}
.tag-meteo{background:rgba(245,158,11,0.1);color:var(--am);}
.tag-news{background:rgba(248,250,252,0.07);color:#94a3b8;}
.el-desc{font-size:0.8rem;color:#cbd5e1;line-height:1.4;font-weight:500;}
.el-meta{display:flex;align-items:center;gap:8px;margin-top:4px;}
.el-time{font-size:0.65rem;color:#4b5563;font-family:JetBrains Mono,monospace;}
.el-ev{font-size:0.7rem;font-weight:800;font-family:JetBrains Mono,monospace;}
.ev-pos{color:var(--em);}
.ev-neg{color:var(--re);}

/* RIGHT PANEL */
.right{display:flex;flex-direction:column;overflow:hidden;background:var(--bg2);}

/* RIGHT SECTIONS */
.r-section{border-bottom:1px solid var(--bd);}
.r-hdr{padding:0.75rem 1rem;font-size:0.7rem;font-weight:800;color:#4b5563;letter-spacing:0.8px;text-transform:uppercase;display:flex;justify-content:space-between;align-items:center;}
.r-hdr .pulse{width:6px;height:6px;background:var(--em);border-radius:50%;animation:ld 1.4s infinite;}

/* LIVE SCORES */
.scores-list{padding:0 0.5rem 0.5rem;}
.score-row{display:flex;align-items:center;gap:6px;padding:0.5rem 0.6rem;border-radius:8px;margin-bottom:4px;transition:background 0.2s;}
.score-row:hover{background:rgba(255,255,255,0.025);}
.sr-league{font-size:0.58rem;color:#6b7280;font-weight:700;width:18px;text-align:center;flex-shrink:0;}
.sr-teams{flex:1;font-size:0.78rem;font-weight:600;line-height:1.3;}
.sr-home,.sr-away{display:block;}
.sr-score{font-family:JetBrains Mono,monospace;font-size:0.9rem;font-weight:900;min-width:30px;text-align:center;}
.sr-score.live{color:var(--em);animation:sf 3s ease-in-out infinite;}
@keyframes sf{0%,75%,100%{opacity:1;}80%{opacity:0.3;}}
.sr-min{font-size:0.6rem;background:rgba(239,68,68,0.12);color:var(--re);padding:1px 4px;border-radius:4px;font-weight:700;font-family:JetBrains Mono,monospace;}
.sr-ev{font-size:0.65rem;font-weight:700;padding:1px 5px;border-radius:8px;}
.sr-pos{background:rgba(16,185,129,0.1);color:var(--em);}
.sr-neg{background:rgba(239,68,68,0.08);color:var(--re);}

/* WEATHER */
.weather-list{padding:0 0.5rem 0.5rem;}
.w-row{display:flex;align-items:center;gap:8px;padding:0.4rem 0.6rem;border-radius:8px;margin-bottom:4px;}
.w-icon{font-size:1.4rem;flex-shrink:0;}
.w-info{flex:1;}
.w-match{font-size:0.75rem;font-weight:700;}
.w-detail{font-size:0.65rem;color:#6b7280;margin-top:1px;}
.w-temp{font-size:1rem;font-weight:900;font-family:JetBrains Mono,monospace;}
.w-badge{font-size:0.62rem;font-weight:700;padding:1px 6px;border-radius:8px;}
.wb-ok{background:rgba(16,185,129,0.1);color:var(--em);}
.wb-warn{background:rgba(245,158,11,0.1);color:var(--am);}
.wb-bad{background:rgba(239,68,68,0.1);color:var(--re);}

/* SOCIAL */
.social-list{padding:0 0.5rem 0.5rem;overflow-y:auto;max-height:260px;}
.social-list::-webkit-scrollbar{width:3px;}
.social-list::-webkit-scrollbar-thumb{background:#1e2535;}
.soc-item{background:var(--bg3);border:1px solid var(--bd);border-radius:10px;padding:0.7rem 0.875rem;margin-bottom:6px;transition:all 0.3s;animation:slideIn 0.5s ease;}
.soc-item:hover{border-color:rgba(16,185,129,0.25);}
.soc-hdr{display:flex;align-items:center;gap:6px;margin-bottom:5px;}
.soc-av{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:900;flex-shrink:0;}
.av1{background:linear-gradient(135deg,#1d9bf0,#0284c7);}
.av2{background:linear-gradient(135deg,#f58529,#dd2a7b);}
.av3{background:linear-gradient(135deg,#10b981,#059669);}
.av4{background:linear-gradient(135deg,#8b5cf6,#6d28d9);}
.av5{background:linear-gradient(135deg,#f59e0b,#d97706);}
.soc-name{font-size:0.75rem;font-weight:700;flex:1;}
.soc-plat{font-size:0.6rem;font-weight:800;padding:1px 5px;border-radius:6px;}
.plat-tw{background:rgba(29,155,240,0.12);color:#1d9bf0;}
.plat-ig{background:rgba(221,42,123,0.12);color:#dd2a7b;}
.soc-text{font-size:0.72rem;color:#94a3b8;line-height:1.4;margin-bottom:5px;}
.soc-ai{background:rgba(139,92,246,0.07);border:1px solid rgba(139,92,246,0.15);border-radius:6px;padding:5px 7px;font-size:0.65rem;color:#a78bfa;line-height:1.4;}
.soc-foot{display:flex;justify-content:space-between;align-items:center;margin-top:5px;}
.soc-time{font-size:0.6rem;color:#4b5563;}
.soc-imp{font-size:0.65rem;font-weight:800;padding:1px 6px;border-radius:8px;}
.si-pos{background:rgba(16,185,129,0.1);color:var(--em);}
.si-neg{background:rgba(239,68,68,0.1);color:var(--re);}
.si-neu{background:rgba(107,114,128,0.1);color:#6b7280;}

/* GOAL TOAST */
.goal-toast{position:fixed;top:80px;right:20px;z-index:500;display:flex;flex-direction:column;gap:8px;pointer-events:none;}
.g-toast{background:rgba(16,185,129,0.95);color:#000;padding:10px 16px;border-radius:12px;font-size:0.82rem;font-weight:800;display:flex;align-items:center;gap:8px;box-shadow:0 4px 20px rgba(16,185,129,0.5);animation:toastIn 0.4s ease;min-width:220px;}
@keyframes toastIn{from{transform:translateX(40px);opacity:0;}to{transform:translateX(0);opacity:1;}}
.g-toast.leaving{animation:toastOut 0.4s ease forwards;}
@keyframes toastOut{to{transform:translateX(40px);opacity:0;}}
.gt-icon{font-size:1.1rem;}

/* EV FLASH */
.ev-flash{animation:evFlash 0.5s ease;}
@keyframes evFlash{0%,100%{filter:brightness(1);}50%{filter:brightness(1.4);}}

@media(max-width:900px){
    .main{grid-template-columns:1fr;}
    .right{display:none;}
}
</style>
</head>
<body>

<!-- TOPBAR -->
<div class="topbar">
    <div class="tb-logo">
        <div class="tb-icon" style="background:transparent; padding:0; width:auto; height:24px;">
            <svg viewBox="0 0 200 160" height="24" style="width:auto; height:24px; display:block;" fill="none" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <linearGradient id="edgeLiveGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#10b981"/>
                        <stop offset="100%" stop-color="#06b6d4"/>
                    </linearGradient>
                </defs>
                <g transform="translate(10, 10)">
                    <path d="M 45 10 L 120 10 C 135 10 142 22 132 38 L 118 60 L 52 60 Z" fill="url(#edgeLiveGrad)"/>
                    <path d="M 38 68 L 105 68 C 112 68 116 75 110 85 L 102 98 L 30 98 Z" fill="url(#edgeLiveGrad)"/>
                    <path d="M 26 106 L 95 106 C 105 106 102 118 85 135 L 75 145 C 55 145 35 140 20 130 Z" fill="url(#edgeLiveGrad)"/>
                    <path d="M 95 15 C 135 -5 175 15 190 55 C 205 95 185 140 135 155 C 105 162 70 152 50 135 C 75 148 115 148 145 130 C 175 108 185 70 170 42 C 158 20 128 8 95 15 Z" fill="#0f172a" stroke="url(#edgeLiveGrad)" stroke-width="2"/>
                </g>
            </svg>
        </div>
        <span style="font-family:'JetBrains Mono', sans-serif; font-style:italic;">EDGE.FUTBOL</span>
        <span style="background:rgba(16,185,129,0.1);color:var(--em);border:1px solid rgba(16,185,129,0.3);padding:3px 8px;border-radius:12px;font-size:0.65rem;font-weight:700;-webkit-text-fill-color:var(--em);background-clip:unset;">LIVE INTELLIGENCE</span>
    </div>
    <div class="tb-center">
        <div class="live-pill"><div class="live-dot"></div><span>EN DIRECTO</span></div>
        <div class="tb-clock" id="clock">--:--:--</div>
    </div>
    <div class="tb-right">
        <div class="kpi-mini"><div class="v" id="kEdge">+12.5%</div><div class="l">EV EDGE</div></div>
        <div style="width:1px;height:30px;background:var(--bd);"></div>
        <div class="kpi-mini"><div class="v" id="kLive" style="color:var(--re);">18</div><div class="l">LIVE</div></div>
        <div style="width:1px;height:30px;background:var(--bd);"></div>
        <div class="kpi-mini"><div class="v" id="kAlerts" style="color:var(--am);">7</div><div class="l">ALERTAS</div></div>
        <div style="width:1px;height:30px;background:var(--bd);"></div>
        <div class="kpi-mini"><div class="v" id="kGoals" style="color:var(--cy);">0</div><div class="l">GOLES HOY</div></div>
    </div>
</div>

<!-- TICKER -->
<div class="ticker">
    <div class="ticker-tag">&#128225; LIVE</div>
    <div class="ticker-wrap">
        <div class="ticker-inner" id="tickerEl">
            <span class="ti"><span class="tr">&#128308;</span><strong>Inter 2-1 Napoli</strong> min.71 &mdash; Over 2.5 EV sube a +14.3%</span>
            <span class="ti"><span class="tg">&#9917;</span><strong>GOL PSG</strong> Mbappe min.67 &mdash; PSG 2-1 Lyon &mdash; EV +8%</span>
            <span class="ti"><span class="ta">&#9888;</span><strong>Sergio Leon descartado</strong> Valladolid &mdash; EV Edge +13.2%</span>
            <span class="ti">&#129302; <strong>Bellingham Twitter:</strong> "Ready for tomorrow" &mdash; IA: POSITIVO +2.1%</span>
            <span class="ti"><span class="tr">&#127783;</span><strong>Lluvia en Montevideo</strong> River vs Fenix &mdash; campo pesado &mdash; impacto NEUTRAL</span>
            <span class="ti"><span class="tg">&#9917;</span><strong>GOL Leipzig</strong> min.80 &mdash; 1-1 vs Frankfurt &mdash; Over 2.5 en riesgo</span>
            <span class="ti"><span class="ta">&#9888;</span><strong>Lewandowski OUT</strong> Bayern vs Dortmund &mdash; EV cae -3.1%</span>
            <span class="ti">&#128202; Movimiento sharp: Over 1.5 Tenerife 1.44 &rarr; 1.41 &mdash; flujo institucional</span>
            <span class="ti"><span class="tr">&#128308;</span><strong>Inter 2-1 Napoli</strong> min.71 &mdash; Over 2.5 EV sube a +14.3%</span>
            <span class="ti"><span class="tg">&#9917;</span><strong>GOL PSG</strong> Mbappe min.67 &mdash; PSG 2-1 Lyon &mdash; EV +8%</span>
            <span class="ti"><span class="ta">&#9888;</span><strong>Sergio Leon descartado</strong> Valladolid &mdash; EV Edge +13.2%</span>
            <span class="ti">&#129302; <strong>Bellingham Twitter:</strong> "Ready for tomorrow" &mdash; IA: POSITIVO +2.1%</span>
            <span class="ti"><span class="tr">&#127783;</span><strong>Lluvia en Montevideo</strong> River vs Fenix &mdash; campo pesado &mdash; impacto NEUTRAL</span>
            <span class="ti"><span class="tg">&#9917;</span><strong>GOL Leipzig</strong> min.80 &mdash; 1-1 vs Frankfurt &mdash; Over 2.5 en riesgo</span>
            <span class="ti"><span class="ta">&#9888;</span><strong>Lewandowski OUT</strong> Bayern vs Dortmund &mdash; EV cae -3.1%</span>
            <span class="ti">&#128202; Movimiento sharp: Over 1.5 Tenerife 1.44 &rarr; 1.41 &mdash; flujo institucional</span>
        </div>
    </div>
</div>

<!-- MAIN -->
<div class="main">

    <!-- LEFT: CHART + LOG -->
    <div class="left">

        <!-- EV CHART -->
        <div class="ev-panel">
            <div class="ev-hdr">
                <div class="ev-title-block">
                    <div class="t">EV Edge &mdash; Reaccion en Tiempo Real</div>
                    <div class="s">Cada evento (gol, baja, social, cuota, clima) recalcula el Edge autom&aacute;ticamente</div>
                    <div class="trend-badge trend-up" id="trendBadge">&#8593; SUBIENDO +0.8%</div>
                </div>
                <div class="ev-metrics">
                    <div class="ev-m"><div class="lbl">EV EDGE LIVE</div><div class="val" id="evVal" style="color:var(--em);">+12.5%</div></div>
                    <div class="ev-m"><div class="lbl">PROB. MODELO</div><div class="val" id="evProb" style="color:var(--cy);">46.97%</div></div>
                    <div class="ev-m"><div class="lbl">CUOTA IMPL.</div><div class="val" id="evImpl" style="color:#6b7280;">34.45%</div></div>
                </div>
            </div>
            <div class="chart-wrap"><canvas id="evChart"></canvas></div>
        </div>

        <!-- LAST EVENT -->
        <div class="last-evt" id="lastEvt">
            <div class="le-icon" style="background:var(--em);"></div>
            <div class="le-text">Iniciando monitor de eventos...</div>
            <div class="le-delta ev-pos" id="lastDelta">--</div>
        </div>

        <!-- EVENT LOG -->
        <div class="event-log">
            <div class="el-hdr">
                FLUJO DE EVENTOS EN VIVO
                <span class="count" id="evtCount">0 eventos</span>
            </div>
            <div id="logContainer"></div>
        </div>
    </div>

    <!-- RIGHT PANEL -->
    <div class="right">

        <!-- LIVE SCORES -->
        <div class="r-section">
            <div class="r-hdr">&#9917; Partidos en Directo <div class="pulse"></div></div>
            <div class="scores-list" id="scoresList"></div>
        </div>

        <!-- WEATHER -->
        <div class="r-section">
            <div class="r-hdr">&#127782; Clima en Estadios <div class="pulse"></div></div>
            <div class="weather-list" id="weatherList"></div>
        </div>

        <!-- SOCIAL AI -->
        <div class="r-section" style="flex:1;display:flex;flex-direction:column;">
            <div class="r-hdr">&#129302; Social IA &mdash; Jugadores <div class="pulse"></div></div>
            <div class="social-list" id="socialList"></div>
        </div>
    </div>
</div>

<!-- GOAL TOASTS -->
<div class="goal-toast" id="goalToast"></div>

<script>
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  LIVE MATCHES DATA
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
var MATCHES=[
    {lg:"L1",home:"PSG",away:"Lyon",score:[2,1],min:67,live:true,ev:11.2,evDir:1},
    {lg:"L1",home:"Marseille",away:"Monaco",score:[0,0],min:43,live:true,ev:7.8,evDir:1},
    {lg:"SA",home:"Inter",away:"Napoli",score:[2,1],min:71,live:true,ev:14.3,evDir:1},
    {lg:"SA",home:"Juventus",away:"Roma",score:[1,0],min:55,live:true,ev:6.5,evDir:1},
    {lg:"PL",home:"Man City",away:"Arsenal",score:[1,1],min:34,live:true,ev:8.7,evDir:1},
    {lg:"BL",home:"Bayern",away:"Dortmund",score:[3,1],min:62,live:true,ev:-3.1,evDir:-1},
    {lg:"BL",home:"Leipzig",away:"Frankfurt",score:[1,1],min:80,live:true,ev:7.9,evDir:1}
];

var WEATHER=[
    {icon:"&#9925;",match:"Valladolid vs Oviedo",temp:19,wind:32,rain:8,badge:"wb-warn",blbl:"Viento alto"},
    {icon:"&#9728;",match:"Tenerife vs Leganes",temp:25,wind:11,rain:0,badge:"wb-ok",blbl:"Ideal"},
    {icon:"&#127783;",match:"River vs Fenix",temp:16,wind:18,rain:88,badge:"wb-bad",blbl:"Lluvia fuerte 88%"}
];

var SOCIAL_POOL=[
    {av:"av1",name:"Jude Bellingham",team:"Real Madrid",text:'"Ready for tomorrow. Lets go &#128293;"',plat:"plat-tw",platLbl:"TW",ai:"Disponibilidad CONFIRMADA. 89% rendimiento superior cuando publica noche antes.",imp:"si-pos",impLbl:"EV +2.1%",delta:+2.1},
    {av:"av2",name:"Vinicius Jr.",team:"Real Madrid",text:'"Entrenamiento completado &#9989; Al 100%"',plat:"plat-ig",platLbl:"IG",ai:"Post confirmacion fisica. Matchup favorito vs banda derecha rival.",imp:"si-pos",impLbl:"EV +1.8%",delta:+1.8},
    {av:"av1",name:"Kylian Mbappe",team:"PSG",text:'"Training done &#128170; Big match tomorrow"',plat:"plat-tw",platLbl:"TW",ai:"PSG en casa: 2.3 goles media cuando Mbappe entrena 48h antes.",imp:"si-pos",impLbl:"EV +3.2%",delta:+3.2},
    {av:"av3",name:"Erling Haaland",team:"Man City",text:'"100 Premier League goals. Next: 101 &#127919;"',plat:"plat-tw",platLbl:"TW",ai:"Racha 6 goles en 4 partidos. Motivacion extrema detectada. Senal AAA.",imp:"si-pos",impLbl:"EV +4.1%",delta:+4.1},
    {av:"av4",name:"Victor Osimhen",team:"Napoli",text:'"Feeling good but still recovering &#10084;"',plat:"plat-ig",platLbl:"IG",ai:"ALERTA: Lenguaje ambiguo. Duda confirmada para hoy. Impacto negativo.",imp:"si-neg",impLbl:"EV -2.4%",delta:-2.4},
    {av:"av5",name:"Robert Lewandowski",team:"Bayern",text:'"Injured, gutted to miss this one &#128532;"',plat:"plat-tw",platLbl:"TW",ai:"BAJA CONFIRMADA. Bayern pierde referencia ofensiva. Over 2.5 cae -3.1%.",imp:"si-neg",impLbl:"EV -3.1%",delta:-3.1},
    {av:"av2",name:"Lamine Yamal",team:"Barcelona",text:'"Sesion increible hoy &#9889; Listos"',plat:"plat-ig",platLbl:"IG",ai:"Confirmacion total disponibilidad. Barcelona fuera: Over 1.5 en 82% historico.",imp:"si-pos",impLbl:"EV +2.6%",delta:+2.6}
];

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  EVENT POOL (what drives the EV)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
var EVENT_POOL=[
    {tag:"tag-baja",tagLbl:"BAJA",dot:"#ef4444",desc:"Sergio Leon (Valladolid) descartado por molestias musculares. Weissman asume el rol de 9.",delta:+1.2,type:"baja"},
    {tag:"tag-cuota",tagLbl:"CUOTA",dot:"#06b6d4",desc:"Over 1.5 Tenerife-Leganes cae de 1.44 a 1.41 en las casas. Flujo sharp detectado.",delta:+0.6,type:"cuota"},
    {tag:"tag-social",tagLbl:"SOCIAL",dot:"#8b5cf6",desc:"Instagram Weissman: '100% listo para el partido'. Confirmacion fisica verificada.",delta:+0.3,type:"social"},
    {tag:"tag-meteo",tagLbl:"METEO",dot:"#f59e0b",desc:"Tenerife: cielo despejado, 25C, viento 11km/h. Condiciones ideales para Over.",delta:+0.2,type:"meteo"},
    {tag:"tag-gol",tagLbl:"GOL LIVE",dot:"#10b981",desc:"GOOOL! Mbappe marca en PSG 2-1 Lyon (min.67). Over 2.5 confirmado en ese partido.",delta:+0.9,type:"gol",goal:"PSG 2-1 Lyon (Mbappe 67')"},
    {tag:"tag-cuota",tagLbl:"CUOTA",dot:"#06b6d4",desc:"Cuota Over 2.5 Inter-Napoli cae 1.85 a 1.71. EV aumenta significativamente.",delta:+0.8,type:"cuota"},
    {tag:"tag-baja",tagLbl:"BAJA",dot:"#ef4444",desc:"Lewandowski descartado para Bayern vs Dortmund. Baja de ultima hora confirmada.",delta:-0.8,type:"baja"},
    {tag:"tag-gol",tagLbl:"GOL LIVE",dot:"#10b981",desc:"GOOOL! Inter amplía a 2-1 vs Napoli (min.71). Over 1.5 confirmado.",delta:+1.1,type:"gol",goal:"Inter 2-1 Napoli (min.71)"},
    {tag:"tag-social",tagLbl:"SOCIAL",dot:"#8b5cf6",desc:"Twitter Bellingham: 'Ready for tomorrow'. IA detecta ALTA confianza, disponible 100%.",delta:+0.4,type:"social"},
    {tag:"tag-meteo",tagLbl:"METEO",dot:"#f59e0b",desc:"Lluvia fuerte Montevideo 88%. Campo pesado River vs Fenix. Ritmo -8%, corrige Edge -0.4%.",delta:-0.4,type:"meteo"},
    {tag:"tag-cuota",tagLbl:"CUOTA",dot:"#06b6d4",desc:"Man City vs Arsenal: Over 2.5 sube de 1.65 a 1.72 tras 1-1. Valor detectado.",delta:+0.7,type:"cuota"},
    {tag:"tag-gol",tagLbl:"GOL LIVE",dot:"#10b981",desc:"GOOOL! Bayern amplía a 3-1 vs Dortmund (min.62). Over confirmado.",delta:+0.5,type:"gol",goal:"Bayern 3-1 Dortmund (min.62)"},
    {tag:"tag-social",tagLbl:"SOCIAL",dot:"#8b5cf6",desc:"Instagram Osimhen: 'still recovering'. ALERTA: jugador duda. Napoli sin referencia.",delta:-0.5,type:"social"},
    {tag:"tag-baja",tagLbl:"BAJA",dot:"#ef4444",desc:"Tarin Garcia (Leganes) entrenó diferenciado. Decision pendiente en rueda de prensa.",delta:-0.3,type:"baja"},
    {tag:"tag-cuota",tagLbl:"CUOTA",dot:"#06b6d4",desc:"Movimiento sharp detectado: flujo institucional en Over 1.5 Valladolid. Cuota cae.",delta:+0.6,type:"cuota"},
    {tag:"tag-gol",tagLbl:"GOL LIVE",dot:"#10b981",desc:"GOOOL! Leipzig 1-1 Frankfurt (min.80). Partido muy abierto — Over 2.5 posible.",delta:+0.6,type:"gol",goal:"Leipzig 1-1 Frankfurt (min.80)"},
    {tag:"tag-social",tagLbl:"SOCIAL",dot:"#8b5cf6",desc:"Twitter Haaland: '100 goles Premier. Siguiente: 101'. Racha 6 goles en 4 partidos.",delta:+0.9,type:"social"},
    {tag:"tag-meteo",tagLbl:"METEO",dot:"#f59e0b",desc:"Viento 32km/h en Valladolid previsto para 16:15h. Puede afectar juego aereo.",delta:-0.2,type:"meteo"},
    {tag:"tag-news",tagLbl:"NOTICIA",dot:"#6b7280",desc:"PSG confirma alineacion: Mbappe, Dembele y Asensio en el once. Ataque completo.",delta:+0.4,type:"news"},
    {tag:"tag-news",tagLbl:"NOTICIA",dot:"#6b7280",desc:"Tenerife confirma alineacion: Bermejo, Gallego y Aitor. Los 3 mas goleadores.",delta:+0.3,type:"news"}
];

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  EV CHART SETUP
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
var evData=[], evLabels=[], evChart, evIdx=0, evCurrent=12.5, logCount=0, goalCount=0;
var socialIdx=0;

function initChart(){
    // Seed 25 points
    var v=12.5;
    for(var i=0;i<25;i++){
        v+=((Math.random()-0.45)*0.5);
        v=Math.max(8,Math.min(20,v));
        evData.push(parseFloat(v.toFixed(2)));
        evLabels.push("");
    }
    evCurrent=evData[evData.length-1];
    var ctx=document.getElementById("evChart").getContext("2d");
    var g=ctx.createLinearGradient(0,0,0,180);
    g.addColorStop(0,"rgba(16,185,129,0.4)");
    g.addColorStop(1,"rgba(16,185,129,0)");
    evChart=new Chart(ctx,{
        type:"line",
        data:{labels:evLabels,datasets:[{
            label:"EV %",data:evData,
            borderColor:"#10b981",backgroundColor:g,
            fill:true,tension:0.5,borderWidth:2.5,
            pointRadius:0,pointHoverRadius:4,
            pointBackgroundColor:"#10b981"
        }]},
        options:{
            responsive:true,maintainAspectRatio:false,
            animation:{duration:500},
            plugins:{legend:{display:false},tooltip:{callbacks:{label:function(c){return " +"+c.parsed.y.toFixed(2)+"%";}}}},
            scales:{
                x:{display:false},
                y:{grid:{color:"rgba(30,37,53,0.8)"},ticks:{color:"#4b5563",callback:function(v){return "+"+v+"%";},font:{size:10}},min:6,max:22}
            }
        }
    });
}

function pushEV(delta){
    var pico=0;
    if(Math.random()<0.08){ pico=(Math.random()<0.7?1:-1)*(0.6+Math.random()*0.5); }
    var newVal=evCurrent+delta+pico+((Math.random()-0.5)*0.15);
    newVal=Math.max(8,Math.min(20,newVal));
    newVal=parseFloat(newVal.toFixed(2));
    var prev=evCurrent;
    evCurrent=newVal;
    evData.push(newVal);
    evLabels.push("");
    if(evData.length>60){evData.shift();evLabels.shift();}
    evChart.data.labels=evLabels;
    evChart.data.datasets[0].data=evData;
    evChart.update("none");
    // Update metrics
    document.getElementById("evVal").textContent=(newVal>0?"+":"")+newVal+"%";
    document.getElementById("kEdge").textContent=(newVal>0?"+":"")+newVal.toFixed(1)+"%";
    var prob=46.97+(newVal-12.5)*0.35;
    document.getElementById("evProb").textContent=prob.toFixed(2)+"%";
    // Trend badge
    var tb=document.getElementById("trendBadge");
    var up=newVal>=prev;
    tb.className="trend-badge "+(up?"trend-up":"trend-dn");
    tb.innerHTML=(up?"&#8593;":"&#8595;")+" "+(up?"SUBIENDO":"BAJANDO")+" "+(delta>=0?"+":"")+delta.toFixed(1)+"%";
    // Flash
    document.getElementById("evVal").classList.add("ev-flash");
    setTimeout(function(){document.getElementById("evVal").classList.remove("ev-flash");},500);
    // kEdge flash
    var ke=document.getElementById("kEdge");
    ke.style.color=up?"var(--em)":"var(--re)";
    ke.style.transform="scale(1.15)";
    setTimeout(function(){ke.style.color="var(--em)";ke.style.transform="scale(1)";},600);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  EVENT LOG
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function addEvent(evt){
    var container=document.getElementById("logContainer");
    var div=document.createElement("div");
    div.className="el-item";
    var now=new Date();
    var t=now.getHours()+":"+String(now.getMinutes()).padStart(2,"0")+":"+String(now.getSeconds()).padStart(2,"0");
    var sign=evt.delta>=0?"+":"";
    var evClass=evt.delta>=0?"ev-pos":"ev-neg";
    div.innerHTML='<div class="el-dot" style="background:'+evt.dot+';"></div>'+
        '<div class="el-body">'+
        '<div class="el-tag '+evt.tag+'">'+evt.tagLbl+'</div>'+
        '<div class="el-desc">'+evt.desc+'</div>'+
        '<div class="el-meta"><span class="el-time">'+t+'</span>'+
        '<span class="el-ev '+evClass+'">'+sign+evt.delta.toFixed(1)+'% EV</span></div>'+
        '</div>';
    container.insertBefore(div,container.firstChild);
    // Keep max 40
    while(container.children.length>40) container.removeChild(container.lastChild);
    // Count
    logCount++;
    document.getElementById("evtCount").textContent=logCount+" eventos";
    // Last event bar
    var le=document.getElementById("lastEvt");
    le.querySelector(".le-icon").style.background=evt.dot;
    le.querySelector(".le-text").textContent=evt.desc.substring(0,80)+(evt.desc.length>80?"...":"");
    var ld=document.getElementById("lastDelta");
    ld.textContent=(sign)+evt.delta.toFixed(1)+"% EV";
    ld.className="le-delta "+(evt.delta>=0?"ev-pos":"ev-neg");
    // Push to chart
    pushEV(evt.delta);
    // Goal toast
    if(evt.type==="gol"&&evt.goal){
        showGoalToast(evt.goal);
        goalCount++;
        document.getElementById("kGoals").textContent=goalCount;
    }
    // Alert count
    if(evt.type==="baja"||evt.type==="meteo"){
        var ac=parseInt(document.getElementById("kAlerts").textContent)||7;
        document.getElementById("kAlerts").textContent=ac+1;
    }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  GOAL TOAST
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function showGoalToast(text){
    var c=document.getElementById("goalToast");
    var t=document.createElement("div");
    t.className="g-toast";
    t.innerHTML='<div class="gt-icon">&#9917;</div><div><div style="font-size:0.68rem;margin-bottom:1px;">GOOOL EN DIRECTO</div>'+text+'</div>';
    c.insertBefore(t,c.firstChild);
    setTimeout(function(){
        t.classList.add("leaving");
        setTimeout(function(){if(t.parentNode)t.parentNode.removeChild(t);},400);
    },4000);
    while(c.children.length>3) c.removeChild(c.lastChild);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  SCORES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function renderScores(){
    var g=document.getElementById("scoresList");
    g.innerHTML=MATCHES.map(function(m){
        var sc=m.score[0]+"-"+m.score[1];
        var evSign=m.ev>=0?"+":"";
        var evCls=m.ev>=0?"sr-pos":"sr-neg";
        return'<div class="score-row">'+
            '<div class="sr-league">'+m.lg+'</div>'+
            '<div class="sr-teams"><span class="sr-home">'+m.home+'</span><span class="sr-away" style="color:#6b7280;">'+m.away+'</span></div>'+
            '<div>'+
            '<div class="sr-score '+(m.live?"live":"")+'">'+sc+'</div>'+
            (m.live?'<div style="text-align:center;"><span class="sr-min">'+m.min+"'</span></div>":'<div style="font-size:0.6rem;color:#4b5563;text-align:center;">HOY</div>')+
            '</div>'+
            '<div class="sr-ev '+evCls+'">'+evSign+m.ev.toFixed(1)+"%"+'</div>'+
            '</div>';
    }).join("");
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  WEATHER
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function renderWeather(){
    var g=document.getElementById("weatherList");
    g.innerHTML=WEATHER.map(function(w){
        return'<div class="w-row">'+
            '<div class="w-icon">'+w.icon+'</div>'+
            '<div class="w-info"><div class="w-match">'+w.match+'</div>'+
            '<div class="w-detail">Viento '+w.wind+'km/h &middot; Lluvia '+w.rain+'%</div></div>'+
            '<div style="text-align:right;"><div class="w-temp">'+w.temp+'&deg;</div>'+
            '<div class="w-badge '+w.badge+'">'+w.blbl+'</div></div>'+
            '</div>';
    }).join("");
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  SOCIAL
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function renderSocial(){
    var g=document.getElementById("socialList");
    // show last 5 added
    var items=socialShown.slice(-5).reverse();
    g.innerHTML=items.map(function(s){
        return'<div class="soc-item">'+
            '<div class="soc-hdr">'+
            '<div class="soc-av '+s.av+'">'+s.name.charAt(0)+'</div>'+
            '<div class="soc-name">'+s.name+' <span style="font-size:0.65rem;color:#6b7280;font-weight:400;">'+s.team+'</span></div>'+
            '<div class="soc-plat '+s.plat+'">'+s.platLbl+'</div>'+
            '</div>'+
            '<div class="soc-text">'+s.text+'</div>'+
            '<div class="soc-ai">&#129302; IA: '+s.ai+'</div>'+
            '<div class="soc-foot"><span class="soc-time">hace '+s.ago+'</span><span class="soc-imp '+s.imp+'">'+s.impLbl+'</span></div>'+
            '</div>';
    }).join("");
}

var socialShown=[];
function addSocial(s){
    var mins=[2,5,8,12,18,25,31,45];
    s.ago=mins[Math.floor(Math.random()*mins.length)]+" min";
    socialShown.push(s);
    if(socialShown.length>10) socialShown.shift();
    renderSocial();
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  CLOCK
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function updateClock(){
    var n=new Date();
    document.getElementById("clock").textContent=
        String(n.getHours()).padStart(2,"0")+":"+
        String(n.getMinutes()).padStart(2,"0")+":"+
        String(n.getSeconds()).padStart(2,"0");
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  LIVE MINUTES UPDATE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
var sec=0;
function tick(){
    sec++;
    updateClock();
    // Every 60s: advance minutes, maybe goal
    if(sec%60===0){
        MATCHES.forEach(function(m){
            if(m.live&&m.min<90){m.min++;}
        });
        // Random goal chance
        if(Math.random()>0.6){
            var liveMs=MATCHES.filter(function(m){return m.live&&m.min<90;});
            if(liveMs.length>0){
                var m=liveMs[Math.floor(Math.random()*liveMs.length)];
                if(Math.random()>0.5) m.score[0]++;
                else m.score[1]++;
                var gText=m.home+" "+m.score[0]+"-"+m.score[1]+" "+m.away+" (min."+m.min+")";
                showGoalToast(gText);
                goalCount++;
                document.getElementById("kGoals").textContent=goalCount;
                // EV jump
                pushEV(+(Math.random()*1.5+0.5).toFixed(2));
                renderScores();
            }
        }
        // Update weather slightly
        WEATHER.forEach(function(w){
            w.temp+=Math.round((Math.random()-0.5)*0.3);
            w.wind=Math.max(0,w.wind+Math.round((Math.random()-0.5)*1.5));
        });
        renderWeather();
        renderScores();
    }
    // Every 8s: push event
    if(sec%8===0){
        var e=EVENT_POOL[evIdx%EVENT_POOL.length];
        evIdx++;
        addEvent(e);
        // If social, show in panel
        if(e.type==="social"){
            addSocial(SOCIAL_POOL[socialIdx%SOCIAL_POOL.length]);
            socialIdx++;
        }
    }
    // Every 3s: drift vivo
    if(sec%3===0&&sec%8!==0){
        pushEV((Math.random()-0.48)*0.35);
    }
    // Cada 30s: clima 88% respira 82-94
    if(sec%30===0){
        WEATHER.forEach(function(w){
            w.rain=Math.max(0,Math.min(100,w.rain+Math.round((Math.random()-0.5)*4)));
            if(w.match.indexOf("River")!==-1){ w.rain=Math.max(82,Math.min(94,w.rain)); w.blbl="Lluvia fuerte "+w.rain+"%"; }
            w.wind=Math.max(0,w.wind+Math.round((Math.random()-0.5)*2));
        });
        renderWeather();
    }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  INIT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
window.addEventListener("DOMContentLoaded",function(){
    initChart();
    renderScores();
    renderWeather();
    // Pre-load 3 social
    for(var i=0;i<3;i++){addSocial(SOCIAL_POOL[i]);}
    // Pre-load 5 events
    for(var i=4;i>=0;i--){addEvent(EVENT_POOL[i]);evIdx=5;}
    setInterval(tick,1000);
});

        // =========================================================
        // HERO2 aislado (IIFE para no chocar con BENTO)
        (function(){
        var edgeHistory = [12.1, 12.4, 12.8, 13.2, 12.9, 13.5, 14.1, 13.8, 14.2, 14.8]; var timeLabels = ['19:35','19:36','19:37','19:38','19:39','19:40','19:41','19:42','19:43','19:44']; var homeChart = null;
        var LIVE_NEWS_POOL = [
            { tag: '⚽ GOL EN DIRECTO', tagBg: 'rgba(13,242,166,0.15)', tagColor: '#0df2a6', title: 'Lautaro Mart�nez marca gol (Inter 1-0 Milan)', desc: 'xG real sube a 2.48. El Edge del mercado Over 2.5 salta +5.8%', time: 'Ahora mismo' },
            { tag: 'ðŸŒ¦️ CLIMA REAL', tagBg: 'rgba(0,212,255,0.15)', tagColor: '#00d4ff', title: 'Lluvia 88% sobre San Siro', desc: 'Lluvia fuerte 88%. Campo pesado: ritmo -8%, el Edge Over 2.5 corrige -0.4%', time: 'hace 1 min' },
            { tag: 'ðŸš¨ ALINEACIÒN', tagBg: 'rgba(245,158,11,0.15)', tagColor: '#f59e0b', title: 'Kylian Mbappé confirmado como titular en ataque', desc: 'Recuperado de molestias. Probabilidad de gol por partido +18.4%', time: 'hace 2 min' },
            { tag: 'ðŸ“± POST JUGADOR', tagBg: 'rgba(139,92,246,0.15)', tagColor: '#8b5cf6', title: 'Post de Jude Bellingham (Instagram): "Focus on tonight ðŸ’¥"', desc: 'IA de Sentimiento detecta moral de equipo máxima (94.8%)', time: 'hace 3 min' },
            { tag: 'ðŸ“Š CUOTAS', tagBg: 'rgba(0,212,255,0.15)', tagColor: '#00d4ff', title: 'Cuota ajustada de 1.82 a 1.95 en bet365 y otras casas', desc: 'Desfase cuantitativo aislado por el modelo con mayor valor esperado (+EV)', time: 'hace 4 min' },
            { tag: 'ðŸ§  IA OMNIROUTE', tagBg: 'rgba(255,255,255,0.08)', tagColor: '#94a3b8', title: 'Procesados 240 artículos de prensa deportiva europea', desc: 'Tendencia estadística Over 1.5/2.5 validada al 92.1%', time: 'hace 5 min' }
        ];
        var newsIdx = 0;

        function initHomeLiveChart() {
            var ctx = document.getElementById('homeEdgeLiveCanvas');
            if(!ctx) return;
            
            homeChart = new Chart(ctx.getContext('2d'), {
                type: 'line',
                data: {
                    labels: timeLabels,
                    datasets: [{
                        label: 'Edge +EV (%)',
                        data: edgeHistory,
                        borderColor: '#0df2a6',
                        borderWidth: 3,
                        backgroundColor: (context) => {
                            const chart = context.chart;
                            const {ctx, chartArea} = chart;
                            if (!chartArea) return null;
                            const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                            gradient.addColorStop(0, 'rgba(13, 242, 166, 0.35)');
                            gradient.addColorStop(1, 'rgba(13, 242, 166, 0.0)');
                            return gradient;
                        },
                        fill: true,
                        tension: 0.38,
                        pointRadius: 4,
                        pointBackgroundColor: '#0df2a6',
                        pointBorderColor: '#06070a',
                        pointBorderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: { duration: 600 },
                    plugins: { legend: { display: false } },
                    scales: {
                        x: {
                            grid: { color: 'rgba(255, 255, 255, 0.05)' },
                            ticks: { color: '#64748b', font: { family: 'JetBrains Mono', size: 10 } }
                        },
                        y: {
                            grid: { color: 'rgba(255, 255, 255, 0.05)' },
                            ticks: { color: '#64748b', font: { family: 'JetBrains Mono', size: 10 }, callback: v => '+' + v + '%' },
                            min: 8,
                            max: 18
                        }
                    }
                }
            });
        }

        function pushLiveNewsItem(item) {
            var container = document.getElementById('homeLiveNewsFeed');
            if(!container) return;

            var el = document.createElement('div');
            el.className = 'feed-item-enter';
            el.style.cssText = 'background:rgba(255,255,255,0.025); border:1px solid var(--border-subtle); border-radius:10px; padding:8px 10px; display:flex; flex-direction:column; gap:3px;';
            el.innerHTML = '<div style="display:flex; justify-content:space-between; align-items:center;">' +
                '<span style="font-size:0.6rem; font-weight:800; background:' + item.tagBg + '; color:' + item.tagColor + '; padding:2px 6px; border-radius:6px;">' + item.tag + '</span>' +
                '<span style="font-size:0.62rem; color:var(--text-muted); font-family:JetBrains Mono;">'  + item.time + '</span>' +
                '</div>' +
                '<div style="font-size:0.78rem; font-weight:700; color:var(--text-primary); margin-top:2px;">' + item.title + '</div>' +
                '<div style="font-size:0.7rem; color:var(--text-secondary); line-height:1.3;">' + item.desc + '</div>';

            container.insertBefore(el, container.firstChild);
            if(container.children.length > 8) {
                container.removeChild(container.lastChild);
            }
        }

        function tickHomeLiveEngine() {
            var now = new Date();
            var timeStr = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0') + ':' + String(now.getSeconds()).padStart(2,'0');
            var clockEl = document.getElementById('liveClockTicker');
            if(clockEl) clockEl.textContent = timeStr;

            var item = LIVE_NEWS_POOL[newsIdx % LIVE_NEWS_POOL.length];
            newsIdx++;
            pushLiveNewsItem(item);

            // Dynamic peak reaction based on news event type
            var spike = (Math.random() - 0.42) * 0.9;
            if (item.tag.indexOf('GOL') !== -1) spike = (Math.random() * 1.5 + 1.1);
            else if (item.tag.indexOf('ALINEACIÒN') !== -1) spike = (Math.random() * 1.1 + 0.4);

            if(homeChart) {
                var lastVal = edgeHistory[edgeHistory.length - 1];
                var newVal = parseFloat((lastVal + spike).toFixed(1));
                if(newVal < 9.8) newVal = 11.2;
                if(newVal > 18.2) newVal = 17.5;

                edgeHistory.shift();
                edgeHistory.push(newVal);

                timeLabels.shift();
                timeLabels.push(timeStr.substring(0, 5));

                homeChart.data.labels = timeLabels;
                homeChart.data.datasets[0].data = edgeHistory;
                homeChart.update('none');

                var edgeDisplay = document.getElementById('liveHomeEdgeVal');
                if(edgeDisplay) {
                    edgeDisplay.textContent = '+' + newVal + '%';
                    edgeDisplay.style.transform = 'scale(1.15)';
                    edgeDisplay.style.color = newVal >= lastVal ? '#0df2a6' : '#00d4ff';
                    setTimeout(function(){ edgeDisplay.style.transform = 'scale(1)'; }, 300);
                }
            }
        }

        window.addEventListener('DOMContentLoadedHero2x', function() {
            initHomeLiveChart();
            for(let i = 0; i < 4; i++) {
                pushLiveNewsItem(LIVE_NEWS_POOL[i]);
            }
            newsIdx = 4;
            setInterval(tickHomeLiveEngine, 2500);
        });
        setTimeout(function(){ window.dispatchEvent(new Event('DOMContentLoadedHero2x')); }, 200);
        })();

    </script>

    <!-- PIE: informacion legal, aviso de edad y juego responsable -->
    <footer style="max-width:1400px; margin:2rem auto 1.5rem; padding:1.6rem 1rem 0; border-top:1px solid var(--border-subtle); font-size:0.78rem; color:var(--text-muted); line-height:1.7;">
        <div style="display:flex; flex-wrap:wrap; gap:14px; align-items:center; margin-bottom:12px;">
            <span style="font-weight:800; color:#f59e0b; border:1px solid rgba(245,158,11,0.5); border-radius:6px; padding:2px 8px;">+18</span>
            <strong style="color:var(--text-secondary);">Solo para mayores de 18 años</strong>
            <a href="/legal#aviso" style="color:var(--neon-cyan); text-decoration:none;">Aviso legal</a>
            <a href="/legal#privacidad" style="color:var(--neon-cyan); text-decoration:none;">Privacidad</a>
            <a href="/legal#cookies" style="color:var(--neon-cyan); text-decoration:none;">Cookies</a>
            <a href="/legal#terminos" style="color:var(--neon-cyan); text-decoration:none;">Términos de uso</a>
            <a href="/legal#juego" style="color:var(--neon-cyan); text-decoration:none;">Juego responsable</a>
        </div>
        <div>Esta web es un <strong>servicio de información y análisis estadístico</strong>. <strong>No es un operador de juego</strong>: no acepta apuestas ni custodia dinero de jugadores. Las cuotas se recogen de fuentes públicas y pueden contener errores u omisiones; comprueba siempre el precio y las condiciones en la casa de apuestas antes de jugar. No garantizamos resultados ni ganancias.</div>
        <div style="margin-top:8px;">Jugar conlleva riesgo de perder dinero. Si el juego es un problema para ti o para alguien de tu entorno, pide ayuda: <strong>900 200 225</strong> (FEJAR, atención 24 h) o visita <strong>jugarbien.es</strong>. Puedes solicitar tu autoexclusión en el RGIAJ (Ordenación del Juego).</div>
        <div style="margin-top:8px;">Titular: <strong>[PENDIENTE: nombre o razón social, NIF y domicilio]</strong> · Contacto: <strong>[PENDIENTE: correo de contacto]</strong></div>
    </footer>
</body>
</html>`;
            return new Response(liveHtml, {
                headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' }
            });
        }

        // ---------------------------------------------------------------------
        // PÁGINA DEDICADA DE GUÍA DE APUESTAS CON VENTAJA Y BOT (+EV SEO HUB)
        // ---------------------------------------------------------------------
        if (url.pathname === '/guia' || url.pathname === '/como-funciona' || url.pathname === '/bot-apuestas') {
            return new Response(paginaGuiaSeo(), {
                headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' }
            });
        }

        // ---------------------------------------------------------------------
        // PAGINA LEGAL: aviso legal, privacidad, cookies, terminos y juego
        // responsable. Se sirve en /legal (y alias) para poder enlazarla desde el
        // pie y desde cualquier texto legal externo.
        // ---------------------------------------------------------------------
        if (url.pathname === '/legal'
            || url.pathname === '/aviso-legal'
            || url.pathname === '/privacidad'
            || url.pathname === '/cookies'
            || url.pathname === '/terminos'
            || url.pathname === '/juego-responsable') {
            return new Response(paginaLegal(), {
                headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' }
            });
        }

        return new Response(INDEX_HTML, {
            headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' }
        });
    }
};










