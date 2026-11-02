#!/usr/bin/env bun

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

export interface FetchResult {
  success: boolean;
  count?: number;
  timeLimitMs?: number;
  testDir?: string;
  error?: string;
}

export type ContestFetchResults = Record<string, FetchResult>;

export interface AtCoderTaskInfo {
  label: string;
  taskId: string;
  url: string;
  title: string;
}

/**
 * コンテスト名やプレフィックスから標準的な問題リストを取得
 */
export function getDefaultProblems(name: string, platform = "atcoder"): string[] {
  const plat = platform.toLowerCase();
  if (plat === "codeforces" || plat === "cf") {
    return ["a", "b", "c", "d", "e", "f"];
  }
  const lower = name.toLowerCase();
  if (/^ahc/i.test(lower)) {
    return ["a"];
  }
  if (/^(adt|daily)/i.test(lower)) {
    // ADT (AtCoder Daily Training) は Easy/Med/Hard (5問) 〜 All (8〜10問)
    return ["a", "b", "c", "d", "e", "f", "g", "h"];
  }
  if (/^(arc|agc)/i.test(lower)) {
    return ["a", "b", "c", "d", "e", "f"];
  }
  // ABC や汎用コンテストは a〜g
  return ["a", "b", "c", "d", "e", "f", "g"];
}

/**
 * HTMLエンティティのデコード
 */
export function decodeHtml(html: string): string {
  return html
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&le;/g, "≤")
    .replace(/&ge;/g, "≥")
    .replace(/&times;/g, "×")
    .replace(/&plusmn;/g, "±")
    .replace(/&ne;/g, "≠")
    .replace(/&hellip;/g, "…")
    .replace(/\r\n/g, "\n");
}

/**
 * 既存テストディレクトリ内の古いテストケースを全消去（随時完全上書き用）
 */
export function cleanTestDir(testDir: string): void {
  if (fs.existsSync(testDir)) {
    for (const f of fs.readdirSync(testDir)) {
      if (/^(in|out)\d+\.txt$/.test(f) || f === "info.json") {
        try {
          fs.unlinkSync(path.join(testDir, f));
        } catch {}
      }
    }
  }
}

/**
 * 保存済みのAtCoderセッションCookieを取得
 */
export function getSessionCookie(): string | null {
  const sessionPath = path.join(projectRoot, ".atcoder_session");
  if (fs.existsSync(sessionPath)) {
    const content = fs.readFileSync(sessionPath, "utf8").trim();
    if (content) {
      return content.startsWith("REVEL_SESSION=") ? content : `REVEL_SESSION=${content}`;
    }
  }
  return null;
}

/**
 * 保存済みのCodeforcesセッションCookieを取得（Cloudflare通過用 cf_clearance 等）
 */
export function getCodeforcesSessionCookie(): string | null {
  const sessionPath = path.join(projectRoot, ".codeforces_session");
  if (fs.existsSync(sessionPath)) {
    const content = fs.readFileSync(sessionPath, "utf8").trim();
    if (content) {
      return content;
    }
  }
  return null;
}

/**
 * 指定ミリ秒待機するスリープ関数
 */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 429 (Too Many Requests) や一時的通信エラー時に自動リトライを行う fetch ラッパー
 */
export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  maxRetries = 2
): Promise<Response> {
  let attempt = 0;
  while (true) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429 && attempt < maxRetries) {
        attempt++;
        const retryAfter = res.headers.get("Retry-After");
        let waitMs = 2500 * Math.pow(2, attempt - 1); // 1回目: 2.5秒, 2回目: 5.0秒
        if (retryAfter) {
          const parsed = parseInt(retryAfter, 10);
          if (!isNaN(parsed) && parsed > 0) {
            waitMs = Math.max(waitMs, parsed * 1000);
          }
        }
        console.warn(
          `  [HTTP 429] レート制限を検知しました。${(waitMs / 1000).toFixed(1)}秒待機して再試行します... (試行 ${attempt}/${maxRetries})`
        );
        await sleep(waitMs);
        continue;
      }
      return res;
    } catch (err: any) {
      if (attempt < maxRetries) {
        attempt++;
        const waitMs = 2000 * attempt;
        console.warn(
          `  [通信エラー] ${err.message}。${(waitMs / 1000).toFixed(1)}秒待機して再試行します... (試行 ${attempt}/${maxRetries})`
        );
        await sleep(waitMs);
        continue;
      }
      throw err;
    }
  }
}

