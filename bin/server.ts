import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import crypto from "node:crypto";
import { spawnSync, spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  isWslOrLinuxAvailable,
  computeLibDelta,
  saveSyncState,
  buildWslSelfHealScript,
} from "./wsl_bridge.ts";
import { installWindowsNewlineFix, getTermWidth, hr } from "./tty_fix.ts";

installWindowsNewlineFix();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

export const DEFAULT_PORT = (() => {
  const parsed = parseInt(process.env.OJ_SERVER_PORT || "3721", 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 65535 ? parsed : 3721;
})();

const SAFE_PROGRAM_ID_RE = /^[a-zA-Z0-9_-]+$/;
const SIGNAL_NUMBERS: Record<string, number> = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGQUIT: 3,
  SIGILL: 4,
  SIGTRAP: 5,
  SIGABRT: 6,
  SIGBUS: 7,
  SIGFPE: 8,
  SIGKILL: 9,
  SIGUSR1: 10,
  SIGSEGV: 11,
  SIGUSR2: 12,
  SIGPIPE: 13,
  SIGALRM: 14,
  SIGTERM: 15,
};

export interface ServerInstance {
  port: number;
  stop: (reason?: string) => void | Promise<void>;
  onStop?: (reason: string) => void;
}

export interface PreparedProgram {
  id: string;
  sourceHash: string;
  sourceCode: string;
  createdAt: number;
  lastUsedAt: number;
  backend: "wsl" | "native";
  isWsl: boolean;
  localBinPath?: string;
  localDirPath?: string;
  prepWallMs?: number;
  preRunReportedForBatch?: boolean;
  lastRunActivityPerfMs?: number;
}

export interface RunResult {
  status: "success" | "timeLimitExceeded" | "runtimeError" | "internalError" | "badRequest";
  exitCode: number;
  time: number;
  memory: number;
  stdout: string;
  stderr: string;
}

type InternalRunResult = RunResult & { stale?: boolean; preExecWaitMs?: number };

export const preparedCache = new Map<string, PreparedProgram>();
const nativeWarmupPromises = new Map<string, Promise<void>>();

function cleanupOldPrograms() {
  const now = Date.now();
  const maxAgeMs = 30 * 60 * 1000; // 30分保持
  const expiredWslIds: string[] = [];

  for (const [id, prog] of preparedCache.entries()) {
    const lastActive = prog.lastUsedAt || prog.createdAt;
    if (now - lastActive > maxAgeMs) {
      if (prog.localBinPath) {
        nativeWarmupPromises.delete(prog.localBinPath);
      }
      if (prog.localDirPath && fs.existsSync(prog.localDirPath)) {
        try {
          fs.rmSync(prog.localDirPath, { recursive: true, force: true });
        } catch {}
      } else if (prog.localBinPath && fs.existsSync(prog.localBinPath)) {
        try {
          fs.unlinkSync(prog.localBinPath);
        } catch {}
      }
      if (prog.isWsl && SAFE_PROGRAM_ID_RE.test(id)) {
        expiredWslIds.push(id);
      }
      preparedCache.delete(id);
    }
  }

  if (expiredWslIds.length > 0 && isWslOrLinuxAvailable()) {
    if (persistentWorker.isReady) {
      for (const id of expiredWslIds) {
        persistentWorker.cleanProgram(id).catch(() => {});
      }
    } else {
      const rmTargets = expiredWslIds.map((id) => `"$HOME/.cache/oj-cp/programs/${id}"`).join(" ");
      runLinuxBashAsync(`rm -rf ${rmTargets} 2>/dev/null || true`, undefined, 5000).catch(() => {});
    }
  }
}

/**
 * WSL / Linux で非同期に bash スクリプトを実行する汎用ヘルパー (イベントループ非ブロック)
 */
async function runLinuxBashAsync(
  script: string,
  stdinInput?: string,
  timeoutMs = 60000
): Promise<{ status: number | null; stdout: string; stderr: string; timedOut?: boolean; error?: string }> {
  const isLinux = process.platform === "linux";
  const cleanScript = script.replace(/\r\n/g, "\n");
  const cmd = isLinux ? "bash" : "wsl.exe";
  const args = isLinux ? ["-c", cleanScript] : ["-e", "bash", "-c", cleanScript];

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const proc = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill("SIGKILL");
      } catch {}
    }, timeoutMs);

    const finish = (status: number | null, error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status, stdout, stderr, timedOut, error });
    };

    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => {
      if (stdout.length < 64 * 1024 * 1024) stdout += chunk;
    });
    proc.stderr.on("data", (chunk: string) => {
      if (stderr.length < 8 * 1024 * 1024) stderr += chunk;
    });

    proc.stdin.on("error", () => {});
    if (stdinInput !== undefined) {
      proc.stdin.end(stdinInput.replace(/\r\n/g, "\n"));
    } else {
      proc.stdin.end();
    }

    proc.on("error", (err) => {
      finish(null, err.message);
    });
    proc.on("close", (code) => {
      finish(code);
    });
  });
}

/**
 * oj_runner が使えない場合の安全なフォールバック実行スクリプト断片
 * 一時ファイル + base64 経由で末尾の改行 (\n) と終了コード・タイムアウトを欠落させず取得する
 */
function buildWslFallbackRunnerBash(tagPrefix: string, idExpr: string, timeLimitExpr: string): string {
  return `TL_SEC="$(LC_ALL=C awk "BEGIN { printf \\"%.3f\\", ${timeLimitExpr} / 1000 }" 2>/dev/null || echo $(( (${timeLimitExpr} + 999) / 1000 )))"
OUT_TMP="$PROG_DIR/stdout.$$.txt"
ERR_TMP="$PROG_DIR/stderr.$$.txt"
T0=$(date +%s%3N)
if command -v timeout >/dev/null 2>&1; then
  timeout -k 0.1s "\${TL_SEC}s" "$BIN_PATH" < "$IN_FILE" >"$OUT_TMP" 2>"$ERR_TMP"
  RC=$?
else
  "$BIN_PATH" < "$IN_FILE" >"$OUT_TMP" 2>"$ERR_TMP"
  RC=$?
fi
T1=$(date +%s%3N)
ELAPSED=$((T1 - T0))
R_STAT="OK"
if [ $RC -eq 124 ] || { [ $RC -eq 137 ] && [ $ELAPSED -ge ${timeLimitExpr} ]; }; then
  R_STAT="TLE"
  ELAPSED=${timeLimitExpr}
elif [ $RC -ne 0 ]; then
  R_STAT="RE"
fi
OUT_B64=$(base64 < "$OUT_TMP" 2>/dev/null | tr -d '\\n')
[ -z "$OUT_B64" ] && OUT_B64="-"
ERR_B64=$(base64 < "$ERR_TMP" 2>/dev/null | tr -d '\\n')
[ -z "$ERR_B64" ] && ERR_B64="-"
rm -f "$OUT_TMP" "$ERR_TMP" 2>/dev/null || true
echo "${tagPrefix} ${idExpr} $R_STAT $RC $ELAPSED $OUT_B64 $ERR_B64"`;
}

/**
 * RUN_RESULT / CASE_RESULT 行を統一 RunResult スキーマへパースする共通ヘルパー
 */
function parseRunnerResultLine(
  line: string,
  expectedTag: "RUN_RESULT" | "CASE_RESULT" | "ANY_RESULT",
  programId: string
): InternalRunResult {
  const parts = line.split(" ");
  const tagMatches =
    expectedTag === "ANY_RESULT"
      ? parts[0] === "RUN_RESULT" || parts[0] === "CASE_RESULT"
      : parts[0] === expectedTag;
  if (!tagMatches || parts.length < 7) {
    return {
      status: "internalError",
      exitCode: 1,
      time: 0,
      memory: 0,
      stdout: "",
      stderr: "Worker error: " + line,
    };
  }

  const rawStatus = parts[2];
  if (rawStatus === "STALE") {
    return {
      status: "badRequest",
      exitCode: 1,
      time: 0,
      memory: 0,
      stdout: "",
      stderr: `Prepared program is unavailable: ${programId}`,
      stale: true,
    };
  }

  const parsedExit = parseInt(parts[3], 10);
  const parsedTime = parseFloat(parts[4]);
  const outStr = parts[5] && parts[5] !== "-" ? Buffer.from(parts[5], "base64").toString("utf8") : "";
  const errStr = parts[6] && parts[6] !== "-" ? Buffer.from(parts[6], "base64").toString("utf8") : "";

  if (rawStatus !== "OK" && rawStatus !== "TLE" && rawStatus !== "RE") {
    return {
      status: "internalError",
      exitCode: Number.isFinite(parsedExit) && parsedExit !== 0 ? parsedExit : 1,
      time: 0,
      memory: 0,
      stdout: outStr,
      stderr: errStr || `Worker error (${rawStatus || "EMPTY"}): ${line}`,
    };
  }

  const exitCode = Number.isFinite(parsedExit) ? parsedExit : rawStatus === "OK" ? 0 : 1;
  const elapsedMs = Number.isFinite(parsedTime) ? Math.round(parsedTime) : 0;

  let status: "success" | "timeLimitExceeded" | "runtimeError" = "success";
  if (rawStatus === "TLE") {
    status = "timeLimitExceeded";
  } else if (rawStatus === "RE" || exitCode !== 0) {
    status = "runtimeError";
  }

  return {
    status,
    exitCode,
    time: elapsedMs,
    memory: 0,
    stdout: outStr,
    stderr: errStr,
  };
}

