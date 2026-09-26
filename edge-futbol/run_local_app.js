import http from 'http';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';

import worker from './worker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

const server = http.createServer(async (req, res) => {
    try {
        const fullUrl = `http://${req.headers.host || 'localhost:3000'}${req.url}`;
        
        let body = null;
        if (req.method === 'POST') {
            const buffers = [];
            for await (const chunk of req) {
                buffers.push(chunk);
            }
            body = Buffer.concat(buffers).toString();
        }

        const requestOptions = {
            method: req.method,
            headers: req.headers
        };
        if (body && req.method !== 'GET' && req.method !== 'HEAD') {
            requestOptions.body = body;
        }

        const workerRequest = new Request(fullUrl, requestOptions);
        const dummyEnv = {
            STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "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",
            STRIPE_PRICE_ID: process.env.STRIPE_PRICE_ID || "prod_VFk8GE0foCM9qJ",
            // IA (opcional en local: sin clave, los picks se etiquetan con la
            // probabilidad del tip de ratingbet o la justa de mercado)
            OMNIROUTE_API_KEY: process.env.OMNIROUTE_API_KEY || '',
            OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '',
            OMNIROUTE_API_URL: process.env.OMNIROUTE_API_URL || '',
            OMNIROUTE_MODEL: process.env.OMNIROUTE_MODEL || '',
            // Dataset del scraper: con esta variable se prueba en local el MISMO
            // camino de "actualizar sin redeploy" que se usara en Vercel.
            RATINGBET_DATASET_URL: process.env.RATINGBET_DATASET_URL || '',
            RATINGBET_MARGEN_MIN: process.env.RATINGBET_MARGEN_MIN || '',
            RATINGBET_VENTANA_DIAS: process.env.RATINGBET_VENTANA_DIAS || '',
            RATINGBET_MAX_ANTIGUEDAD_MIN: process.env.RATINGBET_MAX_ANTIGUEDAD_MIN || '',
            NODE_ENV: process.env.NODE_ENV || 'development'
        };

        const workerResponse = await worker.fetch(workerRequest, dummyEnv, {});

        for (const [key, value] of workerResponse.headers.entries()) {
            res.setHeader(key, value);
        }

        res.statusCode = workerResponse.status;
        const responseText = await workerResponse.text();
        res.end(responseText);

    } catch (err) {
        console.error('Server Request Error:', err);
        res.statusCode = 500;
        res.end('Server Error: ' + err.message);
    }
});

server.listen(PORT, '0.0.0.0', () => {
    const localUrl = `http://localhost:${PORT}`;
    console.log(`\n======================================================`);
    console.log(` 🚀 BET365EDGE TERMINAL ACTIVO`);
    console.log(` 🌐 URL Local: ${localUrl}`);
    console.log(`======================================================\n`);

    const startCmd = process.platform === 'win32' ? `start ${localUrl}` : `open ${localUrl}`;
    exec(startCmd);
});
