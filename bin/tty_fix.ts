/**
 * Windows 環境で readline / raw モード使用時に '\n' が '\r\n' に自動展開されず、
 * 出力が階段状（斜め・右ズレ）に崩れる問題を根本防止するユーティリティ。
 */

import util from "node:util";

const PATCHED_KEY = Symbol.for("oj.tty_fix.patched");
const CONSOLE_PATCHED_KEY = Symbol.for("oj.tty_fix.console_patched");

export function installWindowsNewlineFix(): void {
  if (process.platform !== "win32") return;

  const patchStream = (stream: NodeJS.WriteStream) => {
    if ((stream as any)[PATCHED_KEY]) return;
    (stream as any)[PATCHED_KEY] = true;

    let lastEndedWithCR = false;
    const origWrite = stream.write.bind(stream);

    (stream as any).write = function (chunk: any, encoding?: any, cb?: any): boolean {
      if (typeof encoding === "function") {
        cb = encoding;
        encoding = undefined;
      }

      if (typeof chunk === "string") {
        if (chunk.length > 0) {
          let out = "";
          let start = 0;
          for (let i = 0; i < chunk.length; i++) {
            if (chunk.charCodeAt(i) === 10) { // '\n'
              const prevIsCR = i === 0 ? lastEndedWithCR : chunk.charCodeAt(i - 1) === 13;
              if (!prevIsCR) {
                out += chunk.slice(start, i) + "\r\n";
                start = i + 1;
              }
            }
          }
          if (start > 0) {
            out += chunk.slice(start);
            chunk = out;
          }
          lastEndedWithCR = chunk.charCodeAt(chunk.length - 1) === 13;
        }
      } else if (chunk instanceof Uint8Array) {
        if (chunk.length > 0) {
          let insertCount = 0;
          for (let i = 0; i < chunk.length; i++) {
            if (chunk[i] === 10) {
              const prevIsCR = i === 0 ? lastEndedWithCR : chunk[i - 1] === 13;
              if (!prevIsCR) insertCount++;
            }
          }
          if (insertCount > 0) {
            const out = Buffer.allocUnsafe(chunk.length + insertCount);
            let pos = 0;
            for (let i = 0; i < chunk.length; i++) {
              if (chunk[i] === 10) {
                const prevIsCR = i === 0 ? lastEndedWithCR : chunk[i - 1] === 13;
                if (!prevIsCR) {
                  out[pos++] = 13;
                }
              }
              out[pos++] = chunk[i];
            }
            lastEndedWithCR = out[out.length - 1] === 13;
            chunk = out;
          } else {
            lastEndedWithCR = chunk[chunk.length - 1] === 13;
          }
        }
      }

      return origWrite(chunk, encoding, cb);
    };
  };

  patchStream(process.stdout);
  patchStream(process.stderr);

  // Bun では console.log / console.error 等が process.stdout.write を経由せず直接ネイティブ出力するため、
  // console 系メソッドも stream.write 経由に統一して確実に '\r\n' 化する
  if (!(console as any)[CONSOLE_PATCHED_KEY]) {
    (console as any)[CONSOLE_PATCHED_KEY] = true;
    const makeLogger = (stream: NodeJS.WriteStream) => (...args: any[]) => {
      const msg = args.length === 0 ? "" : util.format(...args);
      stream.write(msg + "\n");
    };
    console.log = makeLogger(process.stdout);
    console.info = makeLogger(process.stdout);
    console.debug = makeLogger(process.stdout);
    console.warn = makeLogger(process.stderr);
    console.error = makeLogger(process.stderr);
  }
}

/**
 * ターミナル幅を動的に取得し、環境変数 COLUMNS も考慮する共通ヘルパー
 */
export function getTermWidth(defaultWidth = 60, minWidth = 36, maxWidth = 80): number {
  const envCols = process.env.COLUMNS ? parseInt(process.env.COLUMNS, 10) : undefined;
  const cols = process.stdout.columns || envCols;
  if (!cols || isNaN(cols) || cols <= 0) return defaultWidth;
  return Math.max(minWidth, Math.min(cols, maxWidth));
}

export function hr(char = "-", pad = 0): string {
  const width = Math.max(10, getTermWidth() - pad);
  return char.repeat(width);
}
