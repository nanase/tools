/** E 系列と、値の並びの上での前後探索 */
export type Series = 1 | 3 | 6 | 12 | 24 | 48 | 96 | 192;
export const SERIES: readonly Series[] = [1, 3, 6, 12, 24, 48, 96, 192];

/** E192 の有効数字（100 倍した整数）。E48・E96 はこの間引き */
const E192 = [
  100, 101, 102, 104, 105, 106, 107, 109, 110, 111, 113, 114, 115, 117, 118, 120, 121, 123, 124, 126, 127, 129, 130,
  132, 133, 135, 137, 138, 140, 142, 143, 145, 147, 149, 150, 152, 154, 156, 158, 160, 162, 164, 165, 167, 169, 172,
  174, 176, 178, 180, 182, 184, 187, 189, 191, 193, 196, 198, 200, 203, 205, 208, 210, 213, 215, 218, 221, 223, 226,
  229, 232, 234, 237, 240, 243, 246, 249, 252, 255, 258, 261, 264, 267, 271, 274, 277, 280, 284, 287, 291, 294, 298,
  301, 305, 309, 312, 316, 320, 324, 328, 332, 336, 340, 344, 348, 352, 357, 361, 365, 370, 374, 379, 383, 388, 392,
  397, 402, 407, 412, 417, 422, 427, 432, 437, 442, 448, 453, 459, 464, 470, 475, 481, 487, 493, 499, 505, 511, 517,
  523, 530, 536, 542, 549, 556, 562, 569, 576, 583, 590, 597, 604, 612, 619, 626, 634, 642, 649, 657, 665, 673, 681,
  690, 698, 706, 715, 723, 732, 741, 750, 759, 768, 777, 787, 796, 806, 816, 825, 835, 845, 856, 866, 876, 887, 898,
  909, 920, 931, 942, 953, 965, 976, 988,
].map((x) => x / 100);

const E: Record<Series, number[]> = {
  1: [1.0],
  3: [1.0, 2.2, 4.7],
  6: [1.0, 1.5, 2.2, 3.3, 4.7, 6.8],
  12: [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2],
  24: [
    1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2,
    9.1,
  ],
  48: E192.filter((_, i) => i % 4 === 0),
  96: E192.filter((_, i) => i % 2 === 0),
  192: E192,
};

/** min 以上 max 以下の E 系列の値（小さい順） */
export function eList(n: Series, min: number, max: number): number[] {
  const out: number[] = [];
  for (let d = Math.floor(Math.log10(min)) - 1; d <= Math.ceil(Math.log10(max)); d++)
    for (const b of E[n]) {
      const v = Number((b * 10 ** d).toPrecision(3));
      if (v >= min * (1 - 1e-9) && v <= max * (1 + 1e-9)) out.push(v);
    }
  return out;
}

/** v が E 系列の値か */
export const inSeries = (n: Series, v: number): boolean => v > 0 && eList(n, v, v).length > 0;

/** min から max まで step 刻みの一様な並び */
export const linList = (min: number, max: number, step: number): number[] =>
  Array.from({ length: Math.round((max - min) / step) + 1 }, (_, i) => Number((min + i * step).toPrecision(12)));

/** 2 の累乗 2^a … 2^b */
export const pow2List = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => 2 ** (a + i));

export const same = (a: number, b: number): boolean => Math.abs(a - b) <= Math.abs(b) * 1e-9;

export function nearIdx(L: readonly number[], v: number, log: boolean): number {
  let bi = 0,
    bd = Infinity;
  L.forEach((x, i) => {
    const d = log ? Math.abs(Math.log(x / v)) : Math.abs(x - v);
    if (d < bd) {
      bd = d;
      bi = i;
    }
  });
  return bi;
}
export const nextOf = (L: readonly number[], v: number): number | undefined => L.find((x) => x > v && !same(x, v));
export function prevOf(L: readonly number[], v: number): number | undefined {
  for (let i = L.length - 1; i >= 0; i--) if (L[i] < v && !same(L[i], v)) return L[i];
}