interface PendingWorkerCommand {
  resolve: (data: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * WSL2 常駐型パイプランナー (Persistent WSL Worker)
 * サーバー起動中に 1 つの wsl.exe プロセスを開いたままにし、
 * 標準入出力パイプ経由で COMPILE / RUN コマンドをやり取りする。
 * これにより、テストケースごとの wsl.exe 起動オーバーヘッド (約225ms/ケース) を完全にゼロにし、
 * 各ケース 1ms 前後の圧倒的な低遅延 (RAM ディスク /dev/shm 実行) を実現する。
 */
export interface PersistentWslWorkerOptions {
  spawnOverride?: () => ChildProcess;
  shmDirName?: string;
  skipSelfHeal?: boolean;
  cleanupShmOnExit?: boolean;
}

const SERVER_SHM_DIR_NAME = `oj-cp-srv-${process.pid}`;

export class PersistentWslWorker {
  private proc: ChildProcess | null = null;
  private queue: Promise<void> = Promise.resolve();
  private stdoutBuffer = "";
  private stderrTail = "";
  private pendingResolvers: PendingWorkerCommand[] = [];
  private initPromise: Promise<boolean> | null = null;
  private stopped = false;
  private lastInitFailAt = 0;
  private activeCommands = 0;
  private readonly spawnOverride?: () => ChildProcess;
  private readonly shmDirName: string;
  private readonly skipSelfHeal: boolean;
  private readonly cleanupShmOnExit: boolean;
  public lastUsedAt = Date.now();
  public isReady = false;

  constructor(spawnOrOptions?: (() => ChildProcess) | PersistentWslWorkerOptions) {
    if (typeof spawnOrOptions === "function") {
      this.spawnOverride = spawnOrOptions;
      this.shmDirName = SERVER_SHM_DIR_NAME;
      this.skipSelfHeal = false;
      this.cleanupShmOnExit = true;
    } else {
      this.spawnOverride = spawnOrOptions?.spawnOverride;
      const safeShm = (spawnOrOptions?.shmDirName || SERVER_SHM_DIR_NAME).replace(/[^a-zA-Z0-9._-]/g, "_");
      this.shmDirName = safeShm || SERVER_SHM_DIR_NAME;
      this.skipSelfHeal = Boolean(spawnOrOptions?.skipSelfHeal);
      this.cleanupShmOnExit = spawnOrOptions?.cleanupShmOnExit ?? true;
    }
  }

  public hasPending(): boolean {
    return this.activeCommands > 0;
  }

  public getPendingCount(): number {
    return this.activeCommands;
  }

  private rejectAllPending(reason: string) {
    const pending = this.pendingResolvers.splice(0, this.pendingResolvers.length);
    for (const item of pending) {
      clearTimeout(item.timer);
      item.reject(new Error(reason));
    }
  }

  private forceResetWorker(reason: string) {
    const proc = this.proc;
    this.proc = null;
    this.isReady = false;
    this.stdoutBuffer = "";
    this.rejectAllPending(reason);
    if (proc) {
      try {
        proc.kill("SIGKILL");
      } catch {}
    }
  }

  public getLastStderr(): string {
    return this.stderrTail;
  }

  public maybeRestartInBackground(): void {
    if (this.stopped || this.isReady || this.initPromise) return;
    if (Date.now() - this.lastInitFailAt < 5000) return;
    if (!this.spawnOverride && !isWslOrLinuxAvailable()) return;
    this.init().catch(() => {});
  }

  public async waitForReady(timeoutMs = 5000): Promise<boolean> {
    if (this.isReady && this.proc) return true;
    if (this.stopped) return false;
    let initP = this.initPromise;
    if (!initP) {
      if (Date.now() - this.lastInitFailAt < 5000) return false;
      if (!this.spawnOverride && !isWslOrLinuxAvailable()) return false;
      initP = this.init();
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        initP,
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(this.isReady && Boolean(this.proc)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async init(timeoutMs = 12000): Promise<boolean> {
    if (this.isReady && this.proc) return true;
    this.stopped = false;
    if (!this.spawnOverride && !isWslOrLinuxAvailable()) return false;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const selfHealBlock = this.skipSelfHeal
          ? ""
          : buildWslSelfHealScript({
              runnerAlreadyWritten: false,
              checkSourceDiff: false,
              checkCompilerSig: false,
              emitTags: false,
              nonFatal: true,
            });
        const fallbackExecBlock = buildWslFallbackRunnerBash("RUN_RESULT", "$arg1", "$arg2");

        const bashScript = `
set +e
CACHE_DIR="$HOME/.cache/oj-cp"
SHM_BASE="/dev/shm"
[ -d "$SHM_BASE" ] && [ -w "$SHM_BASE" ] || SHM_BASE="/tmp"
SHM_DIR="$SHM_BASE/${this.shmDirName}"
mkdir -p "$SHM_DIR" "$CACHE_DIR/programs"

${selfHealBlock}

CXX_FLAGS=""
[ -r "$CACHE_DIR/pch/flags.txt" ] && IFS= read -r CXX_FLAGS < "$CACHE_DIR/pch/flags.txt"
[ -n "$CXX_FLAGS" ] || CXX_FLAGS="-std=c++23 -O2 -fno-exceptions -fno-rtti"
LD_FLAG=""
if command -v mold >/dev/null 2>&1; then
  LD_FLAG="-fuse-ld=mold"
elif command -v ld.lld >/dev/null 2>&1; then
  LD_FLAG="-fuse-ld=lld"
fi
RUNNER="$CACHE_DIR/bin/oj_runner"
SYNC_ERR=0

echo "WORKER_READY"

while IFS=' ' read -r cmd arg1 arg2 arg3; do
  case "$cmd" in
    LIB_B64)
      rel_path="$(printf '%s' "$arg1" | base64 -d 2>/dev/null)"
      case "$rel_path" in
        ""|/*|*../*|*/..|..) SYNC_ERR=1 ;;
        *)
          rel_dir="$(dirname "$rel_path")"
          mkdir -p "$CACHE_DIR/lib/$rel_dir" && printf '%s' "$arg2" | base64 -d > "$CACHE_DIR/lib/$rel_path" || SYNC_ERR=1
          ;;
      esac
      ;;
    LIB_DEL_B64)
      rel_path="$(printf '%s' "$arg1" | base64 -d 2>/dev/null)"
      case "$rel_path" in
        ""|/*|*../*|*/..|..) ;;
        *) rm -f "$CACHE_DIR/lib/$rel_path" 2>/dev/null || true ;;
      esac
      ;;
    SYNC_DONE)
      if [ $SYNC_ERR -eq 0 ]; then
        echo "SYNC_OK"
      else
        echo "SYNC_FAIL"
      fi
      SYNC_ERR=0
      ;;
    COMPILE)
      PROG_DIR="$SHM_DIR/$arg1"
      PERSIST_DIR="$CACHE_DIR/programs/$arg1"
      mkdir -p "$PROG_DIR" "$PERSIST_DIR"
      printf '%s' "$arg2" | base64 -d > "$PROG_DIR/main.cpp"

      CXX_FLAGS=""
      [ -r "$CACHE_DIR/pch/flags.txt" ] && IFS= read -r CXX_FLAGS < "$CACHE_DIR/pch/flags.txt"
      [ -n "$CXX_FLAGS" ] || CXX_FLAGS="-std=c++23 -O2 -fno-exceptions -fno-rtti"
      T0=$(date +%s%3N)
      ERR_OUT=$(g++ $CXX_FLAGS $LD_FLAG -I"$CACHE_DIR/pch" -I"$CACHE_DIR/lib" "$PROG_DIR/main.cpp" -o "$PROG_DIR/a.out" 2>&1)
      RC=$?
      T1=$(date +%s%3N)
      MS=$((T1 - T0))

      if [ $RC -ne 0 ]; then
        rm -f "$PROG_DIR/a.out" "$PERSIST_DIR/a.out" 2>/dev/null || true
        ERR_B64=$(printf '%s' "$ERR_OUT" | base64 | tr -d '\\n')
        [ -z "$ERR_B64" ] && ERR_B64="-"
        echo "COMPILE_FAIL $arg1 $MS $ERR_B64"
      else
        chmod +x "$PROG_DIR/a.out" 2>/dev/null || true
        echo "COMPILE_OK $arg1 $MS"
        cp "$PROG_DIR/main.cpp" "$PERSIST_DIR/main.cpp" 2>/dev/null || true
        cp "$PROG_DIR/a.out" "$PERSIST_DIR/a.out" 2>/dev/null || true
        chmod +x "$PERSIST_DIR/a.out" 2>/dev/null || true
      fi
      ;;
    RUN)
      PROG_DIR="$SHM_DIR/$arg1"
      PERSIST_BIN="$CACHE_DIR/programs/$arg1/a.out"
      BIN_PATH="$PROG_DIR/a.out"

      if [ ! -x "$BIN_PATH" ]; then
        if [ -x "$PERSIST_BIN" ]; then
          [ -d "$PROG_DIR" ] || mkdir -p "$PROG_DIR"
          cp "$PERSIST_BIN" "$BIN_PATH" 2>/dev/null && chmod +x "$BIN_PATH" 2>/dev/null || true
        fi
      fi

      if [ ! -x "$BIN_PATH" ]; then
        echo "RUN_RESULT $arg1 STALE 1 0 - -"
        continue
      fi

      [ -d "$PROG_DIR" ] || mkdir -p "$PROG_DIR"
      IN_FILE="$PROG_DIR/stdin.$$.txt"
      ERR_FILE="$PROG_DIR/runner_err.$$.txt"
      if [ "$arg3" = "-" ] || [ -z "$arg3" ]; then
        : > "$IN_FILE"
      else
        printf '%s' "$arg3" | base64 -d > "$IN_FILE"
      fi

      if [ -x "$RUNNER" ]; then
        "$RUNNER" "$BIN_PATH" "$arg2" "$IN_FILE" 2>"$ERR_FILE"
        RUNNER_RC=$?
        if [ $RUNNER_RC -ne 0 ]; then
          ERR_B64=$(base64 < "$ERR_FILE" 2>/dev/null | tr -d '\\n')
          [ -z "$ERR_B64" ] && ERR_B64="-"
          echo "RUN_RESULT $arg1 ERR \${RUNNER_RC:-1} 0 - $ERR_B64"
        fi
      else
        ${fallbackExecBlock}
      fi
      ;;
    CLEAN)
      rm -rf "$SHM_DIR/$arg1" "$CACHE_DIR/programs/$arg1" 2>/dev/null || true
      echo "CLEAN_OK $arg1"
      ;;
    EXIT)
      ${this.cleanupShmOnExit ? 'rm -rf "$SHM_DIR" 2>/dev/null || true' : ":"}
      exit 0
      ;;
  esac
done
`.replace(/\r\n/g, "\n");

        const proc = this.spawnOverride
          ? this.spawnOverride()
          : spawn(process.platform === "linux" ? "bash" : "wsl.exe", process.platform === "linux" ? ["-c", bashScript] : ["-e", "bash", "-c", bashScript], {
              stdio: ["pipe", "pipe", "pipe"],
            });

        this.proc = proc;
        this.isReady = false;
        this.stdoutBuffer = "";
        this.stderrTail = "";

        return await new Promise<boolean>((resolve) => {
          let settled = false;
          let downHandled = false;
          let readyTimer: ReturnType<typeof setTimeout>;

          const finishInit = (ok: boolean) => {
            if (settled) return;
            settled = true;
            clearTimeout(readyTimer);
            if (!ok) {
              this.lastInitFailAt = Date.now();
              if (this.proc === proc) {
                this.proc = null;
                this.isReady = false;
                this.stdoutBuffer = "";
              }
              try {
                proc.kill("SIGKILL");
              } catch {}
            }
            resolve(ok);
          };

          const handleProcDown = (reason: string) => {
            if (downHandled) return;
            downHandled = true;
            if (this.proc === proc) {
              this.proc = null;
              this.isReady = false;
              this.stdoutBuffer = "";
              this.rejectAllPending(reason);
            }
            if (!settled) {
              finishInit(false);
            }
          };

          readyTimer = setTimeout(() => {
            finishInit(false);
          }, timeoutMs);

          proc.stdin?.on("error", () => {});

          proc.stdout?.setEncoding("utf8");
          proc.stdout?.on("data", (chunk: string) => {
            if (this.proc !== proc) return;
            this.stdoutBuffer += chunk;
            let nlIdx: number;
            while ((nlIdx = this.stdoutBuffer.indexOf("\n")) !== -1) {
              const line = this.stdoutBuffer.slice(0, nlIdx).replace(/\r$/, "").trim();
              this.stdoutBuffer = this.stdoutBuffer.slice(nlIdx + 1);
              if (!line) continue;
              if (line === "WORKER_READY") {
                this.isReady = true;
                finishInit(true);
              } else if (this.pendingResolvers.length > 0) {
                const item = this.pendingResolvers.shift()!;
                clearTimeout(item.timer);
                item.resolve(line);
              }
            }
          });

          proc.stderr?.setEncoding("utf8");
          proc.stderr?.on("data", (chunk: string) => {
            this.stderrTail += chunk;
            if (this.stderrTail.length > 4096) {
              this.stderrTail = this.stderrTail.slice(-4096);
            }
          });

          proc.on("error", (err) => {
            handleProcDown(`WSL worker error: ${err.message}`);
          });
          proc.on("exit", (code, signal) => {
            handleProcDown(`WSL worker exited (code=${code ?? "null"}, signal=${signal ?? "none"})`);
          });
          proc.on("close", (code, signal) => {
            handleProcDown(`WSL worker closed (code=${code ?? "null"}, signal=${signal ?? "none"})`);
          });
        });
      } catch {
        this.lastInitFailAt = Date.now();
        return false;
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  async sendCommand(cmd: string, timeoutMs = 30000): Promise<string> {
    this.activeCommands++;
    this.lastUsedAt = Date.now();
    const decrement = () => {
      this.activeCommands = Math.max(0, this.activeCommands - 1);
      this.lastUsedAt = Date.now();
    };

    const runPromise = this.queue.then(
      () =>
        new Promise<string>((resolve, reject) => {
          const proc = this.proc;
          if (!proc || !this.isReady || !proc.stdin || proc.stdin.destroyed) {
            return reject(new Error("Worker not running"));
          }

          let done = false;
          const entry: PendingWorkerCommand = {
            resolve: (data: string) => {
              if (done) return;
              done = true;
              resolve(data);
            },
            reject: (err: Error) => {
              if (done) return;
              done = true;
              reject(err);
            },
            timer: setTimeout(() => {
              if (done) return;
              done = true;
              const idx = this.pendingResolvers.indexOf(entry);
              if (idx !== -1) this.pendingResolvers.splice(idx, 1);
              this.forceResetWorker(`Worker command timed out after ${timeoutMs}ms`);
              reject(new Error(`Worker command timed out after ${timeoutMs}ms`));
            }, timeoutMs),
          };

          this.pendingResolvers.push(entry);
          try {
            proc.stdin.write(cmd + "\n");
          } catch (err: any) {
            const idx = this.pendingResolvers.indexOf(entry);
            if (idx !== -1) this.pendingResolvers.splice(idx, 1);
            clearTimeout(entry.timer);
            done = true;
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        })
    );

    this.queue = runPromise.catch(() => {});
    return runPromise.then(
      (val) => {
        decrement();
        return val;
      },
      (err) => {
        decrement();
        throw err;
      }
    );
  }

  async syncLib(changed: { relPath: string; contentB64: string }[], deleted: string[]): Promise<boolean> {
    if (changed.length === 0 && deleted.length === 0) return true;
    const lines: string[] = [];
    for (const item of changed) {
      const relB64 = Buffer.from(item.relPath, "utf8").toString("base64");
      lines.push(`LIB_B64 ${relB64} ${item.contentB64}`);
    }
    for (const delPath of deleted) {
      const relB64 = Buffer.from(delPath, "utf8").toString("base64");
      lines.push(`LIB_DEL_B64 ${relB64}`);
    }
    lines.push("SYNC_DONE");
    const res = await this.sendCommand(lines.join("\n"), 30000);
    return res === "SYNC_OK";
  }

  async compile(programId: string, sourceCode: string): Promise<{ success: boolean; timeMs: number; diagnostics?: string }> {
    const srcB64 = Buffer.from(sourceCode, "utf8").toString("base64") || "-";
    const line = await this.sendCommand(`COMPILE ${programId} ${srcB64}`, 60000);
    const parts = line.split(" ");
    if (parts[0] === "COMPILE_OK") {
      return { success: true, timeMs: parseInt(parts[2], 10) || 0 };
    }
    const diagB64 = parts[3] && parts[3] !== "-" ? parts[3] : "";
    const diag = diagB64 ? Buffer.from(diagB64, "base64").toString("utf8") : "Compilation failed";
    return { success: false, timeMs: parseInt(parts[2], 10) || 0, diagnostics: diag };
  }

  async run(programId: string, stdinInput: string, timeLimitMs = 2000): Promise<InternalRunResult> {
    const inB64 = Buffer.from(stdinInput, "utf8").toString("base64") || "-";
    const hardTimeoutMs = Math.max(timeLimitMs + 5000, 10000);
    const line = await this.sendCommand(`RUN ${programId} ${timeLimitMs} ${inB64}`, hardTimeoutMs);
    return parseRunnerResultLine(line, "ANY_RESULT", programId);
  }

  async cleanProgram(programId: string): Promise<void> {
    if (!SAFE_PROGRAM_ID_RE.test(programId) || !this.isReady) return;
    await this.sendCommand(`CLEAN ${programId}`, 5000).catch(() => {});
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const proc = this.proc;
    this.isReady = false;
    if (!proc) {
      this.rejectAllPending("Worker stopped");
      return;
    }
    try {
      if (proc.stdin && !proc.stdin.destroyed) {
        proc.stdin.write("EXIT\n");
        proc.stdin.end();
      }
    } catch {}

    await new Promise<void>((resolve) => {
      if (proc.exitCode !== null || proc.killed) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {}
        resolve();
      }, 200);
      proc.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });

    this.forceResetWorker("Worker stopped");
  }
}

export interface WslWorkerPoolOptions {
  primaryWorker?: PersistentWslWorker;
  auxFactory?: () => PersistentWslWorker;
  maxWorkers?: number;
  allowAuxWithoutWslCheck?: boolean;
}

const MAX_WSL_RUN_WORKERS = 4;
const AUX_WORKER_IDLE_MS = 60_000;

/**
 * 複数ケースの同時実行 (CP Toolkit の並列 POST) をさばく WSL 常駐ワーカープール。
 * プライマリ 1 本を共有 /dev/shm ディレクトリで維持し、競合時のみ最大 4 本まで補助ワーカーを起動する。
 */
export class WslWorkerPool {
  public readonly primary: PersistentWslWorker;
  private readonly auxWorkers: PersistentWslWorker[] = [];
  private readonly workerReservations = new Map<PersistentWslWorker, number>();
  private readonly createAuxWorker: () => PersistentWslWorker;
  private readonly maxWorkers: number;
  private readonly allowAuxWithoutWslCheck: boolean;
  private idleReapTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(options?: WslWorkerPoolOptions) {
    this.primary =
      options?.primaryWorker ??
      new PersistentWslWorker({
        shmDirName: SERVER_SHM_DIR_NAME,
        skipSelfHeal: false,
        cleanupShmOnExit: true,
      });
    this.createAuxWorker =
      options?.auxFactory ??
      (() =>
        new PersistentWslWorker({
          shmDirName: SERVER_SHM_DIR_NAME,
          skipSelfHeal: true,
          cleanupShmOnExit: false,
        }));
    this.maxWorkers = Math.max(1, options?.maxWorkers ?? MAX_WSL_RUN_WORKERS);
    this.allowAuxWithoutWslCheck = Boolean(options?.allowAuxWithoutWslCheck);
  }

  public getAuxWorkerCount(): number {
    return this.auxWorkers.length;
  }

  private ensureReaper() {
    if (this.idleReapTimer || this.stopped) return;
    this.idleReapTimer = setInterval(() => {
      this.reapIdleAuxWorkers().catch(() => {});
    }, 15_000);
    this.idleReapTimer.unref?.();
  }

  private async reapIdleAuxWorkers(): Promise<void> {
    const now = Date.now();
    for (let i = this.auxWorkers.length - 1; i >= 0; i--) {
      const w = this.auxWorkers[i];
      if (!w.hasPending() && (this.workerReservations.get(w) ?? 0) === 0 && now - w.lastUsedAt > AUX_WORKER_IDLE_MS) {
        this.auxWorkers.splice(i, 1);
        await w.stop().catch(() => {});
      }
    }
    if (this.auxWorkers.length === 0 && this.idleReapTimer) {
      clearInterval(this.idleReapTimer);
      this.idleReapTimer = null;
    }
  }

  public async waitForPrimaryReady(timeoutMs = 4000): Promise<boolean> {
    this.stopped = false;
    return this.primary.waitForReady(timeoutMs);
  }

  public async run(programId: string, stdinInput: string, timeLimitMs = 2000): Promise<InternalRunResult> {
    const getLoad = (w: PersistentWslWorker) => (this.workerReservations.get(w) ?? 0) + w.getPendingCount();

    let chosen: PersistentWslWorker | null = null;
    if (this.primary.isReady && getLoad(this.primary) === 0) {
      chosen = this.primary;
    } else {
      for (const aux of this.auxWorkers) {
        if (aux.isReady && getLoad(aux) === 0) {
          chosen = aux;
          break;
        }
      }
    }

    let createdAux: PersistentWslWorker | null = null;
    if (
      !chosen &&
      !this.stopped &&
      1 + this.auxWorkers.length < this.maxWorkers &&
      (this.allowAuxWithoutWslCheck || isWslOrLinuxAvailable())
    ) {
      createdAux = this.createAuxWorker();
      this.auxWorkers.push(createdAux);
      this.ensureReaper();
      chosen = createdAux;
    }

    if (!chosen) {
      let best = this.primary;
      let bestLoad = getLoad(best);
      for (const aux of this.auxWorkers) {
        if (!aux.isReady) continue;
        const load = getLoad(aux);
        if (load < bestLoad) {
          best = aux;
          bestLoad = load;
        }
      }
      chosen = best;
    }

    this.workerReservations.set(chosen, (this.workerReservations.get(chosen) ?? 0) + 1);
    try {
      if (createdAux) {
        const ready = await createdAux.waitForReady(5000);
        if (!ready) {
          const idx = this.auxWorkers.indexOf(createdAux);
          if (idx !== -1) this.auxWorkers.splice(idx, 1);
          await createdAux.stop().catch(() => {});
          return await this.primary.run(programId, stdinInput, timeLimitMs);
        }
      } else if (!chosen.isReady) {
        await chosen.waitForReady(4000);
      }
      return await chosen.run(programId, stdinInput, timeLimitMs);
    } finally {
      const cur = this.workerReservations.get(chosen) ?? 0;
      if (cur <= 1) this.workerReservations.delete(chosen);
      else this.workerReservations.set(chosen, cur - 1);
    }
  }

  public async stopAll(): Promise<void> {
    this.stopped = true;
    if (this.idleReapTimer) {
      clearInterval(this.idleReapTimer);
      this.idleReapTimer = null;
    }
    const workers = [this.primary, ...this.auxWorkers.splice(0, this.auxWorkers.length)];
    await Promise.allSettled(workers.map((w) => w.stop()));
  }
}

const persistentWorker = new PersistentWslWorker({
  shmDirName: SERVER_SHM_DIR_NAME,
  skipSelfHeal: false,
  cleanupShmOnExit: true,
});
const wslWorkerPool = new WslWorkerPool({ primaryWorker: persistentWorker });

async function compileViaWsl(
  programId: string,
  sourceCode: string,
  libDelta: { changed: { relPath: string; contentB64: string }[]; deleted: string[] }
): Promise<{ success: boolean; diagnostics?: string; libSynced?: boolean }> {
  const srcB64 = Buffer.from(sourceCode, "utf8").toString("base64") || "-";
  const stdinLines: string[] = [];
  for (const item of libDelta.changed) {
    const relB64 = Buffer.from(item.relPath, "utf8").toString("base64");
    stdinLines.push(`LIB_B64 ${relB64} ${item.contentB64}`);
  }
  for (const delPath of libDelta.deleted) {
    const relB64 = Buffer.from(delPath, "utf8").toString("base64");
    stdinLines.push(`LIB_DEL_B64 ${relB64}`);
  }
  stdinLines.push(`SRC ${srcB64}`);
  stdinLines.push("END");

  const selfHealBlock = buildWslSelfHealScript({
    runnerAlreadyWritten: false,
    checkSourceDiff: false,
    checkCompilerSig: false,
    emitTags: false,
    nonFatal: true,
  });

  const bashScript = `
set -e
CACHE_DIR="$HOME/.cache/oj-cp"
PROG_DIR="$CACHE_DIR/programs/${programId}"
mkdir -p "$PROG_DIR" "$CACHE_DIR/lib"

${selfHealBlock}

while IFS=' ' read -r cmd arg1 arg2; do
  case "$cmd" in
    LIB_B64)
      rel_path="$(printf '%s' "$arg1" | base64 -d 2>/dev/null)"
      case "$rel_path" in
        ""|/*|*../*|*/..|..) ;;
        *)
          rel_dir="$(dirname "$rel_path")"
          mkdir -p "$CACHE_DIR/lib/$rel_dir"
          printf '%s' "$arg2" | base64 -d > "$CACHE_DIR/lib/$rel_path"
          ;;
      esac
      ;;
    LIB_DEL_B64)
      rel_path="$(printf '%s' "$arg1" | base64 -d 2>/dev/null)"
      case "$rel_path" in
        ""|/*|*../*|*/..|..) ;;
        *) rm -f "$CACHE_DIR/lib/$rel_path" 2>/dev/null || true ;;
      esac
      ;;
    SRC)
      printf '%s' "$arg1" | base64 -d > "$PROG_DIR/main.cpp"
      ;;
    END)
      break
      ;;
  esac
done

echo "LIB_SYNC_OK"

CXX_FLAGS="$(cat "$CACHE_DIR/pch/flags.txt" 2>/dev/null || echo '-std=c++23 -O2 -fno-exceptions -fno-rtti')"
LD_FLAG=""
if command -v mold >/dev/null 2>&1; then
  LD_FLAG="-fuse-ld=mold"
elif command -v ld.lld >/dev/null 2>&1; then
  LD_FLAG="-fuse-ld=lld"
fi

set +e
ERR_OUT=$(g++ $CXX_FLAGS $LD_FLAG -I"$CACHE_DIR/pch" -I"$CACHE_DIR/lib" "$PROG_DIR/main.cpp" -o "$PROG_DIR/a.out" 2>&1)
BUILD_RC=$?
set -e

if [ $BUILD_RC -ne 0 ]; then
  rm -f "$PROG_DIR/a.out" 2>/dev/null || true
  printf 'FAIL:%s' "$(printf '%s' "$ERR_OUT" | base64 | tr -d '\\n')"
else
  chmod +x "$PROG_DIR/a.out" 2>/dev/null || true
  echo "OK"
fi
`.replace(/\r\n/g, "\n");

  const res = await runLinuxBashAsync(bashScript, stdinLines.join("\n") + "\n", 60000);
  const out = res.stdout.trim();
  const libSynced = out.includes("LIB_SYNC_OK");

  if (out.includes("FAIL:")) {
    const idx = out.indexOf("FAIL:");
    const b64 = out.slice(idx + "FAIL:".length).trim();
    const diag = b64 ? Buffer.from(b64, "base64").toString("utf8") : "Compilation failed";
    return { success: false, diagnostics: diag, libSynced };
  }
  if (out.split(/\r?\n/).some((l) => l.trim() === "OK")) {
    return { success: true, libSynced };
  }
  return {
    success: false,
    diagnostics: res.error || res.stderr || out || "Unknown compilation error",
    libSynced,
  };
}

async function runViaWsl(programId: string, stdinInput: string, timeLimitMs = 2000): Promise<InternalRunResult> {
  const inB64 = Buffer.from(stdinInput, "utf8").toString("base64") || "-";
  const selfHealBlock = buildWslSelfHealScript({
    runnerAlreadyWritten: false,
    checkSourceDiff: false,
    checkCompilerSig: false,
    emitTags: false,
    nonFatal: true,
  });
  const fallbackExecBlock = buildWslFallbackRunnerBash("CASE_RESULT", "1", String(timeLimitMs));

  const bashScript = `
set +e
CACHE_DIR="$HOME/.cache/oj-cp"
PROG_DIR="$CACHE_DIR/programs/${programId}"
BIN_PATH="$PROG_DIR/a.out"

if [ ! -x "$BIN_PATH" ]; then
  echo "STALE"
  exit 0
fi

${selfHealBlock}

IN_FILE="$PROG_DIR/stdin.txt"
IFS= read -r IN_B64 || true
if [ -n "$IN_B64" ] && [ "$IN_B64" != "-" ]; then
  printf '%s' "$IN_B64" | base64 -d > "$IN_FILE"
else
  : > "$IN_FILE"
fi

# oj_runner を使って高精度マイクロ秒計測・タイムアウト制御
RUNNER="$CACHE_DIR/bin/oj_runner"
if [ -x "$RUNNER" ]; then
  "$RUNNER" "$BIN_PATH" "${timeLimitMs}" "$IN_FILE" 2>"$PROG_DIR/runner_err.txt"
  RUNNER_RC=$?
  if [ $RUNNER_RC -ne 0 ]; then
    ERR_B64=$(cat "$PROG_DIR/runner_err.txt" 2>/dev/null | base64 | tr -d '\\n')
    [ -z "$ERR_B64" ] && ERR_B64="-"
    echo "CASE_RESULT 1 ERR $RUNNER_RC 0 - $ERR_B64"
  fi
else
  # フォールバック (timeout + ファイル経由で末尾改行と終了コードを保持)
  ${fallbackExecBlock}
fi
`.replace(/\r\n/g, "\n");

  const res = await runLinuxBashAsync(bashScript, inB64 + "\n", Math.max(timeLimitMs + 10000, 15000));
  const stdout = res.stdout.trim();

  if (stdout.split(/\r?\n/).some((l) => l.trim() === "STALE")) {
    return {
      status: "badRequest",
      exitCode: 1,
      time: 0,
      memory: 0,
      stdout: "",
      stderr: `Prepared program is unavailable: ${programId}`,
      stale: true,
    };
  }

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("CASE_RESULT ")) {
      return parseRunnerResultLine(line, "CASE_RESULT", programId);
    }
  }

  return {
    status: "internalError",
    exitCode: 1,
    time: 0,
    memory: 0,
    stdout: "",
    stderr: res.error || res.stderr || stdout || "Execution error",
  };
}

let cachedNativeCompiler: string | null = null;
let cachedNativeStdFlag: string | null = null;

function findNativeCompiler(): string {
  if (cachedNativeCompiler) return cachedNativeCompiler;

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    const clionGpp = path.join(localAppData, "Programs", "CLion", "bin", "mingw", "bin", "g++.exe");
    if (fs.existsSync(clionGpp)) {
      cachedNativeCompiler = clionGpp;
      return clionGpp;
    }

    for (const candidate of ["g++", "clang++"]) {
      const whereRes = spawnSync("where.exe", [candidate], { encoding: "utf8" });
      if (whereRes.status === 0 && whereRes.stdout) {
        const first = whereRes.stdout.split(/\r?\n/)[0]?.trim();
        if (first && fs.existsSync(first)) {
          cachedNativeCompiler = first;
          return first;
        }
      }
    }
    return "g++";
  }

  for (const candidate of ["g++", "c++", "clang++"]) {
    const whichRes = spawnSync("which", [candidate], { encoding: "utf8" });
    if (whichRes.status === 0 && whichRes.stdout) {
      const first = whichRes.stdout.split(/\r?\n/)[0]?.trim();
      if (first) {
        cachedNativeCompiler = first;
        return first;
      }
    }
  }
  return "c++";
}

const INCLUDE_BITS_RE = /^\s*#\s*include\s*[<"]bits\/stdc\+\+\.h[">]/m;
const nativePchMemCache = new Map<string, string>();
const nativePchInFlight = new Map<string, Promise<string | null>>();

function buildNativeEnv(compilerDir?: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (compilerDir) {
    const sep = process.platform === "win32" ? ";" : ":";
    env.PATH = env.PATH ? `${compilerDir}${sep}${env.PATH}` : compilerDir;
  }
  return env;
}

async function spawnCaptureAsync(
  cmd: string,
  args: string[],
  timeoutMs = 60000,
  stdinInput?: string
): Promise<{ code: number | null; stdout: string; stderr: string; error?: Error }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const child = spawn(cmd, args, { stdio: [stdinInput !== undefined ? "pipe" : "ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
    }, timeoutMs);

    const finish = (code: number | null, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, error });
    };

