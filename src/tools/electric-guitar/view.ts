/**
 * エレキギターのページの描画: 全体図（SVG）、段を通った音の波形とスペクトル、機材の特性、指板（canvas）。
 * 波形は最初の段（ピックアップ）が負から正へ変わる点で切り出し、どの段も同じ時刻を並べる
 */
import { smag, TAU, zmag } from './filters';
import { COMP_RATIO, compThr, driveCurve, driveGain, modHz, revT60, WAH_Q, wahHz } from './fx';
import type { Any } from './params';
import { KINDS } from './pedals';
import type { Snap } from './proc';
import {
  AMPS,
  CABS,
  COILS,
  cabFilters,
  MAX_PEDALS,
  type Pedal,
  PU_POS,
  PU_SEL,
  pickupPoly,
  type Rack,
  type StageId,
  toneStackPoly,
} from './rig';

/* ---------- 色と文字 ---------- */
export interface Colors {
  ch1: string;
  ch2: string;
  ink3: string;
  screen: string;
  grid: string;
  grid2: string;
  sink: string;
}
export let C: Colors = {
  ch1: '#f2c230',
  ch2: '#52c4dd',
  ink3: '#838c93',
  screen: '#08090a',
  grid: '#1c2428',
  grid2: '#3b474e',
  sink: '#aab3b8',
};
export function readColors(): void {
  const g = getComputedStyle(document.documentElement),
    v = (n: string, f: string) => g.getPropertyValue(n).trim() || f;
  C = {
    ch1: v('--ch1', C.ch1),
    ch2: v('--ch2', C.ch2),
    ink3: v('--ink-3', C.ink3),
    screen: v('--screen', C.screen),
    grid: v('--grid', C.grid),
    grid2: v('--grid-2', C.grid2),
    sink: v('--screen-ink', C.sink),
  };
}
const SANS = 'system-ui,"Segoe UI","Hiragino Sans","Noto Sans JP","Yu Gothic UI",Meiryo,sans-serif',
  MONO = '"Fira Mono",ui-monospace,Consolas,monospace';
type G = CanvasRenderingContext2D;
function txt(
  g: G,
  s: string,
  x: number,
  y: number,
  col: string,
  px = 13,
  al: CanvasTextAlign = 'center',
  w = 500,
  mono = true,
): void {
  g.font = `${w} ${px}px ${mono ? MONO : SANS}`;
  g.fillStyle = col;
  g.textAlign = al;
  g.textBaseline = 'middle';
  g.fillText(s, x, y);
}
/** canvas の大きさを表示の大きさにそろえて消す */
export function fitCanvas(cv: HTMLCanvasElement): [G, number, number] {
  const r = devicePixelRatio || 1,
    w = cv.clientWidth,
    h = cv.clientHeight;
  if (cv.width !== Math.round(w * r) || cv.height !== Math.round(h * r)) {
    cv.width = Math.round(w * r);
    cv.height = Math.round(h * r);
  }
  const g = cv.getContext('2d') as G;
  g.setTransform(r, 0, 0, r, 0, 0);
  g.clearRect(0, 0, w, h);
  g.fillStyle = C.screen;
  g.fillRect(0, 0, w, h);
  return [g, w, h];
}
export const fmtHz = (f: number): string =>
  f >= 1000 ? `${Number((f / 1000).toFixed(f >= 10000 ? 0 : 1))}k` : `${Math.round(f)}`;

