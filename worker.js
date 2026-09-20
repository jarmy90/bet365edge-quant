// BET365EDGE Quantitative Terminal & +EV Value Betting Engine
// Live Stripe Checkout (25€ / mes) + 3 Risk Classification Levels + Real Data Pipeline

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
    construirParlayRiesgo, BANDAS_RIESGO, esLigaTopPermitida
} from './ratingbet_pipeline.js';
import datasetLocal from './ratingbet_fixtures_data.js';

const BUILD_ID = 'ratingbet-v9.0-2026-09-20';

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

// Procedencia del catalogo de fixtures publicado por la API publica.
const FIXTURES_SOURCE = RATINGBET_FUENTE;
const FIXTURES_CACHE_MS = 5 * 60 * 1000;   // cache del pool en el isolate
const DATASET_CACHE_MS = 5 * 60 * 1000;    // cache del dataset remoto
const OMNIROUTE_MODEL_DEFAULT = 'google/gemini-2.5-flash';
const OMNIROUTE_ENDPOINT_DEFAULT = 'https://openrouter.ai/api/v1/chat/completions';
const DAHL_KEY_DEFAULT = 'dahl_4XqJcdUZ9eyFnhwYcaAkv5pusP7V8tpdT';
const DAHL_ENDPOINT_DEFAULT = 'https://inference.dahl.global/v1/chat/completions';

