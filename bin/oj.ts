#!/usr/bin/env bun

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  fetchContest,
  fetchProblem,
  getDefaultProblems,
  getAtCoderTaskList,
} from "./fetch.ts";
import { bundle } from "./bundle.ts";
import { runSetup } from "./setup.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 現在のカレントディレクトリ (process.cwd()) が競プロプロジェクト内かを検証し、
 * 動的にプロジェクトルートを特定する（プロジェクト外のフォルダでの実行を防止）
 */
function resolveWorkspaceRoot(): string {
  let curr = process.cwd();
  while (true) {
    if (fs.existsSync(path.join(curr, "bin", "oj.ts"))) {
      return curr;
    }
    const parent = path.dirname(curr);
    if (!parent || parent === curr) break;
    curr = parent;
  }
  console.error(`\x1b[31m✗ エラー: 'oj' コマンドはこのプロジェクトのディレクトリ内でのみ実行可能です。\x1b[0m`);
  console.error(`  現在の場所: ${process.cwd()}`);
  process.exit(1);
}

const projectRoot = resolveWorkspaceRoot();
const stateFilePath = path.join(projectRoot, ".oj_state.json");

// ANSI カラー定義
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
};

export interface OjState {
  platform: "AtCoder" | "Codeforces";
  folder: string;
  contest: string;
  lastProblem?: string;
  updatedAt: string;
}

/**
 * プロジェクト内で一番最近更新された .cpp ファイルから初期状態を推測
 */
function inferInitialState(): OjState {
  let latestMtime = 0;
  let bestState: OjState = {
    platform: "AtCoder",
    folder: "abc",
    contest: "abc",
    lastProblem: "a",
    updatedAt: new Date().toISOString(),
  };

  for (const plat of ["AtCoder", "Codeforces"] as const) {
    const platDir = path.join(projectRoot, plat);
    if (!fs.existsSync(platDir)) continue;

    for (const dirEntry of fs.readdirSync(platDir, { withFileTypes: true })) {
      if (!dirEntry.isDirectory()) continue;
      const folder = dirEntry.name;
      const folderPath = path.join(platDir, folder);

      for (const fileEntry of fs.readdirSync(folderPath, { withFileTypes: true })) {
        if (!fileEntry.isFile() || !fileEntry.name.endsWith(".cpp")) continue;
        if (fileEntry.name.endsWith("_bundled.cpp")) continue;

        const fullPath = path.join(folderPath, fileEntry.name);
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs > latestMtime) {
          latestMtime = stat.mtimeMs;
          const prob = fileEntry.name.replace(/\.cpp$/i, "").toLowerCase();
          // info.json があればそこから元の contest 名を取得
          let contestName = folder;
          const infoPath = path.join(folderPath, "test", prob, "info.json");
          if (fs.existsSync(infoPath)) {
            try {
              const info = JSON.parse(fs.readFileSync(infoPath, "utf8"));
              if (info.contest) contestName = info.contest;
            } catch {}
          }
          bestState = {
            platform: plat,
            folder,
            contest: contestName,
            lastProblem: prob,
            updatedAt: new Date().toISOString(),
          };
        }
      }
    }
  }
  return bestState;
}

export function loadState(): OjState {
  if (fs.existsSync(stateFilePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(stateFilePath, "utf8"));
      if (data && data.platform && data.folder) {
        return data as OjState;
      }
    } catch {}
  }
  const initial = inferInitialState();
  saveState(initial);
  return initial;
}

export function saveState(state: OjState): void {
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(stateFilePath, JSON.stringify(state, null, 2), "utf8");
}

/**
 * カレントフォルダ内で一番最近保存された問題名 (a, b, c...) を自動検出
 */
function detectLatestProblemInFolder(platform: string, folder: string, fallback?: string): string {
  const folderPath = path.join(projectRoot, platform, folder);
  if (!fs.existsSync(folderPath)) return fallback || "a";

  let latestProb = fallback || "a";
  let latestMtime = 0;

  for (const f of fs.readdirSync(folderPath)) {
    if (!f.endsWith(".cpp") || f.endsWith("_bundled.cpp")) continue;
    const full = path.join(folderPath, f);
    try {
      const st = fs.statSync(full);
      if (st.mtimeMs > latestMtime) {
        latestMtime = st.mtimeMs;
        latestProb = f.replace(/\.cpp$/i, "").toLowerCase();
      }
    } catch {}
  }
  return latestProb;
}

