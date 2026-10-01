/**
 * JJY デコーダの入口: 入力（マイク・ファイル・テスト信号）→ 包絡線（AudioWorklet・Worker）→ 復号 →
 * 受信の表示窓・タイムコード・復号した時刻・フラグ・代入した式
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { fmt, fmtR, minus, ro } from '../../lib/format';
import { ParamGroup } from '../../lib/param';
import { DV, GY, SW } from '../../lib/scope';
import { addTip, initToolPage } from '../../lib/tool-page';
import { CNAME, DEFAULTS, meaning, Signal, WIDTH } from '../jjy/code';
import { drawFan } from '../jjy/fan';
import { diffHtml, jst, p2, WD } from '../jjy/time';
import { Decoder, decodeAll, evalFrame, type Frame, half, hm, hms, nn, type Res, type Sym, todOf } from './decoder';
import { analyzeFile, type FileEnv, peakF } from './dsp';
import { FLAGS, yNote } from './flags';
import { substHtml } from './math';
import { F_PARAM } from './params';
import { type ProcIn, type ProcOut, procInit, procMsg, procStep, RAW_N } from './proc';
import { type SynthState, synth, testWav } from './synth';
import type { Job, Reply } from './worker';
import workletUrl from './worklet.ts?worker&url';

initToolPage();
addTip($('#srcBtn'), $('#srcTip'), $('.a-in'), true);

/* ---------- 知らせ ---------- */
let toastT: ReturnType<typeof setTimeout> | undefined;
function toast(msg: string): void {
  const t = $('#toast');
  t.textContent = msg;
  delete t.dataset.off;
  clearTimeout(toastT);
  toastT = setTimeout(() => {
    t.dataset.off = '';
  }, 2600);
}

const txt = (id: string, s: string) => {
  const el = $(id);
  if (el.textContent !== s) el.textContent = s;
};
const html = (id: string, h: string) => {
  const el = $(id);
  if (el.innerHTML !== h) el.innerHTML = h;
};
/**
 * 復号の結果の印（項目名の後ろ）: ok は読めた、ng は読めなかった、
 * pv は仮の値（パリティや 1 分の終わりを確かめる前）、'' はまだ受け取っていない
 */
type Mark = '' | 'ok' | 'ng' | 'pv';
const mark = (id: string, m: Mark) => {
  const el = $(id).closest<HTMLElement>('.m');
  if (!el || (el.dataset.ck ?? '') === m) return;
  if (m) el.dataset.ck = m;
  else delete el.dataset.ck;
};

/* =====================================================================
   入力
   ===================================================================== */
type Src = 'mic' | 'file' | 'test';
type Fm = 'auto' | 'manual';
const ui = { src: 'mic' as Src, fm: 'auto' as Fm, mon: false };
/** モニター（テスト信号をスピーカーで鳴らす）の音量: −30 dB */
const MON = 10 ** (-30 / 20);
const SRC_SUB: Record<Src, string> = {
  mic: 'マイク・ライン入力',
  file: 'WAV・MP3 など（先頭の 10 分まで）',
  test: 'シミュレータと同じ規則の 440 Hz',
};

/** 手動の搬送波の周波数（自動の間は欄に推定した周波数を出すので、手動の値はここに持つ） */
let manualF = F_PARAM.v;
const g = new ParamGroup<'f'>([F_PARAM], (v, k) => {
  if (!k || ui.fm !== 'manual') return;
  manualF = v.f;
  carrierChanged();
});

const src = new Choice<Src>($('#p-src'), (v) => {
  if (live.on) liveStop();
  ui.src = v;
  dec = null;
  live.anc = null;
  pinned = -1;
  hover = -1;
  syncIn();
  reset();
});
const fm = new Choice<Fm>($('#p-fm'), (v) => {
  ui.fm = v;
  syncIn();
  carrierChanged();
});
const mon = new Choice<'0' | '1'>($('#p-mon'), (v) => {
  ui.mon = v === '1';
  if (gen.mon && live.ac) gen.mon.gain.setTargetAtTime(ui.mon ? MON : 0, live.ac.currentTime, 0.015);
});
const runBtn = $('#runBtn');
const mRun = $('#m-run');

/** 入力の行の状態（押せる・押せない、注記）を今の入力元に合わせる */
function syncIn(): void {
  const s = ui.src,
    file = s === 'file';
  src.set(s);
  runBtn.setAttribute('aria-pressed', String(live.on));
  txt('#runT', live.on ? '停止' : '開始');
  $('#runSeg').hidden = file;
  $('#fileSeg').hidden = !file;
  $('#wavBtn').hidden = s !== 'test';
  txt('#runName', file ? 'ファイル' : '受信');
  txt('#t-run', SRC_SUB[s]);
  fm.set(ui.fm);
  mon.set(ui.mon ? '1' : '0');
  /* モニターはテスト信号のときだけ使うので、ほかの入力元では行ごと隠す */
  mon.root.hidden = s !== 'test';
  showCarrier();
}

