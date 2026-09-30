import { linList } from '../../lib/eseries';
import { minus } from '../../lib/format';
import type { ParamDef, ParamFormat } from '../../lib/param-def';

/** dB: 小数 2 桁まで */
const dbIn = (v: number): string => minus(String(Number(v.toFixed(2))));
const dbT = (v: number): string => `${dbIn(v)} dB`;
const DB: ParamFormat = { input: dbIn, step: (v) => (v > 0 ? '+' : '') + dbIn(v), text: dbT };

export type Key = 'f' | 'vol';

export const PARAMS: (ParamDef & { k: Key })[] = [
  {
    k: 'f',
    nm: 'f',
    sym: '<i>f</i>',
    name: '周波数',
    sub: '可聴音の高さ',
    unit: 'Hz',
    min: 20,
    max: 24000,
    v: 440,
    series: 12,
    ph: '例 1k',
    bad: '読めない値です（例 440・1k・1k5・1e3）',
    pre: [
      [100, '100'],
      [440, '440'],
      [1e3, '1k'],
      [2e3, '2k'],
      [4e3, '4k'],
      [1e4, '10k'],
    ],
    tk: [
      [20, '20'],
      [100, '100'],
      [1e3, '1k'],
      [1e4, '10k'],
    ],
  },
  {
    k: 'vol',
    nm: 'A',
    sym: '<i>A</i>',
    name: '音量',
    sub: '高出力のときの大きさ（0 dB = フルスケール）',
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
      const w = Math.min(0, Math.max(-60, v));
      return [w, w === v ? '' : `${dbT(v)} は範囲外のため${w === 0 ? '上限' : '下限'} ${dbT(w)} にしました`];
    },
    bad: '読めない値です（例 −6・−20）',
    pre: [],
    tk: [
      [-60, '−60'],
      [-40, '−40'],
      [-20, '−20'],
      [0, '0'],
    ],
  },
];
