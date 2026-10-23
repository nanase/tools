/**
 * GF(2⁸) の演算。QR コードのリード・ソロモン符号は、既約多項式 x⁸ + x⁴ + x³ + x² + 1（0x11D）で作った体を使い、
 * 原始元 α = 2 の累乗を指数表と対数表で引く
 */
export const PRIM = 0x11d;

/** α^i（i = 0〜509。掛け算で指数の和を表から引くため 2 周ぶん持つ） */
export const EXP = new Uint8Array(510);
/** log_α x（x = 1〜255。LOG[0] は使わない） */
export const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= PRIM;
}
for (let i = 255; i < 510; i++) EXP[i] = EXP[i - 255];

export const mul = (a: number, b: number): number => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
export const div = (a: number, b: number): number => {
  if (!b) throw new RangeError('0 で割った');
  return a ? EXP[LOG[a] + 255 - LOG[b]] : 0;
};
/** α^i（i は負でもよい） */
export const pow = (i: number): number => EXP[((i % 255) + 255) % 255];

/** 多項式（係数を低次から並べる）の x での値 */
export function evalLow(p: readonly number[], x: number): number {
  let y = 0;
  for (let i = p.length - 1; i >= 0; i--) y = mul(y, x) ^ p[i];
  return y;
}

/** 多項式（係数を高次から並べる）の x での値。符号語の並びをそのまま多項式とみるときに使う */
export function evalHigh(p: readonly number[], x: number): number {
  let y = 0;
  for (const c of p) y = mul(y, x) ^ c;
  return y;
}
