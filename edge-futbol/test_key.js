const apiKey = 'sk-238e42ad970dbbc7-9e7385-de935c2e';

async function testKey() {
    try {
        // Test endpoint de Omniroute / OpenRouter con la cabecera exacta de su documentacion
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'HTTP-Referer': 'https://ratingbet.com',
                'X-Title': 'RatingBet Quant',
                'Authorization': 'Bearer ' + apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'meta-llama/llama-3.2-1b-instruct:free',
                messages: [{ role: 'user', content: 'Responde Hola' }]
            })
        });

        const data = await res.json();
        console.log('Respuesta OpenRouter:', JSON.stringify(data, null, 2));

    } catch (e) {
        console.error('Error:', e);
    }
}

testKey();
