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

/**
 * Few のスペクトルのピーク f_m = 0.63 c √(p₀/E) [Hz]（Few の学位論文の式 4.7 E ≈ 5×10⁹/f_m² と同じ）。
 * R₀ で書くと 0.63 c/(√π R₀) ≈ 0.355 c/R₀
 */
export const FEW_K = 0.63;
export const fewPeak = (e: number, c: number, p = P0): number => FEW_K * c * Math.sqrt(p / e);

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

/** 緩和半径のあたりの N 波の正の側の長さは 0.53 R₀（Few 1986 の表 4.2） */
export const POS_LEN = 0.53;

/** 緩和半径のあたりで出る N 波の継続時間 [s]: 正の側の長さ 0.53 R₀ の 2 倍を音速で割る */
export const nDuration0 = (e: number, c: number, p = P0): number => (2 * POS_LEN * relaxRadius(e, p)) / c;

/**
 * N 波の伸び: 最初の 1 km でおよそ 2 倍になり、その先はほとんど伸びない（Few 1986）。
 * 間は弱い衝撃波の伸びの形 T ∝ √(1 + κ ln(r/r₁)) でつなぐ（このツールで決めた）
 */
export interface Stretch {
  /** 伸び始める距離 [m] */
  r1: number;
  /** 伸びが止まる距離 [m] */
  r2: number;
  /** r2 での伸びの倍率（1 なら伸びない） */
  k: number;
}
export const STRETCH0: Stretch = { r1: 20, r2: 1000, k: 2 };

/** 距離 r [m] で届く N 波の継続時間 [s] */
export function nDuration(T0: number, r: number, s: Stretch = STRETCH0): number {
  if (r <= s.r1 || s.k <= 1) return T0;
  const u = Math.min(1, Math.log(r / s.r1) / Math.log(s.r2 / s.r1));
  return T0 * Math.sqrt(1 + (s.k * s.k - 1) * u);
}

/**
 * まっすぐな長い放電路の要素の N 波を足し合わせた円筒波の形の積分 G = ∫g(s)² ds。
 * g(s) = ∫₀^∞ n(s − v) v^(−1/2) dv、n(s) = 1 − 2s（0 ≤ s ≤ 1）。遠くの円筒波は √(2cρ T)·a·g(t/T) になる
 */
export const LINE_G = (() => {
  const g = (s: number) => {
    if (s <= 0) return 0;
    if (s <= 1) return 2 * Math.sqrt(s) - (8 / 3) * s ** 1.5;
    return (1 - 2 * s) * 2 * (Math.sqrt(s) - Math.sqrt(s - 1)) + (4 / 3) * (s ** 1.5 - (s - 1) ** 1.5);
  };
  /* 尾は −s^(−3/2)/12 で減る。2 乗の 2000 から先は 10⁻⁹ ほどで無視できる。値は 1/4 になる */
  let G = 0;
  const h = 1e-4;
  for (let s = h / 2; s < 4; s += h) G += g(s) ** 2 * h;
  const h2 = 1e-2;
  for (let s = 4 + h2 / 2; s < 2000; s += h2) G += g(s) ** 2 * h2;
  return G;
})();

/**
 * 要素の N 波の振幅の係数 a [Pa·s]: 要素 dl [m] が距離 r [m] に N 波の山 a·dl/(r T) を出すとき、
 * まっすぐな長い放電路の音のエネルギーが単位長さあたり ηE になる値。
 * 円筒波のエネルギー 2πρ∫p²dt/(ρ₀c) = 4πG a²/ρ₀ を ηE と置く（このツールで導いた）
 */
export const lineAmp = (e: number, eta: number, rho: number): number =>
  Math.sqrt((eta * e * rho) / (4 * Math.PI * LINE_G));

/** 音になるエネルギーの割合（Few の学位論文の 0.42〜0.47 %。Holmes ほか 1971 は 0.18 %） */
export const ETA0 = 0.0045;

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

