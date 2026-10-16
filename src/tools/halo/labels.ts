/**
 * 空の上のハロの名前: 位置は解析の式（最小偏角・Bravais の実効屈折率・環天頂アークと環水平アークの高度）で
 * 決める。向きは全天図と同じ（z が天頂、光源は方位 0、右が正）。画面の座標への投影はシェーダと同じ式
 */
import { apparent } from './scene';
import { nIce, type Population } from './trace';

const D = Math.PI / 180;
export type V3 = [number, number, number];

/** 550 nm の屈折率と最小偏角 */
export const N550 = nIce(550);
export const minDev = (n: number, A: number): number => (2 * Math.asin(n * Math.sin((A * D) / 2))) / D - A;
export const R22 = minDev(N550, 60),
  R46 = minDev(N550, 90);

/** Bravais の実効屈折率（高度 e の光が水平に進む成分に効く屈折率） */
export const bravais = (e: number, n = N550): number => Math.sqrt(n * n - Math.sin(e * D) ** 2) / Math.cos(e * D);
/** 幻日の方位の差 [°]（出ないときは NaN） */
export function parAz(e: number): number {
  const ne = bravais(e);
  return ne * Math.sin(30 * D) < 1 ? minDev(ne, 60) : Number.NaN;
}
/** 幻日と光源の角距離 [°] */
export function parDist(e: number): number {
  const a = parAz(e);
  return Number.isNaN(a) ? Number.NaN : Math.acos(Math.cos(e * D) ** 2 * Math.cos(a * D) + Math.sin(e * D) ** 2) / D;
}
/** 環天頂アークの高度 [°]（太陽高度 32.2° 以上では NaN） */
export const czaAlt = (e: number, n = N550): number =>
  n * n - Math.cos(e * D) ** 2 >= 1 || e > 90
    ? Number.NaN
    : e < 0
      ? Number.NaN
      : Math.asin(Math.sqrt(n * n - Math.cos(e * D) ** 2)) / D;
/** 環水平アークの高度 [°]（太陽高度 57.8° 以下では NaN） */
export const chaAlt = (e: number, n = N550): number => {
  const x = 1 - n * n + Math.sin(e * D) ** 2;
  return x > 0 ? Math.asin(Math.sqrt(x)) / D : Number.NaN;
};

/** 高度 alt・方位 az（光源が 0、右が正）の向き */
export const altaz = (alt: number, az: number): V3 => [
  Math.cos(alt * D) * Math.cos(az * D),
  -Math.cos(alt * D) * Math.sin(az * D),
  Math.sin(alt * D),
];
/** 光源から角 rho、位置角 psi（天頂の側が 0、右が正）の向き */
export function around(e: number, rho: number, psi: number): V3 {
  const s = altaz(e, 0),
    up: V3 = [-Math.sin(e * D), 0, Math.cos(e * D)],
    rt: V3 = [0, -1, 0],
    c = Math.cos(rho * D),
    k = Math.sin(rho * D);
  return [0, 1, 2].map((i) => c * s[i] + k * (Math.cos(psi * D) * up[i] + Math.sin(psi * D) * rt[i])) as V3;
}

export interface Label {
  /** 光路の図のキー（名前を押して選べるもの） */
  k: string;
  name: string;
  /** 真の向き */
  d: V3;
  /** 名前を置く向き: s 右、m 上下、e 左。dx・dy は点からのずれ [px] */
  a: 's' | 'm' | 'e';
  dx: number;
  dy: number;
}

