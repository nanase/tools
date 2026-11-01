/**
 * 土星の模型（DOM に依存しない）: 形・自転軸・自転角（System III）・明るさ・環の傾き・衛星
 *
 * 形と自転軸・System III は IAU WGCCRE 2015（Archinal et al. 2018、NAIF の pck00011.tpc）。
 * 明るさは Mallama & Hilton (2018)。衛星の半径は JPL SSD の Planetary Satellite Physical Parameters、
 * 衛星の明るさは JPL Horizons の値に合わせた
 */
import type { Vec3 } from '../../lib/astro/vec';
import type { PlanetModel, Slow } from '../../lib/planet/ephem';
import { moonPos } from './meeus46';
import { SATURN } from './vsop';

const D = Math.PI / 180;

/** 赤道半径・極半径 [km] */
export const RE = 60268;
export const RP = 54364;

export const pole = (T: number): [number, number] => [40.589 - 0.036 * T, 83.537 - 0.004 * T];

/** System III の本初子午線の角 [°]（d は J2000.0 からの TDB の日） */
export const w3 = (d: number): number => (38.9 + 810.7939024 * d) % 360;

/**
 * 環を含む土星の等級（Mallama & Hilton 2018。α < 6.5°・β < 27° の式）。
 * β は有効な傾きで、地球と太陽の傾きが同じ符号なら √(B B′)、違うなら 0
 */
export function saturnMag(r: number, delta: number, a: number, b: number, bs: number): number {
  const beta = b * bs > 0 ? Math.sqrt(b * bs) : 0;
  const sb = Math.sin(beta * D);
  return 5 * Math.log10(r * delta) - 8.914 - 1.825 * sb + 0.026 * a - 0.378 * sb * Math.exp(-2.25 * a);
}

export interface MoonInfo {
  name: string;
  /** 半径 [km] */
  r: number;
  /** 距離 1 au・位相角 0 の明るさ V(1,0) [等]（JPL Horizons。Horizons は土星の衛星に位相の項を持たない） */
  v10: number;
  /** 描画の色（線形の RGB、幾何アルベドに比例） */
  rgb: [number, number, number];
}

/** ミマス〜イアペトゥス */
export const MOONS: MoonInfo[] = [
  { name: 'ミマス', r: 198.2, v10: 3.3, rgb: [0.6, 0.6, 0.6] },
  { name: 'エンケラドゥス', r: 252.1, v10: 2.1, rgb: [1, 1, 1] },
  { name: 'テティス', r: 531.1, v10: 0.6, rgb: [0.8, 0.8, 0.8] },
  { name: 'ディオネ', r: 561.4, v10: 0.8, rgb: [0.6, 0.6, 0.6] },
  { name: 'レア', r: 763.5, v10: 0.1, rgb: [0.6, 0.6, 0.6] },
  { name: 'タイタン', r: 2574.7, v10: -1.28, rgb: [0.3, 0.22, 0.12] },
  { name: 'ヒペリオン', r: 135, v10: 4.63, rgb: [0.27, 0.24, 0.21] },
  { name: 'イアペトゥス', r: 734.3, v10: 1.5, rgb: [0.4, 0.38, 0.35] },
];

/** 土星の重力定数 [km³/日²]（JPL の SAT441） */
export const GM_SAT = 37931206.2 * 86400 ** 2;

/** 環の面（赤道面）から見た地球と太陽の傾き B・B′ [°]（土星中心緯度。南が負） */
export function ringTilt(s: Slow): { b: number; bs: number } {
  const n = Math.hypot(s.P[0], s.P[1], s.P[2]);
  return {
    b: Math.asin(-(s.P[0] * s.z[0] + s.P[1] * s.z[1] + s.P[2] * s.z[2]) / n) / D,
    bs: Math.asin(s.s[0] * s.z[0] + s.s[1] * s.z[1] + s.s[2] * s.z[2]) / D,
  };
}

