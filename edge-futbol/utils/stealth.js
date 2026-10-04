// =============================================================================
// TWITTER / X BOT STEALTH UTILITIES (v2.0)
// -----------------------------------------------------------------------------
// Genera fingerprints realistas, viewports aleatorios, retrasos humanos
// y simulación de mecanografía natural con micro-pausas.
// =============================================================================

export const VIEWPORTS = [
    { width: 1920, height: 1080 },
    { width: 1536, height: 864 },
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
    { width: 1280, height: 800 }
];

export const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0'
];

export function getRandomViewport() {
    return VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
}

export function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function randomDelay(minMs = 2200, maxMs = 5800) {
    const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return delay(ms);
}

// Simulación de mecanografía con variación de velocidad y pausas por palabras
export async function typeLikeHuman(page, selector, text) {
    await page.focus(selector);
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        await page.keyboard.sendCharacter(char);
        
        // Pausa aleatoria por carácter: 70ms - 160ms
        let charDelay = Math.floor(Math.random() * 90) + 70;
        
        // Si hay espacio o salto de línea, simular pausa de pensamiento (250ms - 500ms)
        if (char === ' ' || char === '\n') {
            charDelay += Math.floor(Math.random() * 250) + 150;
        }
        
        await delay(charDelay);
    }
}
