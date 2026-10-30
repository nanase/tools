/**
 * 閾値の決め方（DOM に依存しない）。雑音の σ の推定（全体で 1 つ・段ごと）と、
 * 普遍閾値（VisuShrink）・SURE（SureShrink）・BayesShrink の λ を段ごとに求めて詳細の係数を縮める
 */
import { type Coeffs, type Shrink, shrink, sigmaMad, universal } from '../wavelet/dwt';

export type Rule = 'universal' | 'sure' | 'bayes';
export type SigmaMode = 'global' | 'level' | 'quiet';

/**
 * SURE が最小になる柔らかい閾値 t（σ = 1 にそろえた係数 x で）。
 * SURE(t) = n − 2 #{|x_i| ≤ t} + Σ min(x_i², t²)。候補は |x_i| と 0、上限は √(2 ln n)
 */
export function sureMin(x: ArrayLike<number>): number {
  const n = x.length;
  if (n === 0) return 0;
  const s = Float64Array.from(x, (v) => v * v).sort(),
    cap = 2 * Math.log(n);
  let best = n,
    t2 = 0,
    cum = 0;
  for (let k = 0; k < n; k++) {
    cum += s[k];
    if (s[k] > cap) break;
    const r = n - 2 * (k + 1) + cum + (n - k - 1) * s[k];
    if (r < best) {
      best = r;
      t2 = s[k];
    }
  }
  return Math.sqrt(t2);
}

/**
 * SureShrink の段の閾値（σ = 1）。係数が疎なとき（s² = Σ(x_i² − 1)/n ≤ (log2 n)^(3/2)/√n）は SURE がぶれるので、
 * 普遍閾値 √(2 ln n) に切り替える（Donoho・Johnstone 1995 の hybrid）
 */
export function sureHybrid(x: ArrayLike<number>): number {
  const n = x.length;
  if (n === 0) return 0;
  let e = 0;
  for (let i = 0; i < n; i++) e += x[i] * x[i] - 1;
  const s2 = e / n,
    eta = Math.log2(n) ** 1.5 / Math.sqrt(n);
  return s2 <= eta ? Math.sqrt(2 * Math.log(n)) : sureMin(x);
}

/** BayesShrink の閾値 λ = σ² / σ_X、σ_X = √max(mean(d²) − σ², 0)。σ_X = 0 なら全部捨てる */
export function bayesLam(d: ArrayLike<number>, sigma: number): number {
  let e = 0;
  for (let i = 0; i < d.length; i++) e += d[i] * d[i];
  const sx2 = e / Math.max(1, d.length) - sigma * sigma;
  if (sx2 <= 0) {
    let m = 0;
    for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
    return m;
  }
  return (sigma * sigma) / Math.sqrt(sx2);
}

export interface Plan {
  /** 段ごとの σ と λ（添字は c.d と同じ。0 が最も細かい） */
  sig: Float64Array;
  lam: Float64Array;
}

/**
 * 雑音だけの区間 [i0, i1)（元の信号の標本の番号）から、段ごとの σ を測る。段 j（0 が最も細かい）の係数は
 * 2^(j+1) 点ごとなので、区間を縮めて使う。フィルタの長さの分だけ両端を削り、区間に入る係数が 8 個より少ない段は
 * 1 つ細かい段の値を使う
 */
export function quietSigma(c: Coeffs, i0: number, i1: number): Float64Array {
  const J = c.d.length,
    L = c.d.length ? 8 : 0,
    out = new Float64Array(J);
  for (let j = 0; j < J; j++) {
    const s = 2 ** (j + 1),
      a = Math.ceil(i0 / s) + L,
      b = Math.floor(i1 / s) - L;
    out[j] = b - a >= 8 ? sigmaMad(c.d[j].subarray(a, b)) : j ? out[j - 1] : sigmaMad(c.d[0]);
  }
  return out;
}

/** 雑音だけの音の係数から、段ごとの σ を測る（区間を切らずに全体を使う） */
export const levelSigma = (c: Coeffs): Float64Array => Float64Array.from(c.d, (d) => sigmaMad(d));

/**
 * 段ごとの σ と λ。σ は最も細かい詳細から 1 つ（global）か、段ごとに中央値から（level）か、
 * 雑音だけから段ごとに（quiet）。quiet の σ は、雑音だけの区間 [i0, i1) か、測っておいた段ごとの σ で渡す。
 * k は λ に掛ける倍率（1 で各規則のまま）。N は信号の長さ（普遍閾値の n）
 */
export function plan(
  c: Coeffs,
  rule: Rule,
  sm: SigmaMode,
  k = 1,
  quiet?: readonly [number, number] | Float64Array,
): Plan {
  const J = c.d.length,
    N = c.d.reduce((s, v) => s + v.length, c.a.length),
    g = sigmaMad(c.d[0]),
    q = sm !== 'quiet' || !quiet ? null : quiet instanceof Float64Array ? quiet : quietSigma(c, quiet[0], quiet[1]),
    sig = Float64Array.from({ length: J }, (_, j) => (q ? q[j] : sm === 'level' ? sigmaMad(c.d[j]) : g)),
    lam = new Float64Array(J);
  for (let j = 0; j < J; j++) {
    const d = c.d[j],
      s = sig[j];
    if (s <= 0) continue;
    lam[j] =
      k *
      (rule === 'universal'
        ? universal(s, N)
        : rule === 'sure'
          ? s * sureHybrid(Float64Array.from(d, (v) => v / s))
          : bayesLam(d, s));
  }
  return { sig, lam };
}

/** 段ごとの λ で詳細を縮める（近似は残す）。返すのは新しい係数と、残った係数の数 */
export function apply(c: Coeffs, lam: ArrayLike<number>, m: Shrink): { c: Coeffs; kept: number } {
  let kept = c.a.length;
  const d = c.d.map((v, j) =>
    v.map((x) => {
      const y = shrink(x, lam[j], m);
      if (y !== 0) kept++;
      return y;
    }),
  );
  return { c: { w: c.w, a: Float64Array.from(c.a), d }, kept };
}
