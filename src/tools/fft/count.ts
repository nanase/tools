/**
 * 演算の数（DOM に依存しない）。定義どおりの DFT と基数 2 の FFT を、複素数の演算と実数の演算で数える。
 * 実数の数は、実際のバタフライの回転因子を 1 つずつ見て、掛けなくてよいものを除いて数える
 */
import { butterflies, type Kind, log2 } from './radix2';

export interface Ops {
  /** 複素数の掛け算・足し算（引き算も足し算に数える） */
  cmul: number;
  cadd: number;
  /** 実数の掛け算・足し算 */
  mul: number;
  add: number;
}

/** 複素数の掛け算 1 回を実数で何回とするか。'4/2' は 4 回の掛け算と 2 回の足し算、'3/3' は 3 回と 3 回 */
export type Cm = '4/2' | '3/3';
const CM: Record<Cm, [number, number]> = { '4/2': [4, 2], '3/3': [3, 3] };

/** 定義どおりの DFT: N 個の出力それぞれに N 回の掛け算と N − 1 回の足し算（回転因子は表から引き、すべて掛ける） */
export function dftOps(N: number, cm: Cm = '4/2'): Ops {
  const [cmM, cmA] = CM[cm],
    cmul = N * N,
    cadd = N * (N - 1);
  return { cmul, cadd, mul: cmM * cmul, add: cmA * cmul + 2 * cadd };
}

/** 回転因子 W_N^p の種類。1 か −i は掛けなくてよい、(1 − i)/√2 の向きは掛け算 2 回と足し算 2 回 */
export type Tw = 'one' | 'mi' | 'eighth' | 'gen';
export function twKind(N: number, p: number): Tw {
  const q = ((p % N) + N) % N;
  if (q === 0) return 'one';
  if (4 * q === N) return 'mi';
  if (8 * q === N || 8 * q === 3 * N) return 'eighth';
  return 'gen';
}

/**
 * 基数 2 の FFT。trivial = true は回転因子をすべて一般の複素数として掛ける（教科書の (N/2) log2 N）。
 * false は 1・−i を掛けず、(1 − i)/√2 の向きは実数 2 回の掛け算で済ませる
 */
export function fftOps(N: number, kind: Kind = 'dit', cm: Cm = '4/2', trivial = true): Ops {
  const m = log2(N),
    [cmM, cmA] = CM[cm];
  let cmul = 0,
    cadd = 0,
    mul = 0,
    add = 0;
  for (let s = 1; s <= m; s++)
    for (const { p } of butterflies(N, kind, s)) {
      cadd += 2;
      add += 4;
      const k = trivial ? 'gen' : twKind(N, p);
      if (k === 'gen') {
        cmul++;
        mul += cmM;
        add += cmA;
      } else if (k === 'eighth') {
        cmul++;
        mul += 2;
        add += 2;
      }
    }
  return { cmul, cadd, mul, add };
}

/** 文献の式（Duhamel–Vetterli 1990）。複素数の掛け算は 3/3、1・−i・(1 − i)/√2 を除く */
export const radix2Formula = (N: number): [number, number] => {
  const L = N * log2(N);
  return [1.5 * L - 5 * N + 8, 3.5 * L - 5 * N + 8];
};
/** 分割基数（同じ数え方） */
export const splitRadixFormula = (N: number): [number, number] => {
  const L = N * log2(N);
  return [L - 3 * N + 4, 3 * L - 3 * N + 4];
};
