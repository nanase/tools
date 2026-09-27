/**
 * プリント基板のうずまきコイルの計算（DOM に依存しない）: 形と係数、内径・充填率、うずまきの中心線と長さ、
 * インダクタンスの 3 式、直流・交流抵抗、Q、共振容量、E24 の近い値
 */
import { eList, nearIdx } from '../../lib/eseries';

export type ShapeId = 'sq' | 'hex' | 'oct' | 'cir';

export interface Shape {
  v: ShapeId;
  /** 表示名 */
  ab: string;
  /** 表示窓のステータスバー */
  en: string;
  /** 辺の数。円は 0 */
  k: number;
  /** 修正 Wheeler 式の K1・K2（Mohan らの表 I）。円は係数なし */
  K: readonly [number, number] | null;
  /** 電流シート近似の c1〜c4（表 II） */
  c: readonly [number, number, number, number];
  /** 単項式近似の β・α1〜α5（表 III）。円は係数なし */
  m: readonly [number, number, number, number, number, number] | null;
}

export const SHAPES: readonly Shape[] = [
  {
    v: 'sq',
    ab: '正方形',
    en: 'SQUARE',
    k: 4,
    K: [2.34, 2.75],
    c: [1.27, 2.07, 0.18, 0.13],
    m: [1.62e-3, -1.21, -0.147, 2.4, 1.78, -0.03],
  },
  {
    v: 'hex',
    ab: '六角形',
    en: 'HEXAGON',
    k: 6,
    K: [2.33, 3.82],
    c: [1.09, 2.23, 0.0, 0.17],
    m: [1.28e-3, -1.24, -0.174, 2.47, 1.77, -0.049],
  },
  {
    v: 'oct',
    ab: '八角形',
    en: 'OCTAGON',
    k: 8,
    K: [2.25, 3.55],
    c: [1.07, 2.29, 0.0, 0.19],
    m: [1.33e-3, -1.21, -0.163, 2.43, 1.75, -0.049],
  },
  { v: 'cir', ab: '円形', en: 'CIRCLE', k: 0, K: null, c: [1.0, 2.46, 0.0, 0.2], m: null },
];
export const shapeOf = (v: string): Shape => SHAPES.find((s) => s.v === v) ?? SHAPES[0];

/** 真空の透磁率 [H/m] */
export const MU0 = 1.25663706212e-6;
/** 銅の抵抗率 [Ω·m]（IEC 60028、20 °C） */
export const RHO_CU = 1.7241e-8;
/** 光速 [m/s] */
export const C0 = 299792458;
/** 巻数の上限 */
export const NMAX = 60;

/** 内径（単位は入力と同じ） */
export const dIn = (n: number, d: number, w: number, s: number): number => d - 2 * n * w - 2 * (n - 1) * s;

/** 内径が正で残る最大の巻数（幾何だけの上限） */
export function nGeo(d: number, w: number, s: number): number {
  let n = Math.floor((d + 2 * s) / (2 * (w + s))) + 1;
  while (n > 1 && dIn(n, d, w, s) <= d * 1e-9) n--;
  return n;
}
/** 巻数の上限（幾何と NMAX の小さいほう） */
export const nMax = (d: number, w: number, s: number): number => Math.min(NMAX, nGeo(d, w, s));

export type Pt = readonly [number, number];

/**
 * うずまきの中心線（y は上向き、外側の端から内側へ）。a0 は外側の巻線の中心線までの距離、p は巻線の間隔（w + s）。
 * 多角形: 辺 j は面の向き 90° − j·360°/k、中心からの距離は a0 − ⌊j/k⌋·p。隣り合う辺の交点を頂点にするので、
 * どの向きでも巻線は p 間隔で n 本並ぶ（内径は式どおり）。
 * 円: アルキメデスのらせん r = a0 − p·θ/2π（1 周で p ずつ内側へ寄る）を 1 周 180 点の折れ線で近似する
 */
