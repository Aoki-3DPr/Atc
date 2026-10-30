#!/usr/bin/env bun

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchContest } from "./fetch.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

// 引数の取得（process.argv[2] 以降がコマンドライン引数）
const args = process.argv.slice(2);

if (args.length === 0 || !args[0].trim()) {
  console.error("エラー: コンテストのフォルダ名を指定してください。");
  console.error("使い方: contests <フォルダ名>  (例: contests abc482)");
  process.exit(1);
}

// 先頭に "contests/" が付いていても二重にならないように整形
const folderName = args[0].trim().replace(/^contests[\\/]+/, "");
const contestDir = path.join(projectRoot, "contests", folderName);

// テンプレートの読み込み（template.cpp があればそれを使用）
const templatePath = path.join(projectRoot, "template.cpp");
const defaultTemplate = `#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

int main() {

    return 0;
}
`;

const templateContent = fs.existsSync(templatePath)
  ? fs.readFileSync(templatePath, "utf8")
  : defaultTemplate;

// フォルダの作成
fs.mkdirSync(contestDir, { recursive: true });

// a.cpp ~ g.cpp を作成
const problems = ["a", "b", "c", "d", "e", "f", "g"];
const created: string[] = [];
const skipped: string[] = [];

for (const p of problems) {
  const fileName = `${p}.cpp`;
  const filePath = path.join(contestDir, fileName);

  // 既にファイルが存在する場合は上書き防止のためスキップ
  if (fs.existsSync(filePath)) {
    skipped.push(fileName);
    continue;
  }

  fs.writeFileSync(filePath, templateContent, "utf8");
  created.push(fileName);
}

console.log(`フォルダ: contests/${folderName}`);
if (created.length > 0) {
  console.log(`作成完了: ${created.join(", ")}`);
}
if (skipped.length > 0) {
  console.log(`スキップ (既存): ${skipped.join(", ")}`);
}

// CLion に CMake の自動再ロードを検知させるため、CMakeLists.txt の末尾コメントを更新
const cmakeListsPath = path.join(projectRoot, "CMakeLists.txt");
if (fs.existsSync(cmakeListsPath)) {
  const cmakeContent = fs.readFileSync(cmakeListsPath, "utf8");
  const stampLine = `# Auto-reload trigger: ${folderName} (${new Date().toISOString()})`;
  const updatedContent =
    cmakeContent.replace(/\r?\n# Auto-reload trigger:.*$/s, "").trimEnd() +
    `\n\n${stampLine}\n`;
  fs.writeFileSync(cmakeListsPath, updatedContent, "utf8");
  console.log("CMakeLists.txt を更新しました。");
}

// テストケース（サンプル入出力）の自動取得
console.log();
try {
  await fetchContest(folderName);
} catch (err: any) {
  console.log(`(テストケースの取得をスキップしました: ${err.message})`);
}
