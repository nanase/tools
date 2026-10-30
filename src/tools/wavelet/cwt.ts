/**
 * 連続ウェーブレット変換（DOM に依存しない）。Morlet のウェーブレットで、周波数の側で掛けて戻す
 * （Torrence・Compo 1998 の式 (3)〜(6)）。尺度は 2 の分数乗で並べる（同 式 (9)・(10)）
 */
import { fft, plan } from '../spectrum/fft';

/** 無次元の周波数 ω0。6 で許容条件をほぼ満たす */
export const W0 = 6;
/** ψ0(0) = π^(−1/4) */
export const PSI0 = Math.PI ** -0.25;
/** Morlet（ω0 = 6）の再構成の係数 Cδ（Torrence・Compo の表 2） */
export const CDELTA = 0.776;

/** 尺度 s とフーリエ周期 λ の比: λ = 4πs / (ω0 + √(2 + ω0²))（表 1、ω0 = 6 で 1.033） */
export const fourierFactor = (w0 = W0): number => (4 * Math.PI) / (w0 + Math.sqrt(2 + w0 * w0));
/** 影響の円錐: 尺度 s の e 倍に減る時間は √2 s（表 1） */
export const COI = Math.SQRT2;

/** s_j = s0 2^(j δj)、j = 0…J */
export const scales = (s0: number, dj: number, J: number): Float64Array =>
  Float64Array.from({ length: J + 1 }, (_, j) => s0 * 2 ** (j * dj));
/** J = δj⁻¹ log2(N δt / s0)（切り捨て） */
export const jMax = (N: number, dt: number, s0: number, dj: number): number =>
  Math.floor(Math.log2((N * dt) / s0) / dj);

export interface Cwt {
  N: number;
  dt: number;
  w0: number;
  s: Float64Array;
  /** 尺度ごとの W_n(s) の実部と虚部（長さ N） */
  re: Float32Array[];
  im: Float32Array[];
}

/** 正規化した Morlet の周波数の側の値 ψ̂(sω) = √(2πs/δt) π^(−1/4) H(ω) e^(−(sω − ω0)²/2)（式 (6)） */
export const morletHat = (s: number, w: number, dt: number, w0 = W0): number =>
  w <= 0 ? 0 : Math.sqrt((2 * Math.PI * s) / dt) * PSI0 * Math.exp(-((s * w - w0) ** 2) / 2);

/** 0 で埋めた長さ（N 以上の 2 の累乗の 2 倍。端の折り返しを抑える） */
export const padLen = (N: number): number => 2 ** (Math.ceil(Math.log2(Math.max(2, N))) + 1);

/** 角周波数 ω_k（式 (5)） */
const omega = (k: number, M: number, dt: number) => ((k <= M / 2 ? k : k - M) * 2 * Math.PI) / (M * dt);

/** 平均を引いて 0 で埋め、FFT した x̂（作業用の配列の写し） */
function spectrum(x: ArrayLike<number>, M: number): [Float64Array, Float64Array] {
  const N = x.length,
    p = plan(M);
  let m = 0;
  for (let i = 0; i < N; i++) m += x[i];
  m /= N;
  p.re.fill(0);
  p.im.fill(0);
  for (let i = 0; i < N; i++) p.re[i] = x[i] - m;
  fft(p);
  return [Float64Array.from(p.re), Float64Array.from(p.im)];
}

/** 逆 FFT（共役をとって順変換し、共役をとって M で割る）。結果は p.re・p.im に入る */
function ifftInPlace(M: number): void {
  const p = plan(M);
  for (let k = 0; k < M; k++) p.im[k] = -p.im[k];
  fft(p);
  for (let k = 0; k < M; k++) {
    p.re[k] /= M;
    p.im[k] = -p.im[k] / M;
  }
}

/** W_n(s) = Σ_k x̂_k ψ̂*(sω_k) e^(iω_k nδt)（式 (4)） */
export function cwt(x: ArrayLike<number>, dt: number, s: Float64Array, w0 = W0): Cwt {
  const N = x.length,
    M = padLen(N),
    [xr, xi] = spectrum(x, M),
    p = plan(M),
    re: Float32Array[] = [],
    im: Float32Array[] = [];
  for (const sj of s) {
    for (let k = 0; k < M; k++) {
      /* ψ̂ は実数なので共役は同じ */
      const h = morletHat(sj, omega(k, M, dt), dt, w0);
      p.re[k] = xr[k] * h;
      p.im[k] = xi[k] * h;
    }
    ifftInPlace(M);
    re.push(Float32Array.from(p.re.subarray(0, N)));
    im.push(Float32Array.from(p.im.subarray(0, N)));
  }
  return { N, dt, w0, s, re, im };
}

/** ウェーブレットのパワー |W_n(s)|² の表（行が尺度） */
export const power = (c: Cwt): Float32Array[] => c.re.map((r, j) => r.map((v, n) => v * v + c.im[j][n] ** 2));

/** 再構成 x_n = δj δt^(1/2) / (Cδ ψ0(0)) Σ_j Re{W_n(s_j)} / s_j^(1/2)（式 (11)。平均は戻らない） */
export function icwt(c: Cwt, dj: number, cd = CDELTA): Float64Array {
  const x = new Float64Array(c.N),
    k = (dj * Math.sqrt(c.dt)) / (cd * PSI0);
  c.s.forEach((sj, j) => {
    const q = k / Math.sqrt(sj),
      r = c.re[j];
    for (let n = 0; n < c.N; n++) x[n] += q * r[n];
  });
  return x;
}

/**
 * Cδ を δ 関数の変換から求める（式 (12)・(13)）: W_δ(s) = N⁻¹ Σ_k ψ̂*(sω_k)、
 * Cδ = δj δt^(1/2) / ψ0(0) Σ_j Re{W_δ(s_j)} / s_j^(1/2)
 */
export function cdelta(N: number, dt: number, s: Float64Array, dj: number, w0 = W0): number {
  let sum = 0;
  for (const sj of s) {
    let w = 0;
    for (let k = 0; k < N; k++) w += morletHat(sj, omega(k, N, dt), dt, w0);
    sum += w / N / Math.sqrt(sj);
  }
  return ((dj * Math.sqrt(dt)) / PSI0) * sum;
}

/** 影響の円錐の境のフーリエ周期（時刻 n での、端から e 倍に減るまでの尺度を周期に直したもの） */
export function coiPeriod(N: number, dt: number, w0 = W0): Float64Array {
  const f = fourierFactor(w0) / COI;
  return Float64Array.from({ length: N }, (_, n) => f * dt * Math.min(n + 0.5, N - n - 0.5));
}
