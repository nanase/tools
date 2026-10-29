/**
 * 畳み込みのページの 1 次元の計算（DOM に依存しない）: 信号の形、畳み込みと相関、
 * 滑らせた位置での積と面積、円状畳み込み、スペクトル。
 * 連続の信号は刻み dt の格子の値で持ち、積分は dt を掛けた和で近似する。離散は dt = 1
 */
import { fft, plan } from '../spectrum/fft';

/** 格子の上の信号: v[i] は時刻 t0 + i·dt の値 */
export interface Sig {
  t0: number;
  dt: number;
  v: Float64Array;
}
export const sig = (t0: number, dt: number, v: ArrayLike<number>): Sig => ({ t0, dt, v: Float64Array.from(v) });
/** 最後の標本の時刻 */
export const tEnd = (s: Sig): number => s.t0 + (s.v.length - 1) * s.dt;

/**
 * 畳み込み y = x ∗ h（長さ N + M − 1）。y[k] = dt Σ_i x[i] h[k − i]、y の始まりは x と h の始まりの和。
 * 離散（dt = 1）では Smith の式 6-1、連続では ∫ x(τ) h(t − τ) dτ の長方形近似
 */
export function conv(x: Sig, h: Sig): Sig {
  if (Math.abs(x.dt - h.dt) > 1e-12 * x.dt) throw new Error('dt mismatch');
  const N = x.v.length,
    M = h.v.length,
    y = new Float64Array(N + M - 1);
  for (let i = 0; i < N; i++) {
    const a = x.v[i];
    if (a === 0) continue;
    for (let j = 0; j < M; j++) y[i + j] += a * h.v[j];
  }
  if (x.dt !== 1) for (let k = 0; k < y.length; k++) y[k] *= x.dt;
  return { t0: x.t0 + h.t0, dt: x.dt, v: y };
}

/** 相互相関 r(t) = ∫ x(τ) h(τ − t) dτ … ではなく、h を裏返さずに重ねる形 r(t) = ∫ x(τ + t) h(τ) dτ（Goodfellow ほかの式 9.6 の 1 次元） */
export function corr(x: Sig, h: Sig): Sig {
  return conv(x, flip(h));
}

/** 時間を裏返す: h(t) → h(−t) */
export function flip(h: Sig): Sig {
  const M = h.v.length,
    v = new Float64Array(M);
  for (let j = 0; j < M; j++) v[j] = h.v[M - 1 - j];
  return { t0: -tEnd(h), dt: h.dt, v };
}

/** 時刻 t の値（格子の間は直線で補い、範囲の外は 0） */
export function at(s: Sig, t: number): number {
  const u = (t - s.t0) / s.dt,
    i = Math.floor(u + 1e-9);
  if (i < 0 || i > s.v.length - 1) return 0;
  const f = u - i;
  if (f < 1e-9 || i === s.v.length - 1) return s.v[i];
  return s.v[i] * (1 - f) + s.v[i + 1] * f;
}

/** 滑らせた位置 t での、x の格子の上の積 x(τ)·h(t − τ) と、その面積（dt を掛けた和）。y(t) に等しい */
export interface Slide {
  /** h(t − τ)（x の格子の上） */
  hf: Float64Array;
  /** x(τ)·h(t − τ) */
  p: Float64Array;
  area: number;
}
export function slide(x: Sig, h: Sig, t: number): Slide {
  const N = x.v.length,
    hf = new Float64Array(N),
    p = new Float64Array(N);
  let s = 0;
  for (let i = 0; i < N; i++) {
    const v = at(h, t - (x.t0 + i * x.dt));
    hf[i] = v;
    p[i] = x.v[i] * v;
    s += p[i];
  }
  return { hf, p, area: s * x.dt };
}

/** 和 Σ v·dt（面積） */
export function area(s: Sig): number {
  let a = 0;
  for (let i = 0; i < s.v.length; i++) a += s.v[i];
  return a * s.dt;
}

/** 長さ L の円状畳み込み（x と h は先頭から並べ、L を超えた分は頭へ回す。JOS MDFT「Convolution Theorem」の ⊛） */
export function cconv(x: ArrayLike<number>, h: ArrayLike<number>, L: number): Float64Array {
  const y = new Float64Array(L);
  for (let i = 0; i < x.length; i++) for (let j = 0; j < h.length; j++) y[(((i + j) % L) + L) % L] += x[i] * h[j];
  return y;
}

