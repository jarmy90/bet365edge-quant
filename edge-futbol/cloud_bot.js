import fetch from 'node-fetch';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'sk-238e42ad970dbbc7-9e7385-de935c2e';

const RATINGBET_URL_15 = 'https://ratingbet.com/football/goals-over-under-1-5/';
const RATINGBET_URL_25 = 'https://ratingbet.com/football/goals-over-under/';

// Función para scraping ligero sin necesidad de browser GUI (Apto para servidores gratuitos en la nube)
async function fetchRatingBetText(url) {
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        const html = await response.text();
        // Limpiar HTML para dejar solo texto visible
        return html.replace(/<script\b[^<]*>([\s\S]*?)<\/script>/gi, '')
                   .replace(/<style\b[^<]*>([\s\S]*?)<\/style>/gi, '')
                   .replace(/<[^>]+>/g, '\n')
                   .replace(/\n\s*\n/g, '\n');
    } catch (e) {
        return '';
    }
}

async function runCloudBot() {
    console.log('[CLOUD BOT 24/7] Iniciando extracción autónoma de RatingBet...');
    const t15 = await fetchRatingBetText(RATINGBET_URL_15);
    const t25 = await fetchRatingBetText(RATINGBET_URL_25);

    const combined = (t15 + '\n' + t25).slice(0, 5000);

    console.log('[CLOUD BOT 24/7] Invocando la IA Omniroute para calcular la combinada +EV...');

    const nowIso = new Date().toISOString();
    const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [
                {
                    role: 'system',
                    content: `Actúa como el Director de Análisis Cuantitativo y Scouting de un sindicato de apuestas deportivas profesionales (+EV).

⚠️ **VALIDACIÓN TEMPORAL CRÍTICA - PRIORIDAD MÁXIMA:**
ANTES de cualquier análisis, DEBES verificar OBLIGATORIAMENTE:
1. OBTENER FECHA/HORA ACTUAL (UTC / local).
2. FILTRAR PARTIDOS FUTUROS (EXCLUYE partidos pasados, iniciados o finalizados; exige inicio estrictamente posterior a la hora actual con margen de 2-3 horas).
3. CHECK DE SEGURIDAD DOBLE (descarter ayer/pasados).
4. MARGEN DE SEGURIDAD (inicio en al menos 2-3 horas).

ANÁLISIS POST-VALIDACIÓN (5 Pilares) -> SELECCIÓN FINAL 2-3 partidos con cuota 2.00-3.00 y prob >75%.
Si no hay partidos futuros válidos, informa:
"⚠️ ADVERTENCIA: No hay partidos futuros disponibles en este momento. Los partidos mostrados anteriormente ya han comenzado o finalizado. Intente más tarde."`
                },
                {
                    role: 'user',
                    content: `FECHA Y HORA ACTUAL DE EJECUCIÓN: ${nowIso}\n\nDATOS DE RATINGBET HOY:\n${combined}`
                }
            ]
        })
    });

    const aiData = await aiRes.json();
    const resultText = aiData.choices[0].message.content;

    console.log('\n--- RESULTADO GENERADO EN LA NUBE (ACCESIBLE DESDE EL MÓVIL 24/7) ---');
    console.log(resultText);
}

runCloudBot();