/**
 * コンテストIDから使い回しフォルダ名を自動判別
 */
function resolveDefaultFolder(platform: "AtCoder" | "Codeforces", contestId: string, createNew: boolean): string {
  if (createNew) return contestId.toLowerCase();
  const lower = contestId.toLowerCase();

  // 1. すでに個別フォルダ (例: AtCoder/abc481) が存在する場合は、その個別フォルダを最優先で使用
  const specificDir = path.join(projectRoot, platform, lower);
  if (fs.existsSync(specificDir)) {
    return lower;
  }

  if (platform === "Codeforces") {
    return "cf";
  }

  if (/^abc\d+/i.test(lower)) return "abc";
  if (/^arc\d+/i.test(lower)) return "arc";
  if (/^agc\d+/i.test(lower)) return "agc";
  if (/^ahc\d+/i.test(lower)) return "ahc";
  if (/^(adt|daily)/i.test(lower)) return "adt";

  return lower;
}

/**
 * コンテストIDからプラットフォームを自動判別
 */
function inferPlatformFromContest(contestId: string): "AtCoder" | "Codeforces" {
  const lower = contestId.toLowerCase();
  if (/^\d+$/.test(lower) || /^cf\d*$/i.test(lower)) {
    return "Codeforces";
  }
  return "AtCoder";
}

/**
 * テンプレートから .cpp ファイル群を用意
 */