/**
 * AtCoder: コンテストのタスク一覧ページから問題一覧を自動取得
 */
export async function getAtCoderTaskList(contest: string): Promise<AtCoderTaskInfo[] | null> {
  const contestLower = contest.toLowerCase().trim();
  const url = `https://atcoder.jp/contests/${contestLower}/tasks`;

  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AtCoder-Tool/1.0",
  };
  const session = getSessionCookie();
  if (session) {
    headers["Cookie"] = session;
  }

  let res: Response;
  try {
    res = await fetchWithRetry(url, { headers });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  const html = await res.text();
  const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) return null;

  const rows = [...tbodyMatch[1].matchAll(/<tr>([\s\S]*?)<\/tr>/gi)];
  const tasks: AtCoderTaskInfo[] = [];

  for (const row of rows) {
    const rowHtml = row[1];
    const linkMatch = rowHtml.match(/<a\s+href="(\/contests\/[^/]+\/tasks\/([^"]+))">([^<]+)<\/a>/i);
    if (linkMatch) {
      const taskPath = linkMatch[1];
      const taskId = linkMatch[2];
      const rawLabel = linkMatch[3].trim();
      const label = rawLabel.toLowerCase();

      const titleMatch = rowHtml.match(/<td>\s*<a[^>]*>([^<]+)<\/a>\s*<\/td>/i);
      const title = titleMatch ? decodeHtml(titleMatch[1].trim()) : "";

      tasks.push({
        label,
        taskId,
        url: `https://atcoder.jp${taskPath}`,
        title,
      });
    }
  }

  return tasks.length > 0 ? tasks : null;
}

/**
 * AtCoder: 単一問題のサンプルケースと制限時間を取得
 * @param contest コンテスト名 (例: abc480, arc170, agc065)
 * @param problem 問題名 (例: a, g)
 * @param destFolder 保存先フォルダ名 (省略時は contest)
 * @param taskUrl 直接指定のタスクURL
 */
