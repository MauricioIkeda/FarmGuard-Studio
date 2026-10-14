$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'password-utils.ps1')

$testPath = [IO.Path]::GetTempFileName()
try {
    [IO.File]::WriteAllText($testPath, "ADMIN_PASSWORD=old`r`nSESSION_SECRET=old`r`nOTHER_SETTING=preserved`r`n")
    $first = ConvertTo-SecureString 'Test pass#42!' -AsPlainText -Force
    $different = ConvertTo-SecureString 'Different pass#42!' -AsPlainText -Force
    try {
        Set-StudioPassword -EnvPath $testPath -Password $first -Confirmation $different
        throw 'A confirmacao divergente foi aceita.'
    } catch {
        if ($_.Exception.Message -notmatch 'nao conferem') { throw }
    }
    if ([IO.File]::ReadAllText($testPath) -notmatch 'ADMIN_PASSWORD=old') {
        throw 'O arquivo foi alterado apos uma confirmacao divergente.'
    }

    Set-StudioPassword -EnvPath $testPath -Password $first -Confirmation $first
    $env:STUDIO_PASSWORD_TEST_PATH = $testPath
    node (Join-Path $PSScriptRoot 'check-password-fixture.cjs')
    if ($LASTEXITCODE -ne 0) { throw 'O Node nao conseguiu ler a nova senha do .env.' }
    Write-Host 'Teste da troca de senha: OK.'
} finally {
    $env:STUDIO_PASSWORD_TEST_PATH = $null
    Remove-Item -LiteralPath $testPath -Force -ErrorAction SilentlyContinue
}
