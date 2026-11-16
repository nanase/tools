/** コード進行のページの既定値と入力の行 */
import { linList } from '../../lib/eseries';
import type { ParamDef } from '../../lib/param-def';

/** 音量の既定値 [dB]（既定のまま鳴らして −26 LUFS に合わせる） */
export const VOL0 = -18;

const bpmT = (v: number) => `♩=${Math.round(v)}`;
/** テンポ（4 分音符の数 / 分）。曲ごとの値で、保存は曲と一緒にする */
export const BPM: ParamDef & { k: 'bpm' } = {
  k: 'bpm',
  nm: 'テンポ',
  sym: '',
  name: 'テンポ',
  sub: '1 分間の 4 分音符の数',
  unit: '',
  min: 40,
  max: 220,
  v: 100,
  ph: '例 120',
  list: linList(40, 220, 2),
  jump: 5,
  notation: 'plain',
  format: { input: (v) => String(Math.round(v)), step: (v) => String(Math.round(v)), text: bpmT },
  fix: (v) => {
    const c = Math.min(220, Math.max(40, v)),
      w = Math.round(c);
    return [w, c !== v ? `${bpmT(v)} は範囲外のため${w === 220 ? '上限' : '下限'} ${bpmT(w)} にしました` : ''];
  },
  bad: '読めない値です（例 96・120）',
  pre: [
    [72, '72'],
    [96, '96'],
    [120, '120'],
    [144, '144'],
  ],
};