function ensureCppFiles(platform: "AtCoder" | "Codeforces", folder: string, problems: string[]): { created: string[]; skipped: string[] } {
  const contestDir = path.join(projectRoot, platform, folder);
  fs.mkdirSync(contestDir, { recursive: true });

  const templatePath = path.join(projectRoot, "template.cpp");
  const defaultTemplate = `#include <bits/stdc++.h>
#define ll long long
using namespace std;

ll solve() {
    return 0;
}

int main() {
    solve();
    return 0;
}
`;
  const templateContent = fs.existsSync(templatePath)
    ? fs.readFileSync(templatePath, "utf8")
    : defaultTemplate;

  const created: string[] = [];
  const skipped: string[] = [];

  for (const p of problems) {
    const fileName = `${p.toLowerCase()}.cpp`;
    const filePath = path.join(contestDir, fileName);
    if (fs.existsSync(filePath)) {
      skipped.push(fileName);
    } else {
      fs.writeFileSync(filePath, templateContent, "utf8");
      created.push(fileName);
    }
  }

  // 新規ファイルが作られた場合のみ CMakeLists.txt にトリガーを追記
  if (created.length > 0) {
    const cmakeListsPath = path.join(projectRoot, "CMakeLists.txt");
    if (fs.existsSync(cmakeListsPath)) {
      const cmakeContent = fs.readFileSync(cmakeListsPath, "utf8");
      const stampLine = `# Auto-reload trigger: ${platform}_${folder} (${new Date().toISOString()})`;
      const updatedContent =
        cmakeContent.replace(/\r?\n# Auto-reload trigger:.*$/s, "").trimEnd() +
        `\n\n${stampLine}\n`;
      fs.writeFileSync(cmakeListsPath, updatedContent, "utf8");
    }
  }

  return { created, skipped };
}

/**
 * サイト階層: コンテストのセット＆テストケース取得
 */
async function handleSetupContest(
  platform: "AtCoder" | "Codeforces",
  args: string[],
  forceNew = false
): Promise<void> {
  const cleanArgs = args.filter((a) => a !== "--new" && a !== "-n");
  const isNew = forceNew || args.includes("--new") || args.includes("-n");

  if (cleanArgs.length === 0) {
    console.error(`${c.red}エラー: コンテストID または フォルダ名を指定してください。${c.reset}`);
    console.error(`  例: ${c.cyan}oj ac abc350${c.reset}       (使い回しフォルダ AtCoder/abc に abc350 をセット)`);
    console.error(`  例: ${c.cyan}oj ac abc350 --new${c.reset} (個別フォルダ AtCoder/abc350 を新規作成してセット)`);
    console.error(`  例: ${c.cyan}oj cf 1900${c.reset}         (Codeforces 1900 をセット)`);
    return;
  }

  let contestId = cleanArgs[0].replace(/^(AtCoder|Codeforces|contests)[\\/]+/i, "");
  let targetFolder = cleanArgs[1]
    ? cleanArgs[1].replace(/^(AtCoder|Codeforces|contests)[\\/]+/i, "")
    : resolveDefaultFolder(platform, contestId, isNew);

  // もし "oj ac abc abc350" のように第1引数が純粋な使い回しフォルダ名で第2引数がコンテストIDの場合も自然に対応
  const isFirstPureGeneric = /^(abc|arc|agc|ahc|adt|daily|cf)$/i.test(contestId);
  if (isFirstPureGeneric && cleanArgs[1]) {
    targetFolder = contestId.toLowerCase() === "daily" ? "adt" : contestId.toLowerCase();
    contestId = cleanArgs[1];
  } else if (isFirstPureGeneric && !cleanArgs[1]) {
    targetFolder = contestId.toLowerCase() === "daily" ? "adt" : contestId.toLowerCase();
  }

  const isGenericOnly = /^(abc|arc|agc|ahc|adt|daily|cf)$/i.test(contestId);

  let problems = getDefaultProblems(contestId, platform);
  if (platform === "AtCoder" && !isGenericOnly) {
    try {
      const taskList = await getAtCoderTaskList(contestId);
      if (taskList && taskList.length > 0) {
        problems = taskList.map((t) => t.label);
      }
    } catch {}
  }

  const { created } = ensureCppFiles(platform, targetFolder, problems);

  const state: OjState = {
    platform,
    folder: targetFolder,
    contest: contestId,
    lastProblem: "a",
    updatedAt: new Date().toISOString(),
  };
  saveState(state);

  console.log(`${c.bold}${c.cyan}==================================================${c.reset}`);
  console.log(`🎯 ターゲット設定: ${c.bold}${c.green}[${platform}] ${targetFolder}${c.reset} ${!isGenericOnly ? `(Contest: ${c.yellow}${contestId}${c.reset})` : ""}`);
  if (created.length > 0) {
    console.log(`📄 新規ファイル作成: ${created.join(", ")}`);
  }
  console.log(`${c.bold}${c.cyan}==================================================${c.reset}`);

  if (!isGenericOnly) {
    await fetchContest(contestId, platform.toLowerCase(), problems, targetFolder);
  } else {
    console.log(`💡 フォルダ '${platform}/${targetFolder}' に切り替えました。`);
  }
}

/**
 * 既存フォルダ・コンテストへのターゲット切り替え (oj use <folder/contest>)
 * 既存フォルダが存在する場合は無駄な通信を行わず、即座に対象を切り替える
 */
async function handleUse(args: string[]): Promise<void> {
  if (args.length === 0) {
    handleStatus();
    return;
  }

  const rawTarget = args[0].replace(/^(AtCoder|Codeforces|contests)[\\/]+/i, "").toLowerCase();

  // 1. AtCoder または Codeforces 配下に直接一致するフォルダがあるか探索
  let matchedPlatform: "AtCoder" | "Codeforces" | null = null;
  let matchedFolder: string | null = null;

  for (const plat of ["AtCoder", "Codeforces"] as const) {
    const dir = path.join(projectRoot, plat, rawTarget);
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      matchedPlatform = plat;
      matchedFolder = rawTarget;
      break;
    }
  }

  // 2. プラットフォーム明示指定の場合 (例: oj use ac abc481)
  if (!matchedFolder && args.length >= 2) {
    const p = ["codeforces", "cf"].includes(args[0].toLowerCase()) ? "Codeforces" : "AtCoder";
    const f = args[1].replace(/^(AtCoder|Codeforces|contests)[\\/]+/i, "").toLowerCase();
    const dir = path.join(projectRoot, p, f);
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      matchedPlatform = p;
      matchedFolder = f;
    }
  }

  // 3. フォルダが見つかった場合 -> ターゲットを即座にローカル切り替え (フェッチなし)
  if (matchedPlatform && matchedFolder) {
    const folderPath = path.join(projectRoot, matchedPlatform, matchedFolder);
    let contestName = matchedFolder;

    // test/*/info.json から元の contest 名を復元試行
    const testDir = path.join(folderPath, "test");
    if (fs.existsSync(testDir)) {
      for (const sub of fs.readdirSync(testDir)) {
        const infoPath = path.join(testDir, sub, "info.json");
        if (fs.existsSync(infoPath)) {
          try {
            const info = JSON.parse(fs.readFileSync(infoPath, "utf8"));
            if (info.contest) {
              contestName = info.contest;
              break;
            }
          } catch {}
        }
      }
    }

    const latestProb = detectLatestProblemInFolder(matchedPlatform, matchedFolder, "a");
    const state: OjState = {
      platform: matchedPlatform,
      folder: matchedFolder,
      contest: contestName,
      lastProblem: latestProb,
      updatedAt: new Date().toISOString(),
    };
    saveState(state);

    const label = state.folder === state.contest ? state.folder : `${state.contest} (${state.folder})`;
    console.log(`${c.green}✓ 作業ターゲットを切り替えました:${c.reset} ${c.bold}[${state.platform}] ${label}${c.reset}`);
    return;
  }

  // 4. フォルダが存在しない場合 -> handleSetupContest で新規作成＆取得へフォールバック
  console.log(`${c.yellow}💡 フォルダ '${rawTarget}' がまだ無いため、新規セットアップを行います...${c.reset}`);
  const plat = inferPlatformFromContest(rawTarget);
  await handleSetupContest(plat, args, false);
}

