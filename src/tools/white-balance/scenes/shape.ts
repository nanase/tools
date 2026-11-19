/* 2 つ以上の場面で使う形の補助 */
import type { Out } from '../scene';

/** 光の向き [lx, ly, lz] と、視線との中間の向き [hx, hy, hz] */
export type Dir6 = readonly [number, number, number, number, number, number];

/** 円柱の陰影（nx は中心からの横の位置 −1〜1） */
export const cyl = (n: number): number => {
  const nx = n < -1 ? -1 : n > 1 ? 1 : n;
  return 0.16 + (0.84 * Math.max(0, -0.45 * nx + 0.75 * Math.sqrt(1 - nx * nx))) / 0.875;
};
/** 円柱の鏡面の筋 */
export const cylSp = (nx: number): number => Math.exp(-(((nx + 0.38) / 0.08) ** 2));
/** 線分 (ax, ay)-(bx, by) からの距離の 2 乗 */
export const seg2 = (x: number, y: number, ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax,
    dy = by - ay;
  let t = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = x - ax - t * dx,
    ey = y - ay - t * dy;
  return ex * ex + ey * ey;
};

export const dirL = (x: number, y: number, z: number): Dir6 => {
  const n = Math.hypot(x, y, z),
    l = [x / n, y / n, z / n] as const,
    h = [l[0], l[1], l[2] + 1] as const,
    m = Math.hypot(h[0], h[1], h[2]);
  return [l[0], l[1], l[2], h[0] / m, h[1] / m, h[2] / m];
};
/** 光の向きを選べる球（楕円体）。amb は影の底の明るさ、ks は鏡面の強さ */
export function ball(
  o: Out,
  x: number,
  y: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  id: number,
  L: Dir6,
  amb: number,
  ks: number,
): boolean {
  const nx = (x - cx) / rx,
    ny = (y - cy) / ry,
    q = nx * nx + ny * ny;
  if (q >= 1) return false;
  const nz = Math.sqrt(1 - q);
  const d = nx * L[0] + ny * L[1] + nz * L[2],
    s = nx * L[3] + ny * L[4] + nz * L[5];
  o.id = id;
  o.sh = amb + (1 - amb) * (d > 0 ? d : 0);
  o.sp = s > 0 ? ks * s ** 60 : 0;
  return true;
}
export const inTri = (
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): boolean => {
  const d1 = (bx - ax) * (y - ay) - (by - ay) * (x - ax),
    d2 = (cx - bx) * (y - by) - (cy - by) * (x - bx),
    d3 = (ax - cx) * (y - cy) - (ay - cy) * (x - cx);
  return (d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0);
};
