#!/usr/bin/env bun

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { installWindowsNewlineFix, getTermWidth, hr } from "./tty_fix.ts";

installWindowsNewlineFix();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

// カラー定義
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

function toSlash(p: string): string {
  return p.replace(/\\/g, "/");
}

// PRNG (XorShift128+) による高速かつ決定論的な擬似乱数生成（AI非依存・純粋算術）
class FastRng {
  private s0: bigint;
  private s1: bigint;

  constructor(seed = Date.now()) {
    let s = BigInt(seed);
    if (s === 0n) s = 123456789n;
    // SplitMix64 で初期化
    s = (s ^ (s >> 30n)) * 0xbf58476d1ce4e5b9n;
    s = (s ^ (s >> 27n)) * 0x94d049bb133111ebn;
    this.s0 = s ^ (s >> 31n);
    s = (s + 0x9e3779b97f4a7c15n);
    s = (s ^ (s >> 30n)) * 0xbf58476d1ce4e5b9n;
    s = (s ^ (s >> 27n)) * 0x94d049bb133111ebn;
    this.s1 = s ^ (s >> 31n);
  }

  nextU64(): bigint {
    let x = this.s0;
    const y = this.s1;
    this.s0 = y;
    x ^= (x << 23n) & 0xffffffffffffffffn;
    this.s1 = (x ^ y ^ (x >> 17n) ^ (y >> 26n)) & 0xffffffffffffffffn;
    return (this.s1 + y) & 0xffffffffffffffffn;
  }

  nextInt(min: number, max: number): number {
    if (min >= max) return min;
    const range = BigInt(max - min + 1);
    const val = Number(this.nextU64() % range);
    return min + val;
  }

  nextFloat(min: number, max: number): number {
    const u = Number(this.nextU64() % 100000000n) / 100000000;
    return min + u * (max - min);
  }

  choice<T>(arr: T[]): T {
    return arr[this.nextInt(0, arr.length - 1)];
  }

  shuffle<T>(arr: T[]): T[] {
    const res = [...arr];
    for (let i = res.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [res[i], res[j]] = [res[j], res[i]];
    }
    return res;
  }
}

// JSON 入力スキーマの型定義
export interface InputSchemaField {
  name?: string;
  type: "int" | "float" | "string" | "array" | "permutation" | "tree" | "graph" | "grid";
  min?: number;
  max?: number;
  digits?: number;
  chars?: string;
  length?: number | string; // 変数名または数値
  nodes?: number | string;
  edges?: number | string;
  rows?: number | string;
  cols?: number | string;
  oneBased?: boolean;
}

export interface StressConfig {
  maxCases?: number;
  timeLimitMs?: number;
  inputs: InputSchemaField[];
  checker?: string; // 例: "check_a.cpp"
}

/**
 * JSON スキーマからランダムテスト入力を生成するエンジン
 */
