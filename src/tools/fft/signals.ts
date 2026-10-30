/** 入力の見本（DOM に依存しない）。長さ N の複素数列 [実部, 虚部] を返す */

export type Sig = 'imp' | 'shift' | 'dc' | 'cos' | 'rot' | 'step' | 'mix' | 'rand';
/** [値, 表示] */
export const SIGS: readonly (readonly [Sig, string])[] = [
  ['imp', 'インパルス'],
  ['shift', 'ずれたインパルス'],
  ['dc', '一定'],
  ['cos', '余弦 1 周'],
  ['rot', '回転 2 周'],
  ['step', '段'],
  ['mix', '余弦 1 周＋3 周'],
  ['rand', '乱数'],
];

/** 再現できる乱数（mulberry32） */
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

/** 値は −1〜1 に収まる。'rot' だけ虚部がある（e^{i2π·2n/N}） */
export function signal(s: Sig, N: number, seed = 1): [Float64Array, Float64Array] {
  const re = new Float64Array(N),
    im = new Float64Array(N),
    w = (2 * Math.PI) / N,
    r = rng(seed);
  for (let n = 0; n < N; n++) {
    switch (s) {
      case 'imp':
        re[n] = n === 0 ? 1 : 0;
        break;
      case 'shift':
        re[n] = n === 1 ? 1 : 0;
        break;
      case 'dc':
        re[n] = 1;
        break;
      case 'cos':
        re[n] = Math.cos(w * n);
        break;
      case 'rot':
        re[n] = Math.cos(2 * w * n);
        im[n] = Math.sin(2 * w * n);
        break;
      case 'step':
        re[n] = n < N / 2 ? 1 : 0;
        break;
      case 'mix':
        re[n] = 0.5 * Math.cos(w * n) + 0.5 * Math.cos(3 * w * n);
        break;
      case 'rand':
        re[n] = Math.round((2 * r() - 1) * 100) / 100;
        break;
    }
  }
  return [re, im];
}