/** 搬送波の行: 自動のときは周波数の行を隠し、使っている周波数を注記に出す */
function showCarrier(): void {
  const f = curF(),
    auto = ui.fm === 'auto';
  $('#p-f').hidden = auto;
  fm.note(
    !auto ? '' : f > 0 ? `自動: ${fmtR(f, 'Hz', 5)} を使っています` : '自動: 入力から最も振幅の大きい周波数を探します',
  );
  if (!auto && g.get('f') !== manualF) g.set('f', manualF, { silent: true });
}
const curF = (): number => (ui.src === 'file' ? (fileRes?.f ?? Number.NaN) : live.f);

runBtn.addEventListener('click', async () => {
  if (!live.on) await liveStart(ui.src);
  else liveStop();
  syncIn();
});

/** 搬送波の決め方か手動の値が変わった */
let reT: ReturnType<typeof setTimeout> | undefined;
function carrierChanged(): void {
  if (ui.src === 'file') {
    clearTimeout(reT);
    if (fileData) reT = setTimeout(analyze, 250);
    return;
  }
  if (!live.on) return;
  live.fh = [];
  if (ui.fm === 'manual') {
    live.f = manualF;
    live.node?.send({ f: manualF });
  }
  showCarrier();
}

/* =====================================================================
   受信（マイク・テスト信号）: Web Audio API → AudioWorklet（包絡線）→ 復号
   ===================================================================== */
/** 包絡線を取り出すノード（AudioWorklet か、使えない環境では ScriptProcessor） */
interface ProcNode {
  node: AudioNode;
  send(d: ProcIn): void;
  close(): void;
}
/** 時計の合わせ: off（信号 − 端末の時計）か、年と日付がなければ 1 日の中の差 tod */
interface Anchor {
  off?: number;
  tod?: number;
  r: Res;
}
const live = {
  ac: null as AudioContext | null,
  node: null as ProcNode | null,
  mute: null as GainNode | null,
  stream: null as MediaStream | null,
  src: null as AudioNode | null,
  on: false,
  /** AudioWorklet を使えるか（未確認は undefined） */
  wk: undefined as boolean | undefined,
  /** 包絡線の位置 0 の端末の時計（UTC の ms） */
  W0: Number.NaN,
  lag: 0,
  inLat: 0,
  f: Number.NaN,
  fh: [] as number[],
  anc: null as Anchor | null,
  label: '',
};
let dec: Decoder | null = null;

type Ctor = typeof AudioContext;
const AC: Ctor | undefined =
  globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;

async function makeNode(ac: AudioContext, on: (d: ProcOut) => void): Promise<ProcNode> {
  if (live.wk === undefined) {
    live.wk = false;
    if (ac.audioWorklet) {
      try {
        await ac.audioWorklet.addModule(workletUrl);
        live.wk = true;
      } catch {
        /* AudioWorklet を読み込めない環境では ScriptProcessor に切り替える */
      }
    }
  }
  if (live.wk) {
    const n = new AudioWorkletNode(ac, 'jjy-env', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: 'explicit',
    });
    n.port.onmessage = (e: MessageEvent<ProcOut>) => on(e.data);
    return {
      node: n,
      send: (d) => n.port.postMessage(d),
      close: () => {
        n.port.onmessage = null;
      },
    };
  }
  const sp = ac.createScriptProcessor(2048, 1, 1),
    st = procInit();
  sp.onaudioprocess = (ev) => procStep(st, ev.inputBuffer.getChannelData(0), ac.sampleRate, ac.currentTime, on);
  return {
    node: sp,
    send: (d) => procMsg(st, ac.sampleRate, d),
    close: () => {
      sp.onaudioprocess = null;
    },
  };
}