/** 光源の高度 e と母集団から、出ているはずのハロの名前を並べる。extra は探して見つけた位置（パリーアークなど） */
export function labelsFor(e: number, pops: Population[], moon: boolean, extra: Record<string, V3>): Label[] {
  const act = pops.filter((p) => p.w > 0),
    has = (...o: Population['orient'][]) => act.some((p) => o.includes(p.orient)),
    pyr = act.some((p) => (p.pyr ?? 0) > 0),
    plate = has('plate'),
    tilted = act.some((p) => p.orient === 'plate' && p.tilt >= 2),
    col = has('column', 'parry'),
    sp = moon ? '月' : '日',
    L: Label[] = [];
  if (has('random') || col) L.push({ k: 'h22', name: '内暈', d: around(e, R22, -40), a: 'e', dx: -14, dy: -12 });
  if (has('random')) L.push({ k: 'h46', name: '外暈', d: around(e, R46, -40), a: 'e', dx: -14, dy: -12 });
  if (pyr && has('random')) {
    L.push({ k: 'p9', name: '9° の暈', d: around(e, minDev(N550, 28), -25), a: 'e', dx: -12, dy: -10 });
    L.push({ k: 'p35', name: '35° の暈', d: around(e, minDev(N550, 80.22), -30), a: 'e', dx: -12, dy: -10 });
  }
  const pa = parAz(e);
  if (plate && !Number.isNaN(pa)) {
    L.push({ k: 'par', name: `幻${sp}`, d: altaz(e, -pa), a: 'm', dx: 0, dy: 22 });
    L.push({ k: 'par', name: `幻${sp}`, d: altaz(e, pa), a: 'm', dx: 0, dy: 22 });
  }
  if (plate || col) L.push({ k: 'pc', name: `幻${sp}環`, d: altaz(e, 75), a: 'm', dx: 0, dy: -14 });
  if (plate) {
    L.push({ k: 'p120', name: `120° 幻${sp}`, d: altaz(e, -120), a: 'm', dx: 0, dy: 20 });
    L.push({ k: 'p120', name: `120° 幻${sp}`, d: altaz(e, 120), a: 'm', dx: 0, dy: 20 });
  }
  const cz = czaAlt(e);
  if (plate && !Number.isNaN(cz)) L.push({ k: 'cza', name: '環天頂アーク', d: altaz(cz, 0), a: 'm', dx: 0, dy: -20 });
  const ch = chaAlt(e);
  if (plate && !Number.isNaN(ch)) L.push({ k: 'cha', name: '環水平アーク', d: altaz(ch, 0), a: 'm', dx: 0, dy: 22 });
  if (col) {
    L.push({ k: 'uta', name: e >= 32 ? '外接ハロ' : '上端接弧', d: around(e, R22, 0), a: 's', dx: 24, dy: -12 });
    if (e - R22 > 1 && e < 32) L.push({ k: 'lta', name: '下端接弧', d: around(e, R22, 180), a: 's', dx: 24, dy: 10 });
  }
  if (tilted && e < 12)
    L.push({ k: 'pil', name: `${moon ? '月' : '太陽'}柱`, d: altaz(e + 6, 0), a: 's', dx: 18, dy: -6 });
  const NAMES: Record<string, string> = { parry: 'パリーアーク', lowitz: 'ローウィッツアーク' };
  for (const [k, d] of Object.entries(extra))
    L.push({ k, name: NAMES[k] ?? k, d, a: k === 'lowitz' ? 'e' : 's', dx: k === 'lowitz' ? -20 : 24, dy: -14 });
  return L;
}

/** 表示の投影（シェーダの SHOW_FRAG と同じ） */
export interface Proj {
  /** 0 魚眼、1 全天、2 カメラ */
  proj: 0 | 1 | 2;
  fov: number;
  az: number;
  alt: number;
  /** 画面の大きさ [px] */
  W: number;
  H: number;
}

/** 真の向き → 見かけの向き（大気差） */
export function toApparent(d: V3): V3 {
  const a = Math.asin(Math.max(-1, Math.min(1, d[2]))) / D,
    ap = apparent(a),
    h = Math.hypot(d[0], d[1]) || 1e-9;
  return [(d[0] / h) * Math.cos(ap * D), (d[1] / h) * Math.cos(ap * D), Math.sin(ap * D)];
}

/** 見かけの向き → 画面の座標 [px]（画面の外・地平線の下は null） */
export function project(p: Proj, d: V3): [number, number] | null {
  if (d[2] < 0) return null;
  const asp = p.H / p.W;
  let qx: number, qy: number;
  if (p.proj === 1) {
    const th = Math.acos(Math.max(-1, Math.min(1, d[2]))),
      R = Math.SQRT2 * Math.sin(th / 2),
      a = Math.atan2(-d[1], d[0]) - p.az * D;
    qx = -R * Math.sin(a);
    qy = -R * Math.cos(a);
  } else {
    const al = p.alt * D,
      az = p.az * D,
      f: V3 = [Math.cos(al) * Math.cos(az), -Math.cos(al) * Math.sin(az), Math.sin(al)],
      r: V3 = [-Math.sin(az), -Math.cos(az), 0],
      u: V3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]],
      cf = d[0] * f[0] + d[1] * f[1] + d[2] * f[2],
      cr = d[0] * r[0] + d[1] * r[1] + d[2] * r[2],
      cu = d[0] * u[0] + d[1] * u[1] + d[2] * u[2],
      th = Math.acos(Math.max(-1, Math.min(1, cf))),
      ph = Math.atan2(cu, cr);
    let R: number;
    if (p.proj === 0) R = Math.sin(th / 2) / Math.sin((p.fov * D) / 4);
    else {
      if (cf <= 0) return null;
      R = Math.tan(th) / Math.tan((p.fov * D) / 2);
    }
    qx = R * Math.cos(ph);
    qy = R * Math.sin(ph);
  }
  /* 全天は円が画面の短い辺に収まるように縮める（シェーダと同じ） */
  if (p.proj === 1 && asp < 1) {
    qx *= asp;
    qy *= asp;
  }
  const x = ((qx + 1) / 2) * p.W,
    y = ((1 - qy / asp) / 2) * p.H;
  if (x < 0 || x > p.W || y < 0 || y > p.H) return null;
  return [x, y];
}
