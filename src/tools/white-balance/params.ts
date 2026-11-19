/** ホワイトバランスのページの数値入力の定義 */
import type { ParamDef } from '../../lib/param-def';

const int = (v: number) => String(Math.round(v));
const signed = (v: number) => (v > 0 ? `+${Math.round(v)}` : v < 0 ? `−${Math.round(-v)}` : '0');

/** 光 2 の明るさ [%] */
export const LP: ParamDef = {
  k: 'lp',
  nm: '光 2 の明るさ',
  sym: '',
  name: '光 2 の明るさ',
  sub: '2 つ目の光の強さ。0 % で光 1 だけ',
  unit: '%',
  min: 0,
  max: 200,
  v: 100,
  ph: '例 100',
  lin: { step: 5, big: 25 },
  sign: 'nonneg',
  notation: 'plain',
  inputmode: 'decimal',
  format: { input: int, step: int, text: (x) => `${int(x)} %` },
  bad: '数を入れてください（例 100）',
  pre: [
    [0, '0'],
    [50, '50'],
    [100, '100'],
    [200, '200'],
  ],
};

/** 色かぶり補正（+ で緑を弱める） */
export const TINT: ParamDef = {
  k: 'tint',
  nm: '色かぶり補正',
  sym: '',
  name: '色かぶり補正',
  sub: '緑と赤紫の向きの補正。+ で緑を弱める',
  unit: '',
  min: -50,
  max: 50,
  v: 0,
  ph: '例 0',
  lin: { step: 1, big: 10 },
  sign: 'any',
  notation: 'plain',
  inputmode: 'decimal',
  format: { input: int, view: signed, step: signed, text: signed },
  bad: '数を入れてください（例 0）',
  pre: [
    [-20, '−20'],
    [0, '0'],
    [20, '+20'],
  ],
};
