/**
 * 道路を走る映像の決まり: 道の寸法・カメラ・道の曲がり・木の並び・速さの変わり方・エンジンの回転数。
 * DOM に依存しない（描画とテストで使う）
 */
import { JA65 } from '../engine/spec';

/** 道路のテクスチャ 1 枚が覆う横幅と長さ [m]。横は端で止め、縦はくり返す */
export const ROAD_W = 16;
export const ROAD_L = 20;
/** 走る位置: 左車線の中心 [m]（道の中心から左が負）。カメラはバイクに乗っている人の目 */
export const LANE_X = -1.75;
/** 目の高さ [m] と、縦の画角の半分の tan */
export const CAM = { y: 1.2, th: Math.tan((22 * Math.PI) / 180) } as const;

/** 最高の速さ [m/s]（約 200 km/h） */
export const V_MAX = 56;
/** 速さを 1 フレーム進める。アクセルは速いほど弱く、ブレーキは強く効く。どちらも離すとその速さを保つ */
export function speedStep(v: number, acc: boolean, brk: boolean, dt: number): number {
  const a = brk ? -10 : acc ? 6 * (1 - v / V_MAX) : 0;
  return Math.max(0, Math.min(V_MAX, v + a * dt));
}

/** 進んだ距離 z [m] での道の曲率 [1/m]（左がプラス）。ゆるく曲がり続ける */
export const curv = (z: number): number => 0.0035 * Math.sin(z / 260) + 0.002 * Math.sin(z / 97 + 1);

/** 前方 d [m] の道の中心の横のずれ [m]。いまの曲率のまま曲がると見なす */
export const bend = (c: number, d: number): number => 0.5 * c * d * d;

/** 木: 進む向きの位置 z [m]・道の中心からの横の位置 x [m]・高さ h [m]・形 k（0 とがった木、1 丸い木） */
export interface Tree {
  z: number;
  x: number;
  h: number;
  k: 0 | 1;
}
/** 木の並びがくり返す長さ [m] と、描く遠さの範囲 [m] */
export const TREE_PERIOD = 300;
export const TREE_NEAR = 5;
export const TREE_FAR = 260;
/** 道の両側に並べる木（決まった乱数で作る） */
export const TREES: readonly Tree[] = (() => {
  let s = 21;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s % 1000) / 1000;
  };
  const out: Tree[] = [];
  for (let k = 0; k < TREE_PERIOD / 10; k++)
    for (const side of [-1, 1]) {
      if (rnd() >= 0.75) continue;
      out.push({ z: k * 10 + rnd() * 6, x: side * (6 + rnd() * 9), h: 5 + rnd() * 4, k: rnd() < 0.6 ? 0 : 1 });
    }
  return out;
})();

/** 前方 d [m] が TREE_NEAR〜TREE_FAR に入る木を、遠い順に返す。x は曲がりを足した、カメラから見た横の位置 */
export function treesAhead(z: number, c: number): { d: number; x: number; h: number; k: 0 | 1 }[] {
  const out: { d: number; x: number; h: number; k: 0 | 1 }[] = [];
  for (const t of TREES) {
    const d = (((t.z - z) % TREE_PERIOD) + TREE_PERIOD) % TREE_PERIOD;
    if (d < TREE_NEAR || d > TREE_FAR) continue;
    out.push({ d, x: t.x - LANE_X + bend(c, d), h: t.h, k: t.k });
  }
  return out.sort((a, b) => b.d - a.d);
}

/* ---------- 音: エンジンのページのバイク（CT125・JA65）の回転数 ---------- */
/** 映像の速さをバイクの速さに直す割合。バイクの最高（約 85 km/h）で映像の最高（約 200 km/h）になる */
export const BIKE_RATIO = 200 / 85;
/** タイヤの半径 [m]・上のギアへ移る回転数 [rpm]（ドップラー効果のページと同じ） */
const R_WHEEL = 0.284;
const UPSHIFT = 5500;
/** 映像の速さ v [m/s] のときのギアと回転数 [rpm] */
export function engineAt(v: number): { gear: number; rpm: number } {
  const d = JA65.drive,
    w = v / BIKE_RATIO / R_WHEEL;
  let gear = 1,
    rpm = 0;
  for (; gear <= d.gears.length; gear++) {
    rpm = ((w * d.primary * d.gears[gear - 1] * d.final) / (2 * Math.PI)) * 60;
    if (rpm <= UPSHIFT || gear === d.gears.length) break;
  }
  return { gear, rpm: Math.min(JA65.cut - 200, Math.max(JA65.idle, rpm)) };
}
