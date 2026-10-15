/**
 * 影の濃さ（DOM に依存しない）: 周辺減光を入れた太陽の残光 F と、地表の点・格子での食分
 *
 * 周辺減光は Hestroffer & Magnan (1998) のべき乗則 I(μ)/I(1) = μ^α、α = −0.023 + 0.292/λ[µm]
 */
import { frameAt, type Vec3 } from './earth';
import { type Elements, stateAt } from './elements';

/** 波長 λ [µm] での周辺減光の指数 α */
export const limbAlpha = (lambda: number) => -0.023 + 0.292 / lambda;
/** 目の感度の中心 550 nm の α */
export const ALPHA_V = limbAlpha(0.55);

/** 円環の数。縁からの深さ q = 1 − r/R を 10⁻⁶〜1 の対数で刻み、ダイヤモンドリングの細い光も拾う */
const RINGS = 96;
const LN_Q0 = Math.log(1e-6);

/**
 * 太陽（半径 sun）の光のうち、月（半径 moon、中心の距離 sep）に隠れずに届く割合 F。
 * 太陽面を同心の円環に分け、円環ごとに月に入る弧の割合を余弦定理で求める
 */
export function residualFlux(sun: number, moon: number, sep: number, alpha = ALPHA_V): number {
  if (sep >= sun + moon) return 1;
  let all = 0;
  let hidden = 0;
  for (let k = 0; k < RINGS; k++) {
    const q = Math.exp(LN_Q0 * (1 - (k + 0.5) / RINGS));
    const r = (1 - q) * sun;
    const mu = Math.sqrt(q * (2 - q));
    // dr = R dq = R q ds（s = ln q を等間隔に刻む）
    const w = mu ** alpha * r * q;
    all += w;
    let f: number;
    if (moon >= sep + r) f = 1;
    else if (r >= sep + moon || sep >= r + moon) f = 0;
    else f = Math.acos(Math.max(-1, Math.min(1, (r * r + sep * sep - moon * moon) / (2 * r * sep)))) / Math.PI;
    hidden += w * f;
  }
  return 1 - hidden / all;
}

/** 時刻 t での基準面の量を前もって計算したもの（格子や画素で何度も使う） */
export interface Snap {
  x: number;
  y: number;
  l1: number;
  l2: number;
  tf1: number;
  tf2: number;
  i: Vec3;
  j: Vec3;
  k: Vec3;
}

export function snapAt(e: Elements, t: number, dt = e.dt): Snap {
  const s = stateAt(e, t);
  const f = frameAt(s, dt);
  return { x: s.x, y: s.y, l1: s.l1, l2: s.l2, tf1: s.tf1, tf2: s.tf2, i: f.i, j: f.j, k: f.k };
}

/** 地表の点 p での食の様子: ζ（太陽の高さの目安、負なら夜）、食分、残光 F */
export interface Spot {
  zeta: number;
  mag: number;
  flux: number;
}

/** 地表の点 p での食分だけ（残光を計算しない軽い版）。太陽が地平線の下なら 0 */
export function magAt(s: Snap, p: Vec3, minZeta = -0.00524): number {
  const zeta = p[0] * s.k[0] + p[1] * s.k[1] + p[2] * s.k[2];
  if (zeta < minZeta) return 0;
  const xi = p[0] * s.i[0] + p[1] * s.i[1] + p[2] * s.i[2];
  const eta = p[0] * s.j[0] + p[1] * s.j[1] + p[2] * s.j[2];
  const L1 = s.l1 - zeta * s.tf1;
  const m = Math.hypot(s.x - xi, s.y - eta);
  if (m >= L1) return 0;
  const L2 = s.l2 - zeta * s.tf2;
  return m <= Math.abs(L2) ? (L1 - L2) / (L1 + L2) : (L1 - m) / (L1 + L2);
}

export function spotAt(s: Snap, p: Vec3, alpha = ALPHA_V): Spot {
  const xi = p[0] * s.i[0] + p[1] * s.i[1] + p[2] * s.i[2];
  const eta = p[0] * s.j[0] + p[1] * s.j[1] + p[2] * s.j[2];
  const zeta = p[0] * s.k[0] + p[1] * s.k[1] + p[2] * s.k[2];
  const L1 = s.l1 - zeta * s.tf1;
  const L2 = s.l2 - zeta * s.tf2;
  const m = Math.hypot(s.x - xi, s.y - eta);
  if (m >= L1) return { zeta, mag: 0, flux: 1 };
  const sun = (L1 + L2) / 2;
  const moon = (L1 - L2) / 2;
  const mag = m <= Math.abs(L2) ? (L1 - L2) / (L1 + L2) : (L1 - m) / (L1 + L2);
  return { zeta, mag, flux: residualFlux(sun, moon, m, alpha) };
}

/**
 * 緯度・経度の格子の各点で、太陽が地平線より上にある間の最大の食分。
 * 時刻を steps 個に刻んで取る（等値線を引くための粗い格子向け）
 */
export function maxMagnitudeGrid(
  e: Elements,
  lats: Float64Array,
  lons: Float64Array,
  dt = e.dt,
  steps = 180,
  minZeta = -0.00524,
): Float32Array {
  const snaps: Snap[] = [];
  for (let n = 0; n <= steps; n++) snaps.push(snapAt(e, e.tmin + ((e.tmax - e.tmin) * n) / steps, dt));
  const out = new Float32Array(lats.length * lons.length);
  const B_A = 1 - 1 / 298.257223563;
  for (let a = 0; a < lats.length; a++) {
    const u = Math.atan(B_A * Math.tan(lats[a]));
    const rc = Math.cos(u);
    const rs = B_A * Math.sin(u);
    for (let b = 0; b < lons.length; b++) {
      const p: Vec3 = [rc * Math.cos(lons[b]), rc * Math.sin(lons[b]), rs];
      let best = 0;
      for (const s of snaps) {
        const zeta = p[0] * s.k[0] + p[1] * s.k[1] + p[2] * s.k[2];
        if (zeta < minZeta) continue;
        const xi = p[0] * s.i[0] + p[1] * s.i[1] + p[2] * s.i[2];
        const eta = p[0] * s.j[0] + p[1] * s.j[1] + p[2] * s.j[2];
        const L1 = s.l1 - zeta * s.tf1;
        const m = Math.hypot(s.x - xi, s.y - eta);
        if (m >= L1) continue;
        const L2 = s.l2 - zeta * s.tf2;
        const mag = m <= Math.abs(L2) ? (L1 - L2) / (L1 + L2) : (L1 - m) / (L1 + L2);
        if (mag > best) best = mag;
      }
      out[a * lons.length + b] = best;
    }
  }
  return out;
}
