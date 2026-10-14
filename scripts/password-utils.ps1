function Set-StudioPassword {
    param(
        [Parameter(Mandatory = $true)][string]$EnvPath,
        [Parameter(Mandatory = $true)][securestring]$Password,
        [Parameter(Mandatory = $true)][securestring]$Confirmation
    )

    if (-not (Test-Path -LiteralPath $EnvPath -PathType Leaf)) {
        throw 'Arquivo .env do Studio nao encontrado. Nenhuma senha foi alterada.'
    }

    $passwordPointer = [IntPtr]::Zero
    $confirmationPointer = [IntPtr]::Zero
    $plainPassword = $null
    $plainConfirmation = $null
    try {
        $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)
        $confirmationPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Confirmation)
        $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
        $plainConfirmation = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($confirmationPointer)

        if ($plainPassword -cne $plainConfirmation) {
            throw 'As senhas digitadas nao conferem. Nenhuma alteracao foi feita.'
        }
        if ($plainPassword.Length -lt 12) {
            throw 'Use uma senha com pelo menos 12 caracteres. Nenhuma alteracao foi feita.'
        }
        if ($plainPassword.Length -gt 512 -or $plainPassword -match '[\r\n\x00]') {
            throw 'A senha contem caracteres nao aceitos. Nenhuma alteracao foi feita.'
        }
        if ($plainPassword.Contains("'") -and $plainPassword.Contains('"')) {
            throw 'A senha nao pode conter aspas simples e duplas ao mesmo tempo. Nenhuma alteracao foi feita.'
        }

        $quote = if ($plainPassword.Contains("'")) { '"' } else { "'" }
        $lines = [IO.File]::ReadAllLines($EnvPath)
        $passwordLines = @($lines | Select-String -Pattern '^\s*ADMIN_PASSWORD\s*=')
        $secretLines = @($lines | Select-String -Pattern '^\s*SESSION_SECRET\s*=')
        if ($passwordLines.Count -ne 1 -or $secretLines.Count -ne 1) {
            throw 'O .env precisa conter exatamente uma linha ADMIN_PASSWORD e uma SESSION_SECRET. Nenhuma alteracao foi feita.'
        }

        $random = New-Object byte[] 48
        $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $generator.GetBytes($random) } finally { $generator.Dispose() }
        $sessionSecret = [Convert]::ToBase64String($random).TrimEnd('=').Replace('+', '-').Replace('/', '_')
        $lines[$passwordLines[0].LineNumber - 1] = "ADMIN_PASSWORD=$quote$plainPassword$quote"
        $lines[$secretLines[0].LineNumber - 1] = "SESSION_SECRET=$sessionSecret"

        $directory = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($EnvPath))
        $temporary = [IO.Path]::Combine($directory, ".env.$([guid]::NewGuid().ToString('N')).tmp")
        $backup = "$temporary.bak"
        try {
            $newContent = [string]::Join([Environment]::NewLine, $lines) + [Environment]::NewLine
            [IO.File]::WriteAllText($temporary, $newContent, (New-Object Text.UTF8Encoding $false))
            Set-Acl -LiteralPath $temporary -AclObject (Get-Acl -LiteralPath $EnvPath)
            [IO.File]::Replace($temporary, $EnvPath, $backup)
        } finally {
            if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
            if ([IO.File]::Exists($backup)) { [IO.File]::Delete($backup) }
        }
    } finally {
        if ($passwordPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer) }
        if ($confirmationPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($confirmationPointer) }
        $plainPassword = $null
        $plainConfirmation = $null
    }
}
