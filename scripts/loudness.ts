/**
 * 音の出るページを既定のまま鳴らし、聞こえの大きさ（LUFS）を測る。目標と決め方は DEVELOPMENT.md の「音の大きさ」
 *
 *   bun run dev                       # 別の端末で開発サーバを起動しておく
 *   bun run loudness                  # SCENES の全ページ
 *   bun run loudness piano sort       # 指定したページだけ
 *   bun run loudness --base http://127.0.0.1:4330 piano
 *
 * ヘッドレスの Edge（なければ環境変数 BROWSER のブラウザ）を CDP で動かす。
 * ページの AudioContext の destination の手前に AudioWorklet を挟み、K 特性の二乗平均を 100 ms ごとに集める
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activeRatio, integrated, kWeight } from './loudness-meter';

/** 新しいページの既定の大きさの目標 [LUFS]。±2 LU に収める */
const TARGET = -26;
const TOL = 2;

/**
 * ページを開いた人が最初にする操作と、測る秒数。click は押すボタンの CSS セレクタで、1 秒おきに順に押す。
 * play は止まっているときだけ押す再生ボタン。key は押したままにするキー（KeyboardEvent の code）。操作がなければ開いたまま測る。
 * ear は耳で聴いて目標からずらした量 [LU]。低い音が主のページは LUFS が耳より小さめに出る
 */
type Scene = { click?: string[]; play?: string; key?: string; ear?: number; dur: number };
const SCENES: Record<string, Scene> = {};
const put = (pages: string[], s: Scene) => {
  for (const p of pages) SCENES[p] = s;
};
put(['piano', 'organ', 'guitar', 'violin', 'trumpet', 'fm-synth'], { click: ['#tp-pp'], dur: 30 });
put(['piano-action'], { click: ['#tp-pp'], dur: 20 });
/* ヘッドレスでは開いたときに止まっていることがあるので、止まっていれば押す */
put(['sort', 'list-queue-stack', 'binary-heap', 'b-tree', 'red-black-tree', 'dictionary', 'expression-parsing'], {
  play: '#tp-pp',
  dur: 20,
});
put(['thunder'], { click: ['#th-pp'], dur: 25 });
put(['noise', 'doppler', 'reverb', 'temperament', 'bifurcation', 'biquad', 'fir', 'iir', 'pole-zero', 'jjy'], {
  click: ['#playBtn'],
  dur: 15,
});
/* エンジンはアイドリングと全開で 20 dB ほど違うので、スロットル 50 % で測る */
put(['engine'], { click: ['#runBtn'], key: 'Digit5', ear: 8, dur: 15 });
put(['transmission'], { click: ['#tm-snd', '#tm-auto'], ear: 8, dur: 40 });
put(['shepard-tone'], { click: ['#sht-play'], dur: 20 });
put(['pcm', 'mp3', 'adpcm'], { click: ['#ls-pp'], dur: 15 });
put(['wavelet-denoise'], { click: ['#ab-pp'], dur: 15 });
put(['sampling-theorem'], { click: ['#smp-pp'], dur: 15 });
put(['vvvf'], { click: ['#vv-auto'], dur: 40 });

/* ---------- ページへ入れる計測 ---------- */
const PROC = `${kWeight.toString()}
class LuTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.f = kWeight(sampleRate);
    this.s = [0, 0, 0, 0].map(() => [0, 0]);
    this.sub = Math.round(sampleRate * 0.1);
    this.y = new Float64Array(128);
    this.n = 0; this.k = 0; this.pk = 0;
  }
  process(inputs) {
    const inp = inputs[0];
    for (let ch = 0; ch < 2 && inp.length; ch++) {
      const x = inp[Math.min(ch, inp.length - 1)];
      for (let j = 0; j < 2; j++) {
        const f = this.f[j], s = this.s[ch * 2 + j];
        for (let i = 0; i < x.length; i++) {
          const v = j ? this.y[i] : x[i], y = f.b0 * v + s[0];
          s[0] = f.b1 * v - f.a1 * y + s[1];
          s[1] = f.b2 * v - f.a2 * y;
          this.y[i] = y;
        }
      }
      for (let i = 0; i < x.length; i++) {
        this.k += this.y[i] * this.y[i];
        const a = Math.abs(x[i]);
        if (a > this.pk) this.pk = a;
      }
    }
    this.n += 128;
    if (this.n >= this.sub) {
      this.port.postMessage([this.k / this.n, this.pk]);
      this.n = 0; this.k = 0; this.pk = 0;
    }
    return true;
  }
}
registerProcessor('lu-tap', LuTap);`;

