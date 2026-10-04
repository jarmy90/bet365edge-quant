# =============================================================================
# PROGRAMAR LA CAPTURA AUTOMATICA DE RATINGBET (Windows Task Scheduler)
# -----------------------------------------------------------------------------
# Resuelve el problema "al pulsar Actualizar salen siempre los mismos partidos".
#
# La web NO puede consultar ratingbet en vivo: Cloudflare bloquea cualquier fetch
# de servidor (403 challenge). Solo un Chrome real lo atraviesa, y eso no se puede
# ejecutar dentro de Vercel. Por eso la web consume un DATASET capturado, y ese
# dataset solo cambia cuando alguien ejecuta el scraper.
#
# USO
#   # 1) Ver el estado actual de la tarea
#   powershell -ExecutionPolicy Bypass -File tools_programar_captura.ps1 -Estado
#
#   # 2) Programar (modo info: captura y deja el dataset embebido listo)
#   powershell -ExecutionPolicy Bypass -File tools_programar_captura.ps1 -Modo info -IntervaloMinutos 15
#
#   # 3) Programar en modo remoto (RECOMENDADO: la web se actualiza SIN redeploy)
#   powershell -ExecutionPolicy Bypass -File tools_programar_captura.ps1 -Modo gist -GistId <ID> -Token <PAT> -IntervaloMinutos 15
#
#   # 4) Desprogramar
#   powershell -ExecutionPolicy Bypass -File tools_programar_captura.ps1 -Quitar
#
# NOTAS
#   - La tarea corre como tu usuario y solo mientras hay sesion iniciada.
#   - En modo 'info' la captura actualiza ratingbet_fixtures_data.js, pero Vercel
#     NO lo vera hasta que redespliegues (vercel --prod). Para evitarlo, usa 'gist'.
# =============================================================================
param(
    [ValidateSet('gist', 'fichero', 'info')][string]$Modo = 'info',
    [int]$IntervaloMinutos = 15,
    [string]$NombreTarea = 'Bet365EdgeCapturaRatingbet',
    [string]$GistId = $env:GITHUB_GIST_ID,
    [string]$Token = $env:GITHUB_TOKEN,
    [string]$Destino = '',
    [int]$Dias = 2,
    [switch]$Quitar,
    [switch]$Estado,
    [switch]$EjecutarAhora
)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

function Titulo($t) { Write-Host ''; Write-Host "=== $t ===" -ForegroundColor Cyan }

# --- Estado -----------------------------------------------------------------
if ($Estado) {
    Titulo "Estado de la tarea '$NombreTarea'"
    $t = Get-ScheduledTask -TaskName $NombreTarea -ErrorAction SilentlyContinue
    if (-not $t) {
        Write-Host " NO EXISTE todavia. Programala con:" -ForegroundColor Yellow
        Write-Host "   powershell -ExecutionPolicy Bypass -File tools_programar_captura.ps1 -Modo gist -GistId <ID> -Token <PAT>"
    } else {
        $info = Get-ScheduledTaskInfo -TaskName $NombreTarea
        Write-Host " Estado          : $($t.State)"
        Write-Host " Ultima ejecucion: $($info.LastRunTime)"
        Write-Host " Resultado       : $($info.LastTaskResult)"
        Write-Host " Proxima         : $($info.NextRunTime)"
        if ($t.Actions[0]) { Write-Host " Accion          : $($t.Actions[0].Execute) $($t.Actions[0].Arguments)" }
    }
    Titulo 'Ultimas lineas del log'
    $log = Join-Path $PSScriptRoot 'captura_ratingbet.log'
    if (Test-Path $log) {
        Get-Content $log -Tail 15
        $edad = [math]::Round(((Get-Date) - (Get-Item $log).LastWriteTime).TotalMinutes)
        Write-Host ''
        Write-Host " Ultima escritura en el log: hace $edad min"
    } else {
        Write-Host ' Todavia no hay log: la tarea no se ha ejecutado nunca.'
    }
    return
}

