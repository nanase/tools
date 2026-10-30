/** ウェーブレット変換のページの入力の定義（数値の行と選択肢） */
import { linList } from '../../lib/eseries';
import type { ParamDef } from '../../lib/param-def';
import type { Wav } from './dwt';
import { SIGS, type Sig } from './signals';

const sig = (v: number, s: number) => String(Number(v.toPrecision(s)));
const fac = (v: number) => `×${sig(v, 3)}`;

export type ShKey = 'lam' | 'keep';
export const SHRINK: (ParamDef & { k: ShKey })[] = [
  {
    k: 'lam',
    nm: 'λ',
    sym: '<i>λ</i>',
    name: '閾値',
    sub: '普遍閾値 σ̂√(2 ln N) に掛ける倍率。大きいほど多く捨てる',
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
      [1, '×1', '普遍閾値'],
      [2, '×2'],
    ],
  },
  {
    k: 'keep',
    nm: '残す',
    sym: '',
    name: '残す係数',
    sub: '大きい順に残す係数の割合',
    unit: '%',
    min: 0.5,
    max: 100,
    v: 5,
    ph: '例 5',
    list: [0.5, 1, 1.5, 2, 3, 4, 5, 7, 10, 15, 20, 30, 50, 70, 100],
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

/** 信号の選択肢（並べる順に） */
export const sigs = (...v: Sig[]) => v.map((s) => [s, SIGS.find((x) => x[0] === s)?.[1] ?? s] as const);
export const WAV3: readonly (readonly [Wav, string])[] = [
  ['haar', 'Haar'],
  ['db2', 'db2'],
  ['db4', 'db4'],
];