const MIC_ERR: Record<string, string> = {
  NotAllowedError: 'マイクの使用が許可されませんでした',
  SecurityError: 'マイクの使用が許可されませんでした',
  NotFoundError: 'マイクが見つかりません',
  NotReadableError: 'マイクをほかのアプリが使っています',
};
async function liveStart(kind: Src): Promise<void> {
  if (!AC) {
    mRun.textContent = 'この環境では音声を扱えません';
    return;
  }
  let stream: MediaStream | null = null;
  if (kind === 'mic') {
    if (!navigator.mediaDevices?.getUserMedia) {
      mRun.textContent = 'この環境ではマイクを使えません';
      return;
    }
    mRun.textContent = 'マイクを準備しています…';
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
    } catch (e) {
      const n = e instanceof Error ? e.name : String(e);
      mRun.textContent = MIC_ERR[n] || `マイクを使えませんでした（${n}）`;
      return;
    }
  }
  live.ac ??= new AC();
  const ac = live.ac;
  try {
    await ac.resume();
  } catch {
    /* 再生を始められない環境 */
  }
  const pn = await makeNode(ac, onProc);
  let s: AudioNode;
  if (stream) {
    s = ac.createMediaStreamSource(stream);
    const tr = stream.getAudioTracks()[0],
      st = (tr?.getSettings?.() ?? {}) as MediaTrackSettings & { latency?: number };
    live.inLat = (st.latency || 0) * 1000;
    live.label = tr?.label || 'マイク';
  } else {
    s = genStart(ac);
    live.inLat = 0;
  }
  live.mute = ac.createGain();
  live.mute.gain.value = 0;
  s.connect(pn.node);
  pn.node.connect(live.mute).connect(ac.destination);
  Object.assign(live, { node: pn, src: s, stream, on: true, W0: Number.NaN, fh: [], anc: null, f: Number.NaN });
  dec = new Decoder(17);
  dec.onFrame = anchor;
  if (ui.fm === 'manual') {
    live.f = manualF;
    pn.send({ f: manualF });
  }
  const fsT = fmt(ac.sampleRate, 'Hz', 3);
  mRun.textContent = kind === 'mic' ? `${live.label}・${fsT}` : `440 Hz・この端末の時計の時刻・${fsT}`;
  pinned = -1;
  hover = -1;
  reset();
}
function liveStop(): void {
  live.on = false;
  for (const t of live.stream?.getTracks() ?? []) t.stop();
  try {
    live.src?.disconnect();
    live.node?.node.disconnect();
  } catch {
    /* 切断済み */
  }
  live.node?.close();
  genStop();
  Object.assign(live, { stream: null, src: null, node: null });
  const ac = live.ac;
  if (ac)
    setTimeout(() => {
      if (!live.on) ac.suspend();
    }, 200);
  mRun.textContent = '';
  reset();
}
/** 包絡線の続き。文脈の時刻と端末の時計の対応を取りながら復号器へ流す */
function onProc(d: ProcOut): void {
  if (!live.on || !dec || !live.ac) return;
  if ('raw' in d) {
    if (ui.fm === 'auto') autoF(d.raw, d.fs);
    return;
  }
  const now = Date.now();
  for (let i = 0; i < d.a.length; i++) dec.push(d.a[i], d.p[i]);
  live.lag = d.lag;
  const kEnd = d.k0 + d.a.length - 1,
    cEnd = d.c0 + (kEnd + 1) / 1000;
  const w0 = now + (cEnd - live.ac.currentTime) * 1000 - live.inLat - kEnd;
  live.W0 = Number.isFinite(live.W0) ? live.W0 + 0.05 * (w0 - live.W0) : w0;
  scopeDirty = true;
}
/** 包絡線の位置 k（ms）の端末の時計（UTC のミリ秒）。平均の遅れ（窓の半分）を差し引く */
const wallOf = (k: number) => live.W0 + k - live.lag;
/** 自動: 直近 3 回の推定の中央値。0.2 % 以上変わったときだけ検波の周波数を変える */
function autoF(raw: Float32Array, fs: number): void {
  const r = peakF(raw, fs, RAW_N);
  if (!r) return;
  live.fh = live.fh.concat(r.f).slice(-3);
  const f = live.fh.slice().sort((a, b) => a - b)[live.fh.length >> 1];
  if (!(live.f > 0) || Math.abs(f - live.f) > Math.max(0.5, live.f * 0.002)) {
    live.f = f;
    live.node?.send({ f });
    showCarrier();
  }
}
/** 1 日の中の時刻と、それが合っている分から時計の合わせを作る */
function anchorOf(r: Res, w: number): Anchor {
  return r.epoch > 0 ? { off: r.epoch - w, r } : { tod: half(r.tod - todOf(w)), r };
}
/** 検査を通った分で時計を合わせる */
function anchor(f: Frame): void {
  const r = f.res;
  if (!r?.ok || !Number.isFinite(live.W0)) return;
  live.anc = anchorOf(r, wallOf(f.t0));
}

/* ---------- テスト信号: シミュレータと同じ規則。画面が裏に回っても途切れないよう 60〜90 秒先まで作り置きする ---------- */
const tsig = new Signal({ ...DEFAULTS });
const gen = {
  out: null as GainNode | null,
  mon: null as GainNode | null,
  srcs: [] as AudioBufferSourceNode[],
  /** 始めた時の端末の時計と文脈の時刻、予約した終わり */
  w0: 0,
  c0: 0,
  end: 0,
  st: { g: null, i: 0 } as SynthState,
};
function genStart(ac: AudioContext): GainNode {
  const out = ac.createGain(),
    m = ac.createGain();
  m.gain.value = ui.mon ? MON : 0;
  out.connect(m).connect(ac.destination);
  Object.assign(gen, {
    out,
    mon: m,
    w0: Date.now(),
    c0: ac.currentTime,
    end: ac.currentTime + 0.1,
    st: { g: null, i: 0 },
    srcs: [],
  });
  genFill();
  return out;
}
function genFill(): void {
  const ac = live.ac,
    out = gen.out;
  if (!out || !ac) return;
  while (gen.end - ac.currentTime < 60) {
    const fs = ac.sampleRate,
      n = Math.round(30 * fs),
      b = ac.createBuffer(1, n, fs),
      s = ac.createBufferSource();
    synth(tsig, b.getChannelData(0), fs, gen.w0 + (gen.end - gen.c0) * 1000, gen.st);
    s.buffer = b;
    s.connect(out);
    s.start(gen.end);
    s.onended = () => {
      gen.srcs = gen.srcs.filter((x) => x !== s);
    };
    gen.srcs.push(s);
    gen.end += n / fs;
  }
}
function genStop(): void {
  if (!gen.out) return;
  for (const s of gen.srcs) {
    try {
      s.stop();
      s.disconnect();
    } catch {
      /* 停止済み */
    }
  }
  try {
    gen.out.disconnect();
    gen.mon?.disconnect();
  } catch {
    /* 切断済み */
  }
  Object.assign(gen, { out: null, mon: null, srcs: [] });
}
setInterval(genFill, 1000);

