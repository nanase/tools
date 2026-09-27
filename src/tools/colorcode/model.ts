/** 抵抗カラーコードの状態と計算（DOM に依存しない）: 帯の役割、値との相互変換、E 系列の判定 */
import {
  COLORS,
  type ColorKey,
  DIGIT_KEYS,
  decode,
  encode,
  MULT_KEYS,
  multKey,
  TC_KEYS,
  TOL_KEYS,
} from '../../lib/colorcode';
import { eList, inSeries, nextOf, prevOf, type Series, same } from '../../lib/eseries';
import { fmt, parts } from '../../lib/format';

export type Bands = 4 | 5 | 6;
export const BAND_COUNTS: readonly Bands[] = [4, 5, 6];

/** 帯の役割: 1〜3 桁目の数字、乗数、許容差、温度係数 */
export type Role = 'd0' | 'd1' | 'd2' | 'm' | 't' | 'tc';

/** 色帯の状態 */
export interface Code {
  n: Bands;
  /** 数字（4 本帯は 2 桁、5・6 本帯は 3 桁） */
  d: number[];
  /** 乗数の指数 */
  m: number;
  /** 許容差の色 */
  tol: ColorKey;
  /** 温度係数の色（6 本帯だけで使う） */
  tc: ColorKey;
}

/** 初期状態: 4.7 kΩ ±5 %（黄紫赤金） */
export const INIT: Code = { n: 4, d: [4, 7], m: 2, tol: 'gd', tc: 'br' };

/** 入力できる抵抗値の範囲 */
export const LO = 0.01,
  HI = 999e9;

export const rolesOf = (n: Bands): Role[] =>
  n === 4 ? ['d0', 'd1', 'm', 't'] : n === 5 ? ['d0', 'd1', 'd2', 'm', 't'] : ['d0', 'd1', 'd2', 'm', 't', 'tc'];

const isDigit = (r: Role): r is 'd0' | 'd1' | 'd2' => r[0] === 'd';
const digitIdx = (r: 'd0' | 'd1' | 'd2') => Number(r[1]);

/** 帯の役割の短い名前（「1 桁目」） */
export const roleName = (r: Role): string =>
  isDigit(r) ? `${digitIdx(r) + 1} 桁目` : r === 'm' ? '乗数' : r === 't' ? '許容差' : '温度係数';
/** 帯の役割の名前（「1 桁目の数字」） */
export const roleLong = (r: Role): string => (isDigit(r) ? `${digitIdx(r) + 1} 桁目の数字` : roleName(r));

/** 帯 r の今の色 */
export function keyOf(c: Code, r: Role): ColorKey {
  if (isDigit(r)) return DIGIT_KEYS[c.d[digitIdx(r)]];
  if (r === 'm') return multKey(c.m) ?? 'k';
  return r === 't' ? c.tol : c.tc;
}

/** 値の短い表記（4.7k） */
export const short = (v: number): string => parts(v, '', 3).join('');
/** 許容差の表記 */
export const pct = (t: number): string => `±${t} %`;
/** 乗数の表記（0.001・0.01・0.1・1・10・…・1G） */
export const mulTxt = (e: number): string => (e < 0 ? ['0.001', '0.01', '0.1'][e + 3] : short(10 ** e));

/**
 * 帯 r の色 k の意味。long: 0 は短く（温度係数は数だけ）、1 は ppm まで、2 は ppm/K まで
 */
export function meaning(r: Role, k: ColorKey, long: 0 | 1 | 2): string {
  const c = COLORS[k];
  if (isDigit(r)) return String(c.d);
  if (r === 'm') return `×${mulTxt(c.m ?? 0)}`;
  if (r === 't') return pct(c.t ?? 0);
  return `${c.tc}${long === 2 ? ' ppm/K' : long ? ' ppm' : ''}`;
}

/** 帯 r で選べる色。帯なし（±20 %）は 4 本帯だけ */
export const optsOf = (r: Role, n: Bands): readonly ColorKey[] =>
  isDigit(r)
    ? DIGIT_KEYS
    : r === 'm'
      ? MULT_KEYS
      : r === 't'
        ? n === 4
          ? TOL_KEYS
          : TOL_KEYS.filter((k) => k !== 'no')
        : TC_KEYS;

/** 色帯の抵抗値 */
export const ohmsOf = (c: Code): number => decode(c.d, c.m);
/** 許容差（%） */
export const tolOf = (c: Code): number => COLORS[c.tol].t ?? 20;

/** 帯 r を色 k にする */
export function pick(c: Code, r: Role, k: ColorKey): Code {
  const x = COLORS[k];
  if (isDigit(r)) {
    const d = c.d.slice();
    d[digitIdx(r)] = x.d ?? 0;
    return { ...c, d };
  }
  if (r === 'm') return { ...c, m: x.m ?? 0 };
  return r === 't' ? { ...c, tol: k } : { ...c, tc: k };
}