/**
 * テスト実行 (oj t [prob])
 */
function handleTest(args: string[]): void {
  const state = loadState();
  let platform = state.platform;
  let folder = state.folder;
  let prob = "";

  if (args.length === 0) {
    prob = detectLatestProblemInFolder(platform, folder, state.lastProblem);
    console.log(`${c.cyan}🎯 自動選択:${c.reset} ${c.bold}${platform}/${folder}/${prob}.cpp${c.reset} ${c.gray}(直近保存ファイル)${c.reset}`);
  } else if (args.length === 1) {
    const arg = args[0];
    if (arg.includes("/") || arg.includes("\\") || arg.endsWith(".cpp")) {
      // パス直接指定
      spawnSync("bun", [path.join(__dirname, "test.ts"), arg], { stdio: "inherit", cwd: projectRoot });
      return;
    }
    prob = arg.toLowerCase();
  } else if (args.length >= 2) {
    if (["atcoder", "ac", "codeforces", "cf"].includes(args[0].toLowerCase())) {
      platform = ["codeforces", "cf"].includes(args[0].toLowerCase()) ? "Codeforces" : "AtCoder";
      folder = args[1].toLowerCase();
      prob = (args[2] || detectLatestProblemInFolder(platform, folder)).toLowerCase();
    } else {
      folder = args[0].toLowerCase();
      prob = args[1].toLowerCase();
      if (fs.existsSync(path.join(projectRoot, "Codeforces", folder))) {
        platform = "Codeforces";
      } else {
        platform = "AtCoder";
      }
    }
  }

  state.lastProblem = prob;
  saveState(state);

  spawnSync("bun", [path.join(__dirname, "test.ts"), platform.toLowerCase(), folder, prob], {
    stdio: "inherit",
    cwd: projectRoot,
  });
}

/**
 * バンドル＆クリップボードコピー (oj b [prob])
 */
function handleBundle(args: string[]): void {
  const state = loadState();
  let platform = state.platform;
  let folder = state.folder;
  let prob = "";

  if (args.length === 0) {
    prob = detectLatestProblemInFolder(platform, folder, state.lastProblem);
    console.log(`${c.cyan}🎯 自動選択:${c.reset} ${c.bold}${platform}/${folder}/${prob}.cpp${c.reset} ${c.gray}(直近保存ファイル)${c.reset}`);
  } else if (args.length === 1) {
    const arg = args[0];
    if (arg.includes("/") || arg.includes("\\") || arg.endsWith(".cpp")) {
      spawnSync("bun", [path.join(__dirname, "bundle.ts"), arg], { stdio: "inherit", cwd: projectRoot });
      return;
    }
    prob = arg.toLowerCase();
  } else if (args.length >= 2) {
    folder = args[0].toLowerCase();
    prob = args[1].toLowerCase();
    if (fs.existsSync(path.join(projectRoot, "Codeforces", folder))) {
      platform = "Codeforces";
    } else {
      platform = "AtCoder";
    }
  }

  state.lastProblem = prob;
  saveState(state);

  spawnSync("bun", [path.join(__dirname, "bundle.ts"), platform.toLowerCase(), folder, prob], {
    stdio: "inherit",
    cwd: projectRoot,
  });
}

