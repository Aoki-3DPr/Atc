#!/usr/bin/env bun

// ANSI カラーコード定義
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
};

console.log(`
${c.bold}${c.cyan}======================================================================${c.reset}
  ${c.bold}${c.green}AtCoder / 競プロ 開発ツール CLI コマンド一覧${c.reset}
${c.bold}${c.cyan}======================================================================${c.reset}

${c.bold}${c.yellow}【1. 使い回しフォルダの準備・ケース上書き（推奨）】${c.reset}
  ※ 既存コードは安全に保護され、テストケースのみ随時上書きされます。
  ${c.cyan}bun run abc [コンテストID]${c.reset}     ABC用 (AtCoder/abc/ に a〜g.cpp 生成)
      ${c.gray}例: bun run abc              (フォルダのみ初期化)${c.reset}
      ${c.gray}例: bun run abc abc350       (abc350 のケースを abc に上書き取得)${c.reset}

  ${c.cyan}bun run arc [コンテストID]${c.reset}     ARC用 (AtCoder/arc/ に a〜f.cpp 生成)
      ${c.gray}例: bun run arc arc170${c.reset}

  ${c.cyan}bun run agc [コンテストID]${c.reset}     AGC用 (AtCoder/agc/ に a〜f.cpp 生成)
      ${c.gray}例: bun run agc agc065${c.reset}

  ${c.cyan}bun run ahc [コンテストID]${c.reset}     AHC用 (AtCoder/ahc/ に a.cpp 生成)
      ${c.gray}例: bun run ahc ahc030${c.reset}

  ${c.cyan}bun run adt [コンテストID]${c.reset}     デイリー精進用 (AtCoder/adt/ に a〜h.cpp 生成)
      ${c.gray}例: bun run adt adt_all_20240327_1${c.reset}
      ${c.gray}※ bun run daily でも同じコマンドとして実行可能${c.reset}

----------------------------------------------------------------------
${c.bold}${c.yellow}【2. 高速テスト実行（ビルド＋サンプル判定）】${c.reset}
  ※ コード変更なし時はビルドを自動スキップ (0 ms)。コンパイル時間・実行時間を表示。
  ※ WSL (Linux) 実行時は /dev/shm (RAMディスク) 上で超高速処理されます。

  ${c.cyan}bun run t <フォルダ/コンテスト名> <問題名>${c.reset}
      ${c.gray}例: bun run t abc a          (AtCoder/abc/a.cpp をテスト)${c.reset}
      ${c.gray}例: bun run t arc b          (AtCoder/arc/b.cpp をテスト)${c.reset}
      ${c.gray}例: bun run t adt a          (AtCoder/adt/a.cpp をテスト)${c.reset}
      ${c.gray}例: bun run t abc350 a       (個別フォルダ AtCoder/abc350/a.cpp をテスト)${c.reset}
      ${c.gray}※ bun run test でも実行可能${c.reset}

----------------------------------------------------------------------
${c.bold}${c.yellow}【3. 提出コードの自動バンドル（クリップボードへコピー）】${c.reset}
  ※ lib/ 内の自作クラスを展開し、ヘッダ直後に自動配置。提出欄にそのまま Ctrl+V 可能です。

  ${c.cyan}bun run b <フォルダ/コンテスト名> <問題名>${c.reset}
      ${c.gray}例: bun run b abc a${c.reset}
      ${c.gray}例: bun run b arc b${c.reset}
      ${c.gray}例: bun run b adt a${c.reset}
      ${c.gray}※ bun run bundle でも実行可能${c.reset}

----------------------------------------------------------------------
${c.bold}${c.yellow}【4. テストケースの取得（fetch）】${c.reset}
  ${c.cyan}bun run f <取得元コンテスト> [保存先フォルダ]${c.reset}
      ${c.gray}例: bun run f abc350 abc     (abc350 の全ケースを abc フォルダに上書き)${c.reset}
      ${c.gray}例: bun run f arc170 arc     (arc170 の全ケースを arc フォルダに上書き)${c.reset}
      ${c.gray}例: bun run f abc350         (AtCoder/abc350/test に保存)${c.reset}
      ${c.gray}例: bun run f abc350 a       (特定の問題 a のみ取得)${c.reset}
      ${c.gray}※ bun run fetch でも実行可能${c.reset}

----------------------------------------------------------------------
${c.bold}${c.yellow}【5. 個別コンテストの作成】${c.reset}
  ${c.cyan}bun run c <コンテスト名>${c.reset}           AtCoder 個別フォルダ作成 (AtCoder/<名>/)
      ${c.gray}例: bun run c abc350         (タスク一覧から問題数を自動検出して生成＆ケース取得)${c.reset}

  ${c.cyan}bun run codeforces <コンテストID>${c.reset}  Codeforces フォルダ作成 (Codeforces/<ID>/)
      ${c.gray}例: bun run codeforces 1900${c.reset}

----------------------------------------------------------------------
${c.bold}${c.yellow}【6. セッション・Cookie 設定】${c.reset}
  ${c.cyan}bun run login${c.reset}                    Cookie 設定メニュー (AtCoder / Codeforces 選択)
  ${c.cyan}bun run login atcoder${c.reset}            AtCoder 本番コンテスト用 Cookie (REVEL_SESSION) 設定
  ${c.cyan}bun run login codeforces${c.reset}         Codeforces Cloudflare 通過用 Cookie (cf_clearance) 設定
  ${c.cyan}bun run help${c.reset} (または ${c.cyan}bun run h${c.reset})  本ヘルプの表示

${c.bold}${c.cyan}======================================================================${c.reset}
  ${c.bold}💡 おすすめの日常精進フロー:${c.reset}
    1. ${c.green}bun run abc abc350${c.reset}   (ABC350のケースを取得して準備)
    2. エディタで ${c.green}AtCoder/abc/a.cpp${c.reset} を解く
    3. ${c.green}bun run t abc a${c.reset}       (テスト実行)
    4. ${c.green}bun run b abc a${c.reset}       (提出コードをコピー → AtCoderに Ctrl+V)
${c.bold}${c.cyan}======================================================================${c.reset}
`);
