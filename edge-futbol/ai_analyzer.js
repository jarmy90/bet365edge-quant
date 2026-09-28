/**
 * =============================================================================
 * ROTADOR DE MODELOS LLM MULTI-PROVEEDOR DE ALTA DISPONIBILIDAD (+EV AI ANALYZER)
 * =============================================================================
 * Sistema de rotación multi-provider con failover automático (429, timeouts, 5xx)
 * Diseñado para Node.js (18+), Vercel Serverless y Cloudflare Workers.
 * Soporta: Groq, Google Gemini, OpenRouter, Omniroute, Nvidia NIM, Dahl Inference.
 * Sin dependencias externas requeridas (usa fetch nativo).
 */

const SYSTEM_PROMPT = `Actúa como el Director de Análisis Cuantitativo y Scouting de un sindicato de apuestas deportivas profesionales (+EV).

⚠️ **VALIDACIÓN TEMPORAL CRÍTICA - PRIORIDAD MÁXIMA:**
ANTES de cualquier análisis, DEBES verificar OBLIGATORIAMENTE:

1.  **OBTENER FECHA/HORA ACTUAL:** Consulta la fecha y hora exacta del momento de la ejecución (hora UTC o hora local del partido según corresponda).

2. ✅ **FILTRAR PARTIDOS FUTUROS:** 
   - EXCLUYE AUTOMÁTICAMENTE cualquier partido cuya fecha/hora de inicio sea **IGUAL o ANTERIOR** a la fecha/hora actual
   - SOLO permite partidos cuya fecha/hora de inicio sea **ESTRICTAMENTE POSTERIOR** a la hora actual
   - Verifica que el partido no haya comenzado aún (incluso si es hoy pero la hora ya pasó, EXCLÚYELO)

3. 🚫 **CHECK DE SEGURIDAD DOBLE:**
   - Si la fecha del partido es "ayer" o fechas anteriores → DESCARTAR INMEDIATAMENTE
   - Si la fecha del partido es "hoy" pero la hora ya pasó → DESCARTAR INMEDIATAMENTE
   - Si el partido está en curso o finalizado → DESCARTAR INMEDIATAMENTE

4.  **MARGEN DE SEGURIDAD:** 
   - Idealmente, muestra solo partidos que comiencen dentro de al menos 2-3 horas desde el momento actual
   - Esto evita mostrar partidos que podrían empezar mientras el usuario está viendo la web

📊 **ANÁLISIS POST-VALIDACIÓN:**
Solo DESPUÉS de pasar el filtro temporal, realiza el análisis de los 5 pilares para cada partido válido:

1. 📊 Análisis Histórico y Métricas Avanzadas
2. ️ Factor Climático y Condiciones del Terreno  
3. 🚑 Auditoría de Plantillas
4. 🔥 Motivación y Contexto Táctico
5. 📱 Sentimiento y Ruido de Mercado

🎯 **SELECCIÓN FINAL:**
Selecciona EXACTAMENTE 2 a 3 PARTIDOS de Grandes Ligas que:
- ✅ HAYAN PASADO la validación temporal estricta (futuros, no iniciados)
- ✅ Tengan probabilidad matemática >75% para Over 1.5 goles
- ✅ Generen una cuota combinada entre 2.00 y 3.00
- ✅ Tengan EDGE positivo demostrado

📝 **FORMATO DE SALIDA OBLIGATORIO:**
INCLUYE al inicio del análisis esta línea de verificación:
Si NO hay partidos futuros válidos disponibles, DEBES informar:
"⚠️ ADVERTENCIA: No hay partidos futuros disponibles en este momento. Los partidos mostrados anteriormente ya han comenzado o finalizado. Intente más tarde."

La preservación de la integridad y credibilidad del servicio es la prioridad ABSOLUTA. NUNCA muestres partidos pasados.`;

// Utilidad universal para fetch con timeout (compatible con Node 18+, Vercel, Cloudflare)
async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
    const fetchFn = globalThis.fetch || (await import('node-fetch')).default;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetchFn(url, { ...options, signal: controller.signal });
        clearTimeout(timer);
        return res;
    } catch (err) {
        clearTimeout(timer);
        throw err;
    }
}

// Extrae array de API keys de una variable de entorno (soporta rotación multiclave separada por comas)
function getApiKeys(envVarName) {
    const raw = process.env[envVarName];
    if (!raw) return [];
    return raw.split(',').map(k => k.trim()).filter(Boolean);
}

