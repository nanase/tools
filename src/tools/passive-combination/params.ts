import type { Series } from '../../lib/eseries';
import type { ParamDef, ParamPatch } from '../../lib/param-def';

/** 素子の種類: 抵抗器・コンデンサ・インダクタ */
export type Ty = 'R' | 'C' | 'L';

export interface TyDef {
  /** 素子の名前 */
  nm: string;
  /** 記号 */
  s: string;
  u: 'Ω' | 'F' | 'H';
  /** 量の名前 */
  q: string;
  /** 合成値の名前 */
  syn: string;
  /** 入力できる範囲 */
  lo: number;
  hi: number;
  /** 初期値: 目標・使う最小・最大 */
  v: { t: number; min: number; max: number };
  ph: string;
}

export const TY: Record<Ty, TyDef> = {
  R: {
    nm: '抵抗器',
    s: 'R',
    u: 'Ω',
    q: '抵抗値',
    syn: '合成抵抗',
    lo: 1e-3,
    hi: 1e9,
    v: { t: 1234, min: 10, max: 1e6 },
    ph: '例 1.5k',
  },
  C: {
    nm: 'コンデンサ',
    s: 'C',
    u: 'F',
    q: '静電容量',
    syn: '合成容量',
    lo: 1e-12,
    hi: 1,
    v: { t: 1.234e-6, min: 1e-12, max: 1 },
    ph: '例 100n',
  },
  L: {
    nm: 'インダクタ',
    s: 'L',
    u: 'H',
    q: 'インダクタンス',
    syn: '合成インダクタンス',
    lo: 1e-9,
    hi: 1,
    v: { t: 123.4e-6, min: 1e-9, max: 1 },
    ph: '例 10μ',
  },
};

export const TYPES: readonly Ty[] = ['R', 'C', 'L'];

/** 数値の行: 目標は E192 の刻み、最小・最大は 10 倍ずつ */
export type NumKey = 't' | 'min' | 'max';
export const NUM_KEYS: readonly NumKey[] = ['t', 'min', 'max'];

interface Row {
  series: Series;
  sig: number;
  name: (q: string) => string;
  sub: string;
  sym: (s: string) => string;
  stepLabel: string;
  hint?: string;
}
const ROW: Record<NumKey, Row> = {
  t: {
    series: 192,
    sig: 6,
    name: (q) => `求める${q}`,
    sub: '近似の目標',
    sym: (s) => `<i>${s}</i><sub>T</sub>`,
    stepLabel: 'E192 で',
  },
  min: {
    series: 1,
    sig: 4,
    name: (q) => `使う最小の${q}`,
    sub: 'これ以上の値を使う',
    sym: (s) => `<i>${s}</i><sub>min</sub>`,
    stepLabel: '10 倍ずつ',
    hint: '↑↓: 10 倍ずつ隣の値　PgUp/PgDn: 10 倍・1/10　Enter: 確定　Esc: 戻す',
  },
  max: {
    series: 1,
    sig: 4,
    name: (q) => `使う最大の${q}`,
    sub: 'これ以下の値を使う',
    sym: (s) => `<i>${s}</i><sub>max</sub>`,
    stepLabel: '10 倍ずつ',
    hint: '↑↓: 10 倍ずつ隣の値　PgUp/PgDn: 10 倍・1/10　Enter: 確定　Esc: 戻す',
  },
};

export function numDef(k: NumKey, ty: Ty): ParamDef & { k: NumKey } {
  const T = TY[ty],
    r = ROW[k];
  return {
    k,
    nm: T.s,
    sym: r.sym(T.s),
    name: r.name(T.q),
    sub: r.sub,
    unit: T.u,
    min: T.lo,
    max: T.hi,
    v: T.v[k],
    ph: T.ph,
    pre: [],
    series: r.series,
    sig: r.sig,
    stepLabel: r.stepLabel,
    ...(r.hint ? { hint: r.hint } : {}),
  };
}

/** 種類ごとに変わる項目（素子の種類を切り替えたときに ParamGroup.update へ渡す。既定値 v も種類ごと） */
export function numPatch(k: NumKey, ty: Ty): ParamPatch {
  const { nm, sym, name, unit, min, max, v, ph } = numDef(k, ty);
  return { nm, sym, name, unit, min, max, v, ph };
}

/** 組み合わせに使う E 系列 */
export const SERIES_CHOICES: readonly Series[] = [1, 3, 6, 12, 24, 48, 96, 192];

/** 探索を終える誤差（相対値）。null は全探索 */
export const STOPS: readonly (readonly [number | null, string])[] = [
  [null, '全探索'],
  [0, '正確'],
  [1e-5, '0.001 %'],
  [1e-4, '0.01 %'],
  [1e-3, '0.1 %'],
];

/** 組み合わせる本数 */
export const NS = [2, 3, 4, 5] as const;
export type N = (typeof NS)[number];
/** 本数ごとに残す候補の数 */
export const K = 10;
