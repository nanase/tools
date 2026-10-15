/**
 * 地球と基準面の間の座標変換（DOM に依存しない）
 *
 * 地球固定の座標は X がグリニッジ子午線、Y が東経 90°、Z が北極の向きで、単位は赤道半径。
 * 影の軸のグリニッジ時角は G = μ − 1.002738·ΔT·15″/s（NASA の μ は UT1 を TT とみなした暦表時角）
 */
import type { State } from './elements';

/** WGS84 の扁平率と赤道半径 [m] */
export const FLAT = 1 / 298.257223563;
export const A_M = 6378137;
const B_A = 1 - FLAT;
const S2 = 1 / (B_A * B_A);

/** ΔT 1 秒あたりの地球の自転角 [rad] */
export const ROT_PER_S = ((1.00273790935 * 15) / 3600) * (Math.PI / 180);

export type Vec3 = [number, number, number];

/** 基準面の基底 i（東）・j（北）・k（太陽の向き）を地球固定の座標で表したもの */
export interface Frame {
  i: Vec3;
  j: Vec3;
  k: Vec3;
  /** 影の軸のグリニッジ時角 [rad] */
  g: number;
}

export function frameAt(s: State, dt: number): Frame {
  const g = s.mu - ROT_PER_S * dt;
  const sg = Math.sin(g);
  const cg = Math.cos(g);
  const sd = Math.sin(s.d);
  const cd = Math.cos(s.d);
  return { i: [sg, cg, 0], j: [-sd * cg, sd * sg, cd], k: [cd * cg, -cd * sg, sd], g };
}

/** 観測地（測地緯度・東経 [rad]・標高 [m]）の地球固定の座標 */
export function observerXYZ(lat: number, lon: number, h = 0): Vec3 {
  const u = Math.atan(B_A * Math.tan(lat));
  const hs = h / A_M;
  const rs = B_A * Math.sin(u) + hs * Math.sin(lat);
  const rc = Math.cos(u) + hs * Math.cos(lat);
  return [rc * Math.cos(lon), rc * Math.sin(lon), rs];
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** 地球固定の点を基準面の (ξ, η, ζ) へ */
export function toPlane(f: Frame, p: Vec3): Vec3 {
  return [dot(p, f.i), dot(p, f.j), dot(p, f.k)];
}

/** 基準面の点 (ξ, η) を太陽の側の地表へ持ち上げる。地球の縁の外なら null */
export function liftToSurface(f: Frame, xi: number, eta: number): Vec3 | null {
  const { i, j, k } = f;
  const ax = xi * i[0] + eta * j[0];
  const ay = xi * i[1] + eta * j[1];
  const az = xi * i[2] + eta * j[2];
  const a2 = k[0] * k[0] + k[1] * k[1] + S2 * k[2] * k[2];
  const b = ax * k[0] + ay * k[1] + S2 * az * k[2];
  const c = ax * ax + ay * ay + S2 * az * az - 1;
  const disc = b * b - a2 * c;
  if (disc < 0) return null;
  const z = (-b + Math.sqrt(disc)) / a2;
  return [ax + z * k[0], ay + z * k[1], az + z * k[2]];
}

/**
 * 太陽から見た地球の縁（基準面に写した輪郭）の、向き Q（北から東へ）の点。
 * 戻り値は基準面の (ξ, η) と、その点の地表の座標
 */
export function limbPoint(f: Frame, q: number): { xi: number; eta: number; p: Vec3 } {
  const { i, j, k } = f;
  const sq = Math.sin(q);
  const cq = Math.cos(q);
  const ux = sq * i[0] + cq * j[0];
  const uy = sq * i[1] + cq * j[1];
  const uz = sq * i[2] + cq * j[2];
  const a2 = k[0] * k[0] + k[1] * k[1] + S2 * k[2] * k[2];
  const bh = ux * k[0] + uy * k[1] + S2 * uz * k[2];
  const ch = ux * ux + uy * uy + S2 * uz * uz;
  const r = Math.sqrt(a2 / (a2 * ch - bh * bh));
  const z = (-r * bh) / a2;
  return { xi: r * sq, eta: r * cq, p: [r * ux + z * k[0], r * uy + z * k[1], r * uz + z * k[2]] };
}

/** 地表の点の測地緯度・経度 [rad] */
export function latLon(p: Vec3): [number, number] {
  const rxy = Math.hypot(p[0], p[1]);
  return [Math.atan2(p[2], B_A * B_A * rxy), Math.atan2(p[1], p[0])];
}

/** 観測地での太陽の高度と方位（北から東へ）[rad]。d・時角 H は影の軸のもの */
export function sunAltAz(lat: number, d: number, hAngle: number): [number, number] {
  const sl = Math.sin(lat);
  const cl = Math.cos(lat);
  const sd = Math.sin(d);
  const cd = Math.cos(d);
  const ch = Math.cos(hAngle);
  const alt = Math.asin(Math.max(-1, Math.min(1, sl * sd + cl * cd * ch)));
  const az = Math.atan2(-Math.sin(hAngle) * cd, sd * cl - cd * ch * sl);
  return [alt, az < 0 ? az + 2 * Math.PI : az];
}

/** 太陽面で天頂の向きを北から東へ測った角（視差角 q）[rad] */
export function zenithPA(lat: number, d: number, hAngle: number): number {
  return Math.atan2(
    Math.cos(lat) * Math.sin(hAngle),
    Math.sin(lat) * Math.cos(d) - Math.cos(lat) * Math.sin(d) * Math.cos(hAngle),
  );
}