// Índice global para Round-Robin de llaves por proveedor
const keyIndexes = {};

function getNextKey(envVarName) {
    const keys = getApiKeys(envVarName);
    if (keys.length === 0) return null;
    if (!keyIndexes[envVarName]) keyIndexes[envVarName] = 0;
    const key = keys[keyIndexes[envVarName] % keys.length];
    keyIndexes[envVarName] = (keyIndexes[envVarName] + 1) % keys.length;
    return key;
}

/**
 * Proveedor 1: Groq Cloud (Ultra Rápido, Llama 3.3 70B & Llama 3.1 8B)
 */
async function callGroqProvider(matchDataText, modelName) {
    const apiKey = getNextKey('GROQ_API_KEY');
    if (!apiKey) return null;

    const nowIso = new Date().toISOString();
    const url = 'https://api.groq.com/openai/v1/chat/completions';

    const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: modelName,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: `FECHA Y HORA ACTUAL DE EJECUCIÓN (UTC): ${nowIso}\n\nDATOS DE RATINGBET PARA ANALIZAR:\n\n${matchDataText}` }
            ],
            temperature: 0.2
        })
    }, 12000);

    if (!response.ok) {
        throw new Error(`Groq API error [${response.status}]: ${response.statusText}`);
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error('Groq devolvió respuesta vacía');
    return text;
}

/**
 * Proveedor 2: Google Gemini API (Direct)
 */
async function callGeminiProvider(matchDataText, modelName) {
    const apiKey = getNextKey('GEMINI_API_KEY');
    if (!apiKey) return null;

    const nowIso = new Date().toISOString();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    
    const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{
                parts: [
                    { text: SYSTEM_PROMPT },
                    { text: `FECHA Y HORA ACTUAL DE EJECUCIÓN (UTC): ${nowIso}\n\nDATOS DE RATINGBET PARA ANALIZAR:\n\n${matchDataText}` }
                ]
            }]
        })
    }, 12000);

    if (!response.ok) {
        throw new Error(`Gemini API error [${response.status}]: ${response.statusText}`);
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini devolvió respuesta vacía');
    return text;
}

/**
 * Proveedor 3: OpenRouter Free Tier
 */
async function callOpenRouterFreeProvider(matchDataText, modelName) {
    const apiKey = getNextKey('OPENROUTER_API_KEY');
    if (!apiKey) return null;

    const nowIso = new Date().toISOString();
    const url = 'https://openrouter.ai/api/v1/chat/completions';

    const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': 'https://edge.futbol',
            'X-Title': 'Bet365Edge Quant AI',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: modelName,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: `FECHA Y HORA ACTUAL DE EJECUCIÓN (UTC): ${nowIso}\n\nDATOS DE RATINGBET PARA ANALIZAR:\n\n${matchDataText}` }
            ],
            temperature: 0.2
        })
    }, 14000);

    if (!response.ok) {
        throw new Error(`OpenRouter API error [${response.status}]: ${response.statusText}`);
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error('OpenRouter devolvió respuesta vacía');
    return text;
}

/**
 * Proveedor 4: Omniroute Gateway (Multiclave)
 */
async function callOmnirouteProvider(matchDataText, modelName) {
    const apiKey = getNextKey('OMNIROUTE_API_KEY');
    if (!apiKey) return null;

    const nowIso = new Date().toISOString();
    const url = process.env.OMNIROUTE_API_URL || 'https://openrouter.ai/api/v1/chat/completions';

    const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: modelName,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: `FECHA Y HORA ACTUAL DE EJECUCIÓN (UTC): ${nowIso}\n\nDATOS DE RATINGBET PARA ANALIZAR:\n\n${matchDataText}` }
            ],
            temperature: 0.2
        })
    }, 14000);

    if (!response.ok) {
        throw new Error(`Omniroute API error [${response.status}]: ${response.statusText}`);
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error('Omniroute devolvió respuesta vacía');
    return text;
}

/**
 * Proveedor 5: Nvidia NIM API
 */
async function callNvidiaProvider(matchDataText, modelName) {
    const apiKey = getNextKey('NVIDIA_API_KEY');
    if (!apiKey) return null;

    const nowIso = new Date().toISOString();
    const url = 'https://integrate.api.nvidia.com/v1/chat/completions';

    const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: modelName,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: `FECHA Y HORA ACTUAL DE EJECUCIÓN (UTC): ${nowIso}\n\nDATOS DE RATINGBET PARA ANALIZAR:\n\n${matchDataText}` }
            ],
            temperature: 0.2
        })
    }, 14000);

    if (!response.ok) {
        throw new Error(`Nvidia NIM API error [${response.status}]: ${response.statusText}`);
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error('Nvidia NIM devolvió respuesta vacía');
    return text;
}

