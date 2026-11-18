/** プリズムとレンズのページの場面。押すと部品を並べ直し、そこから自由に動かせる */
import { make, type Part } from './optics';

export type SceneKey = 'rainbow' | 'drop' | 'back' | 'lens' | 'cmirror' | 'tir';
export interface Scene {
  name: string;
  /** 図の下の 1 句 */
  cap: string;
  /** 明るさの既定 [EV] */
  ev: number;
  make: () => Part[];
}

export const SCENES: Record<SceneKey, Scene> = {
  rainbow: {
    name: 'プリズムで虹',
    cap: '色ごとに違う曲がり方',
    ev: 0,
    make: () => [make('beam', -334, 139, -33, { w: 24 }), make('prism', -40, 0, 0), make('screen', 254, 139, 33)],
  },
  drop: {
    name: '水滴の虹',
    cap: '水滴の中で 1 回反射して戻る光',
    ev: 1.2,
    make: () => [
      make('beam', -330, -106, 0, { w: 30 }),
      make('drop', 120, 0, 0, { r: 125 }),
      make('screen', 12, 246, 140, { L: 170 }),
    ],
  },
  back: {
    name: 'プリズム 2 つで白に戻す',
    cap: '逆向きのプリズムで白に戻る光',
    ev: 0,
    make: () => [
      make('beam', -357, 70, -30, { w: 44 }),
      make('prism', -150, 0, 0, { size: 170 }),
      make('prism', -55, -55, 180, { size: 170 }),
    ],
  },
  lens: {
    name: '凸レンズの焦点',
    cap: '1 点に集まる光と色によるずれ',
    ev: 0,
    make: () => [make('beam', -330, 0, 0, { w: 150 }), make('convex', -140, 0, 0, { R: 200, D: 180 })],
  },
  cmirror: {
    name: '凹面鏡',
    cap: '色によるずれのない焦点',
    ev: 0,
    make: () => [make('beam', -330, 0, 0, { w: 200 }), make('cmirror', 260, 0, 0, { R: 380, D: 260 })],
  },
  tir: {
    name: '全反射',
    cap: 'ガラスの中に閉じ込められる光',
    ev: 0,
    make: () => [make('laser', -330, -20, 24, { lam: 635 }), make('plate', 0, 0, 0, { mat: 'acr', w: 560, h: 40 })],
  },
};
export const SCENE_KEYS = Object.keys(SCENES) as SceneKey[];
