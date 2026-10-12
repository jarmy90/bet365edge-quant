import worker from '../worker.js';

export const config = {
    runtime: 'edge',
};

// Valores de respaldo historicos. Solo se aplican si la variable NO existe en
// Vercel > Settings > Environment Variables. Se declaran aqui para poder
// DETECTARLOS y avisarlo en /api/health en lugar de degradar en silencio.
// NOTA v9.3: las keys de IA YA NO llevan fallback embebido (una key muerta
// tumbaba todo el edge). Si falta env, se informa y el rotador salta al
// siguiente proveedor.
const FALLBACKS = {
    STRIPE_SECRET_KEY: "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",
    STRIPE_PRICE_ID: "prod_VFk8GE0foCM9qJ",
};

export default async function handler(request) {
    // IMPORTANTE (Vercel Edge Runtime): process.env solo admite acceso ESTATICO
    // (process.env.NOMBRE). El acceso dinamico (process.env[nombre]) no se inyecta
    // en build-time y devolveria undefined, falseando el diagnostico.
    const fallbacksActivos = [];
    if (!process.env.STRIPE_SECRET_KEY) fallbacksActivos.push('STRIPE_SECRET_KEY');
    if (!process.env.STRIPE_PRICE_ID) fallbacksActivos.push('STRIPE_PRICE_ID');

    const env = {
        // --- IA: rotador multi-proveedor v9.3 ---
        // Cada var acepta lista separada por comas (round-robin + failover).
        // NUNCA poner keys reales aqui: solo en Vercel > Settings > Environment Variables.
        GROQ_API_KEY: process.env.GROQ_API_KEY || '',
        GROQ_API_KEY2: process.env.GROQ_API_KEY2 || '',
        GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
        GEMINI_API_KEY2: process.env.GEMINI_API_KEY2 || '',
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '',
        OPENROUTER_API_KEY2: process.env.OPENROUTER_API_KEY2 || '',
        OMNIROUTE_API_KEY: process.env.OMNIROUTE_API_KEY || '',
        OMNIROUTE_API_KEY2: process.env.OMNIROUTE_API_KEY2 || '',
        OMNIROUTE_API_URL: process.env.OMNIROUTE_API_URL || '',
        // Alias con el typo historico (OMNIRUTE_API_URL) por compatibilidad
        OMNIRUTE_API_URL: process.env.OMNIRUTE_API_URL || '',
        OMNIROUTE_MODEL: process.env.OMNIROUTE_MODEL || '',
        NVIDIA_API_KEY: process.env.NVIDIA_API_KEY || '',
        TOKENHARBOR_API_KEY: process.env.TOKENHARBOR_API_KEY || '',
        TOKENHARBOR_API_URL: process.env.TOKENHARBOR_API_URL || '',
        DAHL_API_KEY: process.env.DAHL_API_KEY || '',
        DAHL_API_KEY2: process.env.DAHL_API_KEY2 || '',
        DAHL_API_URL: process.env.DAHL_API_URL || '',
        DAHL_FINGERPRINT: process.env.DAHL_FINGERPRINT || '',

        // --- Stripe ---
        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || FALLBACKS.STRIPE_SECRET_KEY,
        STRIPE_PRICE_ID: process.env.STRIPE_PRICE_ID || FALLBACKS.STRIPE_PRICE_ID,

        // --- Dataset de ratingbet (scraper) ---
        // RATINGBET_DATASET_URL: URL publica (raw de GitHub, Blob, KV...) con el JSON
        // del scraper. Con ella la web recoge capturas NUEVAS sin necesidad de redeploy.
        RATINGBET_DATASET_URL: process.env.RATINGBET_DATASET_URL || '',
        // Token opcional para leer el dataset de un origen PRIVADO (p. ej. la rama
        // 'dataset' de un repositorio privado de GitHub). Se envia como Bearer.
        RATINGBET_DATASET_TOKEN: process.env.RATINGBET_DATASET_TOKEN || '',
        RATINGBET_MARGEN_MIN: process.env.RATINGBET_MARGEN_MIN || '',
        RATINGBET_VENTANA_DIAS: process.env.RATINGBET_VENTANA_DIAS || '',
        RATINGBET_MAX_ANTIGUEDAD_MIN: process.env.RATINGBET_MAX_ANTIGUEDAD_MIN || '',

        // --- Diagnostico de despliegue ---
        NODE_ENV: process.env.NODE_ENV || '',
        VERCEL_ENV: process.env.VERCEL_ENV || '',
        VERCEL_URL: process.env.VERCEL_URL || '',
        VERCEL_REGION: process.env.VERCEL_REGION || '',
        VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA || '',

        // Marca de diagnostico: que claves estan tirando de valor embebido
        __FALLBACKS_ACTIVOS: fallbacksActivos.join(',')
    };

    return worker.fetch(request, env, {});
}