export function generateTestInput(schema: StressConfig, rng: FastRng, overrides?: Record<string, number>): string {
  const vars: Record<string, number> = { ...(overrides || {}) };
  const lines: string[] = [];

  const resolveVal = (v: number | string | undefined, defaultVal: number): number => {
    if (v === undefined) return defaultVal;
    if (typeof v === "number") return v;
    if (v in vars) return vars[v];
    const parsed = parseInt(v, 10);
    return isNaN(parsed) ? defaultVal : parsed;
  };

  for (const field of schema.inputs) {
    switch (field.type) {
      case "int": {
        const min = field.min ?? 1;
        const max = field.max ?? 100;
        const val = (field.name && field.name in vars) ? vars[field.name] : rng.nextInt(min, max);
        if (field.name) vars[field.name] = val;
        lines.push(String(val));
        break;
      }
      case "float": {
        const min = field.min ?? 0;
        const max = field.max ?? 1;
        const digits = field.digits ?? 4;
        const val = rng.nextFloat(min, max).toFixed(digits);
        lines.push(val);
        break;
      }
      case "string": {
        const len = resolveVal(field.length, 5);
        const chars = field.chars || "abcdefghijklmnopqrstuvwxyz";
        let str = "";
        for (let i = 0; i < len; i++) {
          str += chars[rng.nextInt(0, chars.length - 1)];
        }
        lines.push(str);
        break;
      }
      case "array": {
        const len = resolveVal(field.length, 5);
        const min = field.min ?? 1;
        const max = field.max ?? 100;
        const arr: number[] = [];
        for (let i = 0; i < len; i++) {
          arr.push(rng.nextInt(min, max));
        }
        lines.push(arr.join(" "));
        break;
      }
      case "permutation": {
        const len = resolveVal(field.length, 5);
        const base = field.oneBased !== false ? 1 : 0;
        const arr = Array.from({ length: len }, (_, i) => i + base);
        lines.push(rng.shuffle(arr).join(" "));
        break;
      }
      case "tree": {
        const n = resolveVal(field.nodes, 5);
        const oneBased = field.oneBased !== false;
        const offset = oneBased ? 1 : 0;
        const edges: string[] = [];
        // ランダムな木（連結かつ閉路なしを数学的に保証）
        for (let i = 1; i < n; i++) {
          const u = i + offset;
          const p = rng.nextInt(0, i - 1) + offset;
          edges.push(`${u} ${p}`);
        }
        lines.push(edges.join("\n"));
        break;
      }
      case "graph": {
        const n = resolveVal(field.nodes, 5);
        const m = resolveVal(field.edges, n);
        const oneBased = field.oneBased !== false;
        const offset = oneBased ? 1 : 0;
        const edgeSet = new Set<string>();
        const edges: string[] = [];
        // まず全域木を作って連結性を保証
        for (let i = 1; i < n; i++) {
          const u = i + offset;
          const p = rng.nextInt(0, i - 1) + offset;
          edgeSet.add(`${Math.min(u, p)}-${Math.max(u, p)}`);
          edges.push(`${u} ${p}`);
        }
        // 残りの辺をランダム追加（自己ループ・多重辺防止）
        let attempts = 0;
        while (edges.length < m && attempts < m * 10) {
          attempts++;
          const u = rng.nextInt(0, n - 1) + offset;
          const v = rng.nextInt(0, n - 1) + offset;
          if (u === v) continue;
          const key = `${Math.min(u, v)}-${Math.max(u, v)}`;
          if (!edgeSet.has(key)) {
            edgeSet.add(key);
            edges.push(`${u} ${v}`);
          }
        }
        lines.push(edges.join("\n"));
        break;
      }
      case "grid": {
        const r = resolveVal(field.rows, 3);
        const cl = resolveVal(field.cols, 3);
        const chars = field.chars || ".#";
        const gridLines: string[] = [];
        for (let i = 0; i < r; i++) {
          let row = "";
          for (let j = 0; j < cl; j++) {
            row += chars[rng.nextInt(0, chars.length - 1)];
          }
          gridLines.push(row);
        }
        lines.push(gridLines.join("\n"));
        break;
      }
    }
  }

  return lines.join("\n") + "\n";
}

/**
 * C++ ファイルのコンパイル（キャッシュ対応）
 */

function findCompiler(): string {
  if (process.platform !== "win32") {
    return "g++";
  }

  // 1. CLion バンドルの MinGW g++ を優先探索
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const clionGpp = path.join(localAppData, "Programs", "CLion", "bin", "mingw", "bin", "g++.exe");
  if (fs.existsSync(clionGpp)) {
    return clionGpp;
  }

  // 2. PATH にある g++
  const whereRes = spawnSync("where.exe", ["g++"], { encoding: "utf8" });
  if (whereRes.status === 0 && whereRes.stdout) {
    const first = whereRes.stdout.split(/\r?\n/)[0]?.trim();
    if (first && fs.existsSync(first)) return first;
  }

  return "g++";
}

function compileCppFile(srcPath: string, outBinPath: string): { success: boolean; error?: string } {
  const compiler = findCompiler();
  const libDir = path.join(projectRoot, "lib");

  const compileArgs = [
    "-std=c++23",
    "-O2",
    "-fno-exceptions",
    "-fno-rtti",
    "-I" + libDir,
    srcPath,
    "-o",
    outBinPath,
  ];

  const res = spawnSync(compiler, compileArgs, { encoding: "utf8" });
  if (res.status !== 0) {
    return { success: false, error: res.stderr || res.stdout || "Compile error" };
  }
  return { success: true };
}

/**
 * デフォルトの stress.json と check.cpp を生成する
 */
