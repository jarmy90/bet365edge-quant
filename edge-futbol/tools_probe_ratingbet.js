// DIAGNOSTICO: ?por que el API no puede leer ratingbet?
// Uso: node tools_probe_ratingbet.js
import fs from 'fs';

const URL_15 = 'https://ratingbet.com/football/goals-over-under-1-5/';
const URL_25 = 'https://ratingbet.com/football/goals-over-under/';

const HEADERS_BOT = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };
const HEADERS_NAV = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0'
};

async function probe(nombre, url, headers) {
    const t0 = Date.now();
    try {
        const res = await fetch(url, { headers, redirect: 'follow' });
        const html = await res.text();
        const ms = Date.now() - t0;
        const server = res.headers.get('server') || '-';
        const ct = res.headers.get('content-type') || '-';
        const cfMitigated = res.headers.get('cf-mitigated') || '-';
        console.log(`\n[${nombre}] ${url}`);
        console.log(`  HTTP ${res.status} | server=${server} | type=${ct} | bytes=${html.length} | ${ms}ms | cf-mitigated=${cfMitigated}`);
        console.log(`  title-match: ${(html.match(/<title[^>]*>([\s\S]{0,120}?)<\/title>/i) || [, '-'])[1]}`);
        console.log(`  cf-challenge: ${/Just a moment|cf-challenge|__cf_chl|Verificaci/i.test(html)}`);
        console.log(`  wp-json: ${/wp-json/i.test(html)} | generator: ${(html.match(/name="generator" content="([^"]+)"/i) || [, '-'])[1]}`);
        console.log(`  showmore: ${/show\s*more|load\s*more|cargar\s*m[aá]s/i.test(html)}`);
        console.log(`  primeras etiquetas: ${(html.slice(0, 400).replace(/\s+/g, ' '))}`);
        const candidatos = [...new Set(html.match(/https?:\/\/[^"'\s)]*(api|ajax|json)[^"'\s)]*/gi) || [])].slice(0, 20);
        console.log(`  urls api/json encontradas (${candidatos.length}):`);
        candidatos.forEach(u => console.log(`     ${u}`));
        return { nombre, url, status: res.status, html, headers: Object.fromEntries(res.headers.entries()) };
    } catch (e) {
        console.log(`\n[${nombre}] ${url}`);
        console.log(`  EXCEPCION: ${e.message}`);
        return { nombre, url, status: 0, html: '', error: e.message };
    }
}

const r1 = await probe('1.5 / UA-chrome120', URL_15, HEADERS_BOT);
const r2 = await probe('2.5 / UA-chrome120', URL_25, HEADERS_BOT);
const r3 = await probe('1.5 / navegacion-completa', URL_15, HEADERS_NAV);

// Endpoints tipicos que podrian alimentar el "Show more"
const extras = [
    'https://ratingbet.com/wp-json/',
    'https://ratingbet.com/wp-json/wp/v2/pages?search=goals',
    'https://ratingbet.com/sitemap_index.xml',
    'https://ratingbet.com/robots.txt'
];
for (const u of extras) {
    await probe('extra', u, HEADERS_NAV);
}

fs.writeFileSync('tools_probe_1_5.html', r1.html || '', 'utf-8');
fs.writeFileSync('tools_probe_2_5.html', r3.html || r2.html || '', 'utf-8');
console.log('\nHTML guardado en tools_probe_1_5.html y tools_probe_2_5.html');
