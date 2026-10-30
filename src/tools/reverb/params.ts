/**
 * 残響のページの入力の定義（部屋の寸法・高さ・音量）と選択肢。.astro の描画とブラウザの動作の両方で使う
 */
import { linList } from '../../lib/eseries';
import { minus } from '../../lib/format';
import type { ParamDef, ParamFormat } from '../../lib/param-def';
import { PRESETS } from './room';

export type Key = 'W' | 'D' | 'H' | 'zs' | 'zr' | 'vol';

const BAD = '数を入れてください（例 4・2.4）';
const sig = (v: number, s: number) => String(Number(v.toPrecision(s)));
const mF: ParamFormat = { input: (v) => sig(v, 3), step: (v) => sig(v, 3), text: (v) => `${sig(v, 3)} m` };

/** 寸法の並び（部屋の例の値を含む） */
const DIMS = [
  ...new Set([
    ...'1 1.2 1.5 1.6 1.8 2 2.2 2.4 2.5 2.7 3 3.5 4 4.5 5 6 7 8 9 10 12 14 15 16 18 20 22 25 26 28 30 35 40 45 50 60 70 80'
      .split(' ')
      .map(Number),
    ...PRESETS.flatMap((p) => p.room.dim),
  ]),
].sort((a, b) => a - b);

function dim(k: Key, nm: string, name: string, sub: string, v: number): ParamDef & { k: Key } {
  return {
    k,
    nm,
    sym: `<i>${nm}</i>`,
    name,
    sub,
    unit: 'm',
    min: DIMS[0],
    max: DIMS[DIMS.length - 1],
    v,
    ph: `例 ${v}`,
    list: DIMS,
    log: true,
    notation: 'plain',
    inputmode: 'decimal',
    bad: BAD,
    format: mF,
    pre: [],
  };
}
const R0 = PRESETS[1].room;
/** 部屋の寸法 [m]（既定値は教室。部屋の例を選ぶと既定値もその値にする） */
export const ROOM: (ParamDef & { k: Key })[] = [
  dim('W', 'W', '幅', '西の壁から東の壁まで（図の横）', R0.dim[0]),
  dim('D', 'D', '奥行き', '南の壁から北の壁まで（図の縦）', R0.dim[1]),
  dim('H', 'H', '高さ', '床から天井まで', R0.dim[2]),
];

function height(k: Key, nm: string, name: string, sub: string, v: number): ParamDef & { k: Key } {
  return {
    k,
    nm,
    sym: `<i>z</i><sub>${nm}</sub>`,
    name,
    sub,
    unit: 'm',
    min: 0.1,
    max: 80,
    v,
    ph: `例 ${v}`,
    lin: { step: 0.1, big: 1 },
    notation: 'plain',
    inputmode: 'decimal',
    bad: BAD,
    format: mF,
    pre: [],
  };
}
/** 音源と聞き手の床からの高さ [m]（上限は天井の 0.1 m 下にする） */
export const HEIGHTS: (ParamDef & { k: Key })[] = [
  height('zs', 's', '音源の高さ', '床から音源まで', R0.src[2]),
  height('zr', 'r', '聞き手の高さ', '床から聞き手の耳まで', R0.rcv[2]),
];

const dbIn = (v: number): string => minus(String(Math.round(v)));
/** 音量 [dB]。応答のエネルギーでそろえた大きさからの差。既定値は楽器のページと同じ −10 dB */
export const VOL: ParamDef & { k: Key } = {
  k: 'vol',
  nm: '音量',
  sym: '',
  name: '音量',
  sub: 'スピーカーへ出す大きさ。応答のエネルギーでそろえてある',
  unit: 'dB',
  min: -60,
  max: 0,
  v: -10,
  ph: '例 −20',
  list: linList(-60, 0, 1),
  jump: 6,
  sign: 'any',
  format: { input: dbIn, step: (v) => (v > 0 ? '+' : '') + dbIn(v), text: (v) => `${dbIn(v)} dB` },
  fix: (v) => {
    const c = Math.min(0, Math.max(-60, v)),
      w = Math.round(c);
    return [w, c === v ? '' : `${dbIn(v)} dB は範囲外のため${w === 0 ? '上限' : '下限'} ${dbIn(w)} dB にしました`];
  },
  bad: '読めない値です（例 −6・−20）',
  pre: [],
};

/** 聞き方 */
export const MODES = [
  ['room', 'この部屋', '鏡像法で求めたこの部屋のインパルス応答を畳み込む'],
  ['fdn', '楽器ページの残響', '楽器のページの残響をこの部屋の残響時間と臨界距離で鳴らす'],
  ['dry', '乾いた音', '畳み込まずに鳴らす'],
] as const;

/** 応答のグラフの時間の幅 */
export const ZOOMS = [
  ['early', '初め'],
  ['all', '全体'],
] as const;