export function initStressFiles(targetDir: string, prob: string): { jsonPath: string; checkerPath: string } {
  const testDir = path.join(targetDir, "test", prob);
  fs.mkdirSync(testDir, { recursive: true });

  const jsonPath = path.join(testDir, "stress.json");
  const checkerPath = path.join(testDir, "check.cpp");

  if (!fs.existsSync(jsonPath)) {
    const defaultConfig: StressConfig = {
      maxCases: 100,
      timeLimitMs: 2000,
      inputs: [
        { name: "N", type: "int", min: 2, max: 10 },
        { name: "A", type: "array", length: "N", min: 1, max: 20 },
      ],
      checker: "check.cpp",
    };
    fs.writeFileSync(jsonPath, JSON.stringify(defaultConfig, null, 2), "utf8");
    console.log(`${c.green}[INIT] 作成:${c.reset} ${toSlash(path.relative(projectRoot, jsonPath))}`);
  }

  if (!fs.existsSync(checkerPath)) {
    const defaultCheckerSource = `// Checker for problem [${prob.toUpperCase()}]
// argv[1]: Input file path, argv[2]: Your program output file path
// Return exit(0) if valid (AC), return exit(1) with error reason if invalid (WA).

#include <iostream>
#include <fstream>
#include <vector>
#include <string>
#include <cmath>

using namespace std;

int main(int argc, char* argv[]) {
    if (argc < 3) {
        cerr << "Usage: checker <in_file> <out_file>" << endl;
        return 2;
    }

    ifstream fin(argv[1]);
    ifstream fout(argv[2]);

    if (!fin.is_open() || !fout.is_open()) {
        cerr << "Error opening test files" << endl;
        return 2;
    }

    // 1. Read input
    int n;
    if (!(fin >> n)) return 0;
    vector<int> a(n);
    for (int i = 0; i < n; i++) fin >> a[i];

    // 2. Read your program's output
    string ans;
    if (!(fout >> ans)) {
        cerr << "Checker: Output is empty" << endl;
        return 1; // WA
    }

    // 3. Verification logic (Customize for your problem)
    // Example:
    // if (ans == "No" && shouldBeYes) {
    //     cerr << "Expected Yes but got No" << endl;
    //     return 1;
    // }

    return 0; // AC (Passed)
}
`;
    fs.writeFileSync(checkerPath, defaultCheckerSource, "utf8");
    console.log(`${c.green}[INIT] 作成:${c.reset} ${path.relative(projectRoot, checkerPath)}`);
  }

  return { jsonPath, checkerPath };
}

/**
 * メインのストレステスト実行関数
 */
