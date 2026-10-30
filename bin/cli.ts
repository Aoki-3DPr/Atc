#!/usr/bin/env bun

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchContest, getDefaultProblems, getAtCoderTaskList } from "./fetch.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

// 引数の取得
const rawArgs = process.argv.slice(2);

if (rawArgs.length === 0) {
  console.error("エラー: コンテスト名またはフォルダ名を指定してください。");
  console.error("使い方: bun run atcoder <コンテスト名/フォルダ名> [取得元コンテストID]");
  console.error("短縮形: bun run c <コンテスト名>          (例: bun run c arc170 / bun run c abc482)");
  console.error("使い回し作成: bun run arc / bun run agc / bun run ahc / bun run abc");
  console.error("使い回し取得: bun run arc arc170          (arc フォルダに ARC170 のテストケースを上書き取得)");
  console.error("他サイト: bun run codeforces <コンテストID> (例: bun run codeforces 1900)");
  process.exit(1);
}

// プラットフォームの判定 (atcoder / codeforces)
let platform = "AtCoder";
let folderArg = "";
let sourceContestArg = "";

const cleanArgs = [...rawArgs];
const firstLower = cleanArgs[0].toLowerCase();
if (["atcoder", "ac"].includes(firstLower)) {
  platform = "AtCoder";
  cleanArgs.shift();
} else if (["codeforces", "cf"].includes(firstLower)) {
  platform = "Codeforces";
  cleanArgs.shift();
}

folderArg = cleanArgs[0] || "";
sourceContestArg = cleanArgs[1] || "";

if (!folderArg.trim()) {
  console.error("エラー: コンテストのフォルダ名を指定してください。");
  console.error(`例: bun run ${platform.toLowerCase()} arc170`);
  process.exit(1);
}

// 先頭の余分なパスを除去
const folderName = folderArg.trim().replace(new RegExp(`^(${platform}|contests)[\\\\/]+`, "i"), "");
const contestDir = path.join(projectRoot, platform, folderName);

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

// フォルダの作成 (例: AtCoder/arc170, AtCoder/arc, AtCoder/agc, Codeforces/1900)
fs.mkdirSync(contestDir, { recursive: true });

// 取得元コンテストと使い回し判定
const fetchSource = sourceContestArg.trim() || folderName;
const isPureGenericFolder = /^(abc|arc|agc|ahc|cf|codeforces)$/i.test(folderName) && !sourceContestArg.trim();

// 作成する問題一覧の決定（ABC: a〜g, ARC/AGC: a〜f, AHC: a 等）
let problems = getDefaultProblems(folderName, platform);

// もし個別のコンテスト（例: arc170, abc350 等）の場合はタスク一覧から問題一覧を確定試行
if (platform === "AtCoder" && !isPureGenericFolder) {
  try {
    const taskList = await getAtCoderTaskList(fetchSource);
    if (taskList && taskList.length > 0) {
      problems = taskList.map((t) => t.label);
    }
  } catch {}
}

const created: string[] = [];
const skipped: string[] = [];

for (const p of problems) {
  const fileName = `${p}.cpp`;
  const filePath = path.join(contestDir, fileName);

  // 既にファイルが存在する場合は使い回し・コード保護のためスキップ
  if (fs.existsSync(filePath)) {
    skipped.push(fileName);
    continue;
  }

  fs.writeFileSync(filePath, templateContent, "utf8");
  created.push(fileName);
}

console.log(`==================================================`);
console.log(`プラットフォーム: ${platform}`);
console.log(`フォルダ: ${platform}/${folderName}`);
if (created.length > 0) {
  console.log(`作成完了: ${created.join(", ")}`);
}
if (skipped.length > 0) {
  console.log(`スキップ (既存ファイルを維持): ${skipped.join(", ")}`);
}
console.log(`==================================================\n`);

// CLion に CMake の自動再ロードを検知させるため、CMakeLists.txt の末尾コメントを更新
const cmakeListsPath = path.join(projectRoot, "CMakeLists.txt");
if (fs.existsSync(cmakeListsPath)) {
  const cmakeContent = fs.readFileSync(cmakeListsPath, "utf8");
  const stampLine = `# Auto-reload trigger: ${platform}_${folderName} (${new Date().toISOString()})`;
  const updatedContent =
    cmakeContent.replace(/\r?\n# Auto-reload trigger:.*$/s, "").trimEnd() +
    `\n\n${stampLine}\n`;
  fs.writeFileSync(cmakeListsPath, updatedContent, "utf8");
}

// テストケースの自動取得
if (!isPureGenericFolder) {
  try {
    await fetchContest(fetchSource, platform.toLowerCase(), problems, folderName);
  } catch (err: any) {
    console.log(`(テストケースの取得をスキップしました: ${err.message})`);
  }
} else {
  console.log(`💡 使い回しフォルダ '${folderName}' の準備が完了しました。`);
  console.log(`   コンテストのテストケースを取得するには:`);
  console.log(`   bun run fetch <コンテスト名> ${folderName}   (例: bun run fetch ${folderName}170 ${folderName})`);
  console.log(`   または bun run ${folderName} <コンテスト名>  (例: bun run ${folderName} ${folderName}170)\n`);
}
