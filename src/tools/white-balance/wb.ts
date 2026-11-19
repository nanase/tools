/**
 * 光とカメラの設定の選択肢、色温度の帯の目盛り、色の名前。DOM に依存しない
 */
import { cctSpec, daylight, FLUOR, LEDW, labOfLin, ONE, planck, rawOf, type Spec, type Vec3 } from './spectrum';

export type LightKey = 'candle' | 'bulb' | 'fl' | 'led' | 'sun' | 'cloud' | 'shadow';
/** 光の選択肢 [鍵, 名前, スペクトル] */
export const LIGHTS: readonly (readonly [LightKey, string, () => Spec])[] = [
  ['candle', 'ろうそく', () => planck(1900)],
  ['bulb', '電球', () => planck(2700)],
  ['fl', '蛍光灯', () => FLUOR],
  ['led', 'LED', () => LEDW],
  ['sun', '晴天', () => daylight(5500)],
  ['cloud', '曇天', () => daylight(6500)],
  ['shadow', '日陰', () => daylight(7500)],
];
const cache = new Map<string, Spec>();
export function lightSpec(k: LightKey): Spec {
  let s = cache.get(k);
  if (!s) {
    s = (LIGHTS.find((l) => l[0] === k)?.[2] ?? (() => planck(2700)))();
    cache.set(k, s);
  }
  return s;
}
export const lightName = (k: string): string => LIGHTS.find((l) => l[0] === k)?.[1] ?? '';

export type WbKey = 'auto' | 'sun' | 'shadow' | 'cloud' | 'bulb' | 'fl' | 'temp' | 'pick';
/** ホワイトバランスのボタン（カメラのメニューと同じ並び） */
export const WB_MENU: readonly (readonly [WbKey, string])[] = [
  ['auto', 'オート'],
  ['sun', '太陽光'],
  ['shadow', '日陰'],
  ['cloud', '曇天'],
  ['bulb', '電球'],
  ['fl', '蛍光灯'],
  ['temp', '色温度'],
  ['pick', 'スポイト'],
];
/** 決まった設定の色温度 [K] と色かぶり補正。電球と蛍光灯は、このページの同じ名前の光がほぼ白になる値 */
export const PRESET: Partial<Record<WbKey, readonly [number, number]>> = {
  sun: [5200, 0],
  shadow: [7000, 0],
  cloud: [6000, 0],
  bulb: [2700, 0],
  fl: [5000, 16],
};
export const wbName = (k: WbKey): string => WB_MENU.find((m) => m[0] === k)?.[1] ?? '';

export type AutoKey = 'gray' | 'bright';

/* ---------- 色温度の帯（ミレッドで等間隔） ---------- */

export const TMIN = 1800,
  TMAX = 12000;
/** 色温度 → 帯の位置 0〜1 */
export const posOf = (T: number): number => (1e6 / TMIN - 1e6 / T) / (1e6 / TMIN - 1e6 / TMAX);
/** 帯の位置 0〜1 → 色温度 */
export const tempAt = (p: number): number => 1e6 / (1e6 / TMIN - p * (1e6 / TMIN - 1e6 / TMAX));

/** 色温度の光の白の RAW（帯の上の 301 点を前もって作る） */
const TABLE: { T: number; br: number }[] = Array.from({ length: 301 }, (_, k) => {
  const T = tempAt(k / 300),
    w = rawOf(ONE, cctSpec(T));
  return { T, br: Math.log(w[2] / w[0]) };
});
/** 白の RAW の B/R の比が最も近い色温度（オート・スポイト・光の▼の位置に使う） */
export function nearestT(S: readonly number[]): number {
  const tr = Math.log((S[2] as number) / (S[0] as number));
  let best = 5000,
    bd = Number.POSITIVE_INFINITY;
  for (const e of TABLE) {
    const d = Math.abs(e.br - tr);
    if (d < bd) {
      bd = d;
      best = e.T;
    }
  }
  return best;
}

/** 色温度を 50 K に丸めて「5,200 K」の形に */
export const fmtK = (T: number): string => `${(Math.round(T / 50) * 50).toLocaleString('en')} K`;

/** 補正後の白い物の色（線形 sRGB）を名前に。明るさは見ない */
export function castName(lin: Vec3): string {
  const m = Math.max(lin[0], lin[1], lin[2], 1e-9),
    L = labOfLin([(lin[0] / m) * 0.9, (lin[1] / m) * 0.9, (lin[2] / m) * 0.9]),
    C = Math.hypot(L[1], L[2]);
  if (C < 4) return 'ほぼ白';
  let h = (Math.atan2(L[2], L[1]) * 180) / Math.PI;
  if (h < 0) h += 360;
  const nm =
    h < 25 || h >= 330
      ? '赤紫寄り'
      : h < 78
        ? '橙寄り'
        : h < 112
          ? '黄寄り'
          : h < 190
            ? '緑寄り'
            : h < 290
              ? '青寄り'
              : '紫寄り';
  return C > 18 ? `${nm}（強い）` : nm;
}
