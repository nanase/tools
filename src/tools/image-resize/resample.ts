/**
 * 画像の拡大縮小の計算。フィルタの手法は 1 軸ごとに重みの表を作り、横 → 縦の順に重み付きの和をとる。
 * ドット絵向けの手法は窓の周りの元の画素を切り出し、色の一致の規則で 2・3 倍をくり返す
 */

export type Px = Uint8ClampedArray<ArrayBuffer>;

export interface Img {
  w: number;
  h: number;
  /** RGBA */
  d: Px;
  /** RGB の実数（0〜1）。[sRGB のまま, リニア RGB]。初めて使うときに作る */
  f: [Float32Array | null, Float32Array | null];
}
export const mkImg = (w: number, h: number, d: Px): Img => ({ w, h, d, f: [null, null] });

/** 出力の座標の窓 */
export interface Win {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Opt {
  /** 縮小時のアンチエイリアス（カーネルを 1/倍率 に広げる）。既定はオン */
  aa?: boolean;
  /** リニア RGB で計算する */
  lin?: boolean;
}
export type Pix = 's2' | 's3' | 'e';
export type Group = 'f' | 'p';
export interface Method {
  id: string;
  /** 画面の名前 */
  n: string;
  g: Group;
  /** 手法の説明（チップの title） */
  t: string;
  /** カーネル（フィルタの手法） */
  k: (x: number) => number;
  /** カーネルの半径（元の画素の間隔） */
  r: number;
  /** ドット絵向けの規則 */
  pix?: Pix;
}

const sinc = (x: number): number => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
/** Mitchell-Netravali の 3 次のカーネル */
export const cubic =
  (B: number, C: number) =>
  (x: number): number => {
    const a = Math.abs(x);
    if (a < 1) return ((12 - 9 * B - 6 * C) * a ** 3 + (-18 + 12 * B + 6 * C) * a * a + (6 - 2 * B)) / 6;
    if (a < 2)
      return ((-B - 6 * C) * a ** 3 + (6 * B + 30 * C) * a * a + (-12 * B - 48 * C) * a + (8 * B + 24 * C)) / 6;
    return 0;
  };
const lanczos =
  (a: number) =>
  (x: number): number =>
    Math.abs(x) < a ? sinc(x) * sinc(x / a) : 0;
const rect = (x: number): number => (x >= -0.5 && x < 0.5 ? 1 : 0);
const none = (): number => 0;

export const METHODS: readonly Method[] = [
  { id: 'nearest', n: '最近傍', g: 'f', t: '最も近い 1 画素を写す', k: rect, r: 0.5 },
  {
    id: 'box',
    n: '平均画素法',
    g: 'f',
    t: '出力の画素に重なる元の画素を面積で平均',
    k: rect,
    r: 0.5,
  },
  {
    id: 'bilinear',
    n: 'バイリニア',
    g: 'f',
    t: '周りの 4 画素を距離で平均',
    k: (x) => Math.max(0, 1 - Math.abs(x)),
    r: 1,
  },
  {
    id: 'bspline',
    n: 'B スプライン',
    g: 'f',
    t: '3 次の B スプライン（B = 1、C = 0）',
    k: cubic(1, 0),
    r: 2,
  },
  {
    id: 'mitchell',
    n: 'Mitchell',
    g: 'f',
    t: 'Mitchell-Netravali（B = C = 1/3）',
    k: cubic(1 / 3, 1 / 3),
    r: 2,
  },
  {
    id: 'catrom',
    n: 'Catmull-Rom',
    g: 'f',
    t: 'Catmull-Rom（B = 0、C = 1/2）',
    k: cubic(0, 0.5),
    r: 2,
  },
  { id: 'lanczos2', n: 'Lanczos2', g: 'f', t: '窓付き sinc（a = 2）', k: lanczos(2), r: 2 },
  { id: 'lanczos3', n: 'Lanczos3', g: 'f', t: '窓付き sinc（a = 3）', k: lanczos(3), r: 3 },
  {
    id: 'scale2x',
    n: 'Scale2x',
    g: 'p',
    t: '色の一致の規則で 2 倍をくり返す。拡大だけ',
    k: none,
    r: 0,
    pix: 's2',
  },
  {
    id: 'scale3x',
    n: 'Scale3x',
    g: 'p',
    t: '色の一致の規則で 3 倍をくり返す。拡大だけ',
    k: none,
    r: 0,
    pix: 's3',
  },
  {
    id: 'eagle',
    n: 'Eagle',
    g: 'p',
    t: '斜めの 3 画素が同じ色なら角を塗る。拡大だけ',
    k: none,
    r: 0,
    pix: 'e',
  },
];
/** 縮小の PSNR の基準 */
const REF: Method = { id: 'ref', n: '基準', g: 'f', t: '', k: lanczos(8), r: 8 };
const NEAREST = METHODS[0];
const BOX = METHODS[1];
export const methodOf = (id: string): Method => METHODS.find((m) => m.id === id) ?? NEAREST;

const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
const ENC = new Uint8Array(4097);
for (let i = 0; i <= 4096; i++) {
  const v = i / 4096;
  ENC[i] = Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
}

function floats(img: Img, lin: 0 | 1): Float32Array {
  const c = img.f[lin];
  if (c) return c;
  const n = img.w * img.h,
    a = new Float32Array(n * 3);
  for (let p = 0; p < n; p++)
    for (let k = 0; k < 3; k++) {
      const v = img.d[p * 4 + k];
      a[p * 3 + k] = lin ? LIN[v] : v / 255;
    }
  img.f[lin] = a;
  return a;
}

export const outSize = (img: { w: number; h: number }, s: number): [number, number] => [
  Math.max(1, Math.round(img.w * s)),
  Math.max(1, Math.round(img.h * s)),
];

/** 1 軸の重みの表。出力 i の重みは st[i] から st[i + 1] の手前まで */
export interface Axis {
  st: Int32Array;
  ix: Int32Array;
  wt: Float32Array;
}
/** 長さ n の元の軸を倍率 s にしたときの、出力の位置 o0 から len 個の重み。端の外は端の画素を使う */
export function axis(n: number, s: number, m: Method, o0: number, len: number, aa: boolean): Axis {
  const st = new Int32Array(len + 1),
    ix: number[] = [],
    wt: number[] = [],
    at = (j: number): number => Math.min(n - 1, Math.max(0, j));
  for (let i = 0; i < len; i++) {
    st[i] = ix.length;
    const o = o0 + i,
      i0 = ix.length;
    let sum = 0;
    if (m.id === 'nearest') {
      ix.push(at(Math.floor((o + 0.5) / s)));
      wt.push(1);
      continue;
    }
    if (m.id === 'box') {
      /* 出力の画素と元の画素の重なりの長さ */
      const a = o / s,
        b = (o + 1) / s;
      for (let j = Math.floor(a); j < b; j++) {
        const w = Math.min(b, j + 1) - Math.max(a, j);
        if (w <= 1e-9) continue;
        ix.push(at(j));
        wt.push(w);
        sum += w;
      }
    } else {
      const c = (o + 0.5) / s - 0.5,
        fs = aa && s < 1 ? 1 / s : 1,
        R = m.r * fs;
      for (let j = Math.ceil(c - R); j <= Math.floor(c + R); j++) {
        const w = m.k((j - c) / fs);
        if (w === 0) continue;
        ix.push(at(j));
        wt.push(w);
        sum += w;
      }
    }
    for (let q = i0; q < ix.length; q++) wt[q] /= sum;
  }
  st[len] = ix.length;
  return { st, ix: Int32Array.from(ix), wt: Float32Array.from(wt) };
}

/** 窓 win の中の出力を RGBA で返す。win は出力の大きさの中に収める */
export function resample(img: Img, s: number, m: Method, win: Win, opt: Opt = {}): Px {
  const aa = opt.aa !== false,
    lin = opt.lin ? 1 : 0;
  if (m.pix) return s > 1 ? pixArt(img, s, m.pix, win) : resample(img, s, NEAREST, win, opt);
  const f = floats(img, lin),
    W = img.w,
    ax = axis(W, s, m, win.x, win.w, aa),
    ay = axis(img.h, s, m, win.y, win.h, aa);
  let y0 = img.h,
    y1 = 0;
  for (const v of ay.ix) {
    if (v < y0) y0 = v;
    if (v > y1) y1 = v;
  }
  const rows = y1 - y0 + 1,
    w3 = win.w * 3,
    tmp = new Float32Array(rows * w3);
  for (let y = 0; y < rows; y++) {
    const base = (y + y0) * W * 3,
      to = y * w3;
    for (let x = 0; x < win.w; x++) {
      let r = 0,
        g = 0,
        b = 0;
      for (let q = ax.st[x]; q < ax.st[x + 1]; q++) {
        const p = base + ax.ix[q] * 3,
          w = ax.wt[q];
        r += f[p] * w;
        g += f[p + 1] * w;
        b += f[p + 2] * w;
      }
      tmp[to + x * 3] = r;
      tmp[to + x * 3 + 1] = g;
      tmp[to + x * 3 + 2] = b;
    }
  }
  const out = new Uint8ClampedArray(win.w * win.h * 4);
  for (let y = 0; y < win.h; y++) {
    const a = ay.st[y],
      e = ay.st[y + 1];
    for (let x = 0; x < w3; x++) {
      let v = 0;
      for (let q = a; q < e; q++) v += tmp[(ay.ix[q] - y0) * w3 + x] * ay.wt[q];
      v = v < 0 ? 0 : v > 1 ? 1 : v;
      /* Uint8ClampedArray が最も近い整数に丸める */
      out[(y * win.w + ((x / 3) | 0)) * 4 + (x % 3)] = lin ? ENC[(v * 4096 + 0.5) | 0] : v * 255;
    }
    for (let x = 0; x < win.w; x++) out[(y * win.w + x) * 4 + 3] = 255;
  }
  return out;
}

/** 端の外は端の画素 */
const reader =
  (w: number, h: number, a: Uint32Array) =>
  (x: number, y: number): number =>
    a[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];

/** Scale2x（EPX）か Eagle の 1 回の 2 倍 */
export function step2x(w: number, h: number, a: Uint32Array, eagle: boolean): Uint32Array<ArrayBuffer> {
  const o = new Uint32Array(w * h * 4),
    at = reader(w, h, a);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const B = at(x, y - 1),
        D = at(x - 1, y),
        E = at(x, y),
        F = at(x + 1, y),
        H = at(x, y + 1);
      let e0 = E,
        e1 = E,
        e2 = E,
        e3 = E;
      if (eagle) {
        const A = at(x - 1, y - 1),
          C = at(x + 1, y - 1),
          G = at(x - 1, y + 1),
          I = at(x + 1, y + 1);
        if (D === A && A === B) e0 = A;
        if (B === C && C === F) e1 = C;
        if (D === G && G === H) e2 = G;
        if (F === I && I === H) e3 = I;
      } else if (B !== H && D !== F) {
        if (D === B) e0 = D;
        if (B === F) e1 = F;
        if (D === H) e2 = D;
        if (H === F) e3 = F;
      }
      const p = y * 2 * (w * 2) + x * 2;
      o[p] = e0;
      o[p + 1] = e1;
      o[p + w * 2] = e2;
      o[p + w * 2 + 1] = e3;
    }
  return o;
}

