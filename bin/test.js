#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fetchProblem } from "./fetch.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

// カラー出力用のヘルパー（ANSI）
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
  bgGreen: "\x1b[42m\x1b[30m",
  bgRed: "\x1b[41m\x1b[37m",
};

// 引数パース
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("エラー: コンテスト名と問題名を指定してください。");
  console.error("使い方: npm run test <コンテスト名> <問題名>");
  console.error("例: npm run test abc350 a");
  console.error("例: npm run test contests/abc350/a.cpp");
  process.exit(1);
}

let contest = "";
let prob = "";

if (args.length >= 2) {
  contest = args[0].replace(/^contests[\\/]+/, "").toLowerCase();
  prob = args[1].toLowerCase().replace(/\.cpp$/, "");
} else {
  // パス形式の場合 (例: contests/abc350/a.cpp)
  const norm = args[0].replace(/\\/g, "/");
  const match = norm.match(/contests\/([^/]+)\/([a-zA-Z0-9_-]+)\.cpp$/i);
  if (match) {
    contest = match[1].toLowerCase();
    prob = match[2].toLowerCase();
  } else {
    console.error("エラー: 問題の指定形式が正しくありません。");
    console.error("例: npm run test abc350 a");
    process.exit(1);
  }
}

const targetName = `contests_${contest}_${prob}`;
const contestDir = path.join(projectRoot, "contests", contest);
const srcFile = path.join(contestDir, `${prob}.cpp`);
const testDir = path.join(contestDir, "test", prob);

if (!fs.existsSync(srcFile)) {
  console.error(`エラー: ソースファイルが見つかりません: ${path.relative(projectRoot, srcFile)}`);
  process.exit(1);
}

// 1. テストケースの存在確認＆自動取得
if (!fs.existsSync(testDir) || fs.readdirSync(testDir).filter((f) => f.startsWith("in")).length === 0) {
  console.log(`${c.cyan}[Auto-Fetch]${c.reset} テストケースが見つからないため、AtCoderから自動取得します...`);
  const fetchRes = await fetchProblem(contest, prob);
  if (!fetchRes.success) {
    console.error(`${c.red}テストケースの取得に失敗しました: ${fetchRes.error}${c.reset}`);
    process.exit(1);
  }
  console.log(`✓ サンプルケース ${fetchRes.count} 件を取得しました。\n`);
}

// 2. 制限時間の読み込み (info.json)
let timeLimitMs = 2000;
const infoPath = path.join(testDir, "info.json");
if (fs.existsSync(infoPath)) {
  try {
    const info = JSON.parse(fs.readFileSync(infoPath, "utf8"));
    if (info.timeLimitMs) timeLimitMs = info.timeLimitMs;
  } catch {}
}

// 3. CMake での自動コンパイル
const isLinux = process.platform === "linux";
const buildDir = path.join(
  projectRoot,
  isLinux ? "cmake-build-debug-wsl" : "cmake-build-debug-mingw"
);
const exePath = path.join(
  buildDir,
  isLinux ? targetName : `${targetName}.exe`
);

let needsBuild = true;
if (fs.existsSync(exePath) && fs.existsSync(srcFile)) {
  const exeTime = fs.statSync(exePath).mtimeMs;
  const srcTime = fs.statSync(srcFile).mtimeMs;
  let libUpdated = false;
  const libDir = path.join(projectRoot, "lib");
  if (fs.existsSync(libDir)) {
    for (const f of fs.readdirSync(libDir)) {
      if (f.endsWith(".cpp") || f.endsWith(".h")) {
        if (fs.statSync(path.join(libDir, f)).mtimeMs > exeTime) {
          libUpdated = true;
          break;
        }
      }
    }
  }
  if (srcTime <= exeTime && !libUpdated) {
    needsBuild = false;
  }
}