/* テスト信号を WAV にする（8 kHz・16 bit・3 分。今の時刻から） */
$('#wavBtn').addEventListener('click', () => {
  const t0 = Date.now(),
    t = jst(t0),
    a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([testWav(tsig, t0, 180)], { type: 'audio/wav' }));
  a.download = `jjy-test-${t.y}${p2(t.mo)}${p2(t.d)}-${p2(t.h)}${p2(t.mi)}${p2(t.s)}.wav`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`${p2(t.h)}:${p2(t.mi)}:${p2(t.s)} から 3 分ぶんのテスト信号を保存しました`);
});

/* =====================================================================
   ファイル: 読み込み → Worker で包絡線 → 復号（一度に全体を読む）
   ===================================================================== */
const MAX_SEC = 600;
let fileData: { name: string; x: Float32Array; fs: number; dur: number; cut: boolean } | null = null,
  fileRes: (FileEnv & { dec: Decoder; frames: Frame[] }) | null = null,
  fsel = 0;
const fileIn = $<HTMLInputElement>('#fileIn');
$('#fileBtn').addEventListener('click', () => fileIn.click());
fileIn.addEventListener('change', () => {
  const f = fileIn.files?.[0];
  if (f) loadFile(f);
  fileIn.value = '';
});
const inPnl = $('.a-in');
inPnl.addEventListener('dragover', (e) => {
  if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) {
    e.preventDefault();
    inPnl.classList.add('drop');
  }
});
inPnl.addEventListener('dragleave', (e) => {
  if (!inPnl.contains(e.relatedTarget as Node | null)) inPnl.classList.remove('drop');
});
inPnl.addEventListener('drop', (e) => {
  e.preventDefault();
  inPnl.classList.remove('drop');
  const f = e.dataTransfer?.files?.[0];
  if (!f) return;
  if (ui.src !== 'file') {
    if (live.on) liveStop();
    ui.src = 'file';
    syncIn();
  }
  loadFile(f);
});
type OCtor = typeof OfflineAudioContext;
const OAC: OCtor | undefined =
  globalThis.OfflineAudioContext ??
  (globalThis as unknown as { webkitOfflineAudioContext?: OCtor }).webkitOfflineAudioContext;
async function loadFile(file: File): Promise<void> {
  mRun.textContent = `${file.name} を読んでいます…`;
  let ab: AudioBuffer;
  try {
    if (!OAC) throw new Error('no audio');
    ab = await new OAC(1, 1, 48000).decodeAudioData(await file.arrayBuffer());
  } catch {
    mRun.textContent = `${file.name} を音声として読めませんでした`;
    return;
  }
  const n = Math.min(ab.length, MAX_SEC * ab.sampleRate),
    x = new Float32Array(n),
    ch = ab.numberOfChannels;
  for (let c = 0; c < ch; c++) {
    const d = ab.getChannelData(c);
    for (let i = 0; i < n; i++) x[i] += d[i] / ch;
  }
  fileData = { name: file.name, x, fs: ab.sampleRate, dur: ab.duration, cut: ab.length > n };
  await analyze();
}
/** Worker で包絡線を求める。Worker を使えない環境ではメインスレッドで求める */
function runWorker(x: Float32Array, fs: number, f: number): Promise<Reply> {
  return new Promise((res) => {
    let w: Worker;
    try {
      w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    } catch {
      res(analyzeFile(x, fs, f));
      return;
    }
    w.onmessage = (e: MessageEvent<Reply>) => {
      res(e.data);
      w.terminate();
    };
    w.onerror = (e) => {
      e.preventDefault();
      w.terminate();
      res(analyzeFile(x, fs, f));
    };
    w.postMessage({ x, fs, f } satisfies Job);
  });
}
async function analyze(): Promise<void> {
  if (!fileData) return;
  const { name, x, fs, dur, cut } = fileData;
  mRun.textContent = `${name} を解読しています…`;
  const r = await runWorker(x, fs, ui.fm === 'manual' ? manualF : 0);
  if (!r) {
    mRun.textContent = `${name} は短すぎて解読できません`;
    fileRes = null;
    reset();
    return;
  }
  const d = decodeAll(r.env, r.pw);
  fileRes = { ...r, dec: d, frames: d.frames };
  const okI = d.frames.findIndex((f) => f.res?.ok);
  fsel = okI >= 0 ? okI : 0;
  mRun.textContent = `${name}・${Math.floor(dur / 60)}:${p2(Math.floor(dur % 60))}${cut ? '（先頭の 10 分）' : ''}`;
  pinned = -1;
  hover = -1;
  showCarrier();
  reset();
}
$('#fmins').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('[data-i]');
  if (!b) return;
  fsel = Number(b.dataset.i);
  pinned = -1;
  hover = -1;
  reset();
});

