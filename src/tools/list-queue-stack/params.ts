/** リスト・キュー・スタックのページの入力の定義（速さ・要素数・音量） */
import { linList } from '../../lib/eseries';
import { minus } from '../../lib/format';
import type { ParamDef } from '../../lib/param-def';

export type Key = 'sp' | 'n' | 'vol';

const plain = { input: String, view: String, step: String, text: String };

export const SPEED: ParamDef & { k: Key } = {
  k: 'sp',
  nm: '速さ',
  sym: '',
  name: '速さ',
  sub: '',
  unit: '回/秒',
  min: 1,
  max: 500,
  v: 10,
  ph: '例 10',
  list: [1, 2, 5, 10, 20, 50, 100, 200, 500],
  log: true,
  snap: true,
  notation: 'plain',
  format: plain,
  pre: [
    [2, '2'],
    [10, '10'],
    [100, '100'],
  ],
};

export const SIZE: ParamDef & { k: Key } = {
  k: 'n',
  nm: '要素数',
  sym: '',
  name: '要素数',
  sub: '',
  unit: '個',
  min: 8,
  max: 64,
  v: 24,
  ph: '例 24',
  list: [8, 12, 16, 24, 32, 48, 64],
  snap: true,
  notation: 'plain',
  format: plain,
  pre: [],
};

const dbIn = (v: number): string => minus(String(Math.round(v)));

export const VOL: ParamDef & { k: Key } = {
  k: 'vol',
  nm: '音量',
  sym: '',
  name: '音量',
  sub: '',
  unit: 'dB',
  min: -60,
  max: 0,
  v: -10,
  ph: '例 −20',
  list: linList(-60, 0, 1),
  jump: 6,
  sign: 'any',
  format: { input: dbIn, step: dbIn, text: (v) => `${dbIn(v)} dB` },
  pre: [],
};
