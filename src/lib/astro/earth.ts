/**
 * 地球の形と観測地の位置（DOM に依存しない）
 *
 * 地球固定の座標は X がグリニッジ子午線、Y が東経 90°、Z が北極の向きで、単位は赤道半径
 */
import type { Vec3 } from './vec';

/** WGS84 の扁平率と赤道半径 [m] */
export const FLAT = 1 / 298.257223563;
export const A_M = 6378137;
const B_A = 1 - FLAT;

/** 観測地（測地緯度・東経 [rad]・標高 [m]）の地球固定の座標 */
export function observerXYZ(lat: number, lon: number, h = 0): Vec3 {
  const u = Math.atan(B_A * Math.tan(lat));
  const hs = h / A_M;
  const rs = B_A * Math.sin(u) + hs * Math.sin(lat);
  const rc = Math.cos(u) + hs * Math.cos(lat);
  return [rc * Math.cos(lon), rc * Math.sin(lon), rs];
}
