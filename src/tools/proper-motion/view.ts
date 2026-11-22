/**
 * 星図の図法（DOM に依存しない）。ステレオ図法で、上が天の北（J2000）、左が東。
 * 見る向きは中心の赤経・赤緯 [°] と、横の視野 fov [°] で決める
 */
import { cross, unit, type Vec3 } from '../../lib/astro/vec';

const D = Math.PI / 180;
export const FOV_MIN = 4;
export const FOV_MAX = 200;
/** 全体のボタンで戻す視野 */
export const FOV_HOME = 160;

export interface Look {
  ra: number;
  dec: number;
  fov: number;
}
export interface Proj {
  /** 向き v を画面の点へ。中心から 100° ほどより後ろは null */
  P(v: Vec3): [number, number] | null;
  /** 画面の点を向きへ */
  U(x: number, y: number): Vec3;
  /** 中心での 1 ラジアンあたりの画素（ステレオ図法の半径は 2 tan(θ/2) × S） */
  S: number;
  /** 中心の向き */
  c: Vec3;
}

export const vecOf = (ra: number, dec: number): Vec3 => [
  Math.cos(dec * D) * Math.cos(ra * D),
  Math.cos(dec * D) * Math.sin(ra * D),
  Math.sin(dec * D),
];
export const raDecOf = (v: Vec3): [number, number] => [
  (((Math.atan2(v[1], v[0]) / D) % 360) + 360) % 360,
  Math.asin(Math.max(-1, Math.min(1, v[2]))) / D,
];

export function project(l: Look, w: number, h: number): Proj {
  const c = vecOf(l.ra, l.dec),
    e = unit(cross([0, 0, 1], c)),
    n = cross(c, e),
    S = w / (4 * Math.tan((l.fov / 4) * D)),
    cx = w / 2,
    cy = h / 2;
  return {
    c,
    S,
    P(v) {
      const z = v[0] * c[0] + v[1] * c[1] + v[2] * c[2];
      if (z < -0.2) return null;
      const k = (2 / (1 + z)) * S;
      return [cx - (v[0] * e[0] + v[1] * e[1] + v[2] * e[2]) * k, cy - (v[0] * n[0] + v[1] * n[1] + v[2] * n[2]) * k];
    },
    U(x, y) {
      const X = (cx - x) / S,
        Y = (cy - y) / S,
        r2 = X * X + Y * Y,
        z = (4 - r2) / (4 + r2),
        f = (1 + z) / 2;
      return unit([
        c[0] * z + (e[0] * X + n[0] * Y) * f,
        c[1] * z + (e[1] * X + n[1] * Y) * f,
        c[2] * z + (e[2] * X + n[2] * Y) * f,
      ]);
    },
  };
}

/** 画面を dx・dy [px] だけ引いたときの見る向き（中心の 1 px を S で角に直す） */
export function panned(l: Look, dx: number, dy: number, S: number): Look {
  const dec = Math.max(-89.5, Math.min(89.5, l.dec + dy / S / D));
  return { ra: (((l.ra + dx / S / D / Math.max(0.05, Math.cos(dec * D))) % 360) + 360) % 360, dec, fov: l.fov };
}

/** 画面の点 (x, y) の向きを止めたまま、視野を f 倍にする */
export function zoomed(l: Look, f: number, x: number, y: number, w: number, h: number): Look {
  const v = project(l, w, h).U(x, y);
  let o: Look = { ...l, fov: Math.max(FOV_MIN, Math.min(FOV_MAX, l.fov * f)) };
  for (let k = 0; k < 3; k++) {
    const q = project(o, w, h),
      p = q.P(v);
    if (!p) break;
    o = panned(o, x - p[0], y - p[1], q.S);
  }
  return o;
}