/** ページの中で動く。モノラルの出力は左右に同じ音として数える */
function tap(proc: string): void {
  const url = URL.createObjectURL(new Blob([proc], { type: 'application/javascript' })),
    /* 元の connect。重なった型のどれにも合うよう、引数をゆるく受ける形にする */
    conn = AudioNode.prototype.connect as unknown as (
      this: AudioNode,
      d: AudioNode | AudioParam,
      ...r: number[]
    ) => AudioNode,
    taps = new Map<BaseAudioContext, GainNode>(),
    recs: { blk: [number, number][]; from: number }[] = [];
  const tapOf = (ac: BaseAudioContext) => {
    let g = taps.get(ac);
    if (g) return g;
    g = ac.createGain();
    conn.call(g, ac.destination);
    taps.set(ac, g);
    const rec = { blk: [] as [number, number][], from: 0 };
    recs.push(rec);
    void ac.audioWorklet.addModule(url).then(() => {
      const n = new AudioWorkletNode(ac, 'lu-tap', {
        numberOfOutputs: 0,
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      });
      n.port.onmessage = (e) => rec.blk.push(e.data);
      conn.call(g, n);
    });
    return g;
  };
  AudioNode.prototype.connect = function (this: AudioNode, dest: AudioNode | AudioParam, ...rest: number[]) {
    if (dest instanceof AudioDestinationNode && !(dest.context instanceof OfflineAudioContext)) {
      conn.call(this, tapOf(dest.context), rest[0] ?? 0, 0);
      return dest;
    }
    return conn.call(this, dest, ...rest);
  } as unknown as typeof AudioNode.prototype.connect;
  Object.assign(window, {
    __lu: {
      reset: () => {
        for (const r of recs) r.from = r.blk.length;
      },
      take: () => recs.map((r) => r.blk.slice(r.from)),
    },
  });
}

/* ---------- ブラウザ ---------- */
const args = process.argv.slice(2);
let base = 'http://127.0.0.1:4321';
const bi = args.indexOf('--base');
if (bi >= 0) base = args.splice(bi, 2)[1].replace(/\/$/, '');
const pages = args.length ? args : Object.keys(SCENES);
for (const p of pages)
  if (!SCENES[p]) throw new Error(`${p} の場面がありません。scripts/loudness.ts の SCENES に足してください`);
if (!(await fetch(`${base}/tools/`).catch(() => null))?.ok)
  throw new Error(`${base}/tools/ が開けません。bun run dev で開発サーバを起動してください`);

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
const prof = mkdtempSync(join(tmpdir(), 'nanase-tools-loudness-')),
  port = 9300 + Math.floor(Math.random() * 600);
const browser = spawn(
  bin,
  [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    `--user-data-dir=${prof}`,
    '--no-first-run',
    '--window-size=1400,1000',
    'about:blank',
  ],
  { stdio: 'ignore' },
);
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