/** Scale3x の 1 回の 3 倍 */
export function step3x(w: number, h: number, a: Uint32Array): Uint32Array<ArrayBuffer> {
  const o = new Uint32Array(w * h * 9),
    at = reader(w, h, a);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const A = at(x - 1, y - 1),
        B = at(x, y - 1),
        C = at(x + 1, y - 1),
        D = at(x - 1, y),
        E = at(x, y),
        F = at(x + 1, y),
        G = at(x - 1, y + 1),
        H = at(x, y + 1),
        I = at(x + 1, y + 1),
        e = [E, E, E, E, E, E, E, E, E];
      if (B !== H && D !== F) {
        if (D === B) e[0] = D;
        if ((D === B && E !== C) || (B === F && E !== A)) e[1] = B;
        if (B === F) e[2] = F;
        if ((D === B && E !== G) || (D === H && E !== A)) e[3] = D;
        if ((B === F && E !== I) || (H === F && E !== C)) e[5] = F;
        if (D === H) e[6] = D;
        if ((D === H && E !== I) || (H === F && E !== G)) e[7] = H;
        if (H === F) e[8] = F;
      }
      for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) o[(y * 3 + j) * (w * 3) + x * 3 + i] = e[j * 3 + i];
    }
  return o;
}

function pixArt(img: Img, s: number, pix: Pix, win: Win): Px {
  /* 倍率以上になるまでくり返し、最後は最も近い画素を写す */
  const seq = pix === 's3' ? (s <= 3 ? [3] : s <= 6 ? [3, 2] : [3, 3]) : s <= 2 ? [2] : s <= 4 ? [2, 2] : [2, 2, 2],
    F = seq.reduce((a, b) => a * b, 1),
    x0 = Math.max(0, Math.floor(win.x / s) - 3),
    y0 = Math.max(0, Math.floor(win.y / s) - 3),
    x1 = Math.min(img.w, Math.ceil((win.x + win.w) / s) + 3),
    y1 = Math.min(img.h, Math.ceil((win.y + win.h) / s) + 3);
  let w = x1 - x0,
    h = y1 - y0,
    a = new Uint32Array(w * h);
  const src = new Uint32Array(img.d.buffer, img.d.byteOffset, img.w * img.h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = src[(y + y0) * img.w + x + x0];
  for (const k of seq) {
    a = k === 3 ? step3x(w, h, a) : step2x(w, h, a, pix === 'e');
    w *= k;
    h *= k;
  }
  const out = new Uint32Array(win.w * win.h);
  for (let y = 0; y < win.h; y++) {
    /* 窓によらず同じ画素を選ぶよう、元の画像全体の座標で丸める */
    const sy = Math.min(h - 1, Math.floor(((y + win.y + 0.5) * F) / s + 1e-9) - y0 * F);
    for (let x = 0; x < win.w; x++) {
      const sx = Math.min(w - 1, Math.floor(((x + win.x + 0.5) * F) / s + 1e-9) - x0 * F);
      out[y * win.w + x] = a[sy * w + sx];
    }
  }
  return new Uint8ClampedArray(out.buffer);
}

export function cropImg(img: Img, x: number, y: number, w: number, h: number): Img {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let j = 0; j < h; j++)
    d.set(img.d.subarray(((j + y) * img.w + x) * 4, ((j + y) * img.w + x + w) * 4), j * w * 4);
  return mkImg(w, h, d);
}

