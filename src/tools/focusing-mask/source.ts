/**
 * 広がった光源（二重星・星団・画像）の像（DOM に依存しない）。像は光源の明るさの分布と
 * 点像の畳み込みで、点像は視野のどこでも同じとみなす。光源は空の上の角度で置き、カメラの画素 s 個ずつを
 * 1 画素にまとめた格子（以下「格子」）で標本にして、FFT で畳み込む
 */
import { fft2d } from './fft2';

/** 星 1 つ: 位置（rad、光軸から。y は下が正）、明るさ（主星を 1）、色温度（K） */
export interface Star {
  x: number;
  y: number;
  F: number;
  T: number;
}

/** 画像の光源: 線形 sRGB の 3 枚（各 w×h、行は上から、0〜1） */
export interface Raster {
  w: number;
  h: number;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
}

/**
 * 格子に標本にする光源の 1 色分。stars は格子の画素の座標（左上の角が 0）と重み、
 * raster は格子の画素 (i, j) の中心を画像の (u0 + (i + 0.5)du, v0 + (j + 0.5)du) に当てる
 */
export type Plane =
  | { kind: 'stars'; pts: Float64Array }
  | { kind: 'raster'; w: number; h: number; a: Float32Array; u0: number; v0: number; du: number };

/** 決まった種から作る乱数（0〜1） */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RAD_AS = Math.PI / 180 / 3600;

/** 二重星: 主星を光軸に置き、伴星を位置角 60°（上から右回り）・間隔 sep（″）に、等級差 dm で置く */
export function doubleStar(sep: number, dm: number, T1: number, T2: number): Star[] {
  const pa = (60 * Math.PI) / 180,
    r = sep * RAD_AS;
  return [
    { x: 0, y: 0, F: 1, T: T1 },
    { x: r * Math.sin(pa), y: -r * Math.cos(pa), F: 10 ** (-0.4 * dm), T: T2 },
  ];
}

/**
 * 星団: 幅 W（rad）の正方形に、中心に集まった星を n 個置く（プラマーの分布、半径 W/8）。
 * 等級は 0〜7 で暗い星ほど多く、色温度は 3500〜15000 K
 */
export function cluster(W: number, n = 90, seed = 11): Star[] {
  const R = rng(seed),
    a = W / 8,
    out: Star[] = [{ x: 0, y: 0, F: 1, T: 4500 }];
  while (out.length < n) {
    /* プラマーの分布の半径: r = a / √(u^(−2/3) − 1) */
    const u = Math.max(1e-6, R()),
      r = a / Math.sqrt(u ** (-2 / 3) - 1),
      t = 2 * Math.PI * R(),
      x = r * Math.cos(t),
      y = r * Math.sin(t);
    if (Math.abs(x) > W / 2 || Math.abs(y) > W / 2) continue;
    const m = 7 * Math.sqrt(R()),
      T = 3500 * (15000 / 3500) ** (R() ** 1.5);
    out.push({ x, y, F: 10 ** (-0.4 * m), T });
  }
  return out;
}

/** 画像の和の表（(w + 1)×(h + 1)、左上の角からの和） */
function sat(w: number, h: number, a: Float32Array): Float64Array {
  const S = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += a[y * w + x];
      S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + row;
    }
  }
  return S;
}
/** 和の表を、画像の外は 0 として連続の座標（画素の角が整数）で引く（双一次） */
function satAt(S: Float64Array, w: number, h: number, x: number, y: number): number {
  const cx = Math.max(0, Math.min(w, x)),
    cy = Math.max(0, Math.min(h, y)),
    x0 = Math.min(w - 1, Math.floor(cx)),
    y0 = Math.min(h - 1, Math.floor(cy)),
    tx = cx - x0,
    ty = cy - y0,
    W = w + 1,
    a = S[y0 * W + x0],
    b = S[y0 * W + x0 + 1],
    c = S[(y0 + 1) * W + x0],
    d = S[(y0 + 1) * W + x0 + 1];
  return (1 - ty) * ((1 - tx) * a + tx * b) + ty * ((1 - tx) * c + tx * d);
}

/**
 * 光源の 1 色分を n×n の格子に標本にする。画像は、格子の 1 画素が画像の 1 画素より大きければ面積の平均、
 * 小さければ双一次で引く（画像の外は 0）。星は双一次で 4 画素に分ける
 */