    if (stdinInput !== undefined && child.stdin) {
      child.stdin.on("error", () => {});
      child.stdin.end(stdinInput);
    }

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (stdout.length < 8 * 1024 * 1024) stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      if (stderr.length < 8 * 1024 * 1024) stderr += chunk;
    });
    child.on("error", (err) => finish(null, err));
    child.on("close", (code) => finish(code));
  });
}

async function ensureNativePch(compiler: string, stdFlag: string): Promise<string | null> {
  const memKey = `${compiler}|${stdFlag}`;
  const cachedDir = nativePchMemCache.get(memKey);
  if (cachedDir && fs.existsSync(path.join(cachedDir, "bits", "stdc++.h.gch"))) {
    return cachedDir;
  }

  const existingInFlight = nativePchInFlight.get(memKey);
  if (existingInFlight) {
    return existingInFlight;
  }

  const buildPromise = (async (): Promise<string | null> => {
    try {
      const depRes = await spawnCaptureAsync(
        compiler,
        [stdFlag, "-x", "c++", "-E", "-M", "-"],
        15000,
        "#include <bits/stdc++.h>\n"
      );
      if (depRes.error || depRes.code !== 0) {
        return null;
      }

      const depNormalized = depRes.stdout.replace(/\\\r?\n/g, " ");
      const headerMatch = depNormalized.match(/((?:[^\s\\]|\\ )+[/\\]bits[/\\]stdc\+\+\.h)/i);
      if (!headerMatch) {
        return null;
      }

      const realHeaderPath = path.normalize(headerMatch[1].replace(/\\ /g, " "));
      if (!fs.existsSync(realHeaderPath)) {
        return null;
      }

      const headerMtime = fs.statSync(realHeaderPath).mtimeMs;
      const compilerMtime = path.isAbsolute(compiler) && fs.existsSync(compiler) ? fs.statSync(compiler).mtimeMs : 0;
      const sig = `${compiler}|${compilerMtime}|${realHeaderPath}|${headerMtime}|${stdFlag}|-O2 -fno-exceptions -fno-rtti`;

      const stdTag = stdFlag.replace(/[^a-zA-Z0-9_-]/g, "_");
      const stdPchDir = path.join(projectRoot, "cmake-build-debug-local", "server", "pch", stdTag);
      const bitsDir = path.join(stdPchDir, "bits");
      const pchHeader = path.join(bitsDir, "stdc++.h");
      const pchGch = path.join(bitsDir, "stdc++.h.gch");
      const sigFile = path.join(stdPchDir, "sig.txt");

      if (fs.existsSync(pchGch) && fs.existsSync(pchHeader) && fs.existsSync(sigFile)) {
        try {
          if (fs.readFileSync(sigFile, "utf8").trim() === sig) {
            nativePchMemCache.set(memKey, stdPchDir);
            return stdPchDir;
          }
        } catch {}
      }

      fs.mkdirSync(bitsDir, { recursive: true });
      fs.writeFileSync(pchHeader, `#pragma once\n#include "${realHeaderPath.replace(/\\/g, "/")}"\n`, "utf8");
      try {
        if (fs.existsSync(pchGch)) fs.unlinkSync(pchGch);
      } catch {}

      const buildRes = await spawnCaptureAsync(
        compiler,
        [stdFlag, "-O2", "-fno-exceptions", "-fno-rtti", "-x", "c++-header", pchHeader, "-o", pchGch],
        60000
      );
      if (buildRes.code === 0 && fs.existsSync(pchGch)) {
        try {
          fs.writeFileSync(sigFile, sig, "utf8");
        } catch {}
        nativePchMemCache.set(memKey, stdPchDir);
        return stdPchDir;
      }
      return null;
    } catch {
      return null;
    } finally {
      nativePchInFlight.delete(memKey);
    }
  })();

  nativePchInFlight.set(memKey, buildPromise);
  return buildPromise;
}