export async function fetchAtCoderProblem(
  contest: string,
  problem: string,
  destFolder?: string,
  taskUrl?: string
): Promise<FetchResult> {
  const prob = problem.toLowerCase();
  const contestLower = contest.toLowerCase();
  const saveFolder = (destFolder || contestLower).toLowerCase();

  let url = taskUrl;
  if (!url) {
    // ADT コンテスト（adt_all_..., adt_easy_... など）の場合は問題URLが元問題のIDになっているためタスク一覧から特定
    if (/^adt/i.test(contestLower)) {
      const taskList = await getAtCoderTaskList(contestLower);
      const matched = taskList?.find((t) => t.label === prob);
      if (matched) {
        url = matched.url;
      }
    }
    if (!url) {
      url = `https://atcoder.jp/contests/${contestLower}/tasks/${contestLower}_${prob}`;
    }
  }

  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AtCoder-Tool/1.0",
  };
  const session = getSessionCookie();
  if (session) {
    headers["Cookie"] = session;
  }

  let res: Response;
  try {
    res = await fetchWithRetry(url, { headers });
  } catch (err: any) {
    return { success: false, error: `通信エラー: ${err.message}` };
  }

  if (res.status === 404) {
    // 404 の場合、タスク一覧からURLを再検索してリトライ試行（特殊な問題URLやADT等のフォールバック）
    if (!taskUrl) {
      const taskList = await getAtCoderTaskList(contestLower);
      const matched = taskList?.find((t) => t.label === prob);
      if (matched && matched.url !== url) {
        return fetchAtCoderProblem(contest, problem, destFolder, matched.url);
      }
    }
    return { success: false, error: "問題が見つかりません (404)" };
  }
  if (res.status === 403 || res.status === 302 || res.url.includes("/login")) {
    return {
      success: false,
      error: "アクセス制限（本番コンテスト中の可能性があります）。'bun run login' でログイン設定をしてください。",
    };
  }
  if (!res.ok) {
    return { success: false, error: `HTTPエラー: ${res.status}` };
  }

  const html = await res.text();

  // 1. 実行時間制限の抽出
  let timeLimitMs = 2000;
  const timeMatch = html.match(/(?:実行時間制限|Time Limit):\s*([\d\.]+)\s*sec/i);
  if (timeMatch) {
    timeLimitMs = Math.round(parseFloat(timeMatch[1]) * 1000);
  }

  // 2. 日本語セクションの特定
  let targetSection = html;
  if (html.includes('class="lang-ja"')) {
    const jaPart = html.split('class="lang-ja"')[1];
    if (jaPart) {
      targetSection = jaPart.split('</span>')[0];
    }
  }

  // 3. 入力例・出力例の抽出
  const inputMatches = [
    ...targetSection.matchAll(/<h3>\s*(?:入力例|Sample Input)\s*(\d+)[\s\S]*?<\/h3>[\s\S]*?<pre>([\s\S]*?)<\/pre>/gi),
  ];
  const outputMatches = [
    ...targetSection.matchAll(/<h3>\s*(?:出力例|Sample Output)\s*(\d+)[\s\S]*?<\/h3>[\s\S]*?<pre>([\s\S]*?)<\/pre>/gi),
  ];

  if (inputMatches.length === 0) {
    return { success: false, error: "テストケース（入力例）が見つかりませんでした" };
  }

  // 4. 保存先ディレクトリの準備（AtCoder配下）
  const contestDir = path.join(projectRoot, "AtCoder", saveFolder);
  const testDir = path.join(contestDir, "test", prob);
  fs.mkdirSync(testDir, { recursive: true });

  // 既存ケースを一旦クリア（使い回し時の混入防止・随時完全上書き）
  cleanTestDir(testDir);

  // info.json の保存
  const info = {
    platform: "AtCoder",
    contest: contestLower,
    destFolder: saveFolder,
    problem: prob,
    timeLimitMs,
    sampleCount: inputMatches.length,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(testDir, "info.json"), JSON.stringify(info, null, 2), "utf8");

  // in1.txt, out1.txt ... の保存
  const count = Math.min(inputMatches.length, outputMatches.length);
  for (let i = 0; i < count; i++) {
    const inText = decodeHtml(inputMatches[i][2]).trim() + "\n";
    const outText = decodeHtml(outputMatches[i][2]).trim() + "\n";
    fs.writeFileSync(path.join(testDir, `in${i + 1}.txt`), inText, "utf8");
    fs.writeFileSync(path.join(testDir, `out${i + 1}.txt`), outText, "utf8");
  }

  return { success: true, count, timeLimitMs, testDir };
}

/**
 * Codeforces: 単一問題のサンプルケース取得（拡張対応）
 */
