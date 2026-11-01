/**
 * 外側の衛星の位置（DOM に依存しない）: 90 日おきの状態の表から、両端の状態を 2 体で進めて混ぜる。
 * 太陽の摂動が大きい不規則衛星を、軽いデータと計算で追うための形で、Horizons との差は 2015〜2036 年で約 15 万 km 以下
 * （木星の距離で 40″ ほど）。データは scripts/jupiter-moons.ts が作る
 */
import type { Vec3 } from '../astro/vec';

export interface MoonTable {
  /** 最初の状態の TT の JD、間隔 [日]、状態の数 */
  t0: number;
  dt: number;
  n: number;
  /** 群の名前 */
  groups: string[];
  /** 名前・群の番号・直径 [km]・状態（x, y, z は 100 km 単位、vx, vy, vz は 10 km/日 単位を順に並べる） */
  moons: { n: string; g: number; d: number; s: number[] }[];
}

/** 状態 s から dt [日] 進めた位置（楕円の 2 体、f・g 級数の閉じた形） */
function kepler(s: number[], i: number, dt: number, gm: number): Vec3 {
  const x = s[i] * 100,
    y = s[i + 1] * 100,
    z = s[i + 2] * 100,
    vx = s[i + 3] * 10,
    vy = s[i + 4] * 10,
    vz = s[i + 5] * 10;
  const r = Math.hypot(x, y, z);
  const a = 1 / (2 / r - (vx * vx + vy * vy + vz * vz) / gm);
  const n = Math.sqrt(gm / (a * a * a));
  const ec = (x * vx + y * vy + z * vz) / (n * a * a);
  const es = 1 - r / a;
  const e0 = Math.atan2(ec, es);
  const e = Math.hypot(ec, es);
  const M = e0 - ec + n * dt;
  let E = M;
  for (let k = 0; k < 8; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const d = E - e0;
  const f = (a / r) * (Math.cos(d) - 1) + 1;
  const g = dt + (Math.sin(d) - d) / n;
  return [f * x + g * vx, f * y + g * vy, f * z + g * vz];
}

/** 表の範囲の TT の JD */
export const tableEnd = (t: MoonTable): number => t.t0 + t.dt * (t.n - 1);

/** 衛星 k の惑星中心の位置（ICRF）[km]。表の範囲の外なら null。gm は惑星の重力定数 [km³/日²] */
export function tablePos(t: MoonTable, k: number, jdTT: number, gm: number): Vec3 | null {
  const u = (jdTT - t.t0) / t.dt;
  if (u < 0 || u > t.n - 1) return null;
  const s = t.moons[k].s;
  const i = Math.min(t.n - 2, Math.floor(u));
  const f = u - i;
  /* 暦が途中で終わる衛星は、最後の状態から 2 体で進める */
  const last = s.length / 6 - 1;
  if (i + 1 > last) return kepler(s, last * 6, jdTT - (t.t0 + last * t.dt), gm);
  const w = f * f * (3 - 2 * f);
  const a = kepler(s, i * 6, f * t.dt, gm);
  const b = kepler(s, (i + 1) * 6, (f - 1) * t.dt, gm);
  return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w];
}
