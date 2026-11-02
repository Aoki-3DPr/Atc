#!/usr/bin/env bun

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const c = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
};

// 引数から現在開いているファイルパスを取得 ($FilePath$)
const rawArg = process.argv[2];
if (!rawArg) {
  console.error("エラー: 実行するファイルパスを指定してください。");
  console.error("例: bun run ./bin/run.ts AtCoder/abc/a.cpp");
  process.exit(1);
}

// パスの正規化
let targetFilePath = path.isAbsolute(rawArg)
  ? path.resolve(rawArg)
  : path.resolve(projectRoot, rawArg);

if (!fs.existsSync(targetFilePath)) {
  console.error(`エラー: ファイルが見つかりません: ${targetFilePath}`);
  process.exit(1);
}

// 相対パスからターゲット名を決定 (例: AtCoder/abc/a.cpp -> AtCoder_abc_a)
const relPath = path.relative(projectRoot, targetFilePath).replace(/\\/g, "/");
const parts = relPath.replace(/\.cpp$/i, "").split("/");

let platform = "AtCoder";
let contest = "";
let prob = "";

if (parts.length >= 3) {
  platform = parts[0];
  contest = parts[1];
  prob = parts[2];
} else if (parts.length === 2) {
  contest = parts[0];
  prob = parts[1];
} else {
  prob = parts[0];
}

const safeDir = path.dirname(relPath).replace(/[\/\\]/g, "_");
const targetName = safeDir && safeDir !== "." ? `${safeDir}_${path.basename(relPath, ".cpp")}` : path.basename(relPath, ".cpp");

// ビルドディレクトリの決定 (Linux/WSL は /dev/shm、Windows は cmake-build-debug-mingw)
const isLinux = process.platform === "linux";
const useShm = isLinux && fs.existsSync("/dev/shm");
const buildDir = useShm
  ? "/dev/shm/APG4b-build"
  : path.join(projectRoot, isLinux ? "cmake-build-debug-wsl" : "cmake-build-debug-mingw");

const exePath = path.join(buildDir, isLinux ? targetName : `${targetName}.exe`);

// Linux (/dev/shm) 環境での CMake 初期化
if (isLinux) {
  const ninjaFile = path.join(buildDir, "build.ninja");
  const makeFile = path.join(buildDir, "Makefile");
  if (!fs.existsSync(ninjaFile) && !fs.existsSync(makeFile)) {
    fs.mkdirSync(buildDir, { recursive: true });
    try {
      execFileSync("cmake", ["-B", buildDir, "-S", projectRoot, "-G", "Ninja", "-DCMAKE_BUILD_TYPE=Debug"], {
        cwd: projectRoot,
        stdio: ["ignore", "ignore", "ignore"],
      });
    } catch {
      execFileSync("cmake", ["-B", buildDir, "-S", projectRoot, "-DCMAKE_BUILD_TYPE=Debug"], {
        cwd: projectRoot,
        stdio: ["ignore", "ignore", "ignore"],
      });
    }
  }
}

// ビルド要否の判定 (タイムスタンプ比較)
let needsBuild = true;
if (fs.existsSync(exePath) && fs.existsSync(targetFilePath)) {
  const exeTime = fs.statSync(exePath).mtimeMs;
  const srcTime = fs.statSync(targetFilePath).mtimeMs;
  if (srcTime <= exeTime) {
    needsBuild = false;
  }
}

if (needsBuild) {
  process.stdout.write(`[Build] ${targetName} をコンパイル中... `);
  const start = performance.now();
  try {
    if (isLinux) {
      if (fs.existsSync(path.join(buildDir, "build.ninja"))) {
        execFileSync("ninja", ["-C", buildDir, targetName], {
          cwd: projectRoot,
          stdio: ["ignore", "ignore", "pipe"],
        });
      } else {
        execFileSync("cmake", ["--build", buildDir, "--target", targetName], {
          cwd: projectRoot,
          stdio: ["ignore", "ignore", "pipe"],
        });
      }
    } else {
      const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
      const clionNinja = path.join(localAppData, "Programs", "CLion", "bin", "ninja", "win", "x64", "ninja.exe");
      const clionCmake = path.join(localAppData, "Programs", "CLion", "bin", "cmake", "win", "x64", "bin", "cmake.exe");

      if (fs.existsSync(clionNinja) && fs.existsSync(path.join(buildDir, "build.ninja"))) {
        execFileSync(clionNinja, ["-C", buildDir, targetName], {
          cwd: projectRoot,
          stdio: ["ignore", "ignore", "pipe"],
        });
      } else {
        const cmakeCmd = fs.existsSync(clionCmake) ? clionCmake : "cmake";
        execFileSync(cmakeCmd, ["--build", buildDir, "--target", targetName], {
          cwd: projectRoot,
          stdio: ["ignore", "ignore", "pipe"],
        });
      }
    }
    const duration = Math.round(performance.now() - start);
    console.log(`${c.green}✓ 成功 (${duration} ms)${c.reset}\n`);
  } catch (err: any) {
    console.log(`${c.red}✗ ビルドエラー${c.reset}\n`);
    if (err.stderr) console.error(err.stderr.toString());
    process.exit(1);
  }
}

// 実行（手動入力用に標準入出力をターミナルに直結）
console.log(`${c.cyan}--- [実行開始: ${path.basename(targetFilePath)}] (手動で入力を打ち込んでください) ---${c.reset}`);
const runResult = spawnSync(exePath, [], {
  cwd: path.dirname(targetFilePath),
  stdio: "inherit",
});
console.log(`\n${c.gray}--- [プロセス終了: 終了コード ${runResult.status ?? 0}] ---${c.reset}`);
