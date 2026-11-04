#!/usr/bin/env bun

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fetchProblem } from "./fetch.ts";
import { runTestViaWslHybrid, type WslCaseInput } from "./wsl_bridge.ts";

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
const rawArgs = process.argv.slice(2);
if (rawArgs.length === 0) {
  console.error("エラー: コンテスト名と問題名を指定してください。");
  console.error("使い方: bun run test <コンテスト名> <問題名>");
  console.error("短縮形: bun run t <コンテスト名> <問題名>");
  console.error("例: bun run t abc480 g");
  console.error("例: bun run t AtCoder/abc480/g.cpp");
  console.error("例: bun run t codeforces 1900 a");
  process.exit(1);
}

let platform = "AtCoder";
let contest = "";
let prob = "";

// パターン 1: 3引数 (例: atcoder abc480 g / codeforces 1900 a)
if (rawArgs.length >= 3 && ["atcoder", "codeforces", "cf", "ac"].includes(rawArgs[0].toLowerCase())) {
  const p = rawArgs[0].toLowerCase();
  platform = p === "codeforces" || p === "cf" ? "Codeforces" : "AtCoder";
  contest = rawArgs[1].toLowerCase().replace(new RegExp(`^(${platform}|contests)[\\\\/]+`, "i"), "");
  prob = rawArgs[2].toLowerCase().replace(/\.cpp$/, "");
}
// パターン 2: 2引数 (例: abc480 g)
else if (rawArgs.length >= 2) {
  const p1 = rawArgs[0].replace(/\\/g, "/");
  const match = p1.match(/^(AtCoder|Codeforces)\/([^/]+)$/i);
  if (match) {
    platform = match[1].toLowerCase() === "codeforces" ? "Codeforces" : "AtCoder";
    contest = match[2].toLowerCase();
  } else {
    contest = rawArgs[0].toLowerCase().replace(/^(AtCoder|Codeforces|contests)[\\/]+/i, "");
    // AtCoder と Codeforces のどちらにファイルが存在するか自動判定
    if (fs.existsSync(path.join(projectRoot, "Codeforces", contest))) {
      platform = "Codeforces";
    } else {
      platform = "AtCoder";
    }
  }
  prob = rawArgs[1].toLowerCase().replace(/\.cpp$/, "");
}
// パターン 3: パス形式 (例: AtCoder/abc480/g.cpp や contests/abc480/g.cpp)
else {
  const norm = rawArgs[0].replace(/\\/g, "/");
  const match = norm.match(/(?:(?:AtCoder|Codeforces|contests)\/)?([^/]+)\/([a-zA-Z0-9_-]+)\.cpp$/i);
  if (match) {
    contest = match[1].toLowerCase();
    prob = match[2].toLowerCase();
    if (/Codeforces/i.test(norm) || fs.existsSync(path.join(projectRoot, "Codeforces", contest))) {
      platform = "Codeforces";
    } else {
      platform = "AtCoder";
    }
  } else {
    console.error("エラー: 問題の指定形式が正しくありません。");
    console.error("例: bun run t abc480 g");
    process.exit(1);
  }
}

const targetName = `${platform}_${contest}_${prob}`;
const contestDir = path.join(projectRoot, platform, contest);
const srcFile = path.join(contestDir, `${prob}.cpp`);
const testDir = path.join(contestDir, "test", prob);

if (!fs.existsSync(srcFile)) {
  console.error(`エラー: ソースファイルが見つかりません: ${path.relative(projectRoot, srcFile)}`);
  process.exit(1);
}

