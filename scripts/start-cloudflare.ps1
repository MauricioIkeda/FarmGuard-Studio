param(
    [string]$Token = $env:CLOUDFLARE_TUNNEL_TOKEN,
    [switch]$Quick
)

$ErrorActionPreference = 'Stop'
$cloudflared = (Get-Command cloudflared -ErrorAction Stop).Source
$projectRoot = Split-Path -Parent $PSScriptRoot

if (-not $Token) {
    $envFile = Join-Path $projectRoot '.env'
    if (Test-Path -LiteralPath $envFile) {
        $tokenLine = Get-Content -LiteralPath $envFile |
            Where-Object { $_ -match '^CLOUDFLARE_TUNNEL_TOKEN=' } |
            Select-Object -Last 1
        if ($tokenLine) {
            $Token = $tokenLine.Substring('CLOUDFLARE_TUNNEL_TOKEN='.Length).Trim()
        }
    }
}

if ($Token) {
    & $cloudflared tunnel run --token $Token
    exit $LASTEXITCODE
}

if ($Quick) {
    & $cloudflared tunnel --url 'http://localhost:4310'
    exit $LASTEXITCODE
}

throw 'Defina CLOUDFLARE_TUNNEL_TOKEN no .env/ambiente ou use -Quick para um endereco temporario.'
