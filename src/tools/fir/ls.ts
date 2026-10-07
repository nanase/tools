/**
 * 最小二乗法: 帯域ごとの重み付き二乗誤差 Σ W ∫ (A(ω) − D)² dω を最小にする直線位相（タイプ I・II）の FIR フィルタ。
 * 遷移帯域は誤差に数えない。正規方程式の係数は積分を解析的に求め、コレスキー分解で解く（C. S. Burrus, A. W. Soewito,
 * R. A. Gopinath, "Least Squared Error FIR Filter Design with Transition Bands", IEEE Trans. Signal Processing,
 * 40(6), 1992）
 */
import type { WBand } from './remez';

/** ∫_{a}^{b} cos(mω) dω */
const icos = (m: number, a: number, b: number): number => (m === 0 ? b - a : (Math.sin(m * b) - Math.sin(m * a)) / m);

/** 対称な正定値行列 A（n × n、行優先）の連立方程式 A x = y をコレスキー分解で解く */
export function cholSolve(A: Float64Array, y: Float64Array, n: number): Float64Array {
  const L = new Float64Array(n * n);
  /* 条件の悪いときに備え、対角に小さな値を足して正定値を保つ */
  let tr = 0;
  for (let i = 0; i < n; i++) tr += A[i * n + i];
  const eps = (tr / n) * 1e-13;
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let s = A[i * n + j];
      for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
      if (i === j) L[i * n + i] = Math.sqrt(Math.max(s + eps, eps));
      else L[i * n + j] = s / L[j * n + j];
    }
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = y[i];
    for (let k = 0; k < i; k++) s -= L[i * n + k] * z[k];
    z[i] = s / L[i * n + i];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = z[i];
    for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k];
    x[i] = s / L[i * n + i];
  }
  return x;
}

/** 長さ N の対称な FIR フィルタを、重み付き最小二乗で求める */
export function leastSquares(N: number, bands: readonly WBand[]): Float64Array {
  const odd = N % 2 === 1,
    r = odd ? (N + 1) / 2 : N / 2,
    /* 基底 cos(c_k ω): タイプ I は c_k = k、タイプ II は k + 1/2 */
    c = (k: number) => (odd ? k : k + 0.5);
  const Q = new Float64Array(r * r),
    y = new Float64Array(r);
  for (const b of bands) {
    const lo = 2 * Math.PI * b.lo,
      hi = 2 * Math.PI * b.hi;
    if (hi <= lo) continue;
    for (let k = 0; k < r; k++) {
      y[k] += b.w * b.d * icos(c(k), lo, hi);
      for (let l = 0; l <= k; l++) {
        const v = (b.w * (icos(c(k) - c(l), lo, hi) + icos(c(k) + c(l), lo, hi))) / 2;
        Q[k * r + l] += v;
        if (l !== k) Q[l * r + k] += v;
      }
    }
  }
  const a = cholSolve(Q, y, r),
    h = new Float64Array(N);
  if (odd) {
    const M = r - 1;
    h[M] = a[0];
    for (let k = 1; k < r; k++) h[M - k] = h[M + k] = a[k] / 2;
  } else for (let k = 0; k < r; k++) h[r - 1 - k] = h[r + k] = a[k] / 2;
  return h;
}