/**
 * テストケースの再取得 (oj f [prob / contest])
 */
async function handleFetch(args: string[]): Promise<void> {
  const state = loadState();

  if (args.length === 0) {
    await fetchContest(state.contest, state.platform.toLowerCase(), undefined, state.folder);
    return;
  }

  if (args.length === 1 && /^[a-zA-Z]$/.test(args[0])) {
    const prob = args[0].toLowerCase();
    const res = await fetchProblem(state.contest, prob, state.platform.toLowerCase(), state.folder);
    if (res.success) {
      console.log(`✓ [${state.platform}] ${state.contest} [${prob.toUpperCase()}]: ${res.count} ケース取得完了 (${res.timeLimitMs}ms)`);
    } else {
      console.error(`✗ エラー: ${res.error}`);
    }
    return;
  }

  // コンテスト名指定の場合
  spawnSync("bun", [path.join(__dirname, "fetch.ts"), ...args], {
    stdio: "inherit",
    cwd: projectRoot,
  });
}

/**
 * 現在の状態・ケース一覧の表示 (oj status / oj st)
 */
function handleStatus(): void {
  const state = loadState();
  const folderPath = path.join(projectRoot, state.platform, state.folder);
  const latestProb = detectLatestProblemInFolder(state.platform, state.folder, state.lastProblem);

  console.log(`\n${c.bold}${c.cyan}==================================================${c.reset}`);
  console.log(`  ${c.bold}⚡ OJ Current Workspace Status${c.reset}`);
  console.log(`${c.bold}${c.cyan}==================================================${c.reset}`);
  console.log(`  Platform     : ${c.bold}${c.green}${state.platform}${c.reset}`);
  console.log(`  Work Folder  : ${c.bold}${state.platform}/${state.folder}${c.reset}`);
  console.log(`  Contest ID   : ${c.bold}${c.yellow}${state.contest}${c.reset}`);
  console.log(`  Latest File  : ${c.bold}${c.cyan}${latestProb}.cpp${c.reset} ${c.gray}(oj t / oj b の省略時対象)${c.reset}`);
  console.log(`--------------------------------------------------`);

  if (fs.existsSync(folderPath)) {
    const cppFiles = fs
      .readdirSync(folderPath)
      .filter((f) => f.endsWith(".cpp") && !f.endsWith("_bundled.cpp"))
      .sort();

    for (const f of cppFiles) {
      const prob = f.replace(/\.cpp$/i, "").toLowerCase();
      const testDir = path.join(folderPath, "test", prob);
      let caseCount = 0;
      let contestTag = "";
      if (fs.existsSync(testDir)) {
        caseCount = fs.readdirSync(testDir).filter((x) => /^in\d+\.txt$/.test(x)).length;
        const infoPath = path.join(testDir, "info.json");
        if (fs.existsSync(infoPath)) {
          try {
            const info = JSON.parse(fs.readFileSync(infoPath, "utf8"));
            if (info.contest) contestTag = ` (${info.contest})`;
          } catch {}
        }
      }
      const marker = prob === latestProb ? `${c.cyan}▶${c.reset}` : " ";
      const statusStr =
        caseCount > 0
          ? `${c.green}${caseCount} cases${c.reset}${c.gray}${contestTag}${c.reset}`
          : `${c.gray}no cases${c.reset}`;
      console.log(`  ${marker} ${c.bold}${prob.toUpperCase()}${c.reset} (${f}) : ${statusStr}`);
    }
  }
  console.log(`${c.bold}${c.cyan}==================================================${c.reset}\n`);
}

/**
 * ヘルプ表示 (oj help / oj h)
 */
