/**
 * 画像の畳み込みのページの計算（DOM に依存しない）: 画像と核の畳み込み、核の見本、分離できる核の速い計算、
 * 窓の中の積の内訳、表示用の値の変換。画像は 0〜1 の灰色を行の順に並べた Float32Array で持つ
 */

export interface Img {
  w: number;
  h: number;
  v: Float32Array;
}
/** 核: 大きさは奇数、中心が原点。v は行の順 */
export interface Kernel {
  w: number;
  h: number;
  v: Float32Array;
}
/** 画像の外の扱い: 0・端の値をのばす・折り返す（鏡）・反対側から回す */
export type Edge = 'zero' | 'clamp' | 'mirror' | 'wrap';

/** 画像の外の座標を中へ（zero は −1 を返す） */
function idx(i: number, n: number, e: Edge): number {
  if (i >= 0 && i < n) return i;
  switch (e) {
    case 'zero':
      return -1;
    case 'clamp':
      return i < 0 ? 0 : n - 1;
    case 'wrap':
      return ((i % n) + n) % n;
    case 'mirror': {
      /* 端の画素を重ねない鏡（… 2 1 0 | 0 1 2 …） */
      const p = 2 * n;
      let j = ((i % p) + p) % p;
      if (j >= n) j = p - 1 - j;
      return j;
    }
  }
}

/**
 * 畳み込み y[r, c] = Σ_k Σ_j h[k, j]·x[r − k, c − j]（Smith の式 24-3 を、核の中心を原点にして）。
 * corr を真にすると核を 180° 回さない相互相関（Goodfellow ほかの式 9.6）。出力は入力と同じ大きさ
 */
export function conv2(x: Img, k: Kernel, edge: Edge = 'clamp', corr = false): Img {
  const { w: W, h: H } = x,
    out = new Float32Array(W * H),
    cx = (k.w - 1) / 2,
    cy = (k.h - 1) / 2;
  /* 核の 0 でない要素だけを (dy, dx, 重み) で並べる。畳み込みでは x[r − dy, c − dx] を読む */
  const taps: number[] = [];
  for (let j = 0; j < k.h; j++)
    for (let i = 0; i < k.w; i++) {
      const g = k.v[j * k.w + i];
      if (g === 0) continue;
      const dy = j - cy,
        dx = i - cx;
      taps.push(corr ? dy : -dy, corr ? dx : -dx, g);
    }
  const T = taps.length / 3,
    xi = new Int32Array(W),
    yi = new Int32Array(H);
  for (let t = 0; t < T; t++) {
    const dy = taps[3 * t],
      dx = taps[3 * t + 1],
      g = taps[3 * t + 2];
    for (let c = 0; c < W; c++) xi[c] = idx(c + dx, W, edge);
    for (let r = 0; r < H; r++) yi[r] = idx(r + dy, H, edge);
    for (let r = 0; r < H; r++) {
      const rr = yi[r];
      if (rr < 0) continue;
      const o = r * W,
        s = rr * W;
      for (let c = 0; c < W; c++) {
        const cc = xi[c];
        if (cc >= 0) out[o + c] += g * x.v[s + cc];
      }
    }
  }
  return { w: W, h: H, v: out };
}

/** 窓の中の内訳: 出力の画素 (r, c) に足される h·x の各項（核の並びのまま）と、その和 */
export function terms(x: Img, k: Kernel, r: number, c: number, edge: Edge = 'clamp', corr = false) {
  const cx = (k.w - 1) / 2,
    cy = (k.h - 1) / 2,
    xs = new Float32Array(k.w * k.h),
    ps = new Float32Array(k.w * k.h);
  let s = 0;
  for (let j = 0; j < k.h; j++)
    for (let i = 0; i < k.w; i++) {
      const dy = j - cy,
        dx = i - cx,
        rr = idx(r + (corr ? dy : -dy), x.h, edge),
        cc = idx(c + (corr ? dx : -dx), x.w, edge),
        xv = rr < 0 || cc < 0 ? 0 : x.v[rr * x.w + cc],
        n = j * k.w + i;
      xs[n] = xv;
      ps[n] = xv * k.v[n];
      s += ps[n];
    }
  return { xs, ps, sum: s };
}

/** 分離できる核（縦 a と横 b の外積）は、横に 1 次元の畳み込みをしてから縦にすると同じ結果を速く出せる（Smith の式 24-1） */
export function conv2sep(x: Img, a: Float32Array, b: Float32Array, edge: Edge = 'clamp'): Img {
  const mid = conv2(x, { w: b.length, h: 1, v: b }, edge);
  return conv2(mid, { w: 1, h: a.length, v: a }, edge);
}

/** 外積の核 a[j]·b[i] */
export function outer(a: ArrayLike<number>, b: ArrayLike<number>): Kernel {
  const v = new Float32Array(a.length * b.length);
  for (let j = 0; j < a.length; j++) for (let i = 0; i < b.length; i++) v[j * b.length + i] = a[j] * b[i];
  return { w: b.length, h: a.length, v };
}

/** 標準偏差 s の正規分布を ±3s（奇数の長さ）で標本化し、和を 1 にした 1 次元の核 */
export function gauss1(s: number): Float32Array {
  const R = Math.max(1, Math.ceil(3 * s)),
    v = new Float32Array(2 * R + 1);
  let t = 0;
  for (let i = -R; i <= R; i++) t += v[i + R] = Math.exp(-(i * i) / (2 * s * s));
  for (let i = 0; i < v.length; i++) v[i] /= t;
  return v;
}
/** 2 項係数の核（n + 1 個、和 1）。n を増やすと正規分布に近づく（中心極限定理） */
export function binom1(n: number): Float32Array {
  const v = new Float32Array(n + 1);
  v[0] = 1;
  for (let k = 1; k <= n; k++) for (let i = k; i > 0; i--) v[i] += v[i - 1];
  const t = 2 ** n;
  for (let i = 0; i <= n; i++) v[i] /= t;
  return v;
}

