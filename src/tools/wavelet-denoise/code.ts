/**
 * 係数を残す・量子化する・おおよそのビット数を数える（DOM に依存しない）。どの基底の係数にも同じ規則を使う
 */

/** 絶対値の大きい方から K 番目の値（K = 0 なら ∞）。同じ値が並ぶと K 個より多く残ることがある */
export function kth(c: ArrayLike<number>, K: number): number {
  const n = c.length;
  if (K <= 0) return Number.POSITIVE_INFINITY;
  if (K >= n) return 0;
  const m = Float64Array.from(c, Math.abs).sort();
  return m[n - K];
}

/** |c| ≥ th を残し、ほかを 0 にする。返すのは残した数 */
export function keepAbove(c: Float64Array, th: number): number {
  let k = 0;
  for (let i = 0; i < c.length; i++) {
    if (Math.abs(c[i]) >= th && c[i] !== 0) k++;
    else c[i] = 0;
  }
  return k;
}

/**
 * 不感帯つきの一様な量子化（JPEG 2000 と同じ形）: q = sgn(c) ⌊|c|/Δ⌋。|c| < Δ は 0 になるので、
 * Δ を残す境と同じにすると「大きい順に残す」と同じ係数が残る。戻すときは区間の中点 sgn(q)(|q| + r)Δ
 */
export function quantize(c: ArrayLike<number>, step: number): Int32Array {
  return Int32Array.from(c, (v) => Math.sign(v) * Math.floor(Math.abs(v) / step));
}
export function dequantize(q: ArrayLike<number>, step: number, r = 0.5): Float64Array {
  return Float64Array.from(q, (v) => (v === 0 ? 0 : Math.sign(v) * (Math.abs(v) + r) * step));
}

export interface Bits {
  /** 0 でない番号の数 */
  nz: number;
  /** どこに残したか: n H2(nz/n)（0 か否かの 2 値の情報量） */
  pos: number;
  /** 残した値: 0 でない番号（符号を含む）の 0 次のエントロピー × nz */
  val: number;
}
const h2 = (p: number) => (p <= 0 || p >= 1 ? 0 : -p * Math.log2(p) - (1 - p) * Math.log2(1 - p));

/**
 * 番号の列を 0 次のエントロピーで符号化したときのビット数の見積もり。pos + val は列全体の 0 次のエントロピー × n に等しい
 * （連鎖律）。前後の係数の関係（文脈）を使わないので、実際の符号化（EBCOT など）よりは多め
 */
export function bits(q: ArrayLike<number>): Bits {
  const n = q.length,
    hist = new Map<number, number>();
  let nz = 0;
  for (let i = 0; i < n; i++) {
    const v = q[i];
    if (v === 0) continue;
    nz++;
    hist.set(v, (hist.get(v) ?? 0) + 1);
  }
  let val = 0;
  for (const m of hist.values()) val -= m * Math.log2(m / nz);
  return { nz, pos: n * h2(nz / n), val };
}