async function prewarmNativePchInBackground(): Promise<void> {
  if (isWslOrLinuxAvailable()) return;
  const compiler = findNativeCompiler();
  for (const stdFlag of cachedNativeStdFlag ? [cachedNativeStdFlag] : ["-std=c++23", "-std=c++20"]) {
    const dir = await ensureNativePch(compiler, stdFlag);
    if (dir) {
      cachedNativeStdFlag = stdFlag;
      return;
    }
  }
}

export function triggerNativeWarmup(binPath: string): Promise<void> | null {
  if (process.platform !== "win32" || !binPath || !fs.existsSync(binPath)) {
    return null;
  }
  const existing = nativeWarmupPromises.get(binPath);
  if (existing) return existing;

  const compiler = findNativeCompiler();
  const compilerDir = path.isAbsolute(compiler) ? path.dirname(compiler) : "";
  const env = buildNativeEnv(compilerDir);

  const warmupPromise = new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      clearTimeout(safetyTimer);
      if (nativeWarmupPromises.get(binPath) === warmupPromise) {
        nativeWarmupPromises.delete(binPath);
      }
      resolve();
    };

    let child: ChildProcess;
    try {
      child = spawn(binPath, [], {
        stdio: ["pipe", "ignore", "ignore"],
        env,
      });
    } catch {
      finish();
      return;
    }

    const killTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
    }, 80);

    const safetyTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
      finish();
    }, 1500);

    child.stdin?.on("error", () => {});
    try {
      child.stdin?.end("");
    } catch {}
    child.on("error", finish);
    child.on("close", finish);
  });

  nativeWarmupPromises.set(binPath, warmupPromise);
  return warmupPromise;
}

/**
 * Windows / macOS / WSLなし環境用のローカルネイティブフォールバック
 */
