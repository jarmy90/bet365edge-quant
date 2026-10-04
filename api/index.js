import worker from '../edge-futbol/worker.js';

export const config = {
    runtime: 'edge',
};

// Las claves reales se configuran en Vercel Dashboard > Settings > Environment Variables
// NO incluir claves reales aqui — GitHub las detecta y bloquea el push (secret scanning)
// Configura en Vercel: GROQ_API_KEY, GROQ_API_KEY2, GEMINI_API_KEY, GEMINI_API_KEY2,
// OMNIROUTE_API_KEY, OMNIROUTE_API_KEY2, OPENROUTER_API_KEY, TOKENHARBOR_API_KEY,
// NVIDIA_API_KEY, DAHL_API_KEY, DAHL_API_KEY2, DAHL_FINGERPRINT,
// STRIPE_SECRET_KEY, STRIPE_PRICE_ID

export default async function handler(request) {
    const env = {
        // ── Stripe ────────────────────────────────────────────────────────────
        STRIPE_SECRET_KEY:            process.env.STRIPE_SECRET_KEY      || '',
        STRIPE_PRICE_ID:              process.env.STRIPE_PRICE_ID        || '',
        STRIPE_PUBLISHABLE_KEY:       process.env.STRIPE_PUBLISHABLE_KEY || '',

        // ── Groq Cloud ────────────────────────────────────────────────────────
        GROQ_API_KEY:                 process.env.GROQ_API_KEY           || '',
        GROQ_API_KEY2:                process.env.GROQ_API_KEY2          || '',

        // ── Google Gemini ─────────────────────────────────────────────────────
        GEMINI_API_KEY:               process.env.GEMINI_API_KEY         || '',
        GEMINI_API_KEY2:              process.env.GEMINI_API_KEY2        || '',
        GEMINI_MODEL:                 process.env.GEMINI_MODEL           || 'gemini-2.0-flash',

        // ── Omniroute (via OpenRouter) ────────────────────────────────────────
        OMNIROUTE_API_KEY:            process.env.OMNIROUTE_API_KEY      || '',
        OMNIROUTE_API_KEY2:           process.env.OMNIROUTE_API_KEY2     || '',
        OMNIROUTE_API_URL:            process.env.OMNIROUTE_API_URL      || 'https://openrouter.ai/api/v1/chat/completions',
        OMNIRUTE_API_URL:             process.env.OMNIRUTE_API_URL       || '',
        OMNIROUTE_MODEL:              process.env.OMNIROUTE_MODEL        || 'google/gemini-2.5-flash',

        // ── OpenRouter ────────────────────────────────────────────────────────
        OPENROUTER_API_KEY:           process.env.OPENROUTER_API_KEY     || '',

        // ── TokenHarbor ───────────────────────────────────────────────────────
        TOKENHARBOR_API_KEY:          process.env.TOKENHARBOR_API_KEY    || '',
        TOKENHARBOR_API_URL:          process.env.TOKENHARBOR_API_URL    || 'https://api.tokenharbor.ai/v1/chat/completions',

        // ── Nvidia NIM ────────────────────────────────────────────────────────
        NVIDIA_API_KEY:               process.env.NVIDIA_API_KEY         || '',

        // ── Dahl Global Inference ─────────────────────────────────────────────
        DAHL_API_KEY:                 process.env.DAHL_API_KEY           || '',
        DAHL_API_KEY2:                process.env.DAHL_API_KEY2          || '',
        DAHL_FINGERPRINT:             process.env.DAHL_FINGERPRINT       || '',
        DAHL_FINGERPRINT2:            process.env.DAHL_FINGERPRINT2      || '',

        // ── Dataset ratingbet ─────────────────────────────────────────────────
        RATINGBET_DATASET_URL:        process.env.RATINGBET_DATASET_URL        || '',
        RATINGBET_DATASET_TOKEN:      process.env.RATINGBET_DATASET_TOKEN      || '',
        RATINGBET_MARGEN_MIN:         process.env.RATINGBET_MARGEN_MIN         || '',
        RATINGBET_VENTANA_DIAS:       process.env.RATINGBET_VENTANA_DIAS       || '',
        RATINGBET_MAX_ANTIGUEDAD_MIN: process.env.RATINGBET_MAX_ANTIGUEDAD_MIN || '',

        // ── Vercel meta ───────────────────────────────────────────────────────
        NODE_ENV:                     process.env.NODE_ENV            || '',
        VERCEL_ENV:                   process.env.VERCEL_ENV          || '',
        VERCEL_URL:                   process.env.VERCEL_URL          || '',
        VERCEL_REGION:                process.env.VERCEL_REGION       || '',
        VERCEL_GIT_COMMIT_SHA:        process.env.VERCEL_GIT_COMMIT_SHA || '',
    };

    return worker.fetch(request, env, {});
}
