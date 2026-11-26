/** FMシンセサイザの演奏の枠の数値の行: 移調（ParamRow と ParamGroup で使う） */
import { linList } from '../../lib/eseries';
import type { ParamDef } from '../../lib/param-def';

const semIn = (v: number) => {
  const r = Math.round(v);
  return r > 0 ? `+${r}` : r < 0 ? `−${-r}` : '0';
};
const semT = (v: number) => `${semIn(v)} 半音`;

export const TRANSPOSE: ParamDef & { k: 'tr' } = {
  k: 'tr',
  nm: 'トランスポーズ',
  sym: '',
  name: 'トランスポーズ',
  sub: '曲と MIDI 機器の音を半音ずつ上げ下げ（パーカッションは移さない）',
  unit: '半音',
  min: -12,
  max: 12,
  v: 0,
  ph: '例 −2',
  list: linList(-12, 12, 1),
  jump: 12,
  sign: 'any',
  notation: 'plain',
  format: { input: semIn, step: semIn, text: semT },
  fix: (v) => {
    const c = Math.min(12, Math.max(-12, v)),
      w = Math.round(c);
    return [w, c !== v ? `${semT(v)} は範囲外のため${w === 12 ? '上限' : '下限'} ${semT(w)} にしました` : ''];
  },
  bad: '読めない値です（例 −2・+5）',
  pre: [
    [-12, '−12'],
    [0, '0'],
    [12, '+12'],
  ],
};
