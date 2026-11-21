/**
 * 映像のテクスチャ: 道路（256 × 256）と 2 種の木（64 × 64、透明の地）。画素を式で決め、ミップマップの組にする。
 * DOM に依存しない
 */
import { ROAD_L, ROAD_W } from './drive';
import { mipChain, TS } from './filter';

type RGBA = readonly [number, number, number, number];

function make(size: number, alpha: boolean, fn: (x: number, y: number) => RGBA): Uint8ClampedArray[] {
  const L0 = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) L0.set(fn(x, y), (y * size + x) * 4);
  return mipChain(L0, size, alpha);
}

/** 決まった乱数（0〜1） */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s % 1000) / 1000;
  };
}

const WHITE: RGBA = [235, 235, 228, 255];
/** 木の絵の透明な所。色は葉に近くし、補間で縁が黒ずまないようにする */
const CLEAR: RGBA = [40, 110, 45, 0];

/**
 * 道路: 行は進む向き（行 0 が手前）。中央の破線（8 m 引いて 12 m 空ける）・車線の外側の線・縁石（2.5 m ごとに赤と白）・
 * 草（10 m ごとに明るい帯と暗い帯）。アスファルトと草には粒を散らす
 */
export function roadLevels(): Uint8ClampedArray[] {
  const r = rng(9);
  return make(TS, false, (px, py) => {
    const x = ((px + 0.5) / TS) * ROAD_W - ROAD_W / 2,
      y = ((py + 0.5) / TS) * ROAD_L,
      ax = Math.abs(x),
      n = Math.floor(r() * 12);
    if (ax < 0.08 && y < 8) return WHITE;
    if (ax > 3.35 && ax < 3.5) return WHITE;
    if (ax < 3.7) return [70 + n, 72 + n, 76 + n, 255];
    if (ax < 4.3) return Math.floor(y / 2.5) % 2 ? [236, 236, 230, 255] : [200, 40, 36, 255];
    return y < 10 ? [92 + n, 150 + n, 64, 255] : [76 + n, 128 + n, 52, 255];
  });
}

/** 木の絵の一辺 [画素] */
export const TREE_PX = 64;

/** 木: 0 は 3 段に重なるとがった木、1 は丸い木。行 0 が上 */
export function treeLevels(k: 0 | 1): Uint8ClampedArray[] {
  const cx = 31.5;
  return make(TREE_PX, true, (x, y) => {
    const shade = x < cx ? 0 : 18,
      n = ((x * 7 + y * 13) % 5) * 4;
    if (k === 0) {
      if (y >= 50 && Math.abs(x - cx) < 3.5) return [96, 62, 36, 255];
      const top = 4,
        h = 46,
        q = y - top,
        layer = Math.floor((q / h) * 3),
        w = 6 + (y - top - (layer * h) / 3) * 0.9 + layer * 5;
      if (q >= 0 && y < top + h && Math.abs(x - cx) < w) return [30 + n, 120 - shade + n, 52 - shade / 2, 255];
      return CLEAR;
    }
    if (y >= 44 && Math.abs(x - cx) < 4) return [104, 70, 40, 255];
    const r = Math.hypot(x - cx, y - 26);
    if (r < 22) return [48 + n, 140 - shade + n, 48 - shade / 2, 255];
    return CLEAR;
  });
}
