param(
    [ValidateSet('Start', 'Restart', 'Stop', 'Status')]
    [string]$Action = 'Status'
)

$ErrorActionPreference = 'Stop'
$studioRoot = Split-Path -Parent $PSScriptRoot
$serverEntry = Join-Path $studioRoot 'dist-server\server\index.js'
$tunnelTokenFile = Join-Path $studioRoot 'data\secrets\cloudflare.token'
$startScript = Join-Path $PSScriptRoot 'start-background.ps1'
$publicUrl = 'https://farmguard.dominiofoda.com.br/'

function Get-StudioServerProcesses {
    @(Get-CimInstance Win32_Process | Where-Object {
        $_.Name -eq 'node.exe' -and
        $_.CommandLine -and
        $_.CommandLine.Contains($serverEntry)
    })
}

function Get-StudioTunnelProcesses {
    @(Get-CimInstance Win32_Process | Where-Object {
        $_.Name -eq 'cloudflared.exe' -and
        $_.CommandLine -and
        $_.CommandLine.Contains($tunnelTokenFile)
    })
}

function Get-LocalStatus {
    try {
        $response = Invoke-WebRequest -Uri 'http://127.0.0.1:4310/api/auth/status' -UseBasicParsing -TimeoutSec 5
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Get-PublicStatus {
    try {
        $response = Invoke-WebRequest -Uri $publicUrl -UseBasicParsing -TimeoutSec 3
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Show-Status {
    $servers = @(Get-StudioServerProcesses)
    $tunnels = @(Get-StudioTunnelProcesses)
    $localReady = Get-LocalStatus
    Write-Host "Studio local: $(if ($localReady) { 'ONLINE' } else { 'OFFLINE' }) (processos: $($servers.Count))"
    Write-Host "Tunnel Cloudflare: $(if ($tunnels.Count) { 'EM EXECUCAO' } else { 'PARADO' })"
    if ($localReady -and $tunnels.Count) {
        try {
            $response = Invoke-WebRequest -Uri $publicUrl -UseBasicParsing -TimeoutSec 8
            Write-Host "Site publico: HTTP $($response.StatusCode) - $publicUrl"
        } catch {
            Write-Warning "O site publico ainda nao respondeu: $($_.Exception.Message)"
        }
    }
}

function Stop-Studio {
    $servers = @(Get-StudioServerProcesses)
    $tunnels = @(Get-StudioTunnelProcesses)
    foreach ($process in @($servers) + @($tunnels)) {
        Write-Host "Encerrando $($process.Name) (PID $($process.ProcessId))..."
        Stop-Process -Id $process.ProcessId -ErrorAction Stop
    }
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        $listener = Get-NetTCPConnection -LocalPort 4310 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $listener) { break }
        Start-Sleep -Milliseconds 250
    }
    Write-Host 'Studio e tunnel deste projeto encerrados.'
}

function Start-Studio {
    if (-not (Test-Path -LiteralPath $serverEntry)) {
        throw 'Build do Studio nao encontrado. Execute npm run build no repositorio FarmGuard-Studio.'
    }
    if (-not (Test-Path -LiteralPath $tunnelTokenFile)) {
        throw 'Credencial do tunnel do Studio nao encontrada.'
    }
    & $startScript
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if (Get-LocalStatus) { break }
        Start-Sleep -Milliseconds 500
    }
    if (-not (Get-LocalStatus)) { throw 'O Studio nao respondeu na porta 4310 apos iniciar.' }
    if (-not @(Get-StudioTunnelProcesses).Count) { throw 'O tunnel do Studio nao iniciou.' }
    for ($attempt = 0; $attempt -lt 12; $attempt++) {
        if (Get-PublicStatus) { break }
        Start-Sleep -Seconds 1
    }
    Write-Host 'Studio iniciado.'
}

switch ($Action) {
    'Start' { Start-Studio; Show-Status }
    'Restart' { Stop-Studio; Start-Studio; Show-Status }
    'Stop' { Stop-Studio; Show-Status }
    'Status' { Show-Status }
}
