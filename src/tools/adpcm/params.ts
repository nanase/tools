/** ADPCM のページの入力の定義 */
import { linList } from '../../lib/eseries';
import type { ParamDef } from '../../lib/param-def';
import { STEP } from './adpcm';

const sig = (v: number, s: number) => String(Number(v.toPrecision(s)));
const dB = (v: number) => (v > 0 ? `+${sig(v, 3)}` : sig(v, 3).replace('-', '−'));

export type PKey = 'fs' | 'bits' | 'f' | 'lv' | 'gap' | 'ms' | 'vol';

const FS_LIST = [4000, 6000, 8000, 11025, 16000, 22050, 32000, 44100, 48000];
const BIT_LIST = [2, 3, 4, 5];
const MS_LIST = [2, 5, 10, 20, 50, 100];
const F_LIST = [
  ...new Set(
    Array.from({ length: 65 }, (_, i) => {
      const v = 50 * 480 ** (i / 64);
      return v < 1000 ? Math.round(v / 10) * 10 : Math.round(v / 100) * 100;
    }),
  ),
];
const plain = (v: number) => sig(v, 6);

export const PARAMS: (ParamDef & { k: PKey })[] = [
  {
    k: 'fs',
    nm: 'fs',
    sym: '<i>f</i><sub>s</sub>',
    name: '標本化周波数',
    sub: '1 秒に波の高さを測る回数（サンプリング周波数）',
    unit: 'Hz',
    min: 4000,
    max: 48000,
    v: 8000,
    ph: '例 22k',
    list: FS_LIST,
    log: true,
    snap: true,
    sig: 5,
    bad: '数を入れてください（例 8k・22.05k）',
    pre: [
      [8000, '8k'],
      [22050, '22k'],
      [44100, '44.1k'],
    ],
  },
  {
    k: 'bits',
    nm: 'N',
    sym: '<i>N</i>',
    name: 'ビット数',
    sub: '1 標本に使うビットの数',
    unit: 'bit',
    min: 2,
    max: 5,
    v: 4,
    ph: '例 4',
    list: BIT_LIST,
    snap: true,
    notation: 'plain',
    inputmode: 'decimal',
    format: { input: plain, step: plain, text: (v) => `${plain(v)} bit` },
    bad: '数を入れてください（例 2・4）',
    pre: [
      [2, '2'],
      [3, '3'],
      [4, '4'],
      [5, '5'],
    ],
  },
  {
    k: 'f',
    nm: 'f',
    sym: '<i>f</i>',
    name: '周波数',
    sub: '正弦波とのこぎり波の基本周波数',
    unit: 'Hz',
    min: 50,
    max: 24000,
    v: 440,
    ph: '例 1k',
    list: F_LIST,
    log: true,
    bad: '数を入れてください（例 440・1k）',
    pre: [
      [440, '440'],
      [1000, '1k'],
      [5000, '5k'],
    ],
  },
  {
    k: 'lv',
    nm: '入力',
    sym: '',
    name: '入力レベル',
    sub: 'フルスケールが 0 dB',
    unit: 'dB',
    min: -60,
    max: 6,
    v: -3,
    ph: '例 -6',
    list: linList(-60, 6, 1),
    jump: 6,
    sign: 'any',
    notation: 'plain',
    inputmode: 'decimal',
    format: { input: (v) => sig(v, 3), view: dB, step: dB, text: (v) => `${dB(v)} dB` },
    bad: '数を入れてください（例 -6・0）',
    pre: [
      [-40, '−40'],
      [-20, '−20'],
      [-3, '−3'],
      [0, '0'],
    ],
  },
  {
    k: 'gap',
    nm: '間隔',
    sym: '',
    name: '段階の間隔',
    sub: '適応なしのときの固定の値（16 ビットの値）',
    unit: '',
    min: STEP[0],
    max: STEP[STEP.length - 1],
    v: 337,
    ph: '例 337',
    list: STEP,
    log: true,
    snap: true,
    notation: 'plain',
    inputmode: 'decimal',
    format: { input: plain, step: plain, text: plain },
    bad: '数を入れてください（例 337）',
    pre: [
      [34, '34'],
      [337, '337'],
      [3327, '3327'],
    ],
  },
  {
    k: 'ms',
    nm: '幅',
    sym: '',
    name: '表示の幅',
    sub: '拡大の図の時間の幅',
    unit: 'ms',
    min: 2,
    max: 100,
    v: 10,
    ph: '例 10',
    list: MS_LIST,
    log: true,
    snap: true,
    notation: 'plain',
    inputmode: 'decimal',
    format: { input: plain, step: plain, text: (v) => `${plain(v)} ms` },
    bad: '数を入れてください（例 10）',
    pre: [
      [2, '2'],
      [10, '10'],
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
    v: -20,
    ph: '例 -20',
    list: linList(-60, 0, 1),
    jump: 6,
    sign: 'any',
    notation: 'plain',
    inputmode: 'decimal',
    format: { input: (v) => sig(v, 3), view: dB, step: dB, text: (v) => `${dB(v)} dB` },
    bad: '数を入れてください（例 -20）',
    pre: [
      [-40, '−40'],
      [-30, '−30'],
      [-20, '−20'],
      [-10, '−10'],
    ],
  },
];

type Opt = readonly (readonly [string, string] | readonly [string, string, string])[];
export const PRED: Opt = [
  ['1', '前の値', '前の標本の値で予想'],
  ['0', 'なし', '予想なしで丸める'],
];
export const ADAPT: Opt = [
  ['1', 'あり', '音の大きさに合わせて間隔を調整'],
  ['0', 'なし', '間隔を固定'],
];
/** 試聴する音（並びは Deck の列の番号） */
export const KEYS = [
  ['原音', 'k1'],
  ['PCM', 'k2'],
  ['ADPCM', 'k2'],
  ['原音との差', 'k3'],
] as const;

export interface Preset {
  name: string;
  fs: number;
  bits: number;
  tip: string;
}
/** プリセット: どちらの形式も IMA の表を使い、標本化周波数は選べる値の 1 つ。値の根拠は Theory.astro の出典にある */
export const PRESETS: readonly Preset[] = [
  { name: 'Flash（2 bit）', fs: 22050, bits: 2, tip: '22.05 kHz・2 bit' },
  { name: 'Flash（5 bit）', fs: 22050, bits: 5, tip: '22.05 kHz・5 bit' },
  { name: 'WAV（22 kHz）', fs: 22050, bits: 4, tip: '22.05 kHz・4 bit' },
  { name: 'WAV（44 kHz）', fs: 44100, bits: 4, tip: '44.1 kHz・4 bit' },
];
