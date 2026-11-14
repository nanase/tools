/** 振り子時計の音の枠の数値の行（ParamRow と ParamGroup で使う） */
import { linList } from '../../lib/eseries';
import { minus } from '../../lib/format';
import type { ParamDef } from '../../lib/param-def';

const dbIn = (v: number) => minus(`${v > 0 ? '+' : ''}${Math.round(v)}`);
const dbT = (v: number) => `${dbIn(v)} dB`;
/** 音量 [dB]。0 dB でほかの音の出るページと同じ大きさ（−26 LUFS） */
export const VOL: ParamDef = {
  k: 'vol',
  nm: '音量',
  sym: '',
  name: '音量',
  sub: '0 dB でほかの音の出るページと同じ大きさ。0 dB より上げると、割れないよう出口で抑える',
  unit: 'dB',
  min: -40,
  max: 12,
  v: 0,
  ph: '例 −6',
  list: linList(-40, 12, 1),
  jump: 6,
  sign: 'any',
  format: { input: dbIn, step: dbIn, text: dbT },
  fix: (v) => {
    const c = Math.min(12, Math.max(-40, v)),
      w = Math.round(c);
    return [w, c !== v ? `${dbT(v)} は範囲外のため${w === 12 ? '上限' : '下限'} ${dbT(w)} にしました` : ''];
  },
  bad: '読めない値です（例 −6・+3）',
  pre: [],
};
