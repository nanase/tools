/** カルノー図のページの真理値表のサンプル */
import { DC, type Val } from './logic';

export interface Out {
  name: string;
  f: Val[];
}
export interface Sample {
  id: string;
  name: string;
  sub: string;
  n: number;
  outs: Out[];
}

/** 行の条件から表を作る。fn が null を返す行は Don't Care */
const tab = (n: number, fn: (k: number) => 0 | 1 | null): Val[] =>
  Array.from({ length: 1 << n }, (_, k) => {
    const v = fn(k);
    return v == null ? DC : v;
  });
const ones = (n: number, on: readonly number[], dc: readonly number[] = []): Val[] =>
  tab(n, (k) => (dc.includes(k) ? null : on.includes(k) ? 1 : 0));
const b = (x: boolean): 0 | 1 => (x ? 1 : 0);

/** 7 セグメント表示で数字 0〜9 に光るセグメント */
const SEG: Record<string, readonly number[]> = {
  a: [0, 2, 3, 5, 6, 7, 8, 9],
  b: [0, 1, 2, 3, 4, 7, 8, 9],
  c: [0, 1, 3, 4, 5, 6, 7, 8, 9],
  d: [0, 2, 3, 5, 6, 8, 9],
  e: [0, 2, 6, 8],
  f: [0, 4, 5, 6, 8, 9],
  g: [2, 3, 4, 5, 6, 8, 9],
};
const isPrime = (k: number): boolean => {
  if (k < 2) return false;
  for (let d = 2; d * d <= k; d++) if (k % d === 0) return false;
  return true;
};

export const SAMPLES: readonly Sample[] = [
  {
    id: 'maj',
    name: '多数決',
    sub: '3 人のうち 2 人以上が賛成で 1',
    n: 3,
    outs: [{ name: 'Y', f: ones(3, [3, 5, 6, 7]) }],
  },
  {
    id: 'mux',
    name: 'マルチプレクサ',
    sub: 'A が 0 なら B、1 なら C を出力',
    n: 3,
    outs: [{ name: 'Y', f: ones(3, [2, 3, 5, 7]) }],
  },
  {
    id: 'two',
    name: '解が 2 通り',
    sub: '最小の組み合わせが 1 つに決まらない形',
    n: 3,
    outs: [{ name: 'Y', f: ones(3, [0, 1, 2, 5, 6, 7]) }],
  },
  {
    id: 'par',
    name: 'パリティ',
    sub: '1 の数が奇数で 1（まとめられない市松模様）',
    n: 3,
    outs: [{ name: 'Y', f: ones(3, [1, 2, 4, 7]) }],
  },
  {
    id: 'fa',
    name: '全加算器',
    sub: 'A + B + C（C は下の桁からの桁上げ）の和 S と桁上げ Cout',
    n: 3,
    outs: [
      { name: 'S', f: ones(3, [1, 2, 4, 7]) },
      { name: 'Cout', f: ones(3, [3, 5, 6, 7]) },
    ],
  },
  {
    id: 'seg7',
    name: '7 セグメント表示',
    sub: 'ABCD の数 0〜9 で光るセグメント a〜g（10〜15 は X）',
    n: 4,
    outs: Object.entries(SEG).map(([name, on]) => ({ name, f: ones(4, on, [10, 11, 12, 13, 14, 15]) })),
  },
  {
    id: 'ge5',
    name: '5 以上',
    sub: 'ABCD の数 0〜9 が 5 以上で 1（10〜15 は X）',
    n: 4,
    outs: [{ name: 'Y', f: ones(4, [5, 6, 7, 8, 9], [10, 11, 12, 13, 14, 15]) }],
  },
  {
    id: 'prime',
    name: '素数',
    sub: 'ABCD の数 0〜15 が素数で 1',
    n: 4,
    outs: [{ name: 'Y', f: tab(4, (k) => b(isPrime(k))) }],
  },
  {
    id: 'cmp',
    name: '2 桁の比較',
    sub: 'AB と CD を 2 桁の数として比べる',
    n: 4,
    outs: [
      { name: 'GT', f: tab(4, (k) => b(k >> 2 > (k & 3))) },
      { name: 'EQ', f: tab(4, (k) => b(k >> 2 === (k & 3))) },
      { name: 'LT', f: tab(4, (k) => b(k >> 2 < (k & 3))) },
    ],
  },
  {
    id: 'add2',
    name: '2 桁の足し算',
    sub: 'AB + CD の 3 けたの和 S2 S1 S0',
    n: 4,
    outs: [2, 1, 0].map((i) => ({ name: `S${i}`, f: tab(4, (k) => b(!!((((k >> 2) + (k & 3)) >> i) & 1))) })),
  },
  {
    id: 'prime5',
    name: '素数（5 入力）',
    sub: 'ABCDE の数 0〜31 が素数で 1',
    n: 5,
    outs: [{ name: 'Y', f: tab(5, (k) => b(isPrime(k))) }],
  },
  {
    id: 'mux4',
    name: '4 入力のマルチプレクサ',
    sub: 'AB の数 0〜3 で C・D・E・F のどれかを出力',
    n: 6,
    outs: [{ name: 'Y', f: tab(6, (k) => ((k >> (3 - (k >> 4))) & 1) as 0 | 1) }],
  },
  {
    id: 'gt3',
    name: '3 けたの比較',
    sub: 'ABC と DEF を 3 けたの数として ABC > DEF',
    n: 6,
    outs: [{ name: 'Y', f: tab(6, (k) => b(k >> 3 > (k & 7))) }],
  },
];
export const SAMPLE: Readonly<Record<string, Sample>> = Object.fromEntries(SAMPLES.map((s) => [s.id, s]));
export const GROUPS: readonly (readonly [string, (s: Sample) => boolean])[] = [
  ['3 入力', (s) => s.n === 3],
  ['4 入力', (s) => s.n === 4],
  ['5・6 入力', (s) => s.n > 4],
];
export const DEF_ID = 'seg7';