/* =====================================================================
   画面: タイムコード・受信・時刻・フラグ
   ===================================================================== */
let pinned = -1,
  hover = -1,
  scopeDirty = true,
  lastKey = '';
const tc = $('#tc'),
  bars = $$('.tb', tc),
  BASE = bars.map((b) => b.className);
/** いま見せている分: ファイルは選んだ分、受信は受信中の分。cur は受信中の秒 */
interface View {
  file: boolean;
  d: Decoder | null;
  fr: Frame | null;
  cur: number;
}
function view(): View {
  if (ui.src === 'file') return { file: true, d: fileRes?.dec ?? null, fr: fileRes?.frames[fsel] ?? null, cur: -1 };
  if (!dec) return { file: false, d: null, fr: null, cur: -1 };
  return { file: false, d: dec, fr: dec.fr, cur: dec.state === 'LOCK' ? dec.s : -1 };
}
/** 受信中の 40〜48 秒: ここまでの過半数が読めなければコールサインとして描く */
function codeOf(fr: Frame | null, s: number): Sym | null {
  if (!fr) return null;
  const c = fr.c[s];
  if (c !== '?' || s < 40 || s > 48 || fr.done) return c;
  let n = 0,
    u = 0;
  for (let i = 40; i <= 48; i++)
    if (fr.c[i] != null) {
      n++;
      if (fr.c[i] === '?') u++;
    }
  return u * 2 > n ? 'S' : '?';
}
const selSec = (v: View) =>
  hover >= 0 ? hover : pinned >= 0 ? pinned : v.file ? (v.fr ? 0 : -1) : v.cur >= 0 ? Math.min(59, v.cur) : -1;
/** フラグと式に使う分: ファイルは選んだ分、受信は最後に読み終えた分（まだなければ受信中の分） */
function resFrame(v: View): Frame | null {
  if (v.file || !v.d) return v.fr;
  return v.d.frames.at(-1) ?? v.fr;
}
/** 読んでいる途中の分の仮の値（復号器の状態が変わるまで使い回す） */
const pres = new WeakMap<Frame, { v: number; r: Res }>();
function evalOf(fr: Frame | null, d: Decoder | null): Res | null {
  if (!fr) return null;
  if (fr.res) return fr.res;
  const ver = d?.ver ?? -1,
    c = pres.get(fr);
  if (c && c.v === ver) return c.r;
  const r = evalFrame(fr.c, d?.lastY() ?? null);
  pres.set(fr, { v: ver, r });
  return r;
}

const follow = $<HTMLButtonElement>('#follow'),
  fmins = $('#fmins');