export async function compileViaNative(
  programId: string,
  sourceCode: string
): Promise<{ success: boolean; diagnostics?: string; binPath?: string; dirPath?: string }> {
  const dirPath = path.join(projectRoot, "cmake-build-debug-local", "server", programId);
  fs.mkdirSync(dirPath, { recursive: true });
  const srcPath = path.join(dirPath, "main.cpp");
  const binPath = path.join(dirPath, process.platform === "win32" ? "a.exe" : "a.out");
  nativeWarmupPromises.delete(binPath);
  fs.writeFileSync(srcPath, sourceCode, "utf8");

  const compiler = findNativeCompiler();
  const libDir = path.join(projectRoot, "lib");
  const usesBits = INCLUDE_BITS_RE.test(sourceCode);
  const stdCandidates = cachedNativeStdFlag ? [cachedNativeStdFlag] : ["-std=c++23", "-std=c++20"];

  for (const stdFlag of stdCandidates) {
    const pchDir = usesBits ? await ensureNativePch(compiler, stdFlag) : null;
    const baseFlags = [stdFlag, "-O2", "-fno-exceptions", "-fno-rtti"];
    const compileArgs = pchDir
      ? [...baseFlags, "-I" + pchDir, "-I" + libDir, srcPath, "-o", binPath]
      : [...baseFlags, "-I" + libDir, srcPath, "-o", binPath];

    let res = await spawnCaptureAsync(compiler, compileArgs, 60000);
    if (res.error) {
      return {
        success: false,
        diagnostics: `Failed to execute compiler (${compiler}): ${res.error.message}${res.stderr ? "\n" + res.stderr : ""}`,
      };
    }

    if (res.code !== 0 && pchDir && /(?:precompiled header|\.gch\b|\bPCH\b)/i.test(res.stderr || res.stdout || "")) {
      nativePchMemCache.delete(`${compiler}|${stdFlag}`);
      try {
        const gchPath = path.join(pchDir, "bits", "stdc++.h.gch");
        if (fs.existsSync(gchPath)) fs.unlinkSync(gchPath);
      } catch {}
      res = await spawnCaptureAsync(compiler, [...baseFlags, "-I" + libDir, srcPath, "-o", binPath], 60000);
      if (res.error) {
        return {
          success: false,
          diagnostics: `Failed to execute compiler (${compiler}): ${res.error.message}${res.stderr ? "\n" + res.stderr : ""}`,
        };
      }
    }

    if (res.code === 0) {
      cachedNativeStdFlag = stdFlag;
      return { success: true, binPath, dirPath };
    }

    const diag = (res.stderr || res.stdout || "").trim();
    if (
      stdFlag === "-std=c++23" &&
      stdCandidates.length > 1 &&
      /(?:unrecognized command[- ]line option|invalid value|unknown argument).*c\+\+23/i.test(diag)
    ) {
      continue;
    }

    return { success: false, diagnostics: diag || "Native compile failed" };
  }

  return { success: false, diagnostics: "Native compile failed" };
}

export async function runViaNative(
  binPath: string,
  stdinInput: string,
  timeLimitMs = 2000
): Promise<InternalRunResult> {
  if (!binPath || !fs.existsSync(binPath)) {
    return {
      status: "badRequest",
      exitCode: 1,
      time: 0,
      memory: 0,
      stdout: "",
      stderr: "Prepared program is unavailable: binary missing",
      stale: true,
    };
  }

  let preExecWaitMs = 0;
  const pendingWarmup = nativeWarmupPromises.get(binPath);
  if (pendingWarmup) {
    const w0 = performance.now();
    await pendingWarmup;
    preExecWaitMs = Math.round(performance.now() - w0);
  }

  const compiler = findNativeCompiler();
  const compilerDir = path.isAbsolute(compiler) ? path.dirname(compiler) : "";
  const env = buildNativeEnv(compilerDir);

  const maxCaptureBytes = 64 * 1024 * 1024;
  return new Promise((resolve) => {
    const startTime = process.hrtime.bigint();
    let stdoutData = "";
    let stderrData = "";
    let timedOut = false;
    let settled = false;

    const child = spawn(binPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {}
    }, timeLimitMs);

    const finish = (result: InternalRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (preExecWaitMs > 0) {
        result.preExecWaitMs = preExecWaitMs;
      }
      resolve(result);
    };

    child.stdin.on("error", () => {});
    child.stdin.end(stdinInput);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdoutData.length < maxCaptureBytes) stdoutData += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      if (stderrData.length < maxCaptureBytes) stderrData += chunk;
    });

    child.on("error", (err) => {
      const elapsedMs = Math.round(Number(process.hrtime.bigint() - startTime) / 1_000_000);
      finish({
        status: "runtimeError",
        exitCode: 1,
        time: elapsedMs,
        memory: 0,
        stdout: stdoutData,
        stderr: stderrData ? `${stderrData}\n${err.message}` : err.message,
      });
    });

    child.on("close", (code, signal) => {
      const elapsedMs = Math.round(Number(process.hrtime.bigint() - startTime) / 1_000_000);
      if (timedOut) {
        return finish({
          status: "timeLimitExceeded",
          exitCode: 124,
          time: timeLimitMs,
          memory: 0,
          stdout: stdoutData,
          stderr: stderrData,
        });
      }

      if (signal !== null || code === null) {
        const sigNum = signal
          ? SIGNAL_NUMBERS[signal] ?? (os.constants.signals as Record<string, number>)?.[signal] ?? 1
          : 1;
        const exitCode = 128 + sigNum;
        const sigMsg = signal ? `Terminated by signal ${signal}` : "Process terminated abnormally";
        const stderr = stderrData ? `${stderrData.replace(/\r?\n$/, "")}\n${sigMsg}` : sigMsg;
        return finish({
          status: "runtimeError",
          exitCode,
          time: elapsedMs,
          memory: 0,
          stdout: stdoutData,
          stderr,
        });
      }

      if (code !== 0) {
        return finish({
          status: "runtimeError",
          exitCode: code,
          time: elapsedMs,
          memory: 0,
          stdout: stdoutData,
          stderr: stderrData,
        });
      }

      finish({
        status: "success",
        exitCode: 0,
        time: elapsedMs,
        memory: 0,
        stdout: stdoutData,
        stderr: stderrData,
      });
    });
  });
}

type LogSubscriber = (data: string) => void;
const logSubscribers = new Set<LogSubscriber>();
const activeSseClosers = new Set<() => void>();
const recentLogBuffer: string[] = [];

let serverLogLevel: "verbose" | "silent" = "verbose";

export function formatSseMessage(message: string): string {
  const lines = message.replace(/\r\n/g, "\n").split("\n");
  return lines.map((l) => `data: ${l}`).join("\n") + "\n\n";
}

export function parseSseEvent(rawFrame: string): string | null {
  const lines = rawFrame.split(/\r?\n/);
  const dataLines: string[] = [];
  for (const l of lines) {
    if (l.startsWith("data: ")) dataLines.push(l.slice("data: ".length));
    else if (l.startsWith("data:")) dataLines.push(l.slice("data:".length));
  }
  return dataLines.length > 0 ? dataLines.join("\n") : null;
}

function broadcastLog(line: string) {
  recentLogBuffer.push(line);
  if (recentLogBuffer.length > 50) recentLogBuffer.shift();

  for (const sub of [...logSubscribers]) {
    try {
      sub(line);
    } catch {
      logSubscribers.delete(sub);
    }
  }

  if (serverLogLevel !== "silent") {
    console.log(line);
  }
}

const log = {
  time: () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `[${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}]`;
  },
  info: (tag: string, msg: string) => {
    broadcastLog(`\x1b[90m${log.time()}\x1b[0m \x1b[36m[${tag.padEnd(7)}]\x1b[0m ${msg}`);
  },
  success: (tag: string, msg: string) => {
    broadcastLog(`\x1b[90m${log.time()}\x1b[0m \x1b[32m[${tag.padEnd(7)}]\x1b[0m ${msg}`);
  },
  warn: (tag: string, msg: string) => {
    broadcastLog(`\x1b[90m${log.time()}\x1b[0m \x1b[33m[${tag.padEnd(7)}]\x1b[0m ${msg}`);
  },
  error: (tag: string, msg: string, detail?: string) => {
    broadcastLog(`\x1b[90m${log.time()}\x1b[0m \x1b[31m[${tag.padEnd(7)}]\x1b[0m ${msg}`);
    if (detail) {
      const indented = detail
        .trim()
        .split(/\r?\n/)
        .slice(0, 15)
        .map((l) => `          ${l}`)
        .join("\n");
      broadcastLog(`\x1b[90m${indented}\x1b[0m`);
    }
  },
};

let currentRunCounter = 0;
let currentProgramId = "";
let activeServerInstance: ServerInstance | null = null;

function buildCorsHeaders(req: Request, contentType = "application/json"): Headers {
  const baseAllowHeaders = [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Access-Control-Request-Private-Network",
  ];
  const seen = new Set(baseAllowHeaders.map((h) => h.toLowerCase()));
  const requested = req.headers.get("access-control-request-headers");
  if (requested) {
    for (const rawItem of requested.split(",")) {
      const item = rawItem.trim();
      if (item && !seen.has(item.toLowerCase())) {
        seen.add(item.toLowerCase());
        baseAllowHeaders.push(item);
      }
    }
  }

  const headers = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": baseAllowHeaders.join(", "),
    "Access-Control-Allow-Private-Network": "true",
    "Access-Control-Max-Age": "86400",
  });
  if (contentType) {
    headers.set("Content-Type", contentType);
  }
  return headers;
}

function parseTimeLimitMs(body: Record<string, any>): { ok: true; value: number } | { ok: false; error: string } {
  const rawLimit = body.timeLimitMs !== undefined ? body.timeLimitMs : body.timeLimit;
  if (rawLimit === undefined) {
    return { ok: true, value: 2000 };
  }
  if (typeof rawLimit !== "number" || !Number.isFinite(rawLimit) || rawLimit <= 0) {
    return { ok: false, error: "timeLimitMs must be a positive finite number" };
  }
  return { ok: true, value: Math.max(1, Math.round(rawLimit)) };
}

function isProgramBinaryAvailable(prog: PreparedProgram): boolean {
  if (prog.isWsl) return true;
  return Boolean(prog.localBinPath && fs.existsSync(prog.localBinPath));
}

type PrepareProgramResult =
  | { ok: true; program: PreparedProgram; cacheHit: boolean; compileMs: number }
  | { ok: false; diagnostics: string; compileMs: number };

const inFlightPrepares = new Map<string, Promise<PrepareProgramResult>>();

