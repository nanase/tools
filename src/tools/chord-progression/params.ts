/** コード進行のページの既定値と入力の行 */
import { linList } from '../../lib/eseries';
import { minus } from '../../lib/format';
import type { ParamDef } from '../../lib/param-def';

/** 音量の既定値 [dB]（既定のまま鳴らして −26 LUFS に合わせる） */
export const VOL0 = -18;

const dbIn = (v: number) => minus(v > 0 ? `+${Math.round(v)}` : String(Math.round(v)));
const dbT = (v: number) => `${dbIn(v)} dB`;
/** メトロノームの音量。0 dB で伴奏の和音とおおよそ同じ大きさ */
export const CLICK: ParamDef & { k: 'clk' } = {
  k: 'clk',
  nm: 'メトロノーム',
  sym: '',
  name: 'メトロノーム',
  sub: 'メトロノームの音量（音量の行に対する大きさ）',
  unit: 'dB',
  min: -24,
  max: 12,
  v: 0,
  ph: '例 −6',
  list: linList(-24, 12, 1),
  jump: 3,
  sign: 'any',
  format: { input: dbIn, step: dbIn, text: dbT },
  fix: (v) => {
    const c = Math.min(12, Math.max(-24, v)),
      w = Math.round(c);
    return [w, c !== v ? `${dbT(v)} は範囲外のため${w === 12 ? '上限' : '下限'} ${dbT(w)} にしました` : ''];
  },
  bad: '読めない値です（例 −6・+3）',
  pre: [
    [-12, '−12'],
    [-6, '−6'],
    [0, '0'],
    [6, '+6'],
  ],
};

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
