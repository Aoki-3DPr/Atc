#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

/**
 * HTMLエンティティのデコード
 */
function decodeHtml(html) {
  return html
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r\n/g, "\n");
}

/**
 * 保存済みのAtCoderセッションCookieを取得
 */
export function getSessionCookie() {
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
 * 単一問題のサンプルケースと制限時間を取得
 */
export async function fetchProblem(contest, problem) {
  const prob = problem.toLowerCase();
  const contestLower = contest.toLowerCase();
  const url = `https://atcoder.jp/contests/${contestLower}/tasks/${contestLower}_${prob}`;

  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AtCoder-Tool/1.0",
  };
  const session = getSessionCookie();
  if (session) {
    headers["Cookie"] = session;
  }

  let res;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    return { success: false, error: `通信エラー: ${err.message}` };
  }

  if (res.status === 404) {
    return { success: false, error: "問題が見つかりません (404)" };
  }
  if (res.status === 403 || res.status === 302 || res.url.includes("/login")) {
    return {
      success: false,
      error: "アクセス制限（本番コンテスト中の可能性があります）。'npm run login' でログイン設定をしてください。",
    };
  }
  if (!res.ok) {
    return { success: false, error: `HTTPエラー: ${res.status}` };
  }

  const html = await res.text();

  // 1. 実行時間制限の抽出 (例: 実行時間制限: 2 sec または Time Limit: 2.5 sec)
  let timeLimitMs = 2000; // デフォルト 2秒
  const timeMatch = html.match(/(?:実行時間制限|Time Limit):\s*([\d\.]+)\s*sec/i);
  if (timeMatch) {
    timeLimitMs = Math.round(parseFloat(timeMatch[1]) * 1000);
  }

  // 2. 日本語セクションの特定（英語セクションとの重複を防ぐ）
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

  // 4. 保存先ディレクトリの準備
  const testDir = path.join(projectRoot, "contests", contestLower, "test", prob);
  fs.mkdirSync(testDir, { recursive: true });

  // info.json の保存
  const info = {
    contest: contestLower,
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
 * コンテスト全体の全問題（a〜g）を一括取得
 */
export async function fetchContest(contest) {
  const problems = ["a", "b", "c", "d", "e", "f", "g"];
  console.log(`[Fetch] ${contest} のテストケースを取得中...`);

  const results = {};
  for (const p of problems) {
    const res = await fetchProblem(contest, p);
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
    console.error("使い方: npm run fetch <コンテスト名> [問題名]");
    console.error("例: npm run fetch abc350");
    console.error("例: npm run fetch abc350 a");
    process.exit(1);
  }

  const contestName = args[0].replace(/^contests[\\/]+/, "");
  if (args.length >= 2) {
    const prob = args[1].toLowerCase();
    const res = await fetchProblem(contestName, prob);
    if (res.success) {
      console.log(`✓ ${contestName} [${prob.toUpperCase()}]: ${res.count} 件取得完了 (制限時間: ${res.timeLimitMs}ms)`);
    } else {
      console.error(`✗ エラー: ${res.error}`);
    }
  } else {
    await fetchContest(contestName);
  }
}
