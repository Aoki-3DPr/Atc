#!/usr/bin/env bun

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const binDir = path.join(projectRoot, ".bin");

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

const MARKER_START = "# >>> oj-workspace dynamic-runner >>>";
const MARKER_END = "# <<< oj-workspace dynamic-runner <<<";

/**
 * プロファイル内のマーカーブロックを挿入・更新・削除するヘルパー
 */
function upsertBlock(filePath: string, blockContent: string | null): boolean {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let existing = "";
    if (fs.existsSync(filePath)) {
      existing = fs.readFileSync(filePath, "utf8");
    }

    existing = existing.replace(
      /# >>> oj-workspace auto-activate >>>[\s\S]*?# <<< oj-workspace auto-activate <<</g,
      ""
    );

    const startIdx = existing.indexOf(MARKER_START);
    const endIdx = existing.indexOf(MARKER_END);

    let updated = existing;
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      const before = existing.slice(0, startIdx).trimEnd();
      const after = existing.slice(endIdx + MARKER_END.length).trimStart();
      if (blockContent === null) {
        updated = (before + (before && after ? "\n\n" : "") + after).trim() + "\n";
      } else {
        updated =
          (before ? before + "\n\n" : "") +
          blockContent +
          (after ? "\n\n" + after : "") +
          "\n";
      }
    } else if (blockContent !== null) {
      updated = (existing.trimEnd() ? existing.trimEnd() + "\n\n" : "") + blockContent + "\n";
    } else {
      return false;
    }

    const outContent = filePath.endsWith(".ps1")
      ? "\uFEFF" + updated.replace(/^\uFEFF/, "")
      : updated;
    fs.writeFileSync(filePath, outContent, "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * PowerShell 自身から実際の $PROFILE パス群を動的に取得する（OneDrive 環境等にも完全対応）
 */
function detectPowerShellProfiles(): string[] {
  const profiles = new Set<string>();
  const home = os.homedir();

  for (const shellCmd of ["powershell", "pwsh"]) {
    try {
      const res = spawnSync(
        shellCmd,
        ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Write-Output $PROFILE.CurrentUserCurrentHost; Write-Output $PROFILE.CurrentUserAllHosts"],
        { encoding: "utf8" }
      );
      if (res.status === 0 && res.stdout) {
        for (const line of res.stdout.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (trimmed && path.isAbsolute(trimmed)) {
            profiles.add(trimmed);
          }
        }
      }
    } catch {}
  }

  // フォールバック標準パス
  profiles.add(path.join(home, "Documents", "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1"));
  profiles.add(path.join(home, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1"));

  return [...profiles];
}

/**
 * Windows の User PATH 環境変数を動的に更新（古い .bin を自動置換し、現在の .bin に更新）
 */
function updateWindowsUserPath(targetBinDir: string, bunDir: string, remove: boolean): boolean {
  try {
    const psScript = `
$uPath = [System.Environment]::GetEnvironmentVariable("PATH", "User")
if (-not $uPath) { $uPath = "" }
$parts = $uPath -split ";" | Where-Object { $_ -and ($_ -notmatch '[\\\\/]\\.bin$') }
if (-not $${remove ? "true" : "false"}) {
    if ($parts -notcontains "${bunDir}") { $parts += "${bunDir}" }
    if ($parts -notcontains "${targetBinDir}") { $parts += "${targetBinDir}" }
}
$newPath = ($parts -join ";")
[System.Environment]::SetEnvironmentVariable("PATH", $newPath, "User")
`;
    const res = spawnSync("powershell", ["-NoProfile", "-Command", psScript], { stdio: "ignore" });
    return res.status === 0;
  } catch {
    return false;
  }
}

export function runSetup(remove = false): void {
  const bunExecPath = process.execPath;
  const bunExecDir = path.dirname(bunExecPath);

  console.log(`\n${c.bold}${c.cyan}================================================================${c.reset}`);
  console.log(` ⚡ ${c.bold}${c.green}OJ Dynamic Environment Setup${c.reset}`);
  console.log(`${c.bold}${c.cyan}================================================================${c.reset}`);
  console.log(`  📂 Project Root : ${c.bold}${projectRoot}${c.reset}`);

  // 1. .bin ラッパーの生成（個人パスを一切含まない 100% 汎用・カレントディレクトリ探索型スクリプト）
  fs.mkdirSync(binDir, { recursive: true });

  const cmdContent = `@echo off\r\nsetlocal\r\nset "OJ_SCRIPT="\r\nif exist "%CD%\\bin\\oj.ts" (\r\n  set "OJ_SCRIPT=%CD%\\bin\\oj.ts"\r\n) else if exist "%CD%\\..\\bin\\oj.ts" (\r\n  set "OJ_SCRIPT=%CD%\\..\\bin\\oj.ts"\r\n) else if exist "%CD%\\..\\..\\bin\\oj.ts" (\r\n  set "OJ_SCRIPT=%CD%\\..\\..\\bin\\oj.ts"\r\n) else if exist "%CD%\\..\\..\\..\\bin\\oj.ts" (\r\n  set "OJ_SCRIPT=%CD%\\..\\..\\..\\bin\\oj.ts"\r\n) else if exist "%CD%\\..\\..\\..\\..\\bin\\oj.ts" (\r\n  set "OJ_SCRIPT=%CD%\\..\\..\\..\\..\\bin\\oj.ts"\r\n) else (\r\n  echo [oj] Error: 'oj' command can only be run inside the project directory. >&2\r\n  exit /b 1\r\n)\r\nif exist "%USERPROFILE%\\.bun\\bin\\bun.exe" (\r\n  "%USERPROFILE%\\.bun\\bin\\bun.exe" "%OJ_SCRIPT%" %*\r\n) else if exist "%APPDATA%\\npm\\node_modules\\bun\\bin\\bun.exe" (\r\n  "%APPDATA%\\npm\\node_modules\\bun\\bin\\bun.exe" "%OJ_SCRIPT%" %*\r\n) else (\r\n  where bun >nul 2>nul\r\n  if %errorlevel% equ 0 (\r\n    call bun "%OJ_SCRIPT%" %*\r\n  ) else (\r\n    echo [oj] Error: bun runtime not found. >&2\r\n    exit /b 1\r\n  )\r\n)\r\n`;
  fs.writeFileSync(path.join(binDir, "oj.cmd"), cmdContent, "utf8");

  const ps1Content = `\uFEFF#!/usr/bin/env pwsh\r\n$curr = $PWD.Path\r\n$ojScript = $null\r\nwhile ($curr) {\r\n    $candidate = Join-Path $curr "bin\\oj.ts"\r\n    if (Test-Path $candidate) {\r\n        $ojScript = $candidate\r\n        break\r\n    }\r\n    $parent = Split-Path $curr -Parent\r\n    if (-not $parent -or $parent -eq $curr) { break }\r\n    $curr = $parent\r\n}\r\nif (-not $ojScript) {\r\n    Write-Host "[oj] Error: 'oj' command can only be run inside the project directory." -ForegroundColor Red\r\n    exit 1\r\n}\r\nif (Test-Path "$env:USERPROFILE\\.bun\\bin\\bun.exe") {\r\n    & "$env:USERPROFILE\\.bun\\bin\\bun.exe" $ojScript @args\r\n} elseif (Test-Path "$env:APPDATA\\npm\\node_modules\\bun\\bin\\bun.exe") {\r\n    & "$env:APPDATA\\npm\\node_modules\\bun\\bin\\bun.exe" $ojScript @args\r\n} elseif (Get-Command bun -ErrorAction SilentlyContinue) {\r\n    & bun $ojScript @args\r\n} else {\r\n    Write-Error "[oj] Error: bun runtime not found."\r\n    exit 1\r\n}\r\n`;
  fs.writeFileSync(path.join(binDir, "oj.ps1"), ps1Content, "utf8");

  const shContent = `#!/usr/bin/env sh\ncurr="$PWD"\nOJ_SCRIPT=""\nwhile [ -n "$curr" ] && [ "$curr" != "/" ]; do\n  if [ -f "$curr/bin/oj.ts" ]; then\n    OJ_SCRIPT="$curr/bin/oj.ts"\n    break\n  fi\n  curr="$(dirname "$curr")"\ndone\nif [ -z "$OJ_SCRIPT" ]; then\n  echo "✗ エラー: 'oj' コマンドはこのプロジェクトのディレクトリ内でのみ実行可能です。" >&2\n  exit 1\nfi\nif command -v bun >/dev/null 2>&1; then\n  exec bun "$OJ_SCRIPT" "$@"\nelif [ -x "$HOME/.bun/bin/bun" ]; then\n  exec "$HOME/.bun/bin/bun" "$OJ_SCRIPT" "$@"\nelif [ -x "/usr/local/bin/bun" ]; then\n  exec "/usr/local/bin/bun" "$OJ_SCRIPT" "$@"\nelse\n  echo "[oj] Error: bun runtime not found." >&2\n  exit 1\nfi\n`;
  const shPath = path.join(binDir, "oj");
  fs.writeFileSync(shPath, shContent, "utf8");
  try {
    fs.chmodSync(shPath, 0o755);
  } catch {}

  console.log(`  ✅ 汎用コマンドラッパーを生成: ${c.cyan}.bin/oj${c.reset} (個人パス一切なし)`);

  // 2. 現在のターミナルですぐ使えるよう、既存のユーザー PATH ディレクトリ (~/.bun/bin, %APPDATA%/npm) にも汎用ディスパッチャを配置
  const home = os.homedir();
  const userBinCandidates =
    process.platform === "win32"
      ? [
          process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : "",
          path.join(home, ".bun", "bin"),
        ].filter(Boolean)
      : [
          path.join(home, ".bun", "bin"),
          path.join(home, ".local", "bin"),
        ];

  for (const uBin of userBinCandidates) {
    if (!fs.existsSync(uBin)) continue;
    try {
      if (process.platform === "win32") {
        const targetCmd = path.join(uBin, "oj.cmd");
        const targetPs1 = path.join(uBin, "oj.ps1");
        if (remove) {
          if (fs.existsSync(targetCmd)) fs.unlinkSync(targetCmd);
          if (fs.existsSync(targetPs1)) fs.unlinkSync(targetPs1);
        } else {
          fs.writeFileSync(targetCmd, cmdContent, "utf8");
          fs.writeFileSync(targetPs1, ps1Content, "utf8");
        }
      } else {
        const targetSh = path.join(uBin, "oj");
        if (remove) {
          if (fs.existsSync(targetSh)) fs.unlinkSync(targetSh);
        } else {
          fs.writeFileSync(targetSh, shContent, "utf8");
          fs.chmodSync(targetSh, 0o755);
        }
      }
      console.log(`  ✅ 即時実行ディスパッチャを${remove ? "解除" : "配置"}: ${c.gray}${uBin}${c.reset}`);
    } catch {}
  }

  // 3. OS・シェル設定の動的更新（環境変数のみを使用した汎用スクリプト）

  if (process.platform === "win32") {
    if (updateWindowsUserPath(binDir, bunExecDir, remove)) {
      console.log(`  ✅ Windows User PATH を現在のディレクトリ位置に動的更新`);
    }

    const psProfiles = detectPowerShellProfiles();

    // 個人パスを一切含まず、OS標準環境変数 ($env:USERPROFILE, $env:APPDATA, $PWD) のみで動作
    const psBlock = `${MARKER_START}
foreach ($bDir in @("$env:USERPROFILE\\.bun\\bin", "$env:APPDATA\\npm\\node_modules\\bun\\bin")) {
    if ((Test-Path $bDir) -and ($env:PATH -notlike "*$bDir*")) {
        $env:PATH = "$bDir;$env:PATH"
    }
}
function global:oj {
    $curr = $PWD.Path
    while ($curr) {
        $target = Join-Path $curr "bin\\oj.ts"
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
${MARKER_END}`;

    for (const prof of psProfiles) {
      if (upsertBlock(prof, remove ? null : psBlock)) {
        const action = remove ? "解除" : "構築";
        console.log(`  ✅ PowerShell 動的ディスパッチャを${action}: ${c.gray}${prof}${c.reset}`);
      }
    }
  } else {
    const posixProfiles = [
      path.join(home, ".bashrc"),
      path.join(home, ".zshrc"),
    ];

    const posixBlock = `${MARKER_START}
if [ -d "$HOME/.bun/bin" ]; then
  case ":$PATH:" in
    *":$HOME/.bun/bin:"*) ;;
    *) export PATH="$HOME/.bun/bin:$PATH" ;;
  esac
fi
oj() {
  local curr="$PWD"
  while [ -n "$curr" ] && [ "$curr" != "/" ]; do
    if [ -f "$curr/bin/oj.ts" ]; then
      bun "$curr/bin/oj.ts" "$@"
      return $?
    fi
    curr="$(dirname "$curr")"
  done
  echo -e "\\033[31m✗ エラー: 'oj' コマンドはこのプロジェクトのディレクトリ内でのみ実行可能です。\\033[0m" >&2
  return 1
}
${MARKER_END}`;

    for (const prof of posixProfiles) {
      if (fs.existsSync(prof) || prof.endsWith(".bashrc")) {
        if (upsertBlock(prof, remove ? null : posixBlock)) {
          const action = remove ? "解除" : "構築";
          console.log(`  ✅ シェル動的ディスパッチャを${action}: ${c.gray}${prof}${c.reset}`);
        }
      }
    }
  }

  console.log(`${c.bold}${c.cyan}================================================================${c.reset}`);
  if (remove) {
    console.log(` 🧹 自動認識設定をクリーンアップしました。\n`);
  } else {
    console.log(` 🎉 ${c.bold}${c.green}動的環境構築が完了しました！${c.reset}`);
    console.log(`    ・Git 管理ファイル内に個人のパスは一切含まれません。`);
    console.log(`    ・どの OS でも '${c.cyan}bun run setup${c.reset}' (または '${c.cyan}bun setup${c.reset}') 1発で構築されます。\n`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const isClean = process.argv.includes("--clean") || process.argv.includes("--remove");
  runSetup(isClean);
}
