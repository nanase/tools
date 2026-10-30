/** ウェーブレット変換での雑音除去と圧縮のページの入力の定義（数値の行と選択肢） */
import { linList } from '../../lib/eseries';
import type { ParamDef } from '../../lib/param-def';

const sig = (v: number, s: number) => String(Number(v.toPrecision(s)));
const fac = (v: number) => `×${sig(v, 3)}`;

export type PKey = 'snr' | 'k' | 'keep';
export const PARAMS: (ParamDef & { k: PKey })[] = [
  {
    k: 'snr',
    nm: 'SN 比',
    sym: '',
    name: '雑音の量',
    sub: '原音と足す雑音の実効値の比。小さいほど雑音が大きい',
    unit: 'dB',
    min: 0,
    max: 30,
    v: 10,
    ph: '例 10',
    list: linList(0, 30, 1),
    jump: 5,
    sign: 'nonneg',
    notation: 'plain',
    inputmode: 'decimal',
    format: { input: (v) => sig(v, 3), step: (v) => sig(v, 3), text: (v) => `${sig(v, 3)} dB` },
    bad: '数を入れてください（例 10・20）',
    pre: [
      [5, '5'],
      [10, '10'],
      [20, '20'],
    ],
  },
  {
    k: 'k',
    nm: 'λ',
    sym: '<i>λ</i>',
    name: '閾値の倍率',
    sub: '規則で決めた閾値に掛ける倍率。大きいほど多く捨てる',
    unit: '',
    min: 0,
    max: 3,
    v: 1,
    ph: '例 1',
    list: linList(0, 3, 0.05),
    jump: 4,
    sign: 'nonneg',
    notation: 'plain',
    inputmode: 'decimal',
    format: { input: (v) => sig(v, 3), view: fac, step: fac, text: fac },
    bad: '数を入れてください（例 0.8・1.5）',
    pre: [
      [0.5, '×0.5'],
      [1, '×1', '規則のまま'],
      [2, '×2'],
    ],
  },
  {
    k: 'keep',
    nm: '残す',
    sym: '',
    name: '残す係数',
    sub: '信号の長さに対する、残す係数の数の割合。どの基底でも同じ数を残す',
    unit: '%',
    min: 0.5,
    max: 30,
    v: 5,
    ph: '例 5',
    list: [0.5, 1, 2, 3, 5, 7, 10, 15, 20, 30],
    log: true,
    snap: true,
    notation: 'plain',
    inputmode: 'decimal',
    format: { input: (v) => sig(v, 3), step: (v) => sig(v, 3), text: (v) => `${sig(v, 3)} %` },
    bad: '数を入れてください（例 5・20）',
    pre: [
      [1, '1 %'],
      [5, '5 %'],
      [20, '20 %'],
    ],
  },
];

type Opt = readonly (readonly [string, string] | readonly [string, string, string])[];
export const NOISE: Opt = [
  ['white', '白色', 'どの周波数にも同じ強さ'],
  ['pink', 'ピンク', '低いほど強い（1/f）。閾値処理の苦手な例'],
  ['none', '足さない', '元から雑音のある録音に'],
];
export const RULE: Opt = [
  ['universal', 'VisuShrink', '普遍閾値 σ√(2 ln N)。全段で 1 つ'],
  ['sure', 'SureShrink', '段ごとに SURE が最小の閾値'],
  ['bayes', 'BayesShrink', '段ごとに σ²/σX'],
];
export const SHRINK: Opt = [
  ['hard', '硬い', '閾値より小さい係数を 0 にする'],
  ['soft', '柔らかい', 'さらに残す係数を λ だけ 0 へ寄せる'],
];
export const SIGMA: Opt = [
  ['global', '最も細かい段', '最も細かい段の係数の中央値から 1 つ'],
  ['quiet', '雑音だけから', '雑音だけの音から段ごとに。雑音を足したときは足した雑音、足さないときは最も静かな 0.4 秒'],
];
export const SPIN: Opt = [
  ['1', 'しない'],
  ['8', '8 回', '0〜7 点ずらして除き、戻して平均する'],
];
export const WAV: Opt = [
  ['haar', 'Haar', '長さ 2 の階段の波'],
  ['db2', 'db2', 'Daubechies の長さ 4 の波'],
  ['db4', 'db4', 'Daubechies の長さ 8 の波'],
];
