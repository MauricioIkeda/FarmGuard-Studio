$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$serverEntry = Join-Path $projectRoot 'dist-server\server\index.js'
$tunnelTokenFile = Join-Path $projectRoot 'data\secrets\cloudflare.token'

if (-not (Test-Path -LiteralPath $serverEntry)) {
    throw 'Build de produção não encontrado. Execute npm run build antes de iniciar automaticamente.'
}
if (-not (Test-Path -LiteralPath $tunnelTokenFile)) {
    throw 'Credencial do tunnel não encontrada em data\secrets\cloudflare.token.'
}

$nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
$cloudflaredExecutable = (Get-Command cloudflared.exe -ErrorAction Stop).Source
$serverListener = Get-NetTCPConnection -LocalPort 4310 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($serverListener) {
    $serverProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($serverListener.OwningProcess)"
    if ($serverProcess.CommandLine -notlike '*FarmGuard-Studio*dist-server*index.js*') {
        throw 'A porta 4310 está ocupada por outro processo.'
    }
} else {
    $env:NODE_ENV = 'production'
    Start-Process -FilePath $nodeExecutable -ArgumentList @($serverEntry) -WorkingDirectory $projectRoot -WindowStyle Hidden | Out-Null
}

$tunnelRunning = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'cloudflared.exe' -and $_.CommandLine -like '*data\secrets\cloudflare.token*'
}
if (-not $tunnelRunning) {
    Start-Process -FilePath $cloudflaredExecutable -ArgumentList @('tunnel', 'run', '--token-file', ('"' + $tunnelTokenFile + '"')) -WorkingDirectory $projectRoot -WindowStyle Hidden | Out-Null
}
