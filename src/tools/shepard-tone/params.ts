/** 無限音階のページの入力の定義 */
import { linList } from '../../lib/eseries';
import type { ParamDef } from '../../lib/param-def';
import { CHORDS, TIMBRES } from './shepard';

const sig = (v: number, s: number) => String(Number(v.toPrecision(s)));
const dB = (v: number) => (v > 0 ? `+${sig(v, 3)}` : sig(v, 3).replace('-', '−'));

export type PKey = 'rate' | 'wet' | 'vol' | 'center' | 'width';

export const PARAMS: (ParamDef & { k: PKey })[] = [
  {
    k: 'rate',
    nm: '速さ',
    sym: '',
    name: '速さ',
    sub: '1 秒に動く半音の数',
    unit: '半音/秒',
    min: 0.1,
    max: 8,
    v: 0.5,
    ph: '例 0.5',
    list: [0.1, 0.12, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8],
    log: true,
    jump: 3,
    notation: 'plain',
    inputmode: 'decimal',
    format: { input: (v) => sig(v, 3), step: (v) => sig(v, 3), text: (v) => `${sig(v, 3)} 半音/秒` },
    bad: '数を入れてください（例 0.5）',
    pre: [
      [0.25, '0.25'],
      [0.5, '0.5'],
      [1, '1'],
      [2, '2'],
      [4, '4'],
    ],
  },
  {
    k: 'wet',
    nm: '残響の量',
    sym: '',
    name: '残響の量',
    sub: '',
    unit: '%',
    min: 0,
    max: 100,
    v: 100,
    ph: '例 100',
    list: linList(0, 100, 5),
    jump: 2,
    sign: 'nonneg',
    notation: 'plain',
    inputmode: 'decimal',
    format: { input: (v) => sig(v, 3), step: (v) => sig(v, 3), text: (v) => `${sig(v, 3)} %` },
    bad: '数を入れてください（例 100）',
    pre: [
      [0, '0'],
      [25, '25'],
      [50, '50'],
      [75, '75'],
      [100, '100'],
    ],
  },
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
    k: 'center',
    nm: '中心',
    sym: '',
    name: '中心',
    sub: '音量が最も大きい高さ',
    unit: 'Hz',
    min: 160,
    max: 2500,
    v: 630,
    ph: '例 630',
    list: [160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500],
    log: true,
    jump: 3,
    notation: 'plain',
    inputmode: 'decimal',
    format: { input: (v) => sig(v, 4), step: (v) => sig(v, 4), text: (v) => `${sig(v, 4)} Hz` },
    bad: '数を入れてください（例 630）',
    pre: [
      [250, '250'],
      [630, '630'],
      [1250, '1250'],
    ],
  },
  {
    k: 'width',
    nm: '幅',
    sym: '',
    name: '幅',
    sub: '音が聞こえる高さの範囲',
    unit: 'オクターブ',
    min: 3,
    max: 9,
    v: 9,
    ph: '例 9',
    list: linList(3, 9, 0.5),
    jump: 2,
    notation: 'plain',
    inputmode: 'decimal',
    format: { input: (v) => sig(v, 2), step: (v) => sig(v, 2), text: (v) => `${sig(v, 2)} オクターブ` },
    bad: '数を入れてください（例 9）',
    pre: [
      [3, '3'],
      [5, '5'],
      [7, '7'],
      [9, '9'],
    ],
  },
];

type Opt = readonly (readonly [string, string] | readonly [string, string, string])[];
export const CHORD_OPT: Opt = Object.entries(CHORDS).map(([k, c]) => [k, c.name]);
export const TIMBRE_OPT: Opt = Object.entries(TIMBRES).map(([k, c]) => [k, c.name]);
export const DIR_OPT: Opt = [
  ['1', '上昇'],
  ['-1', '下降'],
];
export const STEP_OPT: Opt = [
  ['0', 'なめらか'],
  ['1', '半音ずつ'],
];

/** 残響の種類。t60 は残響時間 [s] */
export const REVERBS = {
  off: { name: 'なし', t60: 0 },
  room: { name: '部屋', t60: 0.5 },
  hall: { name: 'ホール', t60: 2.2 },
  church: { name: '大聖堂', t60: 6.5 },
} as const;
export type ReverbId = keyof typeof REVERBS;
export const REVERB_OPT: Opt = Object.entries(REVERBS).map(([k, r]) =>
  r.t60 ? [k, r.name, `残響時間 ${r.t60} 秒`] : [k, r.name],
);
