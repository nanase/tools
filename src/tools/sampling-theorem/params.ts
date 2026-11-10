/** 標本化定理のページの入力の定義 */
import { linList } from '../../lib/eseries';
import type { ParamDef } from '../../lib/param-def';
import { MUSIC } from '../pcm/music';
import type { SrcId } from './signal';

const sig = (v: number, s: number) => String(Number(v.toPrecision(s)));
const dB = (v: number) => (v > 0 ? `+${sig(v, 3)}` : sig(v, 3).replace('-', '−'));
type Opt = readonly (readonly [string, string] | readonly [string, string, string])[];

export type PKey = 'f' | 'fs' | 'vol';

/** 有効数字 3 桁に丸める（1 kHz 未満は 1 Hz、10 kHz 未満は 10 Hz、それ以上は 100 Hz の刻み） */
export const nice3 = (v: number): number => {
  const p = 10 ** (Math.floor(Math.log10(v)) - 2);
  return Math.round(Math.round(v / p) * p);
};
/** lo〜hi を対数で n 等分し、3 桁のきりのよい値に丸める */
function logList(lo: number, hi: number, n: number, extra: number[] = []): number[] {
  const a = Array.from({ length: n + 1 }, (_, i) => nice3(lo * (hi / lo) ** (i / n)));
  return [...new Set([...a, ...extra])].filter((v) => v >= lo && v <= hi).sort((x, y) => x - y);
}
export const F_MIN = 50,
  F_MAX = 20000,
  FS_MIN = 300,
  FS_MAX = 48000;
/** 有効数字 2 桁のきりのよい値（2 kHz・1.5 kHz など）を lo〜hi で並べる */
function roundList(lo: number, hi: number): number[] {
  const a: number[] = [];
  for (let p = 10 ** Math.floor(Math.log10(lo)); p <= hi; p *= 10) for (let m = 10; m < 100; m++) a.push((m * p) / 10);
  return a.filter((v) => v >= lo && v <= hi);
}
/* どちらも約 1 % 刻み（‹ › と矢印キーの 1 歩）に、きりのよい値を足す。Shift で 10 歩 */
const F_LIST = logList(F_MIN, F_MAX, 600, [440, ...roundList(F_MIN, F_MAX)]);
const FS_BASE = logList(FS_MIN, FS_MAX, 510, [11025, 22050, 44100, ...roundList(FS_MIN, FS_MAX)]);
/** 標本化周波数の並びに足す値（入力の周波数とその 2 倍。ページが入力に合わせて書き換え、refresh する） */
export const fsMarks: number[] = [];
const fsList = (): number[] =>
  [...new Set([...FS_BASE, ...fsMarks.filter((v) => v >= FS_MIN && v <= FS_MAX)])].sort((x, y) => x - y);

export const PARAMS: (ParamDef & { k: PKey })[] = [
  {
    k: 'f',
    nm: 'f',
    sym: '<i>f</i>',
    name: '周波数',
    sub: '正弦波などの周波数、和音の根音',
    unit: 'Hz',
    min: F_MIN,
    max: F_MAX,
    v: 1000,
    ph: '例 1k',
    list: F_LIST,
    log: true,
    jump: 10,
    bad: '数を入れてください（例 440・1k）',
    pre: [
      [440, '440'],
      [1000, '1k'],
      [5000, '5k'],
      [12000, '12k'],
    ],
  },
  {
    k: 'fs',
    nm: 'fs',
    sym: '<i>f</i><sub>s</sub>',
    name: '標本化周波数',
    sub: '1 秒に波の値を測る回数（サンプリング周波数）',
    unit: 'Hz',
    min: FS_MIN,
    max: FS_MAX,
    v: 8000,
    ph: '例 8k',
    list: fsList,
    log: true,
    jump: 10,
    sig: 5,
    bad: '数を入れてください（例 8k・44.1k）',
    pre: [
      [1000, '1k'],
      [8000, '8k', '電話'],
      [44100, '44.1k', 'CD'],
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

export const SRC: readonly (readonly [SrcId, string] | readonly [SrcId, string, string])[] = [
  ['sine', '正弦波'],
  ['square', '矩形波', '奇数の倍音が限りなく続く音'],
  ['saw', 'のこぎり波', 'すべての倍音が限りなく続く音'],
  ['tri', '三角波', '奇数の倍音が速く小さくなる音'],
  ['chord', '和音', '3 音 × 8 倍音'],
  ['sweep', 'スイープ', '50 Hz から 16 kHz まで 8 秒で上がる音'],
  ...MUSIC.map(([v, l, t]) => [v, l, `${t}（PCM・MP3 と同じ 4 秒の音源）`] as const),
];
export const AA: Opt = [
  ['0', 'なし', '高い成分も標本化'],
  ['1', 'あり', '標本化周波数の半分より上を除去'],
];
