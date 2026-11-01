/**
 * ベイヤー配列のデモザイク。1 画素 1 色の値（モザイク）から全画素の RGB を復元する。
 * 値は 0〜1 の浮動小数で、画像の端は 1 画素目を軸に折り返す（色の並びの偶奇が保たれる）。
 */

/** 3 枚の色の面（0〜1） */
export interface Rgb {
  w: number;
  h: number;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
}
/** 色の番号。0 = R、1 = G、2 = B */
export type Ch = 0 | 1 | 2;
/** 2 × 2 の並び。左上・右上・左下・右下の順 */
export type Pattern = 'RGGB' | 'GRBG' | 'GBRG' | 'BGGR';
export const PATTERNS: readonly Pattern[] = ['RGGB', 'GRBG', 'GBRG', 'BGGR'];

/** モザイク。v は画素の値、c はその画素のフィルタの色 */
export interface Mosaic {
  w: number;
  h: number;
  v: Float32Array;
  c: Uint8Array;
  pat: Pattern;
}

export type Method = 'nearest' | 'bilinear' | 'mhc' | 'ha' | 'vng' | 'ahd';
export const METHODS: readonly Method[] = ['nearest', 'bilinear', 'mhc', 'ha', 'vng', 'ahd'];

const CH: Record<string, Ch> = { R: 0, G: 1, B: 2 };

/** 並び pat で (x, y) のフィルタの色 */
export function cfaColor(pat: Pattern, x: number, y: number): Ch {
  return CH[pat[((y & 1) << 1) | (x & 1)]];
}

export function newRgb(w: number, h: number): Rgb {
  return { w, h, r: new Float32Array(w * h), g: new Float32Array(w * h), b: new Float32Array(w * h) };
}
const planes = (im: Rgb): [Float32Array, Float32Array, Float32Array] => [im.r, im.g, im.b];

/** 画像をフィルタに通して 1 画素 1 色にする */
export function mosaic(im: Rgb, pat: Pattern): Mosaic {
  const { w, h } = im,
    p = planes(im),
    v = new Float32Array(w * h),
    c = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x,
        k = cfaColor(pat, x, y);
      c[i] = k;
      v[i] = p[k][i];
    }
  return { w, h, v, c, pat };
}

/** 端の外の座標を、端の画素を軸に折り返す（-1 → 1、n → n - 2） */
export function reflect(i: number, n: number): number {
  if (n === 1) return 0;
  for (;;) {
    if (i < 0) i = -i;
    else if (i >= n) i = 2 * n - 2 - i;
    else return i;
  }
}

/** 折り返しの座標表。-pad〜n-1+pad を 0〜n-1 へ */
function reflTable(n: number, pad: number): Int32Array {
  const t = new Int32Array(n + 2 * pad);
  for (let i = 0; i < t.length; i++) t[i] = reflect(i - pad, n);
  return t;
}
const PAD = 3;

/** モザイクの値と色を周りへ延ばした読み出し */
function reader(m: Mosaic) {
  const xs = reflTable(m.w, PAD),
    ys = reflTable(m.h, PAD);
  const at = (x: number, y: number) => ys[y + PAD] * m.w + xs[x + PAD];
  return {
    at,
    v: (x: number, y: number) => m.v[at(x, y)],
    c: (x: number, y: number) => m.c[at(x, y)],
  };
}

const clamp01 = (a: number) => (a < 0 ? 0 : a > 1 ? 1 : a);
function clampRgb(o: Rgb): Rgb {
  for (const p of planes(o)) for (let i = 0; i < p.length; i++) p[i] = clamp01(p[i]);
  return o;
}

/* ---------- 最近傍 ---------- */

/** 同じ 2 × 2 の区画にある色をそのまま写す。G は自分か、同じ行の G */
export function nearest(m: Mosaic): Rgb {
  const { w, h } = m,
    o = newRgb(w, h),
    p = planes(o),
    rd = reader(m);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x,
        bx = x & ~1,
        by = y & ~1,
        own = m.c[i];
      for (let k = 0; k < 3; k++) {
        if (k === own) {
          p[k][i] = m.v[i];
          continue;
        }
        let val = 0;
        if (k === 1) {
          /* 同じ行の相手の G */
          val = rd.v(x ^ 1, y);
        } else {
          for (let j = 0; j < 4; j++) {
            const xx = bx + (j & 1),
              yy = by + (j >> 1);
            if (rd.c(xx, yy) === k) {
              val = rd.v(xx, yy);
              break;
            }
          }
        }
        p[k][i] = val;
      }
    }
  return o;
}

