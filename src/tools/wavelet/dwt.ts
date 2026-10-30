/**
 * 離散ウェーブレット変換（DOM に依存しない）。正規直交のフィルタ（Haar・Daubechies）で、
 * 端は周期的につなぐ。1 段で近似 a（低域）と詳細 d（高域）に半分ずつ分け、a をまた分ける（Mallat の算法）
 */

export type Wav = 'haar' | 'db2' | 'db3' | 'db4';
/**
 * [値, 表示, 消える積率の数, 低域の係数 h]。係数は PyWavelets の再構成の低域（rec_lo）と同じ並び。
 * db2 は閉じた形 (1 ± √3)/(4√2)・(3 ± √3)/(4√2)
 */
export const WAVS: readonly (readonly [Wav, string, number, readonly number[]])[] = [
  ['haar', 'Haar', 1, [Math.SQRT1_2, Math.SQRT1_2]],
  [
    'db2',
    'Daubechies 2',
    2,
    [
      (1 + Math.sqrt(3)) / (4 * Math.SQRT2),
      (3 + Math.sqrt(3)) / (4 * Math.SQRT2),
      (3 - Math.sqrt(3)) / (4 * Math.SQRT2),
      (1 - Math.sqrt(3)) / (4 * Math.SQRT2),
    ],
  ],
  [
    'db3',
    'Daubechies 3',
    3,
    [
      0.33267055295008263, 0.8068915093110925, 0.45987750211849154, -0.13501102001025458, -0.08544127388202666,
      0.03522629188570953,
    ],
  ],
  [
    'db4',
    'Daubechies 4',
    4,
    [
      0.2303778133088965, 0.7148465705529157, 0.6308807679298589, -0.027983769416859854, -0.18703481171909309,
      0.030841381835560764, 0.0328830116668852, -0.010597401785069032,
    ],
  ],
];
export const wavOf = (w: Wav) => WAVS.find((x) => x[0] === w) ?? WAVS[0];

export interface Bank {
  /** 低域 h と高域 g = (−1)^n h[L−1−n] */
  h: Float64Array;
  g: Float64Array;
}
const banks = new Map<Wav, Bank>();
export function bank(w: Wav): Bank {
  const hit = banks.get(w);
  if (hit) return hit;
  const h = Float64Array.from(wavOf(w)[3]),
    L = h.length,
    g = h.map((_, n) => (n % 2 ? -1 : 1) * h[L - 1 - n]);
  const b = { h, g };
  banks.set(w, b);
  return b;
}

/** 1 段の分解: a[k] = Σ h[n] x[2k+n]、d[k] = Σ g[n] x[2k+n]（添字は長さで折り返す） */
export function analyze(x: ArrayLike<number>, w: Wav): { a: Float64Array; d: Float64Array } {
  const { h, g } = bank(w),
    N = x.length,
    M = N >> 1,
    a = new Float64Array(M),
    d = new Float64Array(M);
  for (let k = 0; k < M; k++) {
    let sa = 0,
      sd = 0;
    for (let n = 0; n < h.length; n++) {
      const v = x[(2 * k + n) % N];
      sa += h[n] * v;
      sd += g[n] * v;
    }
    a[k] = sa;
    d[k] = sd;
  }
  return { a, d };
}

/** 1 段の合成（analyze の転置。正規直交なので逆になる） */
export function synthesize(a: ArrayLike<number>, d: ArrayLike<number>, w: Wav): Float64Array {
  const { h, g } = bank(w),
    M = a.length,
    N = 2 * M,
    x = new Float64Array(N);
  for (let k = 0; k < M; k++) for (let n = 0; n < h.length; n++) x[(2 * k + n) % N] += h[n] * a[k] + g[n] * d[k];
  return x;
}

/** 多段の係数。d[0] が 1 段目（いちばん細かい）、a は最後の段の近似 */
export interface Coeffs {
  w: Wav;
  a: Float64Array;
  d: Float64Array[];
}

/** 分けられる最大の段数（各段の長さが偶数で、フィルタの長さ以上） */
export function maxLevel(N: number, w: Wav): number {
  const L = bank(w).h.length;
  let j = 0;
  while (N % 2 === 0 && N >= L && N >= 2) {
    N >>= 1;
    j++;
  }
  return j;
}

export function wavedec(x: ArrayLike<number>, w: Wav, J: number): Coeffs {
  J = Math.min(J, maxLevel(x.length, w));
  let a: ArrayLike<number> = x;
  const d: Float64Array[] = [];
  for (let j = 0; j < J; j++) {
    const r = analyze(a, w);
    d.push(r.d);
    a = r.a;
  }
  return { w, a: Float64Array.from(a), d };
}

