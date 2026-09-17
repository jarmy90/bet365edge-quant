# =============================================================================
# CICLO DE CAPTURA (lo que ejecuta la tarea programada de Windows)
# -----------------------------------------------------------------------------
# Ejecuta el scraper + publicador y deja traza en captura_ratingbet.log.
# No se lanza a mano salvo para probar: lo invoca tools_programar_captura.ps1.
#
# PRUEBA RAPIDA (sin red, reutiliza el dataset actual):
#   powershell -NoProfile -File tools_captura_ciclo.ps1 -Modo info -SinScrape
# =============================================================================
param(
    [ValidateSet('gist', 'fichero', 'info')][string]$Modo = 'info',
    [string]$GistId = '',
    [string]$Token = '',
    [string]$Destino = '',
    [int]$Dias = 2,
    [switch]$SinScrape
)

$ErrorActionPreference = 'Continue'
Set-Location -Path $PSScriptRoot

$log = Join-Path $PSScriptRoot 'captura_ratingbet.log'
$sello = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    "[$sello] ERROR: 'node' no esta en el PATH de la tarea programada." | Add-Content $log
    exit 1
}

$argumentos = @('tools_publicar_dataset.js', "--modo=$Modo", "--dias=$Dias")
if ($GistId)    { $argumentos += "--gist=$GistId" }
if ($Token)     { $argumentos += "--token=$Token" }
if ($Destino)   { $argumentos += "--destino=$Destino" }
if ($SinScrape) { $argumentos += '--sin-scrape' }

"[$sello] --- captura iniciada (modo=$Modo) ---" | Add-Content $log

# Se captura TAMBIEN stderr: si Cloudflare bloquea, hay que verlo en el log.
& node @argumentos *>&1 | Add-Content $log
$codigo = $LASTEXITCODE

$sello = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
"[$sello] --- captura finalizada (exit=$codigo) ---" | Add-Content $log

# Rotacion simple: si el log pasa de 6000 lineas se conservan las 2000 ultimas
$lineas = @(Get-Content $log -ErrorAction SilentlyContinue).Count
if ($lineas -gt 6000) {
    Get-Content $log -Tail 2000 | Set-Content -Path $log -Encoding UTF8
}

# Nunca se propaga el fallo a la tarea: el programador reintentara en el siguiente ciclo
exit 0