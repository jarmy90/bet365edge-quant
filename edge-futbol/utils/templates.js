// =============================================================================
// TWITTER / X BOT TEMPLATES ENGINE (v2.0)
// -----------------------------------------------------------------------------
// 6 Estilos de publicación completamente diferenciados para evitar la detección
// de patrones repetitivos por parte de la plataforma X.
// =============================================================================

export const TEMPLATES = [
    // 1. Estilo "Alerta"
    {
        id: 'alerta',
        format: (f) => `🚨 ALERTA DE VALOR EN DIRECTO (+EV)

⚽ ${f.match} ${f.league ? `(${f.league})` : ''}
🎯 Mercado: ${f.market}
💰 Cuota (bet365 y otras casas): ${f.odds}
📈 Ventaja Cuantitativa: ${f.edge}

Análisis cuantitativo completo 24/7:
👉 https://edge.futbol

#ApuestasDeportivas #Futbol #Picks`
    },

    // 2. Estilo "Análisis Corto"
    {
        id: 'analisis_corto',
        format: (f) => `📊 Análisis Cuantitativo de Hoy

Encontrado valor relevante en el mercado de goles:
⚽ Partido: ${f.match}
🟢 Selección: ${f.market}
💵 Cuota disponible: ${f.odds} | Edge: ${f.edge}

Revisa todos los datos en directo:
👉 https://edge.futbol

#ValueBetting #Apuestas #Futbol`
    },

    // 3. Estilo "Edge Detectado"
    {
        id: 'edge_detectado',
        format: (f) => `⚡ EDGE DETECTADO (+EV)

📌 ${f.match}
▫️ Mercado: ${f.market}
▫️ Precio: ${f.odds}
▫️ Desfase (+EV): ${f.edge}

El bot autónomo rastrea cuotas 24/7 en:
👉 https://edge.futbol

#Bet365 #Apuestas #PicksDeportivos`
    },

    // 4. Estilo "Técnico / Modelo"
    {
        id: 'tecnico',
        format: (f) => `🧠 Modelo Estadístico EDGE.FUTBOL

El algoritmo Poisson/xG ha aislado ventaja matemática en:
⚽ ${f.match}
🎯 Mercado: ${f.market} @ ${f.odds} (Edge ${f.edge})

Auditoría en tiempo real libre:
👉 https://edge.futbol

#Analytics #SoccerQuant #ApuestasConVentaja`
    },

    // 5. Estilo "Pregunta"
    {
        id: 'pregunta',
        format: (f) => `🔥 ¿Ves valor en este partido de hoy?

El motor cuantitativo señala ventaja positiva (+EV):
⚽ ${f.match}
📈 Mercado: ${f.market}
💰 Cuota: ${f.odds} (${f.edge} EV)

Ver gráfica de evolución del Edge:
👉 https://edge.futbol

#Futbol #Pronosticos #Bet365`
    },

    // 6. Estilo "Minimalista"
    {
        id: 'minimalista',
        format: (f) => `🟢 SEÑAL QUANT +EV

${f.match}
${f.market} · Cuota ${f.odds} · Edge ${f.edge}

https://edge.futbol`
    }
];

export function getRandomTemplate(fixture) {
    const templateObj = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
    const match = fixture.partido || `${fixture.local} vs ${fixture.visitante}`;
    const market = fixture.mercadoNombre || fixture.mercado || 'Más de 2.5 Goles';
    const odds = fixture.cuota365 || fixture.cuota || '1.90';
    const edge = fixture.edgeFormat || `+${fixture.edgeNum || 5.0}%`;
    const league = fixture.ligaShort || fixture.liga || '';

    return templateObj.format({ match, market, odds, edge, league });
}
