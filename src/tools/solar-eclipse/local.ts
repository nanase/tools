/**
 * 地方食（DOM に依存しない）: 観測地での最大食・接触 C1〜C4・食分・面積比・太陽の高度と方位
 *
 * 式は古典的な反復で、satkit（MIT OR Apache-2.0）のチュートリアルと
 * Altmann「Helligkeitsverlauf bei Sonnenfinsternissen (II)」の記述に拠る
 */
import { frameAt, observerXYZ, sunAltAz, toPlane, type Vec3, zenithPA } from './earth';
import { type Elements, K_PENUMBRA, stateAt } from './elements';

/** 観測地: 測地緯度・東経 [rad]、標高 [m] */
export interface Site {
  lat: number;
  lon: number;
  h: number;
}

/** 太陽の中心がこの高度 [rad] より上なら見えるとみなす（NASA の JSEX と同じ −0.30°） */
export const HORIZON = -0.00524;

/** 時刻 t での観測地から見た影の幾何（長さは基準面の単位） */
export interface Geom {
  t: number;
  /** 影の軸から観測地への差 u = x − ξ、v = y − η と、その時間微分 */
  u: number;
  v: number;
  a: number;
  b: number;
  /** 観測地の高さでの半影・本影の半径（L2 が負なら皆既） */
  L1: number;
  L2: number;
  zeta: number;
  /** 太陽の高度・方位、天頂の位置角 [rad] */
  alt: number;
  az: number;
  zen: number;
  /** 月の中心と観測地の距離（地球半径）。見かけの大きさに使う */
  dist: number;
}

export function geomAt(e: Elements, p: Vec3, site: Site, t: number, dt: number): Geom {
  const s = stateAt(e, t);
  const f = frameAt(s, dt);
  const [xi, eta, zeta] = toPlane(f, p);
  const sd = Math.sin(s.d);
  const cd = Math.cos(s.d);
  const dxi = s.dmu * (zeta * cd - eta * sd);
  const deta = s.dmu * xi * sd - zeta * s.dd;
  const hA = f.g + site.lon;
  const [alt, az] = sunAltAz(site.lat, s.d, hA);
  const sinF1 = s.tf1 / Math.sqrt(1 + s.tf1 * s.tf1);
  const zMoon = s.l1 / s.tf1 - K_PENUMBRA / sinF1;
  const u = s.x - xi;
  const v = s.y - eta;
  return {
    t,
    u,
    v,
    a: s.dx - dxi,
    b: s.dy - deta,
    L1: s.l1 - zeta * s.tf1,
    L2: s.l2 - zeta * s.tf2,
    zeta,
    alt,
    az,
    zen: zenithPA(site.lat, s.d, hA),
    dist: Math.hypot(zMoon - zeta, u, v),
  };
}

/** 見かけの太陽と月: 半径と中心の距離（基準面の単位）、月の中心の位置角（北から東へ）[rad] */
export interface Disks {
  sun: number;
  moon: number;
  sep: number;
  pa: number;
  /** 基準面の単位 1 を角度 [rad] に直す係数 */
  scale: number;
}

export function disksOf(g: Geom): Disks {
  const sun = (g.L1 + g.L2) / 2;
  const moon = (g.L1 - g.L2) / 2;
  const moonAng = Math.asin(K_PENUMBRA / g.dist);
  return { sun, moon, sep: Math.hypot(g.u, g.v), pa: Math.atan2(g.u, g.v), scale: moonAng / moon };
}

/** 食分: 太陽の直径のうち月に覆われた割合。中心食では (L1 − L2)/(L1 + L2) */
export function magnitudeOf(g: Geom): number {
  const m = Math.hypot(g.u, g.v);
  if (m >= g.L1) return 0;
  if (m <= Math.abs(g.L2)) return (g.L1 - g.L2) / (g.L1 + g.L2);
  return (g.L1 - m) / (g.L1 + g.L2);
}

/** 半径 r1・r2 の円が距離 d で重なる面積を、円 r1 の面積で割った値 */
export function overlapFraction(r1: number, r2: number, d: number): number {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return r2 >= r1 ? 1 : (r2 * r2) / (r1 * r1);
  const a1 = Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const a2 = Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  const area = r1 * r1 * (a1 - Math.sin(2 * a1) / 2) + r2 * r2 * (a2 - Math.sin(2 * a2) / 2);
  return area / (Math.PI * r1 * r1);
}

