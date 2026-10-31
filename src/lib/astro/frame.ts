/**
 * 天球の座標と時刻の基本（DOM に依存しない）: 章動・恒星時・歳差・黄道から赤道への変換・位置角
 *
 * 式は Meeus『Astronomical Algorithms』第 2 版。章動は 22 章の低精度の式（Δψ 0.5″）、
 * 恒星時は 12 章、歳差は 21 章（IAU 1976）。ベクトルは地心の、真の赤道と分点 of date の直交座標
 * （x が春分点、z が天の北極）で表す
 */
import { cross, dot, unit, type Vec3 } from './vec';

const D = Math.PI / 180;
const AS = D / 3600;

/** 角を 0〜2π に */
export const rev = (r: number): number => ((r % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
/** [rad] を 0〜360° に */
export const deg360 = (r: number): number => (((r / D) % 360) + 360) % 360;

/** 天の北極の向き */
export const POLE: Vec3 = [0, 0, 1];

export interface Ecl {
  /** 黄経・黄緯（平均黄道と平均分点 of date、章動を含まない）[rad] と、地心距離 [km] */
  lon: number;
  lat: number;
  dist: number;
}

export const AU = 149597870.7;

export interface Nut {
  /** 黄経の章動 Δψ・傾斜の章動 Δε・平均黄道傾斜 ε0 [rad] */
  dpsi: number;
  deps: number;
  eps0: number;
}

/** 章動（Meeus 22 章の低精度の式、Δψ 0.5″・Δε 0.1″）と平均黄道傾斜（式 22.2） */
export function nutation(t: number): Nut {
  const om = (125.04452 - 1934.136261 * t + 0.0020708 * t * t + (t * t * t) / 450000) * D;
  const l = (280.4665 + 36000.7698 * t) * D;
  const lp = (218.3165 + 481267.8813 * t) * D;
  return {
    dpsi: (-17.2 * Math.sin(om) - 1.32 * Math.sin(2 * l) - 0.23 * Math.sin(2 * lp) + 0.21 * Math.sin(2 * om)) * AS,
    deps: (9.2 * Math.cos(om) + 0.57 * Math.cos(2 * l) + 0.1 * Math.cos(2 * lp) - 0.09 * Math.cos(2 * om)) * AS,
    eps0: (84381.448 - 46.815 * t - 0.00059 * t * t + 0.001813 * t * t * t) * AS,
  };
}

/** グリニッジ視恒星時 [rad]（式 12.4 に分点差 Δψ cos ε を足す）。jd は UT */
export function gast(jd: number, n: Nut): number {
  const t = (jd - 2451545) / 36525;
  const g = 280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * t * t - (t * t * t) / 38710000;
  return rev(g * D + n.dpsi * Math.cos(n.eps0 + n.deps));
}

/** 黄経・黄緯・距離を、真の赤道と分点 of date の直交座標へ（黄経に Δψ を足し、真の黄道傾斜で回す） */
export function eclToEqu(p: Ecl, n: Nut): Vec3 {
  const eps = n.eps0 + n.deps;
  const l = p.lon + n.dpsi;
  const x = p.dist * Math.cos(p.lat) * Math.cos(l);
  const y = p.dist * Math.cos(p.lat) * Math.sin(l);
  const z = p.dist * Math.sin(p.lat);
  return [x, Math.cos(eps) * y - Math.sin(eps) * z, Math.sin(eps) * y + Math.cos(eps) * z];
}

/** J2000.0 の平均赤道から、真の赤道と分点 of date への回転行列（歳差 21.3 式 × 章動）。行ごとに並べる */
export function precNut(t: number, n: Nut): number[] {
  const z0 = (2306.2181 * t + 0.30188 * t * t + 0.017998 * t * t * t) * AS;
  const z = (2306.2181 * t + 1.09468 * t * t + 0.018203 * t * t * t) * AS;
  const th = (2004.3109 * t - 0.42665 * t * t - 0.041833 * t * t * t) * AS;
  const [cz0, sz0, cz, sz, ct, st] = [Math.cos(z0), Math.sin(z0), Math.cos(z), Math.sin(z), Math.cos(th), Math.sin(th)];
  // P = R3(−z) R2(θ) R3(−ζ)
  const p = [
    cz * ct * cz0 - sz * sz0,
    -cz * ct * sz0 - sz * cz0,
    -cz * st,
    sz * ct * cz0 + cz * sz0,
    -sz * ct * sz0 + cz * cz0,
    -sz * st,
    st * cz0,
    -st * sz0,
    ct,
  ];
  // N = R1(−ε) R3(−Δψ) R1(ε0)
  const e0 = n.eps0;
  const e = e0 + n.deps;
  const [cp, sp, ce, se, c0, s0] = [
    Math.cos(n.dpsi),
    Math.sin(n.dpsi),
    Math.cos(e),
    Math.sin(e),
    Math.cos(e0),
    Math.sin(e0),
  ];
  const nm = [
    cp,
    -sp * c0,
    -sp * s0,
    sp * ce,
    cp * ce * c0 + se * s0,
    cp * ce * s0 - se * c0,
    sp * se,
    cp * se * c0 - ce * s0,
    cp * se * s0 + ce * c0,
  ];
  const r: number[] = [];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) r.push(nm[i * 3] * p[j] + nm[i * 3 + 1] * p[3 + j] + nm[i * 3 + 2] * p[6 + j]);
  return r;
}

/** 視線 u（単位ベクトル）の向きに見た天球で、ベクトル v の位置角（天の北から東へ）[°] */
export function posAngle(u: Vec3, v: Vec3): number {
  const k = dot(POLE, u);
  const n = unit([-k * u[0], -k * u[1], 1 - k * u[2]]);
  const e = cross(n, u);
  return deg360(Math.atan2(dot(v, e), dot(v, n)));
}
