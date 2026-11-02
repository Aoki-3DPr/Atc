@echo off
setlocal
set "OJ_SCRIPT="
if exist "%CD%\bin\oj.ts" (
  set "OJ_SCRIPT=%CD%\bin\oj.ts"
) else if exist "%CD%\..\bin\oj.ts" (
  set "OJ_SCRIPT=%CD%\..\bin\oj.ts"
) else if exist "%CD%\..\..\bin\oj.ts" (
  set "OJ_SCRIPT=%CD%\..\..\bin\oj.ts"
) else if exist "%CD%\..\..\..\bin\oj.ts" (
  set "OJ_SCRIPT=%CD%\..\..\..\bin\oj.ts"
) else if exist "%CD%\..\..\..\..\bin\oj.ts" (
  set "OJ_SCRIPT=%CD%\..\..\..\..\bin\oj.ts"
) else (
  echo [oj] Error: 'oj' command can only be run inside the project directory. >&2
  exit /b 1
)
if exist "%USERPROFILE%\.bun\bin\bun.exe" (
  "%USERPROFILE%\.bun\bin\bun.exe" "%OJ_SCRIPT%" %*
) else if exist "%APPDATA%\npm\node_modules\bun\bin\bun.exe" (
  "%APPDATA%\npm\node_modules\bun\bin\bun.exe" "%OJ_SCRIPT%" %*
) else (
  where bun >nul 2>nul
  if %errorlevel% equ 0 (
    call bun "%OJ_SCRIPT%" %*
  ) else (
    echo [oj] Error: bun runtime not found. >&2
    exit /b 1
  )
)
