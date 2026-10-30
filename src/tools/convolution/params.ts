/** 畳み込みのページの入力の定義（形の選択肢・幅の行・格子） */
import type { ParamDef } from '../../lib/param-def';
import type { Unit } from '../../lib/parse';
import type { Shape } from './conv';

export type Kind = Shape | 'hand';
export type Mode = 'c' | 'd';
export type Which = 'x' | 'h';

/** 形の選択肢 [値, 表示, title] */
export const SHAPES: readonly (readonly [Kind, string, string])[] = [
  ['rect', '矩形', '幅 a の間だけ 1'],
  ['tri', '三角', '0 を中心にした三角形'],
  ['exp', '指数', '0 から指数で減る'],
  ['gauss', 'ガウス', '0 を中心にした正規分布の形'],
  ['delta', 'インパルス', '面積 1 の 1 点'],
  ['echo', 'こだま', '0 と幅の所の 2 本のインパルス（2 本目は 0.6 倍）'],
  ['step', 'ステップ', '0 から先がずっと 1'],
  ['burst', '正弦波', '周期が幅の正弦波を 3 周期'],
  ['comb', 'パルス列', '幅の間隔のインパルス 4 本'],
  ['noise', '雑音', '幅の間の一様な雑音'],
  ['dice', 'サイコロ', '1〜6 の目が 1/6 ずつ（離散だけ）'],
  ['hand', '手描き', '図をなぞって描いた形'],
];

/**
 * 格子 [始まり, 刻み, 点の数]、図の横軸、滑らせる範囲。
 * 連続の刻みは 0.01（Theory の「このツールで決めたこと」）。離散は 4 個のサイコロの和（4〜24）が入る広さ
 */
export const GRID = {
  c: { x: [-2, 0.01, 801], h: [-2, 0.01, 601], view: [-3, 9], tr: [-2.5, 9] },
  d: { x: [-6, 1, 31], h: [-4, 1, 13], view: [-7, 33], tr: [-6, 31] },
} as const satisfies Record<
  Mode,
  { x: readonly number[]; h: readonly number[]; view: readonly number[]; tr: readonly number[] }
>;

/** 1 刻み（再生と ▶| で進める量） */
export const STEP: Record<Mode, number> = { c: 0.1, d: 1 };
/** 1 秒に進む量 */
export const SPEED: Record<Mode, number> = { c: 1.2, d: 3 };
/** 滑らせる位置の初め */
export const T0: Record<Mode, number> = { c: 1.6, d: 4 };

/** サイコロの数（出力が n 個の和） */
export const DICE = [2, 3, 4, 5] as const;

const BAD = '数を入れてください（例 0.5・3）';
const sig = (v: number) => String(Number(v.toPrecision(3)));
function width(
  k: string,
  nm: string,
  sym: string,
  name: string,
  sub: string,
  unit: Unit,
  v: number,
  list: number[],
): ParamDef {
  return {
    k,
    nm,
    sym,
    name,
    sub,
    unit,
    v,
    list,
    min: list[0],
    max: list[list.length - 1],
    ph: `例 ${v}`,
    pre: [],
    notation: 'plain',
    sign: 'pos',
    inputmode: 'decimal',
    snap: true,
    bad: BAD,
    format: { input: sig, step: sig, text: (x) => `${sig(x)} ${unit}` },
  };
}
const CW = [0.2, 0.3, 0.4, 0.5, 0.7, 1, 1.5, 2, 3, 4];
const DW = [1, 2, 3, 4, 5, 6, 8, 10];
const SUB =
  '形の幅。指数では減って 1/e になる時間、ガウスでは標準偏差、三角では半分の幅、正弦波とパルス列では周期と間隔';

export type WKey = 'xa' | 'xn' | 'ha' | 'hn';
/** 幅の行（連続は秒、離散は点の数）。行は入力と核の枠に 2 つずつ置き、モードで片方を隠す */
export const WIDTHS: ParamDef[] = [
  width('xa', 'a', '<i>a</i>', '幅', SUB, 's', 2, CW),
  width('xn', 'a', '<i>a</i>', '幅', SUB, '点', 4, DW),
  width('ha', 'b', '<i>b</i>', '核の幅', SUB, 's', 0.7, CW),
  width('hn', 'b', '<i>b</i>', '核の幅', SUB, '点', 3, DW),
];
