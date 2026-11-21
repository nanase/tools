/**
 * テクスチャのフィルタの計算: ミップマップの組、1 画素で読むテクスチャの画素の数。
 * 映像を描く式はシェーダ（shader.ts）にある
 */

/** 道路のテクスチャの一辺の画素数と、ミップマップの段の数（256・128・…・1） */
export const TS = 256;
export const NL = 9;

/** フィルタ: 0 最近傍・1 バイリニア・2 トライリニア・3 異方性 */
export type FilterKind = 0 | 1 | 2 | 3;
/** フィルタの設定（b: フィルタ、m: ミップマップ 0・1、a: 異方性の倍率） */
export interface Filter {
  b: FilterKind;
  m: 0 | 1;
  a: number;
}

/** トライリニアと異方性はミップマップがないと使えない */
export const usesMip = (f: Filter): boolean => f.b >= 2 || f.m === 1;

/**
 * 段を 1 つずつ半分に縮めた組。L0 は RGBA の size × size 画素（size は 2 の累乗）。各段は上の段の 2 × 2 画素の平均。
 * alpha なら色を不透明度で重み付けして平均する（透明な所の色が縁に混ざらないように。木の絵）。すべて透明なら色はそのまま平均する
 */
export function mipChain(L0: Uint8ClampedArray, size = TS, alpha = false): Uint8ClampedArray[] {
  if (L0.length !== size * size * 4 || size & (size - 1)) throw new Error('size');
  const levels = [L0];
  for (let s = size >> 1; s >= 1; s >>= 1) {
    const p = levels[levels.length - 1],
      ps = s * 2,
      q = new Uint8ClampedArray(s * s * 4);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const i = (y * 2 * ps + x * 2) * 4,
          js = [i, i + 4, i + ps * 4, i + ps * 4 + 4],
          o = (y * s + x) * 4;
        let a = 0;
        for (const j of js) a += p[j + 3];
        for (let c = 0; c < 3; c++) {
          let v = 0,
            w = 0;
          for (const j of js) {
            v += p[j + c];
            w += p[j + c] * p[j + 3];
          }
          q[o + c] = alpha && a ? w / a : v / 4;
        }
        q[o + 3] = a / 4;
      }
    levels.push(q);
  }
  return levels;
}

/** ミップマップの組が使うメモリ（元の絵を 1 とした倍率）。1 + 1/4 + 1/16 + … */
export function mipMemory(n = NL): number {
  let s = 0;
  for (let l = 0; l < n; l++) s += 4 ** -l;
  return s;
}

/** 1 画素で読む画素の数の上限（最近傍 1・バイリニア 4・トライリニア 8・異方性は 8 × 倍率） */
export const maxReads = (f: Filter): number => [1, 4, 8, 8 * f.a][f.b];

/** 段の色（段 0〜7。8 は 7 と同じ灰）。シェーダの lvc と同じ */
export const LEVEL_COLORS: readonly string[] = [
  '#eb3833',
  '#f58f1a',
  '#ebdb1f',
  '#4dcc4d',
  '#33c2db',
  '#456bf5',
  '#a85ce6',
  '#999999',
];
