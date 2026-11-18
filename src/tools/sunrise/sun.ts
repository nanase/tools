/**
 * 日の出と日の入りのページの太陽の位置（DOM に依存しない）。時刻は UTC の Unix ミリ秒で受ける。
 * 地心の赤緯とグリニッジ時角だけを持ち、地点の高度・方位は球面の式で求める（視差 8.8″ は無視する）
 */
import { eclToEqu, gast, nutation } from '../../lib/astro/frame';
import { altAz, refraction, site } from '../../lib/astro/observer';
import { sunEcl } from '../../lib/astro/sun';
import { deltaT } from '../../lib/astro/time';
import { sub, unit } from '../../lib/astro/vec';

const D = Math.PI / 180;

/** 段の境の高度 [°]: 日の出・日の入り（大気差 34′ と視半径 16′）、市民・航海・天文薄明の終わり */
export const THR = [-0.833, -6, -12, -18] as const;
export const BANDS = ['昼', '市民薄明', '航海薄明', '天文薄明', '夜'] as const;
export type Band = 0 | 1 | 2 | 3 | 4;

/** 大気差なしの中心の高度 h [°] の段 */
export function band(h: number): Band {
  if (h >= THR[0]) return 0;
  if (h >= THR[1]) return 1;
  if (h >= THR[2]) return 2;
  if (h >= THR[3]) return 3;
  return 4;
}

/** 太陽の赤緯とグリニッジ時角 [rad] */
export interface SunEq {
  dec: number;
  gha: number;
}

const jdOf = (ms: number): number => ms / 864e5 + 2440587.5;

/** VSOP87 による太陽（章動・光行差を含む見かけの位置） */
export function sunEq(ms: number): SunEq {
  const jd = jdOf(ms);
  const t = (jd + deltaT(jd) / 86400 - 2451545) / 36525;
  const n = nutation(t);
  const v = eclToEqu(sunEcl(t), n);
  const r = Math.hypot(v[0], v[1], v[2]);
  return { dec: Math.asin(v[2] / r), gha: gast(jd, n) - Math.atan2(v[1], v[0]) };
}

/** Meeus 25 章の低精度の式による太陽（誤差 0.01° 程度。1 年の図のように点が多いときに使う） */
export function sunEqLow(ms: number): SunEq {
  const jd = jdOf(ms);
  const T = (jd - 2451545) / 36525;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * D;
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * M) +
    0.000289 * Math.sin(3 * M);
  const om = (125.04 - 1934.136 * T) * D;
  const lam = (L0 + C - 0.00569 - 0.00478 * Math.sin(om)) * D;
  const eps = (23.439291 - 0.0130042 * T + 0.00256 * Math.cos(om)) * D;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const gmst = 280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * T * T;
  return { dec: Math.asin(Math.sin(eps) * Math.sin(lam)), gha: (gmst % 360) * D - ra };
}

/** 緯度 lat・経度 lon（東が正）[°] の地点の太陽の高度 h（大気差なし）と方位 az（北から東）[°] */
export function geoAltAz(s: SunEq, lat: number, lon: number): { h: number; az: number } {
  const p = lat * D;
  const H = s.gha + lon * D;
  const h = Math.asin(Math.sin(p) * Math.sin(s.dec) + Math.cos(p) * Math.cos(s.dec) * Math.cos(H)) / D;
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(p) - Math.tan(s.dec) * Math.cos(p)) / D + 180;
  return { h, az: ((az % 360) + 360) % 360 };
}

/** 太陽が真上にある地点（経度は −180〜180°） */
export function subsolar(s: SunEq): { lat: number; lon: number } {
  const lon = ((((-s.gha / D) % 360) + 540) % 360) - 180;
  return { lat: s.dec / D, lon };
}

/** 大気差を足した見かけの高度 [°] */
export const apparent = (h: number): number => h + refraction(h);

/** 地点から見た今の太陽（地心でなく地点からの向き）: 見かけの高度 h、大気差なしの高度 hGeo、方位 az [°] */
export function siteSun(ms: number, lat: number, lon: number): { h: number; hGeo: number; az: number } {
  const jd = jdOf(ms);
  const t = (jd + deltaT(jd) / 86400 - 2451545) / 36525;
  const n = nutation(t);
  const st = site(jd, n, { lat, lon, h: 0 });
  const a = altAz(unit(sub(eclToEqu(sunEcl(t), n), st.obs)), st.zenith);
  return { h: a.alt, hGeo: a.altGeo, az: a.az };
}
