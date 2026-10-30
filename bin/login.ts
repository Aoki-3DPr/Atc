#!/usr/bin/env bun

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const atcoderSessionPath = path.join(projectRoot, ".atcoder_session");
const codeforcesSessionPath = path.join(projectRoot, ".codeforces_session");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function createReadline(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function prompt(rl: readline.Interface, query: string): Promise<string> {
  return new Promise((resolve) => rl.question(query, resolve));
}

/**
 * AtCoder ログインセッション設定
 */
async function setupAtCoder(rl: readline.Interface) {
  console.log("\n==================================================");
  console.log("  AtCoder 本番コンテスト用セッション設定");
  console.log("==================================================");
  console.log("※ 過去問の練習時はログイン不要です。本番コンテスト時のみ設定してください。\n");
  console.log("【Cookie取得手順】");
  console.log("1. ブラウザ（Chrome等）で AtCoder (https://atcoder.jp) にログインする");
  console.log("2. F12キーを押して「開発者ツール」を開く");
  console.log("3. 「Application」タブ → 左側「Cookies」 → 「https://atcoder.jp」を開く");
  console.log("4. 一覧にある「REVEL_SESSION」の「Value（値）」をコピーする\n");

  const ans = await prompt(rl, "REVEL_SESSION の値を貼り付けて Enter を押してください: ");
  const rawValue = ans.trim();

  if (!rawValue) {
    console.log("キャンセルしました。");
    return;
  }

  const sessionValue = rawValue.replace(/^REVEL_SESSION=/, "").trim();
  fs.writeFileSync(atcoderSessionPath, sessionValue, "utf8");
  console.log("\n✓ .atcoder_session にセッション情報を保存しました。");

  console.log("AtCoder への接続を確認中...");
  try {
    const res = await fetch("https://atcoder.jp/settings", {
      headers: {
        Cookie: `REVEL_SESSION=${sessionValue}`,
        "User-Agent": USER_AGENT,
      },
    });

    if (res.ok && !res.url.includes("/login")) {
      console.log("🎉 ログイン確認に成功しました！本番コンテストのテストケースも自動取得できます。");
    } else {
      console.log("⚠️ 注意: ログインページにリダイレクトされました。値が正しいかご確認ください。");
    }
  } catch (err: any) {
    console.log(`⚠️ 接続テストをスキップしました: ${err.message}`);
  }
}

/**
 * Codeforces Cloudflare 通過用 Cookie 設定
 */
async function setupCodeforces(rl: readline.Interface) {
  console.log("\n==================================================");
  console.log("  Codeforces Cloudflare / セッション設定");
  console.log("==================================================");
  console.log("※ 過去問は設定なしでも取得できますが、本番開始直後の Cloudflare 対策に有効です。\n");
  console.log("【Cookie取得手順】");
  console.log("1. ブラウザ（Chrome等）で Codeforces (https://codeforces.com) を開く");
  console.log("   (※ Cloudflare の人間確認画面が出た場合は通過してください)");
  console.log("2. F12キーを押して「開発者ツール」を開く");
  console.log("3. 「Application」タブ → 左側「Cookies」 → 「https://codeforces.com」を開く");
  console.log("4. 一覧にある「cf_clearance」の値、または Cookie 全体をコピーする");
  console.log("   (※ Networkタブの適当な通信の Request Headers 内の Cookie 全体を貼ってもOK)\n");

  const ans = await prompt(rl, "cf_clearance または Cookie 文字列を貼り付けて Enter を押してください: ");
  const rawValue = ans.trim();

  if (!rawValue) {
    console.log("キャンセルしました。");
    return;
  }

  let cookieString = rawValue;
  // cf_clearance の値単体が貼られた場合はフォーマット整形
  if (!cookieString.includes("=") && !cookieString.includes(";")) {
    cookieString = `cf_clearance=${cookieString}`;
  }

  fs.writeFileSync(codeforcesSessionPath, cookieString, "utf8");
  console.log("\n✓ .codeforces_session に Cookie を保存しました。");

  console.log("Codeforces への接続を確認中...");
  try {
    const res = await fetch("https://codeforces.com", {
      headers: {
        Cookie: cookieString,
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    const body = await res.text();
    if (res.ok && !body.includes("Just a moment...") && !body.includes("Checking your browser")) {
      console.log("🎉 Cloudflare の通過確認に成功しました！Codeforces のテストケースを正常に取得できます。");
    } else if (res.status === 403 || body.includes("Just a moment...")) {
      console.log("⚠️ 注意: Cloudflare の確認画面が返されました。ブラウザで最新の Cookie を取得してください。");
    } else {
      console.log(`✓ 接続ステータス: ${res.status}`);
    }
  } catch (err: any) {
    console.log(`⚠️ 接続テストをスキップしました: ${err.message}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const target = args[0]?.toLowerCase();
  const rl = createReadline();

  try {
    if (target === "atcoder" || target === "ac") {
      await setupAtCoder(rl);
    } else if (target === "codeforces" || target === "cf") {
      await setupCodeforces(rl);
    } else {
      console.log("==================================================");
      console.log("  ログイン / セッション Cookie 管理ツール");
      console.log("==================================================");
      console.log("1) AtCoder (本番コンテスト用 REVEL_SESSION)");
      console.log("2) Codeforces (Cloudflare 通過用 cf_clearance / Cookie)");
      console.log("q) 終了\n");

      const choice = (await prompt(rl, "設定したいプラットフォームを選択してください [1/2/q]: ")).trim();
      if (choice === "1") {
        await setupAtCoder(rl);
      } else if (choice === "2") {
        await setupCodeforces(rl);
      } else {
        console.log("終了しました。");
      }
    }
  } finally {
    rl.close();
  }
}

await main();
