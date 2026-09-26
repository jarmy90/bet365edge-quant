// DIAGNOSTICO 5: ?el navegador puede cargar OTROS sitios? (aislar red local vs Cloudflare del objetivo)
// Uso: node tools_probe_dom5.js
import puppeteer from 'puppeteer-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const OBJETIVOS = [
    'https://example.com/',
    'https://www.google.com/',
    'https://www.cloudflare.com/',
    'https://ratingbet.com/robots.txt',
    'https://ratingbet.com/football/goals-over-under-1-5/'
];

const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    defaultViewport: { width: 1366, height: 850 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
});

for (const url of OBJETIVOS) {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    try {
        const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        console.log(`${url}\n   -> HTTP ${res ? res.status() : '?'} | titulo="${(await page.title()).slice(0, 60)}"`);
    } catch (e) {
        console.log(`${url}\n   -> FALLO: ${e.message.slice(0, 80)}`);
    }
    await page.close().catch(() => {});
    await new Promise(r => setTimeout(r, 3000));
}
await browser.close();
console.log('FIN');