async function cdp(): Promise<{ webSocketDebuggerUrl: string }> {
  for (let i = 0; i < 100; i++) {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`).catch(() => null);
    if (r?.ok) return r.json();
    await sleep(200);
  }
  throw new Error('ブラウザに CDP でつながりません');
}

async function openTab() {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((ok) => {
    ws.onopen = ok;
  });
  let id = 0;
  const wait = new Map<
    number,
    (m: { result?: { result?: { value?: unknown }; exceptionDetails?: unknown } }) => void
  >();
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    wait.get(m.id)?.(m);
    wait.delete(m.id);
  };
  const send = (method: string, params: object = {}) =>
    new Promise<{ result?: { result?: { value?: unknown }; exceptionDetails?: unknown } }>((ok) => {
      wait.set(++id, ok);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const run = async <T>(expr: string): Promise<T> => {
    const r = await send('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
    return r.result?.result?.value as T;
  };
  return { ws, send, run };
}

/* ---------- 測る ---------- */
await cdp();
const rows: [string, string][] = [];
const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1).replace('-', '−') : '—');
for (const p of pages) {
  const sc = SCENES[p],
    tab = await openTab();
  try {
    await tab.send('Page.enable');
    await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${tap.toString()})(${JSON.stringify(PROC)})` });
    await tab.send('Page.navigate', { url: `${base}/tools/${p}/` });
    await sleep(5000);
    for (const [i, c] of (sc.click ?? []).entries()) {
      if (i) await sleep(1000);
      await tab.run(
        `(() => { const b = document.querySelector(${JSON.stringify(c)}); if (!b) throw new Error('${c} がありません'); b.click(); return 1; })()`,
      );
    }
    if (sc.play)
      await tab.run(
        `(() => { const b = document.querySelector(${JSON.stringify(sc.play)}); if (!b) throw new Error('${sc.play} がありません'); if (!/停止/.test(b.getAttribute('aria-label') ?? '')) b.click(); return 1; })()`,
      );
    if (sc.key) {
      /* 回転が上がりきるまで待ってから測る */
      await sleep(1000);
      await tab.run(`document.body.dispatchEvent(new KeyboardEvent('keydown', { code: '${sc.key}', bubbles: true }))`);
      await sleep(3000);
    }
    await tab.run('window.__lu.reset()');
    await sleep(sc.dur * 1000);
    const ctxs = await tab.run<[number, number][][]>('window.__lu.take()');
    /* AudioContext が複数あれば、いちばん大きいものを採る */
    const best = ctxs
      .map((b) => ({
        I: integrated(b.map((x) => x[0])),
        act: activeRatio(b.map((x) => x[0])),
        pk: 20 * Math.log10(Math.max(1e-12, ...b.map((x) => x[1]))),
      }))
      .sort((a, b) => b.I - a.I)[0];
    if (!best || !Number.isFinite(best.I)) rows.push([p, '音が出ません']);
    else {
      const diff = best.I - TARGET - (sc.ear ?? 0),
        mark = Math.abs(diff) <= TOL ? '' : `  ← 既定の音量を ${f1(-diff)} dB`;
      rows.push([
        p,
        `${f1(best.I)} LUFS  差 ${diff >= 0 ? '+' : ''}${f1(diff)}${sc.ear ? `（耳で ${sc.ear >= 0 ? '+' : ''}${f1(sc.ear)} LU）` : ''}  ピーク ${f1(best.pk)} dBFS  音のある区間 ${Math.round(best.act * 100)} %${mark}`,
      ]);
    }
  } catch (e) {
    rows.push([p, `測れません: ${String(e).slice(0, 200)}`]);
  }
  console.log(rows[rows.length - 1].map((s, i) => (i ? s : s.padEnd(20))).join(''));
  await tab.send('Page.close').catch(() => {});
  tab.ws.close();
}
console.log(`目標 ${f1(TARGET)} LUFS ± ${TOL} LU`);

const ws = new WebSocket((await cdp()).webSocketDebuggerUrl);
await new Promise((ok) => {
  ws.onopen = ok;
});
ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
await sleep(500);
browser.kill();
rmSync(prof, { recursive: true, force: true });
process.exit(0);
