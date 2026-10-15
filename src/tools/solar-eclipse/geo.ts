/**
 * 地図の投影と等値線（DOM に依存しない）: 正距円筒・Equal Earth・正射の 3 つと、格子の等値線（マーチングスクエア）
 *
 * Equal Earth は Šavrič, Patterson & Jenny (2018) の式（EPSG 1078）
 */

export const D2R = Math.PI / 180;

/** 投影: 緯度・経度 [rad] と画面の座標 [px] の行き来。描けない点は null */
export interface Projection {
  w: number;
  h: number;
  fwd(lat: number, lon: number): [number, number] | null;
  inv(x: number, y: number): [number, number] | null;
  /** 経度で続く地図か（線を ±360° ずらして描き足す必要があるか） */
  wraps: boolean;
  /** 経度で続く地図で、経度を中心へ寄せずに投影する（ずらした線を描くため） */
  raw?: (lat: number, lon: number) => [number, number];
}

/** 経度を lon0 を中心とした ±π に寄せる */
export const wrapLon = (lon: number, lon0 = 0) => {
  let d = (lon - lon0) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return lon0 + d;
};

/** 正距円筒。中心 (lat0, lon0)、1 px あたりの角度 k [rad] */
export function equirect(w: number, h: number, lat0: number, lon0: number, k: number): Projection {
  return {
    w,
    h,
    wraps: true,
    fwd: (lat, lon) => [w / 2 + (wrapLon(lon, lon0) - lon0) / k, h / 2 - (lat - lat0) / k],
    raw: (lat, lon) => [w / 2 + (lon - lon0) / k, h / 2 - (lat - lat0) / k],
    inv: (x, y) => {
      const lat = lat0 + (h / 2 - y) * k;
      if (Math.abs(lat) > Math.PI / 2) return null;
      return [lat, lon0 + (x - w / 2) * k];
    },
  };
}

const A1 = 1.340264;
const A2 = -0.081106;
const A3 = 0.000893;
const A4 = 0.003796;
const M = Math.sqrt(3) / 2;

/** Equal Earth（正積の全球図）。中心の経度 lon0、地図の幅 w に合わせる */
export function equalEarth(w: number, lon0: number, pad = 0): Projection {
  // 単位の地図の幅は 2 × 2.7066、高さは 2 × 1.3173（θ = 赤道〜極）
  const xmax = 2.706629;
  const ymax = 1.317362;
  const k = (w - 2 * pad) / (2 * xmax);
  const h = Math.ceil(2 * ymax * k + 2 * pad);
  const fy = (t: number) => t * (A1 + t * t * (A2 + t * t * t * t * (A3 + A4 * t * t)));
  const fdy = (t: number) => A1 + t * t * (3 * A2 + t * t * t * t * (7 * A3 + 9 * A4 * t * t));
  return {
    w,
    h,
    wraps: false,
    fwd: (lat, lon) => {
      const t = Math.asin(M * Math.sin(lat));
      const l = wrapLon(lon, lon0) - lon0;
      const x = (2 * Math.sqrt(3) * l * Math.cos(t)) / (3 * fdy(t));
      return [w / 2 + x * k, h / 2 - fy(t) * k];
    },
    inv: (px, py) => {
      const x = (px - w / 2) / k;
      const y = (h / 2 - py) / k;
      if (Math.abs(y) > ymax) return null;
      let t = y;
      for (let n = 0; n < 8; n++) t -= (fy(t) - y) / fdy(t);
      const l = (3 * x * fdy(t)) / (2 * Math.sqrt(3) * Math.cos(t));
      if (Math.abs(l) > Math.PI) return null;
      const s = Math.sin(t) / M;
      if (Math.abs(s) > 1) return null;
      return [Math.asin(s), lon0 + l];
    },
  };
}

/** 正射（地球儀）。中心 (lat0, lon0) を真上から見る。半径 r [px] */
export function orthographic(w: number, h: number, lat0: number, lon0: number, r: number): Projection {
  const s0 = Math.sin(lat0);
  const c0 = Math.cos(lat0);
  return {
    w,
    h,
    wraps: false,
    fwd: (lat, lon) => {
      const cl = Math.cos(lat);
      const dl = lon - lon0;
      const cosc = s0 * Math.sin(lat) + c0 * cl * Math.cos(dl);
      if (cosc < 0) return null;
      return [w / 2 + r * cl * Math.sin(dl), h / 2 - r * (c0 * Math.sin(lat) - s0 * cl * Math.cos(dl))];
    },
    inv: (px, py) => {
      const x = (px - w / 2) / r;
      const y = (h / 2 - py) / r;
      const rho = Math.hypot(x, y);
      if (rho > 1) return null;
      const c = Math.asin(rho);
      const sc = Math.sin(c);
      const cc = Math.cos(c);
      const lat = rho === 0 ? lat0 : Math.asin(cc * s0 + (y * sc * c0) / rho);
      const lon = lon0 + Math.atan2(x * sc, rho * c0 * cc - y * s0 * sc);
      return [lat, lon];
    },
  };
}

/** 経度が飛ばないように点列の経度をつなぐ（±π をまたいでも連続にする） */
export function unwrap(lons: number[]): number[] {
  const out: number[] = [];
  for (const l of lons) {
    if (!out.length) out.push(l);
    else out.push(wrapLon(l, out[out.length - 1]));
  }
  return out;
}

/**
 * 格子 v（ny 行 × nx 列）の等値線 level の線分。座標は格子の (列, 行) の小数。
 * 線分はつながず、そのまま描く
 */
export function contour(v: ArrayLike<number>, nx: number, ny: number, level: number): number[][] {
  const segs: number[][] = [];
  const at = (i: number, j: number) => v[j * nx + i] - level;
  const lerp = (a: number, b: number) => a / (a - b);
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i + 1, j + 1);
      const d = at(i, j + 1);
      const code = (a > 0 ? 8 : 0) | (b > 0 ? 4 : 0) | (c > 0 ? 2 : 0) | (d > 0 ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const top = () => [i + lerp(a, b), j];
      const right = () => [i + 1, j + lerp(b, c)];
      const bottom = () => [i + lerp(d, c), j + 1];
      const left = () => [i, j + lerp(a, d)];
      const add = (p: number[], q: number[]) => segs.push([p[0], p[1], q[0], q[1]]);
      switch (code) {
        case 1:
        case 14:
          add(left(), bottom());
          break;
        case 2:
        case 13:
          add(bottom(), right());
          break;
        case 3:
        case 12:
          add(left(), right());
          break;
        case 4:
        case 11:
          add(top(), right());
          break;
        case 6:
        case 9:
          add(top(), bottom());
          break;
        case 7:
        case 8:
          add(left(), top());
          break;
        case 5:
          add(left(), top());
          add(bottom(), right());
          break;
        case 10:
          add(top(), right());
          add(left(), bottom());
          break;
      }
    }
  }
  return segs;
}