/**
 * Proveedor 6: Dahl Global Inference API
 */
async function callDahlProvider(matchDataText, modelName) {
    const apiKey = getNextKey('DAHL_API_KEY');
    if (!apiKey) return null;

    const nowIso = new Date().toISOString();
    const url = 'https://inference.dahl.global/v1/chat/completions';
    const fingerprint = process.env.DAHL_FINGERPRINT || '6633ef04b88e26842bdf21e13d03a32a';

    const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'x-fingerprint': fingerprint,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: modelName,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: `FECHA Y HORA ACTUAL DE EJECUCIÓN (UTC): ${nowIso}\n\nDATOS DE RATINGBET PARA ANALIZAR:\n\n${matchDataText}` }
            ],
            temperature: 0.2
        })
    }, 14000);

    if (!response.ok) {
        throw new Error(`Dahl API error [${response.status}]: ${response.statusText}`);
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error('Dahl API devolvió respuesta vacía');
    return text;
}

/**
 * Pipeline de modelos free ordenados por prioridad y velocidad
 */
const FREE_MODEL_PIPELINE = [
    { provider: 'groq', model: 'llama-3.3-70b-versatile', fn: callGroqProvider, env: 'GROQ_API_KEY' },
    { provider: 'groq', model: 'llama-3.1-8b-instant', fn: callGroqProvider, env: 'GROQ_API_KEY' },
    { provider: 'gemini', model: 'gemini-2.0-flash', fn: callGeminiProvider, env: 'GEMINI_API_KEY' },
    { provider: 'gemini', model: 'gemini-1.5-flash', fn: callGeminiProvider, env: 'GEMINI_API_KEY' },
    { provider: 'openrouter', model: 'google/gemini-2.0-flash-lite-001:free', fn: callOpenRouterFreeProvider, env: 'OPENROUTER_API_KEY' },
    { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free', fn: callOpenRouterFreeProvider, env: 'OPENROUTER_API_KEY' },
    { provider: 'omniroute', model: 'google/gemini-2.5-flash', fn: callOmnirouteProvider, env: 'OMNIROUTE_API_KEY' },
    { provider: 'nvidia', model: 'meta/llama-3.3-70b-instruct', fn: callNvidiaProvider, env: 'NVIDIA_API_KEY' },
    { provider: 'dahl', model: 'llama-3.3-70b', fn: callDahlProvider, env: 'DAHL_API_KEY' }
];

/**
 * Función principal con Rotación Automática y Failover Cascading
 */
async function callAIAnalyzer(matchDataText) {
    // Filtrar solo providers con API keys configuradas
    const availableTargets = FREE_MODEL_PIPELINE.filter(t => getApiKeys(t.env).length > 0);

    if (availableTargets.length === 0) {
        console.log('ADVERTENCIA: No hay API keys configuradas. Usando modelo cuantitativo local...');
        return null;
    }

    for (const target of availableTargets) {
        try {
            console.log(`[AI-ROUTER] Intentando llamada con ${target.provider.toUpperCase()} (${target.model})...`);
            const result = await target.fn(matchDataText, target.model);
            if (result && result.trim().length > 0) {
                console.log(`[AI-ROUTER] ✅ Éxito con proveedor ${target.provider.toUpperCase()} (${target.model})`);
                return result;
            }
        } catch (error) {
            console.warn(`[AI-ROUTER] ⚠️ Fallo en ${target.provider.toUpperCase()} (${target.model}): ${error.message}. Pasando al siguiente modelo free...`);
        }
    }

    console.error('[AI-ROUTER] ❌ Todos los proveedores de IA agotaron su cuota o fallaron. Ejecutando fallback cuantitativo local...');
    return null;
}

// Mantener función retrocompatible
async function callGeminiAI(matchDataText) {
    return await callAIAnalyzer(matchDataText);
}

export { callAIAnalyzer, callGeminiAI, SYSTEM_PROMPT };

// Soporte CommonJS retrocompatible si se importa mediante require()
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { callAIAnalyzer, callGeminiAI, SYSTEM_PROMPT };
}
