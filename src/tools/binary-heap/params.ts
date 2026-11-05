/** 二分ヒープのページの入力の定義（速さ・要素数・音量）。音量はリスト・キュー・スタックと同じ */
import type { ParamDef } from '../../lib/param-def';
import { VOL as LS_VOL } from '../list-queue-stack/params';

export type Key = 'sp' | 'n' | 'vol';

const plain = { input: String, view: String, step: String, text: String };

/** 親子の比較と交換を目で追える速さから始める */
export const SPEED: ParamDef & { k: Key } = {
  k: 'sp',
  nm: '速さ',
  sym: '',
  name: '速さ',
  sub: '',
  unit: '回/秒',
  min: 0.5,
  max: 500,
  v: 2,
  ph: '例 2',
  list: [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500],
  log: true,
  snap: true,
  notation: 'plain',
  format: plain,
  pre: [
    [1, '1'],
    [2, '2'],
    [10, '10'],
  ],
};
export const VOL: ParamDef & { k: Key } = LS_VOL;

/** 段がちょうど埋まる数だけを選ぶ */
export const SIZE: ParamDef & { k: Key } = {
  k: 'n',
  nm: '要素数',
  sym: '',
  name: '要素数',
  sub: '',
  unit: '個',
  min: 7,
  max: 63,
  v: 15,
  ph: '例 15',
  list: [7, 15, 31, 63],
  snap: true,
  notation: 'plain',
  format: plain,
  pre: [],
};
