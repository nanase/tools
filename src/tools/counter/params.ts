/** カウンタと分周のページの入力の定義（速さ・音量） */
import { linList, pow2List } from '../../lib/eseries';
import { minus } from '../../lib/format';
import type { ParamDef } from '../../lib/param-def';
import { fmtSpeed, SP_MAX, SP_MIN } from './model';

export type Key = 'sp' | 'vol';

/** 時計の速さ。1/32768 から ×4096 まで 2 倍刻み。1/32768 で水晶が 1 秒に 1 回振れる */
export const SPEED: ParamDef & { k: Key } = {
  k: 'sp',
  nm: '速さ',
  sym: '',
  name: '速さ',
  sub: '実際の時間に対する時計の進み方（1/32768 で水晶の振動が 1 秒に 1 回）',
  unit: '',
  min: 2 ** SP_MIN,
  max: 2 ** SP_MAX,
  v: 1,
  ph: '例 0.25',
  list: pow2List(SP_MIN, SP_MAX),
  log: true,
  jump: 3,
  snap: true,
  notation: 'plain',
  sig: 8,
  format: { view: fmtSpeed, step: fmtSpeed, text: fmtSpeed },
  bad: '読めない値です（例 0.25・8）',
  pre: [
    [2 ** SP_MIN, '1/32768'],
    [2 ** -10, '1/1024'],
    [1, '×1'],
    [2 ** SP_MAX, '×4096'],
  ],
};

const dbIn = (v: number) => minus(String(Math.round(v)));
/** 音量 [dB]。既定の −3 dB で、正弦波の段も短い音の段もほかの音の出るページと同じくらい（−26 LUFS）の大きさ */
export const VOL: ParamDef & { k: Key } = {
  k: 'vol',
  nm: '音量',
  sym: '',
  name: '音量',
  sub: '',
  unit: 'dB',
  min: -40,
  max: 0,
  v: -3,
  ph: '例 −20',
  list: linList(-40, 0, 1),
  jump: 6,
  sign: 'any',
  format: { input: dbIn, step: dbIn, text: (v) => `${dbIn(v)} dB` },
  pre: [],
};
