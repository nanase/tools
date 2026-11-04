/** VVVF のページの入力の定義 */
import { linList } from '../../lib/eseries';
import type { ParamDef } from '../../lib/param-def';
import { CARS, type CarId } from './cars';

const sig = (v: number, s: number) => String(Number(v.toPrecision(s)));
const dB = (v: number) => (v > 0 ? `+${sig(v, 3)}` : sig(v, 3).replace('-', '−'));

export type PKey = 'vol' | 'roadDb';

export const PARAMS: (ParamDef & { k: PKey })[] = [
  {
    k: 'vol',
    nm: '音量',
    sym: '',
    name: '音量',
    sub: '',
    unit: 'dB',
    min: -60,
    max: 0,
    v: -12,
    ph: '例 -12',
    list: linList(-60, 0, 1),
    jump: 6,
    sign: 'any',
    notation: 'plain',
    inputmode: 'decimal',
    format: { input: (v) => sig(v, 3), view: dB, step: dB, text: (v) => `${dB(v)} dB` },
    bad: '数を入れてください（例 -12）',
    pre: [
      [-30, '−30'],
      [-20, '−20'],
      [-12, '−12'],
      [-6, '−6'],
    ],
  },
  {
    k: 'roadDb',
    nm: '走行音の音量',
    sym: '',
    name: '走行音の音量',
    sub: 'VVVF の音との割合',
    unit: 'dB',
    min: -30,
    max: 6,
    v: -6,
    ph: '例 -6',
    list: linList(-30, 6, 1),
    jump: 6,
    sign: 'any',
    notation: 'plain',
    inputmode: 'decimal',
    format: { input: (v) => sig(v, 3), view: dB, step: dB, text: (v) => `${dB(v)} dB` },
    bad: '数を入れてください（例 -6）',
    pre: [
      [-12, '−12'],
      [-6, '−6'],
      [-3, '−3'],
      [0, '0'],
    ],
  },
];

type Opt = readonly (readonly [string, string] | readonly [string, string, string])[];
export const CAR_IDS = Object.keys(CARS) as CarId[];
export const SRC: Opt = [
  ['v', '線間電圧', '電圧の波形そのままの音'],
  ['f', '磁力', '鉄心を揺らす磁力から作る音'],
];
export const ROAD: Opt = [
  ['1', 'あり'],
  ['0', 'なし'],
];
/** 手動の段: [段, 名前, 種類] */
export const LEVERS = [
  [3, '加速 3', 'p'],
  [2, '加速 2', 'p'],
  [1, '加速 1', 'p'],
  [0, '惰行', 'n'],
  [-1, 'ブレーキ 1', 'b'],
  [-2, 'ブレーキ 2', 'b'],
  [-3, 'ブレーキ 3', 'b'],
] as const;
export const ECHO_OPT: Opt = [
  ['off', 'なし'],
  ['ground', '地上', '短く薄い反射'],
  ['tunnel', 'トンネル', '長い残響。走行音も大きい'],
];
export const RAIL_OPT: Opt = [
  ['0', 'なし', '継ぎ目の音なし'],
  ['25', '25 m', '定尺レール'],
  ['200', '200 m', 'ロングレール'],
];
export const SEAT_OPT: Opt = [
  ['end', '連結部寄り', '近くの 2 つの台車がはっきり聞こえる'],
  ['mid', '車両の中央', '前後の台車を同じくらいに聞く'],
];
export const ST_OPT: Opt = [
  ['1', 'あり'],
  ['0', 'なし'],
];