/* ---------- バイリニア ---------- */

/** 3 × 3 の中にある同じ色の値の平均（ベイヤーでは縦横 2 つ・4 つ、斜め 4 つ） */
export function bilinear(m: Mosaic): Rgb {
  const { w, h } = m,
    o = newRgb(w, h),
    p = planes(o),
    rd = reader(m);
  const s = [0, 0, 0],
    n = [0, 0, 0];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x,
        own = m.c[i];
      s[0] = s[1] = s[2] = n[0] = n[1] = n[2] = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const k = rd.c(x + dx, y + dy);
          s[k] += rd.v(x + dx, y + dy);
          n[k]++;
        }
      for (let k = 0; k < 3; k++) p[k][i] = k === own ? m.v[i] : n[k] ? s[k] / n[k] : 0;
    }
  return o;
}

/* ---------- Malvar-He-Cutler ---------- */

/** 5 × 5 の係数（8 倍した値）。Malvar ら 2004 の図 2 */
export type MhcKernel = 'g' | 'row' | 'col' | 'diag';
export const MHC: Record<MhcKernel, readonly number[]> = {
  /** R・B の画素での G */
  g: [0, 0, -1, 0, 0, 0, 0, 2, 0, 0, -1, 2, 4, 2, -1, 0, 0, 2, 0, 0, 0, 0, -1, 0, 0],
  /** G の画素で、左右にある色 */
  row: [0, 0, 0.5, 0, 0, 0, -1, 0, -1, 0, -1, 4, 5, 4, -1, 0, -1, 0, -1, 0, 0, 0, 0.5, 0, 0],
  /** G の画素で、上下にある色 */
  col: [0, 0, -1, 0, 0, 0, -1, 4, -1, 0, 0.5, 0, 5, 0, 0.5, 0, -1, 4, -1, 0, 0, 0, -1, 0, 0],
  /** R の画素での B、B の画素での R */
  diag: [0, 0, -1.5, 0, 0, 0, 2, 0, 2, 0, -1.5, 0, 6, 0, -1.5, 0, 2, 0, 2, 0, 0, 0, -1.5, 0, 0],
};

/** 画素 (x, y) で色 k を求める MHC の係数の名前（自分の色なら null） */
export function mhcKernel(m: Mosaic, x: number, y: number, k: Ch): MhcKernel | null {
  const own = cfaColor(m.pat, x, y);
  if (own === k) return null;
  if (k === 1) return 'g';
  if (own !== 1) return 'diag';
  return cfaColor(m.pat, x + 1, y) === k ? 'row' : 'col';
}

export function mhc(m: Mosaic): Rgb {
  const { w, h } = m,
    o = newRgb(w, h),
    p = planes(o),
    rd = reader(m);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      for (let k = 0; k < 3; k++) {
        const kn = mhcKernel(m, x, y, k as Ch);
        if (!kn) {
          p[k][i] = m.v[i];
          continue;
        }
        const c = MHC[kn];
        let s = 0;
        for (let j = 0; j < 25; j++) if (c[j]) s += c[j] * rd.v(x + (j % 5) - 2, y + ((j / 5) | 0) - 2);
        p[k][i] = s / 8;
      }
    }
  return clampRgb(o);
}

/* ---------- 色差の補間（G を埋めたあとの R・B） ---------- */

/**
 * G がすべて埋まったあと、R − G・B − G を近くの同じ色の画素から平均して R・B を埋める。
 * diag が null なら斜めの 4 つを平均し、関数なら画素ごとに 2 つの斜めのどちらを使うかを返させる
 */