export async function fetchCodeforcesProblem(
  contest: string,
  problem: string,
  destFolder?: string
): Promise<FetchResult> {
  const prob = problem.toUpperCase();
  const contestId = contest.trim();
  const saveFolder = (destFolder || contestId).trim();
  const url = `https://codeforces.com/contest/${contestId}/problem/${prob}`;

  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
  };

  const session = getCodeforcesSessionCookie();
  if (session) {
    headers["Cookie"] = session;
  }

  let res: Response;
  try {
    res = await fetchWithRetry(url, { headers });
  } catch (err: any) {
    return { success: false, error: `通信エラー: ${err.message}` };
  }

  if (res.status === 403 || res.status === 503) {
    return {
      success: false,
      error:
        "Cloudflareによるアクセス制限 (403/503) です。'bun run login codeforces' でブラウザの認証Cookieを設定してください。",
    };
  }

  if (!res.ok) {
    return { success: false, error: `HTTPエラー: ${res.status}` };
  }

  const html = await res.text();

  if (html.includes("Just a moment...") || html.includes("Checking your browser")) {
    return {
      success: false,
      error:
        "Cloudflareの人間確認画面です。ブラウザでCodeforcesを開き、'bun run login codeforces' でCookieを設定してください。",
    };
  }

  let timeLimitMs = 2000;
  const timeMatch = html.match(/time limit per test<\/div>([\d\.]+)\s*seconds?/i);
  if (timeMatch) {
    timeLimitMs = Math.round(parseFloat(timeMatch[1]) * 1000);
  }

  const inputMatches = [...html.matchAll(/<div class="input">[\s\S]*?<pre>([\s\S]*?)<\/pre>/gi)];
  const outputMatches = [...html.matchAll(/<div class="output">[\s\S]*?<pre>([\s\S]*?)<\/pre>/gi)];

  if (inputMatches.length === 0) {
    return { success: false, error: "テストケースが見つかりませんでした" };
  }

  const contestDir = path.join(projectRoot, "Codeforces", saveFolder);
  const testDir = path.join(contestDir, "test", prob.toLowerCase());
  fs.mkdirSync(testDir, { recursive: true });
  cleanTestDir(testDir);

  const info = {
    platform: "Codeforces",
    contest: contestId,
    destFolder: saveFolder,
    problem: prob,
    timeLimitMs,
    sampleCount: inputMatches.length,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(testDir, "info.json"), JSON.stringify(info, null, 2), "utf8");

  const count = Math.min(inputMatches.length, outputMatches.length);
  for (let i = 0; i < count; i++) {
    const inText = decodeHtml(inputMatches[i][1].replace(/<div class="test-example-line">/g, "").replace(/<\/div>/g, "\n")).trim() + "\n";
    const outText = decodeHtml(outputMatches[i][1]).trim() + "\n";
    fs.writeFileSync(path.join(testDir, `in${i + 1}.txt`), inText, "utf8");
    fs.writeFileSync(path.join(testDir, `out${i + 1}.txt`), outText, "utf8");
  }

  return { success: true, count, timeLimitMs, testDir };
}

/**
 * 汎用: プラットフォーム自動判別付き単一問題フェッチ
 */
export async function fetchProblem(
  contest: string,
  problem: string,
  platform = "atcoder",
  destFolder?: string
): Promise<FetchResult> {
  const plat = platform.toLowerCase();
  if (plat === "codeforces" || plat === "cf") {
    return fetchCodeforcesProblem(contest, problem, destFolder);
  }
  return fetchAtCoderProblem(contest, problem, destFolder);
}

/**
 * コンテスト全体の全問題を一括取得（ABC, ARC, AGC, AHC等に対応）
 */