async function prepareProgram(
  sourceCode: string,
  requestedProgramId?: string,
  forceRebuild = false,
  options?: { warmupNative?: boolean; batchStartPerfMs?: number }
): Promise<PrepareProgramResult> {
  const prepStartPerf = options?.batchStartPerfMs ?? performance.now();
  const useWsl = isWslOrLinuxAvailable();
  const backend: "wsl" | "native" = useWsl ? "wsl" : "native";
  const libDelta = computeLibDelta(false, { includeContent: false });
  const sourceHash = crypto
    .createHash("sha1")
    .update(sourceCode)
    .update("|")
    .update(libDelta.combinedLibHash)
    .update("|")
    .update(backend)
    .digest("hex");

  if (!forceRebuild) {
    if (requestedProgramId) {
      const existing = preparedCache.get(requestedProgramId);
      if (existing && existing.sourceHash === sourceHash && isProgramBinaryAvailable(existing)) {
        existing.lastUsedAt = Date.now();
        if (options?.warmupNative && !existing.isWsl && existing.localBinPath) {
          triggerNativeWarmup(existing.localBinPath);
        }
        return { ok: true, program: existing, cacheHit: true, compileMs: 0 };
      }
    } else {
      for (const prog of preparedCache.values()) {
        if (prog.sourceHash === sourceHash && isProgramBinaryAvailable(prog)) {
          prog.lastUsedAt = Date.now();
          if (options?.warmupNative && !prog.isWsl && prog.localBinPath) {
            triggerNativeWarmup(prog.localBinPath);
          }
          return { ok: true, program: prog, cacheHit: true, compileMs: 0 };
        }
      }
    }
  }

  const inFlightKey = `${requestedProgramId || "auto"}|${sourceHash}|${forceRebuild ? "1" : "0"}`;
  const existingPrepare = inFlightPrepares.get(inFlightKey);
  if (existingPrepare) {
    const sharedRes = await existingPrepare;
    if (options?.warmupNative && sharedRes.ok && !sharedRes.program.isWsl && sharedRes.program.localBinPath) {
      triggerNativeWarmup(sharedRes.program.localBinPath);
    }
    return sharedRes.ok ? { ok: true, program: sharedRes.program, cacheHit: true, compileMs: 0 } : sharedRes;
  }

  const workPromise = (async (): Promise<PrepareProgramResult> => {
    const programId = requestedProgramId || "prog-" + crypto.randomUUID().slice(0, 8);
    const t0 = performance.now();

    if (useWsl) {
      await wslWorkerPool.waitForPrimaryReady(4000);
      const syncDelta = libDelta.changed.length > 0 ? computeLibDelta(false, { includeContent: true }) : libDelta;

      let res: { success: boolean; diagnostics?: string };
      let compileMs = 0;
      let libSynced = false;

      if (persistentWorker.isReady) {
        try {
          const synced = await persistentWorker.syncLib(syncDelta.changed, syncDelta.deleted);
          libSynced = synced;
          const workerRes = await persistentWorker.compile(programId, sourceCode);
          compileMs = workerRes.timeMs || Math.round(performance.now() - t0);
          res = workerRes;
        } catch (err: any) {
          log.warn("WORKER", `Persistent worker compile fallback: ${err?.message || err}`);
          persistentWorker.maybeRestartInBackground();
          const fallbackRes = await compileViaWsl(programId, sourceCode, syncDelta);
          libSynced = Boolean(fallbackRes.libSynced);
          compileMs = Math.round(performance.now() - t0);
          res = fallbackRes;
        }
      } else {
        persistentWorker.maybeRestartInBackground();
        const fallbackRes = await compileViaWsl(programId, sourceCode, syncDelta);
        libSynced = Boolean(fallbackRes.libSynced);
        compileMs = Math.round(performance.now() - t0);
        res = fallbackRes;
      }

      if (libSynced && (syncDelta.changed.length > 0 || syncDelta.deleted.length > 0)) {
        saveSyncState(syncDelta.newState);
      }

      if (!res.success) {
        return { ok: false, diagnostics: res.diagnostics || "Compilation failed", compileMs };
      }

      const now = Date.now();
      const entry: PreparedProgram = {
        id: programId,
        sourceHash,
        sourceCode,
        createdAt: now,
        lastUsedAt: now,
        backend: "wsl",
        isWsl: true,
        prepWallMs: Math.round(performance.now() - prepStartPerf),
        preRunReportedForBatch: false,
        lastRunActivityPerfMs: performance.now(),
      };
      preparedCache.set(programId, entry);
      return { ok: true, program: entry, cacheHit: false, compileMs };
    }

    const nativeRes = await compileViaNative(programId, sourceCode);
    const compileMs = Math.round(performance.now() - t0);
    if (!nativeRes.success) {
      return { ok: false, diagnostics: nativeRes.diagnostics || "Compilation failed", compileMs };
    }

    if (options?.warmupNative && nativeRes.binPath) {
      triggerNativeWarmup(nativeRes.binPath);
    }

    const now = Date.now();
    const entry: PreparedProgram = {
      id: programId,
      sourceHash,
      sourceCode,
      createdAt: now,
      lastUsedAt: now,
      backend: "native",
      isWsl: false,
      localBinPath: nativeRes.binPath,
      localDirPath: nativeRes.dirPath,
      prepWallMs: Math.round(performance.now() - prepStartPerf),
      preRunReportedForBatch: false,
      lastRunActivityPerfMs: performance.now(),
    };
    preparedCache.set(programId, entry);
    return { ok: true, program: entry, cacheHit: false, compileMs };
  })();

  inFlightPrepares.set(inFlightKey, workPromise);
  try {
    return await workPromise;
  } finally {
    if (inFlightPrepares.get(inFlightKey) === workPromise) {
      inFlightPrepares.delete(inFlightKey);
    }
  }
}

async function executePreparedProgram(
  prog: PreparedProgram,
  stdinInput: string,
  timeLimitMs: number
): Promise<InternalRunResult> {
  if (prog.isWsl) {
    const waitStart = performance.now();
    const ready = persistentWorker.isReady || (await wslWorkerPool.waitForPrimaryReady(3500));
    const preExecWaitMs = Math.round(performance.now() - waitStart);
    if (ready) {
      try {
        const res = await wslWorkerPool.run(prog.id, stdinInput, timeLimitMs);
        if (preExecWaitMs > 0) res.preExecWaitMs = preExecWaitMs;
        return res;
      } catch (err: any) {
        log.warn("WORKER", `Persistent worker run fallback: ${err?.message || err}`);
        persistentWorker.maybeRestartInBackground();
      }
    } else {
      persistentWorker.maybeRestartInBackground();
    }
    const res = await runViaWsl(prog.id, stdinInput, timeLimitMs);
    if (preExecWaitMs > 0) res.preExecWaitMs = preExecWaitMs;
    return res;
  }
  return await runViaNative(prog.localBinPath || "", stdinInput, timeLimitMs);
}

/**
 * HTTP リクエストハンドラ (CP Toolkit Local Runner 仕様準拠)
 */
