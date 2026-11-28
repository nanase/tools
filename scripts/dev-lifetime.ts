/**
 * 開発サーバの寿命（astro.config.ts の integrations に入れる。astro dev のときだけ動く）。
 * 取り残された開発サーバが worktree をつかみ続けないよう、次のときに自分で終わる。
 * - 起動した端末やコマンドが終わった: 起動したときの親をたどったプロセスのどれかが消えたら終わる
 *   - Windows では親を止めても子は止まらない。Claude Code のバックグラウンドの実行は時間の上限でシェルだけを止め、
 *     その下の bun・node が残っていた（2026-11-28）
 *   - Git Bash から起動すると、Windows の親は途中の中継のプロセスが先に終わって切れる。
 *     そのため Git Bash の中の親子（ps -l の PID・PPID）もたどり、そのどれかが消えたら終わる
 * - 使われていない: ページの要求も HMR の接続もないまま TOOLS_DEV_IDLE_MIN 分（既定 60）が過ぎたら終わる。0 なら見ない
 */
import { spawnSync } from 'node:child_process';
import type { AstroIntegration } from 'astro';

/** 親をたどるときに止める PID（Windows の System Idle・System、Unix の init） */
const ROOTS = new Set([0, 1, 4]);
const LINES = /\r?\n/;

/** すべてのプロセスの PID → 親の PID */
export function processTable(): Map<number, number> {
  const t = new Map<number, number>();
  const r =
    process.platform === 'win32'
      ? spawnSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }',
          ],
          { encoding: 'utf8', windowsHide: true },
        )
      : spawnSync('ps', ['-A', '-o', 'pid=', '-o', 'ppid='], { encoding: 'utf8' });
  for (const line of (r.stdout ?? '').split(LINES)) {
    const [a, b] = line.trim().split(/\s+/).map(Number);
    if (Number.isInteger(a) && Number.isInteger(b)) t.set(a as number, b as number);
  }
  return t;
}

/** pid の親から上へたどった PID の並び（自分は含めない。根・表にない PID・輪で止める） */
export function ancestors(table: ReadonlyMap<number, number>, pid: number, max = 24): number[] {
  const out: number[] = [];
  const seen = new Set([pid]);
  let p = table.get(pid);
  while (p !== undefined && !ROOTS.has(p) && !seen.has(p) && table.has(p) && out.length < max) {
    out.push(p);
    seen.add(p);
    p = table.get(p);
  }
  return out;
}

/** Git Bash（MSYS）のプロセスの 1 行: 親の MSYS の PID と Windows の PID */
export interface MsysRow {
  ppid: number;
  winpid: number;
}

/** Git Bash（MSYS）のプロセスの表（MSYS の PID → 行）。ps が MSYS のものでなければ null */
export function msysTable(): Map<number, MsysRow> | null {
  if (process.platform !== 'win32') return null;
  const r = spawnSync('ps', ['-l'], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0 || !r.stdout) return null;
  return parseMsys(r.stdout);
}

/** ps -l の出力（PID PPID PGID WINPID …）を読む */
export function parseMsys(out: string): Map<number, MsysRow> | null {
  const lines = out.split(LINES);
  if (!/^\s*PID\s+PPID\s+PGID\s+WINPID/.test(lines[0] ?? '')) return null;
  const t = new Map<number, MsysRow>();
  for (const line of lines.slice(1)) {
    const [pid, ppid, , winpid] = line.trim().split(/\s+/).map(Number);
    if (Number.isInteger(pid) && Number.isInteger(ppid) && Number.isInteger(winpid))
      t.set(pid as number, { ppid: ppid as number, winpid: winpid as number });
  }
  return t;
}

/**
 * Windows の親の並び（近い順）のうち最も上にある MSYS のプロセスから、MSYS の親をたどった MSYS の PID の並び。
 * MSYS の init（PID 1）の手前で止める
 */
export function msysOwners(t: ReadonlyMap<number, MsysRow>, winOwners: readonly number[]): number[] {
  const byWin = new Map([...t].map(([pid, r]) => [r.winpid, pid]));
  let start: number | undefined;
  for (const w of winOwners) {
    const c = byWin.get(w);
    if (c !== undefined) start = c;
  }
  const out: number[] = [];
  let p = start;
  while (p !== undefined && p > 1 && !out.includes(p) && t.has(p) && out.length < 24) {
    out.push(p);
    p = t.get(p)?.ppid;
  }
  return out;
}

/** プロセスが生きているか。権限がなくて調べられないものは生きているとみなす */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** MSYS の PID がすべて残っているか（ps を読めなければ残っているとみなす） */
function msysAlive(pids: readonly number[]): boolean {
  const t = msysTable();
  return !t || pids.every((p) => t.has(p));
}

/** 使われていない時間が上限を過ぎたか。接続中の HMR があれば使われているとみなす */
export function idleOver(last: number, now: number, clients: number, minutes: number): boolean {
  return minutes > 0 && clients === 0 && now - last >= minutes * 60_000;
}

/** 環境変数の分。読めなければ既定の 60 */
export function idleMinutes(env: string | undefined): number {
  const v = env === undefined || env.trim() === '' ? Number.NaN : Number(env);
  return Number.isFinite(v) && v >= 0 ? v : 60;
}

const KEY = Symbol.for('tools.devLifetime');

export function devLifetime(): AstroIntegration {
  return {
    name: 'dev-lifetime',
    hooks: {
      'astro:server:setup': ({ server, logger }) => {
        /* 設定を変えて astro がサーバを作り直しても、見張りは 1 つだけにする */
        const g = globalThis as { [KEY]?: { last: number; server: typeof server } };
        const first = !g[KEY];
        g[KEY] = { last: Date.now(), server };
        server.middlewares.use((_req, _res, next) => {
          const s = g[KEY];
          if (s) s.last = Date.now();
          next();
        });
        if (!first) return;
        const stop = (why: string) => {
          logger.info(`${why}ので、開発サーバを止めます`);
          process.exit(0);
        };
        const owners = ancestors(processTable(), process.pid);
        const m0 = msysTable(),
          mOwners = m0 ? msysOwners(m0, [process.pid, ...owners]) : [];
        setInterval(() => {
          const gone = owners.some((p) => !alive(p)) || (mOwners.length > 0 && !msysAlive(mOwners));
          if (gone) stop('起動した端末やコマンドが終わった');
        }, 5_000).unref();
        const min = idleMinutes(process.env.TOOLS_DEV_IDLE_MIN);
        if (min > 0)
          setInterval(
            () => {
              const s = g[KEY];
              if (!s) return;
              const clients = s.server.ws.clients.size;
              if (clients > 0) s.last = Date.now();
              if (idleOver(s.last, Date.now(), clients, min)) stop(`${min} 分のあいだ使われなかった`);
            },
            Math.min(60_000, min * 30_000),
          ).unref();
      },
    },
  };
}
