import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const syncStatePath = path.join(projectRoot, ".oj_wsl_sync.json");

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
};

/**
 * WSL / Linux 内で動作する超軽量ネイティブ C++ テストランナー (oj_runner.cpp)
 * 外部依存ゼロ (POSIX 標準のみ)、マイクロ秒精度計測、SIGKILL タイムアウト制御、Base64 安全出力
 */
const OJ_RUNNER_CPP = `#include <iostream>
#include <vector>
#include <string>
#include <chrono>
#include <unistd.h>
#include <sys/wait.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <cstring>

static const char B64_TABLE[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

std::string to_base64(const std::string& in) {
    if (in.empty()) return "-";
    std::string out;
    out.reserve(((in.size() + 2) / 3) * 4);
    int val = 0, valb = -6;
    for (unsigned char c : in) {
        val = (val << 8) + c;
        valb += 8;
        while (valb >= 0) {
            out.push_back(B64_TABLE[(val >> valb) & 0x3F]);
            valb -= 6;
        }
    }
    if (valb > -6) out.push_back(B64_TABLE[((val << 8) >> (valb + 8)) & 0x3F]);
    while (out.size() % 4) out.push_back('=');
    return out;
}

void set_nonblocking(int fd) {
    int flags = fcntl(fd, F_GETFL, 0);
    if (flags != -1) fcntl(fd, F_SETFL, flags | O_NONBLOCK);
}

void drain_fd(int fd, std::string& buf) {
    char tmp[8192];
    while (true) {
        ssize_t n = read(fd, tmp, sizeof(tmp));
        if (n > 0) buf.append(tmp, n);
        else break;
    }
}

int main(int argc, char* argv[]) {
    if (argc < 4) return 1;
    const char* exe_path = argv[1];
    long time_limit_ms = std::stol(argv[2]);

    for (int i = 3; i < argc; ++i) {
        const char* in_file = argv[i];
        int case_num = i - 2;

        int out_pipe[2], err_pipe[2];
        if (pipe(out_pipe) != 0 || pipe(err_pipe) != 0) return 1;

        auto start_time = std::chrono::steady_clock::now();
        pid_t pid = fork();

        if (pid == 0) {
            int in_fd = open(in_file, O_RDONLY);
            if (in_fd >= 0) {
                dup2(in_fd, STDIN_FILENO);
                close(in_fd);
            }
            dup2(out_pipe[1], STDOUT_FILENO);
            dup2(err_pipe[1], STDERR_FILENO);
            close(out_pipe[0]); close(out_pipe[1]);
            close(err_pipe[0]); close(err_pipe[1]);
            execl(exe_path, exe_path, nullptr);
            _exit(127);
        }

        close(out_pipe[1]);
        close(err_pipe[1]);
        set_nonblocking(out_pipe[0]);
        set_nonblocking(err_pipe[0]);

        std::string stdout_str, stderr_str;
        bool is_tle = false;
        int status = 0;
        bool child_done = false;

        struct pollfd fds[2];
        fds[0].fd = out_pipe[0]; fds[0].events = POLLIN;
        fds[1].fd = err_pipe[0]; fds[1].events = POLLIN;

        while (!child_done) {
            auto now = std::chrono::steady_clock::now();
            long elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(now - start_time).count();
            if (elapsed > time_limit_ms) {
                is_tle = true;
                kill(pid, SIGKILL);
                waitpid(pid, &status, 0);
                break;
            }
            long remain = time_limit_ms - elapsed + 5;
            if (remain > 10) remain = 10;
            poll(fds, 2, remain);
            drain_fd(out_pipe[0], stdout_str);
            drain_fd(err_pipe[0], stderr_str);

            pid_t w = waitpid(pid, &status, WNOHANG);
            if (w == pid || w == -1) {
                child_done = true;
            }
        }

        auto end_time = std::chrono::steady_clock::now();
        double elapsed_ms = std::chrono::duration<double, std::milli>(end_time - start_time).count();

        drain_fd(out_pipe[0], stdout_str);
        drain_fd(err_pipe[0], stderr_str);
        close(out_pipe[0]);
        close(err_pipe[0]);

        std::string res_status = "OK";
        int exit_code = 0;
        if (is_tle) {
            res_status = "TLE";
            elapsed_ms = (double)time_limit_ms;
        } else if (WIFEXITED(status)) {
            exit_code = WEXITSTATUS(status);
            if (exit_code != 0) res_status = "RE";
        } else if (WIFSIGNALED(status)) {
            exit_code = 128 + WTERMSIG(status);
            res_status = "RE";
        }

        std::cout << "CASE_RESULT " << case_num << " " << res_status << " "
                  << exit_code << " " << elapsed_ms << " "
                  << to_base64(stdout_str) << " " << to_base64(stderr_str) << "\\n";
        std::cout.flush();
    }
    return 0;
}
`;