export async function handleRequest(req: Request): Promise<Response> {
  const headers = buildCorsHeaders(req, "application/json");

  try {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: buildCorsHeaders(req, "") });
    }

    const url = new URL(req.url);

    // ログストリーム監視エンドポイント (/logs)
    if (url.pathname === "/logs") {
      if (req.method !== "GET") {
        headers.set("Allow", "GET, OPTIONS");
        return new Response(JSON.stringify({ status: "methodNotAllowed", error: "Method not allowed" }), {
          status: 405,
          headers,
        });
      }

      const encoder = new TextEncoder();
      let cleanupFn: (() => void) | null = null;
      const stream = new ReadableStream({
        start(controller) {
          let closed = false;
          let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
          let sub: LogSubscriber | null = null;

          const cleanup = () => {
            if (closed) return;
            closed = true;
            if (keepaliveTimer) {
              clearInterval(keepaliveTimer);
              keepaliveTimer = null;
            }
            if (sub) {
              logSubscribers.delete(sub);
              sub = null;
            }
            activeSseClosers.delete(cleanup);
            try {
              controller.close();
            } catch {}
          };
          cleanupFn = cleanup;

          const pushFrame = (frame: string) => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(frame));
            } catch {
              cleanup();
            }
          };

          pushFrame(": connected\n\n");
          if (closed) return;

          for (const line of recentLogBuffer) {
            pushFrame(formatSseMessage(line));
            if (closed) return;
          }

          sub = (line: string) => {
            pushFrame(formatSseMessage(line));
          };
          logSubscribers.add(sub);
          activeSseClosers.add(cleanup);

          keepaliveTimer = setInterval(() => {
            pushFrame(": keepalive\n\n");
          }, 8000);
          (keepaliveTimer as any).unref?.();

          req.signal?.addEventListener("abort", cleanup, { once: true });
        },
        cancel() {
          cleanupFn?.();
        },
      });

      const sseHeaders = buildCorsHeaders(req, "text/event-stream; charset=utf-8");
      sseHeaders.set("Cache-Control", "no-cache");
      sseHeaders.set("Connection", "keep-alive");

      return new Response(stream, {
        status: 200,
        headers: sseHeaders,
      });
    }

    // サーバー停止リクエスト (/stop) - POST のみに限定
    if (url.pathname === "/stop") {
      if (req.method !== "POST") {
        headers.set("Allow", "POST, OPTIONS");
        return new Response(
          JSON.stringify({ status: "methodNotAllowed", error: "Method not allowed. Use POST /stop." }),
          { status: 405, headers }
        );
      }

      log.info("STOP", "Shutdown signal received (/stop)");
      setTimeout(() => {
        const srv = activeServerInstance;
        activeServerInstance = null;
        if (srv) {
          Promise.resolve(srv.stop("http_stop")).catch(() => {});
        }
      }, 50);
      return new Response(JSON.stringify({ status: "stopped", message: "Local Runner server stopped." }), {
        status: 200,
        headers,
      });
    }

    if (req.method === "GET") {
      if (url.pathname === "/" || url.pathname === "/status") {
        return new Response(
          JSON.stringify({
            name: "oj-local-runner",
            version: "2.0.0",
            status: "running",
            wslAvailable: isWslOrLinuxAvailable(),
          }),
          { status: 200, headers }
        );
      }
      return new Response(JSON.stringify({ status: "notFound", error: "Not found" }), { status: 404, headers });
    }

    if (req.method !== "POST") {
      return new Response(JSON.stringify({ status: "methodNotAllowed", error: "Method not allowed" }), {
        status: 405,
        headers,
      });
    }

    if (url.pathname !== "/") {
      return new Response(JSON.stringify({ status: "notFound", error: "Not found" }), { status: 404, headers });
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ status: "badRequest", error: "Invalid JSON" }), { status: 400, headers });
    }

    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return new Response(JSON.stringify({ status: "badRequest", error: "Request body must be a JSON object" }), {
        status: 400,
        headers,
      });
    }

    cleanupOldPrograms();
    const mode = typeof body.mode === "string" ? body.mode : "";

    // mode: "stop" -> サーバー停止
    if (mode === "stop") {
      log.info("STOP", "Shutdown signal received (mode: stop)");
      setTimeout(() => {
        const srv = activeServerInstance;
        activeServerInstance = null;
        if (srv) {
          Promise.resolve(srv.stop("mode_stop")).catch(() => {});
        }
      }, 50);
      return new Response(JSON.stringify({ status: "stopped", message: "Local Runner server stopped." }), {
        status: 200,
        headers,
      });
    }

    // 1. mode: "list" -> コンパイラ一覧
    if (mode === "list") {
      log.info("LIST", "Compiler info requested by CP Toolkit");
      const isWsl = isWslOrLinuxAvailable();
      const compilers = [
        {
          compilerName: isWsl ? "gcc-wsl" : "gcc-native",
          language: "C++",
          label: isWsl ? "GCC 13 C++23 [WSL2 + PCH]" : "GCC C++23 [Native]",
        },
      ];
      return new Response(JSON.stringify(compilers), { status: 200, headers });
    }

    // 2. mode: "transform" -> コード変換 (Javaのlib展開用。C++はそのまま返す)
    if (mode === "transform") {
      if (typeof body.sourceCode !== "string") {
        return new Response(JSON.stringify({ status: "badRequest", error: "sourceCode must be a string" }), {
          status: 400,
          headers,
        });
      }
      return new Response(
        JSON.stringify({
          status: "success",
          sourceCode: body.sourceCode,
        }),
        { status: 200, headers }
      );
    }

    // programId が指定されている場合は安全な文字種のみ許可
    let requestedProgramId: string | undefined;
    if (body.programId !== undefined && body.programId !== null) {
      if (
        typeof body.programId !== "string" ||
        body.programId.length === 0 ||
        body.programId.length > 128 ||
        !SAFE_PROGRAM_ID_RE.test(body.programId)
      ) {
        return new Response(
          JSON.stringify({ status: "badRequest", error: "Invalid programId", stderr: "Invalid programId" }),
          { status: 400, headers }
        );
      }
      requestedProgramId = body.programId;
    }

    // 3. mode: "prepare" -> 事前コンパイル
    if (mode === "prepare") {
      if (typeof body.sourceCode !== "string" || body.sourceCode.trim().length === 0) {
        return new Response(
          JSON.stringify({ status: "badRequest", error: "sourceCode must be a non-empty string" }),
          { status: 400, headers }
        );
      }

      const reqStartPerf = performance.now();
      currentRunCounter = 0;
      const prep = await prepareProgram(body.sourceCode, requestedProgramId, false, {
        warmupNative: true,
        batchStartPerfMs: reqStartPerf,
      });
      if (!prep.ok) {
        log.error("COMPILE", `FAIL - compile: ${prep.compileMs}ms`, prep.diagnostics);
        return new Response(
          JSON.stringify({
            status: "compileError",
            diagnostics: prep.diagnostics,
          }),
          { status: 200, headers }
        );
      }

      const prepWallMs = prep.cacheHit ? 0 : Math.round(performance.now() - reqStartPerf);
      prep.program.prepWallMs = prepWallMs;
      prep.program.preRunReportedForBatch = false;
      prep.program.lastRunActivityPerfMs = performance.now();
      currentProgramId = prep.program.id;
      if (prep.cacheHit) {
        log.success("COMPILE", `OK - compile: 0ms (cache hit: ${prep.program.id})`);
      } else {
        const tag = prep.program.isWsl ? "WSL2 RAM" : "Native";
        log.success("COMPILE", `OK - compile: ${prep.compileMs}ms (prep total: ${prepWallMs}ms) [${tag}] (${prep.program.id})`);
      }
      return new Response(JSON.stringify({ status: "success", programId: prep.program.id }), {
        status: 200,
        headers,
      });
    }

    // 4. mode: "run" -> テスト実行
    if (mode === "run") {
      const reqStartPerf = performance.now();
      const limitCheck = parseTimeLimitMs(body);
      if (!limitCheck.ok) {
        return new Response(
          JSON.stringify({ status: "badRequest", error: limitCheck.error, stderr: limitCheck.error }),
          { status: 400, headers }
        );
      }
      const timeLimitMs = limitCheck.value;

      if (body.stdin !== undefined && body.stdin !== null && typeof body.stdin !== "string") {
        return new Response(
          JSON.stringify({ status: "badRequest", error: "stdin must be a string", stderr: "stdin must be a string" }),
          { status: 400, headers }
        );
      }
      const stdinInput = typeof body.stdin === "string" ? body.stdin : "";

      if (body.sourceCode !== undefined && body.sourceCode !== null && typeof body.sourceCode !== "string") {
        return new Response(
          JSON.stringify({ status: "badRequest", error: "sourceCode must be a string", stderr: "sourceCode must be a string" }),
          { status: 400, headers }
        );
      }

      const hasValidSource = typeof body.sourceCode === "string" && body.sourceCode.trim().length > 0;
      if (!requestedProgramId && !hasValidSource) {
        return new Response(
          JSON.stringify({
            status: "badRequest",
            error: "Either programId or non-empty sourceCode is required",
            stderr: "Either programId or non-empty sourceCode is required",
          }),
          { status: 400, headers }
        );
      }

      let prog = requestedProgramId ? preparedCache.get(requestedProgramId) : undefined;

      // 未登録または sourceCode 指定時は共通 prepare パイプラインで自動コンパイル・キャッシュ再利用
      if (hasValidSource) {
        const prep = await prepareProgram(body.sourceCode, requestedProgramId, false, { batchStartPerfMs: reqStartPerf });
        if (!prep.ok) {
          log.error("COMPILE", `FAIL - compile: ${prep.compileMs}ms`, prep.diagnostics);
          return new Response(
            JSON.stringify({
              status: "compileError",
              diagnostics: prep.diagnostics,
            }),
            { status: 200, headers }
          );
        }
        prog = prep.program;
        // 既に別バッチから >30s 経過したキャッシュ再ヒットなら今回の実行前合計を 0 にリセット
        if (
          prep.cacheHit &&
          (!prog.lastRunActivityPerfMs || reqStartPerf - prog.lastRunActivityPerfMs > 30_000)
        ) {
          prog.prepWallMs = 0;
          prog.preRunReportedForBatch = false;
        }
      }

      if (!prog) {
        const msg = `Prepared program is unavailable: ${requestedProgramId || ""}`;
        return new Response(
          JSON.stringify({
            status: "badRequest",
            exitCode: 1,
            time: 0,
            memory: 0,
            stdout: "",
            stderr: msg,
          }),
          { status: 200, headers }
        );
      }

      if (!hasValidSource && prog.lastRunActivityPerfMs && reqStartPerf - prog.lastRunActivityPerfMs > 30_000) {
        prog.prepWallMs = 0;
        prog.preRunReportedForBatch = false;
      }

      prog.lastUsedAt = Date.now();
      if (prog.id !== currentProgramId) {
        currentProgramId = prog.id;
        currentRunCounter = 0;
      }
      currentRunCounter++;
      const caseLabel = `Case #${currentRunCounter}`;
      let showPreRunTotal = !prog.preRunReportedForBatch;
      prog.preRunReportedForBatch = true;

      let execResult = await executePreparedProgram(prog, stdinInput, timeLimitMs);

      // キャッシュ済みバイナリが消失 (STALE) していた場合は、保持しているソースから 1 度だけ再ビルドして再実行
      if (execResult.stale && prog.sourceCode) {
        log.warn("CACHE", `Stale binary detected for ${prog.id}; rebuilding...`);
        const rebuild = await prepareProgram(prog.sourceCode, prog.id, true, { batchStartPerfMs: reqStartPerf });
        if (rebuild.ok) {
          prog = rebuild.program;
          showPreRunTotal = true;
          prog.preRunReportedForBatch = true;
          execResult = await executePreparedProgram(prog, stdinInput, timeLimitMs);
        }
      }

      const nowPerf = performance.now();
      prog.lastRunActivityPerfMs = nowPerf;
      const reqMs = Math.round(nowPerf - reqStartPerf);
      const preRunTotalMs = (prog.prepWallMs ?? 0) + (execResult.preExecWaitMs ?? 0);

      const cleanResult: RunResult = {
        status: execResult.status,
        exitCode: execResult.exitCode,
        time: execResult.time,
        memory: execResult.memory,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
      };

      const inBytes = Buffer.byteLength(stdinInput, "utf8");
      const outBytes = Buffer.byteLength(cleanResult.stdout, "utf8");
      const timeStr = showPreRunTotal
        ? `time: ${cleanResult.time}ms (pre-run total: ${preRunTotalMs}ms, req: ${reqMs}ms)`
        : `time: ${cleanResult.time}ms (req: ${reqMs}ms)`;
      const ioStr = `in: ${inBytes}B, out: ${outBytes}B`;

      if (cleanResult.status === "success") {
        log.success("RUN", `${caseLabel}: OK - ${timeStr}, ${ioStr}, exit: ${cleanResult.exitCode}`);
      } else if (cleanResult.status === "timeLimitExceeded") {
        log.warn("RUN", `${caseLabel}: TLE - ${timeStr} (limit: ${timeLimitMs}ms), ${ioStr}, exit: ${cleanResult.exitCode}`);
      } else if (cleanResult.status === "runtimeError") {
        log.error("RUN", `${caseLabel}: RE - ${timeStr}, ${ioStr}, exit: ${cleanResult.exitCode}`, cleanResult.stderr);
      } else {
        log.error("RUN", `${caseLabel}: ${cleanResult.status} - ${timeStr}, ${ioStr}`, cleanResult.stderr);
      }

      return new Response(JSON.stringify(cleanResult), { status: 200, headers });
    }

    return new Response(JSON.stringify({ status: "badRequest", error: `Unknown mode: ${mode}` }), {
      status: 400,
      headers,
    });
  } catch (err: any) {
    log.error("HTTP", `Unhandled error: ${err?.message || err}`);
    return new Response(
      JSON.stringify({
        status: "internalError",
        error: err?.message || "Internal server error",
      }),
      { status: 500, headers }
    );
  }
}

function isAddrInUseError(err: any): boolean {
  const code = err?.code;
  const msg = String(err?.message || "");
  return code === "EADDRINUSE" || msg.includes("EADDRINUSE") || msg.includes("in use");
}

function isIpv6UnsupportedError(err: any): boolean {
  const code = err?.code;
  return code === "EADDRNOTAVAIL" || code === "EAFNOSUPPORT" || code === "EINVAL" || code === "ENOPROTOOPT";
}

function listenNodeServer(server: http.Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: any) => {
      server.removeListener("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function closeNodeServer(server: http.Server | null): Promise<void> {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        (server as any).closeAllConnections?.();
      } catch {}
      resolve();
    }, 300);
    try {
      server.close(() => {
        clearTimeout(timer);
        resolve();
      });
      (server as any).closeIdleConnections?.();
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

export function createNodeRequestHandler(portGetter: () => number) {
  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    const reqAbort = new AbortController();
    const protocol = (req.headers["x-forwarded-proto"] as string) || "http";
    const host = req.headers.host || `localhost:${portGetter()}`;
    const fullUrl = `${protocol}://${host}${req.url || "/"}`;

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) {
        for (const item of v) headers.append(k, item);
      } else if (v !== undefined) {
        headers.set(k, v);
      }
    }

    const bodyChunks: Buffer[] = [];
    req.on("data", (chunk: Buffer | string) => {
      bodyChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    req.on("error", () => {
      reqAbort.abort();
      if (!res.headersSent && !res.writableEnded) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ status: "badRequest", error: "Request stream error" }));
      }
    });
    req.on("end", async () => {
      try {
        const method = (req.method || "GET").toUpperCase();
        const hasBody = ["POST", "PUT", "PATCH", "DELETE"].includes(method) && bodyChunks.length > 0;
        const body = hasBody ? Buffer.concat(bodyChunks) : undefined;
        const webReq = new Request(fullUrl, {
          method,
          headers,
          body,
          signal: reqAbort.signal,
        });

        const webRes = await handleRequest(webReq);
        res.statusCode = webRes.status;
        webRes.headers.forEach((val, key) => res.setHeader(key, val));

        const contentType = webRes.headers.get("content-type") || "";
        if (contentType.includes("text/event-stream") && webRes.body) {
          res.flushHeaders?.();
          const reader = webRes.body.getReader();
          let streamClosed = false;
          const abortStream = () => {
            if (streamClosed) return;
            streamClosed = true;
            reqAbort.abort();
            try {
              reader.cancel().catch(() => {});
            } catch {}
            if (!res.writableEnded) {
              try {
                res.end();
              } catch {}
            }
          };

          // Note: In Node 18+, `req.on("close")` fires as soon as the request body reaches EOF (`req.complete`),
          // even while the SSE response stream stays open. Track response/socket close + request abort instead.
          req.on("aborted", abortStream);
          res.on("close", abortStream);
          req.socket?.on("close", abortStream);

          try {
            while (!streamClosed) {
              const { done, value } = await reader.read();
              if (done || streamClosed) break;
              if (value && value.length > 0 && !res.writableEnded) {
                res.write(value);
              }
            }
          } catch {
            // client disconnected
          } finally {
            req.removeListener("aborted", abortStream);
            res.removeListener("close", abortStream);
            req.socket?.removeListener("close", abortStream);
            if (!res.writableEnded) {
              try {
                res.end();
              } catch {}
            }
          }
          return;
        }

        const buf = webRes.body ? Buffer.from(await webRes.arrayBuffer()) : null;
        if (!res.writableEnded) {
          res.end(buf && buf.length > 0 ? buf : undefined);
        }
      } catch (err: any) {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Access-Control-Allow-Private-Network", "true");
        }
        if (!res.writableEnded) {
          res.end(JSON.stringify({ status: "internalError", error: err?.message || "Internal server error" }));
        }
      }
    });
  };
}

