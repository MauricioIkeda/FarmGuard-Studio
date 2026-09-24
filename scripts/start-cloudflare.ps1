param(
    [string]$TokenFile = $env:CLOUDFLARE_TUNNEL_TOKEN_FILE,
    [switch]$Quick
)

$ErrorActionPreference = 'Stop'
$cloudflared = (Get-Command cloudflared -ErrorAction Stop).Source
$projectRoot = Split-Path -Parent $PSScriptRoot

if (-not $TokenFile) {
    $TokenFile = Join-Path $projectRoot 'data\secrets\cloudflare.token'
}

if ($Quick) {
    & $cloudflared tunnel --url 'http://localhost:4310'
    exit $LASTEXITCODE
}

if (Test-Path -LiteralPath $TokenFile) {
    & $cloudflared tunnel run --token-file $TokenFile
    exit $LASTEXITCODE
}

throw 'Salve a credencial em data\secrets\cloudflare.token ou use -Quick para um endereço temporário.'
