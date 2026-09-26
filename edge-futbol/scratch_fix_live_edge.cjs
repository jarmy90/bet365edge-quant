const fs = require('fs');
let code = fs.readFileSync('worker.js', 'utf8');

// Replace static placeholder +14.8% with dynamic —
code = code.replace(
    '<div id="liveHomeEdgeVal" style="font-family:JetBrains Mono; font-size:1.3rem; font-weight:800; color:var(--neon-emerald); transition:all 0.3s;">+14.8%</div>',
    '<div id="liveHomeEdgeVal" style="font-family:JetBrains Mono; font-size:1.3rem; font-weight:800; color:var(--text-muted); transition:all 0.3s;">—</div>'
);

// Sync liveHomeEdgeVal when parlay is loaded and invalid
code = code.replace(
    "['metricProbReal', 'metricProbHouse', 'metricEdgeNet'].forEach(function (id) {",
    "var elLive = document.getElementById('liveHomeEdgeVal'); if (elLive) { elLive.innerText = '0.0%'; elLive.style.color = 'var(--text-muted)'; }\n                    ['metricProbReal', 'metricProbHouse', 'metricEdgeNet'].forEach(function (id) {"
);

// Sync liveHomeEdgeVal when parlay is valid
code = code.replace(
    "document.getElementById('metricProbHouse').innerText = data.probabilidadCasa + '%';",
    "document.getElementById('metricProbHouse').innerText = data.probabilidadCasa + '%';\n                    var elLive = document.getElementById('liveHomeEdgeVal'); if (elLive) { elLive.innerText = (data.edgeTotal >= 0 ? '+' : '-') + Math.abs(data.edgeTotal || 0).toFixed(1) + '%'; elLive.style.color = data.edgeTotal >= 0 ? 'var(--neon-emerald)' : '#ef4444'; }"
);

fs.writeFileSync('worker.js', code);
console.log('worker.js successfully updated liveHomeEdgeVal sync!');
