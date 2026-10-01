/** 入力の枠（テスト信号）とモニターの枠の入力の定義。オシロスコープとスペクトラムアナライザで共有する */
import { linList } from '../../lib/eseries';
import { minus } from '../../lib/format';
import type { ParamDef, ParamFormat } from '../../lib/param-def';

export type InKey = 'tf' | 'vol';

/** dB: 整数（JJY シミュレータの音量と同じ表記） */
const dbIn = (v: number): string => minus(String(Math.round(v)));
const DB: ParamFormat = { input: dbIn, step: (v) => (v > 0 ? '+' : '') + dbIn(v), text: (v) => `${dbIn(v)} dB` };

/** テスト信号の周波数（CH1）。E12 の並び */
export const TF_PARAM: ParamDef & { k: InKey } = {
  k: 'tf',
  nm: 'f',
  sym: '<i>f</i>',
  name: '周波数',
  sub: 'CH1 の周波数。CH2 は周波数比で決まる',
  unit: 'Hz',
  min: 20,
  max: 20000,
  v: 1000,
  series: 12,
  ph: '例 1k',
  bad: '読めない値です（例 440・1k・1k5・1e3）',
  pre: [
    [100, '100'],
    [440, '440'],
    [1e3, '1k'],
    [5e3, '5k'],
  ],
  tk: [
    [20, '20'],
    [100, '100'],
    [1e3, '1k'],
    [1e4, '10k'],
  ],
};

/** モニターの音量（JJY シミュレータの音量と同じ範囲・初期値） */
export const VOL_PARAM: ParamDef & { k: InKey } = {
  k: 'vol',
  nm: 'A',
  sym: '<i>A</i>',
  name: '音量',
  sub: 'スピーカーへ出す大きさ（0 dB = 入力と同じ大きさ）',
  unit: 'dB',
  min: -60,
  max: 0,
  v: -30,
  ph: '例 −20',
  list: linList(-60, 0, 1),
  jump: 6,
  sign: 'any',
  format: DB,
  fix: (v) => {
    const c = Math.min(0, Math.max(-60, v)),
      w = Math.round(c);
    return [w, c === v ? '' : `${dbIn(v)} dB は範囲外のため${w === 0 ? '上限' : '下限'} ${dbIn(w)} dB にしました`];
  },
  bad: '読めない値です（例 −6・−20）',
  pre: [],
  tk: [
    [-60, '−60'],
    [-40, '−40'],
    [-20, '−20'],
    [0, '0'],
  ],
};

/** テスト信号の周波数比 CH1 : CH2（リサジュー図形の形） */
export const RATIOS = ['1:1', '1:2', '2:3', '3:4', '1:3'] as const;
/** テスト信号の CH2 の位相（度） */
export const PHASES = [0, 45, 90, 135, 180] as const;