export interface LibFileEntry {
  relPath: string;
  mtimeMs: number;
  size: number;
  hash: string;
  contentB64?: string;
}

interface SyncState {
  libFiles: Record<string, { mtimeMs: number; size: number; hash: string }>;
}

function loadSyncState(): SyncState {
  if (fs.existsSync(syncStatePath)) {
    try {
      return JSON.parse(fs.readFileSync(syncStatePath, "utf8")) as SyncState;
    } catch {}
  }
  return { libFiles: {} };
}

function saveSyncState(state: SyncState): void {
  try {
    fs.writeFileSync(syncStatePath, JSON.stringify(state, null, 2), "utf8");
  } catch {}
}

/**
 * lib/ ディレクトリ内の全ファイルを走査し、前回同期時からの差分 (追加・変更・削除) と全体ハッシュを計算
 */
export function computeLibDelta(forceAll = false): {
  changed: { relPath: string; contentB64: string }[];
  deleted: string[];
  combinedLibHash: string;
  newState: SyncState;
} {
  const prevState = forceAll ? { libFiles: {} } : loadSyncState();
  const newState: SyncState = { libFiles: {} };
  const changed: { relPath: string; contentB64: string }[] = [];
  const deleted: string[] = [];

  const libDir = path.join(projectRoot, "lib");
  const hashBuilder = crypto.createHash("sha1");

  function walkDir(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.isFile() && /\.(cpp|hpp|h|c|cc)$/i.test(entry.name)) {
        const relPath = path.relative(libDir, fullPath).replace(/\\/g, "/");
        const stat = fs.statSync(fullPath);
        const prev = prevState.libFiles[relPath];

        let fileHash = "";
        let buf: Buffer | null = null;

        if (!forceAll && prev && prev.mtimeMs === stat.mtimeMs && prev.size === stat.size && prev.hash) {
          fileHash = prev.hash;
        } else {
          buf = fs.readFileSync(fullPath);
          fileHash = crypto.createHash("sha1").update(buf).digest("hex");
          if (forceAll || !prev || prev.hash !== fileHash) {
            changed.push({
              relPath,
              contentB64: buf.toString("base64"),
            });
          }
        }

        newState.libFiles[relPath] = {
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          hash: fileHash,
        };
        hashBuilder.update(`${relPath}:${fileHash};`);
      }
    }
  }

  walkDir(libDir);

  for (const oldRel of Object.keys(prevState.libFiles)) {
    if (!newState.libFiles[oldRel]) {
      deleted.push(oldRel);
    }
  }

  return {
    changed,
    deleted,
    combinedLibHash: hashBuilder.digest("hex"),
    newState,
  };
}

/**
 * 実行環境 (Windows+WSL または Native Linux) で bash スクリプトを実行する汎用ヘルパー
 */