const K = (w: number, h: number, a: readonly number[]): Kernel => ({ w, h, v: Float32Array.from(a) });

export type KernelName =
  | 'id'
  | 'box'
  | 'gauss'
  | 'motion'
  | 'sharpen'
  | 'edge'
  | 'laplace'
  | 'sobelx'
  | 'sobely'
  | 'emboss'
  | 'shift';
/**
 * 核の見本。n は大きさ（ぼかしの幅）、s はガウスの標準偏差、kk は鮮鋭化の強さ。
 * - id・edge・sharpen・emboss は Smith の図 24-4（デルタ関数・エッジ検出・エッジ強調・ずらして引く）
 * - sobelx・sobely は Sobel の 3×3 の勾配の演算子（x は右が明るいと正）
 */
export function kernel(name: KernelName, n = 5, s = 1.2, kk = 1): Kernel {
  switch (name) {
    case 'id':
      return K(3, 3, [0, 0, 0, 0, 1, 0, 0, 0, 0]);
    case 'box': {
      const m = n | 1;
      return { w: m, h: m, v: new Float32Array(m * m).fill(1 / (m * m)) };
    }
    case 'gauss': {
      const g = gauss1(s);
      return outer(g, g);
    }
    case 'motion': {
      /* 横に n 画素ぶれる */
      const m = n | 1;
      return { w: m, h: 1, v: new Float32Array(m).fill(1 / m) };
    }
    case 'edge':
      return K(3, 3, [-1 / 8, -1 / 8, -1 / 8, -1 / 8, 1, -1 / 8, -1 / 8, -1 / 8, -1 / 8]);
    case 'sharpen': {
      const e = -kk / 8;
      return K(3, 3, [e, e, e, e, kk + 1, e, e, e, e]);
    }
    case 'laplace':
      return K(3, 3, [0, 1, 0, 1, -4, 1, 0, 1, 0]);
    case 'sobelx':
      /* 畳み込みで「右 − 左」になるよう、相関の形 [−1 0 1] を左右に裏返して持つ */
      return K(3, 3, [1, 0, -1, 2, 0, -2, 1, 0, -1]);
    case 'sobely':
      return K(3, 3, [1, 2, 1, 0, 0, 0, -1, -2, -1]);
    case 'emboss':
      return K(3, 3, [0, 0, 0, 0, 1, 0, 0, 0, -1]);
    case 'shift':
      /* 右へ 2 画素ずらす（畳み込みでは核の 1 の位置へ画像が動く） */
      return K(5, 1, [0, 0, 0, 0, 1]);
  }
}

/** 核の和（1 なら明るさを保つ、0 なら平らな所が 0 になる） */
export const ksum = (k: Kernel): number => k.v.reduce((a, b) => a + b, 0);

/** 核が分離できるか（階数 1 か）。できれば縦と横の 1 次元の核を返す */
export function separate(k: Kernel, tol = 1e-6): { a: Float32Array; b: Float32Array } | null {
  /* 絶対値の最大の要素の行と列を基準にする */
  let m = 0,
    mi = 0;
  for (let i = 0; i < k.v.length; i++)
    if (Math.abs(k.v[i]) > Math.abs(m)) {
      m = k.v[i];
      mi = i;
    }
  if (m === 0) return null;
  const r0 = Math.floor(mi / k.w),
    c0 = mi % k.w,
    a = new Float32Array(k.h),
    b = new Float32Array(k.w);
  for (let j = 0; j < k.h; j++) a[j] = k.v[j * k.w + c0] / m;
  for (let i = 0; i < k.w; i++) b[i] = k.v[r0 * k.w + i];
  for (let j = 0; j < k.h; j++)
    for (let i = 0; i < k.w; i++) if (Math.abs(a[j] * b[i] - k.v[j * k.w + i]) > tol * Math.abs(m)) return null;
  return { a, b };
}

/** 勾配の大きさ √(gx² + gy²)（Sobel の 2 つの畳み込みを合わせる。この合わせ方は畳み込みではない） */
export function gradMag(gx: Img, gy: Img): Img {
  const v = new Float32Array(gx.v.length);
  for (let i = 0; i < v.length; i++) v[i] = Math.hypot(gx.v[i], gy.v[i]);
  return { w: gx.w, h: gx.h, v };
}

/** 表示の変換: そのまま（0〜1 で切る）・0 を灰色にした符号付き（±g で端）・絶対値 */
export type Show = 'clip' | 'signed' | 'abs';
export function toRGBA(x: Img, show: Show, g = 1, out?: Uint8ClampedArray): Uint8ClampedArray {
  const d = out ?? new Uint8ClampedArray(x.w * x.h * 4);
  for (let i = 0; i < x.v.length; i++) {
    const v = x.v[i],
      u = show === 'clip' ? v : show === 'abs' ? Math.abs(v) / g : 0.5 + v / (2 * g),
      b = Math.round(Math.min(1, Math.max(0, u)) * 255);
    d[4 * i] = d[4 * i + 1] = d[4 * i + 2] = b;
    d[4 * i + 3] = 255;
  }
  return d;
}

/** RGBA の画素から灰色（Rec. 709 の重み、ガンマはそのまま） */
export function fromRGBA(d: ArrayLike<number>, w: number, h: number): Img {
  const v = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) v[i] = (0.2126 * d[4 * i] + 0.7152 * d[4 * i + 1] + 0.0722 * d[4 * i + 2]) / 255;
  return { w, h, v };
}
