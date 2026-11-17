#!/usr/bin/env bun

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installWindowsNewlineFix } from "./tty_fix.ts";

installWindowsNewlineFix();

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

export interface CodeforcesTaskInfo {
  label: string;
  url: string;
  title: string;
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const atcoderTaskCache = new Map<string, AtCoderTaskInfo[]>();
const codeforcesTaskCache = new Map<string, CodeforcesTaskInfo[]>();

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
 * 問題名指定（1文字, ex, d1 等）と保存先フォルダ指定（abc, cf 等）を安全に判別するヘルパー
 */
export function isProblemLabelArg(arg: string): boolean {
  return /^(?:[a-zA-Z]|ex|[a-zA-Z]\d+)$/i.test(arg.trim());
}

const HTML_ENTITIES: Record<string, string> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
  nbsp: " ",
  le: "≤",
  ge: "≥",
  times: "×",
  plusmn: "±",
  ne: "≠",
  hellip: "…",
};

/**
 * HTMLエンティティのデコード（数値文字参照・多重デコード防止対応）
 */
export function decodeHtml(html: string): string {
  return html
    .replace(/\r\n?/g, "\n")
    .replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (full, entity: string) => {
      if (entity[0] === "#") {
        const isHex = entity[1] === "x" || entity[1] === "X";
        const cp = parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
        if (Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff) {
          try {
            return String.fromCodePoint(cp);
          } catch {
            return full;
          }
        }
        return full;
      }
      const mapped = HTML_ENTITIES[entity.toLowerCase()];
      return mapped !== undefined ? mapped : full;
    });
}

function normalizePreText(rawPre: string): string {
  const withNewlines = rawPre.replace(/<br\s*\/?>/gi, "\n");
  const strippedTags = withNewlines.replace(/<[^>]+>/g, "");
  const decoded = decodeHtml(strippedTags).replace(/^\n/, "").trimEnd();
  return decoded.length > 0 ? decoded + "\n" : "";
}

function stripTagsAndDecode(htmlFragment: string): string {
  return decodeHtml(htmlFragment.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFullwidthDigits(text: string): string {
  return text.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

function hasClassToken(attrs: string, className: string): boolean {
  const m = attrs.match(/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  if (!m) return false;
  const classes = (m[1] ?? m[2] ?? "").split(/\s+/);
  return classes.includes(className);
}

/**
 * 入れ子のタグを考慮して指定クラス・タグ名の <tag ... class="... targetClass ...">...</tag> をバランス抽出する
 */
export function extractBalancedTagContents(html: string, tagName: "span" | "div", targetClass: string): string[] {
  const results: string[] = [];
  const tagRegex = tagName === "span" ? /<(\/?)span\b([^>]*)>/gi : /<(\/?)div\b([^>]*)>/gi;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(html)) !== null) {
    const isClosing = match[1] === "/";
    const attrs = match[2] || "";
    const isSelfClosing = /\/\s*$/.test(attrs);
    if (isClosing || isSelfClosing || !hasClassToken(attrs, targetClass)) {
      continue;
    }

    const contentStart = tagRegex.lastIndex;
    let depth = 1;
    let contentEnd = html.length;
    let innerMatch: RegExpExecArray | null;

    while ((innerMatch = tagRegex.exec(html)) !== null) {
      const innerClosing = innerMatch[1] === "/";
      const innerAttrs = innerMatch[2] || "";
      const innerSelfClosing = /\/\s*$/.test(innerAttrs);

      if (innerClosing) {
        depth--;
        if (depth === 0) {
          contentEnd = innerMatch.index;
          break;
        }
      } else if (!innerSelfClosing) {
        depth++;
      }
    }

    results.push(html.slice(contentStart, contentEnd));
    if (depth > 0) {
      break;
    }
  }

  return results;
}

export function extractBalancedSpanContents(html: string, targetClass: string): string[] {
  return extractBalancedTagContents(html, "span", targetClass);
}

function extractTaskStatementScope(html: string): string {
  const markerMatch = html.match(/<div\b[^>]*\bid\s*=\s*(?:"task-statement"|'task-statement')[^>]*>/i);
  if (!markerMatch || markerMatch.index === undefined) {
    return html;
  }
  const startIdx = markerMatch.index + markerMatch[0].length;
  const divRegex = /<(\/?)div\b([^>]*)>/gi;
  divRegex.lastIndex = startIdx;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = divRegex.exec(html)) !== null) {
    if (m[1] === "/") {
      depth--;
      if (depth === 0) {
        return html.slice(startIdx, m.index);
      }
    } else if (!/\/\s*$/.test(m[2] || "")) {
      depth++;
    }
  }
  return html.slice(startIdx);
}

