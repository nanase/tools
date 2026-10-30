/**
 * 原理の図の計算（DOM に依存しない）: フーリエ変換で消える「いつ」・短い波を重ねて掛けて足す・8 つの数の平均と差
 */
import { type Cwt, coiPeriod, cwt, fourierFactor, PSI0, scales, W0 } from './cwt';

/** 標本の数（区間 1 s、標本化周波数 256 Hz） */
export const PN = 256;
export const PDT = 1 / PN;
/** スカログラムの尺度: 周波数 128 Hz から 2 Hz まで、1 オクターブ 12 行 */
export const PDJ = 1 / 12;
const FF = fourierFactor();
export const PS0 = 1 / (128 * FF);
export const PJ = Math.round(Math.log2(64) / PDJ);
export const PS = scales(PS0, PDJ, PJ);
export const PCOI = coiPeriod(PN, PDT);
/** 尺度の番号 j の中心の周波数 Hz */
export const freqOfJ = (j: number): number => 1 / (FF * PS[j]);
/** 周波数 Hz → 尺度の番号（小数） */
export const jOfFreq = (f: number): number => Math.log2(1 / (FF * PS0 * f)) / PDJ;
/** 尺度の番号 j の影響の円錐の外か（端の 0 埋めの影響が残る所） */
export const outCoi = (j: number, n: number): boolean => FF * PS[j] > PCOI[n];

/** 2 つの音: 前半 6 Hz・後半 32 Hz（それぞれハンの包絡）。swap で入れ替える（半周の回転なので |DFT| は変わらない） */
export function twoTones(swap = false, N = PN): Float64Array {
  const h = N / 2,
    x = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    const u = ((n % h) + 0.5) / h;
    x[n] = Math.sin(Math.PI * u) ** 2 * Math.sin((2 * Math.PI * (n < h ? 6 : 32) * n) / N);
  }
  return swap ? Float64Array.from({ length: N }, (_, n) => x[(n + h) % N]) : x;
}

/** 平均を引いた信号（連続変換は平均を引くので、直接の内積も同じ信号でとる） */
export function centered(x: ArrayLike<number>): Float64Array {
  let m = 0;
  for (let i = 0; i < x.length; i++) m += x[i];
  m /= x.length;
  return Float64Array.from(x, (v) => v - m);
}

/** |X[k]|、k = 0…K（直接の和） */
export function dftMag(x: ArrayLike<number>, K: number): Float64Array {
  const N = x.length,
    out = new Float64Array(K + 1);
  for (let k = 0; k <= K; k++) {
    let re = 0,
      im = 0;
    for (let n = 0; n < N; n++) {
      const p = (2 * Math.PI * k * n) / N;
      re += x[n] * Math.cos(p);
      im -= x[n] * Math.sin(p);
    }
    out[k] = Math.hypot(re, im);
  }
  return out;
}

/** スカログラム: 係数を √s で割ったもの R = W/√s（同じ振幅の正弦波が、どの尺度でも同じ明るさ）と、|R| の最大 */
export interface Scalo {
  re: Float32Array[];
  im: Float32Array[];
  mx: number;
}
export function scaloOf(x: ArrayLike<number>): Scalo {
  const c: Cwt = cwt(x, PDT, PS),
    re = c.re.map((r, j) => r.map((v) => v / Math.sqrt(PS[j]))),
    im = c.im.map((r, j) => r.map((v) => v / Math.sqrt(PS[j])));
  let mx = 1e-12;
  for (let j = 0; j <= PJ; j++) for (let n = 0; n < x.length; n++) mx = Math.max(mx, Math.hypot(re[j][n], im[j][n]));
  return { re, im, mx };
}

/**
 * 位置 u（標本の番号）・尺度 s に Morlet を重ねて掛けて足す（スカログラムと同じ W/√s）。
 * cos と sin の 2 つで掛けて足し、波の山の位置（位相 ph）を一番よく合う所へずらす。
 * ずらした波 psi で掛けた prod を足すと、ちょうど大きさ mag になる
 */
export interface Probe {
  re: number;
  im: number;
  mag: number;
  ph: number;
  psi: Float64Array;
  prod: Float64Array;
}
export function probe(x: ArrayLike<number>, u: number, s: number, dt = PDT): Probe {
  const N = x.length,
    g = new Float64Array(N);
  let c = 0,
    q = 0;
  for (let n = 0; n < N; n++) {
    const e = ((n - u) * dt) / s;
    g[n] = PSI0 * Math.exp((-e * e) / 2) * Math.sqrt(dt / s);
    c += x[n] * g[n] * Math.cos(W0 * e);
    q += x[n] * g[n] * Math.sin(W0 * e);
  }
  const ph = Math.atan2(q, c),
    psi = new Float64Array(N),
    prod = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    psi[n] = g[n] * Math.cos((W0 * (n - u) * dt) / s - ph);
    prod[n] = x[n] * psi[n];
  }
  /* W = Σ x ψ*（ψ* の虚部は −sin） */
  const k = 1 / Math.sqrt(s);
  return { re: c * k, im: -q * k, mag: Math.hypot(c, q) * k, ph, psi, prod };
}

/* ---------- 8 つの数の平均と差（Haar を √2 でなく 2 で割ったもの） ---------- */
/** 段 r の並び [平均 | その段の差 | 前の段までの差] と平均の数。段 0 は元の数 */
export interface HaarRow {
  v: number[];
  na: number;
}
export function haarRows(x: readonly number[]): HaarRow[] {
  const out: HaarRow[] = [{ v: [...x], na: x.length }];
  let a = [...x],
    tail: number[] = [];
  while (a.length > 1) {
    const av: number[] = [],
      df: number[] = [];
    for (let i = 0; i + 1 < a.length; i += 2) {
      av.push((a[i] + a[i + 1]) / 2);
      df.push((a[i] - a[i + 1]) / 2);
    }
    tail = [...df, ...tail];
    a = av;
    out.push({ v: [...av, ...tail], na: av.length });
  }
  return out;
}
/** 最後の段の並び [a | d_J | … | d_1] から戻す（a ± d） */
export function haarRebuild(c: readonly number[]): number[] {
  let a = [c[0]],
    pos = 1;
  while (pos < c.length) {
    const d = c.slice(pos, pos + a.length),
      nx: number[] = [];
    for (let i = 0; i < a.length; i++) nx.push(a[i] + d[i], a[i] - d[i]);
    pos += a.length;
    a = nx;
  }
  return a;
}
/** 差のうち |d| ≤ th を 0 にする（先頭の平均は残す） */
export const cutSmall = (c: readonly number[], th: number): number[] =>
  c.map((v, i) => (i > 0 && Math.abs(v) <= th ? 0 : v));
