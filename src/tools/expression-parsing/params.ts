/** 式の構文解析のページの入力の定義。速さと音量の行は二分ヒープと同じで、音量の既定値だけ変える */
import type { ParamDef } from '../../lib/param-def';
import { VOL as HP_VOL, type Key } from '../binary-heap/params';

export { type Key, SPEED } from '../binary-heap/params';
export const VOL: ParamDef & { k: Key } = { ...HP_VOL, v: -4 };