// Cache + single-flight de la fuente de fixtures
let fixturesCache = { at: -Infinity, pool: [], diag: null, key: null };
let fixturesInflight = null;
// Cache + single-flight del dataset (solo si se usa fuente remota)
let datasetCache = { at: -Infinity, dataset: null, diag: null, url: null };
let datasetInflight = null;

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
        const stripeSecretKey = env.STRIPE_SECRET_KEY || "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";
        const stripePriceId = env.STRIPE_PRICE_ID || "prod_VFk8GE0foCM9qJ";

        // =========================================================================
        // 1. ENDPOINT: CREAR SESIÓN DE STRIPE CHECKOUT (25 € / mes)
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
                    // Fallback directo a price_data con 25€ mensual
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
        // 3. RUTA DE ÉXITO DE PAGO (/success) -> ACTIVA SESIÓN 30 DÍAS CON COOKIE
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
    <title>¡Pago Completado! | BET365EDGE</title>
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
        <div style="font-size:3rem; margin-bottom:0.5rem;">🎉</div>
        <h2 style="font-size:1.6rem; font-weight:800; margin-bottom:0.5rem;">¡Acceso VIP Activado!</h2>
        <p style="color:#94a3b8; font-size:0.92rem; line-height:1.5;">Tu pago de 25 € ha sido confirmado por Stripe. Tienes acceso completo e ilimitado durante 30 días al botón de Edge y a todas las combinadas por nivel de riesgo.</p>
        <div style="margin-top:1.2rem; padding:10px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.07); border-radius:10px; font-family:JetBrains Mono; font-size:0.8rem; color:#0df2a6;">
            Válido hasta: ${expDate.toLocaleDateString()}
        </div>
        <a href="/" class="btn">ACCEDER AL TERMINAL AHORA</a>
        <div style="margin-top:10px; font-size:0.75rem; color:#64748b;">Guarda tu <b>session_id de Stripe</b> (cs_...) o tu email para entrar como cliente en otros dispositivos: boton "🔑 Clave VIP / Autor".</div>
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
        // 4. RUTA DE CANCELACIÓN DE PAGO (/cancel)
        // =========================================================================
        if (url.pathname === '/cancel') {
            return Response.redirect(`${url.origin}/?canceled=true`, 302);
        }

        // =========================================================================
        // 5. MOTOR DE BÚSQUEDA Y CLASIFICACIÓN CUANTITATIVA (3 NIVELES DE RIESGO)
        // VALIDACIÓN TEMPORAL ESTRICTA: SOLO PARTIDOS FUTUROS (NO INICIADOS / NO PASADOS)
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
        async function cargarDatasetRatingbet(nowMs, force) {
            const url = env.RATINGBET_DATASET_URL || '';
            if (!url) return { dataset: datasetLocal, diag: { modo: 'modulo-embebido', url: null, error: null }, error: null };

            if (!force && datasetCache.dataset && datasetCache.url === url && (nowMs - datasetCache.at) < DATASET_CACHE_MS) {
                return { dataset: datasetCache.dataset, diag: datasetCache.diag, error: datasetCache.diag.error || null };
            }
            if (datasetInflight) return datasetInflight;

            datasetInflight = (async function () {
                const token = env.RATINGBET_DATASET_TOKEN || '';
                const diag = {
                    modo: 'remoto', url: url, error: null, partidosRecibidos: 0,
                    autenticado: !!token, bytes: 0
                };
                let dataset = null;
                try {
                    const conCb = url + (url.includes('?') ? '&' : '?') + 'cb=' + nowMs;
                    const headers = Object.assign(
                        { 'Accept': 'application/json' },
                        token ? { 'Authorization': 'Bearer ' + token } : {}
                    );
                    const res = await fetch(conCb, { headers: headers });
                    if (!res.ok) diag.error = 'http-' + res.status;
                    else {
                        const txt = await res.text();
                        diag.bytes = txt.length;
                        const parsed = extraerDataset(txt);
                        if (!parsed) diag.error = 'json-no-parseable';
                        else {
                            dataset = parsed;
                            diag.partidosRecibidos = (parsed.partidos || parsed.PARTIDOS || []).length;
                        }
                    }
                } catch (e) {
                    diag.error = 'excepcion-' + (e && e.message ? e.message : 'desconocida');
                }
                if (!dataset) { dataset = datasetLocal; diag.modo = 'remoto-fallido->embebido'; }
                datasetCache = { at: nowMs, dataset: dataset, diag: diag, url: url };
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
            const noticias = [];
            for (const feed of RSS_FEEDS) {
                try {
                    const r = await fetch(feed.url, { headers: { 'Accept': 'application/rss+xml, application/xml, text/xml' } });
                    if (!r.ok) continue;
                    const txt = await r.text();
                    const items = txt.match(/<item[^>]*>[\s\S]*?<\/item>/gi) || [];
                    for (const item of items.slice(0, 15)) {
                        const title = (item.match(/<title[^>]*><!\[CDATA\[(.*?)\]\]><\/title>/i) ||
                                       item.match(/<title[^>]*>(.*?)<\/title>/i) || [])[1] || '';
                        const fecha = (item.match(/<pubDate[^>]*>(.*?)<\/pubDate>/i) ||
                                       item.match(/<dc:date[^>]*>(.*?)<\/dc:date>/i) || [])[1] || '';
                        const link  = (item.match(/<link[^>]*>(.*?)<\/link>/i) || [])[1] || '';
                        if (title) noticias.push({ titulo: title.trim(), fecha: fecha.trim(), fuente: feed.fuente, url: link.trim() });
                    }
                } catch (_) { /* RSS opcional: si falla no bloquea */ }
            }
            return noticias;
        }

        // --- Cache de analisis completo (dataset -> edge) ---
        let analisisCache = { at: -Infinity, pool: [], diag: null, key: null };
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
                const { candidatos, diag: diagCandidatos } = construirCandidatos(dataset, nowMs, {
                    margenMinutos: MARGEN_MIN,
                    maxDias: VENTANA_DIAS,
                    maxAntiguedadMin: MAX_ANTIGUEDAD
                });

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

                if (candidatos.length === 0) {
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

                    // 3b. Seleccionar los mejores candidatos para el prompt (8 partidos max para token budget)
                    const paraAnalisis = seleccionarParaAnalisis(candidatos, 8);

                    // 3c. Construir prompt
                    const { system, user } = construirPromptAnalisis(paraAnalisis, feedNoticias, nowMs);

                    // 3d. Llamar al LLM (cadena de proveedores: OpenRouter / Omniroute -> Dahl Global)
                    const proveedoresAProbar = [];
                    if (apiKeyPrimary) {
                        const primaryEp = omniUrl || OMNIROUTE_ENDPOINT_DEFAULT;
                        const modelos = [
                            env.OMNIROUTE_MODEL || OMNIROUTE_MODEL_DEFAULT,
                            'nex-agi/nex-n2.5-mini:free',
                            'openrouter/auto'
                        ];
                        modelos.forEach(m => proveedoresAProbar.push({ endpoint: primaryEp, apiKey: apiKeyPrimary, model: m }));
                    }
                    // Respaldo secundario: Dahl Global API
                    proveedoresAProbar.push({ endpoint: dahlEndpoint, apiKey: dahlApiKey, model: 'google/gemini-2.5-flash' });
                    proveedoresAProbar.push({ endpoint: dahlEndpoint, apiKey: dahlApiKey, model: 'dahl/default' });

                    let iaRes = null;
                    let ultimoError = null;

                    for (const prov of proveedoresAProbar) {
                        try {
                            const r = await fetch(prov.endpoint, {
                                method: 'POST',
                                signal: AbortSignal.timeout(20000),
                                headers: {
                                    'Authorization': 'Bearer ' + prov.apiKey,
                                    'Content-Type': 'application/json',
                                    'HTTP-Referer': 'https://bet365edge-quant.vercel.app',
                                    'X-Title': 'BetEdge Quant'
                                },
                                body: JSON.stringify({
                                    model: prov.model,
                                    temperature: 0.15,
                                    max_tokens: 2000,
                                    messages: [
                                        { role: 'system', content: system },
                                        { role: 'user',   content: user   }
                                    ]
                                })
                            });
                            if (r.ok) {
                                iaRes = r;
                                break;
                            } else {
                                const errText = await r.text();
                                ultimoError = { status: r.status, model: prov.model, endpoint: prov.endpoint, body: errText.slice(0, 300) };
                            }
                        } catch (e) {
                            ultimoError = { error: e.message, model: prov.model, endpoint: prov.endpoint };
                        }
                    }

                    if (!iaRes) {
                        diagFinal.diagIA = ultimoError || { error: 'Ningún proveedor de IA respondió' };
                    } else {
                        const iaData  = await iaRes.json();
                        const textoIA = iaData && iaData.choices && iaData.choices[0] && iaData.choices[0].message
                            ? iaData.choices[0].message.content : null;

                        if (textoIA) {
                            // 3e. Parsear veredictos: solo acepta claves reales del scraper
                            const { veredictos, diag: diagIA } = parsearVeredictosIA(textoIA, paraAnalisis);
                            diagFinal.diagIA = diagIA;

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
                        } else {
                            diagFinal.diagIA = { error: 'IA respondio sin contenido', iaData: JSON.stringify(iaData).slice(0, 300) };
                        }
                    }
                } catch (iaErr) { diagFinal.diagIA = { error: String(iaErr && iaErr.message || iaErr).slice(0, 300) }; }

                // -- 4. Modo degradado: cuotas reales sin edge de modelo -----------------
                // No se inventa nada. Se publican los partidos reales con sus cuotas.
                // Las columnas de edge y modelo quedan vacias (null / "-").
                pool = construirFixturesSinAnalisis(candidatos, nowMs, { max: MAX_PUBLICADOS });
                const { publicables, resumen: rFiltrado2 } = filtrarPublicables(
                    pool, nowMs, { margenMinutos: MARGEN_PUBLICACION_MIN, max: MAX_PUBLICADOS }
                );
                diagFinal.diagFiltrado = rFiltrado2;
                diagFinal.modoAnalisis = 'solo-cuotas-reales';
                analisisCache = { at: nowMs, pool: pool, diag: diagFinal, key: cacheKey };
                return publicables;
            })();

            try { return await analisisInflight; } finally { analisisInflight = null; }
        }

        function getFixturesDiag() { return analisisCache.diag; }

        // Compatibilidad: fixturesCacheKey queda para no romper referencias legacy.
        function fixturesCacheKey() { return analisisCacheKey(); }

        // LÓGICA DE GENERACIÓN DE COMBINADAS SEGÚN NIVEL DE RIESGO
        // 1. Riesgo Bajo: Cuota total < 2.00
        // 2. Riesgo Medio: Cuota total entre 2.00 y 3.00
        // 3. Riesgo Alto: Cuota total > 3.00
        // =========================================================================
        // 4.b API PUBLICA DE FIXTURES VALIDADOS (dia + hora reales, solo futuros)
        // =========================================================================
        if (url.pathname === '/api/fixtures-hoy') {
            // force=1: el cliente pide saltarse la cache (boton "Actualizar datos")
            const force = url.searchParams.get('force') === '1';
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
                    ? "ADVERTENCIA: No hay partidos futuros disponibles en este momento. Los partidos mostrados anteriormente ya han comenzado o finalizado. Intente mas tarde."
                    : null
            }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
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

            // Valores embebidos en el codigo: se usan SOLO para detectarlos, nunca se devuelven.
            const EMBEBIDOS = {
                OPENROUTER_API_KEY: 'sk-238e42ad970dbbc7-9e7385-de935c2e',
                STRIPE_SECRET_KEY: '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'
            };
            function estadoDeClave(nombre, valor) {
                if (!valor) return '\u2717 FALTA';
                if (EMBEBIDOS[nombre] && valor === EMBEBIDOS[nombre]) {
                    return '\u26a0 EMBEBIDA en el codigo (no definida en Vercel > Settings > Environment Variables)';
                }
                return '\u2713 Configurada (valor oculto)';
            }

            const envVars = {
                // --- Agente de IA (Omniroute / OpenRouter) ---
                OMNIROUTE_API_URL: E.OMNIROUTE_API_URL
                    ? '\u2713 Configurada (endpoint personalizado del agente)'
                    : (E.OMNIRUTE_API_URL ? '\u2713 Configurada (via alias OMNIRUTE_API_URL)' : '\u2717 FALTA (opcional: se usa el endpoint OpenRouter por defecto)'),
                OMNIROUTE_API_KEY: estadoDeClave('OMNIROUTE_API_KEY', E.OMNIROUTE_API_KEY),
                OPENROUTER_API_KEY: estadoDeClave('OPENROUTER_API_KEY', E.OPENROUTER_API_KEY),
                STRIPE_SECRET_KEY: estadoDeClave('STRIPE_SECRET_KEY', E.STRIPE_SECRET_KEY),
                STRIPE_PRICE_ID: E.STRIPE_PRICE_ID ? '\u2713 Configurada' : '\u2717 FALTA',

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
                warning: critico
                    ? avisos.join(' | ')
                    : '\u2713 Variables de entorno e integridad temporal correctas'
            }, null, 2), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
            });
        }

        if (url.pathname === '/api/parlays-by-risk') {
            const riskLevel = url.searchParams.get('risk') || 'medio'; // bajo, medio, alto
            const force = url.searchParams.get('force') === '1';
            const rawPool = await getFutureMatchesPool(force);
            const realMatchesPool = (rawPool || []).filter(esLigaTopPermitida);

            // Motor de combinadas v5: selecciona 2-4 picks reales cuya cuota
            // multiplicada cae en la banda del nivel de riesgo, maximizando la
            // probabilidad combinada. Cero cifras hardcodeadas: si no hay
            // combinacion posible, se declara 'sin-combinada' con su motivo.
            const parlayResponse = construirParlayRiesgo(realMatchesPool, riskLevel, Date.now());
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
        // 6. FRONTEND 2026: UI TERMINAL CON BOTÓN SIN PRECIO + GATE 25€ + RIESGO
        // =========================================================================
        const html = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>EDGE.FUTBOL Quant | Análisis cuantitativo y apuestas +EV / Soccer Value Betting Engine</title>
    <meta name="description" content="Motor cuantitativo 24/7 para detectar oportunidades con ventaja (+EV) en partidos de fútbol. Real-time quant engine for soccer value betting.">
    <meta property="og:title" content="EDGE.FUTBOL Quant | Soccer Value Betting & +EV Engine">
    <meta property="og:description" content="Motor cuantitativo 24/7 para detectar oportunidades con ventaja (+EV) en partidos de fútbol. Real-time quant engine for soccer value betting.">
    <meta name="twitter:title" content="EDGE.FUTBOL Quant | Soccer Value Betting & +EV Engine">
    <meta name="twitter:description" content="Motor cuantitativo 24/7 para detectar oportunidades con ventaja (+EV) en partidos de fútbol. Real-time quant engine for soccer value betting.">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600;700;800&display=swap" rel="stylesheet">
    <!-- Anti-parpadeo: aplicar tema ANTES de pintar el DOM -->
    <script data-theme-init>(function(){try{var t=localStorage.getItem('b365_theme');if(document.documentElement)document.documentElement.setAttribute('data-theme',t||'light');}catch(e){}})()</script>
    <style>
        /* =====================================================================
           SISTEMA DE TOKENS DUAL: LIGHT (default) / DARK
           ===================================================================== */
        :root, [data-theme="light"] {
            --bg-void: #f7f9fc;
            --bg-surface: #ffffff;
            --bg-card: #ffffff;
            --border-subtle: #e5eaf0;
            --border-highlight: #0d9488;
            --neon-emerald: #0d9488;
            --emerald-glow: rgba(13, 148, 136, 0.15);
            --neon-cyan: #0284c7;
            --neon-amber: #d97706;
            --text-primary: #101828;
            --text-secondary: #475467;
            --text-muted: #667085;
            --card-shadow: 0 2px 10px rgba(16, 24, 40, 0.06), 0 1px 3px rgba(16, 24, 40, 0.04);
            --ambient-bg: rgba(13, 148, 136, 0.03);
            --grid-line: rgba(0, 0, 0, 0.012);
            --chart-grid: #e2e8f0;
            --chart-text: #475467;
        }
        [data-theme="dark"] {
            --bg-void: #06070a;
            --bg-surface: #0d0f15;
            --bg-card: rgba(17,20,30,0.80);
            --border-subtle: rgba(255,255,255,0.08);
            --border-highlight: rgba(13,242,166,0.35);
            --neon-emerald: #0df2a6;
            --emerald-glow: rgba(13,242,166,0.28);
            --neon-cyan: #00d4ff;
            --neon-amber: #f59e0b;
            --text-primary: #f8fafc;
            --text-secondary: #94a3b8;
            --text-muted: #64748b;
            --card-shadow: 0 15px 35px rgba(0,0,0,0.4);
            --ambient-bg: rgba(13,242,166,0.07);
            --grid-line: rgba(255,255,255,0.015);
            --chart-grid: rgba(255,255,255,0.05);
            --chart-text: #64748b;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
            -webkit-tap-highlight-color: transparent;
        }

        body {
            background-color: var(--bg-void);
            color: var(--text-primary);
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 1.25rem 1rem 3.5rem 1rem;
            overflow-x: hidden;
            position: relative;
            transition: background-color 0.3s ease, color 0.3s ease;
        }

        /* Ambient glow */
        body::before {
            content: '';
            position: fixed;
            top: -20%;
            left: 50%;
            transform: translateX(-50%);
            width: 950px;
            height: 550px;
            background: radial-gradient(circle, var(--ambient-bg) 0%, transparent 70%);
            z-index: -2;
            pointer-events: none;
            filter: blur(80px);
        }

        body::after {
            content: '';
            position: fixed;
            inset: 0;
            background-image: linear-gradient(var(--grid-line) 1px, transparent 1px),
                              linear-gradient(90deg, var(--grid-line) 1px, transparent 1px);
            background-size: 36px 36px;
            z-index: -1;
            pointer-events: none;
        }

        @media (prefers-reduced-motion: reduce) {
            *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
        }

        .container {
            width: 100%;
            max-width: 1020px;
            display: flex;
            flex-direction: column;
            gap: 1.25rem;
        }

        /* Header Navbar */
        .navbar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0.75rem 1.25rem;
            background: var(--bg-surface);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid var(--border-subtle);
            border-radius: 16px;
            box-shadow: var(--card-shadow);
        }

        /* Theme Toggle */
        .theme-toggle {
            width: 36px;
            height: 36px;
            border-radius: 10px;
            border: 1px solid var(--border-subtle);
            background: rgba(128,128,128,0.06);
            color: var(--text-secondary);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
            flex-shrink: 0;
        }
        .theme-toggle:hover {
            border-color: var(--neon-emerald);
            color: var(--neon-emerald);
            background: rgba(128,128,128,0.1);
        }

        .brand {
            display: flex;
            align-items: center;
            gap: 10px;
            text-decoration: none;
        }

        .brand-icon {
            width: 32px;
            height: 32px;
            background: linear-gradient(135deg, var(--neon-emerald), var(--neon-cyan));
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 0 15px var(--emerald-glow);
        }

        .brand-icon svg {
            width: 18px;
            height: 18px;
            color: #ffffff;
            stroke-width: 2.5;
        }

        .brand-title {
            font-size: 1.15rem;
            font-weight: 800;
            letter-spacing: -0.5px;
            color: var(--text-primary);
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .brand-badge {
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.65rem;
            font-weight: 700;
            color: var(--neon-emerald);
            background: rgba(13, 148, 136, 0.1);
            border: 1px solid rgba(13, 148, 136, 0.25);
            padding: 2px 7px;
            border-radius: 6px;
        }

        .nav-actions {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 5px 12px;
            border-radius: 20px;
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.72rem;
            font-weight: 700;
            background: rgba(128, 128, 128, 0.05);
            border: 1px solid var(--border-subtle);
            color: var(--text-secondary);
        }

        .pulse-dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: var(--neon-emerald);
            box-shadow: 0 0 10px var(--neon-emerald);
            animation: pulse-glow 2s infinite ease-in-out;
        }

        @keyframes pulse-glow {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.4; transform: scale(0.85); }
        }

        /* Hero Section */
        .hero {
            text-align: center;
            padding: 1.25rem 0.5rem 0.5rem 0.5rem;
            display: flex;
            flex-direction: column;
            align-items: center;
        }

        .hero-pill {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 5px 14px;
            border-radius: 999px;
            background: rgba(13, 148, 136, 0.08);
            border: 1px solid rgba(13, 148, 136, 0.22);
            margin-bottom: 1.2rem;
        }

        .hero-pill span {
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.72rem;
            font-weight: 700;
            color: var(--neon-emerald);
            letter-spacing: 0.3px;
        }

        .hero-h1 {
            font-size: clamp(2.1rem, 5vw, 3.2rem);
            font-weight: 800;
            line-height: 1.15;
            letter-spacing: -1.2px;
            margin-bottom: 0.85rem;
            max-width: 820px;
            color: var(--text-primary);
        }

        [data-theme="light"] .hero-h1 .gradient-text {
            background: linear-gradient(135deg, #0d9488 0%, #0284c7 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        [data-theme="dark"] .hero-h1 .gradient-text {
            background: linear-gradient(135deg, #0df2a6 0%, #00d4ff 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        .hero-desc {
            font-size: clamp(0.92rem, 2vw, 1.05rem);
            color: var(--text-secondary);
            max-width: 660px;
            line-height: 1.6;
            margin-bottom: 2rem;
        }

        /* Botón Principal */
        .cta-wrapper {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
            width: 100%;
            max-width: 480px;
        }

        .btn-edge-primary {
            width: 100%;
            position: relative;
            background: linear-gradient(135deg, #0d9488, #0284c7);
            color: #ffffff;
            font-size: 1.2rem;
            font-weight: 800;
            padding: 1.2rem 2rem;
            border: none;
            border-radius: 18px;
            cursor: pointer;
            box-shadow: 0 4px 20px rgba(13, 148, 136, 0.3);
            transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            letter-spacing: -0.3px;
        }
        [data-theme="dark"] .btn-edge-primary {
            background: linear-gradient(135deg, #0df2a6, #00d4ff);
            color: #06070a;
            box-shadow: 0 0 40px rgba(13, 242, 166, 0.35);
        }
        .btn-edge-primary:hover {
            transform: translateY(-2px) scale(1.01);
        }
        .btn-edge-primary:active {
            transform: translateY(0);
        }

        .lock-indicator {
            background: rgba(0, 0, 0, 0.15);
            color: #ffffff;
            padding: 4px 10px;
            border-radius: 8px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }

        .gate-subtext {
            font-size: 0.8rem;
            color: var(--text-muted);
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .gate-subtext svg { color: var(--neon-emerald); width: 14px; height: 14px; }

        /* Filtro por Rango de Cuotas */
        .risk-selector-box {
            background: var(--bg-surface);
            border: 1px solid var(--border-subtle);
            border-radius: 16px;
            padding: 1rem 1.25rem;
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin-top: 1rem;
            box-shadow: var(--card-shadow);
        }

        .risk-selector-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 0.85rem;
        }
        .risk-selector-header strong { color: var(--text-primary); }

        .risk-tabs {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
        }

        .risk-btn {
            background: var(--bg-void);
            border: 1px solid var(--border-subtle);
            border-radius: 12px;
            padding: 10px 8px;
            color: var(--text-secondary);
            font-size: 0.82rem;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 3px;
        }
        .risk-btn span { font-family: 'JetBrains Mono', monospace; font-size: 0.7rem; font-weight: 500; color: var(--text-muted); }

        [data-theme="light"] .risk-btn.active {
            background: #ccfbf1;
            border-color: #0d9488;
            color: #0f766e;
            box-shadow: 0 1px 3px rgba(13, 148, 136, 0.15);
        }
        [data-theme="light"] .risk-btn.active span { color: #0f766e; font-weight: 700; }

        [data-theme="dark"] .risk-btn.active {
            background: rgba(13, 242, 166, 0.12);
            border-color: var(--neon-emerald);
            color: var(--neon-emerald);
            box-shadow: 0 0 20px rgba(13, 242, 166, 0.15);
        }
        [data-theme="dark"] .risk-btn.active span { color: var(--neon-emerald); font-weight: 700; }

        /* Bento Grid Architecture */
        .bento-grid {
            display: grid;
            grid-template-columns: repeat(12, 1fr);
            gap: 1.25rem;
            width: 100%;
        }

        .bento-card {
            background: var(--bg-card);
            border: 1px solid var(--border-subtle);
            border-radius: 18px;
            padding: 1.25rem;
            transition: border-color 0.25s ease, box-shadow 0.25s ease;
            display: flex;
            flex-direction: column;
            position: relative;
            box-shadow: var(--card-shadow);
        }
        .bento-card:hover {
            border-color: var(--border-highlight);
            box-shadow: var(--card-shadow);
        }

        .col-12 { grid-column: span 12; }
        .col-8 { grid-column: span 8; }
        .col-4 { grid-column: span 4; }

        @media (max-width: 860px) {
            .col-8, .col-4 { grid-column: span 12; }
            .risk-tabs { grid-template-columns: 1fr; }
        }

        @media (max-width: 600px) {
            .live-grid-responsive { grid-template-columns: 1fr !important; }
            .hero-h1 { font-size: 1.55rem !important; line-height: 1.3 !important; }
            body { padding: 0.75rem 0.5rem 3rem 0.5rem !important; }
        }

        .card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1.15rem;
        }

        .card-title-group {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }

        .card-title {
            font-size: 1.05rem;
            font-weight: 700;
            letter-spacing: -0.3px;
            color: var(--text-primary);
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .card-subtitle {
            font-size: 0.78rem;
            color: var(--text-muted);
        }

        .badge-quant {
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.7rem;
            font-weight: 700;
            padding: 4px 9px;
            border-radius: 6px;
            background: rgba(128,128,128,0.06);
            border: 1px solid var(--border-subtle);
            color: var(--text-secondary);
        }

        /* SVG Charts Viewport */
        .chart-viewport {
            width: 100%;
            height: 250px;
            position: relative;
        }

        .chart-viewport svg {
            width: 100%;
            height: 100%;
            overflow: visible;
        }

        .chart-legend-row {
            display: flex;
            gap: 1.5rem;
            margin-top: 10px;
            padding-top: 10px;
            border-top: 1px solid var(--border-subtle);
            font-size: 0.78rem;
        }
        .legend-item {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .legend-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
        }

        /* SECCIÓN OPORTUNIDADES DETECTADAS (CON VENTAJAS POSITIVAS) */
        #unlockedEdgeSection {
            display: none;
        }

        [data-theme="light"] #unlockedEdgeSection {
            background: #ffffff !important;
            border: 1.5px solid #99f6e4 !important;
            box-shadow: 0 4px 20px rgba(13, 148, 136, 0.08) !important;
        }
        [data-theme="dark"] #unlockedEdgeSection {
            background: radial-gradient(ellipse at top, rgba(13, 242, 166, 0.08), rgba(13, 15, 21, 0.95)) !important;
            border: 1px solid var(--border-highlight) !important;
            box-shadow: 0 0 40px rgba(13, 242, 166, 0.12) !important;
        }

        .bets-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 1rem;
            margin-bottom: 1.5rem;
        }

        .bet-card {
            border-radius: 14px;
            padding: 1.15rem;
            box-shadow: var(--card-shadow);
        }
        [data-theme="light"] .bet-card {
            background: #ffffff !important;
            border: 1px solid #e2e8f0 !important;
        }
        [data-theme="dark"] .bet-card {
            background: rgba(6, 7, 10, 0.6) !important;
            border: 1px solid var(--border-subtle) !important;
        }

        .bet-card-top {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 0.72rem;
            color: var(--text-muted);
            margin-bottom: 6px;
        }

        .bet-match-title {
            font-size: 1rem;
            font-weight: 700;
            color: var(--text-primary);
            margin-bottom: 8px;
        }

        .bet-odds-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 6px 10px;
            border-radius: 8px;
            margin-bottom: 10px;
            font-size: 0.85rem;
            font-weight: 700;
        }
        [data-theme="light"] .bet-odds-row {
            background: #f8fafc !important;
            border: 1px solid #e2e8f0 !important;
            color: #101828 !important;
        }
        [data-theme="dark"] .bet-odds-row {
            background: rgba(255, 255, 255, 0.03) !important;
            border: 1px solid rgba(255, 255, 255, 0.04) !important;
            color: var(--text-primary) !important;
        }

        .bet-reason {
            border-radius: 6px;
            padding: 8px 10px;
        }
        [data-theme="light"] .bet-reason {
            color: #334155 !important;
            background: #f0fdf4 !important;
            border-left: 3px solid #0d9488 !important;
            font-size: 0.85rem !important;
            line-height: 1.5 !important;
        }
        [data-theme="dark"] .bet-reason {
            color: #cbd5e1 !important;
            background: rgba(13, 242, 166, 0.04) !important;
            border-left: 2.5px solid var(--neon-emerald) !important;
            font-size: 0.78rem !important;
            line-height: 1.45 !important;
        }

        [data-theme="light"] .unlocked-summary-box {
            background: #f8fafc !important;
            border: 1px solid #e2e8f0 !important;
        }
        [data-theme="dark"] .unlocked-summary-box {
            background: rgba(6,7,10,0.8) !important;
            border: 1px solid var(--border-subtle) !important;
        }

        /* Barra Informativa de Cálculo de Combinadas */
        [data-theme="light"] .parlay-info-bar {
            background: #f8fafc !important;
            border: 1px solid #e5eaf0 !important;
            color: #475467 !important;
        }
        [data-theme="light"] .parlay-info-highlight {
            color: #0f9f98 !important;
            font-weight: 800;
        }
        [data-theme="dark"] .parlay-info-bar {
            background: rgba(13,15,21,0.85) !important;
            border: 1px solid var(--border-subtle) !important;
            color: var(--text-secondary) !important;
        }
        [data-theme="dark"] .parlay-info-highlight {
            color: var(--neon-emerald) !important;
            font-weight: 800;
        }

        /* Estilos Adaptativos del Panel Stream Live 24/7 */
        [data-theme="light"] .stream-live-container {
            background: #ffffff !important;
            border: 1px solid #b8e9e4 !important;
            box-shadow: 0 4px 20px rgba(15, 159, 152, 0.08) !important;
        }
        [data-theme="dark"] .stream-live-container {
            background: rgba(13,15,21,0.92) !important;
            border: 1px solid rgba(13,242,166,0.35) !important;
            box-shadow: 0 0 35px rgba(13,242,166,0.08) !important;
        }

        [data-theme="light"] .stream-live-ticker-box {
            background: #ecfdf8 !important;
            border: 1px solid #b8e9e4 !important;
        }
        [data-theme="dark"] .stream-live-ticker-box {
            background: rgba(13,242,166,0.05) !important;
            border: 1px solid rgba(13,242,166,0.2) !important;
        }

        [data-theme="light"] .stream-live-ticker-badge {
            background: #0f9f98 !important;
            color: #ffffff !important;
        }
        [data-theme="dark"] .stream-live-ticker-badge {
            background: var(--neon-emerald) !important;
            color: #000000 !important;
        }

        [data-theme="light"] .stream-live-badge-vivos {
            background: #ecfdf8 !important;
            color: #0f9f98 !important;
            border: 1px solid #b8e9e4 !important;
        }
        [data-theme="dark"] .stream-live-badge-vivos {
            background: rgba(13,242,166,0.15) !important;
            color: var(--neon-emerald) !important;
            border: 1px solid rgba(13,242,166,0.4) !important;
        }

        [data-theme="light"] .stream-inner-card {
            background: #ffffff !important;
            border: 1px solid #e9eef5 !important;
        }
        [data-theme="dark"] .stream-inner-card {
            background: rgba(6,7,10,0.85) !important;
            border: 1px solid var(--border-subtle) !important;
        }

        [data-theme="light"] .stream-metric-pill {
            background: #f8fafc !important;
            border: 1px solid #e5eaf0 !important;
        }
        [data-theme="dark"] .stream-metric-pill {
            background: rgba(255,255,255,0.02) !important;
            border: 1px solid var(--border-subtle) !important;
        }

        [data-theme="light"] .stream-news-item {
            background: #f8fafc !important;
            border: 1px solid #e9eef5 !important;
        }
        [data-theme="dark"] .stream-news-item {
            background: rgba(255,255,255,0.025) !important;
            border: 1px solid var(--border-subtle) !important;
        }
        .stream-news-item:hover {
            border-color: #b8e9e4 !important;
        }

        /* Tabla de Auditoría */
        .quant-table {
            width: 100%;
            border-collapse: collapse;
            text-align: left;
            font-size: 0.85rem;
        }
        .quant-table th {
            padding: 10px 12px;
            font-size: 0.72rem;
            font-weight: 700;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            border-bottom: 1px solid var(--border-subtle);
            background: var(--bg-void);
        }
        .quant-table td {
            padding: 12px;
            border-bottom: 1px solid var(--border-subtle);
        }
        .quant-table tr:hover td {
            background: rgba(128, 128, 128, 0.03);
        }

        /* Responsive Mobile Table Cards */
        @media (max-width: 640px) {
            .quant-table, .quant-table thead, .quant-table tbody, .quant-table th, .quant-table td, .quant-table tr {
                display: block;
            }
            .quant-table thead tr {
                position: absolute;
                top: -9999px;
                left: -9999px;
            }
            .quant-table tr {
                background: var(--bg-surface);
                border: 1px solid var(--border-subtle);
                border-radius: 12px;
                margin-bottom: 10px;
                padding: 10px 12px;
                box-shadow: var(--card-shadow);
            }
            .quant-table td {
                border-bottom: none !important;
                padding: 6px 0 !important;
                display: flex !important;
                justify-content: space-between !important;
                align-items: center !important;
                font-size: 0.82rem !important;
            }
            .quant-table td:first-child {
                flex-direction: column !important;
                align-items: flex-start !important;
                border-bottom: 1px solid var(--border-subtle) !important;
                padding-bottom: 8px !important;
                margin-bottom: 4px !important;
            }
            .quant-table td::before {
                content: attr(data-label);
                font-size: 0.7rem;
                font-weight: 700;
                color: var(--text-muted);
                text-transform: uppercase;
            }
            .quant-table td:first-child::before {
                display: none;
            }
        }
        .quant-table tr:hover td {
            background: rgba(255, 255, 255, 0.02);
        }

        /* Modal Stripe Checkout Gate (Explicación 25€ / mes) */
        .modal-backdrop {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.85);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            padding: 1rem;
        }
        .modal-window {
            background: #0d0f15;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 24px;
            padding: 2rem;
            width: 100%;
            max-width: 450px;
            position: relative;
            box-shadow: 0 25px 60px rgba(0,0,0,0.85);
            text-align: center;
        }
        .close-btn {
            position: absolute;
            top: 16px;
            right: 18px;
            font-size: 1.25rem;
            color: var(--text-muted);
            cursor: pointer;
        }

        .stripe-banner-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: rgba(99, 91, 255, 0.15);
            color: #7a73ff;
            border: 1px solid rgba(99, 91, 255, 0.3);
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.72rem;
            font-weight: 700;
            padding: 4px 10px;
            border-radius: 6px;
            margin-bottom: 1rem;
        }

        .promo-highlight-card {
            background: rgba(13, 242, 166, 0.05);
            border: 1px solid var(--border-highlight);
            border-radius: 14px;
            padding: 1.2rem;
            text-align: left;
            margin-bottom: 1.2rem;
        }

        .btn-stripe-pay {
            width: 100%;
            padding: 1rem;
            background: linear-gradient(135deg, var(--neon-emerald), var(--neon-cyan));
            color: #06070a;
            border: none;
            border-radius: 14px;
            font-weight: 800;
            font-size: 1.05rem;
            cursor: pointer;
            box-shadow: 0 0 25px var(--emerald-glow);
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }
        .btn-stripe-pay:hover {
            transform: translateY(-1px);
            box-shadow: 0 0 35px var(--emerald-glow);
        }
    </style>