export async function startLocalRunnerServer(
  startPort = DEFAULT_PORT,
  options?: { onStop?: (reason: string) => void; isStandalone?: boolean; silent?: boolean }
): Promise<ServerInstance> {
  if (options?.silent) {
    serverLogLevel = "silent";
  } else {
    serverLogLevel = "verbose";
  }

  let lastErr: any;
  const candidatePorts = startPort === 0 ? [0] : Array.from({ length: 10 }, (_, i) => startPort + i);

  for (const port of candidatePorts) {
    try {
      // Bun.serve を優先利用 (127.0.0.1 + ::1 ループバックデュアルバインド)
      if (typeof (globalThis as any).Bun !== "undefined") {
        const BunApi = (globalThis as any).Bun;
        const serverV4 = BunApi.serve({
          hostname: "127.0.0.1",
          port,
          fetch: handleRequest,
        });

        const boundPort: number = serverV4.port;
        let serverV6: any = null;
        try {
          serverV6 = BunApi.serve({
            hostname: "::1",
            port: boundPort,
            fetch: handleRequest,
          });
        } catch (v6Err: any) {
          if (isAddrInUseError(v6Err) && startPort !== 0) {
            try {
              serverV4.stop(true);
            } catch {}
            lastErr = v6Err;
            continue;
          }
          if (!isIpv6UnsupportedError(v6Err)) {
            // IPv6 が利用不可または非対応の環境では IPv4 のみで継続
          }
          serverV6 = null;
        }

        let stopPromise: Promise<void> | null = null;
        const doStop = (reason = "manual") => {
          if (stopPromise) return stopPromise;
          stopPromise = (async () => {
            for (const closeSse of [...activeSseClosers]) {
              try {
                closeSse();
              } catch {}
            }
            try {
              await wslWorkerPool.stopAll();
            } catch {}
            try {
              serverV4.stop(true);
            } catch {}
            try {
              serverV6?.stop(true);
            } catch {}
            if (activeServerInstance === instance) activeServerInstance = null;
            if (instance.onStop && instance.onStop !== options?.onStop) {
              instance.onStop(reason);
            }
            options?.onStop?.(reason);
            if (options?.isStandalone) {
              log.info("STOP", `Server on port ${boundPort} stopped (${reason}).`);
              process.exit(0);
            }
          })();
          return stopPromise;
        };

        const instance: ServerInstance = {
          port: boundPort,
          stop: doStop,
          onStop: options?.onStop,
        };
        activeServerInstance = instance;

        if (isWslOrLinuxAvailable()) {
          if (!persistentWorker.isReady) {
            persistentWorker.init().catch(() => {});
          }
        } else if (options?.isStandalone) {
          prewarmNativePchInBackground().catch(() => {});
        }
        return instance;
      }

      // Node.js http フォールバック (127.0.0.1 + ::1 ループバックデュアルバインド)
      let boundPort = port;
      const nodeHandler = createNodeRequestHandler(() => boundPort);
      const serverV4 = http.createServer(nodeHandler);
      boundPort = await listenNodeServer(serverV4, port, "127.0.0.1");

      let serverV6: http.Server | null = http.createServer(nodeHandler);
      try {
        await listenNodeServer(serverV6, boundPort, "::1");
      } catch (v6Err: any) {
        serverV6 = null;
        if (isAddrInUseError(v6Err) && startPort !== 0) {
          await closeNodeServer(serverV4);
          lastErr = v6Err;
          continue;
        }
        if (!isIpv6UnsupportedError(v6Err)) {
          // IPv6 が利用できない環境では IPv4 のみで継続
        }
      }

      let stopPromise: Promise<void> | null = null;
      const doStop = (reason = "manual") => {
        if (stopPromise) return stopPromise;
        stopPromise = (async () => {
          for (const closeSse of [...activeSseClosers]) {
            try {
              closeSse();
            } catch {}
          }
          try {
            await wslWorkerPool.stopAll();
          } catch {}
          await Promise.all([closeNodeServer(serverV4), closeNodeServer(serverV6)]);
          if (activeServerInstance === instance) activeServerInstance = null;
          if (instance.onStop && instance.onStop !== options?.onStop) {
            instance.onStop(reason);
          }
          options?.onStop?.(reason);
          if (options?.isStandalone) {
            log.info("STOP", `Server on port ${boundPort} stopped (${reason}).`);
            process.exit(0);
          }
        })();
        return stopPromise;
      };

      const instance: ServerInstance = {
        port: boundPort,
        stop: doStop,
        onStop: options?.onStop,
      };
      activeServerInstance = instance;

      if (isWslOrLinuxAvailable()) {
        if (!persistentWorker.isReady) {
          persistentWorker.init().catch(() => {});
        }
      } else if (options?.isStandalone) {
        prewarmNativePchInBackground().catch(() => {});
      }
      return instance;
    } catch (err: any) {
      lastErr = err;
      if (isAddrInUseError(err)) {
        continue;
      }
      throw err;
    }
  }

  throw lastErr;
}

function getCandidatePorts(targetPort?: number): number[] {
  if (targetPort !== undefined) return [targetPort];
  return Array.from({ length: 10 }, (_, i) => DEFAULT_PORT + i);
}

async function probeLocalRunnerBaseUrl(port: number): Promise<{ baseUrl: string; data: any } | null> {
  for (const host of ["127.0.0.1", "[::1]"]) {
    const baseUrl = `http://${host}:${port}`;
    try {
      const res = await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(300) });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data && data.name === "oj-local-runner") {
          return { baseUrl, data };
        }
      }
    } catch {}
  }
  return null;
}

/**
 * 稼働中の Local Runner サーバーを探して停止シグナルを送信する
 */
export async function stopLocalRunnerServer(targetPort?: number): Promise<{ stopped: boolean; port?: number }> {
  // 自プロセス内で立ち上がっていれば即座に停止
  if (activeServerInstance && (targetPort === undefined || activeServerInstance.port === targetPort)) {
    const port = activeServerInstance.port;
    const srv = activeServerInstance;
    activeServerInstance = null;
    try {
      await srv.stop("stop_api");
      return { stopped: true, port };
    } catch {}
  }

  for (const port of getCandidatePorts(targetPort)) {
    const probed = await probeLocalRunnerBaseUrl(port);
    if (probed) {
      await fetch(`${probed.baseUrl}/stop`, { method: "POST", signal: AbortSignal.timeout(600) }).catch(() => {});
      return { stopped: true, port };
    }
  }

  return { stopped: false };
}

/**
 * 稼働中の Local Runner サーバーの状態を取得する
 */
export async function getLocalRunnerStatus(
  targetPort?: number
): Promise<{ running: boolean; port?: number; version?: string; wslAvailable?: boolean }> {
  if (activeServerInstance && (targetPort === undefined || activeServerInstance.port === targetPort)) {
    return {
      running: true,
      port: activeServerInstance.port,
      version: "2.0.0",
      wslAvailable: isWslOrLinuxAvailable(),
    };
  }

  for (const port of getCandidatePorts(targetPort)) {
    const probed = await probeLocalRunnerBaseUrl(port);
    if (probed) {
      return {
        running: true,
        port,
        version: probed.data.version,
        wslAvailable: probed.data.wslAvailable,
      };
    }
  }

  return { running: false };
}

/**
 * 稼働中の Local Runner サーバーに接続してリアルタイムにログを表示する画面 (Log Monitor)
 */
export async function attachLogMonitor(
  port = DEFAULT_PORT,
  options?: { onExit?: (reason: "user_exit" | "server_closed" | "error") => void }
): Promise<"user_exit" | "server_closed" | "error"> {
  console.log(`\x1b[90m${hr("-")}\x1b[0m`);
  console.log(`  \x1b[1mOJ Local Runner Log Monitor\x1b[0m (Connected to port ${port})`);
  console.log(`  Exit : Press [q], [Enter], or Ctrl+C to close monitor`);
  console.log(`\x1b[90m${hr("-")}\x1b[0m`);
  console.log(`\x1b[90mStreaming logs from http://localhost:${port}/logs...\x1b[0m\n`);

  let finished = false;
  let exitReason: "user_exit" | "server_closed" | "error" = "user_exit";
  let activeReq: http.ClientRequest | null = null;
  let resolveDone: (() => void) | null = null;
  const wasRaw = Boolean((process.stdin as any).isRaw);

  const onStdinData = (chunk: string | Buffer) => {
    const str = String(chunk);
    if (str === "q" || str === "Q" || str === "\u0003" || str === "\r" || str === "\n") {
      cleanup("user_exit");
    }
  };
  const onSigInt = () => cleanup("user_exit");
  const onSigTerm = () => cleanup("user_exit");

  const cleanup = (reason: "user_exit" | "server_closed" | "error") => {
    if (finished) return;
    finished = true;
    exitReason = reason;
    try {
      activeReq?.destroy();
    } catch {}
    activeReq = null;
    process.stdin.removeListener("data", onStdinData);
    process.removeListener("SIGINT", onSigInt);
    process.removeListener("SIGTERM", onSigTerm);
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
      try {
        process.stdin.setRawMode(wasRaw);
      } catch {}
    }
    try {
      process.stdin.pause();
    } catch {}
    console.log(`\n\x1b[90m[EXIT] Log monitor closed.\x1b[0m`);
    options?.onExit?.(reason);
    resolveDone?.();
  };

  try {
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onStdinData);
  } catch {}

  process.once("SIGINT", onSigInt);
  process.once("SIGTERM", onSigTerm);

  const connectHost = async (host: string): Promise<"connected" | "retry_v6" | "done"> => {
    return new Promise((resolve) => {
      if (finished) return resolve("done");
      let gotResponse = false;
      const url = host === "::1" ? `http://[::1]:${port}/logs` : `http://${host}:${port}/logs`;
      const req = http.get(url, (res) => {
        gotResponse = true;
        let buf = "";
        res.on("data", (chunk: Buffer) => {
          buf += chunk.toString("utf8");
          const items = buf.split(/\r?\n\r?\n/);
          buf = items.pop() || "";
          for (const item of items) {
            const parsed = parseSseEvent(item);
            if (parsed !== null) {
              console.log(parsed);
            }
          }
        });
        res.on("end", () => {
          if (!finished) {
            console.log(`\n\x1b[90m[STOP] サーバーとの接続が終了しました。\x1b[0m`);
            cleanup("server_closed");
          }
          resolve("done");
        });
      });
      activeReq = req;

      req.on("error", (err: any) => {
        if (finished) return resolve("done");
        if (!gotResponse && host === "127.0.0.1") {
          return resolve("retry_v6");
        }
        console.error(`\x1b[31m[ERROR] ログストリーム接続エラー: ${err.message}\x1b[0m`);
        cleanup("error");
        resolve("done");
      });
    });
  };

  await new Promise<void>(async (resolve) => {
    resolveDone = resolve;
    const r = await connectHost("127.0.0.1");
    if (r === "retry_v6" && !finished) {
      await connectHost("::1");
    }
    resolve();
  });

  return exitReason;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const cmd = (args[0] || "").toLowerCase();

  if (cmd === "stop") {
    const portArg = parseInt(args[1] || "", 10);
    const { stopped, port } = await stopLocalRunnerServer(!isNaN(portArg) ? portArg : undefined);
    if (stopped) {
      console.log(`\x1b[32m✓\x1b[0m ポート ${port} の Local Runner サーバーを停止しました。`);
    } else {
      console.log(`\x1b[90m稼働中の Local Runner サーバーは見つかりませんでした。\x1b[0m`);
    }
    process.exit(0);
  }

  if (cmd === "st" || cmd === "status") {
    const portArg = parseInt(args[1] || "", 10);
    const st = await getLocalRunnerStatus(!isNaN(portArg) ? portArg : undefined);
    if (st.running) {
      console.log(`[RUNNER] Local Runner: \x1b[32m稼働中\x1b[0m (http://localhost:${st.port}/, WSL: ${st.wslAvailable ? "ON" : "OFF"})`);
    } else {
      console.log(`[RUNNER] Local Runner: \x1b[90m停止中\x1b[0m`);
    }
    process.exit(0);
  }

  const portArg = parseInt(cmd === "start" ? (args[1] || "") : (args[0] || ""), 10);
  const port = !isNaN(portArg) ? portArg : DEFAULT_PORT;
  const running = await startLocalRunnerServer(port, { isStandalone: true });

  console.log(`\x1b[90m${hr("-")}\x1b[0m`);
  console.log(`  \x1b[1mOJ Local Runner Server\x1b[0m (CP Toolkit)`);
  console.log(`  Endpoint : \x1b[33mhttp://localhost:${running.port}/\x1b[0m`);
  console.log(`  Backend  : ${isWslOrLinuxAvailable() ? "\x1b[32mWSL2 (C++23 + PCH + RAM Disk)\x1b[0m" : "\x1b[33mNative C++\x1b[0m"}`);
  console.log(`  Setting  : CP Toolkit -> Local Runner URL: http://localhost:${running.port}/`);
  console.log(`  Stop     : Run 'oj stop' in another terminal or Ctrl+C`);
  console.log(`\x1b[90m${hr("-")}\x1b[0m`);
  console.log(`\x1b[90mWaiting for test requests...\x1b[0m\n`);
}
