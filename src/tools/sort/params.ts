/** ソートのページの入力の定義（速さ・要素数・音量） */
import { linList } from '../../lib/eseries';
import { minus } from '../../lib/format';
import type { ParamDef } from '../../lib/param-def';

export type Key = 'sp' | 'n' | 'vol';

const group = (v: number): string => v.toLocaleString('en-US');
const plain = { input: String, view: group, step: group, text: group };

export const SPEED: ParamDef & { k: Key } = {
  k: 'sp',
  nm: '速さ',
  sym: '',
  name: '速さ',
  sub: '',
  unit: '回/秒',
  min: 1,
  max: 100000,
  v: 200,
  ph: '例 200',
  list: [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000],
  log: true,
  snap: true,
  notation: 'plain',
  format: plain,
  pre: [
    [10, '10'],
    [200, '200'],
    [5000, '5,000'],
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
  max: 1024,
  v: 128,
  ph: '例 128',
  list: [8, 16, 32, 64, 128, 256, 512, 1024],
  log: true,
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
  v: -18,
  ph: '例 −20',
  list: linList(-60, 0, 1),
  jump: 6,
  sign: 'any',
  format: { input: dbIn, step: dbIn, text: (v) => `${dbIn(v)} dB` },
  pre: [],
};