function fillChroma(
  m: Mosaic,
  g: Float32Array,
  o: Rgb,
  diag: ((x: number, y: number, k: Ch) => 'ne' | 'nw' | 'both') | null,
): void {
  const { w, h } = m,
    p = planes(o),
    rd = reader(m);
  const gv = (x: number, y: number) => g[rd.at(x, y)];
  const dif = (x: number, y: number) => rd.v(x, y) - gv(x, y);
  o.g.set(g);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x,
        own = m.c[i];
      for (const k of [0, 2] as const) {
        if (k === own) {
          p[k][i] = m.v[i];
          continue;
        }
        let d: number;
        if (own === 1) {
          /* G の画素: 左右か上下の 2 つ */
          d = rd.c(x + 1, y) === k ? (dif(x - 1, y) + dif(x + 1, y)) / 2 : (dif(x, y - 1) + dif(x, y + 1)) / 2;
        } else {
          const dir = diag ? diag(x, y, k) : 'both';
          const ne = (dif(x + 1, y - 1) + dif(x - 1, y + 1)) / 2,
            nw = (dif(x - 1, y - 1) + dif(x + 1, y + 1)) / 2;
          d = dir === 'ne' ? ne : dir === 'nw' ? nw : (ne + nw) / 2;
        }
        p[k][i] = g[i] + d;
      }
    }
}

/* ---------- Hamilton-Adams ---------- */

/** 画素 (x, y)（R か B）での横・縦の勾配。Hamilton と Adams の特許の式 */
export function haGrad(m: Mosaic, x: number, y: number): { h: number; v: number } {
  const rd = reader(m),
    v = rd.v;
  const c0 = 2 * v(x, y);
  return {
    h: Math.abs(v(x - 1, y) - v(x + 1, y)) + Math.abs(c0 - v(x - 2, y) - v(x + 2, y)),
    v: Math.abs(v(x, y - 1) - v(x, y + 1)) + Math.abs(c0 - v(x, y - 2) - v(x, y + 2)),
  };
}

/** Hamilton-Adams の G。勾配の小さい向きに、隣の G の平均と 2 次の差の補正 */
function haGreen(m: Mosaic): { g: Float32Array; dir: Uint8Array } {
  const { w, h } = m,
    g = new Float32Array(w * h),
    dir = new Uint8Array(w * h),
    rd = reader(m),
    v = rd.v;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (m.c[i] === 1) {
        g[i] = m.v[i];
        continue;
      }
      const c0 = 2 * m.v[i];
      const gh = (v(x - 1, y) + v(x + 1, y)) / 2 + (c0 - v(x - 2, y) - v(x + 2, y)) / 4;
      const gv = (v(x, y - 1) + v(x, y + 1)) / 2 + (c0 - v(x, y - 2) - v(x, y + 2)) / 4;
      const dh = Math.abs(v(x - 1, y) - v(x + 1, y)) + Math.abs(c0 - v(x - 2, y) - v(x + 2, y));
      const dv = Math.abs(v(x, y - 1) - v(x, y + 1)) + Math.abs(c0 - v(x, y - 2) - v(x, y + 2));
      /* 1 = 横、2 = 縦、3 = 両方の平均 */
      if (dh < dv) {
        g[i] = gh;
        dir[i] = 1;
      } else if (dh > dv) {
        g[i] = gv;
        dir[i] = 2;
      } else {
        g[i] = (gh + gv) / 2;
        dir[i] = 3;
      }
    }
  return { g, dir };
}

export function ha(m: Mosaic): Rgb {
  const o = newRgb(m.w, m.h),
    { g } = haGreen(m),
    rd = reader(m);
  const gv = (x: number, y: number) => g[rd.at(x, y)];
  /* R・B の画素での反対の色は、斜めの勾配（色の差と G の 2 次の差）の小さい向き */
  fillChroma(m, g, o, (x, y) => {
    const g0 = 2 * gv(x, y);
    const dne = Math.abs(rd.v(x + 1, y - 1) - rd.v(x - 1, y + 1)) + Math.abs(g0 - gv(x + 1, y - 1) - gv(x - 1, y + 1));
    const dnw = Math.abs(rd.v(x - 1, y - 1) - rd.v(x + 1, y + 1)) + Math.abs(g0 - gv(x - 1, y - 1) - gv(x + 1, y + 1));
    return dne < dnw ? 'ne' : dne > dnw ? 'nw' : 'both';
  });
  return clampRgb(o);
}

/** 画素ごとに Hamilton-Adams が選んだ向き（0 = G の画素、1 = 横、2 = 縦、3 = 平均） */
export function haDirections(m: Mosaic): Uint8Array {
  return haGreen(m).dir;
}

/* ---------- VNG ---------- */

