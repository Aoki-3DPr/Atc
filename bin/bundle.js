#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

// 引数の取得
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("エラー: 対象のファイルを指定してください。");
  console.error("使い方: npm run bundle <ファイルパス または コンテスト名 問題名>");
  console.error("例: npm run bundle contests/abc481/a.cpp");
  console.error("例: npm run bundle abc481 a");
  process.exit(1);
}

// ファイルパスの解決
let targetFilePath = "";
if (args.length >= 2 && !args[0].includes("/") && !args[0].includes("\\")) {
  targetFilePath = path.join(projectRoot, "contests", args[0], `${args[1]}.cpp`);
} else {
  targetFilePath = path.isAbsolute(args[0])
    ? args[0]
    : path.resolve(projectRoot, args[0]);
}

if (!fs.existsSync(targetFilePath)) {
  console.error(`エラー: ファイルが見つかりません: ${targetFilePath}`);
  process.exit(1);
}

/**
 * ライブラリファイルからクラス等の本体だけを抽出する関数
 */
function extractLibraryBody(rawContent) {
  let content = rawContent;

  // 1. // BEGIN 〜 // END マーカーがある場合はその間だけを最優先で抽出
  const markerMatch = content.match(/\/\/\s*BEGIN[\s\S]*?\/\/\s*END/i);
  if (markerMatch) {
    return markerMatch[0]
      .replace(/\/\/\s*BEGIN/i, "")
      .replace(/\/\/\s*END/i, "")
      .trim();
  }

  // 2. 単体実行用ブロック (#ifdef BUILDING_LIB_STANDALONE 〜 #endif) を丸ごと除去
  content = content.replace(/#ifdef\s+BUILDING_LIB_STANDALONE[\s\S]*?#endif/g, "");

  // 3. 行単位で不要なヘッダ行・重複定義行をフィルタリング
  const lines = content.split(/\r?\n/);
  const cleanedLines = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // 除外する行:
    if (/^#pragma\s+once/.test(trimmed)) continue;
    if (/^#include\s*<.*?>/.test(trimmed)) continue;
    if (/^#include\s*".*?"/.test(trimmed)) continue;
    if (/^#define\s+ll\b/i.test(trimmed)) continue;
    if (/^using\s+ll\s*=/i.test(trimmed)) continue;
    if (/^using\s+namespace\s+std\s*;/.test(trimmed)) continue;
    if (/^(?:int|ll|long\s+long)\s+d[ij]\[\d+\]/.test(trimmed)) continue;

    cleanedLines.push(line);
  }

  return cleanedLines.join("\n").trim();
}

/**
 * ソースコードを解析して、ヘッダ、ライブラリ、ユーザーコードを綺麗に統合
 */
function bundle(sourceFilePath) {
  const sourceContent = fs.readFileSync(sourceFilePath, "utf8");
  const lines = sourceContent.split(/\r?\n/);

  const libraries = [];
  const visitedLibs = new Set();
  const userCodeLines = [];

  for (const line of lines) {
    const match = line.match(/^#include\s*["<]([^">]+)[">]/);
    if (!match) {
      userCodeLines.push(line);
      continue;
    }

    const headerName = match[1];

    // .cpp または .hpp 以外の標準インクルード行はそのまま
    if (!headerName.endsWith(".cpp") && !headerName.endsWith(".hpp") && !headerName.endsWith(".h")) {
      userCodeLines.push(line);
      continue;
    }

    // ライブラリファイルの探索
    const searchCandidates = [
      path.join(projectRoot, "lib", headerName),
      path.join(projectRoot, "lib", path.basename(headerName)),
      path.resolve(path.dirname(sourceFilePath), headerName),
    ];

    let foundLibPath = null;
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

  // ユーザーコードの中から、先頭の includes, #define ll, using namespace std を抽出
  const headerSection = [];
  const restSection = [];
  let headerFinished = false;

  for (const line of userCodeLines) {
    const trimmed = line.trim();
    if (!headerFinished) {
      if (
        /^#include/.test(trimmed) ||
        /^#define\s+ll\b/i.test(trimmed) ||
        /^using\s+ll\s*=/i.test(trimmed) ||
        /^using\s+namespace\s+std\s*;/.test(trimmed) ||
        trimmed === ""
      ) {
        if (trimmed !== "") headerSection.push(line);
        continue;
      } else {
        headerFinished = true;
      }
    }
    restSection.push(line);
  }

  // 組み立て順序:
  // 1. 基本ヘッダ・型定義 (#include <bits/stdc++.h>, #define ll, using namespace std)
  // 2. 抽出したライブラリクラス (ll や std:: が使える状態)
  // 3. ユーザーの解答コード (int di, main など)
  const outputParts = [];

  // 基本ヘッダ部分（重複を除去しつつ整理）
  const uniqueHeaders = Array.from(new Set(headerSection));
  outputParts.push(uniqueHeaders.join("\n"));

  // ライブラリ部分
  if (libraries.length > 0) {
    outputParts.push("\n// ========================================");
    outputParts.push("//          Libraries (Auto-Bundled)       ");
    outputParts.push("// ========================================");
    for (const lib of libraries) {
      outputParts.push(`\n// --- [${lib.name}] ---`);
      outputParts.push(lib.body);
    }
    outputParts.push("\n// ========================================");
    outputParts.push("//          User Solution Code             ");
    outputParts.push("// ========================================\n");
  }

  // ユーザー解答部分
  outputParts.push(restSection.join("\n"));

  return outputParts.join("\n");
}

// 実行
const bundledCode = bundle(targetFilePath);

// クリップボードにコピー (Windows clip.exe)
let copiedToClipboard = false;
try {
  execSync("clip", { input: bundledCode, stdio: ["pipe", "ignore", "ignore"] });
  copiedToClipboard = true;
} catch {
  // clip が使えない環境でもエラーにしない
}

console.log("==================================================");
console.log(`対象: ${path.relative(projectRoot, targetFilePath)}`);
if (copiedToClipboard) {
  console.log("✅ クリップボードにコピーしました！ (AtCoder提出欄にそのまま Ctrl+V 可能)");
} else {
  console.log("⚠️ クリップボードへの自動コピーはスキップされました。");
}
console.log("==================================================");