# --- Desprogramar -----------------------------------------------------------
if ($Quitar) {
    Titulo "Quitando la tarea '$NombreTarea'"
    if (Get-ScheduledTask -TaskName $NombreTarea -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $NombreTarea -Confirm:$false
        Write-Host ' Tarea eliminada.' -ForegroundColor Green
    } else {
        Write-Host ' No existia.'
    }
    return
}

# --- Comprobaciones previas -------------------------------------------------
Titulo 'Comprobaciones previas'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "No se encuentra 'node' en el PATH. Instala Node.js o anade su ruta."
}
$node = (Get-Command node).Source
Write-Host " node            : $node"
Write-Host " carpeta         : $PSScriptRoot"

if ($Modo -eq 'gist' -and (-not $GistId -or -not $Token)) {
    throw "El modo 'gist' necesita -GistId y -Token (o las variables GITHUB_GIST_ID / GITHUB_TOKEN)."
}
if ($Modo -eq 'fichero' -and -not $Destino) {
    throw "El modo 'fichero' necesita -Destino (ruta del JSON publicado)."
}

# --- Accion -----------------------------------------------------------------
$ciclo = Join-Path $PSScriptRoot 'tools_captura_ciclo.ps1'
$argsCiclo = "-NoProfile -ExecutionPolicy Bypass -File `"$ciclo`" -Modo $Modo -Dias $Dias"
if ($Modo -eq 'gist')    { $argsCiclo += " -GistId `"$GistId`" -Token `"$Token`"" }
if ($Modo -eq 'fichero') { $argsCiclo += " -Destino `"$Destino`"" }

Titulo "Programando la tarea '$NombreTarea'"
$accion = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argsCiclo -WorkingDirectory $PSScriptRoot
$disparador = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes $IntervaloMinutos) `
    -RepetitionDuration ([TimeSpan]::MaxValue)
$ajustes = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName $NombreTarea -Action $accion -Trigger $disparador `
    -Settings $ajustes -Force `
    -Description 'Captura el dataset de ratingbet.com (Over/Under 1.5 y 2.5) y lo publica para la web.' | Out-Null

Write-Host " OK: tarea creada. Se ejecutara cada $IntervaloMinutos min (primera vez en 1 min)." -ForegroundColor Green

# --- Ejecucion inmediata opcional ------------------------------------------
if ($EjecutarAhora) {
    Titulo 'Ejecutando un ciclo ahora mismo'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ciclo -Modo $Modo -Dias $Dias `
        -GistId $GistId -Token $Token -Destino $Destino
}

# --- Recordatorio final -----------------------------------------------------
Titulo 'Para que la web vea los datos NUEVOS'
if ($Modo -eq 'gist') {
    Write-Host ' En Vercel > Settings > Environment Variables define:'
    Write-Host '   RATINGBET_DATASET_URL = <URL raw del gist>   (la imprime el publicador)'
    Write-Host ' Aplicala a Production y Preview, y redespliega UNA sola vez.'
    Write-Host ' A partir de ahi, cada captura se ve en la web sin volver a desplegar.'
} elseif ($Modo -eq 'fichero') {
    Write-Host ' Sirve el fichero publicado por HTTPS y define RATINGBET_DATASET_URL en Vercel.'
} else {
    Write-Host ' Modo info: el dataset queda en ratingbet_fixtures_data.js.' -ForegroundColor Yellow
    Write-Host ' Vercel NO lo vera hasta que redespliegues:  vercel --prod'
    Write-Host ' Para evitarlo, usa -Modo gist.'
}
Write-Host ''
Write-Host ' Ver el estado en cualquier momento:' -ForegroundColor Gray
Write-Host "   powershell -ExecutionPolicy Bypass -File tools_programar_captura.ps1 -Estado" -ForegroundColor Gray