/** サンプル音源（44.1 kHz・4 秒）。この端末の中で作り、乱数は種で決まる。高い音まで出して MP3 の差が見えるようにする */
import { rng } from '../wavelet/signals';
import { FS } from './encoder';

export type SrcName = 'mix' | 'drums' | 'pluck' | 'pad';
export const SOURCES: readonly (readonly [SrcName, string, string])[] = [
  ['mix', '混ぜた音', '打楽器・撥弦・持続音のステレオ'],
  ['drums', '打楽器', 'バスドラム・スネア・ハイハット・シンバル'],
  ['pluck', '撥弦', 'Karplus-Strong の旋律'],
  ['pad', '持続音', '倍音の多い和音'],
];
export const DUR = 4;

const TAU = 2 * Math.PI;

function drums(n: number): Float32Array {
  const x = new Float32Array(n),
    r = rng(1),
    step = Math.round(FS * 0.25),
    pat = ['KH', 'H', 'SH', 'H', 'KH', 'KH', 'SH', 'HC'];
  for (let b = 0; b * step < n; b++) {
    const o = b * step,
      p = pat[b % 8];
    let hp = 0;
    for (let i = 0; i < Math.min(step * 3, n - o); i++) {
      const t = i / FS;
      let v = 0;
      if (p.includes('K'))
        v += 0.6 * Math.sin(TAU * (45 * t + 75 * 0.03 * (1 - Math.exp(-t / 0.03)))) * Math.exp(-t / 0.18);
      if (p.includes('S')) v += Math.exp(-t / 0.07) * (0.25 * (r() * 2 - 1) + 0.22 * Math.sin(TAU * 185 * t));
      if (p.includes('H') && t < 0.1) {
        const w = r() * 2 - 1;
        v += 0.14 * (w - hp) * Math.exp(-t / 0.025);
        hp = w;
      }
      if (p.includes('C')) {
        const w = r() * 2 - 1;
        v += 0.12 * (w - hp) * Math.exp(-t / 0.35);
        hp = w;
      }
      x[o + i] += v;
    }
  }
  return x;
}

function pad(n: number): Float32Array {
  const x = new Float32Array(n),
    sum = new Float64Array(n);
  /* 倍音が多いので、正弦は 2 項の漸化式で進める */
  for (const f of [220, 277.18, 329.63, 440, 554.37])
    for (let h = 1; h * f < FS / 2 - 500; h++) {
      const a = 0.08 / h,
        w = (TAU * f * h * (1 + h * 0.0004)) / FS,
        k = 2 * Math.cos(w);
      let y0 = Math.sin(h * 1.7 - w),
        y1 = Math.sin(h * 1.7);
      for (let i = 0; i < n; i++) {
        sum[i] += a * y1;
        const y2 = k * y1 - y0;
        y0 = y1;
        y1 = y2;
      }
    }
  /* 全体に 5 Hz のゆれを掛ける */
  for (let i = 0; i < n; i++) x[i] = sum[i] * (1 + 0.15 * Math.sin((TAU * 5 * i) / FS));
  return x;
}

/** Karplus-Strong の旋律 */
function pluck(n: number): Float32Array {
  const x = new Float32Array(n),
    r = rng(3),
    mel = [330, 392, 440, 494, 587, 494, 440, 392, 330, 294, 330, 392],
    step = Math.round(FS * 0.25);
  for (let k = 0; k * step < n; k++) {
    const p = Math.round(FS / mel[k % mel.length]),
      b = Float32Array.from({ length: p }, () => r() * 2 - 1);
    let j = 0,
      prev = 0;
    for (let i = k * step; i < n; i++) {
      const v = b[j];
      x[i] += 0.3 * v * Math.exp(-(i - k * step) / FS / 0.8);
      b[j] = 0.996 * 0.5 * (v + prev);
      prev = v;
      j = (j + 1) % p;
    }
  }
  return x;
}

/** 振幅の最大を 0.9 にそろえる */
function normalize(ch: Float32Array[]): Float32Array[] {
  let m = 0;
  for (const c of ch) for (let i = 0; i < c.length; i++) m = Math.max(m, Math.abs(c[i]));
  if (m > 0) for (const c of ch) for (let i = 0; i < c.length; i++) c[i] *= 0.9 / m;
  return ch;
}

/** サンプル音源を作る（1 または 2 チャンネル） */
export function makeSource(name: SrcName, dur = DUR): Float32Array[] {
  const n = Math.round(FS * dur);
  if (name === 'drums') return normalize([drums(n)]);
  if (name === 'pluck') return normalize([pluck(n)]);
  if (name === 'pad') return normalize([pad(n)]);
  const d = drums(n),
    a = pad(n),
    p = pluck(n),
    L = new Float32Array(n),
    R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    L[i] = 0.7 * d[i] + 0.35 * a[i] + 0.5 * p[i];
    R[i] = 0.7 * d[i] + 0.35 * a[Math.max(0, i - 300)] + 0.25 * p[i];
  }
  return normalize([L, R]);
}
