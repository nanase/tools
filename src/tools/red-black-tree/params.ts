/** 赤黒木のページの入力の定義（速さ・キーの数・音量）。速さと音量の行は二分ヒープと同じで、音量の既定値だけ変える */
import type { ParamDef } from '../../lib/param-def';
import { SPEED as HP_SPEED, VOL as HP_VOL } from '../binary-heap/params';

export type Key = 'sp' | 'n' | 'vol';

const plain = { input: String, view: String, step: String, text: String };

export const SPEED: ParamDef & { k: Key } = HP_SPEED;
export const VOL: ParamDef & { k: Key } = { ...HP_VOL, v: -5 };

/** 31 個で 5〜6 段になる。63 個はスマートフォンでは数字が読めないが、形は見える */
export const SIZE: ParamDef & { k: Key } = {
  k: 'n',
  nm: 'キーの数',
  sym: '',
  name: 'キーの数',
  sub: '',
  unit: '個',
  min: 7,
  max: 63,
  v: 31,
  ph: '例 31',
  list: [7, 15, 31, 63],
  snap: true,
  notation: 'plain',
  format: plain,
  pre: [],
};