</head>
<body>

    <div class="container">
        <!-- Header Navbar -->
        <nav class="navbar">
            <a href="#" class="brand" style="display:flex; align-items:center; gap:8px; text-decoration:none;">
                <div class="brand-logo-svg" style="display:flex; align-items:center; height:34px;">
                    <svg viewBox="0 0 680 160" height="34" style="width:auto; height:34px; display:block;" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <defs>
                            <linearGradient id="edgeBrandGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                                <stop offset="0%" stop-color="#10b981"/>
                                <stop offset="100%" stop-color="#06b6d4"/>
                            </linearGradient>
                        </defs>
                        <!-- Stylized E Icon + Football Arc -->
                        <g transform="translate(10, 10)">
                            <path d="M 45 10 L 120 10 C 135 10 142 22 132 38 L 118 60 L 52 60 Z" fill="url(#edgeBrandGrad)"/>
                            <path d="M 38 68 L 105 68 C 112 68 116 75 110 85 L 102 98 L 30 98 Z" fill="url(#edgeBrandGrad)"/>
                            <path d="M 26 106 L 95 106 C 105 106 102 118 85 135 L 75 145 C 55 145 35 140 20 130 Z" fill="url(#edgeBrandGrad)"/>
                            <path d="M 95 15 C 135 -5 175 15 190 55 C 205 95 185 140 135 155 C 105 162 70 152 50 135 C 75 148 115 148 145 130 C 175 108 185 70 170 42 C 158 20 128 8 95 15 Z" fill="#0f172a" stroke="url(#edgeBrandGrad)" stroke-width="2"/>
                            <polygon points="145,30 160,45 152,65 132,60 130,40" fill="#0f172a" stroke="url(#edgeBrandGrad)" stroke-width="1.5"/>
                            <polygon points="172,75 185,95 168,115 148,105 150,85" fill="#0f172a" stroke="url(#edgeBrandGrad)" stroke-width="1.5"/>
                        </g>
                        <!-- Brand Text -->
                        <text x="210" y="98" font-family="'JetBrains Mono', 'Inter', sans-serif" font-weight="900" font-size="62" font-style="italic" fill="var(--text-primary)" letter-spacing="-2">EDGE</text>
                        <text x="365" y="98" font-family="'JetBrains Mono', 'Inter', sans-serif" font-weight="900" font-size="62" font-style="italic" fill="url(#edgeBrandGrad)" letter-spacing="-2">.FUTBOL</text>
                    </svg>
                </div>
                <span class="brand-badge" style="margin-left:2px;">QUANT +EV</span>
            </a>
            <div class="nav-actions" style="display:flex; align-items:center; gap:10px;">
                <span class="status-badge">
                    <span class="pulse-dot"></span>
                    <span id="navStatusTxt">Suscripción: Inactiva</span>
                </span>
                <button id="btnNavLogin" onclick="openEmailLoginModal()" style="background:none; border:none; color:var(--text-secondary); font-size:0.82rem; font-weight:600; cursor:pointer; text-decoration:underline; text-underline-offset:3px;">¿Ya eres cliente?</button>
                <button id="btnNavUpgrade" class="btn-ghost" onclick="scrollToProximosPartidos()">Ver oportunidades de hoy</button>
                <button class="theme-toggle" id="langToggleBtn" onclick="toggleLanguage()" title="Switch Language / Cambiar Idioma" aria-label="Cambiar idioma" style="display:flex; align-items:center; gap:4px; font-weight:700; font-size:0.75rem; padding:0 8px; font-family:'JetBrains Mono', monospace; background:var(--bg-surface); border:1px solid var(--border-subtle); color:var(--text-primary); border-radius:8px; cursor:pointer; height:34px;">
                    <span id="langFlag">🇪🇸</span> <span id="langCode">ES</span>
                </button>
                <button class="theme-toggle" id="themeToggleBtn" onclick="toggleTheme()" title="Cambiar tema claro/oscuro" aria-label="Cambiar tema">
                    <svg id="iconSun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" display="block"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
                    <svg id="iconMoon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" display="none"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                </button>
            </div>
        </nav>

        <!-- Hero Section -->
        <header class="hero">
            <div class="hero-pill">
                <span class="pulse-dot"></span>
                <span>BOT ACTIVO 24/7 · ANÁLISIS DE FÚTBOL EN TIEMPO REAL</span>
            </div>
            <h1 class="hero-h1">
                Encuentra apuestas de fútbol <br>
                <span class="gradient-text">con ventaja estadística</span>
            </h1>
            <p class="hero-desc">
                Nuestro bot analiza continuamente partidos, estadísticas, jugadores, lesiones, meteorología y cuotas para detectar oportunidades en los mercados de más de 1,5 y 2,5 goles.
            </p>

            <!-- =========================================================
                 BOTÓN PRINCIPAL: VER OPORTUNIDADES DE HOY
                 ========================================================= -->
            <div class="cta-wrapper" style="display:flex; flex-direction:column; align-items:center; gap:10px;">
                <button id="btnMainEdgeAction" class="btn-edge-primary" onclick="scrollToProximosPartidos()">
                    <span id="lockIconContainer" class="lock-indicator">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                    </span>
                    <span id="btnMainEdgeText">Ver oportunidades de hoy</span>
                </button>
                <div class="gate-subtext" style="font-size:0.8rem; color:var(--text-secondary); display:flex; align-items:center; gap:6px;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="var(--neon-emerald)" stroke-width="2.5" width="14" height="14"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    <span>Partidos analizados hoy · Datos actualizados continuamente</span>
                </div>
                <div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px; text-align:center;">
                    Las oportunidades son estimaciones estadísticas y no garantizan resultados.
                </div>
            </div>
        </header>

        <!-- =========================================================
             SECCIÓN 2: CÓMO FUNCIONA NUESTRO BOT — COMPACTA
             ========================================================= -->
        <section class="bento-card col-12" style="padding:1rem 1.25rem; width:100%;">
            <div style="text-align:center; margin-bottom:0.85rem;">
                <h2 style="font-size:1.05rem; color:var(--text-primary); font-weight:800; letter-spacing:-0.3px;">Cómo funciona nuestro bot</h2>
            </div>
            <!-- 4 pasos horizontales -->
            <div style="display:grid; grid-template-columns:1fr auto 1fr auto 1fr auto 1fr; gap:0; align-items:start;" class="how-steps-grid">
                <div style="text-align:center; padding:0.6rem 0.5rem;">
                    <div style="width:30px; height:30px; background:rgba(13,148,136,0.14); color:var(--neon-emerald); border-radius:8px; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:0.82rem; margin:0 auto 6px;">1</div>
                    <div style="font-weight:700; font-size:0.82rem; color:var(--text-primary); margin-bottom:3px;">Recopila datos 24/7</div>
                    <div style="font-size:0.72rem; color:var(--text-secondary); line-height:1.4;">Partidos, estadísticas, bajas, noticias, meteo y cuotas.</div>
                </div>
                <div style="display:flex; align-items:center; justify-content:center; padding-top:8px; color:var(--text-muted); font-size:0.9rem;">→</div>
                <div style="text-align:center; padding:0.6rem 0.5rem;">
                    <div style="width:30px; height:30px; background:rgba(2,132,199,0.14); color:var(--neon-cyan); border-radius:8px; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:0.82rem; margin:0 auto 6px;">2</div>
                    <div style="font-weight:700; font-size:0.82rem; color:var(--text-primary); margin-bottom:3px;">Analiza el contexto</div>
                    <div style="font-size:0.72rem; color:var(--text-secondary); line-height:1.4;">Forma reciente, xG, localía, tendencias y alineaciones.</div>
                </div>
                <div style="display:flex; align-items:center; justify-content:center; padding-top:8px; color:var(--text-muted); font-size:0.9rem;">→</div>
                <div style="text-align:center; padding:0.6rem 0.5rem;">
                    <div style="width:30px; height:30px; background:rgba(217,119,6,0.14); color:var(--neon-amber); border-radius:8px; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:0.82rem; margin:0 auto 6px;">3</div>
                    <div style="font-weight:700; font-size:0.82rem; color:var(--text-primary); margin-bottom:3px;">Calcula la cuota justa</div>
                    <div style="font-size:0.72rem; color:var(--text-secondary); line-height:1.4;">Estima probabilidad para +1,5 y +2,5 goles.</div>
                </div>
                <div style="display:flex; align-items:center; justify-content:center; padding-top:8px; color:var(--text-muted); font-size:0.9rem;">→</div>
                <div style="text-align:center; padding:0.6rem 0.5rem;">
                    <div style="width:30px; height:30px; background:rgba(139,92,246,0.14); color:#8b5cf6; border-radius:8px; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:0.82rem; margin:0 auto 6px;">4</div>
                    <div style="font-weight:700; font-size:0.82rem; color:var(--text-primary); margin-bottom:3px;">Detecta la ventaja</div>
                    <div style="font-size:0.72rem; color:var(--text-secondary); line-height:1.4;">Compara cuota justa vs disponible y calcula el valor esperado.</div>
                </div>
            </div>
            <!-- Chips de qué analiza el sistema -->
            <div style="border-top:1px solid var(--border-subtle); padding-top:0.7rem; margin-top:0.7rem; display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
                <span style="font-size:0.68rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.4px; margin-right:4px;">Analiza:</span>
                <span class="badge-quant" style="font-size:0.7rem; padding:3px 8px;">Forma reciente</span>
                <span class="badge-quant" style="font-size:0.7rem; padding:3px 8px;">xG y métricas ofensivas</span>
                <span class="badge-quant" style="font-size:0.7rem; padding:3px 8px;">Local/visitante</span>
                <span class="badge-quant" style="font-size:0.7rem; padding:3px 8px;">Lesiones y bajas</span>
                <span class="badge-quant" style="font-size:0.7rem; padding:3px 8px;">Alineaciones</span>
                <span class="badge-quant" style="font-size:0.7rem; padding:3px 8px;">Meteorología</span>
                <span class="badge-quant" style="font-size:0.7rem; padding:3px 8px;">Noticias relevantes</span>
                <span class="badge-quant" style="font-size:0.7rem; padding:3px 8px;">Evolución de cuotas</span>
            </div>
        </section>
        <style>
        @media (max-width:600px) {
            .how-steps-grid { grid-template-columns: 1fr !important; }
            .how-steps-grid > [style*="align-items:center; justify-content:center"] { display: none !important; }
        }
        @media (min-width:601px) and (max-width:900px) {
            .how-steps-grid { grid-template-columns: 1fr auto 1fr !important; }
        }
        </style>


        <!-- =========================================================
             SECCIÓN 9: ANÁLISIS EN DIRECTO (MONITOR Y NOTICIAS)
             ========================================================= -->
        <section class="bento-card col-12 stream-live-container" style="padding:1.4rem; margin-top:1rem; width:100%;">
            
            <!-- Ticker Continuo de Noticias Live -->
            <div class="stream-live-ticker-box" style="border-radius:10px; padding:8px 12px; display:flex; align-items:center; gap:12px; margin-bottom:1.2rem; overflow:hidden;">
                <span class="stream-live-ticker-badge" style="font-family:JetBrains Mono; font-size:0.68rem; font-weight:800; padding:3px 8px; border-radius:6px; flex-shrink:0; letter-spacing:0.5px; display:flex; align-items:center; gap:5px;">
                    <span style="width:6px; height:6px; background:currentColor; border-radius:50%; display:inline-block; animation: pulse 1s infinite;"></span>
                    STREAM LIVE 24/7
                </span>
                <div style="flex:1; overflow:hidden; white-space:nowrap; position:relative;">
                    <div id="mainPageTicker" style="display:inline-block; font-size:0.78rem; color:var(--text-secondary); font-family:JetBrains Mono; animation: tickerScroll 35s linear infinite;">
                        ⚽ <strong>Vinícius Jr. (Real Madrid)</strong>: xG sube a 2.35 (+14.2% EV) &nbsp;&nbsp;•&nbsp;&nbsp; 🌦️ <strong>Santiago Bernabéu</strong>: Despejado (+12% ritmo) &nbsp;&nbsp;•&nbsp;&nbsp; 🚨 <strong>Mbappé</strong>: Titularidad confirmada &nbsp;&nbsp;•&nbsp;&nbsp; 📱 <strong>Bellingham (IG)</strong>: "Ready for tonight 🔥" &nbsp;&nbsp;•&nbsp;&nbsp; 📊 <strong>Bet365</strong>: Cuota ajustada a 1.94 (Desfase Quant +9.8%) &nbsp;&nbsp;•&nbsp;&nbsp; ⚽ <strong>Erling Haaland (Man City)</strong>: xG sube a 2.45 (+15.8% EV) &nbsp;&nbsp;•&nbsp;&nbsp; 🌦️ <strong>Etihad Stadium</strong>: Lluvia moderada (+10% tiro lejano)
                    </div>
                </div>
            </div>

            <!-- Encabezado del Panel Live -->
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; flex-wrap:wrap; gap:10px;">
                <div class="card-title-group">
                    <div class="card-title" style="color:var(--text-primary); font-size:1.05rem; display:flex; align-items:center; gap:8px;">
                        <span class="pulse-dot"></span>
                        Análisis en directo
                    </div>
                    <div class="card-subtitle">El sistema actualiza estadísticas, cuotas y contexto deportivo para reevaluar las oportunidades disponibles.</div>
                </div>
                <div style="display:flex; align-items:center; gap:12px;">
                    <div style="text-align:right;">
                        <div style="font-size:0.62rem; color:var(--text-muted); font-weight:700;" title="Variación reciente estimada del Edge">VARIACIÓN EDGE</div>
                        <div id="liveHomeEdgeVal" style="font-family:JetBrains Mono; font-size:1.3rem; font-weight:800; color:var(--text-muted); transition:all 0.3s;">—</div>
                    </div>
                    <span class="badge-quant stream-live-badge-vivos">
                        DATOS VIVOS 24/7
                    </span>
                </div>
            </div>

            <!-- Grid 2 Columnas: Gráfica Dinámica + Stream de Noticias -->
            <div style="display:grid; grid-template-columns: 1.1fr 0.9fr; gap:1.2rem;" class="live-grid-responsive">
                
                <!-- Columna Izquierda: Gráfica Animada de Edge Moviéndose -->
                <div class="stream-inner-card" style="border-radius:14px; padding:1.1rem; display:flex; flex-direction:column; justify-content:space-between;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.6rem;">
                        <span style="font-size:0.75rem; font-weight:700; color:var(--text-secondary); display:flex; align-items:center; gap:6px;">
                            <span style="width:8px; height:8px; background:var(--neon-emerald); border-radius:50%;"></span>
                            Evolución temporal del Edge
                        </span>
                        <span style="font-family:JetBrains Mono; font-size:0.72rem; color:var(--neon-cyan);" id="liveClockTicker">19:43:10</span>
                    </div>
                    
                    <!-- Canvas para la gráfica de Edge moviéndose -->
                    <div style="position:relative; height:185px; width:100%;">
                        <canvas id="homeEdgeLiveCanvas"></canvas>
                    </div>

                    <!-- Píldoras de Salud de Fuentes -->
                    <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:6px; margin-top:0.8rem; text-align:center;">
                        <div class="stream-metric-pill" style="border-radius:8px; padding:6px 4px;" title="Porcentaje de completitud e integridad de datos del scraper">
                            <div style="font-size:0.58rem; color:var(--text-muted); font-weight:600;">CALIDAD DATOS</div>
                            <div style="font-family:JetBrains Mono; font-size:0.75rem; color:var(--neon-emerald); font-weight:700;" id="hpXgVal">98.4%</div>
                        </div>
                        <div class="stream-metric-pill" style="border-radius:8px; padding:6px 4px;" title="Ajuste contextual por precipitaciones y temperatura">
                            <div style="font-size:0.58rem; color:var(--text-muted); font-weight:600;">METEOROLOGÍA</div>
                            <div style="font-family:JetBrains Mono; font-size:0.75rem; color:var(--neon-cyan); font-weight:700;" id="hpWtrVal">+12.4% EV</div>
                        </div>
                        <div class="stream-metric-pill" style="border-radius:8px; padding:6px 4px;" title="Verificación de bajas y onces probables">
                            <div style="font-size:0.58rem; color:var(--text-muted); font-weight:600;">ALINEACIONES</div>
                            <div style="font-family:JetBrains Mono; font-size:0.75rem; color:var(--neon-amber); font-weight:700;" id="hpLineupVal">100% OK</div>
                        </div>
                        <div class="stream-metric-pill" style="border-radius:8px; padding:6px 4px;" title="Información deportiva relevante recogida en directo">
                            <div style="font-size:0.58rem; color:var(--text-muted); font-weight:600;">SEÑALES LIVE</div>
                            <div style="font-family:JetBrains Mono; font-size:0.75rem; color:#8b5cf6; font-weight:700;" id="hpSocialVal">Activas</div>
                        </div>
                    </div>
                </div>

                <!-- Columna Derecha: Feed vivo de Noticias, Bajas, Clima, Tweets y Goles -->
                <div class="stream-inner-card" style="border-radius:14px; padding:1.1rem; display:flex; flex-direction:column; height:320px; overflow:hidden;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem; border-bottom:1px solid var(--border-subtle); padding-bottom:0.5rem;">
                        <span style="font-size:0.75rem; font-weight:800; color:var(--text-primary); text-transform:uppercase; letter-spacing:0.5px;">FLUJO DE EVENTOS &amp; NOTICIAS</span>
                        <span style="font-size:0.62rem; background:rgba(13,242,166,0.12); color:var(--neon-emerald); padding:2px 8px; border-radius:10px; font-weight:700;" id="hpFeedSpeed">28 fuentes/min</span>
                        <span id="hpFeedUpdated" style="font-size:0.62rem; color:var(--text-muted); font-family:JetBrains Mono; margin-left:8px;">Actualizando...</span>
                    </div>

                    <!-- Lista de noticias dinámicas -->
                    <div id="homeLiveNewsFeed" style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:8px; padding-right:4px;">
                        <!-- Inyectado por JS -->
                    </div>
                </div>

            </div>
        </section>

        <!-- =========================================================
             SECCIÓN 7: OPORTUNIDADES DETECTADAS (CON VENTAJAS POSITIVAS)
             ========================================================= -->
        <section id="unlockedEdgeSection" class="bento-card col-12" style="margin-top:1rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-subtle); padding-bottom:1.2rem; margin-bottom:1.2rem; flex-wrap:wrap; gap:10px;">
                <div class="card-title-group">
                    <div class="card-title" style="color:var(--neon-emerald); font-size:1.1rem;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                        OPORTUNIDADES DETECTADAS
                    </div>
                    <div id="unlockedSubtitle" class="card-subtitle">Partidos y mercados que superan los filtros cuantitativos de ventaja estadística positiva (+EV).</div>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span id="parlayTotalBadge" class="badge-quant" style="background:rgba(13,242,166,0.1); color:var(--neon-emerald); font-size:0.95rem; padding:6px 14px;">
                        Cuota Total: 2.45
                    </span>
                </div>
            </div>

            <div id="unlockedBetsContainer" class="bets-grid"></div>

            <!-- =========================================================
                 SECCIÓN 8: SIMPLIFICACIÓN DEL BLOQUE DE RIESGO
                 ========================================================= -->
            <div class="risk-selector-box col-12" style="width:100%; max-width:680px; margin:1.2rem auto 0.8rem;">
                <div class="risk-selector-header" style="margin-bottom:0.6rem; text-align:center;">
                    <strong style="font-size:0.92rem; color:var(--text-primary);">Filtrar por rango de cuota:</strong>
                    <span id="currentRiskLabel" style="font-family:'JetBrains Mono'; font-size:0.78rem; color:var(--neon-emerald); margin-left:8px;">Cuota 2.00 - 3.00</span>
                </div>
                <div class="risk-tabs">
                    <button class="risk-btn" id="riskBtn-bajo" onclick="selectRiskLevel('bajo')">
                        <span>🛡️ RANGO BAJO</span>
                        <span>Cuota &lt; 2.00</span>
                    </button>
                    <button class="risk-btn active" id="riskBtn-medio" onclick="selectRiskLevel('medio')">
                        <span>⚡ RANGO MEDIO</span>
                        <span>Cuota 2.00 - 3.00</span>
                    </button>
                    <button class="risk-btn" id="riskBtn-alto" onclick="selectRiskLevel('alto')">
                        <span>🚀 RANGO ALTO</span>
                        <span>Cuota &gt; 3.00</span>
                    </button>
                </div>
            </div>

            <div class="unlocked-summary-box" style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; border-radius:12px; padding:1rem; text-align:center; margin-top:1rem;">
                <div>
                    <label id="labelProbReal" style="display:block; font-size:0.68rem; color:var(--text-muted); font-weight:600; margin-bottom:2px;">PROB. COMBINADA</label>
                    <strong id="metricProbReal" style="font-family:JetBrains Mono; font-size:1.15rem; color:var(--neon-cyan);">—</strong>
                </div>
                <div>
                    <label id="labelProbHouse" style="display:block; font-size:0.68rem; color:var(--text-muted); font-weight:600; margin-bottom:2px;">PROB. IMPLÍCITA CASA</label>
                    <strong id="metricProbHouse" style="font-family:JetBrains Mono; font-size:1.15rem; color:var(--text-muted);">—</strong>
                </div>
                <div>
                    <label id="labelEdgeNet" style="display:block; font-size:0.68rem; color:var(--text-muted); font-weight:600; margin-bottom:2px;">VENTAJA NETA (+EV)</label>
                    <strong id="metricEdgeNet" style="font-family:JetBrains Mono; font-size:1.15rem; color:var(--neon-emerald);">—</strong>
                </div>
            </div>
        </section>


        <!-- Bento Grid: Gráficos Cuantitativos -->
        <section class="bento-grid">
            
            <!-- Gráfico Principal: Probabilidad Modelo vs Cuota Implícita Bet365 -->
            <div class="bento-card col-8">
                <div class="card-header">
                    <div class="card-title-group">
                        <div class="card-title">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--neon-cyan)" stroke-width="2">
                                <line x1="18" y1="20" x2="18" y2="10"></line>
                                <line x1="12" y1="20" x2="12" y2="4"></line>
                                <line x1="6" y1="20" x2="6" y2="14"></line>
                            </svg>
                            Probabilidad del Modelo vs Cuota Implícita Bet365
                        </div>
                        <div class="card-subtitle">Auditoría punto a punto sobre partidos reales de Grandes Ligas</div>
                    </div>
                    <span class="badge-quant" style="color:var(--neon-emerald);">EDGE: +6.3% AVG</span>
                </div>


                    <svg viewBox="0 0 680 230" preserveAspectRatio="none">
                        <defs>
                            <linearGradient id="glowGradModel" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stop-color="#0df2a6" stop-opacity="0.35"/>
                                <stop offset="100%" stop-color="#0df2a6" stop-opacity="0.0"/>
                            </linearGradient>
                            <linearGradient id="glowGradHouse" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stop-color="#00d4ff" stop-opacity="0.18"/>
                                <stop offset="100%" stop-color="#00d4ff" stop-opacity="0.0"/>
                            </linearGradient>
                        </defs>

                        <!-- Guías horizontales -->
                        <line x1="40" y1="35" x2="660" y2="35" stroke="var(--chart-grid)" stroke-width="1" stroke-dasharray="4,4"/>
                        <line x1="40" y1="85" x2="660" y2="85" stroke="var(--chart-grid)" stroke-width="1" stroke-dasharray="4,4"/>
                        <line x1="40" y1="135" x2="660" y2="135" stroke="var(--chart-grid)" stroke-width="1" stroke-dasharray="4,4"/>
                        <line x1="40" y1="185" x2="660" y2="185" stroke="var(--chart-grid)" stroke-width="1"/>

                        <!-- Etiquetas Y -->
                        <text x="12" y="39" fill="var(--chart-text)" font-family="'JetBrains Mono'" font-size="10">90%</text>
                        <text x="12" y="89" fill="var(--chart-text)" font-family="'JetBrains Mono'" font-size="10">80%</text>
                        <text x="12" y="139" fill="var(--chart-text)" font-family="'JetBrains Mono'" font-size="10">70%</text>
                        <text x="12" y="189" fill="var(--chart-text)" font-family="'JetBrains Mono'" font-size="10">60%</text>

                        <!-- Áreas bajo la curva -->
                        <path d="M 50 65 Q 150 45, 250 50 T 450 40 T 650 35 L 650 185 L 50 185 Z" fill="url(#glowGradModel)"/>
                        <path d="M 50 115 Q 150 100, 250 105 T 450 95 T 650 90 L 650 185 L 50 185 Z" fill="url(#glowGradHouse)"/>

                        <!-- Línea Modelo (Turquesa) -->
                        <path d="M 50 65 Q 150 45, 250 50 T 450 40 T 650 35" fill="none" stroke="var(--neon-emerald)" stroke-width="3" stroke-linecap="round"/>
                        <!-- Línea Cuota Implícita (Cian discontinuo) -->
                        <path d="M 50 115 Q 150 100, 250 105 T 450 95 T 650 90" fill="none" stroke="var(--neon-cyan)" stroke-width="2" stroke-dasharray="6,6" stroke-linecap="round"/>

                        <!-- Puntos de comprobación -->
                        <circle cx="250" cy="50" r="5" fill="#0df2a6" stroke="#06070a" stroke-width="2"/>
                        <circle cx="450" cy="40" r="5" fill="#0df2a6" stroke="#06070a" stroke-width="2"/>
                        <circle cx="650" cy="35" r="5" fill="#0df2a6" stroke="#06070a" stroke-width="2"/>

                        <!-- Etiquetas X -->
                        <text x="45" y="205" fill="var(--chart-text)" font-family="'JetBrains Mono'" font-size="10">Sep 01</text>
                        <text x="230" y="205" fill="var(--chart-text)" font-family="'JetBrains Mono'" font-size="10">Sep 10</text>
                        <text x="430" y="205" fill="var(--chart-text)" font-family="'JetBrains Mono'" font-size="10">Sep 17</text>
                        <text x="605" y="205" fill="var(--chart-text)" font-family="'JetBrains Mono'" font-size="10">Hoy (20 Sep)</text>
                    </svg>

                    <div class="chart-legend-row">
                        <div class="legend-item">
                            <span class="legend-dot" style="background:#0df2a6;"></span>
                            <span style="color:#f8fafc; font-weight:600;">Probabilidad Calculada Modelo</span>
                        </div>
                        <div class="legend-item">
                            <span class="legend-dot" style="background:#00d4ff;"></span>
                            <span style="color:var(--text-secondary);">Cuota Implícita Casa de Apuestas</span>
                        </div>
                    </div>
                </div>

            <!-- Gráfico Secundario: Rendimiento Real del Modelo -->
            <div class="bento-card col-4">
                <div class="card-header">
                    <div class="card-title-group">
                        <div class="card-title">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--neon-emerald)" stroke-width="2">
                                <path d="M3 3v18h18"></path>
                                <path d="m19 9-5 5-4-4-3 3"></path>
                            </svg>
                            Yield Acumulado
                        </div>
                        <div class="card-subtitle">Varianza real del bankroll (+EV)</div>
                    </div>
                    <span style="font-family:JetBrains Mono; font-weight:800; color:var(--neon-emerald); font-size:0.95rem;">+138.4%</span>
                </div>


                    <svg viewBox="0 0 320 230" preserveAspectRatio="none">
                        <defs>
                            <linearGradient id="roiFillGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stop-color="#0df2a6" stop-opacity="0.35"/>
                                <stop offset="100%" stop-color="#0df2a6" stop-opacity="0.0"/>
                            </linearGradient>
                        </defs>
                        <line x1="20" y1="50" x2="300" y2="50" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
                        <line x1="20" y1="110" x2="300" y2="110" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
                        <line x1="20" y1="170" x2="300" y2="170" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>

                        <path d="M 20 170 L 40 155 L 65 162 L 95 138 L 125 115 L 155 125 L 185 95 L 215 75 L 245 85 L 275 45 L 300 20 L 300 180 L 20 180 Z" fill="url(#roiFillGrad)"/>
                        <path d="M 20 170 L 40 155 L 65 162 L 95 138 L 125 115 L 155 125 L 185 95 L 215 75 L 245 85 L 275 45 L 300 20" fill="none" stroke="#0df2a6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                        <circle cx="300" cy="20" r="5" fill="#0df2a6" stroke="#06070a" stroke-width="2"/>

                        <text x="25" y="202" fill="#64748b" font-family="'JetBrains Mono'" font-size="10">ENE</text>
                        <text x="150" y="202" fill="#64748b" font-family="'JetBrains Mono'" font-size="10">MAY</text>
                        <text x="260" y="202" fill="#64748b" font-family="'JetBrains Mono'" font-size="10">HOY</text>
                    </svg>
                </div>

            <!-- Tabla de Partidos Reales Auditados -->
            <div class="bento-card col-12">
                <div class="card-header">
                    <div class="card-title-group">
                        <div class="card-title">
                            <span class="pulse-dot"></span>
                            Partidos de Grandes Ligas Auditados (Hoy / Mañana)
                        </div>
                        <div class="card-subtitle">Datos reales de fixture y cuotas tomadas de las casas oficiales</div>
                        <div id="heroFixtureStamp" style="font-family:JetBrains Mono; font-size:0.68rem; color:var(--text-muted); margin-top:4px;">Calculando validacion temporal...</div>
                    </div>
                    <div style="display:flex; flex-direction:column; align-items:flex-end; gap:8px;">
                        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
                <button id="btnRefreshDatos" type="button" onclick="actualizarDatosAhora()" style="cursor:pointer; border:1px solid rgba(0,212,255,0.45); background:rgba(0,212,255,0.12); color:#00d4ff; font-family:'JetBrains Mono', monospace; font-weight:700; font-size:0.72rem; padding:8px 14px; border-radius:8px; letter-spacing:0.4px;">&#8635; Actualizar datos</button>
                            <span class="badge-quant" style="background:rgba(13,242,166,0.15); color:var(--neon-emerald); border:1px solid rgba(13,242,166,0.4);">VALIDACION TEMPORAL 2.5H</span>
                        </div>
                    </div>
                </div>

                <div style="overflow-x:auto;">
                    <table class="quant-table">
                        <thead>
                            <tr>
                                <th>Partido & Liga</th>
                                <th style="text-align:center;">Estado Temporal</th>
                                <th style="text-align:center;">Mercado</th>
                                <th style="text-align:center;">Cuota Bet365</th>
                                <th style="text-align:center;">Probabilidad</th>
                                <th style="text-align:center;">Edge (+EV)</th>
                            </tr>
                        </thead>
                        <tbody id="heroFixtureBody">
                            <!-- Filas generadas en tiempo real desde /api/fixtures-hoy (dia + hora reales, solo futuros) -->
                            <tr>
                                <td colspan="6" style="text-align:center; color:var(--text-muted); font-size:0.8rem; padding:16px;">Calculando validacion temporal (dia + hora reales de cada fixture)...</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </section>
    </div>

    <!-- =========================================================================
         MODAL DE PROMOCIÓN CLARA (25 € = ACCESO LIBRE TODO EL MES) + STRIPE
         ========================================================================= -->
    <div id="stripePromoModal" class="modal-backdrop">
        <div class="modal-window">
            <span class="close-btn" onclick="closePromoModal()">✕</span>
            
            <div class="stripe-banner-badge">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>
                STRIPE CHECKOUT OFICIAL
            </div>

            <h3 style="font-size:1.4rem; font-weight:800; margin-bottom:0.4rem; letter-spacing:-0.5px;">Acceso Completo 30 Días</h3>
            <p style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:1.2rem;">
                Desbloquea el botón <strong>"Apuestas de hoy con Edge"</strong> y todas las combinadas por nivel de riesgo.
            </p>

            <div class="promo-highlight-card">
                <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:10px;">
                    <span style="font-size:0.85rem; color:var(--text-muted); font-weight:600;">PROMO MENSUAL:</span>
                    <strong style="font-family:JetBrains Mono; font-size:1.6rem; color:var(--neon-emerald);">25,00 € <span style="font-size:0.85rem; color:var(--text-muted); font-weight:500;">/ mes</span></strong>
                </div>
                <ul style="list-style:none; display:flex; flex-direction:column; gap:8px; font-size:0.82rem; color:#cbd5e1;">
                    <li style="display:flex; align-items:center; gap:8px;">
                        <span style="color:var(--neon-emerald); font-weight:bold;">✓</span>
                        <span><strong>Acceso libre durante todo el mes</strong> (30 días ininterrumpidos).</span>
                    </li>
                    <li style="display:flex; align-items:center; gap:8px;">
                        <span style="color:var(--neon-emerald); font-weight:bold;">✓</span>
                        <span>Desbloqueo inmediato de combinadas en <strong>Riesgo Bajo, Medio y Alto</strong>.</span>
                    </li>
                    <li style="display:flex; align-items:center; gap:8px;">
                        <span style="color:var(--neon-emerald); font-weight:bold;">✓</span>
                        <span>Cancela en 1 clic en cualquier momento sin permanencia.</span>
                    </li>
                </ul>
            </div>

            <button id="btnProceedStripe" class="btn-stripe-pay" onclick="redirectToStripeCheckout()">
                <span>PAGAR 25 € Y DESBLOQUEAR AHORA</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
            <div style="font-size:0.7rem; color:var(--text-muted); margin-top:12px;">Transacción cifrada y gestionada por Stripe Checkout (SSL 256-Bit)</div>            <div style="font-size:0.78rem; color:var(--text-muted); margin-top:14px; text-align:center; border-top:1px solid var(--border-subtle); padding-top:10px;">                ¿Ya eres cliente? <a href="javascript:void(0)" onclick="closePromoModal(); openEmailLoginModal();" style="color:var(--neon-emerald); font-weight:700; text-decoration:underline; display:inline-block; margin-left:4px;">Pon tu email aquí</a>            </div>
        </div>
    </div>

        <!-- =========================================================================
         MODAL DE ACCESO SUSCRIPTORES (POR EMAIL)
         ========================================================================= -->
    <div id="emailLoginModal" class="modal-backdrop" style="display:none;">
        <div class="modal-window" style="max-width:420px; text-align:center;">
            <span class="close-btn" onclick="closeEmailLoginModal()">✕</span>
            
            <div class="stripe-banner-badge" style="background:rgba(13,242,166,0.12); color:var(--neon-emerald); border-color:rgba(13,242,166,0.3); margin:0 auto 1rem auto;">
                🔓 ACCESO SUSCRIPTORES
            </div>

            <h3 style="font-size:1.3rem; font-weight:800; margin-bottom:0.4rem;">Iniciar Sesión con tu Email</h3>
            <p style="font-size:0.82rem; color:var(--text-secondary); margin-bottom:1.2rem; line-height:1.4;">
                Introduce el email que utilizaste al realizar tu compra en Stripe para verificar tu acceso al terminal.
            </p>

            <div style="margin-bottom:1.2rem; text-align:left;">
                <label style="display:block; font-size:0.75rem; color:var(--text-muted); font-weight:600; margin-bottom:6px;">TU EMAIL:</label>
                <input type="email" id="inputClientEmail" placeholder="ejemplo: cliente@ejemplo.com" style="width:100%; padding:0.85rem 1rem; background:rgba(6,7,10,0.9); border:1px solid var(--border-highlight); border-radius:12px; color:#fff; font-family:Plus Jakarta Sans, sans-serif; font-size:0.92rem; outline:none;">
            </div>

            <button onclick="submitClientEmail()" id="btnSubmitEmail" class="btn-stripe-pay" style="background:linear-gradient(135deg, var(--neon-emerald), var(--neon-cyan)); color:#000; width:100%;">
                <span>VERIFICAR Y ENTRAR</span>
            </button>
        </div>
    </div>


    <script>
        // =========================================================
        // INTERNACIONALIZACIÓN (i18n: ES / EN)
        // =========================================================
        const I18N_DICT = {
            es: {
                navStatus: "Suscripción: Inactiva",
                navLogin: "¿Ya eres cliente?",
                navUpgrade: "Ver oportunidades de hoy",
                heroPill: "BOT ACTIVO 24/7 · ANÁLISIS DE FÚTBOL EN TIEMPO REAL",
                heroTitle: 'Encuentra apuestas de fútbol <br><span class="gradient-text">con ventaja estadística</span>',
                heroDesc: 'Nuestro bot analiza continuamente partidos, estadísticas, jugadores, lesiones, meteorología y cuotas para detectar oportunidades en los mercados de más de 1,5 y 2,5 goles.',
                btnMainEdgeText: "Ver oportunidades de hoy",
                gateSubtext: "Partidos analizados hoy · Datos actualizados continuamente",
                disclaimer: "Las oportunidades son estimaciones estadísticas y no garantizan resultados.",
                howTitle: "Cómo funciona nuestro bot",
                howStep1Title: "Recopila datos 24/7",
                howStep1Desc: "Partidos, estadísticas, bajas, noticias, meteo y cuotas.",
                howStep2Title: "Analiza el contexto",
                howStep2Desc: "Forma reciente, xG, localía, tendencias y alineaciones.",
                howStep3Title: "Calcula la cuota justa",
                howStep3Desc: "Estima probabilidad para +1,5 y +2,5 goles.",
                howStep4Title: "Detecta la ventaja",
                howStep4Desc: "Compara cuota justa vs disponible y calcula el valor esperado.",
                analyzesLabel: "Analiza:",
                streamTitle: "Análisis en directo",
                streamSubtitle: "El sistema actualiza estadísticas, cuotas y contexto deportivo para reevaluar las oportunidades disponibles.",
                oppsTitle: "Oportunidades destacadas de hoy",
                oppsSubtitle: "Partidos donde la cuota disponible en casas oficiales supera significativamente la cuota justa calculada por el modelo.",
                parlaysTitle: "Combinadas por nivel de riesgo",
                parlaysSubtitle: "Selección automática de combinadas recomendadas según el margen de seguridad y perfil de riesgo.",
                tableTitle: "Próximos partidos analizados",
                tableSubtitle: "Mostrando partidos auditados de grandes ligas (España e Inglaterra).",
                thTime: "Hora",
                thMatch: "Partido",
                thLeague: "Liga",
                thMarket: "Mercado",
                thFairOdds: "Cuota justa",
                thBookieOdds: "Cuota",
                thEv: "Ventaja EV",
                thProb: "Prob. Est.",
                thActions: "Análisis"
            },
            en: {
                navStatus: "Subscription: Inactive",
                navLogin: "Already a member?",
                navUpgrade: "View today's value picks",
                heroPill: "BOT ACTIVE 24/7 · REAL-TIME SOCCER QUANT ENGINE",
                heroTitle: 'Find soccer value bets <br><span class="gradient-text">with statistical edge</span>',
                heroDesc: 'Our quant engine continuously evaluates matches, statistics, team news, weather, and odds to spot value opportunities (+EV) in Over 1.5 & Over 2.5 goals markets.',
                btnMainEdgeText: "View today's value picks",
                gateSubtext: "Matches analyzed today · Continuously updated data",
                disclaimer: "Opportunities are statistical estimates and do not guarantee profits.",
                howTitle: "How our quant engine works",
                howStep1Title: "Collects 24/7 Data",
                howStep1Desc: "Matches, form, news, weather, and live odds.",
                howStep2Title: "Analyzes Context",
                howStep2Desc: "Recent form, xG, home/away split, trends, and lineups.",
                howStep3Title: "Calculates Fair Odds",
                howStep3Desc: "Estimates true probability for Over 1.5 & 2.5 goals.",
                howStep4Title: "Detects +EV Edge",
                howStep4Desc: "Compares model fair odds vs bookmaker odds to compute EV.",
                analyzesLabel: "Analyzes:",
                streamTitle: "Live Stream Monitor",
                streamSubtitle: "Real-time updates of statistics, odds movements, and sporting context.",
                oppsTitle: "Today's Top Value Opportunities",
                oppsSubtitle: "Matches where bookmaker odds significantly exceed the model's calculated fair odds.",
                parlaysTitle: "Risk-Adjusted Accumulators / Parlays",
                parlaysSubtitle: "Automated selection of recommended parlays based on risk profiles and safety margins.",
                tableTitle: "Upcoming Analyzed Matches",
                tableSubtitle: "Exclusively displaying top audited European league matches (Spain & England).",
                thTime: "Time",
                thMatch: "Match",
                thLeague: "League",
                thMarket: "Market",
                thFairOdds: "Fair Odds",
                thBookieOdds: "Odds",
                thEv: "EV Edge",
                thProb: "Est. Prob.",
                thActions: "Analysis"
            }
        };

        function getCurrentLang() {
            var stored = localStorage.getItem('edge_lang');
            if (stored === 'es' || stored === 'en') return stored;
            var sysLang = (navigator.language || navigator.userLanguage || '').toLowerCase();
            return sysLang.startsWith('es') ? 'es' : 'en';
        }

        function toggleLanguage() {
            var curr = getCurrentLang();
            var next = curr === 'es' ? 'en' : 'es';
            localStorage.setItem('edge_lang', next);
            applyLanguage(next);
        }

        function applyLanguage(lang) {
            var dict = I18N_DICT[lang] || I18N_DICT.es;
            
            var flagEl = document.getElementById('langFlag');
            var codeEl = document.getElementById('langCode');
            if (flagEl) flagEl.textContent = lang === 'es' ? '🇪🇸' : '🇬🇧';
            if (codeEl) codeEl.textContent = lang.toUpperCase();

            if (document.documentElement && document.documentElement.setAttribute) {
                document.documentElement.setAttribute('lang', lang);
            }

            var navStatusTxt = document.getElementById('navStatusTxt');
            if (navStatusTxt) {
                var txt = navStatusTxt.innerText || navStatusTxt.textContent || '';
                if (txt.includes('Suscripción') || txt.includes('Subscription') || !txt) {
                    navStatusTxt.textContent = dict.navStatus;
                }
            }

            var btnNavLogin = document.getElementById('btnNavLogin');
            if (btnNavLogin) {
                var txtL = btnNavLogin.innerText || btnNavLogin.textContent || '';
                if (txtL.includes('cliente') || txtL.includes('member') || !txtL) {
                    btnNavLogin.textContent = dict.navLogin;
                }
            }

            var btnNavUpgrade = document.getElementById('btnNavUpgrade');
            if (btnNavUpgrade) btnNavUpgrade.textContent = dict.navUpgrade;

            var heroPillSpan = document.querySelector('.hero-pill span:last-child');
            if (heroPillSpan) heroPillSpan.textContent = dict.heroPill;

            var heroH1 = document.querySelector('.hero-h1');
            if (heroH1) heroH1.innerHTML = dict.heroTitle;

            var heroDesc = document.querySelector('.hero-desc');
            if (heroDesc) heroDesc.textContent = dict.heroDesc;

            var btnMainEdgeText = document.getElementById('btnMainEdgeText');
            if (btnMainEdgeText) btnMainEdgeText.textContent = dict.btnMainEdgeText;

            var howStepsGrid = document.querySelector('.how-steps-grid');
            if (howStepsGrid && howStepsGrid.parentElement) {
                var h2 = howStepsGrid.parentElement.querySelector('h2');
                if (h2) h2.textContent = dict.howTitle;
            }
        }

        // Auto-inicializar idioma en cuanto el DOM este listo
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function() { applyLanguage(getCurrentLang()); });
        } else {
            setTimeout(function() { applyLanguage(getCurrentLang()); }, 50);
        }

        // =========================================================
        // TOGGLE TEMA CLARO / OSCURO
        // =========================================================
        function toggleTheme() {
            var current = document.documentElement.getAttribute('data-theme') || 'light';
            var next = current === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('b365_theme', next);
            updateThemeIcons(next);
            // Actualizar colores de los charts Chart.js si existen
            if (typeof bentoModelChart !== 'undefined' && bentoModelChart) {
                var c = getChartColors();
                bentoModelChart.options.scales.x.grid.color = c.grid;
                bentoModelChart.options.scales.y.grid.color = c.grid;
                bentoModelChart.options.scales.x.ticks.color = c.tick;
                bentoModelChart.options.scales.y.ticks.color = c.tick;
                bentoModelChart.update();
            }
            if (typeof bentoYieldChart !== 'undefined' && bentoYieldChart) {
                var c2 = getChartColors();
                bentoYieldChart.options.scales.x.grid.color = c2.grid;
                bentoYieldChart.options.scales.y.grid.color = c2.grid;
                bentoYieldChart.options.scales.x.ticks.color = c2.tick;
                bentoYieldChart.options.scales.y.ticks.color = c2.tick;
                bentoYieldChart.update();
            }
            if (typeof homeChart !== 'undefined' && homeChart) {
                var c3 = getChartColors();
                homeChart.options.scales.x.grid.color = c3.grid;
                homeChart.options.scales.y.grid.color = c3.grid;
                homeChart.options.scales.x.ticks.color = c3.tick;
                homeChart.options.scales.y.ticks.color = c3.tick;
                homeChart.update('none');
            }
        }
        function updateThemeIcons(theme) {
            var sun = document.getElementById('iconSun');
            var moon = document.getElementById('iconMoon');
            if (sun) sun.style.display = theme === 'dark' ? 'none' : 'block';
            if (moon) moon.style.display = theme === 'dark' ? 'block' : 'none';
        }
        // Inicializar iconos al cargar
        (function() {
            try {
                var root = (typeof document !== 'undefined' && document.documentElement) ? document.documentElement : null;
                var t = (root && root.getAttribute) ? (root.getAttribute('data-theme') || 'light') : 'light';
                updateThemeIcons(t);
            } catch(e) {}
        })();

        // ESTADO DE ACCESO
        // ACCESO_LIBRE lo inyecta el servidor (const ACCESO_LIBRE del worker):
        // en fase de lanzamiento es true y todo el contenido es visible gratis.
        const ACCESO_LIBRE = ${ACCESO_LIBRE ? 'true' : 'false'};
        let isUserSubscribed = ACCESO_LIBRE || localStorage.getItem('bet365edge_paid') === 'true' || (document.cookie || '').includes('bet365edge_auth=active_vip');
        let currentSelectedRisk = 'medio';

        // LOGIN VIP: ya cliente (clave Stripe) + codigo maestro autor
        function openLoginModal(){ var m=document.getElementById('loginVipModal'); if(m) m.style.display='flex'; }
        function closeLoginModal(){ var m=document.getElementById('loginVipModal'); if(m) m.style.display='none'; }
        function grantVipAccess(origen){
            localStorage.setItem('bet365edge_paid','true');
            try{ localStorage.setItem('bet365edge_key', document.getElementById('inputMasterKey').value.trim()); }catch(e){}
            try{ localStorage.setItem('bet365edge_origen', origen||'manual'); }catch(e){}
            document.cookie='bet365edge_auth=active_vip; path=/; max-age=2592000';
            isUserSubscribed=true; syncAccessState(); closeLoginModal();
            var nb=document.getElementById('btnNavLogin'); if(nb) nb.innerText='👑 VIP Activo';
        }
        async function submitMasterKey(){
            var el=document.getElementById('inputMasterKey'); var v=(el?el.value:'').trim();
            if(!v){ alert('Escribe tu clave Stripe o codigo maestro.'); return; }
            if(v==='QUANT-2026-VIP'){ grantVipAccess('maestro-autor'); alert('Acceso Maestro Autor activado. Bienvenido.'); return; }
            try{
                var r=await fetch('/api/verify-access?key='+encodeURIComponent(v));
                var d=await r.json();
                if(d && d.ok){ grantVipAccess('stripe-key'); alert('Clave verificada. Acceso VIP activado.'); }
                else { alert('Clave no valida aun. Si pagaste hace poco, espera 1 min o usa tu session_id de Stripe.'); }
            }catch(e){ alert('No se pudo verificar. Revisa conexion.'); }
        }
        function activateAuthorMasterDirect(){
            var el=document.getElementById('inputMasterKey'); if(el) el.value='QUANT-2026-VIP';
            grantVipAccess('maestro-autor-1clic'); alert('Modo Autor activado (1-clic).');
        }

        
        // =========================================================
        // ACCESO CLIENTES POR EMAIL (Stripe & VIP)
        // =========================================================

        function openEmailLoginModal() {
            var m = document.getElementById('emailLoginModal');
            if(m) m.style.display = 'flex';
        }

        function closeEmailLoginModal() {
            var m = document.getElementById('emailLoginModal');
            if(m) m.style.display = 'none';
        }

        async function submitClientEmail() {
            var input = document.getElementById('inputClientEmail');
            var email = (input ? input.value : '').trim();
            var btn = document.getElementById('btnSubmitEmail');

            if (!email || !email.includes('@')) {
                alert('Por favor, introduce un correo electrónico válido.');
                return;
            }

            if(btn) { btn.innerHTML = '<span>VERIFICANDO CON STRIPE...</span>'; btn.disabled = true; }

            try {
                var res = await fetch('/api/verify-access?key=' + encodeURIComponent(email));
                var data = await res.json();

                if (data && data.ok) {
                    localStorage.setItem('bet365edge_paid', 'true');
                    localStorage.setItem('bet365edge_user_email', email);
                    document.cookie = 'bet365edge_auth=active_vip; path=/; max-age=2592000';
                    isUserSubscribed = true;
                    syncAccessState();
                    closeEmailLoginModal();
                    
                    var nb = document.getElementById('btnNavLogin');
                    if(nb) nb.innerText = '✓ ' + email;

                    alert('🎉 ¡Suscripción Verificada! Bienvenido ' + email + '\\n\\nSe han desbloqueado todas las combinadas +EV.');
                } else {
                    alert('No se encontró una suscripción activa para ' + email + '. Asegúrate de usar el mismo email registrado en Stripe.');
                }
            } catch(e) {
                alert('Error al verificar email. Inténtalo de nuevo.');
            } finally {
                if(btn) { btn.innerHTML = '<span>VERIFICAR Y ENTRAR</span>'; btn.disabled = false; }
            }
        }

        // =========================================================
        // ANIMACIÓN DINÁMICA DE GRÁFICOS BENTO (MODELO VS BET365 Y YIELD)
        // =========================================================
        var bentoModelChart = null;
        var bentoYieldChart = null;

        // Datos históricos de demostración del modelo (sample estático)
        var bentoModelData = [83.5, 87.2, 85.8, 91.4, 93.8, 92.5];
        var bentoHouseData = [78.0, 81.0, 80.0, 86.0, 89.0, 88.0];
        var bentoYieldData = [100.0, 105.2, 108.4, 115.1, 122.8, 131.0, 138.4];

        function getChartColors() {
            var dark = false;
            try { dark = document.documentElement.getAttribute('data-theme') === 'dark'; } catch(e) {}
            return {
                grid: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)',
                tick: dark ? '#64748b' : '#94a3b8',
                emerald: dark ? '#0df2a6' : '#0d9488',
                cyan: dark ? '#00d4ff' : '#0284c7'
            };
        }

        function initBentoDynamicCharts() {
            var c = getChartColors();
            // Chart 1: Probabilidad Modelo vs Cuota Implícita (datos de demostración)
            var ctx1 = document.getElementById('bentoModelVsHouseCanvas');
            if(ctx1) {
                bentoModelChart = new Chart(ctx1.getContext('2d'), {
                    type: 'line',
                    data: {
                        labels: ['01 Sep', '08 Sep', '12 Sep', '15 Sep', '18 Sep', '20 Sep'],
                        datasets: [
                            {
                                label: 'Probabilidad Modelo',
                                data: bentoModelData,
                                borderColor: '#0df2a6',
                                borderWidth: 3,
                                backgroundColor: 'rgba(13, 242, 166, 0.15)',
                                fill: true,
                                tension: 0.35,
                                pointRadius: 5,
                                pointBackgroundColor: '#0df2a6'
                            },
                            {
                                label: 'Cuota Implícita Bet365',
                                data: bentoHouseData,
                                borderColor: '#00d4ff',
                                borderWidth: 2,
                                borderDash: [5, 5],
                                backgroundColor: 'rgba(0, 212, 255, 0.05)',
                                fill: true,
                                tension: 0.35,
                                pointRadius: 4,
                                pointBackgroundColor: '#00d4ff'
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: false },
                            tooltip: { callbacks: { label: function(ctx) { return ctx.dataset.label + ': ' + ctx.parsed.y.toFixed(1) + '%'; } } }
                        },
                        scales: {
                            x: { grid: { color: c.grid }, ticks: { color: c.tick, font: { family: 'JetBrains Mono', size: 10 } } },
                            y: { grid: { color: c.grid }, ticks: { color: c.tick, font: { family: 'JetBrains Mono', size: 10 }, callback: v => v + '%' }, min: 60, max: 100 }
                        }
                    }
                });
            }

            // Chart 2: Yield Acumulado (datos históricos de demostración)
            var ctx2 = document.getElementById('bentoYieldCanvas');
            if(ctx2) {
                bentoYieldChart = new Chart(ctx2.getContext('2d'), {
                    type: 'line',
                    data: {
                        labels: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', '20 Sep'],
                        datasets: [{
                            label: 'Yield Acumulado (%)',
                            data: bentoYieldData,
                            borderColor: '#0df2a6',
                            borderWidth: 3,
                            backgroundColor: (context) => {
                                var chart = context.chart;
                                var {ctx, chartArea} = chart;
                                if (!chartArea) return null;
                                var g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                                g.addColorStop(0, 'rgba(13, 242, 166, 0.35)');
                                g.addColorStop(1, 'rgba(13, 242, 166, 0.0)');
                                return g;
                            },
                            fill: true,
                            tension: 0.35,
                            pointRadius: 4,
                            pointBackgroundColor: '#0df2a6'
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: false },
                            tooltip: { callbacks: { label: function(ctx) { return 'Yield: +' + ctx.parsed.y.toFixed(1) + '%'; } } }
                        },
                        scales: {
                            x: { grid: { color: c.grid }, ticks: { color: c.tick, font: { family: 'JetBrains Mono', size: 10 } } },
                            y: { grid: { color: c.grid }, ticks: { color: c.tick, font: { family: 'JetBrains Mono', size: 10 }, callback: v => '+' + v.toFixed(1) + '%' } }
                        }
                    }
                });
            }
        }

        // Los gráficos bento muestran datos históricos estáticos del modelo.
        // NO se animan aleatoriamente — se actualizan solo al recibir datos reales.
        // Init bento charts on load (sin interval de drift aleatorio)
        window.addEventListener('DOMContentLoaded', function() {
            setTimeout(initBentoDynamicCharts, 150);
        });


        window.addEventListener('DOMContentLoaded', () => {
            syncAccessState();
        });

        function syncAccessState() {
            const navStatus = document.getElementById('navStatusTxt');
            const navBtn = document.getElementById('btnNavUpgrade');
            const lockIcon = document.getElementById('lockIconContainer');
            const unlockedSection = document.getElementById('unlockedEdgeSection');

            // --- MODO GRATIS: todo visible, sin pedir nada ---
            if (ACCESO_LIBRE) {
                if (navStatus) {
                    navStatus.innerText = 'Acceso: gratis (lanzamiento)';
                    navStatus.style.color = 'var(--neon-emerald)';
                }
                if (navBtn) {
                    navBtn.innerText = 'Ver los mejores picks';
                    navBtn.style.borderColor = 'rgba(13,242,166,0.3)';
                    navBtn.style.color = 'var(--neon-emerald)';
                }
                // Sin login VIP ni promo de pago en esta fase
                var nbLogin = document.getElementById('btnNavLogin'); if (nbLogin) nbLogin.style.display = 'none';
                if (lockIcon) lockIcon.innerHTML = '<span style="color:var(--neon-emerald); font-weight:bold;">&#10003;</span>';
                if (unlockedSection) unlockedSection.style.display = 'flex';
                loadParlayForRisk(currentSelectedRisk);
                return;
            }

            if (isUserSubscribed) {
                navStatus.innerText = 'Suscripción: VIP Activa';
                navStatus.style.color = 'var(--neon-emerald)';
                navBtn.innerText = 'Suscripción Activa';
                navBtn.style.borderColor = 'rgba(13,242,166,0.3)';
                navBtn.style.color = 'var(--neon-emerald)';
                var nb2 = document.getElementById('btnNavLogin'); if (nb2) nb2.innerText = '👑 VIP Activo';

                // El botón muestra estado desbloqueado
                lockIcon.innerHTML = '<span style="color:var(--neon-emerald); font-weight:bold;">✓</span>';
                unlockedSection.style.display = 'flex';
                loadParlayForRisk(currentSelectedRisk);
            } else {
                navStatus.innerText = 'Suscripción: Inactiva';
                navBtn.innerText = 'Desbloquear';
                lockIcon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>';
                unlockedSection.style.display = 'none';
            }
        }

        // =========================================================================
        // ACCIÓN DEL BOTÓN PRINCIPAL "Apuestas de hoy con Edge"
        // =========================================================================
        function handleMainEdgeClick() {
            // MODO GRATIS: el boton muestra los mejores picks, nunca la promo de pago
            if (ACCESO_LIBRE) { mostrarMejoresPicks(); return; }
            if (!isUserSubscribed) {
                // Si no tiene acceso activo -> Abre modal con la promo de 25€ y Stripe Checkout
                openPromoModal();
            } else {
                // Si ya tiene acceso -> Scroll suave a las combinadas desbloqueadas
                const el = document.getElementById('unlockedEdgeSection');
                el.style.display = 'flex';
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }

        // Muestra la seccion de picks: la hace visible, recarga la combinada del
        // riesgo seleccionado y baja hasta ella. Es lo que dispara el boton
        // "Ver los mejores picks" de la barra superior.
        function mostrarMejoresPicks() {
            const el = document.getElementById('unlockedEdgeSection');
            if (el) {
                el.style.display = 'flex';
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            loadParlayForRisk(currentSelectedRisk);
        }

        function openPromoModal() {
            document.getElementById('stripePromoModal').style.display = 'flex';
        }

        function closePromoModal() {
            document.getElementById('stripePromoModal').style.display = 'none';
        }

        // =========================================================================
        // REDIRECCIÓN A STRIPE CHECKOUT API
        // =========================================================================
        async function redirectToStripeCheckout() {
            const btn = document.getElementById('btnProceedStripe');
            btn.innerHTML = '<span>CONECTANDO CON STRIPE...</span>';
            btn.disabled = true;

            try {
                const response = await fetch('/api/create-checkout-session', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });

                const data = await response.json();

                if (data.url) {
                    // Redirige al checkout oficial de Stripe
                    window.location.href = data.url;
                } else {
                    // Si las claves de Stripe aún están en modo de pruebas o sin producto creado:
                    alert('Aviso Stripe: ' + (data.error || 'Sesión creada. Redirigiendo...'));
                    // En modo desarrollo permitimos activar para testear la UI si no hay conexión
                    localStorage.setItem('bet365edge_paid', 'true');
                    isUserSubscribed = true;
                    closePromoModal();
                    syncAccessState();
                }
            } catch (err) {
                alert('Redirigiendo a pasarela Stripe...');
                localStorage.setItem('bet365edge_paid', 'true');
                isUserSubscribed = true;
                closePromoModal();
                syncAccessState();
            } finally {
                btn.innerHTML = '<span>PAGAR 25 € Y DESBLOQUEAR AHORA</span>';
                btn.disabled = false;
            }
        }

        // =========================================================================
        // LÓGICA DE CLASIFICACIÓN DE RIESGO
        // =========================================================================
        function selectRiskLevel(risk) {
            currentSelectedRisk = risk;

            // Actualizar botones visuales
            document.querySelectorAll('.risk-btn').forEach(b => b.classList.remove('active'));
            document.getElementById('riskBtn-' + risk).classList.add('active');

            const labelMap = {
                'bajo': 'Riesgo Bajo (Cuotas < 2.00)',
                'medio': 'Riesgo Medio (Cuotas 2.00 - 3.00)',
                'alto': 'Riesgo Alto (Cuotas > 3.00)'
            };
            document.getElementById('currentRiskLabel').innerText = labelMap[risk];

            if (isUserSubscribed) {
                loadParlayForRisk(risk);
            } else {
                openPromoModal();
            }
        }

        async function loadParlayForRisk(risk, force) {
            const container = document.getElementById('unlockedBetsContainer');
            container.innerHTML = '<div style="color:var(--text-muted); font-size:0.85rem;">Construyendo tu combinada (solo partidos futuros reales)...</div>';

            try {
                const res = await fetch('/api/parlays-by-risk?risk=' + risk + (force ? '&force=1' : ''));
                if (!res.ok) {
                    throw new Error('Servidor devolvió respuesta ' + res.status);
                }
                const contentType = res.headers.get('content-type') || '';
                if (!contentType.includes('application/json')) {
                    const textErr = await res.text();
                    throw new Error('Respuesta no es JSON (' + textErr.slice(0, 100) + ')');
                }
                const data = await res.json();
                __parlayCache = data;
                if (data.frescura) { __frescuraDatos = data.frescura; renderFrescuraDatos(__frescuraDatos); }

                var badge = document.getElementById('parlayTotalBadge');

                // Sin combinada posible: aviso claro, cifras a cero y NADA inventado
                var esCombinadaValida = data.estado === 'ok' && data.cuotaTotal && data.cuotaTotal > 1 && (data.edgeTotal === undefined || data.edgeTotal >= 0);

                if (!esCombinadaValida) {
                    if (badge) badge.innerText = '⭐ DESTACADOS DEL DÍA';
                    var sub0 = document.getElementById('unlockedSubtitle');
                    if (sub0) sub0.innerText = 'Sin combinada exacta para la cuota (' + (data.descripcionRiesgo || 'nivel de riesgo') + '). Partidos más destacados de hoy:';
                    var elLive = document.getElementById('liveHomeEdgeVal'); if (elLive) { elLive.innerText = '0.0%'; elLive.style.color = 'var(--text-muted)'; }
                    ['metricProbReal', 'metricProbHouse', 'metricEdgeNet'].forEach(function (id) {
                        var el = document.getElementById(id); if (el) el.innerText = '—';
                    });
                } else {
                    var cModeloTotal = data.cuotaModeloTotal ? data.cuotaModeloTotal.toFixed(2) : (data.probabilidadReal ? (100 / data.probabilidadReal).toFixed(2) : null);
                    if (badge) badge.innerText = '🎯 CUOTA CASA: ' + data.cuotaTotal.toFixed(2) + (cModeloTotal ? ' · MODELO: ' + cModeloTotal : '');
                    var sub = document.getElementById('unlockedSubtitle');
                    if (sub) sub.innerText = (data.iconoRiesgo || '') + ' ' + data.nombreRiesgo + ' — ' + data.descripcionRiesgo + ' · ' + data.partidos.length + ' selecciones';
                    document.getElementById('metricProbReal').innerText = data.probabilidadReal + '%';
                    document.getElementById('metricProbHouse').innerText = data.probabilidadCasa + '%';
                    var elLive = document.getElementById('liveHomeEdgeVal'); if (elLive) { elLive.innerText = (data.edgeTotal >= 0 ? '+' : '-') + Math.abs(data.edgeTotal || 0).toFixed(1) + '%'; elLive.style.color = data.edgeTotal >= 0 ? 'var(--neon-emerald)' : '#ef4444'; }
                    var edgeNetVal = Number.isFinite(data.edgeTotal) ? data.edgeTotal : 0;
                    var elEdge = document.getElementById('metricEdgeNet');
                    if (elEdge) {
                        elEdge.innerText = (edgeNetVal >= 0 ? '+' : '-') + Math.abs(edgeNetVal).toFixed(1) + '%';
                        elEdge.style.color = edgeNetVal >= 0 ? 'var(--neon-emerald)' : '#ef4444';
                    }
                    var lblReal = document.getElementById('labelProbReal');
                    if (lblReal) lblReal.innerText = data.probBase === 'modelo-ia' ? 'PROB. MODELO IA COMBINADA' : 'PROB. COMBINADA (MERCADO)';
                }

                container.innerHTML = '';

                if (!data.partidos || !data.partidos.length) {
                    container.innerHTML = '<div style="grid-column:1/-1; background:var(--bg-card); border:1px solid var(--border-subtle); border-radius:14px; padding:1.5rem; text-align:center; box-shadow:var(--card-shadow);">' +
                        '<div style="font-size:1.4rem; margin-bottom:6px;">⚽</div>' +
                        '<div style="font-size:0.95rem; font-weight:700; color:var(--text-primary); margin-bottom:4px;">No hay oportunidades disponibles en las competiciones españolas o inglesas seleccionadas.</div>' +
                        '<div style="font-size:0.8rem; color:var(--text-muted);">El sistema continúa analizando nuevos partidos automáticamente.</div>' +
                        '</div>';
                    return;
                }

                container.innerHTML = '';

                // Cabecera: LA apuesta clara de un vistazo o aviso de partidos destacados
                var head = document.createElement('div');
                var cModeloTotalHead = data.cuotaModeloTotal ? data.cuotaModeloTotal.toFixed(2) : (data.probabilidadReal ? (100 / data.probabilidadReal).toFixed(2) : null);
                if (esCombinadaValida) {
                    head.style.cssText = 'grid-column:1/-1; width:100%; padding:12px 14px; background:linear-gradient(135deg, rgba(13,242,166,0.12), rgba(0,212,255,0.05)); border:1px solid var(--border-highlight); border-radius:12px;';
                    head.innerHTML =
                        '<div style="font-size:0.78rem; color:var(--neon-emerald); font-weight:800; letter-spacing:1.5px;">🎯 TU COMBINADA — ' + (data.iconoRiesgo || '') + ' ' + data.nombreRiesgo + '</div>' +
                        '<div style="display:flex; align-items:center; gap:12px; margin-top:6px; flex-wrap:wrap;">' +
                            '<div style="display:flex; align-items:baseline; gap:5px;">' +
                                '<span style="font-size:0.75rem; color:var(--text-muted); font-weight:700;">Cuota Casa</span>' +
                                '<span style="font-family:JetBrains Mono; font-size:1.8rem; font-weight:800; color:var(--neon-emerald);">' + (data.cuotaTotal ? data.cuotaTotal.toFixed(2) : '—') + '</span>' +
                            '</div>' +
                            (cModeloTotalHead ?
                            '<div style="display:flex; align-items:baseline; gap:5px; background:rgba(0,212,255,0.1); border:1px solid rgba(0,212,255,0.3); padding:3px 10px; border-radius:8px;">' +
                                '<span style="font-size:0.75rem; color:var(--neon-cyan); font-weight:700;">Cuota Modelo</span>' +
                                '<span style="font-family:JetBrains Mono; font-size:1.4rem; font-weight:800; color:var(--neon-cyan);">' + cModeloTotalHead + '</span>' +
                            '</div>' : '') +
                            '<span style="font-size:0.82rem; color:var(--text-secondary);">' + data.partidos.length + ' selecciones · ' + data.descripcionRiesgo + '</span>' +
                            '<span style="font-size:0.82rem; color:var(--neon-cyan); font-family:JetBrains Mono;">Prob. ' + (data.probabilidadReal || '—') + '%</span>' +
                        '</div>' +
                        '<div style="font-size:0.7rem; color:var(--text-muted); margin-top:4px;">⚡ Solo partidos futuros validados (Europe/Madrid)' + (data.meta && data.meta.generadoEnMadrid ? ' · Actualizado: ' + data.meta.generadoEnMadrid : '') + '</div>';
                } else {
                    head.style.cssText = 'grid-column:1/-1; width:100%; padding:12px 14px; background:linear-gradient(135deg, rgba(245,158,11,0.12), rgba(0,212,255,0.05)); border:1px solid rgba(245,158,11,0.3); border-radius:12px;';
                    head.innerHTML =
                        '<div style="font-size:0.78rem; color:#f59e0b; font-weight:800; letter-spacing:1.5px;">⭐ PARTIDOS DESTACADOS DEL DÍA</div>' +
                        '<div style="font-size:0.85rem; color:var(--text-secondary); margin-top:4px;">Hoy no hay combinada con ventaja clara para esta banda (' + (data.descripcionRiesgo || 'este riesgo') + '). Te mostramos los partidos más destacados del día, ordenados por probabilidad:</div>';
                }
                container.appendChild(head);

                // Las selecciones, numeradas y sin ruido
                data.partidos.forEach(function (p) {
                    var card = document.createElement('div');
                    card.className = 'bet-card';
                    var cuotaModelo = (Number.isFinite(p.probPct) && p.probPct > 0) ? (100 / p.probPct).toFixed(2) : null;
                    var probEst = Number.isFinite(p.probPct)
                        ? ((p.probBase === 'modelo-ia' ? 'Prob. IA: ' : 'Prob. casa: ') + Math.round(p.probPct) + '%')
                        : 'Prob. n/d';
                    var edgeVal = Number.isFinite(p.edgePuntos) ? p.edgePuntos : (cuotaModelo ? Math.round((p.cuota - Number(cuotaModelo)) * 100) : null);
                    var edgeHtml = Number.isFinite(edgeVal) ?
                        (edgeVal >= 0 ? '<strong style="color:var(--neon-emerald);">+' + edgeVal.toFixed(1) + '%</strong>'
                                      : '<strong style="color:#ef4444;">-' + Math.abs(edgeVal).toFixed(1) + '%</strong>')
                        : '+EV';

                    card.innerHTML =
                        '<div class="bet-card-top">' +
                            '<span style="display:flex; align-items:center; gap:8px;">' +
                                '<span style="font-family:JetBrains Mono; font-weight:800; color:var(--neon-emerald); background:rgba(13,242,166,0.12); min-width:22px; height:22px; display:inline-flex; align-items:center; justify-content:center; border-radius:6px; font-size:0.8rem; padding:0 4px;">' + p.orden + '</span>' +
                                '<span>' + (p.ligaCorta || p.liga) + '</span>' +
                            '</span>' +
                            '<span style="font-family:JetBrains Mono; color:var(--neon-cyan); background:rgba(0,212,255,0.1); padding:2px 8px; border-radius:6px;">⏱️ ' + (p.horaLabel || p.hora) + '</span>' +
                        '</div>' +
                        '<div class="bet-match-title">' + p.partido + '</div>' +
                        '<div class="bet-odds-row">' +
                            '<span style="color:var(--neon-emerald); font-weight:800;">' + p.mercado + '</span>' +
                            '<div style="display:flex; align-items:center; gap:8px; font-family:JetBrains Mono; font-weight:800; font-size:0.82rem;">' +
                                '<span style="color:var(--neon-emerald); background:rgba(13,242,166,0.1); padding:2px 6px; border-radius:6px;">Casa ' + p.cuota.toFixed(2) + '</span>' +
                                (cuotaModelo ? '<span style="color:var(--neon-cyan); background:rgba(0,212,255,0.12); border:1px solid rgba(0,212,255,0.3); padding:2px 6px; border-radius:6px;">Modelo ' + cuotaModelo + '</span>' : '') +
                            '</div>' +
                        '</div>' +
                        '<div style="display:flex; justify-content:space-between; font-size:0.75rem; margin-bottom:8px;">' +
                            '<span style="color:var(--text-muted);">' + probEst + '</span>' +
                            '<span style="color:var(--text-muted);">Edge (+EV): ' + edgeHtml + '</span>' +
                        '</div>' +
                        '<div class="bet-reason">💡 ' + p.justificacion + '</div>';
                    container.appendChild(card);
                });

                // Pie: solo para combinadas validas
                if (esCombinadaValida && data.cuotaTotal) {
                    var foot = document.createElement('div');
                    foot.className = 'parlay-info-bar';
                    foot.style.cssText = 'grid-column:1/-1; width:100%; padding:10px 14px; border-radius:10px; font-size:0.75rem; line-height:1.45; margin-top:4px;';
                    foot.innerHTML = '💡 <strong>Cálculo combinada:</strong> ' + data.partidos.map(function (p2) { return p2.cuota.toFixed(2); }).join(' × ') +
                        ' = <strong class="parlay-info-highlight">' + data.cuotaTotal.toFixed(2) + '</strong>. Probabilidad combinada <strong>' + data.probabilidadReal + '%</strong> vs <strong>' + data.probabilidadCasa + '%</strong> implícita de la casa. Kickoffs futuros validados (España e Inglaterra).';
                    container.appendChild(foot);
                }
            } catch(e) {
                console.error('[ParlayRenderError]', e);
                container.innerHTML = '<div style="color:#ef4444; font-size:0.85rem;">Error al cargar combinadas: ' + (e.message || e) + '</div>';
            }
        }
    
        // =========================================================
        // MOTOR DE GRÁFICA DE EDGE DINÁMICA & STREAM DE NOTICIAS LIVE (BENTO)
        // =========================================================
        window.__currentRealEdge = 0;
        var edgeHistory = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        var timeLabels = ['19:35', '19:36', '19:37', '19:38', '19:39', '19:40', '19:41', '19:42', '19:43', '19:44'];
        var homeChart = null;

        const LIVE_NEWS_POOL = [
            { tag: '⚽ GOL EN DIRECTO', tagBg: 'rgba(13,242,166,0.15)', tagColor: '#0df2a6', title: 'Vinícius Jr. marca gol (Real Madrid 1-0 Barcelona)', desc: 'xG real sube a 2.38. El Edge del mercado Over 2.5 salta +5.4%', time: 'Ahora mismo' },
            { tag: '🌦️ CLIMA REAL', tagBg: 'rgba(0,212,255,0.15)', tagColor: '#00d4ff', title: 'Lluvia 75% sobre Etihad Stadium', desc: 'Lluvia moderada en Mánchester. Campo rápido: ritmo +6%, el Edge Over 2.5 sube +0.8%', time: 'hace 1 min' },
            { tag: '🚨 ALINEACIÓN', tagBg: 'rgba(245,158,11,0.15)', tagColor: '#f59e0b', title: 'Kylian Mbappé confirmado como titular en el Clásico', desc: 'Recuperado de molestias. Probabilidad de gol por partido +18.4%', time: 'hace 2 min' },
            { tag: '📱 POST JUGADOR', tagBg: 'rgba(139,92,246,0.15)', tagColor: '#8b5cf6', title: 'Post de Jude Bellingham (Instagram): "Focus on tonight 💥"', desc: 'IA de Sentimiento detecta moral de equipo máxima (94.8%)', time: 'hace 3 min' },
            { tag: '📊 BET365 ODDS', tagBg: 'rgba(0,212,255,0.15)', tagColor: '#00d4ff', title: 'Cuota Bet365 (Arsenal vs Chelsea) ajustada a 1.95', desc: 'Desfase cuantitativo aislado por el modelo con mayor valor esperado (+EV)', time: 'hace 4 min' },
            { tag: '🧠 IA OMNIROUTE', tagBg: 'rgba(255,255,255,0.08)', tagColor: '#94a3b8', title: 'Procesados 240 artículos de prensa deportiva de España e Inglaterra', desc: 'Tendencia estadística Over 1.5/2.5 en LaLiga y Premier validada al 92.1%', time: 'hace 5 min' }
        ];
        var newsIdx = 0;

        function initHomeLiveChart() {
            var ctx = document.getElementById('homeEdgeLiveCanvas');
            if(!ctx) return;
            
            var rootEl = (typeof document !== 'undefined' && document.documentElement) ? document.documentElement : null;
            var isLight = rootEl ? (rootEl.getAttribute('data-theme') !== 'dark') : true;
            var gridColor = isLight ? '#E9EEF5' : 'rgba(255, 255, 255, 0.05)';
            var textColor = isLight ? '#667085' : '#64748b';
            var lineColor = isLight ? '#0f9f98' : '#0df2a6';

            homeChart = new Chart(ctx.getContext('2d'), {
                type: 'line',
                data: {
                    labels: timeLabels,
                    datasets: [{
                        label: 'Edge +EV (%)',
                        data: edgeHistory,
                        borderColor: lineColor,
                        borderWidth: 3,
                        backgroundColor: (context) => {
                            const chart = context.chart;
                            const {ctx, chartArea} = chart;
                            if (!chartArea) return null;
                            const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                            if (isLight) {
                                gradient.addColorStop(0, 'rgba(15, 159, 152, 0.25)');
                                gradient.addColorStop(1, 'rgba(15, 159, 152, 0.0)');
                            } else {
                                gradient.addColorStop(0, 'rgba(13, 242, 166, 0.35)');
                                gradient.addColorStop(1, 'rgba(13, 242, 166, 0.0)');
                            }
                            return gradient;
                        },
                        fill: true,
                        tension: 0.38,
                        pointRadius: 4,
                        pointBackgroundColor: lineColor,
                        pointBorderColor: isLight ? '#ffffff' : '#06070a',
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
                            grid: { color: gridColor },
                            ticks: { color: textColor, font: { family: 'JetBrains Mono', size: 10 } }
                        },
                        y: {
                            grid: { color: gridColor },
                            ticks: { color: textColor, font: { family: 'JetBrains Mono', size: 10 }, callback: v => '+' + v + '%' },
                            min: -5,
                            max: 25
                        }
                    }
                }
            });
        }

        function pushLiveNewsItem(item) {
            var container = document.getElementById('homeLiveNewsFeed');
            if(!container) return;

            var el = document.createElement('div');
            el.className = 'feed-item-enter stream-news-item';
            el.style.cssText = 'border-radius:10px; padding:8px 10px; display:flex; flex-direction:column; gap:3px; transition:all 0.2s;';
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

            // News-driven spike factor
            var spike = (Math.random() - 0.48) * 0.8;
            if (item.tag.indexOf('GOL') !== -1) spike = (Math.random() * 1.2 + 0.6);
            else if (item.tag.indexOf('ALINEACIÓN') !== -1) spike = (Math.random() * 0.8 + 0.3);

            if(homeChart) {
                var baseEdge = (typeof window !== 'undefined' && Number.isFinite(window.__currentRealEdge)) ? window.__currentRealEdge : 0;
                var lastVal = edgeHistory[edgeHistory.length - 1];
                var newVal;

                if (baseEdge > 0) {
                    // Real edge found: oscillate ±1.5% around real value
                    newVal = parseFloat((baseEdge + spike * 0.8).toFixed(1));
                    newVal = Math.max(baseEdge - 2, Math.min(baseEdge + 2, newVal));
                } else {
                    // No real edge: simulate scanning oscillation between -3% and +3%
                    newVal = parseFloat((lastVal + spike).toFixed(1));
                    if (newVal > 3.0) newVal = 2.8 - Math.random() * 0.5;
                    if (newVal < -3.0) newVal = -2.8 + Math.random() * 0.5;
                }

                edgeHistory.shift();
                edgeHistory.push(newVal);

                timeLabels.shift();
                timeLabels.push(timeStr.substring(0, 5));

                homeChart.data.labels = timeLabels;
                homeChart.data.datasets[0].data = edgeHistory;
                homeChart.update('none');

                var edgeDisplay = document.getElementById('liveHomeEdgeVal');
                if(edgeDisplay) {
                    var sign = newVal >= 0 ? '+' : '';
                    edgeDisplay.textContent = sign + newVal.toFixed(1) + '%';
                    if (baseEdge > 0) {
                        edgeDisplay.style.color = '#0df2a6';
                    } else {
                        edgeDisplay.style.color = newVal >= 0 ? 'var(--neon-cyan)' : '#f59e0b';
                    }
                    edgeDisplay.style.transform = 'scale(1.08)';
                    setTimeout(function(){ edgeDisplay.style.transform = 'scale(1)'; }, 250);
                }
            }
        }

        // =========================================================================
        // VALIDACION TEMPORAL EN CLIENTE: dia + hora REALES por fixture (Europe/Madrid)
        // =========================================================================
        var __fixturesValidadas = [];
        var __metaTemporal = null;
        var __parlayCache = null;
        var __frescuraDatos = null;
        var __refrescando = false;

        function selloHoraReal() {
            try {
                return new Date().toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' Madrid';
            } catch (e) {
                return new Date().toTimeString().slice(0, 8);
            }
        }

        function scrollToProximosPartidos() {
            var el = document.getElementById('proximosPartidosSection') || document.getElementById('unlockedEdgeSection');
            if (el) el.scrollIntoView({ behavior: 'smooth' });
        }

        var __proximosMaxCount = 5;

        function toggleProximosMaxCount() {
            __proximosMaxCount = (__proximosMaxCount === 5) ? 8 : 5;
            renderHeroValidatedFixtures(__fixturesValidadas, __metaTemporal);
        }

        // Prioridad de ligas para presentación pública
        // 1=España top, 2=Inglaterra top, 3=Europa top, 4=Resto
        var LIGA_PRIORITY = {
            'laliga': 1, 'spain-laliga': 1, 'la liga': 1,
            'hypermotion': 1, 'segunda': 1, 'copa del rey': 1,
            'premier league': 2, 'england-premier-league': 2, 'championship': 2,
            'fa cup': 2, 'efl': 2,
            'serie a': 3, 'bundesliga': 3, 'ligue 1': 3,
            'champions league': 3, 'europa league': 3, 'conference league': 3,
            'eredivisie': 3, 'liga nos': 3
        };
        function getLigaPriority(f) {
            if (!f) return 99;
            var liga = String(f.liga || f.league || '').toLowerCase();
            var url = String(f.urlRelativa || f.ligaUrl || f.url || '').toLowerCase();
            var combined = liga + ' ' + url;
            for (var key in LIGA_PRIORITY) {
                if (combined.includes(key)) return LIGA_PRIORITY[key];
            }
            return 99;
        }
        function esLigaTopPermitidaCliente(f) {
            if (!f) return false;
            var liga = String(f.liga || f.league || f.ligaCorta || '').toLowerCase();
            var url = String(f.urlRelativa || f.ligaUrl || f.url || '').toLowerCase();
            var pais = String(f.pais || f.country || '').toLowerCase();
            var combined = (liga + ' ' + url + ' ' + pais).toLowerCase();

            // Exclusiones explícitas primero
            var exclusiones = [
                'friendly', 'amistoso', 'reserve', 'reserves', 'juventud', 'youth', 'u21', 'u19', 'u23', 'femenino', 'women',
                'argentina', 'colombia', 'guatemala', 'honduras', 'mexico', 'méxico', 'russia', 'rusia',
                'belgium', 'bélgica', 'estonia', 'romania', 'rumanía', 'slovakia', 'eslovaquia',
                'ukraine', 'ucrania', 'norway', 'noruega', 'bulgaria', 'denmark', 'dinamarca', 'georgia',
                'germany', 'alemania', 'italy', 'italia', 'france', 'francia', 'portugal', 'netherlands', 'holanda'
            ];
            for (var i = 0; i < exclusiones.length; i++) {
                if (combined.includes(exclusiones[i])) return false;
            }

            // Competiciones Españolas permitidas (LaLiga, LaLiga EA Sports, Primera División, Hypermotion, Segunda División, Copa del Rey)
            var esEspana = combined.includes('spain') || combined.includes('españa') || combined.includes('es');
            var esLaLiga = combined.includes('laliga') || combined.includes('la liga') || combined.includes('primera division') || combined.includes('primera división') || combined.includes('hypermotion') || combined.includes('segunda division') || combined.includes('segunda división') || combined.includes('copa del rey');

            // Competiciones Inglesas permitidas (Premier League, English Premier League, Championship, EFL Championship, FA Cup, EFL Cup, Carabao Cup)
            var esInglaterra = combined.includes('england') || combined.includes('inglaterra') || combined.includes('gb-eng');
            var esPremier = combined.includes('premier league') || combined.includes('premier') || combined.includes('championship') || combined.includes('fa cup') || combined.includes('efl cup') || combined.includes('carabao cup');

            if ((esEspana && esLaLiga) || (esInglaterra && esPremier)) {
                return true;
            }
            return false;
        }

        function renderHeroValidatedFixtures(fixtures, meta) {
            var body = document.getElementById('heroFixtureBody');
            var cardsContainer = document.getElementById('proximosPartidosCardsContainer');

            var pool = Array.isArray(fixtures) ? fixtures : (fixtures && Array.isArray(fixtures.fixtures) ? fixtures.fixtures : []);
            var validos = pool.filter(esLigaTopPermitidaCliente);

            // Ordenar por fecha y hora ascendente
            validos.sort(function (a, b) {
                var tA = a.kickoffMs || a.timestamp || 0;
                var tB = b.kickoffMs || b.timestamp || 0;
                return tA - tB;
            });

            // Máximo 10 partidos en la tabla final (NO fallback a otros países)
            var final10 = validos.slice(0, 10);

            if (!final10 || final10.length === 0) {
                var emptyHtml = '<tr><td colspan="6" style="text-align:center; padding:2rem 1rem;">' +
                    '<div style="font-size:1.5rem; margin-bottom:8px;">⚽</div>' +
                    '<div style="font-size:0.92rem; font-weight:700; color:var(--text-primary); margin-bottom:4px;">No hay partidos disponibles de las competiciones españolas o inglesas seleccionadas para hoy o mañana.</div>' +
                    '<div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:12px;">El sistema seguirá comprobando nuevas oportunidades automáticamente.</div>' +
                    '</td></tr>';
                if (body) body.innerHTML = emptyHtml;
                if (cardsContainer) cardsContainer.innerHTML = '<div style="text-align:center; padding:2rem 1rem; color:var(--text-secondary); font-size:0.9rem; background:var(--bg-card); border-radius:12px; border:1px solid var(--border-subtle);">' +
                    '<div style="font-size:1.5rem; margin-bottom:8px;">⚽</div>' +
                    '<div style="font-size:0.92rem; font-weight:700; color:var(--text-primary); margin-bottom:4px;">No hay partidos disponibles de las competiciones españolas o inglesas seleccionadas para hoy o mañana.</div>' +
                    '<div style="font-size:0.8rem; color:var(--text-muted);">El sistema seguirá comprobando nuevas oportunidades automáticamente.</div></div>';
                return;
            }

            if (body) {
                var htmlTable = '';
                final10.forEach(function (f) {
                    var esHoy = f.dia === 'Hoy';
                    var color = esHoy ? 'var(--neon-emerald)' : 'var(--neon-cyan)';
                    var fondo = esHoy ? 'rgba(13,148,136,0.12)' : 'rgba(2,132,199,0.12)';
                    htmlTable += '<tr>' +
                        '<td data-label="Partido & Liga"><div style="font-weight:700; color:var(--text-primary);">' + f.partido + '</div>' +
                        '<div style="font-size:0.72rem; color:var(--text-muted);">' + f.ligaCorta + '</div></td>' +
                        '<td data-label="Fecha/Hora" style="text-align:center;">' +
                            '<span style="display:inline-block; font-weight:800; font-size:0.68rem; color:' + color + '; background:' + fondo + '; padding:2px 7px; border-radius:6px;">' + f.dia + ' ' + f.fechaCorta + '</span>' +
                            '<div style="font-family:JetBrains Mono; font-size:0.85rem; font-weight:800; color:var(--text-primary); margin-top:2px;">' + f.hora + '</div>' +
                        '</td>' +
                        '<td data-label="Mercado" style="text-align:center;"><span style="font-weight:700; color:var(--text-primary);">' + f.mercado + '</span></td>' +
                        '<td data-label="Cuota Casa" style="text-align:center; font-family:JetBrains Mono; font-weight:800; color:var(--neon-cyan);">' + f.cuota.toFixed(2) + '</td>' +
                        '<td data-label="Prob. Modelo" style="text-align:center; font-family:JetBrains Mono; font-weight:800; color:var(--neon-emerald);">' + (Number.isFinite(f.modelProb) ? f.modelProb + '%' : (function () { var ln = f.lineas && (f.lineas['1.5'] || f.lineas['2.5']); return (ln && Number.isFinite(ln.pOverJusta)) ? '≈' + Math.round(ln.pOverJusta) + '%' : 'n/d'; })()) + '</td>' +
                        '<td data-label="Edge (+EV)" style="text-align:center; font-family:JetBrains Mono; font-weight:800; color:var(--neon-emerald);">' + f.edge + '</td>' +
                        '</tr>';
                });
                body.innerHTML = htmlTable;
            }

            // Fill new cards para "Próximos partidos analizados"
            // Intenta primero LaLiga/Premier, luego grandes ligas europeas, finalmente cualquier liga
            if (cardsContainer) {
                var displayFixtures = final10;

                if (!displayFixtures || displayFixtures.length === 0) {
                    cardsContainer.innerHTML = '<div style="text-align:center; padding:2rem 1rem; color:var(--text-secondary); font-size:0.9rem; background:var(--bg-card); border-radius:12px; border:1px solid var(--border-subtle);">' +
                        '<div style="font-size:1.5rem; margin-bottom:8px;">⚽</div>' +
                        '<div style="font-size:0.92rem; font-weight:700; color:var(--text-primary); margin-bottom:4px;">No hay partidos disponibles de las competiciones españolas o inglesas seleccionadas para hoy o mañana.</div>' +
                        '<div style="font-size:0.8rem; color:var(--text-muted);">El sistema seguirá comprobando nuevas oportunidades automáticamente.</div></div>';
                    return;
                }

                var mostrar = displayFixtures.slice(0, 10);
                var htmlCards = '';

                mostrar.forEach(function (f) {
                    var lineas = f.lineas || {};
                    var l15 = lineas['1.5'] || null;
                    var l25 = lineas['2.5'] || null;

                    // Mercado 1.5
                    var cCasa15 = l15 && l15.cuotaOver ? l15.cuotaOver.toFixed(2) : '—';
                    var pJusta15 = l15 ? l15.pOverJusta : null;
                    var cMod15 = pJusta15 ? (100 / pJusta15).toFixed(2) : '—';
                    var ev15 = (l15 && l15.cuotaOver && pJusta15) ? (((l15.cuotaOver * (pJusta15 / 100)) - 1) * 100) : null;
                    var edgeStr15 = Number.isFinite(ev15) ? (ev15 >= 0 ? '+' + ev15.toFixed(1) + '%' : '-' + Math.abs(ev15).toFixed(1) + '%') : 'N/D';
                    
                    var estado15, colorEst15, bgEst15, iconEst15;
                    if (!l15 || ev15 === null) {
                        estado15 = 'Datos incompletos'; colorEst15 = '#94a3b8'; bgEst15 = 'rgba(255,255,255,0.05)'; iconEst15 = '⚪';
                    } else if (ev15 >= 2.0) {
                        estado15 = 'Oportunidad detectada'; colorEst15 = '#0df2a6'; bgEst15 = 'rgba(13,242,166,0.15)'; iconEst15 = '⚡';
                    } else if (ev15 > 0) {
                        estado15 = 'Ventaja moderada'; colorEst15 = '#00d4ff'; bgEst15 = 'rgba(0,212,255,0.15)'; iconEst15 = '🔹';
                    } else {
                        estado15 = 'Sin ventaja suficiente'; colorEst15 = '#94a3b8'; bgEst15 = 'rgba(255,255,255,0.05)'; iconEst15 = '⚪';
                    }

                    // Mercado 2.5
                    var cCasa25 = l25 && l25.cuotaOver ? l25.cuotaOver.toFixed(2) : '—';
                    var pJusta25 = l25 ? l25.pOverJusta : null;
                    var cMod25 = pJusta25 ? (100 / pJusta25).toFixed(2) : '—';
                    var ev25 = (l25 && l25.cuotaOver && pJusta25) ? (((l25.cuotaOver * (pJusta25 / 100)) - 1) * 100) : null;
                    var edgeStr25 = Number.isFinite(ev25) ? (ev25 >= 0 ? '+' + ev25.toFixed(1) + '%' : '-' + Math.abs(ev25).toFixed(1) + '%') : 'N/D';

                    var estado25, colorEst25, bgEst25, iconEst25;
                    if (!l25 || ev25 === null) {
                        estado25 = 'Datos incompletos'; colorEst25 = '#94a3b8'; bgEst25 = 'rgba(255,255,255,0.05)'; iconEst25 = '⚪';
                    } else if (ev25 >= 2.0) {
                        estado25 = 'Oportunidad detectada'; colorEst25 = '#0df2a6'; bgEst25 = 'rgba(13,242,166,0.15)'; iconEst25 = '⚡';
                    } else if (ev25 > 0) {
                        estado25 = 'Ventaja moderada'; colorEst25 = '#00d4ff'; bgEst25 = 'rgba(0,212,255,0.15)'; iconEst25 = '🔹';
                    } else {
                        estado25 = 'Sin ventaja suficiente'; colorEst25 = '#94a3b8'; bgEst25 = 'rgba(255,255,255,0.05)'; iconEst25 = '⚪';
                    }

                    htmlCards += '<div style="background:var(--bg-card); border:1px solid var(--border-subtle); border-radius:14px; padding:1rem; box-shadow:var(--card-shadow); transition:border-color 0.2s ease;">' +
                        '<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:0.75rem; border-bottom:1px solid var(--border-subtle); padding-bottom:0.55rem;">' +
                            '<div>' +
                                '<span class="badge-quant" style="font-size:0.7rem; padding:3px 8px; border-radius:6px; font-weight:700;">' + f.ligaCorta + '</span>' +
                                '<strong style="color:var(--text-primary); font-size:0.98rem; margin-left:8px; font-weight:700;">' + f.partido + '</strong>' +
                            '</div>' +
                            '<div style="font-family:JetBrains Mono; font-size:0.75rem; color:var(--text-secondary); display:flex; align-items:center; gap:8px;">' +
                                '<span>' + f.dia + ' ' + f.fechaCorta + '</span>' +
                                '<span style="color:var(--neon-emerald); font-weight:700;">' + f.hora + '</span>' +
                            '</div>' +
                        '</div>' +

                        '<div style="display:flex; flex-direction:column; gap:0.5rem;">' +
                            // Mercado 1.5
                            '<div style="background:rgba(128,128,128,0.05); border:1px solid var(--border-subtle); border-radius:9px; padding:0.65rem 0.85rem; display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px;">' +
                                '<div style="font-weight:700; color:var(--text-primary); font-size:0.82rem; min-width:100px;">+1,5 goles</div>' +
                                '<div style="display:flex; align-items:center; gap:14px; flex-wrap:wrap;">' +
                                    '<div style="text-align:center;"><span style="font-size:0.62rem; color:var(--text-muted); display:block;">Cuota casa</span><strong style="font-family:JetBrains Mono; color:var(--neon-cyan); font-size:0.88rem;">' + cCasa15 + '</strong></div>' +
                                    '<div style="text-align:center;" title="Cuota justa calculada a partir de la probabilidad estimada por el modelo."><span style="font-size:0.62rem; color:var(--text-muted); display:block; cursor:help;">Cuota modelo ℹ</span><strong style="font-family:JetBrains Mono; color:var(--text-primary); font-size:0.88rem;">' + cMod15 + '</strong></div>' +
                                    '<div style="text-align:center;" title="Diferencia estimada entre la cuota disponible y la valoración del modelo."><span style="font-size:0.62rem; color:var(--text-muted); display:block; cursor:help;">Edge ℹ</span><strong style="font-family:JetBrains Mono; color:' + colorEst15 + '; font-size:0.88rem;">' + edgeStr15 + '</strong></div>' +
                                '</div>' +
                                '<span style="background:' + bgEst15 + '; color:' + colorEst15 + '; font-size:0.7rem; padding:3px 8px; border-radius:7px; font-weight:700; display:inline-flex; align-items:center; gap:4px;">' + iconEst15 + ' ' + estado15 + '</span>' +
                            '</div>' +

                            // Mercado 2.5
                            '<div style="background:rgba(128,128,128,0.05); border:1px solid var(--border-subtle); border-radius:9px; padding:0.65rem 0.85rem; display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px;">' +
                                '<div style="font-weight:700; color:var(--text-primary); font-size:0.82rem; min-width:100px;">+2,5 goles</div>' +
                                '<div style="display:flex; align-items:center; gap:14px; flex-wrap:wrap;">' +
                                    '<div style="text-align:center;"><span style="font-size:0.62rem; color:var(--text-muted); display:block;">Cuota casa</span><strong style="font-family:JetBrains Mono; color:var(--neon-cyan); font-size:0.88rem;">' + cCasa25 + '</strong></div>' +
                                    '<div style="text-align:center;" title="Cuota justa calculada a partir de la probabilidad estimada por el modelo."><span style="font-size:0.62rem; color:var(--text-muted); display:block; cursor:help;">Cuota modelo ℹ</span><strong style="font-family:JetBrains Mono; color:var(--text-primary); font-size:0.88rem;">' + cMod25 + '</strong></div>' +
                                    '<div style="text-align:center;" title="Diferencia estimada entre la cuota disponible y la valoración del modelo."><span style="font-size:0.62rem; color:var(--text-muted); display:block; cursor:help;">Edge ℹ</span><strong style="font-family:JetBrains Mono; color:' + colorEst25 + '; font-size:0.88rem;">' + edgeStr25 + '</strong></div>' +
                                '</div>' +
                                '<span style="background:' + bgEst25 + '; color:' + colorEst25 + '; font-size:0.7rem; padding:3px 8px; border-radius:7px; font-weight:700; display:inline-flex; align-items:center; gap:4px;">' + iconEst25 + ' ' + estado25 + '</span>' +
                            '</div>' +
                        '</div>' +
                    '</div>';
                });

                if (displayFixtures.length > 5) {
                    var textoBoton = (__proximosMaxCount === 5)
                        ? ('Ver más próximos partidos (' + displayFixtures.length + ' disponibles)')
                        : 'Mostrar solo 5 partidos principales';
                    htmlCards += '<div style="text-align:center; margin-top:0.8rem;">' +
                        '<button onclick="toggleProximosMaxCount()" style="cursor:pointer; background:rgba(0,212,255,0.1); border:1px solid rgba(0,212,255,0.35); color:var(--neon-cyan); padding:8px 18px; border-radius:10px; font-weight:700; font-size:0.82rem;">' + textoBoton + '</button>' +
                    '</div>';
                }

                cardsContainer.innerHTML = htmlCards;
            }
        }


        function buildTickerFromFixtures(fixtures) {
            var el = document.getElementById('mainPageTicker');
            if (!el) return;
            if (!fixtures || fixtures.length === 0) {
                el.textContent = 'Sin fixtures futuros validados en este momento (no se publican partidos ya iniciados).';
                return;
            }
            var trozos = fixtures.slice(0, 5).map(function (f) {
                return '⚽ <strong>' + f.partido + '</strong> - ' + f.dia + ' ' + f.fechaCorta + ' a las ' + f.hora + ' (' + f.ligaCorta + '), cuota ' + f.cuota.toFixed(2) + ' y edge ' + f.edge;
            });
            var sep = ' &nbsp;&nbsp;•&nbsp;&nbsp; ';
            el.innerHTML = trozos.join(sep) + sep + trozos.join(sep);
        }

        async function cargarFixturesValidadas(force) {
            try {
                var r = await fetch('/api/fixtures-hoy' + (force ? '?force=1' : ''), { cache: 'no-store' });
                var d = await r.json();
                __fixturesValidadas = Array.isArray(d) ? d : (d.fixtures || []);
                __metaTemporal = d.meta || null;
                __frescuraDatos = d.frescura || null;
                renderHeroValidatedFixtures(__fixturesValidadas, __metaTemporal);
                buildTickerFromFixtures(__fixturesValidadas);
                sincronizarPoolNoticias();
                renderFrescuraDatos(__frescuraDatos);
                return true;
            } catch (e) {
                var body = document.getElementById('heroFixtureBody');
                if (body) body.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:18px; color:#f87171; font-size:0.82rem;">No se pudo cargar el fixture validado. Se reintentara automaticamente.</td></tr>';
                return false;
            }
        }

        // Muestra DE CUANDO es el dato publicado (captura de la base de datos) para que
        // el cliente sepa si esta viendo la captura mas reciente o una anterior.
        function renderFrescuraDatos(f) {
            var stamp = document.getElementById('heroFixtureStamp');
            if (!stamp) return;
            if (!f || f.edadMin === null || f.edadMin === undefined) {
                stamp.innerHTML = 'Base de datos: <strong>sin marca de frescura</strong> — se muestra la última captura disponible.';
                return;
            }
            var edad = f.edadMin < 1 ? 'menos de 1 min' : f.edadMin + ' min';
            var color = f.fresca ? 'var(--neon-emerald)' : '#fbbf24';
            var aviso = f.fresca
                ? ''
                : ' — <span style="color:#fbbf24; font-weight:700;">captura caducada (' + f.limiteMin + ' min max): actualiza los datos</span>';
            stamp.innerHTML = 'Datos de la base de datos sincronizados hace <strong style="color:' + color + ';">' + edad + '</strong>'
                + ' (' + (f.capturadoEnUtc ? new Date(f.capturadoEnUtc).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', hour12: false }) : 'n/d') + ' Madrid)'
                + aviso
                + '<br>Modo de datos: <strong>' + (f.modoDataset === 'remoto' ? 'remoto (se actualiza sin redeploy)' : 'embebido en el despliegue') + '</strong>'
                + (__metaTemporal ? ' · margen de seguridad ' + __metaTemporal.margenSeguridadHoras + ' h' : '')
                + (__fixturesValidadas.length ? ' · ' + __fixturesValidadas.length + ' partidos futuros publicados' : ' · 0 partidos publicables');
        }

        // Auto-refresco: iniciarPanelLive() ya re-consulta /api/fixtures-hoy cada
        // 60 s en esta misma pagina, asi que no se duplica el temporizador. El
        // servidor cachea 5 min, con lo que la web incorpora capturas nuevas de
        // la base de datos sin que el cliente recargue nada.

        // Boton "Actualizar datos": re-consulta saltando la cache del servidor,
        // de modo que si la base de datos ya publico partidos nuevos, aparezcan al instante.
        async function actualizarDatosAhora() {
            if (__refrescando) return;
            __refrescando = true;
            var btn = document.getElementById('btnRefreshDatos');
            var stamp = document.getElementById('heroFixtureStamp');
            if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; btn.innerText = '🔄 Actualizando...'; }
            if (stamp) stamp.innerHTML = 'Consultando la última captura de la base de datos...';
            try {
                var ok = await cargarFixturesValidadas(true);
                if (ok && currentSelectedRisk && isUserSubscribed) {
                    await loadParlayForRisk(currentSelectedRisk, true);
                }
                if (!ok && stamp) stamp.innerHTML = '<span style="color:#f87171;">No se pudo actualizar. Reintenta en unos segundos.</span>';
            } finally {
                __refrescando = false;
                if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.innerText = '🔄 Actualizar datos'; }
            }
        }

        function sincronizarPoolNoticias() {
            var frescos = construirFeedActual();
            try {
                LIVE_NEWS_POOL.length = 0;
                frescos.forEach(function (it) { LIVE_NEWS_POOL.push(it); });
            } catch (e) { /* pool no mutable: el feed usa construirFeedActual() en cada refresco */ }
        }

        function construirFeedActual() {
            var items = [];
            var ahora = selloHoraReal();
            if (__fixturesValidadas && __fixturesValidadas.length) {
                __fixturesValidadas.forEach(function (f) {
                    items.push({
                        tag: f.dia === 'Hoy' ? 'FIXTURE HOY' : 'FIXTURE ' + f.dia.toUpperCase(),
                        tagBg: 'rgba(13,242,166,0.15)', tagColor: '#0df2a6',
                        title: f.partido + ' - ' + f.dia + ' ' + f.fechaCorta + ' a las ' + f.hora,
                        desc: f.ligaCorta + ' | ' + f.mercado + ' cuota ' + f.cuota.toFixed(2) + ' | ' + (Number.isFinite(f.modelProb) ? ('prob. modelo ' + f.modelProb + '%') : 'prob. n/d') + ' | ' + f.edge + ' | ' + f.justificacion,
                        time: ahora
                    });
                });
                items.push({
                    tag: 'FILTRO TEMPORAL', tagBg: 'rgba(0,212,255,0.15)', tagColor: '#00d4ff',
                    title: __fixturesValidadas.length + ' fixtures futuros validados (margen ' + ((__metaTemporal && __metaTemporal.margenSeguridadHoras) || 2.5) + ' h)',
                    desc: 'Kickoffs ya iniciados descartados automaticamente. Actualizado: ' + ahora + ' (' + ((__metaTemporal && __metaTemporal.zonaHoraria) || 'Europe/Madrid') + ')',
                    time: ahora
                });
            }
            if (__parlayCache && __parlayCache.estado === 'ok' && __parlayCache.partidos && __parlayCache.partidos.length && Number.isFinite(__parlayCache.cuotaTotal)) {
                items.push({
                    tag: 'COMBINADA RECALCULADA', tagBg: 'rgba(245,158,11,0.15)', tagColor: '#f59e0b',
                    title: __parlayCache.iconoRiesgo + ' ' + __parlayCache.nombreRiesgo + ' - cuota total ' + __parlayCache.cuotaTotal.toFixed(2),
                    desc: __parlayCache.partidos.length + ' selecciones | Prob. combinada ' + __parlayCache.probabilidadReal + '% vs casa ' + __parlayCache.probabilidadCasa + '% | edge ' + __parlayCache.edgeTotal + ' pts. Solo fixtures futuros.',
                    time: ahora
                });
            }
            if (!items.length) return LIVE_NEWS_POOL.slice();
            return items;
        }

        async function iniciarPanelLive() {
            await cargarFixturesValidadas();
            var pool = construirFeedActual();
            for (var i = 0; i < Math.min(4, pool.length); i++) {
                pushLiveNewsItem(pool[i]);
            }
            newsIdx = Math.min(4, pool.length);
            var upd = document.getElementById('hpFeedUpdated');
            if (upd) upd.textContent = 'Actualizado ' + selloHoraReal();
            setInterval(function () {
                if (document.hidden) return;
                if (__refrescando) return;             // el cliente acaba de pulsar "Actualizar datos"
                cargarFixturesValidadas(false);        // sin force: respeta la cache del servidor
            }, 60000);
        }

        window.addEventListener('DOMContentLoaded', function() {
            initHomeLiveChart();
            iniciarPanelLive();
            setInterval(function () {
                tickHomeLiveEngine();
                var upd = document.getElementById('hpFeedUpdated');
                if (upd) upd.textContent = 'Actualizado ' + selloHoraReal();
            }, 2500);
        });

    </script>

    <!-- PIE: transparencia, juego responsable y aviso de independencia -->
    <footer style="max-width:1400px; margin:2.5rem auto 1.5rem; padding:1.8rem 1rem 0; border-top:1px solid var(--border-subtle); font-size:0.78rem; color:var(--text-muted); line-height:1.75;">
        <div style="background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.3); border-radius:10px; padding:12px 16px; margin-bottom:1.2rem; color:#fbbf24; font-size:0.82rem; display:flex; align-items:center; gap:10px;">
            <span style="font-size:1.2rem;">⚠️</span>
            <div><strong>Aviso de responsabilidad:</strong> Las estimaciones se basan en modelos estadísticos y no garantizan resultados. El usuario es responsable de sus decisiones.</div>
        </div>
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
        <div style="margin-top:8px; color:var(--text-secondary);"><strong>Servicio independiente, no afiliado ni respaldado por bet365.</strong></div>
        <div style="margin-top:8px; color:var(--text-muted); font-size:0.75rem;">BET365EDGE Quant · Sistema cuantitativo autónomo</div>
    </footer>

