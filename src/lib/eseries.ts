/** E 系列と、値の並びの上での前後探索 */
export type Series = 6 | 12 | 24;

const E: Record<Series, number[]> = {
  6: [1.0, 1.5, 2.2, 3.3, 4.7, 6.8],
  12: [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2],
  24: [
    1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2,
    9.1,
  ],
};

export function eList(n: Series, min: number, max: number): number[] {
  const out: number[] = [];
  for (let d = Math.floor(Math.log10(min)) - 1; d <= Math.ceil(Math.log10(max)); d++)
    for (const b of E[n]) {
      const v = Number((b * 10 ** d).toPrecision(3));
      if (v >= min * (1 - 1e-9) && v <= max * (1 + 1e-9)) out.push(v);
    }
  return out;
}

/** min から max まで step 刻みの一様な並び */
export const linList = (min: number, max: number, step: number): number[] =>
  Array.from({ length: Math.round((max - min) / step) + 1 }, (_, i) => Number((min + i * step).toPrecision(12)));

export const same = (a: number, b: number): boolean => Math.abs(a - b) <= Math.abs(b) * 1e-9;

export function nearIdx(L: number[], v: number, log: boolean): number {
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
export const nextOf = (L: number[], v: number): number | undefined => L.find((x) => x > v && !same(x, v));
export function prevOf(L: number[], v: number): number | undefined {
  for (let i = L.length - 1; i >= 0; i--) if (L[i] < v && !same(L[i], v)) return L[i];
}