export function sample(p: Plane, n: number): Float64Array {
  const o = new Float64Array(n * n);
  if (p.kind === 'stars') {
    const q = p.pts;
    for (let k = 0; k < q.length; k += 3) {
      /* 画素の中心が整数 + 0.5 */
      const fx = q[k] - 0.5,
        fy = q[k + 1] - 0.5,
        x0 = Math.floor(fx),
        y0 = Math.floor(fy),
        tx = fx - x0,
        ty = fy - y0,
        w = q[k + 2];
      const put = (x: number, y: number, v: number) => {
        if (x >= 0 && x < n && y >= 0 && y < n) o[y * n + x] += v;
      };
      put(x0, y0, w * (1 - tx) * (1 - ty));
      put(x0 + 1, y0, w * tx * (1 - ty));
      put(x0, y0 + 1, w * (1 - tx) * ty);
      put(x0 + 1, y0 + 1, w * tx * ty);
    }
    return o;
  }
  const { w, h, a, u0, v0, du } = p;
  if (du > 1) {
    const S = sat(w, h, a),
      k = 1 / (du * du);
    for (let j = 0; j < n; j++) {
      const y0 = v0 + j * du,
        y1 = y0 + du;
      if (y1 <= 0 || y0 >= h) continue;
      for (let i = 0; i < n; i++) {
        const x0 = u0 + i * du,
          x1 = x0 + du;
        if (x1 <= 0 || x0 >= w) continue;
        o[j * n + i] =
          k * (satAt(S, w, h, x1, y1) - satAt(S, w, h, x0, y1) - satAt(S, w, h, x1, y0) + satAt(S, w, h, x0, y0));
      }
    }
    return o;
  }
  const px = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : a[y * w + x]);
  for (let j = 0; j < n; j++) {
    const fy = v0 + (j + 0.5) * du - 0.5,
      y0 = Math.floor(fy),
      ty = fy - y0;
    if (y0 < -1 || y0 >= h) continue;
    for (let i = 0; i < n; i++) {
      const fx = u0 + (i + 0.5) * du - 0.5,
        x0 = Math.floor(fx),
        tx = fx - x0;
      if (x0 < -1 || x0 >= w) continue;
      o[j * n + i] =
        (1 - ty) * ((1 - tx) * px(x0, y0) + tx * px(x0 + 1, y0)) +
        ty * ((1 - tx) * px(x0, y0 + 1) + tx * px(x0 + 1, y0 + 1));
    }
  }
  return o;
}

/** 2 の累乗に切り上げる */
const pow2 = (v: number) => 2 ** Math.ceil(Math.log2(v));

/** 作業用の配列（大きさごとに使い回す） */
let work: { L: number; re: Float64Array; im: Float64Array } | null = null;

/**
 * 光源 o（(R + nk)×(R + nk)）と核 K（nk×nk、光軸は画素 (nk/2, nk/2) の角）を畳み込み、R×R を返す。
 * 出力の画素 i には光源の画素 i + nk/2 の光が中心に来る。光源と核を 1 つの複素数の場 o + iK にまとめて
 * 変換し、エルミート対称から 2 つの変換を取り出して掛ける
 */
export function convolve(o: Float64Array, K: Float64Array, nk: number, R: number): Float64Array {
  const n = R + nk,
    L = pow2(n),
    h = nk / 2;
  if (work?.L !== L) work = { L, re: new Float64Array(L * L), im: new Float64Array(L * L) };
  const { re, im } = work;
  re.fill(0);
  im.fill(0);
  for (let y = 0; y < n; y++) re.set(o.subarray(y * n, y * n + n), y * L);
  for (let y = 0; y < nk; y++)
    for (let x = 0; x < nk; x++) im[((y - h + L) % L) * L + ((x - h + L) % L)] = K[y * nk + x];
  fft2d(L, re, im);
  /* Z = A + iB（A・B は実数の場の変換）: A[k] = (Z[k] + Z*[−k]) / 2、B[k] = (Z[k] − Z*[−k]) / 2i */
  for (let y = 0; y < L; y++) {
    const y2 = (L - y) % L;
    for (let x = 0; x < L; x++) {
      const i = y * L + x,
        j = y2 * L + ((L - x) % L);
      if (j < i) continue;
      const zr = re[i],
        zi = im[i],
        wr = re[j],
        wi = im[j],
        ar = (zr + wr) / 2,
        ai = (zi - wi) / 2,
        br = (zi + wi) / 2,
        bi = -(zr - wr) / 2,
        pr = ar * br - ai * bi,
        pi = ar * bi + ai * br;
      /* 実数の場どうしの積の変換もエルミート対称: P[−k] = P*[k] */
      re[i] = pr;
      im[i] = pi;
      re[j] = pr;
      im[j] = -pi;
    }
  }
  fft2d(L, re, im, true);
  const out = new Float64Array(R * R);
  for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) out[y * R + x] = Math.max(0, re[(y + h) * L + x + h]);
  return out;
}