export const SATURN_MODEL: PlanetModel = {
  vsop: SATURN,
  re: RE,
  rp: RP,
  pole,
  w: w3,
  moon: (k: number, jdTT: number): Vec3 => moonPos(k, jdTT),
  nMoons: 8,
  mag: (r, delta, a, latO = 0, latS = 0) => saturnMag(r, delta, a, latO, latS),
};

/** 衛星 k の明るさ [等]。r・Δ は衛星の [au] */
export const moonMag = (k: number, r: number, delta: number): number => MOONS[k].v10 + 5 * Math.log10(r * delta);

/**
 * 環のすぐ外の 15 個: 土星の赤道の面の円軌道（名前、直径 [km]、半径 [km]、J2000.0 の角 [°]、平均運動 [°/日]、
 * 正弦波の周期 [日] と係数 [°]。ヤヌスとエピメテウスは 3 倍の周期の係数も持つ）。
 * 2015〜2040 年の Horizons の位置に当てはめた（scripts/saturn-moons.ts）。差はパンの 6 km からアイガイオンの 5.4 万 km まで
 */
// biome-ignore format: 表
export const INNER: [string, number, number, number, number, number, ...number[]][] = [
  ['パン', 28.2, 133584, 146.5937, 626.0317354, 106.6, 0.0006, 0.0002],
  ['ダフニス', 7.6, 136506, 168.4673, 605.9764651, 4990.4, -1.8781, 0.2913],
  ['アトラス', 30.2, 137665, -13.1643, 598.3167265, 1765.7, -1.0713, -0.9138],
  ['プロメテウス', 86.2, 139375, 74.9647, 587.2880981, 4194.1, -0.7603, 0.6755],
  ['パンドラ', 81.4, 141715, 7.1319, 572.784521, 4070.3, 1.6394, -0.4746],
  ['エピメテウス', 116.2, 151460, -616.208, 518.2920285, 2915.8, 10.0316, -113.8774, -3.3664, 12.514],
  ['ヤヌス', 179, 151457, -75.7002, 518.2919889, 2915.8, -2.7591, 31.5921, 0.9406, -3.4823],
  ['アイガイオン', 0.66, 167491, 10.0029, 445.4956616, 4029.8, -5.0147, -0.6295],
  ['メトネ', 2.9, 194229, 109.6927, 356.5967035, 523, 2.8124, -3.7869],
  ['アンテ', 1.8, 197652, -151.2826, 347.3604602, 759.9, -7.5401, 0.5861],
  ['パレネ', 4.4, 212291, 141.1087, 312.0271402, 602.7, 0.1275, -0.4386],
  ['テレスト', 24.8, 294674, -109.0237, 190.6978188, 695.9, -0.9268, -0.9685],
  ['カリプソ', 21.4, 294673, 130.8379, 190.69782, 697.3, 1.5789, 3.2609],
  ['ヘレネ', 35.2, 377427, -120.5854, 131.5349292, 767.5, -9.773, -11.111],
  ['ポリデウケス', 2.6, 377497, 109.0598, 131.5349311, 790.8, -17.7451, 18.9081],
];

/** 環のすぐ外の衛星 k の土星中心の位置（ICRF）[km]。jdTT は TT の JD */
export function innerPos(k: number, jdTT: number): Vec3 {
  const [, , a, l0, n, per, c1, s1, c3 = 0, s3 = 0] = INNER[k];
  const [ra, dec] = pole((jdTT - 2451545) / 36525);
  const sa = Math.sin(ra * D),
    ca = Math.cos(ra * D),
    sd = Math.sin(dec * D),
    cd = Math.cos(dec * D);
  const t = jdTT - 2451545;
  const om = (2 * Math.PI * t) / per;
  const deg = l0 + n * t + c1 * Math.cos(om) + s1 * Math.sin(om) + c3 * Math.cos(3 * om) + s3 * Math.sin(3 * om);
  const th = (deg % 360) * D;
  const c = a * Math.cos(th),
    s = a * Math.sin(th);
  /* 土星の赤道と ICRF の赤道の交点の向き q と、赤道の面で 90° 東の向き z × q */
  return [-sa * c - sd * ca * s, ca * c - sd * sa * s, cd * s];
}
