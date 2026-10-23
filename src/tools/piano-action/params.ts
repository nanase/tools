/** ピアノのアクションのページの入力の定義（整調の数値の行・打鍵・再生の速さ・鍵） */
import type { ParamDef, ParamFormat } from '../../lib/param-def';
import type { Unit } from '../../lib/parse';

const BAD = '数を入れてください（例 2・2.5）';
const sig = (v: number, s: number) => String(Number(v.toPrecision(s))).replace('-', '−');
const plainF = (u: string): ParamFormat => ({
  input: (v) => sig(v, 3),
  step: (v) => sig(v, 3),
  text: (v) => `${sig(v, 3)}${u ? ` ${u}` : ''}`,
});
function listed(
  d: Omit<ParamDef, 'min' | 'max' | 'ph' | 'pre' | 'notation' | 'bad' | 'unit'> & {
    list: readonly number[];
    unit: Unit;
    pre?: ParamDef['pre'];
  },
): ParamDef {
  return {
    ...d,
    min: d.list[0],
    max: d.list[d.list.length - 1],
    ph: `例 ${d.v}`,
    pre: d.pre ?? [[d.v, `${d.v}`, '標準']],
    notation: 'plain',
    sign: d.list[0] < 0 ? 'any' : 'pos',
    inputmode: 'decimal',
    bad: BAD,
    format: plainF(d.unit),
  };
}

/** 整調の行。長さは mm、ばねは % */
export type RegKey = 'dip' | 'blow' | 'letoff' | 'drop' | 'check' | 'spring';
export const REGS: ParamDef[] = [
  listed({
    k: 'dip',
    nm: '鍵の深さ',
    sym: '',
    name: '鍵の深さ',
    sub: '鍵の前が沈む深さ。フロントレールのフェルトの厚さで合わせる。Hirschkorn の整調の目標は 10 mm',
    unit: 'mm',
    v: 10,
    list: [8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12],
  }),
  listed({
    k: 'blow',
    nm: '打弦距離',
    sym: '',
    name: '打弦距離',
    sub: '止まっているハンマーの頭から弦までの距離。目安は 45〜47 mm で、Hirschkorn の整調の目標は 48 mm。ここでは弦の高さを変える',
    unit: 'mm',
    v: 48,
    list: [40, 42, 44, 45, 46, 47, 48, 49, 50, 52, 54, 56],
  }),
  listed({
    k: 'letoff',
    nm: 'レットオフ',
    sym: '',
    name: 'レットオフ',
    sub: 'ゆっくり押したときにジャックがナックルの下から抜け始める位置を、ハンマーと弦の距離で表す。目安は 1〜3 mm。レットオフボタンの高さで合わせる。0 以下では抜ける前にハンマーが弦に着く',
    unit: 'mm',
    v: 2,
    list: [-1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12],
  }),
  listed({
    k: 'drop',
    nm: 'ドロップ',
    sym: '',
    name: 'ドロップ',
    sub: 'ゆっくり押したときにレペティションレバーがドロップねじに当たる位置を、ハンマーと弦の距離で表す。Hirschkorn の整調の目標は 3 mm',
    unit: 'mm',
    v: 3,
    list: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10],
  }),
  listed({
    k: 'check',
    nm: 'バックチェック',
    sym: '',
    name: 'バックチェック',
    sub: '鍵を押したままのとき、落ちてきたハンマーの尾をバックチェックが受け止める位置を、ハンマーと弦の距離で表す。Hirschkorn の整調の目標は 15 mm',
    unit: 'mm',
    v: 15,
    list: [8, 10, 12, 14, 15, 16, 18, 20, 25, 30, 35, 40, 45],
  }),
  listed({
    k: 'spring',
    nm: 'レペティションのばね',
    sym: '',
    name: 'レペティションのばね',
    sub: 'レペティションレバーを押し上げるばねの強さ。Hirschkorn の値（0.073 N·m/rad）に対する割合',
    unit: '%',
    v: 100,
    list: [5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 140, 160, 180, 200],
  }),
];

/** 打鍵 */
export const TOUCHES = [
  ['forte', '強く', '強く打つ。力は Hirschkorn の実験のもので、最大 34 N'],
  ['piano', '弱く', '弱く打つ。力は Hirschkorn の実験のもので、最大 4 N'],
  ['rep', '強く・連打', '強く打って鍵を半分ほど戻し、もう一度強く押す'],
] as const;

/** 再生の速さ。auto は段階ごとに、どの段階も 1.5〜4 秒で見せる */
export const SPEEDS = [
  ['auto', '自動', '段階ごとに速さを変え、どの段階も 1.5〜4 秒で見せる'],
  ['100', '1/100', '実際の 1/100 の速さ'],
  ['200', '1/200', '実際の 1/200 の速さ'],
  ['500', '1/500', '実際の 1/500 の速さ'],
] as const;

/** 鳴らす鍵（ピアノ音響モデルの鍵の番号。A0 が 21） */
export const NOTES = [
  [36, 'C2'],
  [60, 'C4'],
  [84, 'C6'],
] as const;
export const VOL0 = -20;