if (needsBuild) {
  console.log(`${c.cyan}[Build]${c.reset} ${targetName} をコンパイル中...`);

  try {
    if (isLinux) {
      execFileSync("cmake", ["--build", buildDir, "--target", targetName], {
        cwd: projectRoot,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } else {
      const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
      const clionNinja = path.join(
        localAppData,
        "Programs",
        "CLion",
        "bin",
        "ninja",
        "win",
        "x64",
        "ninja.exe"
      );
      const clionCmake = path.join(
        localAppData,
        "Programs",
        "CLion",
        "bin",
        "cmake",
        "win",
        "x64",
        "bin",
        "cmake.exe"
      );

      if (fs.existsSync(clionNinja) && fs.existsSync(path.join(buildDir, "build.ninja"))) {
        execFileSync(clionNinja, ["-C", buildDir, targetName], {
          cwd: projectRoot,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } else {
        const cmakeCmd = fs.existsSync(clionCmake) ? clionCmake : "cmake";
        execFileSync(cmakeCmd, ["--build", buildDir, "--target", targetName], {
          cwd: projectRoot,
          stdio: ["pipe", "pipe", "pipe"],
        });
      }
    }
    console.log(`${c.green}✓ ビルド成功${c.reset}\n`);
  } catch (err) {
    console.error(`${c.red}✗ ビルドエラー:${c.reset}`);
    if (err.stderr && err.stderr.length > 0) console.error(err.stderr.toString());
    else if (err.stdout && err.stdout.length > 0) console.error(err.stdout.toString());
    else console.error(err.message || err);
    process.exit(1);
  }
} else {
  console.log(`${c.green}✓ ソースコード変更なし（ビルドスキップ）${c.reset}\n`);
}

// 初回実行時のWindows Defenderスキャン＆DLL読み込み遅延（ウォームアップ: Windowsのみ）
// Defender のスキャンは起動時（最初の約40-50ms）に行われるため、
// 最も小さいケースを渡しつつ、最大 50ms で安全に打ち切る（重いケースでも絶対に待たせない）
if (!isLinux) {
  try {
    let smallestInputFile = null;
    let minSize = Infinity;
    if (fs.existsSync(testDir)) {
      for (const f of fs.readdirSync(testDir)) {
        if (/^in\d+\.txt$/.test(f)) {
          const fp = path.join(testDir, f);
          const sz = fs.statSync(fp).size;
          if (sz < minSize) {
            minSize = sz;
            smallestInputFile = fp;
          }
        }
      }
    }

    const warmupInput = smallestInputFile ? fs.readFileSync(smallestInputFile) : "";
    const warmupProc = spawn(exePath, [], {
      cwd: contestDir,
      stdio: ["pipe", "ignore", "ignore"],
    });
    warmupProc.stdin.end(warmupInput);
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try { warmupProc.kill("SIGKILL"); } catch {}
        resolve();
      }, 50);
      warmupProc.on("close", () => {
        clearTimeout(timer);
        resolve();
      });
      warmupProc.on("error", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  } catch {}
}

// 4. テストケースの読み込みとソート
const testFiles = fs
  .readdirSync(testDir)
  .filter((f) => /^in\d+\.txt$/.test(f))
  .sort((a, b) => {
    const numA = parseInt(a.replace(/\D/g, ""), 10);
    const numB = parseInt(b.replace(/\D/g, ""), 10);
    return numA - numB;
  });

console.log(`${c.bold}==================================================${c.reset}`);
console.log(`問題: ${c.cyan}${contest.toUpperCase()} [${prob.toUpperCase()}]${c.reset}  (制限時間: ${timeLimitMs} ms)`);
console.log(`${c.bold}==================================================${c.reset}\n`);

/**
 * 1ケース実行関数
 */
function runSingleTest(inFile, outFile, testNum) {
  return new Promise((resolve) => {
    const inputData = fs.readFileSync(inFile, "utf8");
    const expectedOutput = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : "";

    const startTime = process.hrtime.bigint();
    let stdoutData = "";
    let stderrData = "";
    let isTimeout = false;

    const child = spawn(exePath, [], {
      cwd: contestDir,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      isTimeout = true;
      child.kill("SIGKILL");
    }, timeLimitMs);

    child.stdin.write(inputData);
    child.stdin.end();

    child.stdout.on("data", (data) => {
      stdoutData += data.toString();
    });
    child.stderr.on("data", (data) => {
      stderrData += data.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const endTime = process.hrtime.bigint();
      const elapsedMs = Number(endTime - startTime) / 1_000_000;

      if (isTimeout) {
        return resolve({
          status: "TLE",
          elapsedMs: timeLimitMs,
          input: inputData,
          expected: expectedOutput,
          actual: stdoutData,
          stderr: stderrData,
        });
      }

      if (code !== 0) {
        return resolve({
          status: "RE",
          code,
          elapsedMs,
          input: inputData,
          expected: expectedOutput,
          actual: stdoutData,
          stderr: stderrData,
        });
      }

      // 出力比較（改行・空白の正規化）
      const normExpected = expectedOutput
        .split(/\r?\n/)
        .map((l) => l.trimEnd())
        .join("\n")
        .trim();
      const normActual = stdoutData
        .split(/\r?\n/)
        .map((l) => l.trimEnd())
        .join("\n")
        .trim();

      const isAC = normExpected === normActual;

      resolve({
        status: isAC ? "AC" : "WA",
        elapsedMs,
        input: inputData,
        expected: expectedOutput,
        actual: stdoutData,
        stderr: stderrData,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        status: "RE",
        error: err.message,
        elapsedMs: 0,
        input: inputData,
        expected: expectedOutput,
        actual: "",
        stderr: err.message,
      });
    });
  });
}

// 5. テスト実行ループ（1ケースずつ順次実行してプロセス競合を回避）
let passedCount = 0;
let maxTimeMs = 0;

for (let i = 0; i < testFiles.length; i++) {
  const inFile = path.join(testDir, testFiles[i]);
  const outFile = path.join(testDir, `out${i + 1}.txt`);
  const caseNum = i + 1;

  const res = await runSingleTest(inFile, outFile, caseNum);
  if (res.elapsedMs > maxTimeMs) maxTimeMs = res.elapsedMs;

  const timeStr = `${Math.round(res.elapsedMs)} ms`;

  if (res.status === "AC") {
    passedCount++;
    console.log(`Case ${caseNum}: ${c.bgGreen} AC ${c.reset} ${c.gray}(${timeStr})${c.reset}`);
  } else if (res.status === "WA") {
    console.log(`Case ${caseNum}: ${c.bgRed} WA ${c.reset} ${c.gray}(${timeStr})${c.reset}`);
    console.log(`${c.gray}--- [入力] ---${c.reset}\n${res.input.trim()}`);
    console.log(`${c.green}--- [期待される出力] ---${c.reset}\n${res.expected.trim()}`);
    console.log(`${c.red}--- [あなたの出力] ---${c.reset}\n${res.actual.trim() || "(出力なし)"}\n`);
  } else if (res.status === "TLE") {
    console.log(`Case ${caseNum}: ${c.yellow}${c.bold} TLE ${c.reset} ${c.gray}(>${timeLimitMs} ms)${c.reset}`);
    console.log(`${c.gray}--- [入力] ---${c.reset}\n${res.input.trim()}\n`);
  } else if (res.status === "RE") {
    console.log(`Case ${caseNum}: ${c.magenta}${c.bold} RE (終了コード: ${res.code}) ${c.reset}`);
    if (res.stderr) console.log(`${c.red}${res.stderr.trim()}${c.reset}`);
    console.log();
  }
}

// 6. サマリー表示
console.log(`${c.bold}==================================================${c.reset}`);
if (passedCount === testFiles.length) {
  console.log(
    `${c.green}${c.bold}🎉 ALL SAMPLES PASSED!${c.reset} (${passedCount}/${testFiles.length} ケース合格 / 最大時間: ${Math.round(maxTimeMs)} ms)`
  );
} else {
  console.log(
    `${c.red}${c.bold}⚠️ RESULT:${c.reset} ${passedCount}/${testFiles.length} ケース合格 (最大時間: ${Math.round(maxTimeMs)} ms)`
  );
}
console.log(`${c.bold}==================================================${c.reset}`);