/** 8 方向の名前と向き（dy, dx）。N から時計回り */
export const DIRS = [
  ['N', -1, 0],
  ['NE', -1, 1],
  ['E', 0, 1],
  ['SE', 1, 1],
  ['S', 1, 0],
  ['SW', 1, -1],
  ['W', 0, -1],
  ['NW', -1, -1],
] as const;

/** 勾配の項 [y1, x1, y2, x2, 重み]。N と NE の形を 90° ずつ回して 8 方向にする */
type Term = readonly [number, number, number, number, number];
const N_TERMS: Term[] = [
  [-1, 0, 1, 0, 1],
  [-2, 0, 0, 0, 1],
  [-1, -1, 1, -1, 0.5],
  [-1, 1, 1, 1, 0.5],
  [-2, -1, 0, -1, 0.5],
  [-2, 1, 0, 1, 0.5],
];
/** R・B の画素の NE。中央の斜めの線の 2 組と、隣の斜めの線の G の 4 組 */
const NE_RB: Term[] = [
  [-1, 1, 1, -1, 1],
  [-2, 2, 0, 0, 1],
  [-1, 0, 0, -1, 0.5],
  [0, 1, 1, 0, 0.5],
  [-2, 1, -1, 0, 0.5],
  [-1, 2, 0, 1, 0.5],
];
/** G の画素の NE。隣の斜めの線では 2 画素離れた同じ色の組 */
const NE_G: Term[] = [
  [-1, 1, 1, -1, 1],
  [-2, 2, 0, 0, 1],
  [-1, 0, 1, -2, 0.5],
  [-2, 1, 0, -1, 0.5],
  [-1, 2, 1, 0, 0.5],
  [0, 1, 2, -1, 0.5],
];
/** (y, x) を時計回りに 90° 回す（N → E） */
const rot = (t: Term): Term => [t[1], -t[0], t[3], -t[2], t[4]];
function rotations(base: Term[]): Term[][] {
  const out = [base];
  for (let i = 1; i < 4; i++) out.push(out[i - 1].map(rot));
  return out;
}
const ORTHO = rotations(N_TERMS),
  DIAG_RB = rotations(NE_RB),
  DIAG_G = rotations(NE_G);
/** 方向 d（DIRS の番号）の項 */
function vngTerms(d: number, ownG: boolean): Term[] {
  return d % 2 === 0 ? ORTHO[d / 2] : (ownG ? DIAG_G : DIAG_RB)[(d - 1) / 2];
}

/** 閾値 T = k1 · 最小 + k2 · (最大 − 最小)（Chang ら 1999） */
export const VNG_K1 = 1.5;
export const VNG_K2 = 0.5;

export interface VngInfo {
  /** 8 方向の勾配 */
  grad: number[];
  /** 閾値 */
  t: number;
  /** 選ばれた方向（DIRS の番号） */
  sel: number[];
  /** 求めた R・G・B */
  rgb: [number, number, number];
}

/** 1 画素の VNG。勾配・閾値・選んだ方向も返す */
export function vngPixel(m: Mosaic, x: number, y: number, rd = reader(m)): VngInfo {
  const own = rd.c(x, y),
    v0 = rd.v(x, y);
  const grad: number[] = [];
  for (let d = 0; d < 8; d++) {
    let s = 0;
    for (const [y1, x1, y2, x2, wt] of vngTerms(d, own === 1))
      s += wt * Math.abs(rd.v(x + x1, y + y1) - rd.v(x + x2, y + y2));
    grad.push(s);
  }
  let mn = Infinity,
    mx = -Infinity;
  for (const g of grad) {
    if (g < mn) mn = g;
    if (g > mx) mx = g;
  }
  const t = VNG_K1 * mn + VNG_K2 * (mx - mn);
  const sel: number[] = [];
  const sum = [0, 0, 0];
  for (let d = 0; d < 8; d++) {
    if (grad[d] > t) continue;
    sel.push(d);
    /* 方向の側の 3 × 3 の区画の、色ごとの平均 */
    const [, dy, dx] = DIRS[d];
    const s = [0, 0, 0],
      n = [0, 0, 0];
    for (let yy = -1; yy <= 1; yy++)
      for (let xx = -1; xx <= 1; xx++) {
        const px = x + dx + xx,
          py = y + dy + yy,
          k = rd.c(px, py);
        s[k] += rd.v(px, py);
        n[k]++;
      }
    for (let k = 0; k < 3; k++) sum[k] += s[k] / n[k];
  }
  const rgb: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 3; k++) rgb[k] = k === own ? v0 : v0 + (sum[k] - sum[own]) / sel.length;
  return { grad, t, sel, rgb };
}

