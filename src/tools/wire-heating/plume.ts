/**
 * 線のまわりの空気。熱い線の上に昇る層流のプルームを相似解で近似する。流れそのものは解かない
 */
import { air, GRAV, K0 } from './wire';

/** 気温 Ta の空気。rc = ρ cp [J/(m³·K)]、gb = g β */
function airAt(Ta: number): { nu: number; rc: number; gb: number } {
  const A = air(Ta + K0);
  return { nu: A.nu, rc: 1.205 * (293.15 / (Ta + K0)) * 1005, gb: GRAV / (Ta + K0) };
}

export interface LinePlume {
  /** 線の中心から横 x・上 y [m] の [温度上昇 K, 上向きの速さ m/s, 横の速さ m/s] */
  at(x: number, y: number): [number, number, number];
}
/** 線の外形。丸線は半径 [m]、角線は幅と高さ [m] */
export type Outline = number | { w: number; h: number };
/** 外形の表面からの距離 [m]（中では 0） */
const surfDist = (o: Outline, x: number, y: number): number =>
  typeof o === 'number'
    ? Math.max(0, Math.hypot(x, y) - o)
    : Math.hypot(Math.max(0, Math.abs(x) - o.w / 2), Math.max(0, Math.abs(y) - o.h / 2));
/**
 * 横置きの線の上の 2 次元プルーム。Qp は長さあたりの対流 [W/m]、dTs は表面の温度上昇 [K]、v は横風 [m/s]、R は線の外形。
 * 中心の速さ ∝ y^(1/5)、幅 ∝ y^(2/5)、温度上昇 ∝ y^(−3/5)。線の位置で表面の温度に合うよう、高さの原点をずらす
 */
export function linePlume(Qp: number, dTs: number, Ta: number, v = 0, R: Outline = 0.5e-3): LinePlume {
  const A = airAt(Ta),
    B = (A.gb * Qp) / A.rc;
  if (!(B > 0) || !(dTs > 0)) return { at: () => [0, 0, 0] };
  const c = A.gb * (8 / 3) * A.nu ** 0.4;
  const dTc = (Y: number) => B ** 0.8 / (c * Y ** 0.6);
  const y0 = (B ** 0.8 / (c * dTs)) ** (5 / 3);
  const uc = (Y: number) => ((B * B * Y) / A.nu) ** 0.2,
    dl = (Y: number) => 2 * A.nu ** 0.6 * Y ** 0.4 * B ** -0.2;
  const xc = (y: number) => (v * 1.25 * ((y + y0) ** 0.8 - y0 ** 0.8)) / ((B * B) / A.nu) ** 0.2;
  return {
    at(x, y) {
      /* 線のすぐ周りの温まった空気。外形の表面から減る（丸線は半径 + 1 mm、角線は薄い向きの半分 + 0.5 mm の長さ） */
      const len = typeof R === 'number' ? R + 1e-3 : Math.min(R.w, R.h) / 2 + 0.5e-3,
        halo = dTs * Math.exp(-surfDist(R, x, y) / len);
      if (y < 0) return [halo, 0, v * 0.3];
      /* 幅の広い角線では、根元のプルームを線の幅まで広げ、昇るにつれて細い形へ戻す */
      const dx = x - xc(y),
        half = typeof R === 'number' ? 0 : (R.w / 2) * Math.exp(-y / Math.max(R.w, 1e-3)),
        xr = Math.sign(dx) * Math.max(0, Math.abs(dx) - half),
        Y = y + y0,
        s = 1 / Math.cosh(xr / dl(Y)) ** 2;
      return [Math.max(halo, dTc(Y) * s), uc(Y) * s, v];
    },
  };
}

/** 点の熱源（経路の区間 1 つ）の軸対称のプルーム。P [W]、dTs は表面の温度上昇。返す関数は横 dx・上 h [m] の [温度上昇, 上向きの速さ] */
export function pointPlume(P: number, dTs: number, Ta: number): (dx: number, h: number) => [number, number] {
  const A = airAt(Ta),
    u = Math.sqrt((A.gb * P) / (A.rc * A.nu));
  if (!(P > 0) || !(dTs > 0)) return () => [0, 0];
  const h0 = P / (2 * Math.PI * A.rc * A.nu * dTs);
  return (dx, h) => {
    if (h < 0) return [dTs * Math.exp(-Math.hypot(dx, h) / 1.5e-3), 0];
    const H = h + h0,
      g = Math.exp(-(dx * dx) / ((4 * A.nu * H) / u));
    return [(P / (2 * Math.PI * A.rc * A.nu * H)) * g, u * g];
  };
}

export interface Src {
  x: number;
  y: number;
  dTs: number;
  f: (dx: number, h: number) => [number, number];
}
/**
 * 経路の点 (x, y)（y は下向き）の空気の温度上昇と上向きの速さ。skip に近い区間（自分のそば）は除く。
 * 重なったプルームは足し合わせを半分に抑え、いちばん熱い線の 85 % を超えない
 */
export function airField(pl: readonly Src[], x: number, y: number, skip = -1): [number, number] {
  let t = 0,
    mx = 0,
    u = 0,
    cap = 0;
  for (let j = 0; j < pl.length; j++) {
    cap = Math.max(cap, pl[j].dTs);
    if (skip >= 0 && Math.abs(j - skip) < 3) continue;
    const [a, b] = pl[j].f(x - pl[j].x, pl[j].y - y);
    t += a;
    mx = Math.max(mx, a);
    u = Math.max(u, b);
  }
  return [Math.min(0.85 * cap, mx + 0.5 * (t - mx)), u];
}
