/**
 * 乾いた音（DOM に依存しない）: 残響のない音を合成する。部屋のインパルス応答を畳み込んで聞く元の音。
 * どれも聞き比べのための合成音で、模型には基づかない。1 m 先で最大 1 になる大きさ
 */
import { gauss } from './ir';

export interface Dry {
  v: string;
  name: string;
  /** 標本化周波数 fs の音を作る */
  make: (fs: number) => Float32Array;
}

/** 最大の絶対値を 1 にする */
function peak1(x: Float32Array): Float32Array {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] /= m;
  return x;
}

/** 2 次の帯域通過（双 1 次変換、RBJ の式。ピークの利得 0 dB） */
function bandpass(x: Float32Array, fs: number, f0: number, q: number): Float32Array {
  const w = (2 * Math.PI * f0) / fs,
    al = Math.sin(w) / (2 * q),
    a0 = 1 + al,
    b0 = al / a0,
    a1 = (-2 * Math.cos(w)) / a0,
    a2 = (1 - al) / a0,
    y = new Float32Array(x.length);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] - b0 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/** 1 標本だけの音（インパルス応答そのものを聞く） */
const click = (fs: number) => {
  const x = new Float32Array(Math.round(0.01 * fs));
  x[0] = 1;
  return x;
};

/** 手拍子: 数 ms ずれた 3 つの雑音の破裂を 1〜2 kHz の帯域に絞る */
function clap(fs: number): Float32Array {
  const r = gauss(5),
    x = new Float32Array(Math.round(0.12 * fs));
  for (const [t, a, tau] of [
    [0, 0.6, 0.002],
    [0.006, 0.8, 0.002],
    [0.011, 1, 0.012],
  ]) {
    const k0 = Math.round(t * fs);
    for (let k = 0; k0 + k < x.length; k++) x[k0 + k] += a * r() * Math.exp(-k / (tau * fs));
  }
  return peak1(bandpass(x, fs, 1300, 1.2));
}

/** 拍子木: 堅い木の打撃。減衰の速さが違う 3 つの部分音 */
function block(fs: number): Float32Array {
  const x = new Float32Array(Math.round(0.25 * fs));
  for (const [f, a, tau] of [
    [880, 1, 0.045],
    [2410, 0.5, 0.018],
    [4720, 0.25, 0.008],
  ])
    for (let k = 0; k < x.length; k++) x[k] += a * Math.sin((2 * Math.PI * f * k) / fs) * Math.exp(-k / (tau * fs));
  return peak1(x);
}

/** 短い言葉の代わり: 母音「ア」に近い 3 つの共鳴に、120 Hz のパルス列を 0.35 s 通す */
function vowel(fs: number): Float32Array {
  const n = Math.round(0.45 * fs),
    src = new Float32Array(n),
    p = Math.round(fs / 120),
    on = Math.round(0.35 * fs);
  for (let k = 0; k < on; k += p) src[k] = 1;
  let y = new Float32Array(n);
  for (const [f, q, g] of [
    [800, 8, 1],
    [1200, 10, 0.6],
    [2500, 12, 0.25],
  ]) {
    const b = bandpass(src, fs, f, q);
    for (let k = 0; k < n; k++) y[k] += g * b[k];
  }
  /* 入りと切れを 20 ms でなめらかに */
  const fd = Math.round(0.02 * fs);
  for (let k = 0; k < fd; k++) y[k] *= k / fd;
  for (let k = 0; k < fd; k++) y[on - 1 - k] *= k / fd;
  y = y.map((v, k) => (k < on ? v : 0));
  return peak1(y);
}

export const DRY: readonly Dry[] = [
  { v: 'clap', name: '手拍子', make: clap },
  { v: 'block', name: '拍子木', make: block },
  { v: 'vowel', name: '声（ア）', make: vowel },
  { v: 'click', name: 'インパルス', make: click },
];
export const dryOf = (v: string): Dry => DRY.find((d) => d.v === v) ?? DRY[0];