interface ParsedSamplesResult {
  pairs: Array<{ input: string; output: string }>;
  hasInteractiveHeading: boolean;
}

/**
 * AtCoder の問題文HTMLから、入れ子タグ・タグ属性・セクション跨ぎを回避しつつ入出力例を抽出する
 */
export function parseAtCoderSamplesFromHtml(html: string): ParsedSamplesResult {
  const scope = extractTaskStatementScope(html);
  const jaBlocks = [
    ...extractBalancedTagContents(scope, "span", "lang-ja"),
    ...extractBalancedTagContents(scope, "div", "lang-ja"),
  ];
  const enBlocks = [
    ...extractBalancedTagContents(scope, "span", "lang-en"),
    ...extractBalancedTagContents(scope, "div", "lang-en"),
  ];

  const candidates: string[] = [];
  if (jaBlocks.length > 0) candidates.push(jaBlocks.join("\n"));
  if (enBlocks.length > 0) candidates.push(enBlocks.join("\n"));
  if (candidates.length === 0) candidates.push(scope);

  let interactiveDetected = false;

  for (const sectionHtml of candidates) {
    const headingRegex = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
    const headings: Array<{ title: string; bodyStart: number; headingStart: number }> = [];
    let hm: RegExpExecArray | null;
    while ((hm = headingRegex.exec(sectionHtml)) !== null) {
      headings.push({
        title: normalizeFullwidthDigits(stripTagsAndDecode(hm[2])),
        headingStart: hm.index,
        bodyStart: headingRegex.lastIndex,
      });
    }

    const inputs: Array<{ key: string; text: string; hasPre: boolean }> = [];
    const outputs: Array<{ key: string; text: string; hasPre: boolean }> = [];

    for (let i = 0; i < headings.length; i++) {
      const h = headings[i];
      const nextStart = i + 1 < headings.length ? headings[i + 1].headingStart : sectionHtml.length;
      const bodySlice = sectionHtml.slice(h.bodyStart, nextStart);

      if (/^(?:入出力例|Sample\s*Interaction|対話例)(?:\s*\d*)?\b/i.test(h.title)) {
        interactiveDetected = true;
      }

      const inMatch = h.title.match(/^(?:入力例|Sample\s*Input)(?:\s*(\d+))?\b/i);
      if (inMatch) {
        const preMatch = bodySlice.match(/<pre\b[^>]*>([\s\S]*?)<\/pre>/i);
        const key = inMatch[1] ? String(parseInt(inMatch[1], 10)) : `__seq_${inputs.length + 1}`;
        inputs.push({ key, text: preMatch ? normalizePreText(preMatch[1]) : "", hasPre: Boolean(preMatch) });
        continue;
      }

      const outMatch = h.title.match(/^(?:出力例|Sample\s*Output)(?:\s*(\d+))?\b/i);
      if (outMatch) {
        const preMatch = bodySlice.match(/<pre\b[^>]*>([\s\S]*?)<\/pre>/i);
        const key = outMatch[1] ? String(parseInt(outMatch[1], 10)) : `__seq_${outputs.length + 1}`;
        outputs.push({ key, text: preMatch ? normalizePreText(preMatch[1]) : "", hasPre: Boolean(preMatch) });
      }
    }

    const validPairExists = inputs.some((x) => x.hasPre) || outputs.some((x) => x.hasPre);
    if (inputs.length > 0 && outputs.length > 0 && validPairExists) {
      const outputByKey = new Map<string, string>();
      for (const out of outputs) {
        if (!outputByKey.has(out.key)) {
          outputByKey.set(out.key, out.text);
        }
      }

      const pairs: Array<{ input: string; output: string }> = [];
      for (let i = 0; i < inputs.length; i++) {
        const inp = inputs[i];
        if (outputByKey.has(inp.key)) {
          pairs.push({ input: inp.text, output: outputByKey.get(inp.key)! });
        } else if (inputs.length === outputs.length) {
          pairs.push({ input: inp.text, output: outputs[i].text });
        }
      }

      if (pairs.length > 0) {
        return { pairs, hasInteractiveHeading: interactiveDetected };
      }
    }
  }

  return { pairs: [], hasInteractiveHeading: interactiveDetected };
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

function parseRetryAfterMs(headerVal: string | null): number | null {
  if (!headerVal) return null;
  const sec = Number(headerVal.trim());
  if (Number.isFinite(sec) && sec > 0) {
    return Math.min(sec * 1000, 30000);
  }
  const dateMs = Date.parse(headerVal);
  if (!isNaN(dateMs)) {
    const delta = dateMs - Date.now();
    if (delta > 0) return Math.min(delta, 30000);
  }
  return null;
}

/**
 * 429 / 一時的サーバーエラー / 通信エラー時にタイムアウト・自動リトライを行う fetch ラッパー
 */
export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  maxRetries = 2
): Promise<Response> {
  const retryableStatuses = new Set([408, 429, 500, 502, 503, 504]);
  let attempt = 0;
  while (true) {
    try {
      const reqOpts: RequestInit = options?.signal
        ? options
        : { ...options, signal: AbortSignal.timeout(15000) };
      const res = await fetch(url, reqOpts);

      const isCloudflareChallenge =
        res.status === 503 &&
        (res.headers.get("cf-mitigated") === "challenge" ||
          (res.headers.get("server") || "").toLowerCase().includes("cloudflare"));

      if (retryableStatuses.has(res.status) && !isCloudflareChallenge && attempt < maxRetries) {
        attempt++;
        let waitMs = res.status === 429 ? 2500 * Math.pow(2, attempt - 1) : 1500 * attempt;
        const retryAfterMs = parseRetryAfterMs(res.headers.get("Retry-After"));
        if (retryAfterMs !== null) {
          waitMs = Math.max(waitMs, retryAfterMs);
        }
        console.warn(
          `  [HTTP ${res.status}] 一時的エラー/制限を検知しました。${(waitMs / 1000).toFixed(1)}秒待機して再試行します... (試行 ${attempt}/${maxRetries})`
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

function buildAtCoderHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": DEFAULT_USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
  };
  const session = getSessionCookie();
  if (session) {
    headers["Cookie"] = session;
  }
  return headers;
}

function buildCodeforcesHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": DEFAULT_USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
  };
  const session = getCodeforcesSessionCookie();
  if (session) {
    headers["Cookie"] = session;
  }
  return headers;
}

/**
 * AtCoder タスク一覧HTMLをパースする（属性・入れ子タグ対応）
 */
export function parseAtCoderTaskListHtml(html: string): AtCoderTaskInfo[] | null {
  const containers = [...html.matchAll(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/gi)].map((m) => m[1]);
  if (containers.length === 0) {
    const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map((m) => m[1]);
    containers.push(...tables);
  }
  if (containers.length === 0) containers.push(html);

  const tasks: AtCoderTaskInfo[] = [];
  const seenIds = new Set<string>();

  for (const block of containers) {
    const rows = [...block.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
    for (const row of rows) {
      const rowHtml = row[1];
      const links = [
        ...rowHtml.matchAll(
          /<a\b[^>]*href\s*=\s*(?:"(?:https?:\/\/atcoder\.jp)?(\/contests\/[^/"'<>?#]+\/tasks\/([^"'<>?#]+))"|'(?:https?:\/\/atcoder\.jp)?(\/contests\/[^/"'<>?#]+\/tasks\/([^"'<>?#]+))')[^>]*>([\s\S]*?)<\/a>/gi
        ),
      ];
      if (links.length === 0) continue;

      const first = links[0];
      const taskPath = first[1] || first[3];
      const taskId = first[2] || first[4];
      const label = stripTagsAndDecode(first[5]).toLowerCase();
      if (!taskPath || !taskId || !label || seenIds.has(taskId)) continue;

      seenIds.add(taskId);
      const second = links[1];
      const title = second ? stripTagsAndDecode(second[5]) : "";

      tasks.push({
        label,
        taskId,
        url: `https://atcoder.jp${taskPath}`,
        title,
      });
    }
    if (tasks.length > 0) break;
  }

  return tasks.length > 0 ? tasks : null;
}

/**
 * AtCoder: コンテストのタスク一覧ページから問題一覧を自動取得
 */
export async function getAtCoderTaskList(contest: string): Promise<AtCoderTaskInfo[] | null> {
  const contestLower = contest.toLowerCase().trim();
  if (atcoderTaskCache.has(contestLower)) {
    return atcoderTaskCache.get(contestLower)!;
  }

  const url = `https://atcoder.jp/contests/${contestLower}/tasks`;
  let res: Response;
  try {
    res = await fetchWithRetry(url, { headers: buildAtCoderHeaders() });
  } catch {
    return null;
  }

  if (res.status === 403 || res.status === 401 || res.url.includes("/login")) {
    return null;
  }
  if (!res.ok) return null;

  const html = await res.text();
  const tasks = parseAtCoderTaskListHtml(html);
  if (tasks && tasks.length > 0) {
    atcoderTaskCache.set(contestLower, tasks);
  }
  return tasks;
}

/**
 * AtCoder: 単一問題のサンプルケースと制限時間を取得
 * @param contest コンテスト名 (例: abc480, arc170, agc065)
 * @param problem 問題名 (例: a, g)
 * @param destFolder 保存先フォルダ名 (省略時は contest)
 * @param taskUrl 直接指定のタスクURL
 */
function matchTaskByProblem(tasks: AtCoderTaskInfo[] | null | undefined, prob: string): AtCoderTaskInfo | undefined {
  if (!tasks) return undefined;
  const p = prob.toLowerCase();
  return tasks.find((t) => t.label === p) || tasks.find((t) => t.taskId.toLowerCase().endsWith(`_${p}`));
}

export async function fetchAtCoderProblem(
  contest: string,
  problem: string,
  destFolder?: string,
  taskUrl?: string
): Promise<FetchResult> {
  const prob = problem.toLowerCase().trim();
  const contestLower = contest.toLowerCase().trim();
  const saveFolder = (destFolder || contestLower).toLowerCase().trim();

  let url = taskUrl;
  if (!url) {
    // ADT や特殊ラベル問題 (ex, a1, h など) はタスク一覧から実URLを優先解決
    if (/^adt/i.test(contestLower) || !/^[a-g]$/i.test(prob)) {
      const taskList = await getAtCoderTaskList(contestLower);
      const matched = matchTaskByProblem(taskList, prob);
      if (matched) {
        url = matched.url;
      }
    }
    if (!url) {
      url = `https://atcoder.jp/contests/${contestLower}/tasks/${contestLower}_${prob}`;
    }
  }

  let res: Response;
  try {
    res = await fetchWithRetry(url, { headers: buildAtCoderHeaders() });
  } catch (err: any) {
    return { success: false, error: `通信エラー: ${err.message}` };
  }

  if (res.status === 404) {
    // 404 の場合、タスク一覧からURLを再検索してリトライ試行（特殊な問題URLやADT等のフォールバック）
    if (!taskUrl) {
      const taskList = await getAtCoderTaskList(contestLower);
      const matched = matchTaskByProblem(taskList, prob);
      if (matched && matched.url !== url) {
        await sleep(500);
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
  const timeMatch = html.match(/(?:実行時間制限|Time\s*Limit)\s*[:：]?\s*([\d\.]+)\s*sec/i);
  if (timeMatch) {
    timeLimitMs = Math.round(parseFloat(timeMatch[1]) * 1000);
  }

  // 2. 入れ子 <span> / 言語切替 / 見出し・セクション境界を考慮して入出力例を抽出
  const parsed = parseAtCoderSamplesFromHtml(html);
  if (parsed.pairs.length === 0) {
    if (parsed.hasInteractiveHeading) {
      return {
        success: false,
        error: "インタラクティブ形式（入出力例）の問題のため標準サンプルケースがありません",
      };
    }
    return { success: false, error: "テストケース（入力例・出力例）が見つかりませんでした" };
  }

  // 3. 保存先ディレクトリの準備（AtCoder配下）— 抽出成功時のみ既存ケースを置換
  const contestDir = path.join(projectRoot, "AtCoder", saveFolder);
  const testDir = path.join(contestDir, "test", prob);
  fs.mkdirSync(testDir, { recursive: true });
  cleanTestDir(testDir);

  const count = parsed.pairs.length;
  const info = {
    platform: "AtCoder",
    contest: contestLower,
    destFolder: saveFolder,
    problem: prob,
    timeLimitMs,
    sampleCount: count,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(testDir, "info.json"), JSON.stringify(info, null, 2), "utf8");

  for (let i = 0; i < count; i++) {
    fs.writeFileSync(path.join(testDir, `in${i + 1}.txt`), parsed.pairs[i].input, "utf8");
    fs.writeFileSync(path.join(testDir, `out${i + 1}.txt`), parsed.pairs[i].output, "utf8");
  }

  return { success: true, count, timeLimitMs, testDir };
}

function isCloudflareHtml(html: string): boolean {
  return (
    html.includes("Just a moment...") ||
    html.includes("Checking your browser") ||
    html.includes("Attention Required!") ||
    html.includes("cf-browser-verification") ||
    html.includes("Verifying you are human")
  );
}

/**
 * Codeforces タスク一覧HTMLをパースする
 */
export function parseCodeforcesTaskListHtml(html: string): CodeforcesTaskInfo[] | null {
  const tableMatch = html.match(/<table\b[^>]*class\s*=\s*(?:"[^"]*\bproblems\b[^"]*"|'[^']*\bproblems\b[^']*')[^>]*>([\s\S]*?)<\/table>/i);
  const scope = tableMatch ? tableMatch[1] : html;
  const rows = [...scope.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  const tasks: CodeforcesTaskInfo[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const rowHtml = row[1];
    const links = [
      ...rowHtml.matchAll(
        /<a\b[^>]*href\s*=\s*(?:"(\/(?:contest|gym)\/[^/"'<>?#]+\/problem\/([^"'<>?#]+))"|'(\/(?:contest|gym)\/[^/"'<>?#]+\/problem\/([^"'<>?#]+))')[^>]*>([\s\S]*?)<\/a>/gi
      ),
    ];
    if (links.length === 0) continue;

    const first = links[0];
    const problemPath = first[1] || first[3];
    const probIndex = (first[2] || first[4] || "").trim().toLowerCase();
    if (!problemPath || !probIndex || seen.has(probIndex)) continue;

    seen.add(probIndex);
    const second = links[1];
    const title = second ? stripTagsAndDecode(second[5]) : "";
    tasks.push({
      label: probIndex,
      url: `https://codeforces.com${problemPath}`,
      title,
    });
  }

  return tasks.length > 0 ? tasks : null;
}

/**
 * Codeforces: コンテストのタスク一覧を取得（D1/D2 や 7問以上にも対応）
 */
export async function getCodeforcesTaskList(contest: string): Promise<CodeforcesTaskInfo[] | null> {
  const contestId = contest.trim();
  if (codeforcesTaskCache.has(contestId)) {
    return codeforcesTaskCache.get(contestId)!;
  }

  const candidatePaths = Number(contestId) >= 100000 ? ["gym", "contest"] : ["contest", "gym"];
  for (const kind of candidatePaths) {
    const url = `https://codeforces.com/${kind}/${contestId}`;
    try {
      const res = await fetchWithRetry(url, { headers: buildCodeforcesHeaders() });
      if (!res.ok) continue;
      const html = await res.text();
      if (isCloudflareHtml(html)) return null;
      const tasks = parseCodeforcesTaskListHtml(html);
      if (tasks && tasks.length > 0) {
        codeforcesTaskCache.set(contestId, tasks);
        return tasks;
      }
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Codeforces の問題HTMLからサンプルを抽出する（複数クラスの test-example-line・<br>・output側タグ除去対応）
 */
export function parseCodeforcesSamplesFromHtml(html: string): { pairs: Array<{ input: string; output: string }>; timeLimitMs: number } {
  let timeLimitMs = 2000;
  const timeMatch = html.match(/time limit per test[\s\S]{0,80}?([\d\.]+)\s*seconds?/i);
  if (timeMatch) {
    timeLimitMs = Math.round(parseFloat(timeMatch[1]) * 1000);
  }

  const inputMatches = [
    ...html.matchAll(/<div\b[^>]*class\s*=\s*(?:"[^"]*\binput\b[^"]*"|'[^']*\binput\b[^']*')[^>]*>[\s\S]*?<pre\b[^>]*>([\s\S]*?)<\/pre>/gi),
  ];
  const outputMatches = [
    ...html.matchAll(/<div\b[^>]*class\s*=\s*(?:"[^"]*\boutput\b[^"]*"|'[^']*\boutput\b[^']*')[^>]*>[\s\S]*?<pre\b[^>]*>([\s\S]*?)<\/pre>/gi),
  ];

  const cleanPre = (raw: string) =>
    normalizePreText(
      raw
        .replace(/<div\b[^>]*class\s*=\s*(?:"[^"]*\btest-example-line\b[^"]*"|'[^']*\btest-example-line\b[^']*')[^>]*>/gi, "")
        .replace(/<\/div>[ \t]*\r?\n?/gi, "\n")
    );

  const count = Math.min(inputMatches.length, outputMatches.length);
  const pairs: Array<{ input: string; output: string }> = [];
  for (let i = 0; i < count; i++) {
    pairs.push({
      input: cleanPre(inputMatches[i][1]),
      output: cleanPre(outputMatches[i][1]),
    });
  }
  return { pairs, timeLimitMs };
}

/**
 * Codeforces: 単一問題のサンプルケース取得（拡張対応）
 */
export async function fetchCodeforcesProblem(
  contest: string,
  problem: string,
  destFolder?: string,
  taskUrl?: string
): Promise<FetchResult> {
  const prob = problem.toUpperCase().trim();
  const contestId = contest.trim();
  const saveFolder = (destFolder || contestId).trim().toLowerCase();
  const url = taskUrl || `https://codeforces.com/contest/${contestId}/problem/${prob}`;

  let res: Response;
  try {
    res = await fetchWithRetry(url, { headers: buildCodeforcesHeaders() });
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

  if (!/\/(?:contest|gym)\/[^/]+\/problem\//i.test(res.url)) {
    return { success: false, error: "問題が見つかりませんでした（コンテストページへリダイレクト）" };
  }

  const html = await res.text();
  if (isCloudflareHtml(html)) {
    return {
      success: false,
      error:
        "Cloudflareの人間確認画面です。ブラウザでCodeforcesを開き、'bun run login codeforces' でCookieを設定してください。",
    };
  }

  const parsed = parseCodeforcesSamplesFromHtml(html);
  if (parsed.pairs.length === 0) {
    return { success: false, error: "テストケースが見つかりませんでした" };
  }

  const contestDir = path.join(projectRoot, "Codeforces", saveFolder);
  const testDir = path.join(contestDir, "test", prob.toLowerCase());
  fs.mkdirSync(testDir, { recursive: true });
  cleanTestDir(testDir);

  const count = parsed.pairs.length;
  const info = {
    platform: "Codeforces",
    contest: contestId,
    destFolder: saveFolder,
    problem: prob,
    timeLimitMs: parsed.timeLimitMs,
    sampleCount: count,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(testDir, "info.json"), JSON.stringify(info, null, 2), "utf8");

  for (let i = 0; i < count; i++) {
    fs.writeFileSync(path.join(testDir, `in${i + 1}.txt`), parsed.pairs[i].input, "utf8");
    fs.writeFileSync(path.join(testDir, `out${i + 1}.txt`), parsed.pairs[i].output, "utf8");
  }

  return { success: true, count, timeLimitMs: parsed.timeLimitMs, testDir };
}

/**
 * 汎用: プラットフォーム自動判別付き単一問題フェッチ
 */
export async function fetchProblem(
  contest: string,
  problem: string,
  platform = "atcoder",
  destFolder?: string,
  taskUrl?: string
): Promise<FetchResult> {
  const plat = platform.toLowerCase();
  if (plat === "codeforces" || plat === "cf") {
    return fetchCodeforcesProblem(contest, problem, destFolder, taskUrl);
  }
  return fetchAtCoderProblem(contest, problem, destFolder, taskUrl);
}

/**
 * コンテスト全体の全問題を一括取得（ABC, ARC, AGC, AHC, Codeforces D1/D2等に対応）
 */
export async function fetchContest(
  contest: string,
  platform = "atcoder",
  problems?: string[],
  destFolder?: string
): Promise<ContestFetchResults> {
  const plat = platform.toLowerCase();
  const saveTarget = (destFolder || contest).toLowerCase();
  console.log(`[Fetch] [${platform.toUpperCase()}] ${contest} のテストケースを取得中 (保存先: ${saveTarget})...`);

  const results: ContestFetchResults = {};
  const failedLabels: string[] = [];

  if (plat === "atcoder") {
    const taskList = await getAtCoderTaskList(contest);
    if (taskList && taskList.length > 0 && (!problems || problems.length === 0)) {
      for (let i = 0; i < taskList.length; i++) {
        const t = taskList[i];
        await sleep(Math.floor(800 + Math.random() * 700));
        const res = await fetchAtCoderProblem(contest, t.label, destFolder, t.url);
        results[t.label] = res;
        if (res.success) {
          console.log(`  ✓ 問題 ${t.label.toUpperCase()}: ${res.count} ケース (制限時間: ${res.timeLimitMs}ms)`);
        } else {
          failedLabels.push(t.label.toUpperCase());
          console.log(`  - 問題 ${t.label.toUpperCase()}: ${res.error}`);
        }
      }
      if (failedLabels.length > 0) {
        console.warn(`⚠️ テストケース未取得の問題: ${failedLabels.join(", ")} (再取得例: 'oj f ${failedLabels[0].toLowerCase()}')`);
      }
      return results;
    }

    const probList = problems && problems.length > 0 ? problems : getDefaultProblems(contest, platform);
    for (let i = 0; i < probList.length; i++) {
      const p = probList[i];
      if (i > 0 || (taskList && taskList.length > 0)) {
        await sleep(Math.floor(800 + Math.random() * 700));
      }
      const matched = matchTaskByProblem(taskList, p);
      const res = await fetchAtCoderProblem(contest, p, destFolder, matched?.url);
      results[p] = res;
      if (res.success) {
        console.log(`  ✓ 問題 ${p.toUpperCase()}: ${res.count} ケース (制限時間: ${res.timeLimitMs}ms)`);
      } else {
        failedLabels.push(p.toUpperCase());
        console.log(`  - 問題 ${p.toUpperCase()}: ${res.error}`);
      }
    }
  } else {
    const taskList = !problems || problems.length === 0 ? await getCodeforcesTaskList(contest) : null;
    if (taskList && taskList.length > 0) {
      for (let i = 0; i < taskList.length; i++) {
        const t = taskList[i];
        await sleep(Math.floor(800 + Math.random() * 700));
        const res = await fetchCodeforcesProblem(contest, t.label, destFolder, t.url);
        results[t.label] = res;
        if (res.success) {
          console.log(`  ✓ 問題 ${t.label.toUpperCase()}: ${res.count} ケース (制限時間: ${res.timeLimitMs}ms)`);
        } else {
          failedLabels.push(t.label.toUpperCase());
          console.log(`  - 問題 ${t.label.toUpperCase()}: ${res.error}`);
        }
      }
    } else {
      const probList = problems && problems.length > 0 ? problems : getDefaultProblems(contest, platform);
      for (let i = 0; i < probList.length; i++) {
        const p = probList[i];
        if (i > 0) {
          await sleep(Math.floor(800 + Math.random() * 700));
        }
        const res = await fetchProblem(contest, p, platform, destFolder);
        results[p] = res;
        if (res.success) {
          console.log(`  ✓ 問題 ${p.toUpperCase()}: ${res.count} ケース (制限時間: ${res.timeLimitMs}ms)`);
        } else {
          failedLabels.push(p.toUpperCase());
          console.log(`  - 問題 ${p.toUpperCase()}: ${res.error}`);
        }
      }
    }
  }

  if (failedLabels.length > 0) {
    console.warn(`⚠️ テストケース未取得の問題: ${failedLabels.join(", ")} (再取得例: 'oj f ${failedLabels[0].toLowerCase()}')`);
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
    if (isProblemLabelArg(nextArg)) {
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
