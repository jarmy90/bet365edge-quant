// =============================================================================
// TWITTER / X BOT IMAGE GENERATOR (v2.0)
// -----------------------------------------------------------------------------
// Generador dinámico de tarjetas visuales en PNG usando HTML/Canvas en Puppeteer.
// Incluye fallback suave para no detener el bot si la imagen falla.
// =============================================================================

import fs from 'fs';
import path from 'path';

export async function generateMatchCardImage(page, fixture, outputPath) {
    try {
        const matchName = fixture.partido || `${fixture.local} vs ${fixture.visitante}`;
        const league = fixture.liga || 'Liga de Fútbol';
        const market = fixture.mercadoNombre || fixture.mercado || 'Más de 2.5 Goles';
        const odds = fixture.cuota365 || fixture.cuota || '1.90';
        const edge = fixture.edgeFormat || `+${fixture.edgeNum || 5.0}%`;
        const dateStr = fixture.horaLabel || `${fixture.dia || 'Hoy'} ${fixture.hora || ''}`;

        const cardHtml = `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body { margin:0; padding:0; width:1200px; height:675px; background:#06070a; font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color:#fff; display:flex; flex-direction:column; justify-content:space-between; box-sizing:border-box; padding:50px; }
                .badge { display:inline-block; background:rgba(13,242,166,0.15); border:1.5px solid #0df2a6; color:#0df2a6; font-weight:800; font-size:22px; padding:8px 20px; border-radius:12px; letter-spacing:1px; }
                .league { font-size:24px; color:#94a3b8; font-weight:600; text-transform:uppercase; margin-top:15px; }
                .title { font-size:52px; font-weight:900; margin:15px 0 25px 0; color:#ffffff; line-height:1.1; }
                .metrics-grid { display:grid; grid-template-columns:1fr 1fr; gap:25px; margin-bottom:20px; }
                .metric-box { background:#0d0f15; border:1px solid rgba(255,255,255,0.1); border-radius:20px; padding:25px; text-align:center; }
                .metric-label { font-size:20px; color:#64748b; font-weight:700; margin-bottom:8px; text-transform:uppercase; }
                .metric-val { font-size:48px; font-weight:900; font-family:monospace; }
                .footer { display:flex; justify-content:space-between; align-items:center; border-top:1px solid rgba(255,255,255,0.1); padding-top:25px; font-size:22px; color:#94a3b8; }
                .brand { color:#0df2a6; font-weight:900; font-size:28px; }
            </style>
        </head>
        <body>
            <div>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span class="badge">🔥 +EV VALUE BETTING</span>
                    <span style="color:#64748b; font-size:22px; font-weight:700;">${dateStr}</span>
                </div>
                <div class="league">${league}</div>
                <div class="title">${matchName}</div>
            </div>

            <div class="metrics-grid">
                <div class="metric-box">
                    <div class="metric-label">Mercado Selección</div>
                    <div class="metric-val" style="color:#00d4ff;">${market}</div>
                </div>
                <div class="metric-box">
                    <div class="metric-label">Cuota / Ventaja (+EV)</div>
                    <div class="metric-val" style="color:#0df2a6;">${odds} <span style="font-size:32px;">(${edge})</span></div>
                </div>
            </div>

            <div class="footer">
                <span>Análisis cuantitativo libre en tiempo real</span>
                <span class="brand">EDGE.FUTBOL</span>
            </div>
        </body>
        </html>`;

        await page.setViewport({ width: 1200, height: 675 });
        await page.setContent(cardHtml, { waitUntil: 'load' });
        await page.screenshot({ path: outputPath, type: 'png' });
        return outputPath;
    } catch (err) {
        console.warn(`[WARN] No se pudo generar la tarjeta de imagen: ${err.message}. Se publicará sólo texto.`);
        if (fs.existsSync(outputPath)) {
            try { fs.unlinkSync(outputPath); } catch (_) {}
        }
        return null;
    }
}
