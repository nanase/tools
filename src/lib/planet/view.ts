/**
 * 見え方（DOM に依存しない）: 画面の向き、惑星固定の座標への変換、描画に渡す値、画面上の位置
 */
import { AU, POLE } from '../astro/frame';
import { cross, dot, sub, unit, type Vec3 } from '../astro/vec';
import { type PlanetModel, type PlanetState, R_SUN, toBody } from './ephem';
import type { PlanetU } from './render';

export type Orient = 'zenith' | 'planet' | 'sky';
const D = Math.PI / 180;

/** 画面の右・上・奥（観測者から惑星へ）。上は天頂・惑星の北極・天の北極のどれか（日付の赤道の座標） */
export function basis(st: PlanetState, mode: Orient): { r: Vec3; u: Vec3; f: Vec3 } {
  const f = unit(st.P);
  const up = mode === 'zenith' && Number.isFinite(st.zenith[0]) ? st.zenith : mode === 'sky' ? POLE : st.geo.z;
  const r = unit(cross(f, up));
  return { r, u: cross(r, f), f };
}

/** 衛星の描き方（色は線形の RGB、lit は太陽に照らされている割合） */
export interface MoonLook {
  r: number;
  rgb: Vec3;
  lit: number;
}

/** 描画に渡す値をそろえる */
export function planetUniforms(
  m: PlanetModel,
  st: PlanetState,
  mode: Orient,
  moons: MoonLook[],
  opt: { shift: number; minn: Vec3; gain: number; shadows: boolean },
): PlanetU {
  const g = st.geo;
  const b = basis(st, mode);
  const tb = (v: Vec3) => toBody(g, v);
  return {
    r: tb(b.r),
    u: tb(b.u),
    f: tb(b.f),
    s: tb(g.s),
    k: m.re / m.rp,
    shift: opt.shift,
    minn: opt.minn,
    gain: opt.gain,
    sunR: R_SUN / (g.r * AU),
    moons: moons.map((o, i) => {
      const p = tb(g.moons[i]);
      return { p: [p[0] / m.re, p[1] / m.re, p[2] / m.re], r: o.r / m.re, rgb: o.rgb, lit: o.lit };
    }),
    shadows: opt.shadows,
  };
}

/** 惑星中心からの位置 v [km] の、画面での位置（赤道半径が単位、右・上が正）と、観測者からの奥行き [赤道半径] */
export function screenOf(m: PlanetModel, st: PlanetState, mode: Orient, v: Vec3): [number, number, number] {
  const b = basis(st, mode);
  return [dot(v, b.r) / m.re, dot(v, b.u) / m.re, dot(v, b.f) / m.re];
}

/**
 * 衛星 k の影の中心が惑星の面に落ちる点（惑星中心から [km]）。影が惑星に当たらなければ null。
 * 自転楕円体は z を伸ばした球として交点を求める
 */
export function shadowPoint(m: PlanetModel, st: PlanetState, k: number): Vec3 | null {
  const g = st.geo;
  const kz = m.re / m.rp;
  const p = toBody(g, g.moons[k]);
  const s = toBody(g, g.s);
  const P: Vec3 = [p[0] / m.re, p[1] / m.re, (p[2] / m.re) * kz];
  const S: Vec3 = [-s[0], -s[1], -s[2] * kz];
  const a = dot(S, S),
    bb = 2 * dot(P, S),
    c = dot(P, P) - 1;
  const disc = bb * bb - 4 * a * c;
  if (disc < 0 || dot(p, s) < 0) return null;
  const t = (-bb - Math.sqrt(disc)) / (2 * a);
  if (t < 0) return null;
  const q: Vec3 = [P[0] + t * S[0], P[1] + t * S[1], (P[2] + t * S[2]) / kz];
  const w = [q[0] * m.re, q[1] * m.re, q[2] * m.re];
  /* 惑星固定の座標から日付の赤道の座標へ戻す */
  return [
    w[0] * g.x[0] + w[1] * g.y[0] + w[2] * g.z[0],
    w[0] * g.x[1] + w[1] * g.y[1] + w[2] * g.z[1],
    w[0] * g.x[2] + w[1] * g.y[2] + w[2] * g.z[2],
  ];
}

/** 惑星の面の点 v（惑星中心から [km]）が観測者の側にあるか */
export function facing(st: PlanetState, v: Vec3): boolean {
  return dot(v, unit(sub([0, 0, 0], st.P))) > 0;
}

/** 画面での向き（右 = 0°、反時計回り）[°] */
export function screenAngle(st: PlanetState, mode: Orient, v: Vec3): number {
  const b = basis(st, mode);
  return Math.atan2(dot(v, b.u), dot(v, b.r)) / D;
}
