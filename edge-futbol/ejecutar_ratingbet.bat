@echo off
echo ========================================================
echo   EJECUTADOR DE EXTRACCION Y ANALISIS +EV DE RATINGBET
echo ========================================================
echo.
echo 1. Abriendo navegador y extrayendo Over 1.5 y 2.5...
node scraper.js
echo.
echo 2. Estructurando datos y filtrando margenes...
node parser.js
echo.
echo 3. Ejecutando analisis cuantitativo para COMBINADA DE CUOTA 2.00 A 3.00 (+EV)...
node parlay_analyzer.js
echo.
echo ========================================================
echo   PROCESO FINALIZADO CON EXITO
echo   Resultados guardados en value_matches.json
echo ========================================================
pause
