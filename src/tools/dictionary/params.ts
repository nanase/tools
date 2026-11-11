/** ディクショナリのページの入力の定義（速さ・キーの数・音量）。速さと音量の行は二分ヒープと同じで、音量の既定値だけ変える */
import type { ParamDef } from '../../lib/param-def';
import { SPEED as HP_SPEED, VOL as HP_VOL } from '../binary-heap/params';

export type Key = 'sp' | 'n' | 'vol';

const plain = { input: String, view: String, step: String, text: String };

export const SPEED: ParamDef & { k: Key } = HP_SPEED;
export const VOL: ParamDef & { k: Key } = { ...HP_VOL, v: -3 };

/** 24 個で表は 32 か所になり、2 行の箱に収まる */
export const SIZE: ParamDef & { k: Key } = {
  k: 'n',
  nm: 'キーの数',
  sym: '',
  name: 'キーの数',
  sub: '',
  unit: '個',
  min: 12,
  max: 48,
  v: 24,
  ph: '例 24',
  list: [12, 24, 48],
  snap: true,
  notation: 'plain',
  format: plain,
  pre: [],
};