/* ---------- 波形 ---------- */
/** 切り出しの頭: 最初の段が負から正へ変わる点のうち、傾きの大きいもの */
function trig(pu: Float32Array, W: number): number {
  const n = pu.length;
  let best = n - W - 1,
    m = 0;
  for (let i = n - W - 1; i > Math.max(1, n - W - 900); i--)
    if (pu[i - 1] < 0 && pu[i] >= 0 && pu[i] - pu[i - 1] > m) {
      m = pu[i] - pu[i - 1];
      best = i;
    }
  return best;
}
/** 段 k を通った音の波形。fs はサンプリング周波数 */
export function drawWave(cv: HTMLCanvasElement, sn: Snap | null, k: StageId, fs: number, mini = false): void {
  const [g, w, h] = fitCanvas(cv);
  g.strokeStyle = C.grid;
  g.lineWidth = 1;
  g.beginPath();
  for (let i = 1; i < 8; i++) {
    const x = Math.round((i * w) / 8) + 0.5;
    g.moveTo(x, 0);
    g.lineTo(x, h);
  }
  g.moveTo(0, Math.round(h / 2) + 0.5);
  g.lineTo(w, Math.round(h / 2) + 0.5);
  g.stroke();
  const a = sn?.taps[k],
    pu = sn?.taps.pu;
  if (!a || !pu) return;
  const W = Math.round(fs * (mini ? 0.03 : 0.04)),
    i0 = trig(pu, W);
  let pk = 1e-6;
  for (let i = i0; i < i0 + W; i++) pk = Math.max(pk, Math.abs(a[i]));
  const sc = (h * 0.42) / Math.max(pk, k === 'pu' ? 0.05 : 0.02);
  g.strokeStyle = C.ch1;
  g.lineWidth = mini ? 1.4 : 2;
  g.lineJoin = 'round';
  g.beginPath();
  for (let i = 0; i < W; i++) {
    const x = (i / (W - 1)) * w,
      y = h / 2 - a[i0 + i] * sc;
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.stroke();
  /* 一覧の小さな波形には数値を出さない（狭く、値がすぐ変わるため） */
  if (!mini) {
    txt(g, `ピーク ${pk.toFixed(2)}${k === 'pu' ? ' V' : ''}`, 10, 14, C.sink, 13, 'left');
    txt(g, `${Math.round((W / fs) * 1000)} ms`, w - 10, h - 12, C.sink, 13, 'right');
  }
}

/* ---------- スペクトル ---------- */
const FFTN = 2048,
  WIN = Float32Array.from({ length: FFTN }, (_, i) => 0.5 - 0.5 * Math.cos((TAU * i) / (FFTN - 1)));
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let b = n >> 1;
    for (; j & b; b >>= 1) j ^= b;
    j ^= b;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -TAU / len,
      wr = Math.cos(a),
      wi = Math.sin(a),
      hf = len / 2;
    for (let i = 0; i < n; i += len) {
      let cr = 1,
        ci = 0;
      for (let j = 0; j < hf; j++) {
        const p = i + j,
          q = p + hf,
          vr = re[q] * cr - im[q] * ci,
          vi = re[q] * ci + im[q] * cr;
        re[q] = re[p] - vr;
        im[q] = im[p] - vi;
        re[p] += vr;
        im[p] += vi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}
export const FX0 = 50,
  FX1 = 12000;
const lx = (f: number, w: number, x0 = 0) => x0 + (Math.log(f / FX0) / Math.log(FX1 / FX0)) * (w - x0);
function freqAxis(g: G, w: number, y1: number, x0 = 0): void {
  g.strokeStyle = C.grid;
  g.lineWidth = 1;
  g.beginPath();
  for (const f of [100, 200, 500, 1000, 2000, 5000, 10000]) {
    const x = Math.round(lx(f, w, x0)) + 0.5;
    g.moveTo(x, 0);
    g.lineTo(x, y1);
  }
  g.stroke();
  for (const f of [100, 1000, 10000]) txt(g, `${fmtHz(f)}Hz`, lx(f, w, x0), y1 + 10, C.sink, 12);
}
/** 段 k を通った音のスペクトル（mem に前の値を残し、ゆっくり下げる） */
export function drawSpec(cv: HTMLCanvasElement, sn: Snap | null, k: StageId, fs: number, mem: Float32Array): void {
  const [g, w, h] = fitCanvas(cv),
    y1 = h - 20;
  freqAxis(g, w, y1);
  const a = sn?.taps[k];
  if (!a) return;
  const re = new Float32Array(FFTN),
    im = new Float32Array(FFTN);
  for (let i = 0; i < FFTN; i++) re[i] = a[a.length - FFTN + i] * WIN[i];
  fft(re, im);
  for (let i = 1; i < FFTN / 2; i++) {
    const d = 20 * Math.log10(Math.hypot(re[i], im[i]) / (FFTN / 4) + 1e-9);
    mem[i] = Math.max(d, mem[i] * 0.85 + d * 0.15 - 0.5);
  }
  const yy = (d: number) => Math.min(y1, Math.max(0, (-d / 90) * y1)),
    pts: [number, number][] = [];
  for (let i = 2; i < FFTN / 2; i++) {
    const f = (i * fs) / FFTN;
    if (f >= FX0 && f <= FX1) pts.push([lx(f, w), yy(mem[i])]);
  }
  g.fillStyle = C.ch1;
  g.globalAlpha = 0.25;
  g.beginPath();
  g.moveTo(lx(FX0, w), y1);
  for (const [x, y] of pts) g.lineTo(x, y);
  g.lineTo(lx(FX1, w), y1);
  g.closePath();
  g.fill();
  g.globalAlpha = 1;
  g.strokeStyle = C.ch1;
  g.lineWidth = 1.5;
  g.beginPath();
  pts.forEach(([x, y], i) => {
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  });
  g.stroke();
  for (const d of [-30, -60]) txt(g, `${d} dB`, 6, yy(d), C.sink, 12, 'left');
}

/* ---------- 機材の特性 ---------- */
type Vals = Record<string, number | string>;
type Char =
  | { kind: 'resp'; f: (f: number) => number; lo: number; hi: number; label: string; peak?: boolean }
  | { kind: 'curve'; f: (x: number) => number; x0: number; x1: number; dc: boolean; label: string }
  | { kind: 'lfo' | 'taps' | 'decay'; label: string };
const n = (v: Vals, k: string): number => Number(v[k]);
function charOf(a: Any, v: Vals, fs: number): Char {
  if (a === 'pu') {
    const p = pickupPoly(v.coil as 'single' | 'hum', n(v, 'cable'), n(v, 'tone'));
    return { kind: 'resp', f: (f) => smag(p, f), lo: -24, hi: 12, label: 'ピックアップの電気の応答', peak: true };
  }
  if (a === 'comp') {
    const T = compThr(n(v, 'sus'));
    return {
      kind: 'curve',
      f: (x) => (x < T ? x : T + (x - T) / COMP_RATIO),
      x0: -60,
      x1: 0,
      dc: false,
      label: `入力 → 出力 [dB] · しきい値 ${Math.round(T)} dB`,
    };
  }
  if (a === 'wah') {
    const fc = wahHz(v.mode === 'manual' ? n(v, 'pedal') : 0.5);
    return {
      kind: 'resp',
      f: (f) => {
        const s = f / fc;
        return Math.hypot(0.3, (0.9 * s) / WAH_Q) / Math.hypot(1 - s * s, s / WAH_Q);
      },
      lo: -24,
      hi: 18,
      label: `ワウの応答 · 山 ${fmtHz(fc)}Hz${v.mode === 'manual' ? '' : '（弾く強さで動く）'}`,
    };
  }
  if (a === 'od' || a === 'ds' || a === 'fuzz')
    return {
      kind: 'curve',
      f: (x) => driveCurve(a, n(v, 'gain'), x),
      x0: -0.3,
      x1: 0.3,
      dc: true,
      label: `入力 → 出力 [V] · 増幅 ×${Math.round(driveGain(a, n(v, 'gain')))}`,
    };
  if (a === 'chorus' || a === 'phaser' || a === 'flanger' || a === 'trem')
    return { kind: 'lfo', label: `揺れ · ${modHz(n(v, 'rate')).toFixed(2)} Hz` };
  if (a === 'amp') {
    const p = toneStackPoly(n(v, 'treble'), n(v, 'mid'), n(v, 'bass'));
    return {
      kind: 'resp',
      f: (f) => smag(p, f),
      lo: -36,
      hi: 6,
      label: `トーンの応答 · 増幅の段 ${AMPS[v.type as keyof typeof AMPS].stages}`,
    };
  }
  if (a === 'cab') {
    if (v.type === 'off') return { kind: 'resp', f: () => 1, lo: -36, hi: 12, label: 'スピーカーなし' };
    const t = v.type as keyof typeof CABS,
      fl = cabFilters(t, v.mic as 'center' | 'edge', fs),
      g0: number = CABS[t].g;
    return {
      kind: 'resp',
      f: (f) => fl.reduce((s: number, q) => s * zmag(q, f, fs), g0),
      lo: -36,
      hi: 12,
      label: 'スピーカーとマイクの応答',
    };
  }
  if (a === 'dly') return { kind: 'taps', label: `くり返す音 · ${Math.round(n(v, 'time') * 1000)} ms ごと` };
  return { kind: 'decay', label: `残響の減衰 · ${a === 'spring' ? 'スプリング' : 'ルーム'}` };
}
/** 種類 a・設定 v の機材の特性の図。off ならスルーとして薄く描く */
export function drawChar(cv: HTMLCanvasElement, a: Any, v: Vals, fs: number, off = false, mini = false): void {
  const [g, w, h] = fitCanvas(cv),
    D = charOf(a, v, fs),
    top = mini ? 4 : 24,
    y1 = h - (mini ? 4 : 22),
    x0 = mini ? 3 : 8;
  g.globalAlpha = off ? 0.35 : 1;
  const line = (pts: [number, number][], lw: number) => {
    g.strokeStyle = C.ch2;
    g.lineWidth = lw;
    g.lineJoin = 'round';
    g.beginPath();
    pts.forEach(([x, y], i) => {
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    });
    g.stroke();
  };
  const lw = mini ? 1.6 : 2;
  if (D.kind === 'resp') {
    if (!mini) freqAxis(g, w, y1, x0);
    const yy = (db: number) => top + ((D.hi - Math.max(D.lo, Math.min(D.hi, db))) / (D.hi - D.lo)) * (y1 - top);
    g.strokeStyle = C.grid2;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x0, Math.round(yy(0)) + 0.5);
    g.lineTo(w, Math.round(yy(0)) + 0.5);
    g.stroke();
    const pts: [number, number][] = [];
    let pk: [number, number] = [0, -1e9];
    for (let i = 0; i <= 160; i++) {
      const f = FX0 * (FX1 / FX0) ** (i / 160),
        db = 20 * Math.log10(D.f(f));
      pts.push([lx(f, w, x0), yy(db)]);
      if (db > pk[1]) pk = [f, db];
    }
    line(pts, lw);
    if (!mini) {
      txt(g, '0 dB', x0 + 2, yy(0) - 9, C.sink, 12, 'left');
      if (D.peak) {
        const x = lx(pk[0], w, x0);
        g.fillStyle = C.ch2;
        g.beginPath();
        g.arc(x, yy(pk[1]), 4, 0, TAU);
        g.fill();
        txt(g, `共振 ${fmtHz(pk[0])}Hz`, Math.min(w - 56, x), yy(pk[1]) - 15, C.ch2, 15, 'center', 700);
      }
    }
  } else if (D.kind === 'curve') {
    const X = (x: number) => x0 + ((x - D.x0) / (D.x1 - D.x0)) * (w - x0 - 4),
      ym = D.dc ? Math.max(Math.abs(D.f(D.x0)), Math.abs(D.f(D.x1))) * 1.15 : 0,
      Y = D.dc
        ? (y: number) => (top + y1) / 2 - (y / ym) * ((y1 - top) / 2)
        : (y: number) => top + ((D.x1 - y) / (D.x1 - D.x0)) * (y1 - top);
    g.strokeStyle = C.grid2;
    g.lineWidth = 1;
    g.beginPath();
    if (D.dc) {
      g.moveTo(X(0), top);
      g.lineTo(X(0), y1);
      g.moveTo(x0, Y(0));
      g.lineTo(w, Y(0));
    } else {
      g.moveTo(X(D.x0), Y(D.x0));
      g.lineTo(X(D.x1), Y(D.x1));
    }
    g.stroke();
    const pts: [number, number][] = [];
    for (let i = 0; i <= 200; i++) {
      const x = D.x0 + ((D.x1 - D.x0) * i) / 200;
      pts.push([X(x), Y(D.f(x))]);
    }
    line(pts, lw);
    if (!mini) txt(g, '入力', w - 8, y1 + 10, C.sink, 12, 'right', 500, false);
  } else if (D.kind === 'lfo') {
    const fr = modHz(n(v, 'rate')),
      dp = n(v, 'depth'),
      pts: [number, number][] = [];
    for (let i = 0; i <= 200; i++) {
      const l = Math.sin(TAU * fr * ((2 * i) / 200)),
        y = a === 'trem' ? 1 - 0.9 * dp * (0.5 + 0.5 * l) : 0.5 + 0.5 * l * (0.3 + 0.7 * dp);
      pts.push([x0 + (i / 200) * (w - x0 - 4), y1 - y * (y1 - top)]);
    }
    line(pts, lw);
    if (!mini) txt(g, '2 秒', w - 8, y1 + 10, C.sink, 12, 'right', 500, false);
  } else if (D.kind === 'taps') {
    const T = 2.4;
    g.lineWidth = mini ? 2 : 3;
    for (let k = 0; k < 40; k++) {
      const t = k * n(v, 'time');
      if (t > T) break;
      const amp = k === 0 ? 1 : n(v, 'mix') * n(v, 'fb') ** (k - 1),
        x = x0 + (t / T) * (w - x0 - 6);
      g.strokeStyle = k ? C.ch2 : C.sink;
      g.beginPath();
      g.moveTo(x, y1);
      g.lineTo(x, y1 - amp * (y1 - top));
      g.stroke();
    }
    if (!mini) txt(g, `${T} 秒`, w - 8, y1 + 10, C.sink, 12, 'right', 500, false);
  } else {
    const T60 = revT60(a === 'spring' ? 'spring' : 'room', n(v, 'decay')),
      T = 4,
      yc = (top + y1) / 2;
    let seed = 7;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    g.strokeStyle = C.ch2;
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i < 400; i++) {
      const t = (T * i) / 400,
        amp = 10 ** ((-3 * t) / T60) * (a === 'spring' ? 0.6 + 0.4 * Math.abs(Math.sin(t * 9)) : 1),
        x = x0 + (i / 400) * (w - x0 - 4);
      g.moveTo(x, yc - amp * rnd() * (y1 - top) * 0.5);
      g.lineTo(x, yc + amp * rnd() * (y1 - top) * 0.5);
    }
    g.stroke();
    if (!mini) txt(g, `残響時間 ${T60.toFixed(1)} 秒`, w - 8, top - 10, C.sink, 12, 'right', 500, false);
  }
  g.globalAlpha = 1;
  if (!mini) {
    txt(g, D.label, x0 + 2, 12, C.sink, 12, 'left', 500, false);
    if (off) txt(g, 'スルー', w / 2, h / 2, C.ink3, 15, 'center', 700, false);
  }
}