export async function fetchContest(
  contest: string,
  platform = "atcoder",
  problems?: string[],
  destFolder?: string
): Promise<ContestFetchResults> {
  const plat = platform.toLowerCase();
  const saveTarget = destFolder || contest;
  console.log(`[Fetch] [${platform.toUpperCase()}] ${contest} のテストケースを取得中 (保存先: ${saveTarget})...`);

  const results: ContestFetchResults = {};

  // AtCoder で特定の問題リストが未指定の場合、タスク一覧ページを自動取得して正確な問題リストを確定
  if (plat === "atcoder" && (!problems || problems.length === 0)) {
    const taskList = await getAtCoderTaskList(contest);
    if (taskList && taskList.length > 0) {
      for (let i = 0; i < taskList.length; i++) {
        const t = taskList[i];
        if (i > 0) {
          // 各問題の取得間に 800ms 〜 1.5秒 のウェイトを挟む（サーバー負荷・レート制限対策）
          const delay = Math.floor(800 + Math.random() * 700);
          await sleep(delay);
        }
        const res = await fetchAtCoderProblem(contest, t.label, destFolder, t.url);
        results[t.label] = res;
        if (res.success) {
          console.log(`  ✓ 問題 ${t.label.toUpperCase()}: ${res.count} ケース (制限時間: ${res.timeLimitMs}ms)`);
        } else {
          console.log(`  - 問題 ${t.label.toUpperCase()}: ${res.error}`);
        }
      }
      return results;
    }
  }

  // フォールバック または 指定問題リスト
  const probList =
    problems && problems.length > 0
      ? problems
      : getDefaultProblems(contest, platform);

  for (let i = 0; i < probList.length; i++) {
    const p = probList[i];
    if (i > 0) {
      // 各問題の取得間に 800ms 〜 1.5秒 のウェイトを挟む
      const delay = Math.floor(800 + Math.random() * 700);
      await sleep(delay);
    }
    const res = await fetchProblem(contest, p, platform, destFolder);
    results[p] = res;
    if (res.success) {
      console.log(`  ✓ 問題 ${p.toUpperCase()}: ${res.count} ケース (制限時間: ${res.timeLimitMs}ms)`);
    } else {
      console.log(`  - 問題 ${p.toUpperCase()}: ${res.error}`);
    }
  }
  return results;
}

// CLIから直接実行された場合
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("使い方: bun run fetch [プラットフォーム] <コンテスト名> [問題名/保存先] [保存先フォルダ]");
    console.error("例: bun run fetch abc480                     (AtCoder/abc480/test に全問題取得)");
    console.error("例: bun run fetch arc170                     (AtCoder/arc170/test に全問題取得)");
    console.error("例: bun run fetch arc170 arc                 (AtCoder/arc/test に上書き取得・使い回し用)");
    console.error("例: bun run fetch agc065 agc                 (AtCoder/agc/test に上書き取得・使い回し用)");
    console.error("例: bun run fetch ahc030 ahc                 (AtCoder/ahc/test に上書き取得・使い回し用)");
    console.error("例: bun run fetch adt_all_20240327_1 adt     (AtCoder/adt/test にデイリーケース上書き取得)");
    console.error("例: bun run fetch arc170 a                   (arc170 の A 問題のみ取得)");
    console.error("例: bun run fetch codeforces 1900            (Codeforces/1900/test に取得)");
    process.exit(1);
  }

  let plat = "atcoder";
  let contest = "";
  let prob = "";
  let destFolder = "";

  const cleanArgs = [...args];
  if (["atcoder", "codeforces", "cf"].includes(cleanArgs[0].toLowerCase())) {
    plat = cleanArgs.shift()!.toLowerCase();
  }

  contest = (cleanArgs.shift() || "").replace(/^(AtCoder|Codeforces|contests)[\\/]+/i, "");

  if (cleanArgs.length === 1) {
    const nextArg = cleanArgs[0];
    if (nextArg.length === 1 && /^[a-zA-Z]$/.test(nextArg)) {
      prob = nextArg;
    } else {
      destFolder = nextArg;
    }
  } else if (cleanArgs.length >= 2) {
    prob = cleanArgs[0];
    destFolder = cleanArgs[1];
  }

  if (prob) {
    const res = await fetchProblem(contest, prob, plat, destFolder || undefined);
    if (res.success) {
      console.log(`✓ [${plat.toUpperCase()}] ${contest} [${prob.toUpperCase()}]: ${res.count} 件取得完了 (制限時間: ${res.timeLimitMs}ms)`);
    } else {
      console.error(`✗ エラー: ${res.error}`);
    }
  } else {
    await fetchContest(contest, plat, undefined, destFolder || undefined);
  }
}