export async function runStressTest(platform: string, folder: string, prob: string): Promise<void> {
  const targetDir = path.join(projectRoot, platform, folder);
  const srcPath = path.join(targetDir, `${prob}.cpp`);

  if (!fs.existsSync(srcPath)) {
    console.error(`${c.red}エラー: 対象コードが見つかりません: ${srcPath}${c.reset}`);
    return;
  }

  const testDir = path.join(targetDir, "test", prob);
  fs.mkdirSync(testDir, { recursive: true });

  let jsonPath = path.join(testDir, "stress.json");
  let checkerPath = path.join(testDir, "check.cpp");

  // 既存の直下ファイル (legacy) があれば test/<prob>/ へ自動集約
  const legacyJson = path.join(targetDir, `stress_${prob}.json`);
  const legacyChecker = path.join(targetDir, `check_${prob}.cpp`);
  if (fs.existsSync(legacyJson) && !fs.existsSync(jsonPath)) {
    fs.renameSync(legacyJson, jsonPath);
  }
  if (fs.existsSync(legacyChecker) && !fs.existsSync(checkerPath)) {
    fs.renameSync(legacyChecker, checkerPath);
  }

  // ファイルが存在しない場合は初期化
  if (!fs.existsSync(jsonPath) || !fs.existsSync(checkerPath)) {
    console.log(`\x1b[90m${hr("-")}\x1b[0m`);
    console.log(`  ${c.bold}[STRESS TEST SETUP]${c.reset} 設定ファイルを初期化します (test/${prob}/)`);
    console.log(`\x1b[90m${hr("-")}\x1b[0m`);
    initStressFiles(targetDir, prob);
    console.log(`\n${c.yellow}ヒント: 必要に応じて上記ファイルを編集後、再度 'oj stress ${prob}' を実行してください。${c.reset}\n`);
  }

  let config: StressConfig;
  try {
    config = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  } catch (err: any) {
    console.error(`${c.red}エラー: ${jsonPath} の JSON 読み込みに失敗しました: ${err.message}${c.reset}`);
    return;
  }

  // チェッカーのパス解決 (test/<prob>/ 直下、または指定パス)
  let customChecker = checkerPath;
  if (config.checker) {
    const candidateInTest = path.join(testDir, config.checker);
    const candidateInTarget = path.join(targetDir, config.checker);
    if (fs.existsSync(candidateInTest)) {
      customChecker = candidateInTest;
    } else if (fs.existsSync(candidateInTarget)) {
      customChecker = candidateInTarget;
    } else if (fs.existsSync(checkerPath)) {
      customChecker = checkerPath;
    } else {
      customChecker = candidateInTest;
    }
  }
  if (!fs.existsSync(customChecker)) {
    console.error(`${c.red}エラー: チェッカーファイルが見つかりません: ${customChecker}${c.reset}`);
    return;
  }

  const maxCases = config.maxCases || 100;
  const timeLimitMs = config.timeLimitMs || 2000;

  // 出力用一時バイナリ・フォルダ準備
  const buildDir = path.join(projectRoot, "cmake-build-debug-local", "stress", `${platform}_${folder}_${prob}`);
  fs.mkdirSync(buildDir, { recursive: true });
  const targetBin = path.join(buildDir, process.platform === "win32" ? "target.exe" : "target.out");
  const checkerBin = path.join(buildDir, process.platform === "win32" ? "checker.exe" : "checker.out");

  console.log(`\x1b[90m${hr("-")}\x1b[0m`);
  console.log(`  ${c.bold}[STRESS TEST]${c.reset} [${platform}] ${folder.toUpperCase()} [${prob.toUpperCase()}] (Checker Verifier)`);
  console.log(`  Target   : ${toSlash(path.relative(projectRoot, srcPath))}`);
  console.log(`  Checker  : ${toSlash(path.relative(projectRoot, customChecker))}`);
  console.log(`  Config   : ${toSlash(path.relative(projectRoot, jsonPath))} (${maxCases} cases)`);
  console.log(`\x1b[90m${hr("-")}\x1b[0m`);

  // 1. ビルド
  process.stdout.write(`  Build target  ... `);
  const targetBuild = compileCppFile(srcPath, targetBin);
  if (!targetBuild.success) {
    console.log(`${c.red}[FAILED]${c.reset}`);
    console.error(`\n${c.red}${targetBuild.error}${c.reset}`);
    return;
  }
  console.log(`${c.green}[OK]${c.reset}`);

  process.stdout.write(`  Build checker ... `);
  const checkerBuild = compileCppFile(customChecker, checkerBin);
  if (!checkerBuild.success) {
    console.log(`${c.red}[FAILED]${c.reset}`);
    console.error(`\n${c.red}${checkerBuild.error}${c.reset}`);
    return;
  }
  console.log(`${c.green}[OK]${c.reset}\n`);

  // 2. ストレステスト実行ループ
  const rng = new FastRng(Date.now());
  const tempIn = path.join(buildDir, "input.txt");
  const tempOut = path.join(buildDir, "output.txt");

  let failedCase: { input: string; output: string; reason: string; caseNum: number } | null = null;
  let passedCount = 0;

  for (let i = 1; i <= maxCases; i++) {
    const inputData = generateTestInput(config, rng);
    fs.writeFileSync(tempIn, inputData, "utf8");

    // ターゲット実行
    const start = performance.now();
    const runRes = spawnSync(targetBin, [], {
      input: inputData,
      timeout: timeLimitMs,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    const elapsed = Math.round(performance.now() - start);

    if (runRes.error && (runRes.error as any).code === "ETIMEDOUT") {
      failedCase = { input: inputData, output: "(TLE: Time Limit Exceeded)", reason: `実行制限時間 (${timeLimitMs} ms) を超過しました`, caseNum: i };
      break;
    }
    if (runRes.status !== 0) {
      failedCase = { input: inputData, output: runRes.stdout || "", reason: `ランタイムエラー (exit: ${runRes.status})\n${runRes.stderr || ""}`.trim(), caseNum: i };
      break;
    }

    const actualOutput = runRes.stdout || "";
    fs.writeFileSync(tempOut, actualOutput, "utf8");

    // チェッカー実行 (argv[1]: tempIn, argv[2]: tempOut)
    const checkRes = spawnSync(checkerBin, [tempIn, tempOut], {
      timeout: timeLimitMs,
      encoding: "utf8",
    });

    if (checkRes.status !== 0) {
      const reason = checkRes.stderr?.trim() || checkRes.stdout?.trim() || "チェッカーが不正解 (Invalid) を返しました";
      failedCase = { input: inputData, output: actualOutput, reason, caseNum: i };
      break;
    }

    passedCount++;
    if (process.stdout.isTTY) {
      const pct = Math.round((i / maxCases) * 100);
      process.stdout.write(`\r  Testing: ${i}/${maxCases} cases (${pct}%) passed...`);
    }
  }

  if (process.stdout.isTTY) {
    process.stdout.write("\r" + " ".repeat(50) + "\r");
  }

  // 3. 結果判定
  if (!failedCase) {
    console.log(`\x1b[90m${hr("-")}\x1b[0m`);
    console.log(`  ${c.green}${c.bold}[ALL PASSED]${c.reset} ${passedCount}/${maxCases} ケース合格 (チェッカー検証完了)`);
    console.log(`\x1b[90m${hr("-")}\x1b[0m`);
    return;
  }

  // 4. 反例発見時の処理
  console.log(`  ${c.red}${c.bold}[FAILED]${c.reset} Case #${failedCase.caseNum} で反例（条件違反）を検出しました`);

  // 5. 最小反例の縮小 (Delta Debugging)
  let minimalInput = failedCase.input;
  let minimalOutput = failedCase.output;
  let minimalReason = failedCase.reason;

  // 配列長や N などの変数がある場合、最小化を試みる
  const intVars = config.inputs.filter((f) => f.type === "int" && f.name);
  if (intVars.length > 0) {
    process.stdout.write(`  [Minimizer] 反例サイズを自動縮小中 (Delta Debugging)... `);
    let reduced = false;

    for (const v of intVars) {
      if (!v.name) continue;
      const minVal = v.min ?? 1;
      let curVal = minVal + 5; // 初期スモール値

      for (let testN = minVal; testN <= curVal; testN++) {
        const shrinkRng = new FastRng(42);
        for (let attempt = 0; attempt < 20; attempt++) {
          const shrinkIn = generateTestInput(config, shrinkRng, { [v.name]: testN });
          fs.writeFileSync(tempIn, shrinkIn, "utf8");

          const runRes = spawnSync(targetBin, [], { input: shrinkIn, timeout: timeLimitMs, encoding: "utf8" });
          if (runRes.status === 0) {
            const out = runRes.stdout || "";
            fs.writeFileSync(tempOut, out, "utf8");
            const checkRes = spawnSync(checkerBin, [tempIn, tempOut], { timeout: timeLimitMs, encoding: "utf8" });
            if (checkRes.status !== 0) {
              minimalInput = shrinkIn;
              minimalOutput = out;
              minimalReason = checkRes.stderr?.trim() || checkRes.stdout?.trim() || "チェッカー検証不合格";
              reduced = true;
              break;
            }
          }
        }
        if (reduced) break;
      }
    }

    if (reduced) {
      console.log(`${c.green}[縮小成功!]${c.reset}`);
    } else {
      console.log(`${c.gray}[元のサイズで維持]${c.reset}`);
    }
  }

  // 6. 最小反例の整然とした表示
  console.log(`\x1b[90m${hr("-")}\x1b[0m`);
  console.log(`${c.bold}  [MINIMAL COUNTEREXAMPLE]${c.reset}`);
  console.log(`\x1b[90m${hr("-")}\x1b[0m`);

  const indent = (s: string) => s.trim().split(/\r?\n/).map((l) => `      ${l}`).join("\n");
  console.log(`    [90m--- [Input] ---[0m\n${indent(minimalInput)}`);
  console.log(`    [33m--- [Your Output] ---[0m\n${indent(minimalOutput || "(no output)")}`);
  console.log(`    [31m--- [Checker Reason] ---[0m\n${indent(minimalReason)}`);
  console.log(`\x1b[90m${hr("-")}\x1b[0m`);

  // 7. アクション選択 (テストケースへの追加など)

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const promptAction = () => {
    rl.question(`  [A] テストケースに保存 | [Q] 終了 > `, (ans) => {
      const a = ans.trim().toLowerCase();
      if (a === "a") {
        // 次の空き番号を探す
        let idx = 1;
        while (fs.existsSync(path.join(testDir, `sample_hack_${idx}.in`))) {
          idx++;
        }
        const saveIn = path.join(testDir, `sample_hack_${idx}.in`);
        const saveOut = path.join(testDir, `sample_hack_${idx}.out`);
        fs.writeFileSync(saveIn, minimalInput, "utf8");
        fs.writeFileSync(saveOut, minimalOutput, "utf8");
        console.log(`\n${c.green}✓ テストケースに保存しました:${c.reset} ${path.relative(projectRoot, saveIn)}`);
        console.log(`${c.gray}以後は 'oj t ${prob}' でこの反例を含めて自動テストされます。${c.reset}\n`);
        rl.close();
      } else {
        rl.close();
      }
    });
  };

  promptAction();
}

// 直接実行時のエントリポイント
if (import.meta.main) {
  const args = process.argv.slice(2);
  const platform = args[0] || "AtCoder";
  const folder = args[1] || "abc";
  const prob = (args[2] || "a").toLowerCase();
  runStressTest(platform, folder, prob);
}