/** 面積比: 太陽の円盤の面積のうち月に覆われた割合 */
export function obscurationOf(g: Geom): number {
  const d = disksOf(g);
  return overlapFraction(d.sun, d.moon, d.sep);
}

export interface Contact {
  t: number;
  alt: number;
  az: number;
  /** 接点の位置角（北から東へ）[rad] */
  pa: number;
  visible: boolean;
}

export type LocalKind = 'none' | 'partial' | 'annular' | 'total';

export interface Local {
  kind: LocalKind;
  /** 最大食の時刻・食分・面積比・太陽の高度と方位 */
  max: Geom & { mag: number; obs: number; visible: boolean };
  c1: Contact | null;
  c2: Contact | null;
  c3: Contact | null;
  c4: Contact | null;
  /** 皆既・金環の継続時間 [s] */
  duration: number;
  /** C1〜C4 の間のどこかで太陽が地平線より上にあるか（夜の側の食は見えない） */
  visible: boolean;
}

const iterMax = (e: Elements, p: Vec3, site: Site, dt: number): Geom => {
  let t = 0;
  let g = geomAt(e, p, site, t, dt);
  for (let k = 0; k < 50; k++) {
    const tau = -(g.u * g.a + g.v * g.b) / (g.a * g.a + g.b * g.b);
    t += tau;
    g = geomAt(e, p, site, t, dt);
    if (Math.abs(tau) < 1e-9) break;
  }
  return g;
};

/** 影の円（umbra なら |L2|）が観測地を通る時刻。sign = −1 で前の接触、+1 で後の接触 */
function iterContact(e: Elements, p: Vec3, site: Site, dt: number, t0: number, umbra: boolean, sign: number) {
  let t = t0;
  for (let k = 0; k < 30; k++) {
    const g = geomAt(e, p, site, t, dt);
    const n2 = g.a * g.a + g.b * g.b;
    const n = Math.sqrt(n2);
    const L = umbra ? Math.abs(g.L2) : g.L1;
    const s = (g.u * g.b - g.v * g.a) / (n * L);
    if (Math.abs(s) > 1) return null;
    const tau = -(g.u * g.a + g.v * g.b) / n2 + (sign * L * Math.sqrt(1 - s * s)) / n;
    t += tau;
    if (Math.abs(tau) < 1e-9) break;
  }
  return geomAt(e, p, site, t, dt);
}

const toContact = (g: Geom | null): Contact | null =>
  g && { t: g.t, alt: g.alt, az: g.az, pa: Math.atan2(g.u, g.v), visible: g.alt > HORIZON };

export function localCircumstances(e: Elements, site: Site, dt = e.dt): Local {
  const p = observerXYZ(site.lat, site.lon, site.h);
  const g = iterMax(e, p, site, dt);
  const mag = magnitudeOf(g);
  const max = { ...g, mag, obs: obscurationOf(g), visible: g.alt > HORIZON };
  if (mag <= 0) return { kind: 'none', max, c1: null, c2: null, c3: null, c4: null, duration: 0, visible: false };
  const c1 = toContact(iterContact(e, p, site, dt, g.t, false, -1));
  const c4 = toContact(iterContact(e, p, site, dt, g.t, false, 1));
  const central = Math.hypot(g.u, g.v) < Math.abs(g.L2);
  const c2 = central ? toContact(iterContact(e, p, site, dt, g.t, true, -1)) : null;
  const c3 = central ? toContact(iterContact(e, p, site, dt, g.t, true, 1)) : null;
  const kind: LocalKind = !central ? 'partial' : g.L2 < 0 ? 'total' : 'annular';
  const duration = c2 && c3 ? (c3.t - c2.t) * 3600 : 0;
  let visible = max.visible || !!c1?.visible || !!c4?.visible;
  if (!visible && c1 && c4) {
    // 食の途中で日が昇って沈む（極地など）場合のために、間を刻んで確かめる
    for (let k = 1; k < 24 && !visible; k++)
      visible = geomAt(e, p, site, c1.t + ((c4.t - c1.t) * k) / 24, dt).alt > HORIZON;
  }
  return { kind, max, c1, c2, c3, c4, duration, visible };
}
