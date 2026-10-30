/**
 * 基数 2 の FFT を段ごとに記録する（DOM に依存しない）。バタフライ図の各列の値と、列の間で行う操作を返す。
 * 並べ替えの表と回転因子の表は、スペクトラムアナライザの FFT（../spectrum/fft.ts）のものを使う
 */
import { plan } from '../spectrum/fft';

/** 時間間引き（Cooley–Tukey）か周波数間引き（Gentleman–Sande） */
export type Kind = 'dit' | 'dif';

/** バタフライ 1 つ。上の行 a・下の行 b、回転因子 W_N^p（W_N = e^{−i2π/N}） */
export interface Bf {
  a: number;
  b: number;
  p: number;
}
/** 列から次の列への操作。並べ替えか、段 s（1 から）のバタフライの組 */
export type Step = { t: 'rev' } | { t: 'bf'; s: number; bf: Bf[] };

export interface Flow {
  N: number;
  /** 段の数 log2 N */
  m: number;
  kind: Kind;
  /** 列ごとの値。DIT は [入力, 並べ替え後, 段 1, …, 段 m]、DIF は [入力, 段 1, …, 段 m, 並べ替え後] */
  re: Float64Array[];
  im: Float64Array[];
  /** steps[c] は列 c から列 c + 1 への操作 */
  steps: Step[];
}

export const log2 = (N: number): number => {
  const m = Math.round(Math.log2(N));
  if (N < 2 || 2 ** m !== N) throw new Error(`N must be a power of 2: ${N}`);
  return m;
};

/** i の下位 m ビットを逆順にする */
export function bitrev(i: number, m: number): number {
  let r = 0;
  for (let b = 0; b < m; b++) r |= ((i >> b) & 1) << (m - 1 - b);
  return r;
}

/** W_N^p の実部と虚部（p は N で割った余りで引く） */
export function tw(N: number, p: number): [number, number] {
  const P = plan(N),
    q = ((p % N) + N) % N;
  /* 表は 0〜N/2 − 1。W^{q} = −W^{q − N/2} */
  return q < N / 2 ? [P.cs[q], P.sn[q]] : [-P.cs[q - N / 2], -P.sn[q - N / 2]];
}

/** 段 s（1 から）のバタフライ。DIT は大きさ 2^s の組、DIF は大きさ N / 2^{s−1} の組 */
export function butterflies(N: number, kind: Kind, s: number): Bf[] {
  const size = kind === 'dit' ? 1 << s : N >> (s - 1),
    half = size >> 1,
    step = N / size,
    L: Bf[] = [];
  for (let i = 0; i < N; i += size) for (let j = 0; j < half; j++) L.push({ a: i + j, b: i + j + half, p: j * step });
  return L;
}

/** 並べ替え（rev[i] 番を i 番へ）。rev は自分自身の逆なので、行き先も rev[i] */
function permute(N: number, src: Float64Array): Float64Array {
  const { rev } = plan(N),
    d = new Float64Array(N);
  for (let i = 0; i < N; i++) d[i] = src[rev[i]];
  return d;
}

/**
 * x（実部 re・虚部 im、長さ N）を変換し、すべての列を記録する。
 * DIT: X[a] = x[a] + W^p x[b]、X[b] = x[a] − W^p x[b]（回転因子を先に掛ける）
 * DIF: X[a] = x[a] + x[b]、X[b] = (x[a] − x[b]) W^p（回転因子を後で掛ける）
 */
export function flow(re: ArrayLike<number>, im: ArrayLike<number>, kind: Kind): Flow {
  const N = re.length,
    m = log2(N),
    R: Float64Array[] = [Float64Array.from(re)],
    I: Float64Array[] = [Float64Array.from(im)],
    steps: Step[] = [];
  const rev = () => {
    R.push(permute(N, R[R.length - 1]));
    I.push(permute(N, I[I.length - 1]));
    steps.push({ t: 'rev' });
  };
  if (kind === 'dit') rev();
  for (let s = 1; s <= m; s++) {
    const bf = butterflies(N, kind, s),
      xr = Float64Array.from(R[R.length - 1]),
      xi = Float64Array.from(I[I.length - 1]);
    for (const { a, b, p } of bf) {
      const [wr, wi] = tw(N, p);
      if (kind === 'dit') {
        const tr = xr[b] * wr - xi[b] * wi,
          ti = xr[b] * wi + xi[b] * wr;
        xr[b] = xr[a] - tr;
        xi[b] = xi[a] - ti;
        xr[a] += tr;
        xi[a] += ti;
      } else {
        const dr = xr[a] - xr[b],
          di = xi[a] - xi[b];
        xr[a] += xr[b];
        xi[a] += xi[b];
        xr[b] = dr * wr - di * wi;
        xi[b] = dr * wi + di * wr;
      }
    }
    R.push(xr);
    I.push(xi);
    steps.push({ t: 'bf', s, bf });
  }
  if (kind === 'dif') rev();
  return { N, m, kind, re: R, im: I, steps };
}

/** 最後の列（自然な順の X[k]） */
export const output = (f: Flow): [Float64Array, Float64Array] => [f.re[f.re.length - 1], f.im[f.im.length - 1]];

/**
 * 列 c の行 r が入る組（並んだ行の塊）の先頭と大きさ。
 * DIT は段 s を終えると 2^s 行ずつが 2^s 点の DFT を終えた組、DIF は N / 2^s 行ずつがこれから変換する組
 */
export function group(f: Flow, c: number, r: number): { lo: number; size: number } {
  const size = f.kind === 'dit' ? (c === 0 ? 1 : 1 << (c - 1)) : c > f.m ? f.N : f.N >> c;
  return { lo: r - (r % size), size };
}

/** 定義どおりの DFT（N² 回の複素数の掛け算） */
export function dft(re: ArrayLike<number>, im: ArrayLike<number>): [Float64Array, Float64Array] {
  const N = re.length,
    Xr = new Float64Array(N),
    Xi = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    let sr = 0,
      si = 0;
    for (let n = 0; n < N; n++) {
      const t = (-2 * Math.PI * ((k * n) % N)) / N,
        c = Math.cos(t),
        s = Math.sin(t);
      sr += re[n] * c - im[n] * s;
      si += re[n] * s + im[n] * c;
    }
    Xr[k] = sr;
    Xi[k] = si;
  }
  return [Xr, Xi];
}
