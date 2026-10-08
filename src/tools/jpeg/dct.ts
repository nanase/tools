/**
 * 8×8 の 2 次元 DCT（T.81 A.3.3 の FDCT・IDCT）を、行と列に分けた行列の積で浮動小数点のまま計算する。
 * 係数は自然順（F[v * 8 + u]、u が横の周波数・v が縦の周波数）。画素も同じ並び（f[y * 8 + x]）
 */

/** C[u * 8 + x] = c(u)/2 · cos((2x + 1)uπ/16)、c(0) = 1/√2、ほかは 1。直交行列 */
export const COS: Float64Array = (() => {
  const m = new Float64Array(64);
  for (let u = 0; u < 8; u++)
    for (let x = 0; x < 8; x++)
      m[u * 8 + x] = ((u === 0 ? Math.SQRT1_2 : 1) / 2) * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
  return m;
})();

const tmp = new Float64Array(64);

/** 順変換 F = C f Cᵀ。f は水準をずらした（−128 した）画素 */
export function fdct(f: ArrayLike<number>, out: Float64Array = new Float64Array(64)): Float64Array {
  /* 行ごと: tmp[y][u] = Σx C[u][x] f[y][x] */
  for (let y = 0; y < 8; y++)
    for (let u = 0; u < 8; u++) {
      let s = 0;
      for (let x = 0; x < 8; x++) s += COS[u * 8 + x] * f[y * 8 + x];
      tmp[y * 8 + u] = s;
    }
  /* 列ごと: F[v][u] = Σy C[v][y] tmp[y][u] */
  for (let v = 0; v < 8; v++)
    for (let u = 0; u < 8; u++) {
      let s = 0;
      for (let y = 0; y < 8; y++) s += COS[v * 8 + y] * tmp[y * 8 + u];
      out[v * 8 + u] = s;
    }
  return out;
}

/** 逆変換 f = Cᵀ F C */
export function idct(F: ArrayLike<number>, out: Float64Array = new Float64Array(64)): Float64Array {
  for (let v = 0; v < 8; v++)
    for (let x = 0; x < 8; x++) {
      let s = 0;
      for (let u = 0; u < 8; u++) s += COS[u * 8 + x] * F[v * 8 + u];
      tmp[v * 8 + x] = s;
    }
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      let s = 0;
      for (let v = 0; v < 8; v++) s += COS[v * 8 + y] * tmp[v * 8 + x];
      out[y * 8 + x] = s;
    }
  return out;
}

/** 基底 (u, v) の 8×8 の値（係数 1 だけを逆変換したもの）。範囲は ±1/4 の内 */
export function basis(u: number, v: number): Float64Array {
  const b = new Float64Array(64);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) b[y * 8 + x] = COS[u * 8 + x] * COS[v * 8 + y];
  return b;
}

/** 0 から遠い側へ丸める（±0.5 は 0 から離れる向き）。T.81 の量子化の丸め */
export function roundHalfAway(x: number): number {
  const r = Math.floor(Math.abs(x) + 0.5);
  return x < 0 && r ? -r : r;
}

/** 量子化: Sq = round(F/Q) */
export function quantize(F: ArrayLike<number>, Q: ArrayLike<number>, out: Int16Array = new Int16Array(64)): Int16Array {
  for (let i = 0; i < 64; i++) out[i] = roundHalfAway(F[i] / Q[i]);
  return out;
}

const deq = new Float64Array(64);
/** 逆量子化と逆変換で、水準を戻した画素（0〜255 に丸めない実数） */
export function dequantIdct(
  S: ArrayLike<number>,
  Q: ArrayLike<number>,
  out: Float64Array = new Float64Array(64),
): Float64Array {
  const R = deq;
  for (let i = 0; i < 64; i++) R[i] = S[i] * Q[i];
  idct(R, out);
  for (let i = 0; i < 64; i++) out[i] += 128;
  return out;
}

/** 画素へ: 丸めて 0〜255 に収める */
export const toSample = (x: number): number => (x <= 0 ? 0 : x >= 255 ? 255 : Math.round(x));
