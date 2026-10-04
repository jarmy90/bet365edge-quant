const fs = require('fs');
const path = require('path');

const apiKey = 'sk-238e42ad970dbbc7-9e7385-de935c2e';

const SYSTEM_PROMPT = `Actúa como el Director de Análisis Cuantitativo y Scouting de un sindicato de apuestas deportivas profesionales (+EV).

⚠️ **VALIDACIÓN TEMPORAL CRÍTICA - PRIORIDAD MÁXIMA:**
ANTES de cualquier análisis, DEBES verificar OBLIGATORIAMENTE:

1.  **OBTENER FECHA/HORA ACTUAL:** Consulta la fecha y hora exacta del momento de la ejecución (hora UTC o hora local del partido según corresponda).

2. ✅ **FILTRAR PARTIDOS FUTUROS:** 
   - EXCLUYE AUTOMÁTICAMENTE cualquier partido cuya fecha/hora de inicio sea **IGUAL o ANTERIOR** a la fecha/hora actual
   - SOLO permite partidos cuya fecha/hora de inicio sea **ESTRICTAMENTE POSTERIOR** a la hora actual
   - Verifica que el partido no haya comenzado aún (incluso si es hoy pero la hora ya pasó, EXCLÚYELO)

3. 🚫 **CHECK DE SEGURIDAD DOBLE:**
   - Si la fecha del partido es "ayer" o fechas anteriores → DESCARTAR INMEDIATAMENTE
   - Si la fecha del partido es "hoy" pero la hora ya pasó → DESCARTAR INMEDIATAMENTE
   - Si el partido está en curso o finalizado → DESCARTAR INMEDIATAMENTE

4.  **MARGEN DE SEGURIDAD:** 
   - Idealmente, muestra solo partidos que comiencen dentro de al menos 2-3 horas desde el momento actual
   - Esto evita mostrar partidos que podrían empezar mientras el usuario está viendo la web

📊 **ANÁLISIS POST-VALIDACIÓN:**
Solo DESPUÉS de pasar el filtro temporal, realiza el análisis de los 5 pilares para cada partido válido:

1. 📊 Análisis Histórico y Métricas Avanzadas
2. ️ Factor Climático y Condiciones del Terreno  
3. 🚑 Auditoría de Plantillas
4. 🔥 Motivación y Contexto Táctico
5. 📱 Sentimiento y Ruido de Mercado

🎯 **SELECCIÓN FINAL:**
Selecciona EXACTAMENTE 2 a 3 PARTIDOS de Grandes Ligas que:
- ✅ HAYAN PASADO la validación temporal estricta (futuros, no iniciados)
- ✅ Tengan probabilidad matemática >75% para Over 1.5 goles
- ✅ Generen una cuota combinada entre 2.00 y 3.00
- ✅ Tengan EDGE positivo demostrado

📝 **FORMATO DE SALIDA OBLIGATORIO:**
INCLUYE al inicio del análisis esta línea de verificación:
Si NO hay partidos futuros válidos disponibles, DEBES informar:
"⚠️ ADVERTENCIA: No hay partidos futuros disponibles en este momento. Los partidos mostrados anteriormente ya han comenzado o finalizado. Intente más tarde."

La preservación de la integridad y credibilidad del servicio es la prioridad ABSOLUTA. NUNCA muestres partidos pasados.`;

async function callOmnirouteAI(matchDataText) {
    try {
        const nowIso = new Date().toISOString();
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'google/gemini-2.5-flash',
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: `FECHA Y HORA ACTUAL DE EJECUCIÓN (UTC): ${nowIso}\n\nAQUÍ TIENES LOS DATOS EXTRAÍDOS DE RATINGBET HOY:\n\n${matchDataText}` }
                ],
                temperature: 0.2
            })
        });

        const data = await response.json();
        if (data.choices && data.choices.length > 0) {
            return data.choices[0].message.content;
        }
        return null;
    } catch (e) {
        console.error('Error en la API de Omniroute/OpenRouter:', e);
        return null;
    }
}

module.exports = { callOmnirouteAI };