export function vng(m: Mosaic): Rgb {
  const { w, h, v, c } = m,
    o = newRgb(w, h),
    p = planes(o),
    rd = reader(m);
  /* 端から 3 画素より内側は、添字のずれを前もって計算した速い道で同じ計算をする */
  const tOff = [0, 1].map((g) =>
    Array.from({ length: 8 }, (_, d) =>
      vngTerms(d, g === 1).map(([y1, x1, y2, x2, wt]) => [y1 * w + x1, y2 * w + x2, wt]),
    ),
  );
  const rOff = DIRS.map(([, dy, dx]) => {
    const a: number[] = [];
    for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) a.push((dy + yy) * w + dx + xx);
    return a;
  });
  const grad = new Float64Array(8),
    sum = new Float64Array(3),
    s = new Float64Array(3),
    n = new Float64Array(3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x < 3 || y < 3 || x >= w - 3 || y >= h - 3) {
        const { rgb } = vngPixel(m, x, y, rd);
        p[0][i] = rgb[0];
        p[1][i] = rgb[1];
        p[2][i] = rgb[2];
        continue;
      }
      const own = c[i],
        terms = tOff[own === 1 ? 1 : 0];
      let mn = Infinity,
        mx = -Infinity;
      for (let d = 0; d < 8; d++) {
        let g = 0;
        for (const t of terms[d]) g += t[2] * Math.abs(v[i + t[0]] - v[i + t[1]]);
        grad[d] = g;
        if (g < mn) mn = g;
        if (g > mx) mx = g;
      }
      const th = VNG_K1 * mn + VNG_K2 * (mx - mn);
      sum[0] = sum[1] = sum[2] = 0;
      let cnt = 0;
      for (let d = 0; d < 8; d++) {
        if (grad[d] > th) continue;
        cnt++;
        s[0] = s[1] = s[2] = n[0] = n[1] = n[2] = 0;
        for (const off of rOff[d]) {
          const k = c[i + off];
          s[k] += v[i + off];
          n[k]++;
        }
        for (let k = 0; k < 3; k++) sum[k] += s[k] / n[k];
      }
      const v0 = v[i];
      for (let k = 0; k < 3; k++) p[k][i] = k === own ? v0 : v0 + (sum[k] - sum[own]) / cnt;
    }
  return clampRgb(o);
}

/* ---------- AHD ---------- */

/** sRGB の値（0〜1）から CIELAB（D65） */
export function srgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lin = (u: number) => (u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4);
  const R = lin(clamp01(r)),
    G = lin(clamp01(g)),
    B = lin(clamp01(b));
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047,
    Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B,
    Z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f(X),
    fy = f(Y),
    fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labPlanes(o: Rgb): [Float32Array, Float32Array, Float32Array] {
  const n = o.w * o.h,
    L = new Float32Array(n),
    A = new Float32Array(n),
    B = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const [l, a, b] = srgbToLab(o.r[i], o.g[i], o.b[i]);
    L[i] = l;
    A[i] = a;
    B[i] = b;
  }
  return [L, A, B];
}

/** 横（axis 0）か縦（axis 1）だけで補間した G。隣の 2 つの G の間に収める */
function dirGreen(m: Mosaic, axis: 0 | 1): Float32Array {
  const { w, h } = m,
    g = new Float32Array(w * h),
    rd = reader(m),
    v = rd.v;
  const ax = axis === 0 ? 1 : 0,
    ay = axis === 0 ? 0 : 1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (m.c[i] === 1) {
        g[i] = m.v[i];
        continue;
      }
      const a = v(x - ax, y - ay),
        b = v(x + ax, y + ay);
      const e = (a + b) / 2 + (2 * m.v[i] - v(x - 2 * ax, y - 2 * ay) - v(x + 2 * ax, y + 2 * ay)) / 4;
      g[i] = Math.min(Math.max(e, Math.min(a, b)), Math.max(a, b));
    }
  return g;
}