/** nIntegral の時間積分 P(τ²/2 − τ³/(3T))（0 ≤ τ ≤ T。先は P T²/6 のまま） */
const nIntegral2 = (tau: number, T: number, P: number): number => {
  if (tau <= 0) return 0;
  const u = Math.min(tau, T);
  return P * ((u * u) / 2 - (u * u * u) / (3 * T));
};

/**
 * 時刻を幅 W [標本] にならした N 波を足す: 中心が t0 [標本] の幅 W の箱と N 波のたたみ込み（面積は N 波と同じ）。
 * 放電路の 1 本の線から届く N 波を、要素ごとの点ではなく、要素が受け持つ長さに広げて足す。
 * 点のまま足すと、要素の間隔 Δt の列が 1/Δt の音（区間ごとに高さが変わり、さえずりのように聞こえる）を作る
 */
export function addNWaveBox(y: Float64Array, t0: number, T: number, P: number, W: number): void {
  if (W < 1e-3) {
    addNWave(y, t0, T, P);
    return;
  }
  const a = t0 - W / 2,
    n0 = Math.max(0, Math.floor(a)),
    n1 = Math.min(y.length - 1, Math.ceil(a + T + W)),
    J = (n: number) => nIntegral2(n - a, T, P) - nIntegral2(n - a - W, T, P);
  let prev = J(n0);
  for (let n = n0; n <= n1; n++) {
    const next = J(n + 1);
    y[n] += (next - prev) / W;
    prev = next;
  }
}

/**
 * 時刻の密度に足す: 中心が c [標本] の幅 W [標本] の箱（面積 P）を、標本の区間 [n, n+1) ごとの重なりで分ける。
 * W が 1 より狭いときは幅 1 にする（区間の中の位置は、隣との分け方で残る）
 */
export function addBox(x: Float64Array, c: number, P: number, W: number): void {
  const w = Math.max(W, 1),
    a = c - w / 2,
    b = c + w / 2,
    n0 = Math.max(0, Math.floor(a)),
    n1 = Math.min(x.length - 1, Math.ceil(b) - 1),
    k = P / w;
  for (let n = n0; n <= n1; n++) x[n] += k * (Math.min(b, n + 1) - Math.max(a, n));
}

/**
 * 時刻の密度 x（addBox で作る）と、継続時間 T [標本] の N 波のたたみ込みを y に足す（長さ len）。
 * 区間 [n, n+1) に一様に散った衝撃が、区間 [n+m, n+m+1) に足す平均は G(m+1) − 2G(m) + G(m−1)（G は nIntegral2）。
 * 1 ≤ m ≤ M−1 では 1 − 2m/T の 1 次式なので、窓の中の和 Σx と Σm·x を順にずらして 1 標本あたり定数の手間で求め、
 * 端の m = 0・M・M+1 だけ別に足す（M = ⌊T⌋）
 */
export function convolveNWave(x: Float64Array, y: Float64Array, len: number, T: number): void {
  const M = Math.floor(T),
    G = (s: number) => nIntegral2(s, T, 1),
    tap = (m: number) => G(m + 1) - 2 * G(m) + G(m - 1);
  if (M < 2) {
    /* 1 標本ほどの短い N 波はそのままたたみ込む */
    const k = Array.from({ length: M + 2 }, (_, m) => tap(m));
    for (let n = 0; n < len; n++) for (let m = 0; m < k.length && m <= n; m++) y[n] += k[m] * x[n - m];
    return;
  }
  const k0 = tap(0),
    kM = tap(M),
    kM1 = tap(M + 1),
    b = 2 / T;
  let s0 = 0,
    s1 = 0;
  for (let n = 0; n < len; n++) {
    const prev = n >= 1 ? x[n - 1] : 0,
      out = n >= M ? x[n - M] : 0;
    s1 += s0 - M * out + prev;
    s0 += prev - out;
    y[n] += k0 * x[n] + s0 - b * s1 + kM * out + (n > M ? kM1 * x[n - M - 1] : 0);
  }
}
