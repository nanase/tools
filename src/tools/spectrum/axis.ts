/**
 * 周波数軸と読み取り（DOM に依存しない）: リニア・対数・メルの写像、FFT の bin と表示の点の対応、
 * 目盛り、ピークの補間、音名
 */

export type Axis = 'lin' | 'log' | 'mel';

/** メル尺度（O'Shaughnessy 1987） */
export const mel = (f: number): number => 2595 * Math.log10(1 + f / 700);
export const imel = (m: number): number => 700 * (10 ** (m / 2595) - 1);

export interface AxisFn {
  /** 実際に使う表示範囲（対数では 0 Hz を使えないので下端を上げる） */
  lo: number;
  hi: number;
  /** 周波数 → 0〜1 */
  fwd: (f: number) => number;
  /** 0〜1 → 周波数 */
  inv: (u: number) => number;
}

/**
 * 周波数軸。fl〜fh を表示し、fh は fs/2 で頭打ち。対数のときは下端を Δf（= fs/N）と 1 Hz 以上にする
 */
export function axisFn(ax: Axis, fl: number, fh: number, fs: number, N: number): AxisFn {
  const hi = Math.min(fh, fs / 2);
  let lo = Math.min(fl, hi / 2);
  if (ax === 'log') lo = Math.max(lo, fs / N, 1);
  if (ax === 'lin') return { lo, hi, fwd: (f) => (f - lo) / (hi - lo), inv: (u) => lo + u * (hi - lo) };
  if (ax === 'log') {
    const a = Math.log(lo),
      b = Math.log(hi);
    return { lo, hi, fwd: (f) => (Math.log(Math.max(f, 1e-9)) - a) / (b - a), inv: (u) => Math.exp(a + u * (b - a)) };
  }
  const a = mel(lo),
    b = mel(hi);
  return { lo, hi, fwd: (f) => (mel(f) - a) / (b - a), inv: (u) => imel(a + u * (b - a)) };
}

/**
 * 表示の n 点それぞれに、まとめる bin の範囲 k0..k1 を決める。範囲に bin がない（bin より細かい）点は、
 * 補間する位置 fk（bin の番号、小数）を使う
 */
export interface BinMap {
  k0: Int32Array;
  k1: Int32Array;
  fk: Float32Array;
}
export function binMap(n: number, ax: AxisFn, fs: number, N: number): BinMap {
  const df = fs / N,
    h = N / 2,
    k0 = new Int32Array(n),
    k1 = new Int32Array(n),
    fk = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    const u0 = Math.max(0, (j - 0.5) / (n - 1)),
      u1 = Math.min(1, (j + 0.5) / (n - 1));
    k0[j] = Math.max(0, Math.ceil(ax.inv(u0) / df));
    k1[j] = Math.min(h, Math.floor(ax.inv(u1) / df));
    fk[j] = Math.min(h - 1, ax.inv(j / (n - 1)) / df);
  }
  return { k0, k1, fk };
}
/** 表示の点 j の値: 範囲の最大か、隣の bin の直線補間 */
export function valAt(P: ArrayLike<number>, m: BinMap, j: number): number {
  if (m.k1[j] >= m.k0[j]) {
    let v = 0;
    for (let k = m.k0[j]; k <= m.k1[j]; k++) if (P[k] > v) v = P[k];
    return v;
  }
  const x = m.fk[j],
    i = Math.floor(x),
    t = x - i;
  return P[i] * (1 - t) + P[i + 1] * t;
}

/** 1-2-5 の切りのよい刻み（x 以上） */
export function niceStep(x: number): number {
  const e = 10 ** Math.floor(Math.log10(x)),
    m = x / e;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * e;
}
/** 周波数の目盛り。リニアは 8 区間前後の切りのよい刻み、対数・メルは 1-2-5 */
export function fTicks(ax: Axis, f: AxisFn): number[] {
  const out: number[] = [];
  if (ax === 'lin') {
    const st = niceStep((f.hi - f.lo) / 8);
    for (let x = Math.ceil(f.lo / st) * st; x <= f.hi + 1e-9; x += st) out.push(Number(x.toPrecision(12)));
  } else
    for (let d = 0; d <= 5; d++)
      for (const b of [1, 2, 5]) {
        const x = b * 10 ** d;
        if (x >= f.lo - 1e-9 && x <= f.hi + 1e-9) out.push(x);
      }
  return out;
}
/** 目盛りの短い表記（20・500・1k・2.5k） */
export const fLab = (f: number): string =>
  f >= 1000 ? `${Number((f / 1000).toPrecision(3))}k` : `${Number(f.toPrecision(3))}`;
/** dB の目盛りの刻み: 8 区間以下になる最小の刻み */
export const dbStep = (range: number): number => [5, 10, 20, 30, 50].find((s) => range / s <= 8) ?? 50;

/**
 * ピーク: lo〜hi の bin のうちパワーが最大のものを、前後の bin の dB で放物線補間する。
 * 返すのは周波数と dB。パワーがすべて 0 なら null
 */
export function peak(P: (k: number) => number, k0: number, k1: number, df: number): { f: number; db: number } | null {
  let bk = -1,
    bv = 0;
  for (let k = Math.max(1, k0); k <= k1; k++) {
    const v = P(k);
    if (v > bv) {
      bv = v;
      bk = k;
    }
  }
  if (bk < 0 || bv < 1e-14) return null;
  const db = (p: number) => 10 * Math.log10(p + 1e-20),
    a = db(P(bk - 1)),
    b = db(bv),
    c = db(P(bk + 1)),
    den = a - 2 * b + c,
    d = den < 0 ? (0.5 * (a - c)) / den : 0;
  return { f: (bk + d) * df, db: b - 0.25 * (a - c) * d };
}

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
/** 音名とずれ（A4 = 440 Hz の平均律）。16 Hz 未満は '' */
export function noteOf(f: number): { name: string; cent: number } | null {
  if (!(f >= 16)) return null;
  const x = 12 * Math.log2(f / 440) + 69,
    n = Math.round(x);
  return { name: `${NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`, cent: Math.round((x - n) * 100) };
}