export interface AhdInfo {
  /** 横・縦で補間した 2 枚 */
  h: Rgb;
  v: Rgb;
  /** 3 × 3 で足した均質さ */
  hh: Float32Array;
  hv: Float32Array;
  /** 選んだ向き（1 = 横、2 = 縦、3 = 平均） */
  dir: Uint8Array;
}

/** AHD の途中経過（Hirakawa と Parks 2005） */
export function ahdSteps(m: Mosaic): AhdInfo {
  const { w, h } = m,
    n = w * h;
  const imH = newRgb(w, h),
    imV = newRgb(w, h);
  fillChroma(m, dirGreen(m, 0), imH, null);
  fillChroma(m, dirGreen(m, 1), imV, null);
  clampRgb(imH);
  clampRgb(imV);
  const lh = labPlanes(imH),
    lv = labPlanes(imV);
  const xs = reflTable(w, 1),
    ys = reflTable(h, 1);
  const at = (x: number, y: number) => ys[y + 1] * w + xs[x + 1];
  const dL = (P: Float32Array[], i: number, j: number) => Math.abs(P[0][i] - P[0][j]);
  const dC = (P: Float32Array[], i: number, j: number) => Math.hypot(P[1][i] - P[1][j], P[2][i] - P[2][j]);
  const homH = new Uint8Array(n),
    homV = new Uint8Array(n);
  const NB = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const l = at(x - 1, y),
        r = at(x + 1, y),
        u = at(x, y - 1),
        d = at(x, y + 1);
      /* 許す差は、横の画像の左右の差と縦の画像の上下の差の、それぞれ大きい方の小さい方 */
      const eL = Math.min(Math.max(dL(lh, i, l), dL(lh, i, r)), Math.max(dL(lv, i, u), dL(lv, i, d)));
      const eC = Math.min(Math.max(dC(lh, i, l), dC(lh, i, r)), Math.max(dC(lv, i, u), dC(lv, i, d)));
      let a = 0,
        b = 0;
      for (const [dx, dy] of NB) {
        const j = at(x + dx, y + dy);
        if (dL(lh, i, j) <= eL && dC(lh, i, j) <= eC) a++;
        if (dL(lv, i, j) <= eL && dC(lv, i, j) <= eC) b++;
      }
      homH[i] = a;
      homV[i] = b;
    }
  const hh = new Float32Array(n),
    hv = new Float32Array(n),
    dir = new Uint8Array(n);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let a = 0,
        b = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const j = at(x + dx, y + dy);
          a += homH[j];
          b += homV[j];
        }
      const i = y * w + x;
      hh[i] = a;
      hv[i] = b;
      dir[i] = a > b ? 1 : a < b ? 2 : 3;
    }
  return { h: imH, v: imV, hh, hv, dir };
}

export function ahd(m: Mosaic): Rgb {
  const s = ahdSteps(m),
    o = newRgb(m.w, m.h),
    p = planes(o),
    ph = planes(s.h),
    pv = planes(s.v);
  for (let i = 0; i < m.w * m.h; i++)
    for (let k = 0; k < 3; k++)
      p[k][i] = s.dir[i] === 1 ? ph[k][i] : s.dir[i] === 2 ? pv[k][i] : (ph[k][i] + pv[k][i]) / 2;
  return o;
}

/* ---------- 色差のメディアン（後処理） ---------- */

/**
 * R − G と B − G に 3 × 3 のメディアンをかけ、測った色はそのままに残りの 2 色を作り直す（Freeman の方法）。
 * times 回くり返す
 */
export function medianChroma(m: Mosaic, im: Rgb, times = 1): Rgb {
  const { w, h } = im,
    n = w * h;
  let cur = im;
  const xs = reflTable(w, 1),
    ys = reflTable(h, 1);
  const buf = new Float32Array(9);
  const med = (src: Float32Array, x: number, y: number) => {
    let k = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) buf[k++] = src[ys[y + dy + 1] * w + xs[x + dx + 1]];
    buf.sort();
    return buf[4];
  };
  for (let t = 0; t < times; t++) {
    const rg = new Float32Array(n),
      bg = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      rg[i] = cur.r[i] - cur.g[i];
      bg[i] = cur.b[i] - cur.g[i];
    }
    const o = newRgb(w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x,
          a = med(rg, x, y),
          b = med(bg, x, y),
          v = m.v[i];
        if (m.c[i] === 1) {
          o.g[i] = v;
          o.r[i] = v + a;
          o.b[i] = v + b;
        } else if (m.c[i] === 0) {
          o.r[i] = v;
          o.g[i] = v - a;
          o.b[i] = v - a + b;
        } else {
          o.b[i] = v;
          o.g[i] = v - b;
          o.r[i] = v - b + a;
        }
      }
    cur = clampRgb(o);
  }
  return cur;
}