export function psnrOf(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let e = 0,
    n = 0;
  for (let i = 0; i < a.length; i += 4)
    for (let c = 0; c < 3; c++) {
      const v = a[i + c] - b[i + c];
      e += v * v;
      n++;
    }
  return e === 0 ? Infinity : 10 * Math.log10((255 * 255 * n) / e);
}

/** PSNR を計算する範囲（中央）の上限 */
const CROP_W = 240;
const CROP_H = 180;
const cache = new Map<string, number | null>();
/**
 * 正解との PSNR [dB]。1 倍では null。
 * 拡大: 平均画素法で 1/s に縮めた画像を s 倍に戻し、元の画像と比べる。
 * 縮小: アンチエイリアスありの Lanczos8 の結果を基準にして比べる
 */
export function metric(key: string, img: Img, s: number, m: Method, opt: Opt = {}): number | null {
  const k = `${key}|${s.toFixed(3)}|${m.id}|${opt.aa !== false ? 1 : 0}|${opt.lin ? 1 : 0}`,
    hit = cache.get(k);
  if (hit !== undefined) return hit;
  let v: number | null = null;
  if (Math.abs(s - 1) > 1e-3) {
    const cw = Math.min(img.w, CROP_W),
      ch = Math.min(img.h, CROP_H),
      crop = cropImg(img, (img.w - cw) >> 1, (img.h - ch) >> 1, cw, ch);
    if (s > 1) {
      const [lw, lh] = outSize(crop, 1 / s),
        low = mkImg(lw, lh, resample(crop, 1 / s, BOX, { x: 0, y: 0, w: lw, h: lh })),
        win = { x: 0, y: 0, w: Math.min(cw, Math.round(lw * s)), h: Math.min(ch, Math.round(lh * s)) };
      v = psnrOf(resample(low, s, m, win, opt), cropImg(crop, 0, 0, win.w, win.h).d);
    } else {
      const [w, h] = outSize(crop, s),
        win = { x: 0, y: 0, w, h };
      v = psnrOf(resample(crop, s, m, win, opt), resample(crop, s, REF, win, { aa: true, lin: opt.lin }));
    }
  }
  if (cache.size > 4000) cache.clear();
  cache.set(k, v);
  return v;
}
