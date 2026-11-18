/**
 * スクリプトから動かすヘッドレスのブラウザ（Edge か Chrome）。layout-shift.ts・loudness.ts から使う。
 * ブラウザが取り残されて worktree を消せなくなるのを防ぐため、次の 3 つを守る。
 * - 作業フォルダはプロファイルの一時フォルダにする。取り残されても worktree をつかまない
 * - 正常に終わったとき・例外で落ちたとき・Ctrl+C で止めたときのどれでも、プロセスツリーごと止めてプロファイルを消す
 * - 起動の前に、前の回の取り残しを scripts/reap.ps1 で止める（Windows）
 * スクリプトを外から強制終了されたときだけは止められないが、そのブラウザも次の回か reap.ps1 で止まる
 */
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WIN = process.platform === 'win32';

/** 使うブラウザ。環境変数 BROWSER が先 */
export function browserBin(): string {
  const bin = [
    process.env.BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ]
    .filter((p): p is string => !!p)
    .find((p) => existsSync(p));
  if (!bin) throw new Error('ブラウザが見つかりません。環境変数 BROWSER で Edge か Chrome を指してください');
  return bin;
}

/** 取り残されたヘッドレスブラウザを止める（Windows だけ。ほかの OS では親が終わればブラウザも終わる） */
export function reap(): void {
  if (!WIN) return;
  const ps1 = fileURLToPath(new URL('reap.ps1', import.meta.url));
  spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1], { stdio: 'ignore' });
}

/**
 * ブラウザをプロセスツリーごと止める。Windows の Edge は起動役のプロセスがすぐ終わり、本体は別の PID で動くので、
 * spawn の PID では止まらない。プロファイルのフォルダをコマンドラインに持つ本体を探して止める
 */
function killBrowser(p: ChildProcess, prof: string): void {
  if (!WIN) {
    if (p.exitCode === null) p.kill('SIGKILL');
    return;
  }
  const q = prof.replaceAll("'", "''");
  spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${q}') -and $_.CommandLine -notmatch '--type=' } | ForEach-Object { taskkill.exe /PID $_.ProcessId /T /F | Out-Null }`,
    ],
    { stdio: 'ignore' },
  );
}

/** 止めた直後はファイルがまだつかまれていることがあるので、少し待ちながら消す */
function removeDir(dir: string): void {
  const wait = new Int32Array(new SharedArrayBuffer(4));
  for (let i = 0; i < 20; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      Atomics.wait(wait, 0, 0, 150);
    }
  }
}

export interface Headless {
  /** CDP のポート */
  port: number;
  /** 止めてプロファイルを消す（何度呼んでもよい） */
  close(): void;
}

/**
 * ヘッドレスのブラウザを起動する。プロファイルは一時フォルダの nanase-tools-<name>-o<このスクリプトの PID>-…。
 * PID を名前に入れるのは、scripts/reap.ps1 が使い手の終わったブラウザを見分けるため
 */
export function launchHeadless(name: string, args: string[] = []): Headless {
  const bin = browserBin();
  reap();
  const prof = mkdtempSync(join(tmpdir(), `nanase-tools-${name}-o${process.pid}-`)),
    port = 9300 + Math.floor(Math.random() * 600),
    proc = spawn(
      bin,
      [
        '--headless=new',
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${prof}`,
        '--no-first-run',
        '--mute-audio',
        ...args,
        'about:blank',
      ],
      { stdio: 'ignore', cwd: prof },
    );
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    killBrowser(proc, prof);
    removeDir(prof);
  };
  /* 例外で落ちても exit は来る。Ctrl+C などのシグナルは exit を経ないので、止めてから終える */
  process.on('exit', close);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
    process.on(sig, () => {
      close();
      process.exit(130);
    });
  return { port, close };
}
