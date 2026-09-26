import fs from 'fs';

let code = fs.readFileSync('worker.js', 'utf8');

// 1. Initial edgeHistory initialization
code = code.replace(
    'var edgeHistory = [12.1, 12.4, 12.8, 13.2, 12.9, 13.5, 14.1, 13.8, 14.2, 14.8];',
    'window.__currentRealEdge = 0;\n        var edgeHistory = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];'
);

// 2. Chart scale min/max
code = code.replace(
    'min: 8,\n                            max: 18',
    'min: -5,\n                            max: 25'
);

// 3. Update tickHomeLiveEngine to use real edge
const searchEngine = `            if(homeChart) {
                var lastVal = edgeHistory[edgeHistory.length - 1];
                var newVal = parseFloat((lastVal + spike).toFixed(1));
                if(newVal < 9.8) newVal = 11.2;
                if(newVal > 18.2) newVal = 17.5;

                edgeHistory.shift();
                edgeHistory.push(newVal);

                timeLabels.shift();
                timeLabels.push(timeStr.substring(0, 5));

                homeChart.data.labels = timeLabels;
                homeChart.data.datasets[0].data = edgeHistory;
                homeChart.update('none');

                var edgeDisplay = document.getElementById('liveHomeEdgeVal');
                if(edgeDisplay) {
                    edgeDisplay.textContent = '+' + newVal + '%';
                    edgeDisplay.style.transform = 'scale(1.15)';
                    edgeDisplay.style.color = newVal >= lastVal ? '#0df2a6' : '#00d4ff';
                    setTimeout(function(){ edgeDisplay.style.transform = 'scale(1)'; }, 300);
                }
            }`;

const replaceEngine = `            if(homeChart) {
                var baseEdge = (typeof window !== 'undefined' && Number.isFinite(window.__currentRealEdge)) ? window.__currentRealEdge : 0;
                var newVal = baseEdge > 0 ? parseFloat((baseEdge + (Math.random() - 0.5) * 0.2).toFixed(1)) : 0;

                edgeHistory.shift();
                edgeHistory.push(newVal);

                timeLabels.shift();
                timeLabels.push(timeStr.substring(0, 5));

                homeChart.data.labels = timeLabels;
                homeChart.data.datasets[0].data = edgeHistory;
                homeChart.update('none');

                var edgeDisplay = document.getElementById('liveHomeEdgeVal');
                if(edgeDisplay) {
                    if (baseEdge > 0) {
                        edgeDisplay.textContent = '+' + newVal.toFixed(1) + '%';
                        edgeDisplay.style.color = '#0df2a6';
                    } else {
                        edgeDisplay.textContent = '0.0%';
                        edgeDisplay.style.color = 'var(--text-muted)';
                    }
                }
            }`;

code = code.replace(searchEngine, replaceEngine);

// 4. Update cargarParlay to set window.__currentRealEdge
const searchParlayEdge = `var edgeNetVal = Number.isFinite(data.edgeTotal) ? data.edgeTotal : 0;
                    var elEdge = document.getElementById('metricEdgeNet');
                    if (elEdge) {
                        elEdge.innerText = (edgeNetVal >= 0 ? '+' : '-') + Math.abs(edgeNetVal).toFixed(1) + '%';
                        elEdge.style.color = edgeNetVal >= 0 ? 'var(--neon-emerald)' : '#ef4444';
                    }
                    var elLive = document.getElementById('liveHomeEdgeVal'); if (elLive) { elLive.innerText = (data.edgeTotal >= 0 ? '+' : '-') + Math.abs(data.edgeTotal || 0).toFixed(1) + '%'; elLive.style.color = data.edgeTotal >= 0 ? 'var(--neon-emerald)' : '#ef4444'; }`;

const replaceParlayEdge = `var edgeNetVal = Number.isFinite(data.edgeTotal) ? data.edgeTotal : 0;
                    if (typeof window !== 'undefined') window.__currentRealEdge = (esCombinadaValida && edgeNetVal >= 0) ? edgeNetVal : 0;
                    var elEdge = document.getElementById('metricEdgeNet');
                    if (elEdge) {
                        elEdge.innerText = (edgeNetVal >= 0 ? '+' : '-') + Math.abs(edgeNetVal).toFixed(1) + '%';
                        elEdge.style.color = edgeNetVal >= 0 ? 'var(--neon-emerald)' : '#ef4444';
                    }
                    var elLive = document.getElementById('liveHomeEdgeVal');
                    if (elLive) {
                        if (esCombinadaValida && edgeNetVal >= 0) {
                            elLive.innerText = '+' + edgeNetVal.toFixed(1) + '%';
                            elLive.style.color = 'var(--neon-emerald)';
                        } else {
                            elLive.innerText = '0.0%';
                            elLive.style.color = 'var(--text-muted)';
                        }
                    }`;

code = code.replace(searchParlayEdge, replaceParlayEdge);

fs.writeFileSync('worker.js', code);
console.log('worker.js updated successfully with real edge chart loop!');