function runLinuxBash(script: string, stdinInput?: string): { status: number | null; stdout: string; stderr: string } {
  const isLinux = process.platform === "linux";
  const cleanScript = script.replace(/\r\n/g, "\n");
  const cleanStdin = stdinInput ? stdinInput.replace(/\r\n/g, "\n") : undefined;
  const cmd = isLinux ? "bash" : "wsl.exe";
  const args = isLinux ? ["-c", cleanScript] : ["-e", "bash", "-c", cleanScript];

  const res = spawnSync(cmd, args, {
    input: cleanStdin,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  return {
    status: res.status,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
  };
}

/**
 * WSL (またはネイティブ Linux) の g++ 環境が利用可能かチェック
 */
export function isWslOrLinuxAvailable(): boolean {
  if (process.env.OJ_NO_WSL === "1") return false;
  if (process.platform !== "win32" && process.platform !== "linux") return false;

  try {
    const res = runLinuxBash("command -v g++ >/dev/null 2>&1 && echo OK");
    return res.status === 0 && res.stdout.includes("OK");
  } catch {
    return false;
  }
}

/**
 * `bun run setup` / `oj setup` 時に呼び出される WSL / Linux 永続マスター環境の構築関数
 * - 普段の PC メモリを一切圧迫しないよう、セットアップ時は永続ディスク領域 ($HOME/.cache/oj-cp) のみに配置し、
 *   /dev/shm (RAMディスク) には常駐させません（テスト実行中の一時領域としてのみ使用し即座に解放）。
 */
export function setupWslHybridEnv(remove = false): boolean {
  if (process.platform !== "win32" && process.platform !== "linux") return false;
  if (!isWslOrLinuxAvailable()) return false;

  const envLabel = process.platform === "win32" ? "WSL2 (Linux)" : "Linux";

  if (remove) {
    const cleanScript = `
rm -rf "$HOME/.cache/oj-cp" /dev/shm/oj-* /tmp/oj-* 2>/dev/null || true
for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
  if [ -f "$rc" ]; then
    sed -i '/# >>> oj-workspace dynamic-runner >>>/,/# <<< oj-workspace dynamic-runner <<</d' "$rc" 2>/dev/null || true
  fi
done
`;
    runLinuxBash(cleanScript);
    if (fs.existsSync(syncStatePath)) {
      try { fs.unlinkSync(syncStatePath); } catch {}
    }
    console.log(`  ✅ ${envLabel} キャッシュ環境をクリーンアップ`);
    return true;
  }

  console.log(`  ⏳ ${envLabel} 永続マスター環境 (${c.cyan}$HOME/.cache/oj-cp${c.reset}) を構築中 (RAM常駐ゼロ)...`);

  const posixRcBlock = `
# >>> oj-workspace dynamic-runner >>>
if [ -d "$HOME/.bun/bin" ]; then
  case ":$PATH:" in
    *":$HOME/.bun/bin:"*) ;;
    *) export PATH="$HOME/.bun/bin:$PATH" ;;
  esac
fi
oj() {
  local curr="$PWD"
  while [ -n "$curr" ] && [ "$curr" != "/" ]; do
    if [ -f "$curr/bin/oj.ts" ]; then
      if command -v bun >/dev/null 2>&1; then
        bun "$curr/bin/oj.ts" "$@"
      elif [ -x "$HOME/.bun/bin/bun" ]; then
        "$HOME/.bun/bin/bun" "$curr/bin/oj.ts" "$@"
      else
        echo "[oj] Error: bun runtime not found." >&2
        return 1
      fi
      return $?
    fi
    curr="$(dirname "$curr")"
  done
  echo "[oj] Error: 'oj' command can only be run inside the project directory." >&2
  return 1
}
# <<< oj-workspace dynamic-runner <<<
`.replace(/\r\n/g, "\n");
  const rcBlockB64 = Buffer.from(posixRcBlock, "utf8").toString("base64");

  const runnerB64 = Buffer.from(OJ_RUNNER_CPP.replace(/\r\n/g, "\n"), "utf8").toString("base64");
  const { changed, newState } = computeLibDelta(true);

  const syncLines: string[] = [];
  syncLines.push(`RUNNER ${runnerB64}`);
  for (const item of changed) {
    syncLines.push(`LIB ${item.relPath} ${item.contentB64}`);
  }
  syncLines.push("END");

  const setupBashScript = `
set -e
CACHE_DIR="$HOME/.cache/oj-cp"

# 過去の /dev/shm 常駐ファイルがあれば解放してメモリを空ける
rm -rf /dev/shm/oj-cp* /dev/shm/pch /dev/shm/bench_pch /dev/shm/err.log /dev/shm/CompetitiveProgramming-build /dev/shm/APG4b-build 2>/dev/null || true

mkdir -p "$CACHE_DIR/pch/bits" "$CACHE_DIR/bin" "$CACHE_DIR/lib" "$CACHE_DIR/work"

while IFS=' ' read -r cmd arg1 arg2; do
  case "$cmd" in
    RUNNER)
      printf '%s' "$arg1" | base64 -d > "$CACHE_DIR/bin/oj_runner.cpp"
      ;;
    LIB)
      rel_dir="$(dirname "$arg1")"
      mkdir -p "$CACHE_DIR/lib/$rel_dir"
      printf '%s' "$arg2" | base64 -d > "$CACHE_DIR/lib/$arg1"
      ;;
    END)
      break
      ;;
  esac
done

# 1. ネイティブ C++ テストランナーのビルド (未ビルドまたは更新時)
if [ ! -x "$CACHE_DIR/bin/oj_runner" ] || ! cmp -s "$CACHE_DIR/bin/oj_runner.cpp" "$CACHE_DIR/bin/oj_runner.cpp.built" 2>/dev/null; then
  g++ -O2 "$CACHE_DIR/bin/oj_runner.cpp" -o "$CACHE_DIR/bin/oj_runner"
  cp "$CACHE_DIR/bin/oj_runner.cpp" "$CACHE_DIR/bin/oj_runner.cpp.built"
  echo "BUILT_RUNNER"
fi

# 2. C++ 標準の自動判定 (-std=c++23 または -std=c++2b)
STD_FLAG="-std=c++23"
if ! g++ $STD_FLAG -x c++ -E /dev/null >/dev/null 2>&1; then
  STD_FLAG="-std=c++2b"
fi
CXX_FLAGS="$STD_FLAG -O2 -fno-exceptions -fno-rtti"
COMPILER_SIG="$(g++ --version | head -n 1) | $CXX_FLAGS"

# 3. <bits/stdc++.h> の動的探索と永続 PCH ビルド (ディスク上の $HOME/.cache/oj-cp にのみ保存)
if [ ! -f "$CACHE_DIR/pch/bits/stdc++.h.gch" ] || [ "$(cat "$CACHE_DIR/pch/sig.txt" 2>/dev/null)" != "$COMPILER_SIG" ]; then
  STDC_PATH="$(echo '#include <bits/stdc++.h>' | g++ -x c++ -E -M - 2>/dev/null | tr ' \\\\' '\\n' | grep 'bits/stdc++.h$' | head -n 1)"
  if [ -n "$STDC_PATH" ] && [ -f "$STDC_PATH" ]; then
    cp "$STDC_PATH" "$CACHE_DIR/pch/bits/stdc++.h"
    g++ $CXX_FLAGS -x c++-header "$CACHE_DIR/pch/bits/stdc++.h" -o "$CACHE_DIR/pch/bits/stdc++.h.gch"
    printf '%s' "$COMPILER_SIG" > "$CACHE_DIR/pch/sig.txt"
    printf '%s' "$CXX_FLAGS" > "$CACHE_DIR/pch/flags.txt"
    echo "BUILT_PCH"
  fi
fi

# 4. WSL 側の ~/.bashrc 等にも動的 oj ディスパッチャを登録 (個人パス一切なし)
for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
  if [ -f "$rc" ] || [ "$rc" = "$HOME/.bashrc" ]; then
    sed -i '/# >>> oj-workspace auto-activate >>>/,/# <<< oj-workspace auto-activate <<</d' "$rc" 2>/dev/null || true
    sed -i '/# >>> oj-workspace dynamic-runner >>>/,/# <<< oj-workspace dynamic-runner <<</d' "$rc" 2>/dev/null || true
    printf '%s' '${rcBlockB64}' | base64 -d >> "$rc"
  fi
done
echo "SETUP_OK"
`;

  const res = runLinuxBash(setupBashScript, syncLines.join("\n") + "\n");
  if (res.status === 0 && res.stdout.includes("SETUP_OK")) {
    saveSyncState(newState);
    const builtPch = res.stdout.includes("BUILT_PCH");
    console.log(
      `  ✅ ${envLabel} 永続マスター (${c.cyan}$HOME/.cache/oj-cp${c.reset}): ${
        builtPch ? "PCH (<bits/stdc++.h>.gch) 新規生成完了" : "PCH キャッシュ確認済み (再ビルド不要)"
      }`
    );
    console.log(`  ✅ ${envLabel} ライブラリ差分同期完了 (${changed.length} files / アイドル時 RAM 消費 0 MB)`);
    return true;
  } else {
    console.log(`  ⚠️ ${envLabel} セットアップをスキップしました: ${res.stderr.trim()}`);
    return false;
  }
}

export interface WslCaseInput {
  caseNum: number;
  input: string;
  expected: string;
}

export interface WslCaseOutput {
  caseNum: number;
  status: "AC" | "WA" | "TLE" | "RE";
  exitCode: number;
  elapsedMs: number;
  input: string;
  expected: string;
  actual: string;
  stderr: string;
}

export interface WslTestRunSummary {
  usedWsl: boolean;
  mountedFromHomeCache: boolean;
  syncedLibCount: number;
  needsBuild: boolean;
  buildDurationMs: number;
  buildError?: string;
  results: WslCaseOutput[];
}

/**
 * Windows (または Linux) から差分のみを転送し、WSL の /dev/shm (RAMディスク) 上で
 * コンパイル〜全テストケース実行までを 1 回のプロセス呼び出しで完結させる高速エンジン
 */
export function runTestViaWslHybrid(
  targetName: string,
  srcFile: string,
  timeLimitMs: number,
  cases: WslCaseInput[]
): WslTestRunSummary | null {
  if (!isWslOrLinuxAvailable()) return null;

  const srcBuf = fs.readFileSync(srcFile);
  const srcB64 = srcBuf.toString("base64");
  const { changed, deleted, combinedLibHash, newState } = computeLibDelta(false);

  const fullHash = crypto
    .createHash("sha1")
    .update(srcBuf)
    .update("|")
    .update(combinedLibHash)
    .digest("hex");

  const stdinLines: string[] = [];
  stdinLines.push(`TARGET ${targetName}`);
  stdinLines.push(`HASH ${fullHash}`);
  stdinLines.push(`TIMELIMIT ${timeLimitMs}`);
  stdinLines.push(`SRC ${srcB64}`);

  for (const item of changed) {
    stdinLines.push(`LIB ${item.relPath} ${item.contentB64}`);
  }
  for (const delPath of deleted) {
    stdinLines.push(`LIB_DEL ${delPath}`);
  }
  for (const cItem of cases) {
    const inB64 = Buffer.from(cItem.input, "utf8").toString("base64") || "-";
    stdinLines.push(`CASE ${cItem.caseNum} ${inB64}`);
  }
  stdinLines.push("END");

  const runnerFallbackB64 = Buffer.from(OJ_RUNNER_CPP.replace(/\r\n/g, "\n"), "utf8").toString("base64");

  const execBashScript = `
set -e
CACHE_DIR="$HOME/.cache/oj-cp"
SHM_BASE="/dev/shm"
[ -d "$SHM_BASE" ] && [ -w "$SHM_BASE" ] || SHM_BASE="/tmp"
RUN_DIR="$SHM_BASE/oj-run-$$"

# テスト終了時に必ず /dev/shm の一時領域を完全削除し、PCのメモリ(RAM)を即座に解放する
trap 'rm -rf "$RUN_DIR" /dev/shm/oj-cp* /dev/shm/pch /dev/shm/bench_pch /dev/shm/err.log 2>/dev/null || true' EXIT
mkdir -p "$RUN_DIR" "$CACHE_DIR/work"

# 1. 永続マスター ($HOME/.cache/oj-cp) が未初期化の場合のセルフヒール
if [ ! -x "$CACHE_DIR/bin/oj_runner" ]; then
  mkdir -p "$CACHE_DIR/pch/bits" "$CACHE_DIR/bin" "$CACHE_DIR/lib"
  printf '%s' '${runnerFallbackB64}' | base64 -d > "$CACHE_DIR/bin/oj_runner.cpp"
  g++ -O2 "$CACHE_DIR/bin/oj_runner.cpp" -o "$CACHE_DIR/bin/oj_runner"
fi

if [ ! -f "$CACHE_DIR/pch/bits/stdc++.h.gch" ]; then
  STD_FLAG="-std=c++23"
  if ! g++ $STD_FLAG -x c++ -E /dev/null >/dev/null 2>&1; then STD_FLAG="-std=c++2b"; fi
  CXX_FLAGS="$STD_FLAG -O2 -fno-exceptions -fno-rtti"
  STDC_PATH="$(echo '#include <bits/stdc++.h>' | g++ -x c++ -E -M - 2>/dev/null | tr ' \\\\' '\\n' | grep 'bits/stdc++.h$' | head -n 1)"
  if [ -n "$STDC_PATH" ] && [ -f "$STDC_PATH" ]; then
    cp "$STDC_PATH" "$CACHE_DIR/pch/bits/stdc++.h"
    g++ $CXX_FLAGS -x c++-header "$CACHE_DIR/pch/bits/stdc++.h" -o "$CACHE_DIR/pch/bits/stdc++.h.gch"
    printf '%s' "$CXX_FLAGS" > "$CACHE_DIR/pch/flags.txt"
  fi
fi

TARGET=""
HASH=""
TIMELIMIT=2000
CASE_FILES=""

while IFS=' ' read -r cmd arg1 arg2; do
  case "$cmd" in
    TARGET)
      TARGET="$arg1"
      mkdir -p "$CACHE_DIR/work/$TARGET"
      ;;
    HASH)
      HASH="$arg1"
      ;;
    TIMELIMIT)
      TIMELIMIT="$arg1"
      ;;
    SRC)
      printf '%s' "$arg1" | base64 -d > "$RUN_DIR/main.cpp"
      ;;
    LIB)
      rel_dir="$(dirname "$arg1")"
      mkdir -p "$CACHE_DIR/lib/$rel_dir"
      printf '%s' "$arg2" | base64 -d > "$CACHE_DIR/lib/$arg1"
      ;;
    LIB_DEL)
      rm -f "$CACHE_DIR/lib/$arg1"
      ;;
    CASE)
      in_path="$RUN_DIR/in_$arg1.txt"
      if [ "$arg2" = "-" ]; then
        : > "$in_path"
      else
        printf '%s' "$arg2" | base64 -d > "$in_path"
      fi
      CASE_FILES="$CASE_FILES $in_path"
      ;;
    END)
      break
      ;;
  esac
done

PERSIST_BIN="$CACHE_DIR/work/$TARGET/a.out"
HASH_PATH="$CACHE_DIR/work/$TARGET/build.hash"
RUN_BIN="$RUN_DIR/a.out"

# 2. 差分ハッシュ比較によるビルド判定 (実行中だけ /dev/shm を使い、完了後は自動破棄)
if [ -x "$PERSIST_BIN" ] && [ "$(cat "$HASH_PATH" 2>/dev/null)" = "$HASH" ]; then
  cp "$PERSIST_BIN" "$RUN_BIN"
  echo "BUILD_SKIP 0"
else
  CXX_FLAGS="$(cat "$CACHE_DIR/pch/flags.txt" 2>/dev/null || echo '-std=c++23 -O2 -fno-exceptions -fno-rtti')"
  LD_FLAG=""
  if command -v mold >/dev/null 2>&1; then
    LD_FLAG="-fuse-ld=mold"
  elif command -v ld.lld >/dev/null 2>&1; then
    LD_FLAG="-fuse-ld=lld"
  fi

  T0=$(date +%s%3N)
  set +e
  ERR_OUT=$(g++ $CXX_FLAGS $LD_FLAG -I"$CACHE_DIR/pch" -I"$CACHE_DIR/lib" "$RUN_DIR/main.cpp" -o "$RUN_BIN" 2>&1)
  BUILD_RC=$?
  set -e
  T1=$(date +%s%3N)
  BUILD_MS=$((T1 - T0))

  if [ $BUILD_RC -ne 0 ]; then
    ERR_B64=$(printf '%s' "$ERR_OUT" | base64 | tr -d '\\n')
    echo "BUILD_ERROR $ERR_B64"
    exit 0
  fi

  cp "$RUN_BIN" "$PERSIST_BIN"
  printf '%s' "$HASH" > "$HASH_PATH"
  echo "BUILD_OK $BUILD_MS"

  # work/ 内に古い問題のバイナリが溜まらないよう、直近 5 件以外の古いキャッシュフォルダを自動削除
  ls -1dt "$CACHE_DIR/work"/* 2>/dev/null | tail -n +6 | xargs rm -rf 2>/dev/null || true
fi

# 3. 実行中の一時 RAM 領域上で全テストケースを一括ネイティブ実行 (終了時に trap で自動削除)
"$CACHE_DIR/bin/oj_runner" "$RUN_BIN" "$TIMELIMIT" $CASE_FILES
`;

  const res = runLinuxBash(execBashScript, stdinLines.join("\n") + "\n");
  if (res.status !== 0 && !res.stdout.includes("BUILD_")) {
    return null;
  }

  saveSyncState(newState);

  let mountedFromHomeCache = false;
  let needsBuild = true;
  let buildDurationMs = 0;
  let buildError: string | undefined;
  const results: WslCaseOutput[] = [];

  const caseMap = new Map<number, WslCaseInput>();
  for (const cItem of cases) caseMap.set(cItem.caseNum, cItem);

  for (const rawLine of res.stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line === "MOUNTED_FROM_HOME") {
      mountedFromHomeCache = true;
    } else if (line.startsWith("BUILD_SKIP")) {
      needsBuild = false;
      buildDurationMs = 0;
    } else if (line.startsWith("BUILD_OK ")) {
      needsBuild = true;
      buildDurationMs = parseInt(line.split(" ")[1] || "0", 10);
    } else if (line.startsWith("BUILD_ERROR ")) {
      needsBuild = true;
      const b64 = line.slice("BUILD_ERROR ".length).trim();
      buildError = b64 ? Buffer.from(b64, "base64").toString("utf8") : "Unknown compiler error";
      return {
        usedWsl: true,
        mountedFromHomeCache,
        syncedLibCount: changed.length + deleted.length,
        needsBuild,
        buildDurationMs,
        buildError,
        results: [],
      };
    } else if (line.startsWith("CASE_RESULT ")) {
      const parts = line.split(" ");
      const caseNum = parseInt(parts[1], 10);
      const rawStatus = parts[2];
      const exitCode = parseInt(parts[3], 10);
      const elapsedMs = parseFloat(parts[4]);
      const stdoutB64 = parts[5];
      const stderrB64 = parts[6];

      const actual = stdoutB64 && stdoutB64 !== "-" ? Buffer.from(stdoutB64, "base64").toString("utf8") : "";
      const stderr = stderrB64 && stderrB64 !== "-" ? Buffer.from(stderrB64, "base64").toString("utf8") : "";
      const orig = caseMap.get(caseNum) || { caseNum, input: "", expected: "" };

      let finalStatus: "AC" | "WA" | "TLE" | "RE" = "AC";
      if (rawStatus === "TLE") {
        finalStatus = "TLE";
      } else if (rawStatus === "RE" || exitCode !== 0) {
        finalStatus = "RE";
      } else {
        const normExpected = orig.expected
          .split(/\r?\n/)
          .map((l) => l.trimEnd())
          .join("\n")
          .trim();
        const normActual = actual
          .split(/\r?\n/)
          .map((l) => l.trimEnd())
          .join("\n")
          .trim();
        finalStatus = normExpected === normActual ? "AC" : "WA";
      }

      results.push({
        caseNum,
        status: finalStatus,
        exitCode,
        elapsedMs,
        input: orig.input,
        expected: orig.expected,
        actual,
        stderr,
      });
    }
  }

  return {
    usedWsl: true,
    mountedFromHomeCache,
    syncedLibCount: changed.length + deleted.length,
    needsBuild,
    buildDurationMs,
    results,
  };
}
