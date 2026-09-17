const apiKey = 'sk-238e42ad970dbbc7-9e7385-de935c2e';

async function testOmniroute() {
    const endpoints = [
        { name: 'OpenRouter standard', url: 'https://openrouter.ai/api/v1/chat/completions' },
        { name: 'Omniroute direct', url: 'https://api.omniroute.ai/v1/chat/completions' },
        { name: 'Omniroute alt', url: 'https://omniroute.ai/api/v1/chat/completions' }
    ];

    for (const ep of endpoints) {
        try {
            console.log(`\nProbando endpoint ${ep.name}...`);
            const res = await fetch(ep.url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'google/gemini-2.5-flash',
                    messages: [{ role: 'user', content: 'test' }]
                })
            });
            console.log(`Status: ${res.status}`);
            const txt = await res.text();
            console.log(`Body: ${txt.slice(0, 200)}`);
        } catch (e) {
            console.log(`Error en ${ep.name}:`, e.message);
        }
    }
}

testOmniroute();
