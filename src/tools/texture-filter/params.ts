/** テクスチャのフィルタのページの数値入力の定義 */
import type { ParamDef } from '../../lib/param-def';
import { VOL as ENGINE_VOL } from '../engine/params';

const int = (v: number) => String(Math.round(v));

/** 見下ろす角度 [°]（水平から下向き） */
export const PITCH: ParamDef = {
  k: 'pitch',
  nm: '見下ろす角度',
  sym: '',
  name: '見下ろす角度',
  sub: '水平から下へ向ける角度。小さいほど道を浅く見る',
  unit: '°',
  min: 2,
  max: 30,
  v: 5,
  ph: '例 5',
  lin: { step: 1, big: 5 },
  sign: 'pos',
  notation: 'plain',
  inputmode: 'decimal',
  format: { input: int, step: int, text: (x) => `${int(x)}°` },
  bad: '数を入れてください（例 5）',
  fix: (v) => {
    const r = Math.round(v);
    if (r < 2) return [2, `${int(v)}° は範囲外のため下限 2° にしました`];
    if (r > 30) return [30, `${int(v)}° は範囲外のため上限 30° にしました`];
    return [r, ''];
  },
  pre: [
    [3, '3'],
    [5, '5'],
    [10, '10'],
    [20, '20'],
  ],
};

/** 音量の行はエンジンのページと同じ（既定の −12 dB で、走り続けたときに −26 LUFS 前後になる） */
export const VOL: ParamDef = ENGINE_VOL;
