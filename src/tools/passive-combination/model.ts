/** 探索の入力と結果の組み立て（DOM に依存しない）: 使う値、組の平坦化と式、誤差の表記、カラーコード */
import { COLORS, type ColorKey, DIGIT_KEYS } from '../../lib/colorcode';
import { eList, type Series, same } from '../../lib/eseries';
import { parts } from '../../lib/format';
import type { Ty } from './params';
import type { Found, Op, Tree } from './search';

/** 1 種類の素子の入力 */
export interface TyState {
  t: number;
  min: number;
  max: number;
  /** 除外する値（小さい順） */
  ex: number[];
}

/** 組み合わせに使う値: E 系列のうち最小〜最大にあるもの。目標と同じ値と除外した値は除く */
export const usable = (es: Series, s: TyState): number[] =>
  eList(es, s.min, s.max).filter((v) => !same(v, s.t) && !s.ex.some((x) => same(x, v)));

/* ---------- 組 ---------- */
/** 平坦にした組: 同じ演算の入れ子をまとめ、子を 2 つ以上持つ */
export type Node = number | { o: Op; c: Node[] };

/** S・P を直列・並列に読み替える。コンデンサでは S が並列 */
export const conn = (o: Op, ty: Ty): 'ser' | 'par' => ((ty === 'C') === (o === 'S') ? 'par' : 'ser');
const sp = (o: Op, a: number, b: number) => (o === 'S' ? a + b : (a * b) / (a + b));
export const nval = (x: Node): number => (typeof x === 'number' ? x : x.c.map(nval).reduce((a, b) => sp(x.o, a, b)));

/** 同じ演算の入れ子を平らにして、素子を大きい順、組を後ろに並べる */
export function flat(t: Tree): Node {
  if (typeof t === 'number') return t;
  const o = t[0],
    c: Node[] = [];
  for (const x of [t[1], t[2]]) {
    const f = flat(x);
    if (typeof f === 'object' && f.o === o) c.push(...f.c);
    else c.push(f);
  }
  c.sort((a, b) => Number(typeof a === 'object') - Number(typeof b === 'object') || nval(b) - nval(a));
  return { o, c };
}
export const leaves = (x: Node): number[] => (typeof x === 'number' ? [x] : x.c.flatMap(leaves));

/** 値の短い表記（1.2k） */
export const short = (v: number): string => parts(v, '', 3).join('');

/** 組の式: + は直列、∥ は並列 */
export const expr = (x: Node, ty: Ty, top = true): string =>
  typeof x === 'number'
    ? short(x)
    : (top ? '' : '(') +
      x.c.map((c) => expr(c, ty, false)).join(conn(x.o, ty) === 'ser' ? ' + ' : ' ∥ ') +
      (top ? '' : ')');

/** 候補 1 件 */
export interface Cand {
  /** 合成値 */
  v: number;
  /** 誤差（相対値。正は目標より大きい） */
  e: number;
  tr: Node;
  /** 式 */
  x: string;
  /** 素子の種類数 */
  k: number;
  /** 本数 */
  n: number;
}

export function cand({ v, t }: Found, ty: Ty, target: number): Cand {
  const tr = flat(t),
    L = leaves(tr);
  return { v, e: (v - target) / target, tr, x: expr(tr, ty), k: new Set(L).size, n: L.length };
}

/** 誤差の表記: 0.001 % 以上は小数 3 桁、それ未満は有効 2 桁 */
export function errTxt(e: number): string {
  if (Math.abs(e) < 1e-12) return '0 %';
  const p = e * 100,
    a = Math.abs(p),
    sg = p > 0 ? '+' : '−';
  if (a >= 0.001) return `${sg + a.toFixed(3)} %`;
  const d = Math.min(12, 1 - Math.floor(Math.log10(a)));
  return `${sg + a.toFixed(d)} %`;
}

/* ---------- カラーコード ---------- */
/** [名前, 色]。色は SVG の fill（金・銀はグラデーションの参照） */
export type Band = readonly [string, string];
const band = (k: ColorKey): Band => [COLORS[k].n, COLORS[k].fill ?? 'none'];
const CC: readonly Band[] = DIGIT_KEYS.map(band);
export const GOLD: Band = band('gd');
export const SILVER: Band = band('sv');

/**
 * 有効数字 2 桁で表せる値は 4 本帯（数字 2・乗数・許容差 tol）。
 * 表せない値（E48 以上）は 3 桁の 5 本帯にし、許容差は 1 %（茶。tol が銀なら銀のまま）。乗数で表せなければ null
 */
export function bands(v: number, tol: Band): Band[] | null {
  for (const nd of [2, 3]) {
    let e = Math.floor(Math.log10(v)) - (nd - 1),
      r = Math.round(v / 10 ** e);
    if (r >= 10 ** nd) {
      r = Math.round(r / 10);
      e++;
    }
    if (nd === 2 && Math.abs(r * 10 ** e - v) > v * 1e-9) continue;
    const mul = e >= 0 && e <= 9 ? CC[e] : e === -1 ? GOLD : e === -2 ? SILVER : null;
    if (!mul) return null;
    const ds = String(r)
      .split('')
      .map((d) => CC[+d]);
    return [...ds, mul, nd === 2 ? tol : tol === GOLD ? CC[1] : tol];
  }
  return null;
}

/** 素子のカラーコード（旧ページの表示を踏襲）: 抵抗器は Ω・誤差 5 %（金）、インダクタは µH・誤差 10 %（銀）。コンデンサは描かない */
export const codeOf = (v: number, ty: Ty): Band[] | null =>
  ty === 'C' ? null : ty === 'L' ? bands(v * 1e6, SILVER) : bands(v, GOLD);
