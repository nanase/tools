/**
 * 木星の模型（DOM に依存しない）: 形・自転軸・自転角（System I・II・III）・明るさ・ガリレオ衛星
 *
 * 形と自転軸・System III は IAU WGCCRE 2015（Archinal et al. 2018、NAIF の pck00011.tpc）。
 * System I・II の自転角は Meeus『Astronomical Algorithms』43 章。明るさは Mallama & Hilton (2018)。
 * 衛星の半径は JPL SSD の Planetary Satellite Physical Parameters、衛星の明るさは JPL Horizons の値に合わせた
 */
import type { Vec3 } from '../../lib/astro/vec';
import type { PlanetModel } from '../../lib/planet/ephem';
import { galilean } from './galilean';
import { JUPITER } from './vsop';

const D = Math.PI / 180;

/** 赤道半径・極半径 [km] */
export const RE = 71492;
export const RP = 66854;

/** 自転軸の章動の角 Ja〜Je [°]（定数と 1 世紀あたり） */
// biome-ignore format: 表
const JA = [99.360714, 4850.4046, 175.895369, 1191.9605, 300.323162, 262.5475, 114.012305, 6070.2476, 49.511251, 64.3];
// biome-ignore format: 表
const RA = [0.000117, 0.000938, 0.001432, 0.00003, 0.00215];
// biome-ignore format: 表
const DEC = [0.00005, 0.000404, 0.000617, -0.000013, 0.000926];

export function pole(T: number): [number, number] {
  let a = 268.056595 - 0.006499 * T;
  let d = 64.495303 + 0.002413 * T;
  for (let k = 0; k < 5; k++) {
    const j = (JA[2 * k] + JA[2 * k + 1] * T) * D;
    a += RA[k] * Math.sin(j);
    d += DEC[k] * Math.cos(j);
  }
  return [a, d];
}

/** System III の本初子午線の角 [°]（d は J2000.0 からの TDB の日） */
export const w3 = (d: number): number => (284.95 + 870.536 * d) % 360;
/** System I・II の自転角 [°]（Meeus 43 章。d は J2000.0 からの日。日付の赤道との昇交点から） */
export const w1 = (d: number): number => (17.71 + 877.90003539 * (d + 18262.5)) % 360;
export const w2 = (d: number): number => (16.838 + 870.27003539 * (d + 18262.5)) % 360;

export interface MoonInfo {
  name: string;
  /** 半径 [km] */
  r: number;
  /** 距離 1 au・位相角 0 の明るさ V(1,0) [等]（JPL Horizons） */
  v10: number;
  /** 位相角による減光 [等] の係数（α [°] の 1 次と 2 次）。2026〜27 年の Horizons の APmag に当てはめ、差は 0.001 等以下 */
  ph: [number, number];
  /** 描画の色（線形の RGB、幾何アルベドに比例） */
  rgb: [number, number, number];
}

/** イオ・エウロパ・ガニメデ・カリスト */
export const MOONS: MoonInfo[] = [
  { name: 'イオ', r: 1821.49, v10: -1.68, ph: [0.046, -0.001], rgb: [0.72, 0.62, 0.38] },
  { name: 'エウロパ', r: 1560.8, v10: -1.41, ph: [0.0312, -0.00125], rgb: [0.7, 0.66, 0.58] },
  { name: 'ガニメデ', r: 2631.2, v10: -2.09, ph: [0.0323, -0.00066], rgb: [0.45, 0.42, 0.38] },
  { name: 'カリスト', r: 2410.3, v10: -1.05, ph: [0.078, -0.00274], rgb: [0.19, 0.17, 0.15] },
];

/** 木星の重力定数 [km³/日²]（JPL） */
export const GM_JUP = 126686531.9 * 86400 ** 2;

/**
 * 内側の 4 個: 木星の赤道の面の円軌道（名前、直径 [km]、半径 [km]、J2000.0 の角 [°]、平均運動 [°/日]）。
 * 2015〜2041 年の Horizons の位置に当てはめた（scripts/jupiter-moons.ts）。差はメティス 230 km〜テーベ 8900 km
 */
export const INNER: [string, number, number, number, number][] = [
  ['メティス', 60, 127978, 166.0016, 1221.2546892],
  ['アドラステア', 26, 128980, -145.5391, 1206.9988797],
  ['アマルテア', 262, 181372, 53.491, 722.6317289],
  ['テーベ', 110, 221941, -170.9037, 533.7002712],
];

/** 内側の衛星 k の木星中心の位置（ICRF）[km]。jdTT は TT の JD */
export function innerPos(k: number, jdTT: number): Vec3 {
  const [, , a, l0, n] = INNER[k];
  const [ra, dec] = pole((jdTT - 2451545) / 36525);
  const sa = Math.sin(ra * D),
    ca = Math.cos(ra * D),
    sd = Math.sin(dec * D),
    cd = Math.cos(dec * D);
  const th = ((l0 + n * (jdTT - 2451545)) % 360) * D;
  const c = a * Math.cos(th),
    s = a * Math.sin(th);
  /* 木星の赤道と ICRF の赤道の交点の向き q と、赤道の面で 90° 東の向き z × q */
  return [-sa * c - sd * ca * s, ca * c - sd * sa * s, cd * s];
}

export const JUPITER_MODEL: PlanetModel = {
  vsop: JUPITER,
  re: RE,
  rp: RP,
  pole,
  w: w3,
  moon: galilean,
  nMoons: 4,
  mag: (r, delta, a) => 5 * Math.log10(r * delta) - 9.395 - 3.7e-4 * a + 6.16e-4 * a * a,
};

/** 衛星 k の明るさ [等]。r・Δ は衛星の [au]、α は位相角 [°] */
export const moonMag = (k: number, r: number, delta: number, a: number): number =>
  MOONS[k].v10 + 5 * Math.log10(r * delta) + MOONS[k].ph[0] * a + MOONS[k].ph[1] * a * a;
