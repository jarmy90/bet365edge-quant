import { callAIAnalyzer } from './ai_analyzer.js';
import assert from 'assert';

console.log('=== TEST DE ROTACIÓN DE ROUTER LLM FREE ===');

// Guardar keys actuales
const envBackup = {
    GEMINI: process.env.GEMINI_API_KEY,
    GROQ: process.env.GROQ_API_KEY,
    OPENROUTER: process.env.OPENROUTER_API_KEY,
    MISTRAL: process.env.MISTRAL_API_KEY
};

try {
    // Test 1: Sin keys configuradas -> Fallback local cuantitativo
    delete process.env.GEMINI_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.MISTRAL_API_KEY;

    const resNoKeys = await callAIAnalyzer("PARTIDO: Real Madrid vs Barcelona - 21:00 UTC");
    assert.strictEqual(resNoKeys, null, "Debe retornar null cuando no hay keys para activar el fallback cuantitativo local");
    console.log('✅ Test 1 Superado: Fallback cuantitativo local activado en ausencia de API Keys');

    // Test 2: Simulación de failover con keys inválidas -> debe probar proveedores en cascada y terminar en null sin crash
    process.env.GEMINI_API_KEY = "invalid_gemini_key";
    process.env.GROQ_API_KEY = "invalid_groq_key";
    process.env.OPENROUTER_API_KEY = "invalid_openrouter_key";

    const resFailover = await callAIAnalyzer("PARTIDO: Arsenal vs Chelsea - 20:00 UTC");
    assert.strictEqual(resFailover, null, "Debe fallar limpiamente a null tras agotar todos los intentos");
    console.log('✅ Test 2 Superado: Cascading failover maneja errores de cuota/keys sin romper la app');

    console.log('=== TODOS LOS TESTS PASARON EXITOSAMENTE ===');
} finally {
    // Restaurar env
    if (envBackup.GEMINI) process.env.GEMINI_API_KEY = envBackup.GEMINI;
    if (envBackup.GROQ) process.env.GROQ_API_KEY = envBackup.GROQ;
    if (envBackup.OPENROUTER) process.env.OPENROUTER_API_KEY = envBackup.OPENROUTER;
    if (envBackup.MISTRAL) process.env.MISTRAL_API_KEY = envBackup.MISTRAL;
}
