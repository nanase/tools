/**
 * 太陽系のページの計算（DOM に依存しない）: 7 惑星の模型・地球から見た大きさと欠け・夜空での見え方・最接近
 *
 * 位置は VSOP87D（水星・金星・火星・天王星・海王星は vsop.ts、木星・土星は各ページの表）。
 * 地球から見た向き・光行時間・自転軸は lib/planet/ephem.ts（木星・土星のページと同じ手順）。
 * 形と自転軸は IAU WGCCRE 2015（Archinal et al. 2018）
 */
import { AU } from '../../lib/astro/frame';
import { golden } from '../../lib/astro/solve';
import { deltaT } from '../../lib/astro/time';
import { len, sub, type Vec3 } from '../../lib/astro/vec';
import { earthRect, type PlanetModel, type PlanetState, planetRect, planetState } from '../../lib/planet/ephem';
import { JUPITER_MODEL } from '../jupiter/model';
import { SATURN_MODEL } from '../saturn/model';
import { MARS, MERCURY, NEPTUNE, URANUS, VENUS } from './vsop';

const D = Math.PI / 180;
const AS = D / 3600;

export type Id = 'me' | 've' | 'ma' | 'ju' | 'sa' | 'ur' | 'ne';
export const IDS: readonly Id[] = ['me', 've', 'ma', 'ju', 'sa', 'ur', 'ne'];
export const NAME: Record<Id | 'ea', string> = {
  me: '水星',
  ve: '金星',
  ea: '地球',
  ma: '火星',
  ju: '木星',
  sa: '土星',
  ur: '天王星',
  ne: '海王星',
};

/** 環のない惑星の模型（衛星は描かない） */
const plain = (
  vsop: PlanetModel['vsop'],
  re: number,
  rp: number,
  pole: PlanetModel['pole'],
  w: PlanetModel['w'],
): PlanetModel => ({ vsop, re, rp, pole, w, moon: () => [0, 0, 0], nMoons: 0, mag: () => Number.NaN });

/** 海王星の自転軸の揺れの角 N [°] */
const neN = (T: number) => (357.85 + 52.316 * T) * D;

export const MODELS: Record<Id, PlanetModel> = {
  me: plain(
    MERCURY,
    2440.53,
    2438.26,
    (T) => [281.0103 - 0.0328 * T, 61.4155 - 0.0049 * T],
    (d) => 329.5988 + 6.1385108 * d,
  ),
  ve: plain(
    VENUS,
    6051.8,
    6051.8,
    () => [272.76, 67.16],
    (d) => 160.2 - 1.4813688 * d,
  ),
  ma: plain(
    MARS,
    3396.19,
    3376.2,
    (T) => [317.269202 - 0.10927547 * T, 54.432516 - 0.05827105 * T],
    (d) => 176.049863 + 350.891982443297 * d,
  ),
  ju: { ...JUPITER_MODEL, nMoons: 0 },
  sa: { ...SATURN_MODEL, nMoons: 0 },
  ur: plain(
    URANUS,
    25559,
    24973,
    () => [257.311, -15.175],
    (d) => 203.81 - 501.1600928 * d,
  ),
  ne: plain(
    NEPTUNE,
    24764,
    24341,
    (T) => [299.36 + 0.7 * Math.sin(neN(T)), 43.46 - 0.51 * Math.cos(neN(T))],
    (d) => 249.978 + 541.1397757 * d - 0.48 * Math.sin(neN(d / 36525)),
  ),
};

/** 1900〜2100 年に地球から見た赤道の視直径の最大 [″]（土星は本体。test/solar.test.ts で確かめる） */
export const MAX_DIAM: Record<Id, number> = { me: 12.3, ve: 63.2, ma: 25.2, ju: 50, sa: 20.8, ur: 4.1, ne: 2.4 };
/** 土星の環の外縁（A 環）の半径 / 赤道半径 */
export const RING_OUT = 136770 / 60268;
/** 環を含めた見かけの幅の最大 [″]。姿を同じ倍率で並べるときの基準 */
export const MAX_WIDTH = Math.max(...IDS.map((id) => (id === 'sa' ? MAX_DIAM.sa * RING_OUT : MAX_DIAM[id])));