/* ---------- 全体図 ---------- */
const r1 = (v: number) => Math.round(v * 10) / 10;
/** ペダルの大きさと間隔、各列の頭の位置（viewBox 0 0 1000 440） */
const PW = 104,
  PH = 136,
  STEP = 118,
  ROW = { pre: { x: 560, y: 40 }, post: { x: 342, y: 262 } } as const;
/** 機材の置き場所 [x, y, 幅, 高さ]。ギターは右上、アンプとキャビネットは左 */
const FIX_AT = { pu: [680, 30, 300, 150], amp: [20, 222, 280, 74], cab: [20, 300, 280, 96] } as const;
export type Sec = 'pre' | 'post';
/**
 * ペダルの左端。アンプの前の列はギターから左へ並べる（信号は右から左。実物のペダルも入力が右）。
 * マイクの後ろの列は左から右へ
 */
const pedalX = (sec: Sec, i: number): number => (sec === 'pre' ? ROW.pre.x - i * STEP : ROW.post.x + i * STEP);
/** 足す所の中心: 列の i 番目のペダルの手前（信号の上流の側）のすき間 */
const slotX = (sec: Sec, i: number): number =>
  sec === 'pre' ? ROW.pre.x - i * STEP + PW + (STEP - PW) / 2 : ROW.post.x + i * STEP - (STEP - PW) / 2;