function renderBars(v: View): void {
  const sel = selSec(v);
  bars.forEach((b, s) => {
    const k = codeOf(v.fr, s);
    b.className =
      BASE[s] +
      (k == null ? '' : k === '?' ? ' tc-x' : ` tc-${k}`) +
      (s === v.cur ? ' now' : '') +
      (s === sel ? ' sel' : '');
  });
  const r = evalOf(v.fr, v.d),
    when = hm(r);
  txt(
    '#w-aux',
    !v.fr
      ? ''
      : v.file
        ? `${when || '??:??'} の分`
        : v.fr.done
          ? `${when} の分（同期が外れました）`
          : v.d?.state !== 'LOCK'
            ? `${when || '??:??'} の分（同期が外れました）`
            : when
              ? `${when} の分を受信中`
              : '分の始まりから受信中',
  );
  tc.setAttribute(
    'aria-label',
    v.fr
      ? `${when || '時刻不明'}の分のタイムコード: ${v.fr.c.map((c) => c || '-').join('')}。矢印キーで選ぶ秒を動かします。`
      : 'タイムコード（未受信）',
  );
  follow.hidden = v.file;
  follow.disabled = pinned < 0;
  fmins.hidden = !v.file || !fileRes?.frames.length;
  if (!fmins.hidden && fileRes) {
    const h = fileRes.frames
      .map((f, i) => {
        const ok = !!f.res?.ok;
        return `<button type="button" class="chip${ok ? '' : ' bad'}" data-i="${i}" aria-pressed="${i === fsel}" title="${ok ? '検査を通った分' : '検査を通らなかった分'}"><span class="ck" aria-hidden="true">${ok ? '\u2714\uFE0E' : '？'}</span>${hm(f.res) || '??:??'}</button>`;
      })
      .join('');
    if (fmins.innerHTML !== h) fmins.innerHTML = h;
  }
}
const SNAME: Record<Sym, string> = { ...CNAME, '?': '読めない' };
function showSel(v: View): void {
  const s = selSec(v),
    fr = v.fr;
  if (s < 0 || !fr) {
    for (const id of ['#b-s', '#b-c', '#b-w', '#b-mean']) txt(id, '—');
    return;
  }
  const k = codeOf(fr, s),
    r = evalOf(fr, v.d);
  html('#b-s', `${s}<span class="u">秒</span>`);
  html(
    '#b-c',
    k == null
      ? s === v.cur
        ? '…<span class="u">受信中</span>'
        : '—<span class="u">未受信</span>'
      : `${k === 'P' && s === 0 ? 'M' : k}<span class="u">${SNAME[k]}</span>`,
  );
  const w = fr.w[s],
    np = fr.np[s];
  html(
    '#b-w',
    Number.isFinite(w) && k !== 'S'
      ? `${(w / 1000).toFixed(3)}<span class="u">s</span>` +
          (k && k !== '?'
            ? `<span class="m-sub">規定 ${WIDTH[k]} 秒</span>`
            : '<span class="m-note">規定の幅から外れています</span>')
      : k === 'S'
        ? '<span class="tx">モールス符号</span>'
        : k === '?'
          ? `<span class="tx">${np === 0 ? '立ち上がりがありません' : np > 1 ? `パルスが ${np} 本あります` : '立ち上がりの位置がずれています'}</span>`
          : '—',
  );
  txt('#b-mean', meaning(s, !!r?.cs, !!r?.st));
}
const barAt = (e: Event) => {
  const b = (e.target as Element).closest<HTMLElement>('.tb');
  return b ? Number(b.dataset.s) : -1;
};
const cols = () => getComputedStyle(tc).gridTemplateColumns.split(' ').length;
tc.addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse') return;
  const s = barAt(e);
  if (s >= 0 && s !== hover) {
    hover = s;
    scopeDirty = true;
  }
});
tc.addEventListener('pointerleave', () => {
  if (hover >= 0) {
    hover = -1;
    scopeDirty = true;
  }
});
tc.addEventListener('click', (e) => {
  const s = barAt(e);
  if (s < 0) return;
  pinned = pinned === s ? -1 : s;
  hover = -1;
  scopeDirty = true;
});
tc.addEventListener('keydown', (e) => {
  const base = pinned >= 0 ? pinned : Math.max(0, selSec(view())),
    c = cols();
  const mv = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -c, ArrowDown: c } as Record<string, number>)[e.key];
  if (mv != null) pinned = (base + mv + 60) % 60;
  else if (e.key === 'Home') pinned = 0;
  else if (e.key === 'End') pinned = 59;
  else if (e.key === 'Escape' && pinned >= 0) pinned = -1;
  else return;
  e.preventDefault();
  hover = -1;
  scopeDirty = true;
});
follow.addEventListener('click', () => {
  pinned = -1;
  scopeDirty = true;
});

/* ---------- 表示窓: 選んだ秒の包絡線（10 × 6 div、100 ms/div、高出力 = 100 %） ---------- */
const tr1 = $('#tr1'),
  thL = $('#thr-l'),
  thT = $('#thr-t'),
  scopeSvg = $('#scope-svg');
function drawScope(v: View): void {
  const d = v.d,
    s = selSec(v);
  txt('#s-trig', v.fr && s >= 0 ? `SEC ${p2(s)}` : 'FREE');
  const w = v.fr && s >= 0 ? v.fr.w[s] : Number.NaN;
  txt('#s-tau', Number.isFinite(w) ? `${(w / 1000).toFixed(3)} s` : '---');
  if (!d || d.n < 2) {
    tr1.setAttribute('d', '');
    thL.setAttribute('d', '');
    thT.textContent = '';
    txt('#s-th', '---');
    return;
  }
  let S: number;
  if (v.fr && s >= 0) S = Number.isFinite(v.fr.S[s]) ? v.fr.S[s] : v.fr.t0 + 1000 * s;
  else {
    const L = d.pulses.at(-1);
    S = L && L.r > d.n - 1000 ? L.r : d.n - 900;
  }
  const hi = d.hi > 0 ? d.hi : 1,
    k0 = Math.max(0, Math.ceil(S - 100), d.n - d.M),
    k1 = Math.min(d.n - 1, Math.floor(S + 900));
  const Y = (a: number) => Math.max(-10, GY - (a / hi) * 5 * DV).toFixed(1);
  let p = '';
  for (let k = k0; k <= k1; k += 2) p += `${p ? 'L' : 'M'}${(DV + ((k - S) * DV) / 100).toFixed(1)} ${Y(d.E[k & d.M])}`;
  tr1.setAttribute('d', p);
  if (d.th > 0) {
    const y = +Y(d.th);
    thL.setAttribute('d', `M0 ${y}H${SW}`);
    thT.setAttribute('y', String(y - 6));
    thT.textContent = 'θ';
    txt('#s-th', `${Math.round((d.th / hi) * 100)} %`);
  } else {
    thL.setAttribute('d', '');
    thT.textContent = '';
    txt('#s-th', '---');
  }
  scopeSvg.setAttribute(
    'aria-label',
    `包絡線。${s >= 0 && v.fr ? `${s} 秒` : '直近'}の 1 秒ぶん。横軸 100 ms/div、縦軸は高出力を 100 % とした 20 %/div。` +
      (Number.isFinite(w) ? `高出力の長さ ${(w / 1000).toFixed(3)} 秒。` : ''),
  );
}

