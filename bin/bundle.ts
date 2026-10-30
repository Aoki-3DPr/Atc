#!/usr/bin/env bun

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

/**
 * ライブラリファイルからクラス等の本体だけを抽出する関数
 */
function extractLibraryBody(rawContent: string): string {
  let content = rawContent;

  // 1. // BEGIN 〜 // END マーカーがある場合はその間だけを最優先で抽出
  const markerMatch = content.match(/\/\/\s*BEGIN[\s\S]*?\/\/\s*END/i);
  if (markerMatch) {
    return markerMatch[0]
      .replace(/\/\/\s*BEGIN/i, "")
      .replace(/\/\/\s*END/i, "")
      .trim();
  }

  // 2. #pragma once の除去
  content = content.replace(/#pragma\s+once[^\r\n]*/gi, "");

  // 3. ライブラリ内の #include 行の除去
  content = content.replace(/^\s*#include\s*["<][^">]+[">]\s*$/gm, "");

  // 4. 重複しやすい using namespace std, #define ll の除去
  content = content.replace(/^\s*using\s+namespace\s+std\s*;\s*$/gm, "");
  content = content.replace(/^\s*#define\s+ll\s+long\s+long\s*$/gm, "");

  // 5. BUILDING_LIB_STANDALONE 保護されたブロック、または main() 関数の除去
  content = content.replace(/#ifdef\s+BUILDING_LIB_STANDALONE[\s\S]*?#endif/gi, "");
  content = content.replace(
    /(?:signed|int)\s+main\s*\([^)]*\)\s*\{[\s\S]*?\n\}/g,
    ""
  );

  return content.trim();
}

interface BundledLibrary {
  name: string;
  body: string;
}

/**
 * 対象ソースコード内のローカル #include を走査して展開する
 */
export function bundle(sourceFilePath: string): string {
  const sourceCode = fs.readFileSync(sourceFilePath, "utf8");
  const sourceDir = path.dirname(sourceFilePath);

  const lines = sourceCode.split(/\r?\n/);
  const libraries: BundledLibrary[] = [];
  const visitedLibs = new Set<string>();
  const userCodeLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // ローカル #include "..." の検出
    const incMatch = trimmed.match(/^#include\s*["<]([^">]+\.(?:cpp|h|hpp))[">]/);
    if (!incMatch) {
      userCodeLines.push(line);
      continue;
    }

    const headerName = incMatch[1];

    // 標準ヘッダ（bits/stdc++.h など）はそのまま残す
    if (headerName === "bits/stdc++.h" || headerName.startsWith("bits/")) {
      userCodeLines.push(line);
      continue;
    }

    // 探す場所: ソースファイルの同階層、または lib/ 配下
    const searchCandidates = [
      path.join(sourceDir, headerName),
      path.join(projectRoot, "lib", headerName),
      path.join(projectRoot, headerName),
    ];

    let foundLibPath: string | null = null;
    for (const cand of searchCandidates) {
      if (fs.existsSync(cand)) {
        foundLibPath = cand;
        break;
      }
    }

    if (!foundLibPath) {
      userCodeLines.push(line);
      continue;
    }

    const realPath = fs.realpathSync(foundLibPath);
    if (!visitedLibs.has(realPath)) {
      visitedLibs.add(realPath);
      const raw = fs.readFileSync(foundLibPath, "utf8");
      const body = extractLibraryBody(raw);
      libraries.push({ name: path.basename(foundLibPath), body });
    }
  }

  // ユーザーコードの中から、先頭の includes, #define, using namespace std, Git URL等のコメントを抽出
  const headerSection: string[] = [];
  const restSection: string[] = [];
  let headerFinished = false;

  for (const line of userCodeLines) {
    const trimmed = line.trim();

    // 過去のバナーコメントの混入を防止・自動除去
    if (
      /^\/\/\s*=+\s*$/.test(trimmed) ||
      /^\/\/\s*User Solution Code/i.test(trimmed) ||
      /^\/\/\s*Libraries \(Auto-Bundled\)/i.test(trimmed) ||
      /^\/\/\s*---\s*\[.*?\]\s*---/.test(trimmed)
    ) {
      continue;
    }

    if (!headerFinished) {
      if (
        /^#include\b/.test(trimmed) ||
        /^#define\b/.test(trimmed) ||
        /^#undef\b/.test(trimmed) ||
        /^#pragma\b/.test(trimmed) ||
        /^using\s+/.test(trimmed) ||
        /^typedef\s+/.test(trimmed) ||
        /^\/\//.test(trimmed) ||
        /^\/\*/.test(trimmed) ||
        /^\*/.test(trimmed) ||
        trimmed === ""
      ) {
        headerSection.push(line);
        continue;
      } else {
        headerFinished = true;
      }
    }
    restSection.push(line);
  }

  // 組み立て順序:
  // 1. 基本ヘッダ・型定義・マクロ・Git URL (using namespace std, #define ll, Git URL等)
  // 2. 抽出したライブラリクラス (std や ll や Git URL の直後に展開)
  // 3. ユーザーの解答コード (int di, solve, main など)
  const outputParts: string[] = [];

  outputParts.push(headerSection.join("\n").trimEnd());

  // ライブラリ部分 (using namespace std や Git URL の直後に展開)
  if (libraries.length > 0) {
    for (const lib of libraries) {
      outputParts.push("\n" + lib.body);
    }
  }

  // ユーザー解答部分
  outputParts.push("\n" + restSection.join("\n").trimStart());

  return outputParts.join("\n");
}

// CLIから直接実行された場合
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.length === 0) {
    console.error("エラー: 対象のファイルを指定してください。");
    console.error("使い方: bun run bundle <コンテスト名> <問題名>");
    console.error("短縮形: bun run b <コンテスト名> <問題名>");
    console.error("例: bun run b abc480 g");
    console.error("例: bun run b abc g              (使い回しフォルダ abc/g.cpp)");
    console.error("例: bun run b AtCoder/abc480/g.cpp");
    console.error("例: bun run b codeforces 1900 a");
    process.exit(1);
  }

  let targetFilePath = "";

  if (rawArgs.length >= 3 && ["atcoder", "codeforces", "cf", "ac"].includes(rawArgs[0].toLowerCase())) {
    const plat = rawArgs[0].toLowerCase() === "codeforces" || rawArgs[0].toLowerCase() === "cf" ? "Codeforces" : "AtCoder";
    const contest = rawArgs[1].toLowerCase().replace(new RegExp(`^(${plat}|contests)[\\\\/]+`, "i"), "");
    const prob = rawArgs[2].toLowerCase().replace(/\.cpp$/, "");
    targetFilePath = path.join(projectRoot, plat, contest, `${prob}.cpp`);
  } else if (rawArgs.length >= 2 && !rawArgs[0].includes("/") && !rawArgs[0].includes("\\")) {
    const contest = rawArgs[0].toLowerCase();
    const prob = rawArgs[1].toLowerCase().replace(/\.cpp$/, "");
    if (fs.existsSync(path.join(projectRoot, "Codeforces", contest, `${prob}.cpp`))) {
      targetFilePath = path.join(projectRoot, "Codeforces", contest, `${prob}.cpp`);
    } else {
      targetFilePath = path.join(projectRoot, "AtCoder", contest, `${prob}.cpp`);
    }
  } else {
    targetFilePath = path.isAbsolute(rawArgs[0])
      ? rawArgs[0]
      : path.resolve(projectRoot, rawArgs[0]);
  }

  if (!fs.existsSync(targetFilePath)) {
    console.error(`エラー: ファイルが見つかりません: ${targetFilePath}`);
    process.exit(1);
  }

  const bundledCode = bundle(targetFilePath);

  let copiedToClipboard = false;
  try {
    const clipCmd = process.platform === "win32" ? "clip" : "clip.exe";
    execSync(clipCmd, { input: bundledCode, stdio: ["pipe", "ignore", "ignore"] });
    copiedToClipboard = true;
  } catch {}

  console.log("==================================================");
  console.log(`対象: ${path.relative(projectRoot, targetFilePath)}`);
  if (copiedToClipboard) {
    console.log("✅ クリップボードにコピーしました！ (AtCoder/Codeforces提出欄にそのまま Ctrl+V 可能)");
  } else {
    console.log("⚠️ クリップボードへの自動コピーはスキップされました。");
  }
  console.log("==================================================");
}