export interface Layout {
  /** ペダルの左上 */
  at: Map<number, { x: number; y: number; sec: Sec; i: number }>;
  /** 足す所（＋）: 列・入れる位置・中心 */
  slots: { sec: Sec; i: number; x: number; y: number }[];
  outX: number;
}
export function layout(R: Rack): Layout {
  const at = new Map<number, { x: number; y: number; sec: Sec; i: number }>(),
    slots: Layout['slots'] = [];
  for (const sec of ['pre', 'post'] as const) {
    const { y } = ROW[sec],
      list = R[sec],
      cy = y + 64;
    list.forEach((p, i) => {
      at.set(p.id, { x: pedalX(sec, i), y, sec, i });
    });
    if (list.length < MAX_PEDALS)
      for (let i = 0; i <= list.length; i++) slots.push({ sec, i, x: slotX(sec, i), y: cy });
  }
  return { at, slots, outX: ROW.post.x + R.post.length * STEP + 8 };
}
/** 設定の窓を出す位置（viewBox の座標）: 機材の下の中央 */
export function anchorOf(L: Layout, id: StageId): { x: number; y: number } | null {
  if (id === 'pu' || id === 'amp' || id === 'cab') {
    const [x, y, w, h] = FIX_AT[id];
    return { x: x + w / 2, y: y + h + (id === 'pu' ? 20 : 4) };
  }
  const p = L.at.get(Number(id.slice(1)));
  return p ? { x: p.x + PW / 2, y: p.y + PH + 24 } : null;
}
/** ドラッグで落とす所: いちばん近い足す所（同じ列の上限は除く。動かすペダルの今の位置も候補） */
export function dropSlot(
  R: Rack,
  x: number,
  y: number,
  moving: number,
): { sec: Sec; i: number; x: number; y: number } | null {
  let best: { sec: Sec; i: number; x: number; y: number } | null = null,
    bd = 1e9;
  for (const sec of ['pre', 'post'] as const) {
    const list = R[sec],
      has = list.some((p) => p.id === moving);
    if (!has && list.length >= MAX_PEDALS) continue;
    const y0 = ROW[sec].y;
    for (let i = 0; i <= list.length; i++) {
      const sx = slotX(sec, i),
        sy = y0 + 64,
        d = Math.hypot(sx - x, (sy - y) * 1.5);
      if (d < bd) {
        bd = d;
        best = { sec, i, x: sx, y: sy };
      }
    }
  }
  return bd < 160 ? best : null;
}

/** 点を通るなめらかな線（Catmull-Rom を 3 次ベジエに） */
function spline(pts: [number, number][]): string {
  const m = pts.length,
    at = (i: number) => pts[Math.max(0, Math.min(m - 1, i))];
  let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
  for (let i = 0; i < m - 1; i++) {
    const p0 = at(i - 1),
      p1 = at(i),
      p2 = at(i + 1),
      p3 = at(i + 2);
    d += `C${r1(p1[0] + (p2[0] - p0[0]) / 6)} ${r1(p1[1] + (p2[1] - p0[1]) / 6)} ${r1(p2[0] - (p3[0] - p1[0]) / 6)} ${r1(p2[1] - (p3[1] - p1[1]) / 6)} ${r1(p2[0])} ${r1(p2[1])}`;
  }
  return d;
}
/** 上から見たソリッドボディ（ネックは +x、駒の近くが原点。特定の製品の形ではない。カードの図柄と同じ） */
const BODY: [number, number][] = [
  [29, -3],
  [26.2, -5.2],
  [27, -8.6],
  [31.5, -12.2],
  [36.5, -14.4],
  [39.2, -15.4],
  [39, -17.2],
  [36.4, -18],
  [32.6, -17.4],
  [28.5, -15.6],
  [23.5, -14],
  [17, -15.2],
  [9, -16.8],
  [1, -16],
  [-4.5, -11.5],
  [-6.8, -5],
  [-7, 1],
  [-5.8, 7.5],
  [-2, 13.8],
  [5, 16.9],
  [13, 16.4],
  [20, 14.2],
  [25.5, 14.6],
  [30.5, 15.6],
  [33.6, 14.4],
  [32.2, 11.4],
  [28.6, 8.6],
  [26.2, 5.2],
  [29, 3],
];
const GUARD: [number, number][] = [
  [26, -3.4],
  [24, -8],
  [17, -11.4],
  [9, -12],
  [3, -9],
  [1.5, -5],
  [1.5, 3],
  [6, 7],
  [13, 8.5],
  [17.5, 12],
  [23, 10.6],
  [25.5, 7],
  [26, 3.4],
];
const NUT = 78,
  SADDLE = 3;
/** ギターの図の倍率・原点と、傾ける角度 [度]（ヘッドを上げる） */
const GK = 2.9,
  GX0 = FIX_AT.pu[0] + 40,
  GY0 = FIX_AT.pu[1] + 72,
  TILT = -15,
  /** 回す中心（ボディとネックのつなぎ目のあたり） */
  GC = [GX0 + GK * 40, GY0] as const;