interface Fit {
  n: Bands;
  v: number;
  d: number[];
  m: number;
}
/** 帯の数 n で表す。表せなければもう一方（4 本帯 ↔ 5 本帯）、どちらも無理なら 2 桁に丸めて 4 本帯 */
export function fitBands(v: number, n: Bands): Fit {
  for (const nn of n === 4 ? ([4, 5] as const) : ([n, 4] as const)) {
    const c = encode(v, nn === 4 ? 2 : 3);
    if (c) return { n: nn, v, ...c };
  }
  const v2 = Number(v.toPrecision(2)),
    c = encode(v2, 2);
  if (!c) throw new Error(`色帯で表せない値: ${v}`);
  return { n: 4, v: v2, ...c };
}

/** 抵抗値から色帯を決めた結果。note は丸めや帯の数を変えた理由、er なら警告として出す */
export interface Applied {
  code: Code;
  note: string;
  er: boolean;
}

/** 抵抗値 raw を今の色帯 c に当てはめる: 範囲に丸め、有効数字 3 桁にし、帯の数で表せる形にする */
export function fromValue(raw: number, c: Code): Applied {
  const v = Math.min(HI, Math.max(LO, raw));
  let note = '',
    er = false;
  if (!same(v, raw)) {
    note = `${fmt(raw, 'Ω')} は範囲外のため${raw > HI ? '上限' : '下限'} ${fmt(v, 'Ω')} にしました`;
    er = true;
  }
  const v3 = Number(v.toPrecision(3));
  if (!same(v3, v)) {
    note = `色帯で表せるのは有効数字 3 桁までなので ${fmt(v3, 'Ω', 6)} にしました`;
    er = true;
  }
  const f = fitBands(v3, c.n);
  if (!same(f.v, v3)) {
    note = `0.1 Ω 未満は有効数字 2 桁までなので ${fmt(f.v, 'Ω', 6)} にしました`;
    er = true;
  }
  if (f.n !== c.n)
    note =
      (note ? `${note}。` : '') +
      (f.n === 4 ? `${c.n} 本帯では表せないので 4 本帯にしました` : '有効数字 3 桁の値なので 5 本帯にしました');
  const tol = f.n > 4 && c.tol === 'no' ? 'br' : c.tol;
  return { code: { ...c, n: f.n, d: f.d, m: f.m, tol }, note, er };
}

/**
 * 帯の数を n にする。4 本帯へは 2 桁に丸める。表せなければ error を返す。
 * 5・6 本帯で帯なしの許容差は ±1 %（茶）にする
 */
export function withBands(c: Code, n: Bands): { code: Code; note: string } | { error: string } {
  let v = ohmsOf(c),
    note = '';
  if (n === 4 && c.d.length === 3 && c.d[2] !== 0) {
    const v2 = Number(v.toPrecision(2));
    note = `4 本帯は数字 2 桁なので ${fmt(v, 'Ω', 6)} を ${fmt(v2, 'Ω', 6)} にしました`;
    v = v2;
  }
  const e = encode(v, n === 4 ? 2 : 3);
  if (!e) return { error: `${fmt(v, 'Ω', 6)} は ${n} 本帯では表せません（5・6 本帯は 0.1 Ω 以上）` };
  let tol = c.tol;
  if (n > 4 && tol === 'no') {
    tol = 'br';
    note = `${note ? `${note}。` : ''}許容差を ±1 %（茶）にしました`;
  }
  return { code: { ...c, n, d: e.d, m: e.m, tol }, note };
}

/* ---------- E 系列 ---------- */
/** 判定する E 系列と、その許容差（%） */
export const E_ROWS: readonly (readonly [Series, number])[] = [
  [6, 20],
  [12, 10],
  [24, 5],
  [48, 2],
  [96, 1],
  [192, 0.5],
];

/** R が載っている E 系列（E6〜E192。有効数字 3 桁で比べる） */
export const seriesOf = (R: number): Series[] => E_ROWS.filter(([s]) => inSeries(s, R)).map(([s]) => s);

export interface ERow {
  s: Series;
  /** 系列の許容差（%） */
  tol: number;
  hit: boolean;
  /** 載っていないとき、前後の近い値（範囲内のものだけ） */
  near: number[];
}

/** E 系列ごとの判定と近い値 */
export function eRows(R: number): ERow[] {
  return E_ROWS.map(([s, tol]) => {
    const L = eList(s, R / 12, R * 12),
      hit = L.some((x) => same(x, R));
    const near = hit ? [] : [prevOf(L, R), nextOf(L, R)].filter((x): x is number => x != null && x >= LO && x <= HI);
    return { s, tol, hit, near };
  });
}

/** R から x への差（%）の表記 */
export function devTxt(x: number, R: number): string {
  const p = ((x - R) / R) * 100;
  return `${(p > 0 ? '+' : '−') + Math.abs(p).toFixed(2)} %`;
}
