/**
 * 波長の色。CIE 1931 の等色関数の近似（Wyman・Sloan・Shirley 2013）から線形 sRGB にし、負の成分は 0 にする。
 * 白色光は 400〜700 nm を一様に選び、平均が白（各成分 1）になるよう重みを決める
 */

/** 区分ガウス関数 */
function g(x: number, m: number, a: number, b: number): number {
  const t = (x - m) / (x < m ? a : b);
  return Math.exp(-0.5 * t * t);
}
/** 波長 [nm] の線形 sRGB（負の成分は 0） */
export function spec(l: number): [number, number, number] {
  const X = 1.056 * g(l, 599.8, 37.9, 31) + 0.362 * g(l, 442, 16, 26.7) - 0.065 * g(l, 501.1, 20.4, 26.2),
    Y = 0.821 * g(l, 568.8, 46.9, 40.5) + 0.286 * g(l, 530.9, 16.3, 31.1),
    Z = 1.217 * g(l, 437, 11.8, 36) + 0.681 * g(l, 459, 26, 13.8);
  return [
    Math.max(0, 3.2406 * X - 1.5372 * Y - 0.4986 * Z),
    Math.max(0, -0.9689 * X + 1.8758 * Y + 0.0415 * Z),
    Math.max(0, 0.0557 * X - 0.204 * Y + 1.057 * Z),
  ];
}
/** 400〜700 nm で平均した色（白色光の重みの分母） */
export const MEAN: readonly number[] = (() => {
  const m = [0, 0, 0];
  for (let l = 400; l <= 700; l++) {
    const c = spec(l);
    for (let k = 0; k < 3; k++) m[k] += c[k] / 301;
  }
  return m;
})();
/** 単色の色（いちばん強い成分を 1） */
export function mono(l: number): [number, number, number] {
  const c = spec(l),
    m = Math.max(...c);
  return [c[0] / m, c[1] / m, c[2] / m];
}
/** 光線の色の重み。白色光は平均が各成分 1、単色は mono */
const WT = new Map<number, readonly number[]>();
export function weight(l: number, white: boolean): readonly number[] {
  if (!white) return mono(l);
  const k = Math.round(l * 4);
  let w = WT.get(k);
  if (!w) {
    const c = spec(k / 4);
    w = [c[0] / MEAN[0], c[1] / MEAN[1], c[2] / MEAN[2]];
    WT.set(k, w);
  }
  return w;
}
/** 線形の値を sRGB の 0〜1 に */
export function enc(v: number): number {
  const x = Math.min(1, Math.max(0, v));
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
}
/** 単色の CSS の色 */
export function cssOf(l: number): string {
  return `rgb(${mono(l)
    .map((v) => Math.round(enc(v) * 255))
    .join(',')})`;
}
/** トーンマップ 1 − exp(−v) と sRGB の符号化をまとめた表（v は 1/256 刻み、0〜8） */
export const LUT: Uint8ClampedArray = (() => {
  const t = new Uint8ClampedArray(2048);
  for (let i = 0; i < 2048; i++) t[i] = Math.round(enc(1 - Math.exp(-i / 256)) * 255);
  return t;
})();