/* ---------- 同期の状態と、信号の強さ・品質 ---------- */
function syncState(v: View): [string, string] {
  if (v.file)
    return fileRes
      ? [`${fileRes.frames.length} 分を検出しました`, 'FILE']
      : fileData
        ? ['解読できませんでした', 'FILE']
        : ['ファイル未選択', 'IDLE'];
  if (!live.on) return ['停止中', 'IDLE'];
  const d = dec;
  if (!d?.sig) return ['信号がありません', 'NO SIG'];
  if (d.state === 'LOCK') return [`受信中（${Math.min(59, d.s)} 秒）`, 'LOCK'];
  if (d.reg >= 2) return ['分の始まりを待っています', 'WAIT M'];
  return ['秒の区切りを探しています', 'SEARCH'];
}
function renderStats(v: View): void {
  const [ja, en] = syncState(v);
  txt('#r-sync', ja);
  txt('#s-sync', en);
  txt('#ms', en);
  let q = null;
  if (v.file) q = v.fr?.q ?? null;
  else if (dec && live.on) {
    const x = dec.quality();
    q = { ...x, ok: dec.state === 'LOCK' ? x.ok : Number.NaN };
  }
  const f = curF(),
    sig = v.file || !!dec?.sig;
  html(
    '#r-lvl',
    q && Number.isFinite(q.lvl) && q.lvl > -120 ? `${minus(q.lvl.toFixed(1))}<span class="u">dBFS</span>` : '—',
  );
  html(
    '#r-hl',
    q && q.hi > 0 && q.lo > 0 && sig ? `${(20 * Math.log10(q.hi / q.lo)).toFixed(1)}<span class="u">dB</span>` : '—',
  );
  html('#r-ok', q && Number.isFinite(q.ok) && q.n ? `${q.ok}<span class="u">/ ${q.n}</span>` : '—');
  html(
    '#r-jit',
    q && Number.isFinite(q.jit) && (v.file || dec?.state === 'LOCK')
      ? `±${q.jit.toFixed(1)}<span class="u">ms</span>`
      : '—',
  );
  html('#r-f', f > 0 ? ro(f, 'Hz', 5) : '—');
  txt(
    '#rx-aux',
    v.file ? (fileRes ? '48 kHz に変換して解読' : '') : live.on && live.ac ? fmt(live.ac.sampleRate, 'Hz', 3) : '',
  );
  $('#rxLed').classList.toggle('on', !v.file && live.on && !!dec?.sig);
}