/** ギターの図の点（傾けたあと） */
function gPt(x: number, y: number): [number, number] {
  const a = (TILT * Math.PI) / 180,
    dx = GX0 + GK * x - GC[0],
    dy = GY0 + GK * y - GC[1];
  return [GC[0] + dx * Math.cos(a) - dy * Math.sin(a), GC[1] + dx * Math.sin(a) + dy * Math.cos(a)];
}
/** ギターのジャック（ケーブルの出口） */
const JACK = gPt(-1.8, 14.6);
function knobSvg(cx: number, cy: number, r: number, v: number, cls = 'eg-kb'): string {
  const a = ((-135 + 270 * v) * Math.PI) / 180;
  return `<circle class="${cls}" cx="${r1(cx)}" cy="${r1(cy)}" r="${r}"/><path class="eg-kp" d="M${r1(cx)} ${r1(cy)}L${r1(cx + r * 0.8 * Math.sin(a))} ${r1(cy - r * 0.8 * Math.cos(a))}"/>`;
}
function hexNut(cx: number, cy: number, R: number): string {
  const d = Array.from({ length: 6 }, (_, k) => {
    const a = (k * Math.PI) / 3 + Math.PI / 6;
    return `${r1(cx + R * Math.cos(a))} ${r1(cy + R * Math.sin(a))}`;
  }).join('L');
  return `<path class="eg-nut" d="M${d}Z"/>`;
}
const EAR_PATH = 'M3 9a5 5 0 0 1 10 0v4h-2.5V9.5H13M3 9v4h2.5V9.5H3';
const ear = (x: number, y: number) =>
  `<g class="eg-earb" transform="translate(${r1(x)} ${r1(y)})"><circle r="15"/><g transform="translate(-9 -9) scale(1.125)"><path d="${EAR_PATH}"/></g></g>`;
/** 0〜1 のつまみの値（ディレイの時間は 50〜1000 ms を 0〜1 に） */
const knobV = (p: Pedal, k: string): number =>
  k === 'time' ? (Number(p.v.time) - 0.05) / 0.95 : k === 'fb' && p.k === 'dly' ? Number(p.v.fb) / 0.9 : Number(p.v[k]);

function pedalSvg(p: Pedal, x: number, y: number, sel: boolean, listen: boolean): string {
  const K = KINDS[p.k],
    w = PW,
    h = PH,
    nm = K.name,
    st = `${nm}のオンとスルー`;
  let s = `<g class="eg-dev g-${K.g}${sel ? ' eg-sel' : ''}${p.on ? '' : ' eg-byp'}" data-dev="p${p.id}" role="button" tabindex="0" aria-label="${nm}"><rect class="eg-hit" x="${x}" y="${y}" width="${w}" height="${h + 24}"/>`;
  s += `<rect class="eg-jk" x="${x - 5}" y="${y + 58}" width="6" height="12" rx="1"/><rect class="eg-jk" x="${x + w - 1}" y="${y + 58}" width="6" height="12" rx="1"/>`;
  if (p.k === 'wah') {
    const pos = p.v.mode === 'manual' ? Number(p.v.pedal) : 0.5,
      ty = y + 8 + (1 - pos) * 8;
    s += `<path class="eg-pd" d="M${x + 12} ${y}H${x + w - 12}L${x + w} ${y + h}H${x}Z"/><path class="eg-tread" d="M${x + 18} ${r1(ty)}H${x + w - 18}L${x + w - 9} ${y + h - 30}H${x + 9}Z"/>`;
    for (let i = 0; i < 6; i++) {
      const yy = ty + 9 + i * ((y + h - 40 - ty) / 5);
      s += `<path class="eg-grip" d="M${r1(x + 22 - i * 1.5)} ${r1(yy)}H${r1(x + w - 22 + i * 1.5)}"/>`;
    }
    s += `<circle class="eg-led${p.on ? ' on' : ''}" cx="${x + 22}" cy="${y + h - 15}" r="4.5"/><g class="eg-fsw" data-fs="p${p.id}" role="button" aria-label="${st}"><title>${st}</title><circle class="eg-fsh" cx="${x + w - 22}" cy="${y + h - 15}" r="14"/>${hexNut(x + w - 22, y + h - 15, 9)}<circle class="eg-fs" cx="${x + w - 22}" cy="${y + h - 15}" r="5.5"/></g>`;
  } else {
    s += `<rect class="eg-pd" x="${x}" y="${y}" width="${w}" height="${h}" rx="9"/><rect class="eg-stripe" x="${x}" y="${y}" width="${w}" height="7" rx="3"/><rect class="eg-pdp" x="${x + 6}" y="${y + 12}" width="${w - 12}" height="40" rx="5"/>`;
    const ks = K.knobs;
    s += ks.map((d, i) => knobSvg(x + (w / (ks.length + 1)) * (i + 1), y + 32, 9, knobV(p, d.k))).join('');
    s += `<circle class="eg-led${p.on ? ' on' : ''}" cx="${x + w / 2}" cy="${y + 64}" r="4.5"/><g class="eg-fsw" data-fs="p${p.id}" role="button" aria-label="${st}"><title>${st}</title><circle class="eg-fsh" cx="${x + w / 2}" cy="${y + 102}" r="24"/>${hexNut(x + w / 2, y + 102, 15)}<circle class="eg-fs" cx="${x + w / 2}" cy="${y + 102}" r="9"/></g>`;
    if (!p.on) s += `<text class="eg-byt" x="${x + w / 2}" y="${y + 81}">スルー</text>`;
  }
  s += `<text class="eg-dl${K.short.length > 6 ? ' eg-dl-s' : ''}" x="${x + w / 2}" y="${y + h + 17}">${K.short}</text>`;
  if (listen) s += ear(x + w - 2, y + 2);
  return `${s}</g>`;
}