/** L 点（2 の累乗）の DFT。足りない分は 0 で埋め、長い分は頭へ回して足す（円状に折り返す） */
export function dft(v: ArrayLike<number>, L: number): { re: Float64Array; im: Float64Array } {
  const p = plan(L);
  p.re.fill(0);
  p.im.fill(0);
  for (let i = 0; i < v.length; i++) p.re[i % L] += v[i];
  fft(p);
  return { re: p.re.slice(), im: p.im.slice() };
}

/** 2 の累乗で n 以上の最小の数 */
export const pow2 = (n: number): number => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

/**
 * 振幅スペクトル |X(f)|（f = 0 … 1/(2dt)、L/2 + 1 点）。連続の信号ではフーリエ変換の近似 dt·|DFT| になる。
 * 畳み込み定理から、L ≥ N + M − 1 なら |Y| = |X|·|H| がそのまま成り立つ
 */
export function spectrum(s: Sig, L: number): Float64Array {
  const { re, im } = dft(s.v, L),
    m = new Float64Array(L / 2 + 1);
  for (let k = 0; k <= L / 2; k++) m[k] = Math.hypot(re[k], im[k]) * s.dt;
  return m;
}

/* ---------- 信号の形 ---------- */

/** 乱数（種から決まる） */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Shape = 'rect' | 'tri' | 'exp' | 'gauss' | 'delta' | 'echo' | 'step' | 'burst' | 'comb' | 'noise' | 'dice';
/**
 * 形 kind を幅 w で、時刻 0 から（ガウスと三角は 0 を中心に）描いた値。
 * 連続では delta は面積 1 の 1 刻みの柱（高さ 1/dt）、離散では 1。
 * area を真にすると面積を 1 にそろえる（ぼかしの核）
 */
export function shape(kind: Shape, w: number, t0: number, n: number, dt: number, normArea = false): Sig {
  const v = new Float64Array(n),
    disc = dt === 1,
    r = mulberry(7);
  for (let i = 0; i < n; i++) {
    const t = t0 + i * dt,
      e = disc ? 0.5 : 1e-9;
    let y = 0;
    switch (kind) {
      case 'rect':
        y = t > -e && t < w - e ? 1 : 0;
        break;
      case 'tri':
        y = Math.max(0, 1 - Math.abs(t) / w);
        break;
      case 'exp':
        y = t > -e ? Math.exp(-t / w) : 0;
        break;
      case 'gauss':
        y = Math.exp(-(t * t) / (2 * w * w));
        break;
      case 'delta':
        y = Math.abs(t) < e ? 1 / dt : 0;
        break;
      case 'echo':
        y = Math.abs(t) < e ? 1 / dt : Math.abs(t - w) < e ? 0.6 / dt : 0;
        break;
      case 'step':
        y = t > -e ? 1 : 0;
        break;
      case 'burst':
        y = t > -e && t < w * 3 - e ? Math.sin((2 * Math.PI * t) / w) : 0;
        break;
      case 'comb': {
        /* 間隔 w のインパルスの列（4 本） */
        const k = Math.round(t / w);
        y = k >= 0 && k < 4 && Math.abs(t - k * w) < e ? 1 / dt : 0;
        break;
      }
      case 'noise':
        y = t > -e && t < w - e ? r() * 2 - 1 : 0;
        break;
      case 'dice':
        /* 1〜6 の目が 1/6 ずつ（離散だけ。Grinstead・Snell の例 7.1） */
        y = Math.round(t) >= 1 && Math.round(t) <= 6 ? 1 / 6 : 0;
        break;
    }
    v[i] = y;
  }
  const s = { t0, dt, v };
  if (normArea) {
    const a = area(s);
    if (a !== 0) for (let i = 0; i < n; i++) v[i] /= a;
  }
  return s;
}

/** 同じ分布を n 回足した和の分布（n 回の畳み込み）。Grinstead・Snell の 7.1 節 */
export function sumOf(p: Sig, n: number): Sig {
  let s = p;
  for (let k = 1; k < n; k++) s = conv(s, p);
  return s;
}

/** 平均と分散（v を重みとして。確率の分布なら平均と分散そのもの） */
export function moments(s: Sig): { mean: number; vari: number } {
  let w = 0,
    m = 0;
  for (let i = 0; i < s.v.length; i++) {
    w += s.v[i];
    m += s.v[i] * (s.t0 + i * s.dt);
  }
  m /= w;
  let q = 0;
  for (let i = 0; i < s.v.length; i++) q += s.v[i] * (s.t0 + i * s.dt - m) ** 2;
  return { mean: m, vari: q / w };
}
