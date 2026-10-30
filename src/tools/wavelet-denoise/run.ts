/**
 * 音を処理する流れ（DOM に依存しない）。雑音除去（閾値の規則・σ の推定・硬い／柔らかい・ずらして平均）と、
 * 同じ数の係数を残す圧縮（ウェーブレット・DCT・DFT・MDCT）。聴き比べる音と数値を返す
 */
import { type Coeffs, maxLevel, type Shrink, snr, type Wav, wavedec, waverec } from '../wavelet/dwt';
import { bits, dequantize, keepAbove, kth, quantize } from './code';
import { dct, idct, imdct, irdft, mdct, rdft } from './fourier';
import { apply, plan, type Rule, type SigmaMode } from './thresh';

/** 2 の累乗の長さへ（0 で埋める） */
const pow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));

/* ---------- ウェーブレットの係数を 1 列に ---------- */

/** x を 2^J の倍数まで 0 で埋めて J 段に分ける */
export function dec(x: ArrayLike<number>, w: Wav, J: number): Coeffs {
  const step = 2 ** J,
    N = Math.ceil(x.length / step) * step,
    buf = new Float64Array(N);
  buf.set(x);
  return wavedec(buf, w, Math.min(J, maxLevel(N, w)));
}

/** [a_J | d_J | … | d_1] の 1 列から係数へ（dwt の flat の逆） */
export function unflat(f: Float64Array, w: Wav, N: number, J: number): Coeffs {
  const a = f.slice(0, N >> J),
    d: Float64Array[] = [];
  let o = N >> J;
  for (let j = J; j >= 1; j--) {
    const n = N >> j;
    d[j - 1] = f.slice(o, o + n);
    o += n;
  }
  return { w, a, d };
}
const flatOf = (c: Coeffs): Float64Array => {
  const n = c.d.reduce((s, v) => s + v.length, c.a.length),
    out = new Float64Array(n);
  out.set(c.a);
  let o = c.a.length;
  for (let j = c.d.length - 1; j >= 0; j--) {
    out.set(c.d[j], o);
    o += c.d[j].length;
  }
  return out;
};

/* ---------- 雑音除去 ---------- */

export interface DnOpts {
  w: Wav;
  J: number;
  rule: Rule;
  sm: SigmaMode;
  m: Shrink;
  /** λ に掛ける倍率 */
  k: number;
  /** ずらして平均する回数（1 でずらさない。Coifman・Donoho の cycle spinning） */
  spin: number;
  /** 雑音だけの区間（標本の番号）。sm が quiet のとき使う */
  quiet?: readonly [number, number];
}

export interface DnOut {
  y: Float32Array;
  /** ずらさないときの係数（表示用）と、段ごとの σ・λ */
  c: Coeffs;
  sig: Float64Array;
  lam: Float64Array;
  /** 残した係数の数・全体の数（ずらさないとき） */
  kept: number;
  total: number;
}

export function denoiseAudio(x: Float32Array, o: DnOpts): DnOut {
  const n = x.length,
    acc = new Float64Array(n),
    S = Math.max(1, Math.round(o.spin));
  let first: Omit<DnOut, 'y'> | null = null;
  for (let s = 0; s < S; s++) {
    /* s 点だけ左へ回してから処理し、戻した後に右へ回す */
    const xs = s ? Float64Array.from({ length: n }, (_, i) => x[(i + s) % n]) : x,
      c = dec(xs, o.w, o.J),
      p = plan(c, o.rule, o.sm, o.k, o.quiet && [o.quiet[0] - s, o.quiet[1] - s]),
      r = apply(c, p.lam, o.m),
      y = waverec(r.c);
    for (let i = 0; i < n; i++) acc[(i + s) % n] += y[i];
    if (!s) first = { c, sig: p.sig, lam: p.lam, kept: r.kept, total: y.length };
  }
  if (!first) throw new Error('spin');
  return { y: Float32Array.from(acc, (v) => v / S), ...first };
}

/* ---------- 圧縮 ---------- */

export type Basis = 'wav' | 'dct' | 'dft' | 'mdct';
export const BASES: readonly (readonly [Basis, string])[] = [
  ['wav', 'ウェーブレット'],
  ['dct', 'DCT'],
  ['dft', 'DFT'],
  ['mdct', 'MDCT'],
];
/** MDCT の枠の半分（2048 点の枠を 1024 点ずつずらす） */
export const MDCT_M = 1024;

/** 係数の 1 列と、そこから音へ戻す関数 */
export function forward(
  x: Float32Array,
  b: Basis,
  w: Wav = 'db4',
  J = 8,
): [Float64Array, (c: Float64Array) => Float64Array] {
  const n = x.length;
  if (b === 'wav') {
    const c = dec(x, w, J),
      N = c.a.length << c.d.length,
      L = c.d.length;
    return [flatOf(c), (f) => waverec(unflat(f, w, N, L))];
  }
  if (b === 'mdct') return [mdct(x, MDCT_M), (f) => imdct(f, MDCT_M, n)];
  const buf = new Float64Array(pow2(n));
  buf.set(x);
  return b === 'dct' ? [dct(buf), idct] : [rdft(buf), irdft];
}

export interface CpOut {
  /** 量子化して戻した音（ビット数はこの音のもの） */
  y: Float32Array;
  /** 量子化せず、大きい順に残しただけで戻した音 */
  yk: Float32Array;
  /** 残す境（= 量子化の幅 Δ） */
  step: number;
  /** 残した係数の数・係数の全体の数 */
  kept: number;
  total: number;
  /** 量子化した係数（表示用） */
  q: Int32Array;
  /** ビット数の見積もり（位置・値） */
  pos: number;
  val: number;
}

/** 信号の長さ n の keep 倍の個数だけ係数を残し、残す境を幅にして量子化する */
export function compressAudio(x: Float32Array, b: Basis, keep: number, w: Wav = 'db4', J = 8): CpOut {
  const n = x.length,
    [c, inv] = forward(x, b, w, J),
    K = Math.max(1, Math.round(keep * n)),
    /* 全部残すときも幅は 0 にしない */
    step = Math.max(kth(c, K), 1e-9),
    ck = Float64Array.from(c),
    kept = keepAbove(ck, step),
    q = quantize(c, step),
    bt = bits(q),
    y = inv(dequantize(q, step)),
    yk = inv(ck);
  return {
    y: Float32Array.from(y.subarray(0, n)),
    yk: Float32Array.from(yk.subarray(0, n)),
    step,
    kept,
    total: c.length,
    q,
    pos: bt.pos,
    val: bt.val,
  };
}

/** 2 つの音の差（a − b） */
export const diff = (a: Float32Array, b: Float32Array): Float32Array => Float32Array.from(a, (v, i) => v - b[i]);

export { snr };