function guitarSvg(R: Rack, sel: boolean): string {
  const [gx, gy] = FIX_AT.pu,
    k = GK,
    X = (x: number) => GX0 + k * x,
    Y = (y: number) => GY0 + k * y,
    M = (q: [number, number]): [number, number] => [X(q[0]), Y(q[1])],
    xOf = (d: number) => SADDLE + (d / 0.648) * (NUT - SADDLE);
  let s = `<g class="eg-dev${sel ? ' eg-sel' : ''}" data-dev="pu" role="button" tabindex="0" aria-label="ギター"><rect class="eg-hit" x="${gx}" y="${gy}" width="300" height="170"/><g transform="rotate(${TILT} ${GC[0]} ${GC[1]})">`;
  s += `<path class="eg-body" d="${spline(BODY.map(M))}Z"/><path class="eg-guard" d="${spline(GUARD.map(M))}Z"/>`;
  s += `<path class="eg-neck" d="M${r1(X(28))} ${r1(Y(-3.1))}L${r1(X(NUT))} ${r1(Y(-2.7))}V${r1(Y(2.7))}L${r1(X(28))} ${r1(Y(3.1))}Z"/>`;
  let fr = '',
    dots = '';
  for (let m = 1; m <= 22; m++) {
    const x = SADDLE + (NUT - SADDLE) * 2 ** (-m / 12);
    if (x > 29) fr += `M${r1(X(x))} ${r1(Y(-3))}V${r1(Y(3))}`;
    if ([3, 5, 7, 9].includes(m) && x > 29) {
      const xm = SADDLE + ((NUT - SADDLE) * (2 ** (-m / 12) + 2 ** (-(m - 1) / 12))) / 2;
      dots += `<circle class="eg-inlay" cx="${r1(X(xm))}" cy="${r1(Y(0))}" r="1.8"/>`;
    }
  }
  s += `<path class="eg-fret" d="${fr}"/>${dots}`;
  const head: [number, number][] = [
    [NUT, -2.7],
    [NUT + 3, -5],
    [NUT + 10, -5.6],
    [NUT + 14, -3.6],
    [NUT + 14, 3.6],
    [NUT + 10, 5.6],
    [NUT + 3, 5],
    [NUT, 2.7],
  ];
  s += `<path class="eg-head" d="${spline(head.map(M))}Z"/>`;
  for (const i of [0, 1, 2])
    for (const sg of [-1, 1])
      s += `<circle class="eg-peg" cx="${r1(X(NUT + 4.5 + i * 3.6))}" cy="${r1(Y(sg * 6.6))}" r="2.6"/><path class="eg-str" d="M${r1(X(NUT + 4.5 + i * 3.6))} ${r1(Y(sg * 3.6))}V${r1(Y(sg * 5.4))}"/>`;
  const coil = COILS[R.pu.coil],
    on = PU_SEL[R.pu.sel];
  for (const p of ['neck', 'mid', 'bridge'] as const) {
    if (R.pu.coil === 'hum' && p === 'mid') continue;
    const x = xOf(PU_POS[p]),
      w = coil.gap ? 6.6 : 2.6,
      h = coil.gap ? 13 : 12.4;
    s += `<rect class="eg-puR${on.includes(p) ? ' on' : ''}" x="${r1(X(x - w / 2))}" y="${r1(Y(-h / 2))}" width="${r1(w * k)}" height="${r1(h * k)}" rx="${coil.gap ? 2 : 4}"/>`;
    for (const c of coil.gap ? [-1.6, 1.6] : [0])
      for (let j = 0; j < 6; j++)
        s += `<circle class="eg-pole" cx="${r1(X(x + c))}" cy="${r1(Y((j - 2.5) * 1.75))}" r="0.9"/>`;
  }
  s += `<rect class="eg-br" x="${r1(X(0))}" y="${r1(Y(-5.6))}" width="${r1(3.4 * k)}" height="${r1(11.2 * k)}" rx="1.5"/>`;
  for (let j = 0; j < 6; j++)
    s += `<rect class="eg-sad" x="${r1(X(1.2 + (j % 2) * 0.5))}" y="${r1(Y((j - 2.5) * 1.75 - 0.6))}" width="4" height="${r1(1.2 * k)}"/>`;
  s +=
    knobSvg(X(4), Y(12.4), 6.5, R.pu.vol) +
    knobSvg(X(10.5), Y(13.4), 6.5, R.pu.tone) +
    knobSvg(X(17), Y(12.8), 6.5, R.pu.tone);
  s += `<path class="eg-sw" d="M${r1(X(21))} ${r1(Y(9.4))}L${r1(X(24.5))} ${r1(Y(8))}"/><circle class="eg-jack" cx="${r1(X(-1.8))}" cy="${r1(Y(14.6))}" r="4"/>`;
  for (let j = 0; j < 6; j++) {
    const y = (j - 2.5) * 0.92;
    s += `<path class="eg-str" d="M${r1(X(1.8))} ${r1(Y(y * 1.9))}L${r1(X(NUT))} ${r1(Y(y))}L${r1(X(NUT + 4.5 + (j % 3) * 3.6))} ${r1(Y(j < 3 ? -3.6 : 3.6))}"/>`;
  }
  return `${s}</g><text class="eg-dl" x="${gx + 232}" y="${gy + 128}">ギター</text></g>`;
}

function ampSvg(R: Rack, sel: boolean): string {
  const [ax, ay] = FIX_AT.amp,
    a = R.amp,
    AN = { clean: 'クリーン', crunch: 'クランチ', high: 'ハイゲイン' } as const;
  return `<g class="eg-dev${sel ? ' eg-sel' : ''}" data-dev="amp" role="button" tabindex="0" aria-label="アンプ"><rect class="eg-hit" x="${ax}" y="${ay - 8}" width="280" height="82"/><path class="eg-handle" d="M${ax + 110} ${ay + 1}V${ay - 5}H${ax + 170}V${ay + 1}"/><rect class="eg-amp" x="${ax}" y="${ay}" width="280" height="74" rx="6"/><rect class="eg-panel" x="${ax + 8}" y="${ay + 8}" width="264" height="58" rx="3"/>${[a.gain, a.bass, a.mid, a.treble, a.master].map((v, i) => knobSvg(ax + 30 + i * 36, ay + 30, 10.5, v, 'eg-kb eg-kbc')).join('')}<circle class="eg-led on" cx="${ax + 256}" cy="${ay + 22}" r="5"/><text class="eg-dl" x="${ax + 222}" y="${ay + 34}">アンプ</text><text class="eg-dl eg-dls" x="${ax + 222}" y="${ay + 52}">${AN[a.type]}</text></g>`;
}
function cabSvg(R: Rack, sel: boolean): string {
  const [cx, cy] = FIX_AT.cab,
    c = R.cab,
    spk: [number, number][] =
      c.type === '4x12'
        ? [
            [cx + 92, cy + 27],
            [cx + 158, cy + 27],
            [cx + 92, cy + 71],
            [cx + 158, cy + 71],
          ]
        : c.type === '1x12'
          ? [[cx + 125, cy + 48]]
          : [],
    rr = c.type === '4x12' ? 19 : 36;
  let s = `<g class="eg-dev${sel ? ' eg-sel' : ''}" data-dev="cab" role="button" tabindex="0" aria-label="キャビネット"><rect class="eg-hit" x="${cx}" y="${cy}" width="280" height="106"/><rect class="eg-amp" x="${cx}" y="${cy}" width="280" height="96" rx="6"/><rect class="eg-grill" x="${cx + 8}" y="${cy + 8}" width="${c.type === 'off' ? 180 : 200}" height="80" rx="3"/>`;
  s += spk
    .map(
      ([x, y]) =>
        `<circle class="eg-spk" cx="${x}" cy="${y}" r="${rr}"/><circle class="eg-spkc" cx="${x}" cy="${y}" r="${r1(rr * 0.32)}"/>`,
    )
    .join('');
  if (spk.length) {
    const mx = spk[0][0] + (c.mic === 'edge' ? rr * 0.7 : 0),
      my = spk[0][1];
    s += `<path class="eg-stand" d="M${r1(mx)} ${cy + 104}V${r1(my + 14)}"/><rect class="eg-mic" x="${r1(mx - 4)}" y="${r1(my - 2)}" width="8" height="18" rx="3"/><circle class="eg-mich" cx="${r1(mx)}" cy="${r1(my - 1)}" r="4.5"/>`;
  } else s += `<text class="eg-dl eg-dls" x="${cx + 98}" y="${cy + 52}">スピーカーなし</text>`;
  return `${s}<text class="eg-dl" x="${cx + 248}" y="${cy + 52}">キャビ</text></g>`;
}

