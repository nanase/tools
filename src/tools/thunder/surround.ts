/**
 * 聞き手の周りの響き（DOM に依存しない）: 家・木・建物で散った音が遅れて重なる。
 * 散らばった反射体の間を音が行き来する拡散音場とみなし、部屋の残響と同じフィードバック遅延網（lib/reverb）で作る。
 * 残響時間・反射体の間隔・響きの大きさは仮の値
 */
import type { ReverbSpec } from '../../lib/reverb';

const C_AIR = 343;

/** 周りの例: 残響時間 [s]（500 Hz・4 kHz）、反射体の間隔 [m]、直接の音に対する響きの音圧の比 */
interface Surround {
  t60: number;
  t60Hi: number;
  gap: number;
  wet: number;
}
const TABLE: Record<string, Surround> = {
  wood: { t60: 1.2, t60Hi: 0.5, gap: 12, wet: 0.6 },
  town: { t60: 1.8, t60Hi: 0.9, gap: 20, wet: 0.9 },
  city: { t60: 2.6, t60Hi: 1.3, gap: 30, wet: 1.2 },
};

export const SURROUNDS = [
  ['0', 'なし', '開けた野原（響きを足さない）'],
  ['wood', '木々', '林の中'],
  ['town', '家と木', '住宅地'],
  ['city', '建物', 'ビルの谷間'],
] as const;

/** 響きの設定。全体のエネルギーは響きを足す前とそろえる */
export function surroundSpec(v: string): ReverbSpec {
  const s = TABLE[v];
  if (!s) return { off: true, t60: 1, t60Hi: 1, wet: 0, norm: 1, pre: 0, mfpT: 0.01 };
  return {
    off: false,
    t60: s.t60,
    t60Hi: s.t60Hi,
    wet: s.wet,
    norm: 1 / Math.sqrt(1 + s.wet * s.wet),
    pre: s.gap / C_AIR,
    mfpT: s.gap / C_AIR,
  };
}
