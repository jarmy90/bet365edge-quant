import worker from '../edge-futbol/worker.js';

export const config = {
    runtime: 'edge',
};

const FALLBACKS = {
    STRIPE_SECRET_KEY: "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",
    STRIPE_PRICE_ID: "prod_VFk8GE0foCM9qJ",
    OPENROUTER_API_KEY: "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",
    OMNIROUTE_API_KEY: "sk-238e42ad970dbbc7-1bddd1-ede9145e"
};

export default async function handler(request) {
    const fallbacksActivos = [];
    if (!process.env.STRIPE_SECRET_KEY) fallbacksActivos.push('STRIPE_SECRET_KEY');
    if (!process.env.STRIPE_PRICE_ID) fallbacksActivos.push('STRIPE_PRICE_ID');
    if (!process.env.OPENROUTER_API_KEY) fallbacksActivos.push('OPENROUTER_API_KEY');
    if (!process.env.OMNIROUTE_API_KEY) fallbacksActivos.push('OMNIROUTE_API_KEY');

    const env = {
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || FALLBACKS.OPENROUTER_API_KEY,
        OMNIROUTE_API_KEY: process.env.OMNIROUTE_API_KEY || FALLBACKS.OMNIROUTE_API_KEY,
        OMNIROUTE_API_URL: process.env.OMNIROUTE_API_URL || '',
        OMNIRUTE_API_URL: process.env.OMNIRUTE_API_URL || '',
        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || FALLBACKS.STRIPE_SECRET_KEY,
        STRIPE_PRICE_ID: process.env.STRIPE_PRICE_ID || FALLBACKS.STRIPE_PRICE_ID,
        RATINGBET_DATASET_URL: process.env.RATINGBET_DATASET_URL || '',
        RATINGBET_DATASET_TOKEN: process.env.RATINGBET_DATASET_TOKEN || '',
        RATINGBET_MARGEN_MIN: process.env.RATINGBET_MARGEN_MIN || '',
        RATINGBET_VENTANA_DIAS: process.env.RATINGBET_VENTANA_DIAS || '',
        RATINGBET_MAX_ANTIGUEDAD_MIN: process.env.RATINGBET_MAX_ANTIGUEDAD_MIN || '',
        NODE_ENV: process.env.NODE_ENV || '',
        VERCEL_ENV: process.env.VERCEL_ENV || '',
        VERCEL_URL: process.env.VERCEL_URL || '',
        VERCEL_REGION: process.env.VERCEL_REGION || '',
        VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA || '',
        __FALLBACKS_ACTIVOS: fallbacksActivos.join(',')
    };

    return worker.fetch(request, env, {});
}