export function demosaic(m: Mosaic, method: Method): Rgb {
  switch (method) {
    case 'nearest':
      return nearest(m);
    case 'bilinear':
      return clampRgb(bilinear(m));
    case 'mhc':
      return mhc(m);
    case 'ha':
      return ha(m);
    case 'vng':
      return vng(m);
    case 'ahd':
      return ahd(m);
  }
}

/* ---------- 光学ローパスフィルタ ---------- */

/** 色ごとに標準偏差 sigma（画素）のガウスでぼかす。センサーの前の光学ローパスフィルタの代わり */
export function blur(im: Rgb, sigma: number): Rgb {
  if (sigma <= 0) return im;
  const rad = Math.max(1, Math.ceil(3 * sigma)),
    k = new Float32Array(2 * rad + 1);
  let s = 0;
  for (let i = -rad; i <= rad; i++) s += k[i + rad] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const { w, h } = im,
    o = newRgb(w, h),
    xs = reflTable(w, rad),
    ys = reflTable(h, rad),
    tmp = new Float32Array(w * h);
  const src = planes(im),
    dst = planes(o);
  for (let c = 0; c < 3; c++) {
    const a = src[c],
      b = dst[c];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let v = 0;
        for (let j = 0; j < k.length; j++) v += k[j] * a[y * w + xs[x + j]];
        tmp[y * w + x] = v;
      }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let v = 0;
        for (let j = 0; j < k.length; j++) v += k[j] * tmp[ys[y + j] * w + x];
        b[y * w + x] = v;
      }
  }
  return o;
}

/* ---------- 誤差の指標 ---------- */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Score {
  /** 色ごとの PSNR（dB） */
  psnr: [number, number, number];
  /** 3 色まとめた PSNR（dB） */
  cpsnr: number;
  /** CIELAB の色差 ΔE*ab の平均 */
  de: number;
  /** ΔE*ab が 10 を超えた画素の割合 */
  bad: number;
}

/** 誤差の指標。rect の外と、画像の端から border 画素は数えない */
export function score(ref: Rgb, out: Rgb, border = 4, rect?: Rect): Score {
  const { w, h } = ref;
  const x0 = Math.max(border, rect?.x ?? 0),
    y0 = Math.max(border, rect?.y ?? 0),
    x1 = Math.min(w - border, rect ? rect.x + rect.w : w),
    y1 = Math.min(h - border, rect ? rect.y + rect.h : h);
  const se = [0, 0, 0];
  let n = 0,
    de = 0,
    bad = 0;
  const a = planes(ref),
    b = planes(out);
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = y * w + x;
      for (let k = 0; k < 3; k++) se[k] += (a[k][i] - b[k][i]) ** 2;
      const l1 = srgbToLab(a[0][i], a[1][i], a[2][i]),
        l2 = srgbToLab(b[0][i], b[1][i], b[2][i]);
      const e = Math.hypot(l1[0] - l2[0], l1[1] - l2[1], l1[2] - l2[2]);
      de += e;
      if (e > 10) bad++;
      n++;
    }
  const db = (mse: number) => (mse > 0 ? 10 * Math.log10(1 / mse) : Infinity);
  return {
    psnr: [db(se[0] / n), db(se[1] / n), db(se[2] / n)],
    cpsnr: db((se[0] + se[1] + se[2]) / (3 * n)),
    de: de / n,
    bad: bad / n,
  };
}

/** 画素ごとの ΔE*ab */
export function deltaE(ref: Rgb, out: Rgb): Float32Array {
  const n = ref.w * ref.h,
    e = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const l1 = srgbToLab(ref.r[i], ref.g[i], ref.b[i]),
      l2 = srgbToLab(out.r[i], out.g[i], out.b[i]);
    e[i] = Math.hypot(l1[0] - l2[0], l1[1] - l2[1], l1[2] - l2[2]);
  }
  return e;
}
