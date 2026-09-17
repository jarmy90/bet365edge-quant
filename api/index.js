import worker from '../worker.js';

export const config = {
    runtime: 'edge',
};

// Valores de respaldo historicos. Solo se aplican si la variable NO existe en
// Vercel > Settings > Environment Variables. Se declaran aqui para poder
// DETECTARLOS y avisarlo en /api/health en lugar de degradar en silencio.
const FALLBACKS = {
    STRIPE_SECRET_KEY: "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",
    STRIPE_PRICE_ID: "prod_VFk8GE0foCM9qJ",
    // OpenRouter real key — probada y funciona para llamadas a /chat/completions
    OPENROUTER_API_KEY: "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",
    // Omniroute key (rotador de modelos gratuitos) — usa su propio endpoint si OMNIROUTE_API_URL esta definida
    OMNIROUTE_API_KEY: "sk-238e42ad970dbbc7-1bddd1-ede9145e"
};

export default async function handler(request) {
    // IMPORTANTE (Vercel Edge Runtime): process.env solo admite acceso ESTATICO
    // (process.env.NOMBRE). El acceso dinamico (process.env[nombre]) no se inyecta
    // en build-time y devolveria undefined, falseando el diagnostico.
    const fallbacksActivos = [];
    if (!process.env.STRIPE_SECRET_KEY) fallbacksActivos.push('STRIPE_SECRET_KEY');
    if (!process.env.STRIPE_PRICE_ID) fallbacksActivos.push('STRIPE_PRICE_ID');
    if (!process.env.OPENROUTER_API_KEY) fallbacksActivos.push('OPENROUTER_API_KEY');
    if (!process.env.OMNIROUTE_API_KEY) fallbacksActivos.push('OMNIROUTE_API_KEY');

    const env = {
        // --- IA: agente Omniroute / OpenRouter ---
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || FALLBACKS.OPENROUTER_API_KEY,
        OMNIROUTE_API_KEY: process.env.OMNIROUTE_API_KEY || FALLBACKS.OMNIROUTE_API_KEY,
        OMNIROUTE_API_URL: process.env.OMNIROUTE_API_URL || '',
        // Alias con el typo historico (OMNIRUTE_API_URL) por compatibilidad
        OMNIRUTE_API_URL: process.env.OMNIRUTE_API_URL || '',

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
