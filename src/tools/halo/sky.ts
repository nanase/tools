/**
 * 全天図: 天頂を中心にした上半球と、天底を中心にした下半球を、等立体角（Lambert の正積方位図法）の円盤 2 枚にして
 * 横に並べる（幅 2N × 高さ N）。どの画素も同じ立体角を覆うので、足した光線の数がそのまま輝度になる。
 * 方位は太陽を基準にとる（太陽は +x）
 */
import { cmf, toRgb } from '../lens/light';
import { type Crystal, family, nIce, orient, type Population, prism, Rng, sunRay, traceRay } from './trace';

/** 空の向き (x, y, z) → 全天図の画素の番号 */
export function mapIndex(N: number, x: number, y: number, z: number): number {
  const up = z >= 0,
    k = 1 / Math.sqrt(1 + Math.abs(z)),
    u = Math.min(N - 1, Math.max(0, Math.floor(((x * k + 1) / 2) * N))),
    v = Math.min(N - 1, Math.max(0, Math.floor(((1 - y * k) / 2) * N)));
  return v * 2 * N + u + (up ? 0 : N);
}

/** 全天図の 1 画素の立体角 [sr]（半球 2π を円盤 π に写すので、単位面積あたり 2 sr） */
export const pixelSr = (N: number) => 2 * (2 / N) ** 2;

/** 波長 380〜780 nm（1 nm ごと）の色（線形 sRGB）。一様に引いて平均すると (1, 1, 1) の白になる */
export const WL0 = 380,
  WL1 = 780;
export const WL_RGB: Float64Array = (() => {
  const n = WL1 - WL0 + 1,
    c = new Float64Array(3 * n),
    sum = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const v = toRgb(cmf(WL0 + i));
    for (let k = 0; k < 3; k++) {
      c[3 * i + k] = v[k];
      sum[k] += v[k];
    }
  }
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) c[3 * i + k] *= n / sum[k];
  return c;
})();

/** 光線を足した全天図 */
export interface SkyMap {
  N: number;
  /** 線形 sRGB × 画素 */
  rgb: Float32Array;
  /** 太陽から出した光線の数 */
  rays: number;
  /** 結晶に当たって出ていった光線の数 */
  hits: number;
}

export function newMap(N: number): SkyMap {
  return { N, rgb: new Float32Array(2 * N * N * 3), rays: 0, hits: 0 };
}

/** 結晶の母集団ごとの前計算 */
interface Prep {
  p: Population;
  c: Crystal;
  /** 選ぶ確率の累積 */
  cum: number;
}

/**
 * 光線を rays 本足す。母集団は、表面積をそろえた結晶の数の比 w で混ぜる（外接球の断面に当てる光線の数を
 * w × 断面積に比例させれば、当たる光線は投影の面積に比例する）
 */
export function simulate(
  map: SkyMap,
  pops: Population[],
  elev: number,
  rays: number,
  seed = 1,
  /** 光路の種類（family）ごとの色。与えると波長の色の代わりに使う */
  tint?: readonly (readonly [number, number, number])[],
): void {
  const g = new Rng(seed),
    act = pops.filter((p) => p.w > 0),
    prep: Prep[] = [];
  let tot = 0;
  for (const p of act) {
    const c = prism(p.ca);
    tot += p.w * Math.PI * c.rb * c.rb;
    prep.push({ p, c, cum: tot });
  }
  if (!prep.length) return;
  const M = new Float64Array(9),
    { N, rgb } = map,
    nw = WL1 - WL0;
  for (let r = 0; r < rays; r++) {
    const q = g.next() * tot;
    let k = 0;
    while (k < prep.length - 1 && prep[k].cum < q) k++;
    const { p, c } = prep[k];
    orient(p, g, M);
    /* 波長は層別に引く（光線の番号で区切った区間の中で一様） */
    const wl = WL0 + nw * ((r * 0.6180339887 + g.next() * 0.001) % 1),
      n = nIce(wl),
      [dx, dy, dz] = sunRay(elev, g),
      h = traceRay(c, M, dx, dy, dz, n, g);
    if (!h) continue;
    /* 空の向き（光の来る向き）は進む向きの逆 */
    let sx = -h.x,
      sy = -h.y,
      sz = -h.z;
    if (p.d > 0) [sx, sy, sz] = blur(sx, sy, sz, (3.2 * wl * 1e-3) / p.d / 2.3548, g);
    const i = 3 * mapIndex(N, sx, sy, sz);
    if (tint) {
      const c = tint[family(h.path)];
      rgb[i] += c[0];
      rgb[i + 1] += c[1];
      rgb[i + 2] += c[2];
    } else {
      const j = 3 * Math.min(nw, Math.round(wl - WL0));
      rgb[i] += WL_RGB[j];
      rgb[i + 1] += WL_RGB[j + 1];
      rgb[i + 2] += WL_RGB[j + 2];
    }
    map.hits++;
  }
  map.rays += rays;
}

/** 向きを、標準偏差 s [rad] の 2 次元のガウス分布でずらす（回折の近似） */
export function blur(x: number, y: number, z: number, s: number, g: Rng): [number, number, number] {
  const ax = Math.abs(x) < 0.9 ? 1 : 0,
    ay = 1 - ax;
  let ux = ay * z,
    uy = -ax * z,
    uz = ax * y - ay * x;
  const l = Math.hypot(ux, uy, uz);
  ux /= l;
  uy /= l;
  uz /= l;
  const vx = y * uz - z * uy,
    vy = z * ux - x * uz,
    vz = x * uy - y * ux,
    a = s * g.gauss(),
    b = s * g.gauss(),
    X = x + a * ux + b * vx,
    Y = y + a * uy + b * vy,
    Z = z + a * uz + b * vz,
    L = Math.hypot(X, Y, Z);
  return [X / L, Y / L, Z / L];
}
