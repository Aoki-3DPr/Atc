#!/usr/bin/env pwsh
$curr = $PWD.Path
$ojScript = $null
while ($curr) {
    $candidate = Join-Path $curr "bin\oj.ts"
    if (Test-Path $candidate) {
        $ojScript = $candidate
        break
    }
    $parent = Split-Path $curr -Parent
    if (-not $parent -or $parent -eq $curr) { break }
    $curr = $parent
}
if (-not $ojScript) {
    Write-Host "[oj] Error: 'oj' command can only be run inside the project directory." -ForegroundColor Red
    exit 1
}
if (Test-Path "$env:USERPROFILE\.bun\bin\bun.exe") {
    & "$env:USERPROFILE\.bun\bin\bun.exe" $ojScript @args
} elseif (Test-Path "$env:APPDATA\npm\node_modules\bun\bin\bun.exe") {
    & "$env:APPDATA\npm\node_modules\bun\bin\bun.exe" $ojScript @args
} elseif (Get-Command bun -ErrorAction SilentlyContinue) {
    & bun $ojScript @args
} else {
    Write-Error "[oj] Error: bun runtime not found."
    exit 1
}