/**
 * 全体図の SVG の中身。sel は選んだ段、listen は試聴している段（'out' は出力）、
 * menu は開いている足す所、drag はドラッグ中のペダルと落とす所
 */
export function rigSvg(
  R: Rack,
  L: Layout,
  sel: StageId | null,
  listen: StageId,
  menu: { sec: Sec; i: number } | null,
  drag: { id: number; x: number; y: number; to: { sec: Sec; i: number; x: number; y: number } | null } | null,
): string {
  let s =
    '<defs><marker id="eg-ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" class="eg-ahf"/></marker><pattern id="eg-grill" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V6M3 0V6" class="eg-gl"/></pattern></defs>';
  /*
   * ケーブル: ギター（右上）→ アンプの前のペダル（右から左）→ 下りてアンプ、キャビ → マイクの後ろのペダル（左から右）→ 出力。
   * 向きに矢じり
   */
  const cab = (d: string) => `<path class="eg-cab" d="${d}" marker-end="url(#eg-ah)"/>`,
    preY = ROW.pre.y + 64,
    postY = ROW.post.y + 64,
    /* ギターのジャックから左へ出て、アンプの前の列の高さへ */
    lead = `M${r1(JACK[0])} ${r1(JACK[1])}H690V${preY}`;
  let x = 0;
  for (let i = 0; i < R.pre.length; i++) {
    const nx = pedalX('pre', i);
    s += cab(i ? `M${x} ${preY}H${nx + PW + 6}` : `${lead}H${nx + PW + 6}`);
    x = nx - 6;
  }
  /* 列の左の端から下りてアンプへ。ペダルが少なければアンプの取っ手の上で下りる */
  const tx = Math.min(160, (R.pre.length ? x : 690) - 20);
  s += `<path class="eg-cab" d="${R.pre.length ? `M${x} ${preY}` : lead}H${tx + 18}Q${tx} ${preY} ${tx} ${preY + 18}V214" marker-end="url(#eg-ah)"/>`;
  x = 300;
  let y = 350;
  for (let i = 0; i < R.post.length; i++) {
    const nx = ROW.post.x + i * STEP;
    s += cab(i ? `M${x} ${postY}H${nx - 6}` : `M${x} ${y}H316V${postY}H${nx - 6}`);
    x = nx + PW + 6;
    y = postY;
  }
  s += cab(R.post.length ? `M${x} ${postY}H${L.outX + 4}` : `M300 350H316V${postY}H${L.outX + 4}`);
  s += guitarSvg(R, sel === 'pu') + ampSvg(R, sel === 'amp') + cabSvg(R, sel === 'cab');
  for (const p of [...R.pre, ...R.post]) {
    const a = L.at.get(p.id);
    if (!a || drag?.id === p.id) continue;
    s += pedalSvg(p, a.x, a.y, sel === `p${p.id}`, listen === `p${p.id}`);
  }
  s += `<g class="eg-dev${sel === 'out' ? ' eg-sel' : ''}" data-dev="out" role="button" tabindex="0" aria-label="出力"><rect class="eg-hit" x="${L.outX}" y="${postY - 34}" width="48" height="96"/><path class="eg-out" d="M${L.outX + 8} ${postY - 12}h14l16-14v52l-16-14h-14Z"/><text class="eg-dl" x="${L.outX + 24}" y="${postY + 54}">出力</text></g>`;
  s += `<text class="eg-sec" x="${ROW.pre.x}" y="26">アンプの前</text><text class="eg-sec" x="${ROW.post.x}" y="248">マイクの後ろ</text>`;
  /* 足す所 */
  for (const sl of L.slots) {
    const on = menu && menu.sec === sl.sec && menu.i === sl.i;
    s += `<g class="eg-plus${on ? ' on' : ''}" data-slot="${sl.sec}:${sl.i}" role="button" tabindex="0" aria-label="機材を追加"><title>機材を追加</title><circle cx="${r1(sl.x)}" cy="${sl.y}" r="11"/><path d="M${r1(sl.x - 5)} ${sl.y}H${r1(sl.x + 5)}M${r1(sl.x)} ${sl.y - 5}V${sl.y + 5}"/></g>`;
  }
  /* 試聴の印（ギター・アンプ・キャビ） */
  if (listen === 'pu') s += ear(FIX_AT.pu[0] + 290, FIX_AT.pu[1] + 2);
  else if (listen === 'amp') s += ear(FIX_AT.amp[0] + 278, FIX_AT.amp[1] + 2);
  else if (listen === 'cab') s += ear(FIX_AT.cab[0] + 278, FIX_AT.cab[1] + 2);
  /* ドラッグ中のペダルと落とす所 */
  if (drag) {
    const p = [...R.pre, ...R.post].find((q) => q.id === drag.id);
    if (drag.to) s += `<path class="eg-drop" d="M${r1(drag.to.x)} ${drag.to.y - 70}V${drag.to.y + 70}"/>`;
    if (p) s += `<g class="eg-drag">${pedalSvg(p, r1(drag.x - PW / 2), r1(drag.y - PH / 2), true, false)}</g>`;
  }
  return s;
}

