# OJ Local Environment Activator (PowerShell)
# Usage: . .\activate.ps1

foreach ($bDir in @("$env:USERPROFILE\.bun\bin", "$env:APPDATA\npm\node_modules\bun\bin")) {
    if ((Test-Path $bDir) -and ($env:PATH -notlike "*$bDir*")) {
        $env:PATH = "$bDir;$env:PATH"
    }
}

$OjBinDir = Join-Path $PSScriptRoot ".bin"
if ($env:PATH -notlike "*$OjBinDir*") {
    $env:PATH = "$OjBinDir;$env:PATH"
}

function global:oj {
    $curr = $PWD.Path
    while ($curr) {
        $target = Join-Path $curr "bin\oj.ts"
        if (Test-Path $target) {
            & bun $target @args
            return
        }
        $parent = Split-Path $curr -Parent
        if (-not $parent -or $parent -eq $curr) { break }
        $curr = $parent
    }
    Write-Host "[oj] Error: 'oj' command can only be run inside the project directory." -ForegroundColor Red
}

Write-Host "[OJ] Local CLI environment activated! (Project-scoped only)" -ForegroundColor Cyan
Write-Host "     Commands: " -NoNewline
Write-Host "oj ac <id>" -ForegroundColor Green -NoNewline
Write-Host " | " -NoNewline
Write-Host "oj cf <id>" -ForegroundColor Green -NoNewline
Write-Host " | " -NoNewline
Write-Host "oj t [prob]" -ForegroundColor Green -NoNewline
Write-Host " | " -NoNewline
Write-Host "oj b [prob]" -ForegroundColor Green -NoNewline
Write-Host " | " -NoNewline
Write-Host "oj st" -ForegroundColor Green -NoNewline
Write-Host " | " -NoNewline
Write-Host "oj" -ForegroundColor Green -NoNewline
Write-Host " (shell)"
