/**
 * 試しの音と、足す雑音（DOM に依存しない）。どれもこの端末の中で作り、乱数は種で決まる
 */
import { gauss, rng } from '../wavelet/signals';

export type Clip = 'drums' | 'pluck' | 'organ' | 'mix';
export const CLIPS: readonly (readonly [Clip, string])[] = [
  ['drums', '打楽器'],
  ['pluck', '撥弦'],
  ['organ', '持続音'],
  ['mix', '低音・打音・高音'],
];

const TAU = 2 * Math.PI;

/** 打楽器: 120 BPM の 8 分音符。バスドラム（音程が下がる正弦）・スネア（雑音＋胴の音）・ハイハット（高い雑音） */
function drums(fs: number, n: number, r: () => number): Float32Array {
  const x = new Float32Array(n),
    step = Math.round(fs * 0.25);
  /* 1 小節 8 拍: K = バス、S = スネア、H = ハイハット */
  const pat = ['KH', 'H', 'SH', 'H', 'KH', 'KH', 'SH', 'H'];
  let hp = 0;
  for (let b = 0; b * step < n; b++) {
    const o = b * step,
      p = pat[b % 8];
    for (let i = 0; i < Math.min(step * 2, n - o); i++) {
      const t = i / fs;
      let v = 0;
      if (p.includes('K')) {
        /* 120 Hz から 45 Hz へ、位相は周波数の積分 */
        const ph = TAU * (45 * t + 75 * 0.03 * (1 - Math.exp(-t / 0.03)));
        v += 0.7 * Math.sin(ph) * Math.exp(-t / 0.18);
      }
      if (p.includes('S')) v += Math.exp(-t / 0.06) * (0.175 * gauss(r) + 0.25 * Math.sin(TAU * 185 * t));
      if (p.includes('H') && t < 0.08) {
        /* 1 次の差分で高い所だけ残した雑音 */
        const w = gauss(r);
        v += 0.12 * (w - hp) * Math.exp(-t / 0.02);
        hp = w;
      }
      x[o + i] += v;
    }
  }
  return x;
}

/** 撥弦: Karplus・Strong（遅延の線で平均をとって返す）で、ハ長調の分散和音 */
function pluck(fs: number, n: number, r: () => number): Float32Array {
  const x = new Float32Array(n),
    notes = [261.63, 329.63, 392, 523.25, 392, 329.63, 261.63, 196],
    step = Math.round(fs * 0.5);
  notes.forEach((f, k) => {
    const o = k * step,
      L = Math.round(fs / f),
      buf = Float64Array.from({ length: L }, () => r() * 2 - 1);
    let j = 0;
    for (let i = 0; o + i < n && i < fs * 2; i++) {
      const a = buf[j],
        b = buf[(j + 1) % L];
      buf[j] = 0.498 * (a + b);
      x[o + i] += 0.3 * a;
      j = (j + 1) % L;
    }
  });
  return x;
}

/** 持続音: ハ長調の和音（倍音 8 本、ゆっくりした揺れ）。立ち上がりと切れ目は 30 ms でつなぐ */
function organ(fs: number, n: number): Float32Array {
  const x = new Float32Array(n),
    chords = [
      [130.81, 164.81, 196],
      [146.83, 174.61, 220],
      [130.81, 164.81, 196],
    ],
    seg = n / chords.length;
  for (let i = 0; i < n; i++) {
    const t = i / fs,
      c = Math.min(chords.length - 1, Math.floor(i / seg)),
      u = (i - c * seg) / fs,
      e = Math.min(1, u / 0.03, (seg / fs - u) / 0.03),
      vib = 1 + 0.003 * Math.sin(TAU * 5 * t);
    let v = 0;
    for (const f of chords[c]) for (let h = 1; h <= 8; h++) v += Math.sin(TAU * f * h * vib * t) / (h * h);
    x[i] = 0.12 * e * v;
  }
  return x;
}

/** 低い音・打音・高い音（ウェーブレット変換のページの試しの音と同じ形） */
function mix(fs: number, n: number): Float32Array {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / fs,
      tc = t % 0.25,
      th = (t + 0.125) % 0.5;
    x[i] =
      0.2 * Math.sin(TAU * 110 * t) +
      0.3 * Math.exp(-tc / 0.001) * (tc < 0.01 ? 1 : 0) * (i % 2 ? 1 : -1) +
      (th < 0.08 ? 0.15 * Math.sin(TAU * 3500 * t) * Math.sin((Math.PI * th) / 0.08) : 0);
  }
  return x;
}

/** 試しの音（音は dur 秒、その前に lead 秒の無音）。最大の絶対値を 0.5 にそろえる */
export function clip(kind: Clip, fs: number, dur: number, lead = 0, seed = 11): Float32Array {
  const n = Math.round(fs * dur),
    z = Math.round(fs * lead),
    r = rng(seed),
    x =
      kind === 'drums'
        ? drums(fs, n, r)
        : kind === 'pluck'
          ? pluck(fs, n, r)
          : kind === 'organ'
            ? organ(fs, n)
            : mix(fs, n);
  let m = 1e-9;
  for (const v of x) m = Math.max(m, Math.abs(v));
  const out = new Float32Array(z + n);
  for (let i = 0; i < n; i++) out[z + i] = (x[i] * 0.5) / m;
  return out;
}

/* ---------- 雑音 ---------- */

export type Noise = 'white' | 'pink';
export const NOISES: readonly (readonly [Noise, string])[] = [
  ['white', '白色'],
  ['pink', 'ピンク'],
];

/** 平均 0・標準偏差 1 の雑音。ピンクは白色雑音を 1/f の近似のフィルタ（Kellet の 7 項）に通す */
export function noise(kind: Noise, n: number, seed = 5): Float32Array {
  const r = rng(seed),
    x = new Float32Array(n);
  if (kind === 'white') for (let i = 0; i < n; i++) x[i] = gauss(r);
  else {
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = gauss(r);
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      x[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    }
  }
  /* 平均 0・標準偏差 1 にそろえる */
  let m = 0,
    s = 0;
  for (const v of x) m += v;
  m /= n;
  for (const v of x) s += (v - m) ** 2;
  const sd = Math.sqrt(s / n) || 1;
  for (let i = 0; i < n; i++) x[i] = (x[i] - m) / sd;
  return x;
}

export const rms = (x: ArrayLike<number>): number => {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, x.length));
};

/** x に雑音を足して SN 比 snrDb（実効値の比）にする。返すのは [雑音入り, 足した雑音] */
export function addNoise(x: Float32Array, kind: Noise, snrDb: number, seed = 5): [Float32Array, Float32Array] {
  const w = noise(kind, x.length, seed),
    g = rms(x) / 10 ** (snrDb / 20);
  for (let i = 0; i < w.length; i++) w[i] *= g;
  return [Float32Array.from(x, (v, i) => v + w[i]), w];
}

/** 最も静かな len 秒の区間 [始め, 終わり)（標本の番号）。50 ms ごとにずらして 2 乗和を比べる */
export function quietest(x: ArrayLike<number>, fs: number, len = 0.4): [number, number] {
  const L = Math.min(x.length, Math.round(len * fs)),
    st = Math.max(1, Math.round(0.05 * fs));
  let best = Number.POSITIVE_INFINITY,
    at = 0;
  for (let i = 0; i + L <= x.length; i += st) {
    let s = 0;
    for (let j = i; j < i + L; j++) s += x[j] * x[j];
    if (s < best) {
      best = s;
      at = i;
    }
  }
  return [at, at + L];
}