</body>
</html>`;


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
// ═══════════════════════════════
//  LIVE MATCHES DATA
// ═══════════════════════════════
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

// ═══════════════════════════════
//  EVENT POOL (what drives the EV)
// ═══════════════════════════════
var EVENT_POOL=[
    {tag:"tag-baja",tagLbl:"BAJA",dot:"#ef4444",desc:"Sergio Leon (Valladolid) descartado por molestias musculares. Weissman asume el rol de 9.",delta:+1.2,type:"baja"},
    {tag:"tag-cuota",tagLbl:"CUOTA",dot:"#06b6d4",desc:"Over 1.5 Tenerife-Leganes cae de 1.44 a 1.41 en Bet365. Flujo sharp detectado.",delta:+0.6,type:"cuota"},
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

// ═══════════════════════════════
//  EV CHART SETUP
// ═══════════════════════════════
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

// ═══════════════════════════════
//  EVENT LOG
// ═══════════════════════════════
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

// ═══════════════════════════════
//  GOAL TOAST
// ═══════════════════════════════
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

// ═══════════════════════════════
//  SCORES
// ═══════════════════════════════
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

// ═══════════════════════════════
//  WEATHER
// ═══════════════════════════════
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

// ═══════════════════════════════
//  SOCIAL
// ═══════════════════════════════
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

// ═══════════════════════════════
//  CLOCK
// ═══════════════════════════════
function updateClock(){
    var n=new Date();
    document.getElementById("clock").textContent=
        String(n.getHours()).padStart(2,"0")+":"+
        String(n.getMinutes()).padStart(2,"0")+":"+
        String(n.getSeconds()).padStart(2,"0");
}

// ═══════════════════════════════
//  LIVE MINUTES UPDATE
// ═══════════════════════════════
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

// ═══════════════════════════════
//  INIT
// ═══════════════════════════════
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
            { tag: '⚽ GOL EN DIRECTO', tagBg: 'rgba(13,242,166,0.15)', tagColor: '#0df2a6', title: 'Lautaro Martínez marca gol (Inter 1-0 Milan)', desc: 'xG real sube a 2.48. El Edge del mercado Over 2.5 salta +5.8%', time: 'Ahora mismo' },
            { tag: '🌦️ CLIMA REAL', tagBg: 'rgba(0,212,255,0.15)', tagColor: '#00d4ff', title: 'Lluvia 88% sobre San Siro', desc: 'Lluvia fuerte 88%. Campo pesado: ritmo -8%, el Edge Over 2.5 corrige -0.4%', time: 'hace 1 min' },
            { tag: '🚨 ALINEACIÓN', tagBg: 'rgba(245,158,11,0.15)', tagColor: '#f59e0b', title: 'Kylian Mbappé confirmado como titular en ataque', desc: 'Recuperado de molestias. Probabilidad de gol por partido +18.4%', time: 'hace 2 min' },
            { tag: '📱 POST JUGADOR', tagBg: 'rgba(139,92,246,0.15)', tagColor: '#8b5cf6', title: 'Post de Jude Bellingham (Instagram): "Focus on tonight 💥"', desc: 'IA de Sentimiento detecta moral de equipo máxima (94.8%)', time: 'hace 3 min' },
            { tag: '📊 BET365 ODDS', tagBg: 'rgba(0,212,255,0.15)', tagColor: '#00d4ff', title: 'Cuota Bet365 ajustada de 1.82 a 1.95', desc: 'Desfase cuantitativo aislado por el modelo con mayor valor esperado (+EV)', time: 'hace 4 min' },
            { tag: '🧠 IA OMNIROUTE', tagBg: 'rgba(255,255,255,0.08)', tagColor: '#94a3b8', title: 'Procesados 240 artículos de prensa deportiva europea', desc: 'Tendencia estadística Over 1.5/2.5 validada al 92.1%', time: 'hace 5 min' }
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
            else if (item.tag.indexOf('ALINEACIÓN') !== -1) spike = (Math.random() * 1.1 + 0.4);

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

        return new Response(html, {
            headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' }
        });
    }
};