function showHelp(): void {
  const state = loadState();
  console.log(`
${c.bold}${c.cyan}======================================================================${c.reset}
  ${c.bold}${c.green}oj - Online Judge CLI${c.reset}  ${c.gray}[Current: ${state.platform}/${state.folder} (${state.contest})]${c.reset}
${c.bold}${c.cyan}======================================================================${c.reset}

${c.bold}${c.yellow}■ 1. サイト階層（コンテストのセット ＆ テストケース取得）${c.reset}
  ${c.cyan}oj ac <contest>${c.reset}        AtCoder をセット (自動で abc/arc/agc/ahc/adt に振り分け)
      ${c.gray}例: oj ac abc350     → AtCoder/abc に abc350 のケースを上書きセット${c.reset}
      ${c.gray}例: oj ac arc170     → AtCoder/arc に arc170 のケースを上書きセット${c.reset}
      ${c.gray}例: oj ac adt_...    → AtCoder/adt にデイリーケースを上書きセット${c.reset}
  ${c.cyan}oj cf <contest>${c.reset}        Codeforces をセット
      ${c.gray}例: oj cf 1900       → Codeforces/cf に 1900 のケースをセット${c.reset}
  ${c.cyan}oj new <contest>${c.reset}       使い回しではなく個別フォルダ (例: AtCoder/abc350) を新規作成
  ${c.cyan}oj use <contest>${c.reset}       コンテストIDからサイトを自動判別してセット

${c.bold}${c.yellow}■ 2. 共通アクション階層（どのサイトでも同じコマンド！）${c.reset}
  ${c.cyan}oj t [problem]${c.reset}         テスト実行 (省略時は${c.bold}直前に保存した .cpp${c.reset} を自動判定！)
      ${c.gray}例: oj t a           → カレントフォルダの a.cpp をテスト${c.reset}
      ${c.gray}例: oj t             → 直前に編集・保存した問題を自動テスト${c.reset}
  ${c.cyan}oj b [problem]${c.reset}         提出用バンドル＆クリップボードにコピー
      ${c.gray}例: oj b a           → カレントフォルダの a.cpp をバンドル＆コピー${c.reset}
      ${c.gray}例: oj b             → 直前に編集・保存した問題を自動バンドル＆コピー${c.reset}
  ${c.cyan}oj f [problem]${c.reset}         カレントコンテストのテストケースを再取得
  ${c.cyan}oj st${c.reset} (${c.cyan}oj status${c.reset})      現在のターゲット・各問題のケース状況を表示

${c.bold}${c.yellow}■ 3. 環境・認証・専用シェル階層${c.reset}
  ${c.cyan}oj sh${c.reset} (${c.cyan}oj${c.reset} 引数なし)    専用コマンドシェル (${c.green}oj >${c.reset}) を起動 (先頭の oj すら省略可能)
  ${c.cyan}oj setup${c.reset} (${c.cyan}bun setup${c.reset})   現在の環境・フォルダに合わせて自動パス認識を動的構築
  ${c.cyan}oj login [ac|cf]${c.reset}       AtCoder / Codeforces の Cookie 設定
  ${c.cyan}oj h${c.reset}  (${c.cyan}oj help${c.reset})        このヘルプを表示
${c.bold}${c.cyan}======================================================================${c.reset}
`);
}

/**
 * 単一コマンドディスパッチャ
 */