/** 公転周期（恒星周期）・会合周期 [日] */
export const PERIOD: Record<Id | 'ea', number> = {
  me: 87.969,
  ve: 224.701,
  ea: 365.256,
  ma: 686.98,
  ju: 4332.59,
  sa: 10759.22,
  ur: 30688.5,
  ne: 60182,
};
export const SYNODIC: Record<Id, number> = {
  me: 115.88,
  ve: 583.92,
  ma: 779.94,
  ju: 398.88,
  sa: 378.09,
  ur: 369.66,
  ne: 367.49,
};
/** 軌道長半径 [au] と離心率（上から見た図の範囲を決める） */
export const ORBIT: Record<Id, [number, number]> = {
  me: [0.387, 0.206],
  ve: [0.723, 0.007],
  ma: [1.524, 0.093],
  ju: [5.203, 0.048],
  sa: [9.537, 0.054],
  ur: [19.19, 0.047],
  ne: [30.07, 0.009],
};

/** UT の JD から、J2000.0 からの TT のユリウス世紀 */
export const centuries = (jd: number): number => (jd + deltaT(jd) / 86400 - 2451545) / 36525;

/** 日心位置（日付の黄道の直交座標）[au] */
export const helio = (id: Id | 'ea', jd: number): Vec3 =>
  id === 'ea' ? earthRect(centuries(jd)) : planetRect(MODELS[id].vsop, centuries(jd));

/** 地心距離 [au]（光行時間は入れない。年表と最接近の探索に使う） */
export function distance(id: Id, jd: number): number {
  const t = centuries(jd);
  return len(sub(planetRect(MODELS[id].vsop, t), earthRect(t)));
}

/** 距離 d [au] での赤道の視直径 [″] */
export const diamAt = (id: Id, d: number): number => (2 * Math.asin(MODELS[id].re / (d * AU))) / AS;

/** 夜空での見え方: 太陽に近くて見えない・夕方・一晩中・明け方 */
export type Sky = 'no' | 'ev' | 'al' | 'mo';

/** 太陽からの離角がこれより小さいと見えない・これより大きいと一晩中 [°]（このツールで決めた値） */
export const HIDE = 15;
export const ALL_NIGHT = 120;

export interface Look {
  id: Id;
  st: PlanetState;
  /** 地心距離 [au]・視直径 [″]・照らされた割合・太陽からの離角 [°] */
  delta: number;
  diam: number;
  illum: number;
  elong: number;
  sky: Sky;
}

/** 時刻 jd（UT）に地球の中心から見た惑星 */
export function look(id: Id, jd: number): Look {
  const st = planetState(MODELS[id], jd, null);
  const g = st.geo;
  const R = len(earthRect(g.t));
  const c = (R * R + g.delta * g.delta - g.r * g.r) / (2 * R * g.delta);
  const elong = Math.acos(Math.max(-1, Math.min(1, c))) / D;
  const east = g.elong < 180;
  const sky: Sky = elong < HIDE ? 'no' : elong > ALL_NIGHT ? 'al' : east ? 'ev' : 'mo';
  return { id, st, delta: st.delta, diam: st.diam, illum: st.illum, elong, sky };
}

/** jd（UT）より後で、地心距離が最も小さくなる時刻 */
export function nextClosest(id: Id, jd: number): number {
  const f = (x: number) => distance(id, x);
  const lim = Math.ceil(SYNODIC[id] * 1.6);
  let a = f(jd);
  let b = f(jd + 1);
  for (let k = 1; k < lim; k++) {
    const c = f(jd + k + 1);
    if (b < a && b <= c) return golden(f, jd + k - 1, jd + k + 1, 40);
    a = b;
    b = c;
  }
  return jd + lim;
}