// 1. テストケースの存在確認＆自動取得
if (!fs.existsSync(testDir) || fs.readdirSync(testDir).filter((f) => f.startsWith("in")).length === 0) {
  const isGeneric = /^(abc|arc|agc|ahc|adt|daily|cf|codeforces)$/i.test(contest);
  if (isGeneric) {
    console.error(`${c.red}エラー: テストケースが見つかりません。${c.reset}`);
    console.error(`使い回しフォルダ '${contest}' にテストケースを取得してください:`);
    console.error(`  bun run fetch <コンテスト名> ${contest}   (例: bun run fetch ${contest}100 ${contest})`);
    console.error(`  または bun run ${contest} <コンテスト名>  (例: bun run ${contest} ${contest}100)`);
    process.exit(1);
  }
  console.log(`${c.cyan}[Auto-Fetch]${c.reset} テストケースが見つからないため、自動取得します...`);
  const fetchRes = await fetchProblem(contest, prob, platform, contest);
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

// テストケース一覧の事前取得
const testFiles = fs
  .readdirSync(testDir)
  .filter((f) => /^in\d+\.txt$/.test(f))
  .sort((a, b) => {
    const numA = parseInt(a.replace(/\D/g, ""), 10);
    const numB = parseInt(b.replace(/\D/g, ""), 10);
    return numA - numB;
  });

// 2.5. WSL2 / Linux 2層ハイブリッド高速エンジン ($HOME/.cache/oj-cp ⇄ /dev/shm) を優先試行
const wslCases: WslCaseInput[] = testFiles.map((inFileName, idx) => {
  const caseNum = idx + 1;
  const inFile = path.join(testDir, inFileName);
  const outFile = path.join(testDir, `out${caseNum}.txt`);
  return {
    caseNum,
    input: fs.readFileSync(inFile, "utf8"),
    expected: fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : "",
  };
});

const wslSummary = !rawArgs.includes("--no-wsl")
  ? runTestViaWslHybrid(targetName, srcFile, timeLimitMs, wslCases)
  : null;

if (wslSummary) {
  if (wslSummary.mountedFromHomeCache) {
    console.log(
      `${c.cyan}[WSL Hybrid]${c.reset} 永続マスター (${c.bold}$HOME/.cache/oj-cp${c.reset}) から RAMディスク (${c.bold}/dev/shm${c.reset}) へ即時展開しました`
    );
  }
  if (wslSummary.syncedLibCount > 0) {
    console.log(`${c.cyan}[Delta Sync]${c.reset} lib/ の変更差分 ${wslSummary.syncedLibCount} 件を WSL へ同期しました`);
  }
  if (wslSummary.buildError) {
    console.error(`${c.red}✗ ビルドエラー (WSL /dev/shm):${c.reset}`);
    console.error(wslSummary.buildError);
    process.exit(1);
  }
  if (wslSummary.needsBuild) {
    console.log(
      `${c.green}✓ ビルド成功 [WSL /dev/shm + PCH]${c.reset} ${c.gray}(コンパイル時間: ${wslSummary.buildDurationMs} ms)${c.reset}\n`
    );
  } else {
    console.log(`${c.green}✓ ソースコード変更なし [WSL /dev/shm]（ビルドスキップ: 0 ms）${c.reset}\n`);
  }

  console.log(`${c.bold}==================================================${c.reset}`);
  console.log(`問題: ${c.cyan}[${platform}] ${contest.toUpperCase()} [${prob.toUpperCase()}]${c.reset}  (制限時間: ${timeLimitMs} ms)`);
  console.log(`${c.bold}==================================================${c.reset}\n`);

  let passedCount = 0;
  let maxTimeMs = 0;

  for (const res of wslSummary.results) {
    if (res.elapsedMs > maxTimeMs) maxTimeMs = res.elapsedMs;
    const timeStr = `${Math.round(res.elapsedMs)} ms`;

    if (res.status === "AC") {
      passedCount++;
      console.log(`Case ${res.caseNum}: ${c.bgGreen} AC ${c.reset} ${c.gray}(${timeStr})${c.reset}`);
    } else if (res.status === "WA") {
      console.log(`Case ${res.caseNum}: ${c.bgRed} WA ${c.reset} ${c.gray}(${timeStr})${c.reset}`);
      console.log(`${c.gray}--- [入力] ---${c.reset}\n${res.input.trim()}`);
      console.log(`${c.green}--- [期待される出力] ---${c.reset}\n${res.expected.trim()}`);
      console.log(`${c.red}--- [あなたの出力] ---${c.reset}\n${res.actual.trim() || "(出力なし)"}\n`);
    } else if (res.status === "TLE") {
      console.log(`Case ${res.caseNum}: ${c.yellow}${c.bold} TLE ${c.reset} ${c.gray}(>${timeLimitMs} ms)${c.reset}`);
      console.log(`${c.gray}--- [入力] ---${c.reset}\n${res.input.trim()}\n`);
    } else if (res.status === "RE") {
      console.log(`Case ${res.caseNum}: ${c.magenta}${c.bold} RE (終了コード: ${res.exitCode}) ${c.reset}`);
      if (res.stderr) console.log(`${c.red}${res.stderr.trim()}${c.reset}`);
      console.log();
    }
  }

  const buildSummaryStr = wslSummary.needsBuild
    ? `コンパイル: ${wslSummary.buildDurationMs} ms / `
    : "コンパイル: 0 ms (スキップ) / ";
  console.log(`${c.bold}==================================================${c.reset}`);
  if (passedCount === testFiles.length) {
    console.log(
      `${c.green}${c.bold}🎉 ALL SAMPLES PASSED!${c.reset} (${passedCount}/${testFiles.length} ケース合格 / ${buildSummaryStr}最大実行時間: ${Math.round(maxTimeMs)} ms)`
    );
  } else {
    console.log(
      `${c.red}${c.bold}⚠️ RESULT:${c.reset} ${passedCount}/${testFiles.length} ケース合格 (${buildSummaryStr}最大実行時間: ${Math.round(maxTimeMs)} ms)`
    );
  }
  console.log(`${c.bold}==================================================${c.reset}`);
  process.exit(0);
}

// 3. CMake での自動コンパイル (WSL が無い環境向けのフォールバック)
const isLinux = process.platform === "linux";
const useShm = isLinux && fs.existsSync("/dev/shm");
const buildDir = useShm
  ? "/dev/shm/CompetitiveProgramming-build"
  : path.join(projectRoot, isLinux ? "cmake-build-debug-wsl" : "cmake-build-debug-mingw");

const exePath = path.join(
  buildDir,
  isLinux ? targetName : `${targetName}.exe`
);

// Linux (/dev/shm) 環境での CMake 初回セットアップ自動化
if (isLinux) {
  const ninjaFile = path.join(buildDir, "build.ninja");
  const makeFile = path.join(buildDir, "Makefile");
  if (!fs.existsSync(ninjaFile) && !fs.existsSync(makeFile)) {
    console.log(`${c.cyan}[Setup]${c.reset} ${useShm ? "/dev/shm (RAMディスク)" : "WSL"} 上にビルド環境を初期化中...`);
    fs.mkdirSync(buildDir, { recursive: true });
    try {
      execFileSync("cmake", ["-B", buildDir, "-S", projectRoot, "-G", "Ninja", "-DCMAKE_BUILD_TYPE=Debug"], {
        cwd: projectRoot,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      execFileSync("cmake", ["-B", buildDir, "-S", projectRoot, "-DCMAKE_BUILD_TYPE=Debug"], {
        cwd: projectRoot,
        stdio: ["pipe", "pipe", "pipe"],
      });
    }
  }
}

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

let buildDurationMs = 0;

if (needsBuild) {
  console.log(`${c.cyan}[Build]${c.reset} ${targetName} をコンパイル中...`);
  const buildStart = performance.now();

  try {
    if (isLinux) {
      if (fs.existsSync(path.join(buildDir, "build.ninja"))) {
        execFileSync("ninja", ["-C", buildDir, targetName], {
          cwd: projectRoot,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } else {
        execFileSync("cmake", ["--build", buildDir, "--target", targetName], {
          cwd: projectRoot,
          stdio: ["pipe", "pipe", "pipe"],
        });
      }
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
    buildDurationMs = Math.round(performance.now() - buildStart);
    console.log(`${c.green}✓ ビルド成功${c.reset} ${c.gray}(コンパイル時間: ${buildDurationMs} ms)${c.reset}\n`);
  } catch (err: any) {
    console.error(`${c.red}✗ ビルドエラー:${c.reset}`);
    if (err.stderr && err.stderr.length > 0) console.error(err.stderr.toString());
    else if (err.stdout && err.stdout.length > 0) console.error(err.stdout.toString());
    else console.error(err.message || err);
    process.exit(1);
  }
} else {
  console.log(`${c.green}✓ ソースコード変更なし（ビルドスキップ: 0 ms）${c.reset}\n`);
}

// 初回実行時のWindows Defenderスキャン＆DLL読み込み遅延（ウォームアップ: Windowsのみ）
if (!isLinux) {
  try {
    let smallestInputFile: string | null = null;
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
    await new Promise<void>((resolve) => {
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

// 4. テスト実行（フォールバック時）
console.log(`${c.bold}==================================================${c.reset}`);
console.log(`問題: ${c.cyan}[${platform}] ${contest.toUpperCase()} [${prob.toUpperCase()}]${c.reset}  (制限時間: ${timeLimitMs} ms)`);
console.log(`${c.bold}==================================================${c.reset}\n`);

interface TestResult {
  status: "AC" | "WA" | "TLE" | "RE";
  elapsedMs: number;
  input: string;
  expected: string;
  actual: string;
  stderr: string;
  code?: number | null;
  error?: string;
}

/**
 * 1ケース実行関数
 */
function runSingleTest(inFile: string, outFile: string, testNum: number): Promise<TestResult> {
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
const buildSummaryStr = needsBuild ? `コンパイル: ${buildDurationMs} ms / ` : "コンパイル: 0 ms (スキップ) / ";
console.log(`${c.bold}==================================================${c.reset}`);
if (passedCount === testFiles.length) {
  console.log(
    `${c.green}${c.bold}🎉 ALL SAMPLES PASSED!${c.reset} (${passedCount}/${testFiles.length} ケース合格 / ${buildSummaryStr}最大実行時間: ${Math.round(maxTimeMs)} ms)`
  );
} else {
  console.log(
    `${c.red}${c.bold}⚠️ RESULT:${c.reset} ${passedCount}/${testFiles.length} ケース合格 (${buildSummaryStr}最大実行時間: ${Math.round(maxTimeMs)} ms)`
  );
}
console.log(`${c.bold}==================================================${c.reset}`);
