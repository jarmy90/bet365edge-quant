import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

// Clave API de Gemini (se lee de variables de entorno)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

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

async function callGeminiAI(matchDataText) {
    if (!GEMINI_API_KEY) {
        console.log('ADVERTENCIA: No se detectó GEMINI_API_KEY. Usando modelo cuantitativo algorítmico local...');
        return null;
    }

    try {
        const nowIso = new Date().toISOString();
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: SYSTEM_PROMPT },
                        { text: `FECHA Y HORA ACTUAL DE EJECUCIÓN (UTC): ${nowIso}\n\nDATOS DE RATINGBET PARA ANALIZAR:\n\n${matchDataText}` }
                    ]
                }]
            })
        });

        const data = await response.json();
        return data.candidates[0].content.parts[0].text;
    } catch (e) {
        console.error('Error invocando Gemini API:', e);
        return null;
    }
}

// Exportar función para integrar en el servidor/bot
module.exports = { callGeminiAI };