export async function executeOjCommand(args: string[]): Promise<boolean> {
  if (args.length === 0) return true;

  const sub = args[0].toLowerCase();
  const rest = args.slice(1);

  switch (sub) {
    // サイト階層
    case "ac":
    case "atcoder":
      await handleSetupContest("AtCoder", rest, false);
      break;

    case "cf":
    case "codeforces":
      await handleSetupContest("Codeforces", rest, false);
      break;

    case "use":
    case "init":
    case "set":
      await handleUse(rest);
      break;

    case "new":
    case "create": {
      if (rest.length === 0) {
        console.error(`${c.red}エラー: 作成するコンテストIDを指定してください (例: oj new abc350)${c.reset}`);
        break;
      }
      const first = rest[0].toLowerCase();
      if (["ac", "atcoder"].includes(first)) {
        await handleSetupContest("AtCoder", rest.slice(1), true);
      } else if (["cf", "codeforces"].includes(first)) {
        await handleSetupContest("Codeforces", rest.slice(1), true);
      } else {
        const plat = inferPlatformFromContest(rest[0]);
        await handleSetupContest(plat, rest, true);
      }
      break;
    }

    // 共通アクション階層
    case "t":
    case "test":
      handleTest(rest);
      break;

    case "b":
    case "bundle":
      handleBundle(rest);
      break;

    case "f":
    case "fetch":
      await handleFetch(rest);
      break;

    case "st":
    case "status":
      handleStatus();
      break;

    case "setup":
      runSetup(rest.includes("--clean") || rest.includes("--remove"));
      break;

    case "login":
      spawnSync("bun", [path.join(__dirname, "login.ts"), ...rest], {
        stdio: "inherit",
        cwd: projectRoot,
      });
      break;

    case "h":
    case "help":
    case "--help":
    case "-h":
      showHelp();
      break;

    case "clear":
    case "cls":
      console.clear();
      break;

    case "exit":
    case "quit":
    case "q":
      return false;

    default: {
      // もし "oj a" のように問題名1文字だけが打たれた場合はテストとして扱う便利フォールバック
      if (/^[a-h]$/i.test(sub) && rest.length === 0) {
        handleTest([sub]);
      } else {
        console.error(`${c.red}未知のサブコマンド: '${sub}'${c.reset} ('oj h' でコマンド一覧を表示)`);
      }
      break;
    }
  }
  return true;
}

/**
 * 専用コマンドシェル (REPL) モード
 */
async function startInteractiveShell(): Promise<void> {
  const commands = [
    "ac", "atcoder", "cf", "codeforces", "use", "new",
    "t", "test", "b", "bundle", "f", "fetch",
    "st", "status", "login", "help", "h", "clear", "exit", "q",
  ];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer: (line: string) => {
      const hits = commands.filter((cmd) => cmd.startsWith(line.trim()));
      return [hits.length ? hits : commands, line];
    },
  });

  const getPrompt = (): string => {
    const s = loadState();
    const label = s.folder === s.contest ? s.folder : `${s.contest} (${s.folder})`;
    return `${c.bold}${c.green}oj${c.reset} [${c.cyan}${s.platform}: ${label}${c.reset}] > `;
  };

  const s = loadState();
  console.log(`${c.bold}${c.cyan}================================================================${c.reset}`);
  console.log(` ⚡ ${c.bold}${c.green}OJ Interactive Command Shell${c.reset}`);
  console.log(` 📂 Target: ${c.bold}${s.platform}/${s.folder}${c.reset} (Contest: ${c.yellow}${s.contest}${c.reset})`);
  console.log(` 💡 Commands: ${c.cyan}ac <id>${c.reset}, ${c.cyan}cf <id>${c.reset}, ${c.cyan}t [prob]${c.reset}, ${c.cyan}b [prob]${c.reset}, ${c.cyan}st${c.reset}, ${c.cyan}h${c.reset}, ${c.cyan}exit${c.reset}`);
  console.log(`${c.bold}${c.cyan}================================================================${c.reset}`);

  const promptLoop = () => {
    rl.setPrompt(getPrompt());
    rl.prompt();
  };

  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      promptLoop();
      return;
    }

    // 先頭に誤って "oj " を付けて打った場合も許容
    const rawParts = trimmed.split(/\s+/);
    const parts = rawParts[0].toLowerCase() === "oj" ? rawParts.slice(1) : rawParts;

    rl.pause();
    try {
      const keepGoing = await executeOjCommand(parts);
      if (!keepGoing) {
        rl.close();
        return;
      }
    } catch (err: any) {
      console.error(`${c.red}エラー: ${err.message}${c.reset}`);
    }
    rl.resume();
    promptLoop();
  });

  rl.on("close", () => {
    console.log(`${c.gray}OJ シェルを終了しました。${c.reset}`);
    process.exit(0);
  });

  promptLoop();
}

// エントリーポイント
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const cliArgs = process.argv.slice(2);
  if (cliArgs.length === 0 || ["sh", "shell", "repl"].includes(cliArgs[0].toLowerCase())) {
    await startInteractiveShell();
  } else {
    await executeOjCommand(cliArgs);
  }
}