/* ---------- 指板 ---------- */
const SHOW_FRETS = 15;
export interface FretGeom {
  x0: number;
  y0: number;
  y1: number;
  fx: (n: number) => number;
  sy: (si: number) => number;
  mute: number;
}
export function fretGeom(w: number, h: number): FretGeom {
  const x0 = 34,
    x1 = w - 32,
    y0 = 16,
    y1 = h - 24,
    L = (x1 - x0) / (1 - 2 ** (-SHOW_FRETS / 12));
  return { x0, y0, y1, fx: (n) => x0 + L * (1 - 2 ** (-n / 12)), sy: (si) => y0 + ((y1 - y0) * si) / 5, mute: w - 22 };
}
/** 弦ごとのならした振れ（0〜1） */
const glow = new Float64Array(6);
/** 弾いた所の輪の時間 [ms] */
const FLASH_MS = 700;
/** 弾いた所の輪 */
export interface Flash {
  si: number;
  fr: number;
  at: number;
}
/** 指板の左下の移調の表記。狭いときは短くする */
function keyLabel(key: number, wide: boolean): string {
  if (!key) return '';
  const k = key > 0 ? `+${key}` : `−${-key}`,
    how = key > 0 ? `カポ ${key}` : key === -1 ? '半音下げ' : '全音下げ';
  return wide ? `移調 ${k} · ${how}` : how;
}
/** 指板。key はフレーズの移調 [半音] */
export function drawFret(cv: HTMLCanvasElement, sn: Snap | null, flash: Flash[], now: number, key = 0): void {
  const [g, w, h] = fitCanvas(cv),
    F = fretGeom(w, h);
  g.strokeStyle = C.grid2;
  g.lineWidth = 1;
  g.beginPath();
  for (let n = 1; n <= SHOW_FRETS; n++) {
    const x = Math.round(F.fx(n)) + 0.5;
    g.moveTo(x, F.y0 - 6);
    g.lineTo(x, F.y1 + 6);
  }
  g.stroke();
  g.lineWidth = 3;
  g.strokeStyle = C.sink;
  g.beginPath();
  g.moveTo(F.x0, F.y0 - 6);
  g.lineTo(F.x0, F.y1 + 6);
  g.stroke();
  const mid = (n: number) => (F.fx(n - 1) + F.fx(n)) / 2,
    yc = (F.y0 + F.y1) / 2;
  g.fillStyle = C.grid2;
  for (const n of [3, 5, 7, 9, 15]) {
    g.beginPath();
    g.arc(mid(n), yc, 4, 0, TAU);
    g.fill();
  }
  for (const dy of [-1, 1]) {
    g.beginPath();
    g.arc(mid(12), yc + dy * (F.y1 - F.y0) * 0.3, 4, 0, TAU);
    g.fill();
  }
  for (const n of [3, 5, 7, 9, 12, 15]) txt(g, String(n), mid(n), h - 9, C.sink, 12);
  /* 移調: 6 弦の下の左の端（フレットの番号の 3 より左） */
  const long = keyLabel(key, true);
  if (long) {
    g.font = `700 13px ${SANS}`;
    const fit = 4 + g.measureText(long).width < mid(3) - 12;
    txt(g, fit ? long : keyLabel(key, false), 4, h - 9, C.ch1, 13, 'left', 700, false);
  }
  for (let si = 0; si < 6; si++) {
    const v0 = sn?.str[si],
      /* 振れはフレームごとにならす（写しの間隔と、弾き直しの瞬間のちらつきを抑える） */
      raw = v0 ? Math.min(1, v0.amp / 1.2e-3) : 0;
    glow[si] += (raw - glow[si]) * (raw > glow[si] ? 0.6 : 0.12);
    const y = F.sy(si),
      v = v0,
      amp = glow[si],
      fr = v ? Math.min(SHOW_FRETS, v.fret) : 0,
      on = amp > 0.02,
      xs = fr ? F.fx(fr) - 4 : F.x0,
      xe = F.mute - 6;
    /* 1 弦がいちばん細く、6 弦がいちばん太い */
    g.lineWidth = 1 + si * 0.35;
    const line = () => {
      g.beginPath();
      if (fr) {
        g.moveTo(F.x0, y);
        g.lineTo(xs, y);
      }
      for (let x = xs; x <= xe; x += 3) {
        const u = (x - xs) / (xe - xs),
          d = amp * 5 * Math.sin(Math.PI * u) * Math.sin(now / 9 + si);
        if (x === xs) g.moveTo(x, y + d);
        else g.lineTo(x, y + d);
      }
      g.stroke();
    };
    /* 色は振れの大きさで灰から信号の色へ少しずつ変える */
    g.strokeStyle = C.sink;
    line();
    g.globalAlpha = Math.min(1, amp * 6);
    g.strokeStyle = C.ch1;
    line();
    g.globalAlpha = 1;
    if (v && on && v.fret > 0 && v.fret <= SHOW_FRETS) {
      g.fillStyle = C.ch1;
      g.beginPath();
      g.arc(mid(v.fret), y, 6, 0, TAU);
      g.fill();
    }
    if (v && on && Math.abs(v.bend) > 0.05)
      txt(g, `+${v.bend.toFixed(1)}`, mid(Math.max(1, Math.min(SHOW_FRETS, v.fret))), y - 11, C.ch1, 12);
    txt(g, String(si + 1), 14, y, C.sink, 12);
    g.strokeStyle = C.grid2;
    g.lineWidth = 1;
    g.strokeRect(F.mute + 0.5, y - 7 + 0.5, 14, 14);
  }
  for (let i = flash.length - 1; i >= 0; i--) {
    const f = flash[i],
      a = (now - f.at) / FLASH_MS;
    if (a > 1) {
      flash.splice(i, 1);
      continue;
    }
    /* 弾いた所から輪が 2 重に広がる（ギター音響モデルと同じ見せ方） */
    const x = f.fr ? mid(Math.min(SHOW_FRETS, f.fr)) : F.x0 + 14,
      y = F.sy(f.si);
    g.strokeStyle = C.ch1;
    g.fillStyle = C.ch1;
    for (const [d, lw] of [
      [0, 2.5],
      [0.25, 1.5],
    ] as const) {
      const b = (a - d) / (1 - d);
      if (b <= 0) continue;
      g.globalAlpha = 1 - b;
      g.lineWidth = lw;
      g.beginPath();
      g.arc(x, y, 5 + b * 24, 0, TAU);
      g.stroke();
    }
    g.globalAlpha = Math.max(0, 1 - 2 * a);
    g.beginPath();
    g.arc(x, y, 5, 0, TAU);
    g.fill();
    g.globalAlpha = 1;
  }
}
/** 指板の押した所: 弦とフレット。右端の四角は弦を止める */
export function fretHit(cv: HTMLCanvasElement, cx: number, cy: number): { si: number; fr: number; mute: boolean } {
  const r = cv.getBoundingClientRect(),
    x = cx - r.left,
    y = cy - r.top,
    F = fretGeom(r.width, r.height),
    si = Math.max(0, Math.min(5, Math.round(((y - F.y0) / (F.y1 - F.y0)) * 5)));
  if (x > F.mute - 4) return { si, fr: 0, mute: true };
  let fr = 0;
  for (let n = 1; n <= SHOW_FRETS; n++) if (x > F.fx(n - 1) && x <= F.fx(n)) fr = n;
  return { si, fr, mute: false };
}
