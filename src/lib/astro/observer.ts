/**
 * 地上の観測地から見た天体の高度・方位と出没（DOM に依存しない）
 *
 * ベクトルは地心の、真の赤道と分点 of date の直交座標（frame.ts）で、単位は km
 */
import { A_M, observerXYZ } from './earth';
import { deg360, gast, type Nut, POLE, posAngle } from './frame';
import { bisect } from './solve';
import { cross, dot, unit, type Vec3 } from './vec';

const D = Math.PI / 180;
/** 地球の赤道半径（WGS84）[km] */
export const R_EARTH = A_M / 1000;
/** 地平線での大気差 [°]（Meeus 15 章。視半径と合わせて出没の高さにする） */
export const H_REFR = 0.5667;

export interface Obs {
  /** 測地緯度・経度（東が正）[°]、標高 [m] */
  lat: number;
  lon: number;
  h: number;
}

/** 時刻 jd（UT）の観測地の地心の位置 [km] と天頂（測地の法線）の向き。n はその時刻の章動 */
export function site(jd: number, n: Nut, o: Obs): { obs: Vec3; zenith: Vec3 } {
  const th = gast(jd, n) + o.lon * D;
  const p = observerXYZ(o.lat * D, 0, o.h);
  const cl = Math.cos(o.lat * D);
  return {
    obs: [R_EARTH * p[0] * Math.cos(th), R_EARTH * p[0] * Math.sin(th), R_EARTH * p[2]],
    zenith: [cl * Math.cos(th), cl * Math.sin(th), Math.sin(o.lat * D)],
  };
}

/** 大気差 [°]（Saemundsson、Meeus 16.4 式）。h は大気差を含まない高度 [°]。−1° より下は −1° の値 */
export function refraction(h: number): number {
  const x = Math.max(h, -1);
  return 1.02 / Math.tan((x + 10.3 / (x + 5.11)) * D) / 60;
}

/**
 * 観測地から向き u（単位ベクトル）に見える天体の高度（大気差あり・なし）・方位（北から東へ）と、
 * 天頂の位置角 q（天の北から東へ）[°]
 */
export function altAz(u: Vec3, zenith: Vec3): { alt: number; altGeo: number; az: number; q: number } {
  const altGeo = Math.asin(dot(u, zenith)) / D;
  const east = unit(cross(POLE, zenith));
  return {
    alt: altGeo + refraction(altGeo),
    altGeo,
    az: deg360(Math.atan2(dot(u, east), dot(u, cross(zenith, east)))),
    q: posAngle(u, zenith),
  };
}

/** 天体の向き u（単位ベクトル）の東西の成分。南中で + から − へ変わる */
export const eastward = (u: Vec3, zenith: Vec3): number => dot(u, cross(POLE, zenith));

/**
 * [jd0, jd0 + 1) の出・南中・入り（jd0 は地方時の 0 時の JD）。ない日は null・NaN。
 * f(jd) は [出没の判定の値（地平線の上で正）, 東西の成分（南中で + から − へ）] を返す
 */
export function riseTransitSet(
  jd0: number,
  f: (jd: number) => [number, number],
  n = 48,
): { rise: number | null; transit: number; set: number | null } {
  const s = Array.from({ length: n + 1 }, (_, i) => f(jd0 + i / n));
  let rise: number | null = null;
  let set: number | null = null;
  let transit = Number.NaN;
  for (let i = 0; i < n; i++) {
    const [a, b] = [s[i], s[i + 1]];
    const lo = jd0 + i / n;
    const hi = jd0 + (i + 1) / n;
    if (rise === null && a[0] < 0 && b[0] >= 0) rise = bisect((t) => f(t)[0], lo, hi, 20);
    if (set === null && a[0] >= 0 && b[0] < 0) set = bisect((t) => f(t)[0], lo, hi, 20);
    if (Number.isNaN(transit) && a[1] > 0 && b[1] <= 0) transit = bisect((t) => f(t)[1], lo, hi, 20);
  }
  return { rise, transit, set };
}