export function spiral(k: number, n: number, a0: number, p: number): Pt[] {
  const pts: Pt[] = [];
  if (k) {
    const st = (2 * Math.PI) / k;
    const line = (j: number): [number, number, number] => {
      const g = Math.PI / 2 - j * st;
      return [Math.cos(g), Math.sin(g), j < 0 ? a0 : a0 - Math.floor(j / k) * p];
    };
    const cross = (A: [number, number, number], B: [number, number, number]): Pt => {
      const det = A[0] * B[1] - A[1] * B[0];
      return [(A[2] * B[1] - B[2] * A[1]) / det, (A[0] * B[2] - B[0] * A[2]) / det];
    };
    for (let j = -1; j < k * n; j++) pts.push(cross(line(j), line(j + 1)));
  } else {
    const M = 180;
    for (let i = 0; i <= M * n; i++) {
      const tu = i / M,
        r = a0 - p * tu,
        g = Math.PI / 2 - tu * 2 * Math.PI;
      pts.push([r * Math.cos(g), r * Math.sin(g)]);
    }
  }
  return pts;
}

/** 折れ線の長さ */
export function polyLen(P: readonly Pt[]): number {
  let l = 0;
  for (let i = 1; i < P.length; i++) l += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
  return l;
}

/** 入力（画面の単位: 長さは mm、銅箔の厚さは µm） */
export interface Dims {
  n: number;
  dout: number;
  w: number;
  s: number;
  t: number;
}

/** 周波数で決まる量 */
export interface Ac {
  f: number;
  /** 表皮の深さ [m] */
  dl: number;
  /** 実効厚さ [m] */
  teff: number;
  /** 交流抵抗 [Ω] */
  rac: number;
  q: number;
  /** 共振容量 [F] */
  c: number;
  /** 帯域幅 f/Q [Hz] */
  bw: number;
}

/** 計算結果（SI 単位） */
export interface Coil extends Ac {
  n: number;
  d: number;
  w: number;
  s: number;
  t: number;
  din: number;
  davg: number;
  /** 充填率 */
  rho: number;
  /** 電流シート近似（主値） */
  L: number;
  /** 修正 Wheeler 式（円は NaN） */
  Lmw: number;
  /** 単項式近似（円は NaN） */
  Lmn: number;
  /** 配線の長さ（中心線） */
  len: number;
  rdc: number;
}

/** 周波数 f での表皮の深さ・実効厚さ（Yue と Wong）・交流抵抗・Q・共振容量・帯域幅 */
export function ac(f: number, L: number, len: number, w: number, t: number): Ac {
  const dl = Math.sqrt(RHO_CU / (Math.PI * f * MU0)),
    teff = dl * (1 - Math.exp(-t / dl));
  const rac = (RHO_CU * len) / (w * teff),
    q = (2 * Math.PI * f * L) / rac;
  return { f, dl, teff, rac, q, c: 1 / ((2 * Math.PI * f) ** 2 * L), bw: f / q };
}

export function calc(sh: Shape, x: Dims, f: number): Coil {
  const { n } = x,
    d = x.dout * 1e-3,
    w = x.w * 1e-3,
    s = x.s * 1e-3,
    t = x.t * 1e-6;
  const din = dIn(n, d, w, s),
    davg = (d + din) / 2,
    rho = (d - din) / (d + din);
  const [c1, c2, c3, c4] = sh.c;
  const L = ((MU0 * n * n * davg * c1) / 2) * (Math.log(c2 / rho) + c3 * rho + c4 * rho * rho);
  const Lmw = sh.K ? (sh.K[0] * MU0 * n * n * davg) / (1 + sh.K[1] * rho) : NaN;
  /* 単項式近似は長さを µm、結果を nH で表す */
  const m = sh.m,
    Lmn = m
      ? m[0] * (d * 1e6) ** m[1] * (w * 1e6) ** m[2] * (davg * 1e6) ** m[3] * n ** m[4] * (s * 1e6) ** m[5] * 1e-9
      : NaN;
  const len = polyLen(spiral(sh.k, n, d / 2 - w / 2, w + s));
  const rdc = (RHO_CU * len) / (w * t);
  return { n, d, w, s, t, din, davg, rho, L, Lmw, Lmn, len, rdc, ...ac(f, L, len, w, t) };
}

/** E24 で最も近い値（対数で測る） */
export function nearE24(v: number): number {
  const L = eList(24, v / 10, v * 10);
  return L[nearIdx(L, v, true)];
}

/** 共振周波数 1/(2π√(LC)) */
export const fRes = (L: number, C: number): number => 1 / (2 * Math.PI * Math.sqrt(L * C));

/** 表皮の深さが銅箔の厚さ t [m] と等しくなる周波数 */
export const fSkin = (t: number): number => RHO_CU / (Math.PI * MU0 * t * t);

/** 配線の長さ len [m] が波長の 1/10 になる周波数 */
export const fTenth = (len: number): number => C0 / (10 * len);
