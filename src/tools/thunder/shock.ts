/**
 * 雷鳴のページの衝撃波（DOM に依存しない）: 放電路の緩和半径とスペクトルのピーク（Few 1969）、
 * 区間ごとの N 波の形・長さ・距離による伸び
 */

/** 標準の気圧 [Pa] */
export const P0 = 101325;
/** 乾いた空気の気体定数 [J/(kg K)] */
const RD = 287.05;

/** 空気の密度 [kg/m³] */
export const airDensity = (t: number, p = P0): number => p / (RD * (t + 273.15));

/** 円柱の衝撃波の緩和半径 R₀ = √(E/πp₀) [m]（E は単位長さあたりのエネルギー [J/m]） */
export const relaxRadius = (e: number, p = P0): number => Math.sqrt(e / (Math.PI * p));

/** Few のスペクトルのピーク f_m = 0.63 c/R₀ [Hz] */
export const FEW_K = 0.63;
export const fewPeak = (e: number, c: number, p = P0): number => (FEW_K * c) / relaxRadius(e, p);

/**
 * 継続時間 T の N 波の振幅スペクトル。|X(f)| = (P/πf)·|sin x/x − cos x|、x = πfT。
 * P は正の山の高さ。f → 0 で 0（N 波は面積が 0）
 */
export function nSpectrum(f: number, T: number, P = 1): number {
  const x = Math.PI * f * T;
  if (x < 1e-6) return (P * T * x) / 3;
  return (P / (Math.PI * f)) * Math.abs(Math.sin(x) / x - Math.cos(x));
}

/** N 波のスペクトルが最大になる x = πfT（(sin x/x − cos x)/x の最大。黄金分割で求める） */
export const N_PEAK_X = (() => {
  const g = (x: number) => (Math.sin(x) / x - Math.cos(x)) / x;
  let a = 0.5,
    b = 3.5;
  const k = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 80; i++) {
    const c = b - k * (b - a),
      d = a + k * (b - a);
    if (g(c) > g(d)) b = d;
    else a = c;
  }
  return 0.5 * (a + b);
})();

/** 継続時間 T の N 波のスペクトルのピークの周波数 [Hz] */
export const nPeak = (T: number): number => N_PEAK_X / (Math.PI * T);

/**
 * 緩和半径のあたりで出る N 波の継続時間 [s]。
 * N 波のスペクトルのピークが Few の f_m に一致する長さとする（このツールで決めた。仮）
 */
export const nDuration0 = (e: number, c: number, p = P0): number => N_PEAK_X / (Math.PI * fewPeak(e, c, p));

/** N 波の伸び（仮）: T(r) = T₀ √(1 + κ ln(r/r₁))（r > r₁）。弱い衝撃波の球面の伸びの形 */
export interface Stretch {
  /** 伸び始める距離 [m] */
  r1: number;
  /** 伸びの強さ（0 なら伸びない） */
  kappa: number;
}
export const STRETCH0: Stretch = { r1: 10, kappa: 1.3 };

/** 距離 r [m] で届く N 波の継続時間 [s] */
export const nDuration = (T0: number, r: number, s: Stretch = STRETCH0): number =>
  r <= s.r1 || s.kappa <= 0 ? T0 : T0 * Math.sqrt(1 + s.kappa * Math.log(r / s.r1));

/**
 * N 波の時間積分 F(τ) = P(τ − τ²/T)（0 ≤ τ ≤ T、外は 0）。
 * N 波 P(1 − 2τ/T) の原始関数で、両端で 0 になり連続。標本の区間で差を取ると、区間の平均（箱の低域通過）になる
 */
export const nIntegral = (tau: number, T: number, P: number): number =>
  tau <= 0 || tau >= T ? 0 : P * (tau - (tau * tau) / T);

/**
 * N 波を標本の列に足す。t0 は先頭の衝撃が届く時刻 [標本]、T は継続時間 [標本]、P は山の高さ。
 * 各標本には区間 [n, n+1) の平均を足す（折り返しを抑える）
 */
export function addNWave(y: Float64Array, t0: number, T: number, P: number): void {
  const n0 = Math.max(0, Math.floor(t0)),
    n1 = Math.min(y.length - 1, Math.ceil(t0 + T));
  let prev = nIntegral(n0 - t0, T, P);
  for (let n = n0; n <= n1; n++) {
    const next = nIntegral(n + 1 - t0, T, P);
    y[n] += next - prev;
    prev = next;
  }
}