/* ---------- 復号した時刻 ---------- */
interface DateItems {
  Y: number;
  yNote: string;
  mo?: number;
  day?: number;
  wd: number;
  /** 曜日のビットを読めなかった */
  wdBad?: boolean;
  doy?: number;
  /** 仮の値（読めた項目の印を ✔ ではなく ？ にする） */
  prov?: boolean;
}
function dateItems(o: DateItems): void {
  const ok: Mark = o.prov ? 'pv' : 'ok';
  const note = o.yNote ? `<span class="m-sub">${o.yNote}</span>` : '';
  html('#o-y', o.Y > 0 ? `${o.Y}${note}` : `—${note}`);
  mark('#o-y', o.Y > 0 ? ok : '');
  const date = !!(o.mo && o.day);
  html('#o-date', date ? `${o.mo}<span class="u">月</span>${o.day}<span class="u">日</span>` : '—');
  mark('#o-date', date ? ok : Number.isNaN(o.doy) ? 'ng' : '');
  html('#o-wd', o.wd >= 0 ? `${WD[o.wd]}曜日<span class="u">${o.wd}</span>` : '—');
  mark('#o-wd', o.wd >= 0 ? ok : o.wdBad ? 'ng' : '');
  const doy = o.doy !== undefined && o.doy > 0;
  html(
    '#o-doy',
    doy ? `${o.doy}<span class="u">日目</span>` : Number.isNaN(o.doy) ? '<span class="tx">読めません</span>' : '—',
  );
  mark('#o-doy', doy ? ok : Number.isNaN(o.doy) ? 'ng' : '');
}
const resItems = (r: Res): DateItems => ({
  Y: r.Y,
  yNote: yNote(r),
  mo: r.mo,
  day: r.day,
  wd: nn(r.w) ? r.w : (r.wdC ?? -1),
  wdBad: Number.isNaN(r.w),
  doy: r.d,
});
function countHtml(L: Frame[]): string {
  const ok = L.filter((f) => f.res?.ok).length;
  return L.length
    ? `${ok}<span class="u">分</span>${L.length > ok ? `<span class="m-note">検査を通らなかった分 ${L.length - ok}</span>` : ''}`
    : '—';
}
const fan = $<SVGElement>('#fan');
function renderTime(v: View): void {
  let time = '--:--:--',
    note = '',
    aux = '',
    diffT = '現在時刻とのずれ',
    diff = '—',
    di: DateItems = { Y: Number.NaN, yNote: '', wd: -1 },
    /** 扇形に渡す時刻（ms）。ファイルでは時刻が進まないので出さない */
    fanT: number | null = null,
    tm: Mark = '';
  if (v.file) {
    diffT = 'ファイル先頭の時刻';
    const fr = v.fr,
      r = fr?.res;
    if (fr && r && r.tod >= 0 && fileRes) {
      const s = Math.max(0, selSec(v));
      time = hms(r.tod + s * 1000);
      const st = Math.round((r.tod - (fr.t0 - fileRes.lag)) / 100) * 100;
      diff = `${hms(st)}<span class="u">.${Math.round((((st % 1000) + 1000) % 1000) / 100)}</span>`;
      aux = `ファイルの ${Math.floor(fr.t0 / 60000)}:${p2(Math.floor(fr.t0 / 1000) % 60)} から`;
      if (!r.ok) note = '検査を通らなかった分です';
      tm = r.ok ? 'ok' : 'ng';
    }
    if (r) di = resItems(r);
    html('#o-cnt', countHtml(fileRes?.frames ?? []));
  } else if (dec) {
    let a = live.anc,
      prov = false;
    if (!a && dec.fr && Number.isFinite(live.W0)) {
      const r = evalOf(dec.fr, dec);
      if (r && r.tod >= 0 && r.pa1 !== false && r.pa2 !== false) {
        a = anchorOf(r, wallOf(dec.fr.t0));
        prov = true;
      }
    }
    if (a) {
      const now = Date.now();
      if (a.off != null) {
        const t = jst(now + a.off);
        fanT = now + a.off;
        time = `${p2(t.h)}:${p2(t.mi)}:${p2(t.s)}`;
        di = { Y: t.y, yNote: yNote(a.r), mo: t.mo, day: t.d, wd: t.wd, doy: t.doy };
        diff = diffHtml(a.off);
      } else {
        const tod = a.tod ?? 0;
        fanT = todOf(now) + tod;
        time = hms(fanT);
        di = { ...resItems(a.r), wd: nn(a.r.w) ? a.r.w : -1 };
        diff = diffHtml(tod);
      }
      /* 仮の値であることは項目名の印（？）で示す */
      note = !live.on
        ? '受信を止めたため、端末の時計で進めています'
        : !prov && dec.state !== 'LOCK'
          ? '信号が途切れたため、端末の時計で進めています'
          : '';
      aux = prov ? '受信中の分から' : `${hm(a.r)} の分から`;
      tm = prov ? 'pv' : 'ok';
      di.prov = prov;
    }
    html('#o-cnt', countHtml(dec.frames));
  } else html('#o-cnt', '—');
  html('#o-time', time);
  mark('#o-time', tm);
  drawFan(fan, fanT);
  html('#o-note', note);
  html('#o-diff', diff);
  txt('#o-diffT', diffT);
  txt('#o-aux', aux);
  dateItems(di);
  txt('#mt', time);
  const s = selSec(v);
  txt('#mc', s >= 0 ? p2(s) : '--');
}

/* ---------- フラグ ---------- */
function renderFlags(v: View): void {
  const fr = resFrame(v),
    r = evalOf(fr, v.d);
  FLAGS.forEach(([, , f], i) => {
    const [val, note, bad] = r ? f(r) : (['—'] as const);
    const el = $(`#fl${i}`);
    el.className = val === '—' ? 'dim' : '';
    mark(`#fl${i}`, val === '—' ? '' : bad ? 'ng' : 'ok');
    html(
      `#fl${i}`,
      (bad && !note ? `<span style="color:var(--warn)">${val}</span>` : val) +
        (note ? `<span class="${bad ? 'm-note' : 'm-sub'}">${note}</span>` : ''),
    );
  });
  txt('#f-aux', !fr ? '' : fr.done ? `${hm(r) || '??:??'} の分` : `${hm(r) || '受信中'} の分（受信中）`);
  renderTheory(fr, r);
}

/* ---------- 代入した式 ---------- */
let thyKey = '';
function renderTheory(fr: Frame | null, r: Res | null): void {
  const key = fr ? `${fr.t0}|${fr.c.join('')}` : '';
  if (key === thyKey) return;
  thyKey = key;
  html('#subst', fr && r ? substHtml(fr.c, r) : '');
}

/* ---------- 描き直し ---------- */
function reset(): void {
  lastKey = '';
  scopeDirty = true;
  thyKey = '-';
}
let lastStat = 0;
function frame(): void {
  const v = view(),
    s = selSec(v);
  const key = `${ui.src}|${v.d ? v.d.ver : -1}|${v.fr ? v.fr.t0 : ''}|${fsel}|${s}|${pinned}|${v.cur}|${fileRes ? fileRes.frames.length : 0}`;
  if (key !== lastKey) {
    lastKey = key;
    renderBars(v);
    showSel(v);
    renderFlags(v);
    scopeDirty = true;
  }
  if (scopeDirty) {
    scopeDirty = false;
    drawScope(v);
  }
  renderTime(v);
  const now = performance.now();
  if (now - lastStat > 200) {
    lastStat = now;
    renderStats(v);
  }
  requestAnimationFrame(frame);
}

/* ---------- 起動 ---------- */
syncIn();
reset();
requestAnimationFrame(frame);
