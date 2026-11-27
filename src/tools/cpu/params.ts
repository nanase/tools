/** 4 ビット CPU のページの入力の定義（音量）。音量の行はリスト・キュー・スタックと同じで、既定値だけ変える */
import type { ParamDef } from '../../lib/param-def';
import { VOL as LS_VOL } from '../list-queue-stack/params';

export type Key = 'vol';

export const VOL: ParamDef & { k: Key } = { ...LS_VOL, k: 'vol', v: -10 };
