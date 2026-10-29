#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const sessionPath = path.join(projectRoot, ".atcoder_session");

console.log("==================================================");
console.log("  AtCoder 本番コンテスト用セッション設定");
console.log("==================================================");
console.log("※ 過去問の練習時はログイン不要です。本番コンテスト時のみ設定してください。\n");
console.log("【Cookie取得手順】");
console.log("1. ブラウザ（Chrome等）で AtCoder にログインする");
console.log("2. F12キーを押して「開発者ツール」を開く");
console.log("3. 「Application」タブ → 左側「Cookies」 → 「https://atcoder.jp」を開く");
console.log("4. 一覧にある「REVEL_SESSION」の「Value（値）」をコピーする\n");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question("REVEL_SESSION の値を貼り付けて Enter を押してください: ", async (ans) => {
  rl.close();
  const rawValue = ans.trim();

  if (!rawValue) {
    console.log("キャンセルしました。");
    process.exit(0);
  }

  const sessionValue = rawValue.replace(/^REVEL_SESSION=/, "").trim();
  fs.writeFileSync(sessionPath, sessionValue, "utf8");
  console.log("\n✓ .atcoder_session にセッション情報を保存しました。");

  // 接続検証
  console.log("AtCoder への接続を確認中...");
  try {
    const res = await fetch("https://atcoder.jp/settings", {
      headers: {
        Cookie: `REVEL_SESSION=${sessionValue}`,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AtCoder-Tool/1.0",
      },
    });

    if (res.ok && !res.url.includes("/login")) {
      console.log("🎉 ログイン確認に成功しました！本番コンテストのテストケースも自動取得できます。");
    } else {
      console.log("⚠️ 注意: ログインページにリダイレクトされました。値が正しいかご確認ください。");
    }
  } catch (err) {
    console.log(`⚠️ 接続テストをスキップしました: ${err.message}`);
  }
});
