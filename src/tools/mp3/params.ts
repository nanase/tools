/** MP3 のページの入力の定義 */
import { linList } from '../../lib/eseries';
import type { ParamDef } from '../../lib/param-def';
import { BITRATES } from './encoder';

export type PKey = 'kbps' | 'lp' | 'vol';

/** ローパスの値の「なし」（ナイキスト周波数） */
export const LP_NONE = 22050;
const LP_LIST = [...Array.from({ length: 17 }, (_, i) => 4000 + i * 1000), LP_NONE];
export const lpView = (v: number): string => (v >= LP_NONE ? 'なし' : `${Number((v / 1000).toFixed(1))}k`);
/** 文の中の表記（例 17 kHz） */
export const lpKHz = (v: number): string => `${Number((v / 1000).toFixed(1))} kHz`;
const dB = (v: number) => String(Number(v.toPrecision(3))).replace('-', '−');

/** LAME の lame.c の optimum_bandwidth の表 [Hz] */
export const LAME_LP: Readonly<Record<number, number>> = {
  32: 5500,
  40: 7000,
  48: 7500,
  56: 10000,
  64: 11000,
  80: 13500,
  96: 15100,
  112: 15600,
  128: 17000,
  160: 17500,
  192: 18600,
  224: 19400,
  256: 19700,
  320: 20500,
};

/** ビットレートを変えたあとのローパス。LAME の既定を選んでいれば新しいビットレートの既定へ追随する。0 はなし */
export const followLp = (lp: number, before: number, after: number): number =>
  lp === LAME_LP[before] ? LAME_LP[after] : lp;

export const PARAMS: (ParamDef & { k: PKey })[] = [
  {
    k: 'kbps',
    nm: 'ビットレート',
    sym: '',
    name: 'ビットレート',
    sub: '1 秒の音に使うビット数',
    unit: 'kbps',
    min: 32,
    max: 320,
    v: 128,
    ph: '例 128',
    list: BITRATES,
    snap: true,
    notation: 'plain',
    inputmode: 'decimal',
    format: { input: String, step: String, text: (v) => `${v} kbps` },
    bad: '数を入れてください（例 128）',
    pre: [
      [64, '64'],
      [128, '128'],
      [192, '192'],
      [320, '320'],
    ],
  },
  {
    k: 'lp',
    nm: 'fc',
    sym: '<i>f</i><sub>c</sub>',
    name: 'ローパス',
    sub: '圧縮の前に、この周波数より上を捨てる',
    unit: 'Hz',
    min: 4000,
    max: LP_NONE,
    v: LP_NONE,
    ph: '例 16k',
    list: LP_LIST,
    snap: true,
    format: { input: lpView, step: lpView, text: (v) => (v >= LP_NONE ? 'なし' : `${lpView(v)} Hz`) },
    bad: '数を入れてください（例 16k）',
    pre: [],
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
    format: { input: (v) => String(Number(v.toPrecision(3))), view: dB, step: dB, text: (v) => `${dB(v)} dB` },
    bad: '数を入れてください（例 -20）',
    pre: [
      [-40, '−40'],
      [-30, '−30'],
      [-20, '−20'],
      [-10, '−10'],
    ],
  },
];

/** 試聴する音（並びは Deck の列の番号） */
export const KEYS = [
  ['原音', 'k0'],
  ['MP3', 'k1'],
  ['原音との差', 'k2'],
] as const;
