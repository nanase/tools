/**
 * 窓関数法: 理想のインパルス応答、窓関数、Kaiser の式（DOM に依存しない）。
 * 式は Oppenheim & Schafer『Discrete-Time Signal Processing』3rd ed. の第 7 章による
 */
import type { Resp } from './spec';

export type Win = 'rect' | 'hann' | 'hamming' | 'blackman' | 'kaiser';

/**
 * 窓の遷移帯域幅 Δf·N（Δf は fs で割った値）と、阻止域の減衰 [dB]。E. C. Ifeachor, B. W. Jervis
 * 『Digital Signal Processing: A Practical Approach』2nd ed. の窓関数の特徴の表による
 */
export const WIN_K: Record<Exclude<Win, 'kaiser'>, { k: number; as: number }> = {
  rect: { k: 0.9, as: 21 },
  hann: { k: 3.1, as: 44 },
  hamming: { k: 3.3, as: 53 },
  blackman: { k: 5.5, as: 75 },
};

/** 両端が 0 になる窓は N + 2 点で作って両端を除く */
export const dropsEnds = (w: Win): boolean => w === 'hann' || w === 'blackman';

/** 第 1 種の変形ベッセル関数 I0（べき級数） */
export function besselI0(x: number): number {
  const q = (x * x) / 4;
  let s = 1,
    t = 1;
  for (let k = 1; k < 500; k++) {
    t *= q / (k * k);
    s += t;
    if (t < s * 1e-17) break;
  }
  return s;
}

/** Kaiser の式: 阻止域の減衰 A [dB] から β */
export function kaiserBeta(A: number): number {
  if (A > 50) return 0.1102 * (A - 8.7);
  if (A >= 21) return 0.5842 * (A - 21) ** 0.4 + 0.07886 * (A - 21);
  return 0;
}

/** Kaiser の式: 次数 M（= N − 1）の目安。dw は遷移帯域幅 [rad/sample] */
export const kaiserOrder = (A: number, dw: number): number => (A - 8) / (2.285 * dw);

/** 長さ N の窓 w[0..N−1]（対称） */
export function windowOf(w: Win, N: number, beta = 0): Float64Array {
  const o = new Float64Array(N);
  if (N === 1) {
    o[0] = 1;
    return o;
  }
  /* 両端が 0 になる窓は N + 2 点の窓の 1 … N 番目を使う */
  const L = dropsEnds(w) ? N + 1 : N - 1,
    s = dropsEnds(w) ? 1 : 0,
    i0b = besselI0(beta);
  for (let n = 0; n < N; n++) {
    const c = (2 * Math.PI * (n + s)) / L;
    switch (w) {
      case 'rect':
        o[n] = 1;
        break;
      case 'hann':
        o[n] = 0.5 - 0.5 * Math.cos(c);
        break;
      case 'hamming':
        o[n] = 0.54 - 0.46 * Math.cos(c);
        break;
      case 'blackman':
        o[n] = 0.42 - 0.5 * Math.cos(c) + 0.08 * Math.cos(2 * c);
        break;
      case 'kaiser': {
        const r = (2 * n) / L - 1;
        o[n] = besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / i0b;
        break;
      }
    }
  }
  /* 対称にそろえる（浮動小数点の誤差で左右がずれないように） */
  for (let n = 0; n < N >> 1; n++) o[N - 1 - n] = o[n];
  return o;
}

/** 理想ローパスのインパルス応答 sin(ωc m)/(π m)（m = n − M）。wc [rad/sample] */
const lp = (wc: number, m: number): number => (m === 0 ? wc / Math.PI : Math.sin(wc * m) / (Math.PI * m));

/**
 * 理想のインパルス応答 h_d[n]（遅延 M = (N − 1)/2）。f1・f2 は fs で割った周波数（0 … 0.5）。
 * HPF・BSF は N が奇数のときだけ使える（偶数では z = −1 に零点ができる）
 */
export function idealOf(t: Resp, N: number, f1: number, f2: number): Float64Array {
  const M = (N - 1) / 2,
    w1 = 2 * Math.PI * f1,
    w2 = 2 * Math.PI * f2,
    o = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    const m = n - M,
      d = m === 0 ? 1 : 0;
    switch (t) {
      case 'lowpass':
        o[n] = lp(w1, m);
        break;
      case 'highpass':
        o[n] = d - lp(w1, m);
        break;
      case 'bandpass':
        o[n] = lp(w2, m) - lp(w1, m);
        break;
      case 'bandstop':
        o[n] = d - lp(w2, m) + lp(w1, m);
        break;
    }
  }
  /* sin(π k) の丸め誤差で 0 になるはずの値が残らないように */
  const pk = Math.max(...o.map(Math.abs));
  for (let n = 0; n < N; n++) if (Math.abs(o[n]) < pk * 1e-14) o[n] = 0;
  for (let n = 0; n < N >> 1; n++) o[N - 1 - n] = o[n];
  return o;
}

export interface WinDesign {
  h: Float64Array;
  /** 理想のインパルス応答 */
  hd: Float64Array;
  /** 窓 */
  w: Float64Array;
}

/** 窓関数法: h[n] = h_d[n] w[n] */
export function windowDesign(t: Resp, N: number, f1: number, f2: number, win: Win, beta: number): WinDesign {
  const hd = idealOf(t, N, f1, f2),
    w = windowOf(win, N, beta),
    h = hd.map((x, n) => x * w[n]);
  return { h, hd, w };
}
