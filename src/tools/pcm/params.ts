/** PCM のページの入力の定義 */
import { linList } from '../../lib/eseries';
import type { ParamDef } from '../../lib/param-def';
import type { Law } from './pcm';

const sig = (v: number, s: number) => String(Number(v.toPrecision(s)));
const dB = (v: number) => (v > 0 ? `+${sig(v, 3)}` : sig(v, 3).replace('-', '−'));

export type PKey = 'fs' | 'bits' | 'f' | 'lv' | 'vol';

const FS_LIST = [1000, 2000, 4000, 6000, 8000, 11025, 16000, 22050, 32000, 44100, 48000, 96000, 192000];
const BIT_LIST = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20, 24];
/* 50 Hz〜24 kHz を対数で並べ、きりのよい値に丸める */
const F_LIST = [
  ...new Set(
    Array.from({ length: 65 }, (_, i) => {
      const v = 50 * 480 ** (i / 64);
      return v < 1000 ? Math.round(v / 10) * 10 : Math.round(v / 100) * 100;
    }),
  ),
];

export const PARAMS: (ParamDef & { k: PKey })[] = [
  {
    k: 'fs',
    nm: 'fs',
    sym: '<i>f</i><sub>s</sub>',
    name: '標本化周波数',
    sub: '1 秒に波の高さを測る回数（サンプリング周波数）',
    unit: 'Hz',
    min: 1000,
    max: 192000,
    v: 8000,
    ph: '例 44.1k',
    list: FS_LIST,
    log: true,
    snap: true,
    sig: 5,
    bad: '数を入れてください（例 8k・44.1k）',
    pre: [
      [8000, '8k', '電話'],
      [44100, '44.1k', 'CD'],
      [48000, '48k', '映像'],
      [96000, '96k'],
    ],
  },
  {
    k: 'bits',
    nm: 'N',
    sym: '<i>N</i>',
    name: 'ビット数',
    sub: '段階の数は 2 の N 乗',
    unit: 'bit',
    min: 1,
    max: 24,
    v: 4,
    ph: '例 16',
    list: BIT_LIST,
    snap: true,
    notation: 'plain',
    inputmode: 'decimal',
    format: { input: (v) => sig(v, 3), step: (v) => sig(v, 3), text: (v) => `${sig(v, 3)} bit` },
    bad: '数を入れてください（例 8・16）',
    pre: [
      [4, '4'],
      [8, '8'],
      [16, '16'],
      [24, '24'],
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
      [12000, '12k'],
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
export const AA: Opt = [
  ['1', 'あり', 'アンチエイリアスフィルタ'],
  ['0', 'なし', '高い音が折り返す'],
];
export const RC: Opt = [
  ['smooth', 'あり', '再構成フィルタ'],
  ['stair', 'なし', '階段状のまま'],
];
export const LAW: Opt = [
  ['lin', '線形'],
  ['mu', 'μ-law', 'G.711（8 bit）'],
  ['a', 'A-law', 'G.711（8 bit）'],
];
export const DITH: Opt = [
  ['0', 'なし'],
  ['1', 'TPDF', '三角分布の乱数を足す'],
];
/** 試聴する音（並びは Deck の列の番号） */
export const KEYS = [
  ['原音', 'k1'],
  ['標本化だけ', 'k2'],
  ['量子化だけ', 'k2'],
  ['両方', 'k3'],
] as const;

export interface Preset {
  name: string;
  fs: number;
  bits: number;
  law: Law;
  tip: string;
}
/** プリセット（ビットレートの小さい順）。実例の名前を言えるものだけを置く。値の根拠は Theory.astro の出典にある */
export const PRESETS: readonly Preset[] = [
  { name: '電話（日本・北米）', fs: 8000, bits: 8, law: 'mu', tip: '8 kHz・8 bit・μ-law' },
  { name: '電話（欧州など）', fs: 8000, bits: 8, law: 'a', tip: '8 kHz・8 bit・A-law' },
  { name: '初代 Sound Blaster', fs: 22050, bits: 8, law: 'lin', tip: '22.05 kHz・8 bit' },
  { name: 'CD', fs: 44100, bits: 16, law: 'lin', tip: '44.1 kHz・16 bit' },
  { name: 'DAT', fs: 48000, bits: 16, law: 'lin', tip: '48 kHz・16 bit' },
  { name: 'DVD-Video', fs: 48000, bits: 24, law: 'lin', tip: '48 kHz・24 bit' },
  { name: 'ハイレゾ', fs: 96000, bits: 24, law: 'lin', tip: '96 kHz・24 bit' },
  { name: 'Blu-ray', fs: 192000, bits: 24, law: 'lin', tip: '192 kHz・24 bit' },
];