export function waverec(c: Coeffs): Float64Array {
  let a = c.a;
  for (let j = c.d.length - 1; j >= 0; j--) a = synthesize(a, c.d[j], c.w);
  return a;
}

/**
 * 多重解像度の成分: 近似 A_J と各段の詳細 D_j を元の長さに戻したもの。和は元の信号になる。
 * 返す配列は [A_J, D_J, …, D_1]（粗い順）
 */
export function mra(c: Coeffs): Float64Array[] {
  const J = c.d.length,
    zero = (n: number) => new Float64Array(n),
    only = (keep: number): Float64Array =>
      waverec({
        w: c.w,
        a: keep === J ? c.a : zero(c.a.length),
        d: c.d.map((v, j) => (j === keep ? v : zero(v.length))),
      });
  const out = [only(J)];
  for (let j = J - 1; j >= 0; j--) out.push(only(j));
  return out;
}

/** 係数を 1 列に並べる: [a_J | d_J | … | d_1]（Mallat の並び） */
export function flat(c: Coeffs): Float64Array {
  const n = c.a.length + c.d.reduce((s, v) => s + v.length, 0),
    out = new Float64Array(n);
  out.set(c.a, 0);
  let o = c.a.length;
  for (let j = c.d.length - 1; j >= 0; j--) {
    out.set(c.d[j], o);
    o += c.d[j].length;
  }
  return out;
}

/* ---------- 係数を捨てる ---------- */

export type Shrink = 'hard' | 'soft';
/** 閾値処理: 硬い（|v| ≤ λ を 0）・柔らかい（さらに λ だけ 0 へ寄せる） */
export const shrink = (v: number, lam: number, m: Shrink): number =>
  Math.abs(v) <= lam ? 0 : m === 'hard' ? v : v - Math.sign(v) * lam;

const median = (v: ArrayLike<number>): number => {
  const s = Float64Array.from(v).sort(),
    n = s.length;
  return n === 0 ? 0 : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
/** 雑音の標準偏差の推定: いちばん細かい詳細の絶対値の中央値 / 0.6745（正規分布の |z| の中央値） */
export const sigmaMad = (d1: ArrayLike<number>): number => median(Array.from(d1, Math.abs)) / 0.6744897501960817;
/** 普遍閾値 λ = σ √(2 ln n)（Donoho・Johnstone 1994） */
export const universal = (sigma: number, n: number): number => sigma * Math.sqrt(2 * Math.log(n));

/** 詳細の係数だけを閾値処理する（近似は残す）。返すのは新しい係数と、残った係数の数 */
export function denoise(c: Coeffs, lam: number, m: Shrink): { c: Coeffs; kept: number } {
  let kept = c.a.length;
  const d = c.d.map((v) =>
    v.map((x) => {
      const y = shrink(x, lam, m);
      if (y !== 0) kept++;
      return y;
    }),
  );
  return { c: { w: c.w, a: Float64Array.from(c.a), d }, kept };
}

/**
 * 圧縮: 絶対値の大きい順に係数を keep 個だけ残す（近似も詳細も同じ扱い）。
 * 正規直交なので、捨てた係数の 2 乗和がそのまま戻した信号の誤差の 2 乗和になる
 */
export function compress(c: Coeffs, keep: number): { c: Coeffs; err2: number; energy: number } {
  const all = flat(c),
    n = all.length;
  keep = Math.max(0, Math.min(n, Math.round(keep)));
  const mags = Float64Array.from(all, Math.abs).sort(),
    /* keep 個目に大きい値。同じ値が並ぶときは先に見つけた分だけ残す */
    th = keep === 0 ? Number.POSITIVE_INFINITY : mags[n - keep];
  let left = keep,
    err2 = 0,
    energy = 0;
  const cut = (v: Float64Array) =>
    v.map((x) => {
      energy += x * x;
      if (left > 0 && Math.abs(x) >= th) {
        left--;
        return x;
      }
      err2 += x * x;
      return 0;
    });
  /* 粗い段から順に残す（同じ値なら粗い段を優先） */
  const a = cut(c.a),
    dRev = c.d.slice().reverse().map(cut);
  return { c: { w: c.w, a, d: dRev.reverse() }, err2, energy };
}

/** 2 つの信号の比 10 log10(Σx² / Σ(x − y)²)（dB） */
export function snr(x: ArrayLike<number>, y: ArrayLike<number>): number {
  let s = 0,
    e = 0;
  for (let i = 0; i < x.length; i++) {
    s += x[i] * x[i];
    e += (x[i] - y[i]) ** 2;
  }
  return 10 * Math.log10(s / Math.max(e, 1e-300));
}
