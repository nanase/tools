/**
 * 音律とうなりの入力の定義（基準ピッチ・音量）と選択肢（ピアノ）。
 * .astro の描画とブラウザの動作の両方で使う
 */
import { linList } from '../../lib/eseries';
import { minus } from '../../lib/format';
import type { ParamDef } from '../../lib/param-def';
import { PIANO_TYPES } from '../piano/strings';
import { REF } from '../tuner/params';

export type Key = 'ref' | 'vol';

/** 基準ピッチ（チューナーと同じ） */
export const A4: ParamDef & { k: Key } = REF;

const dbIn = (v: number): string => minus(String(Math.round(v)));
/** 音量 [dB]。全部分音の振幅の和（波形の最大）を 0 dB にした大きさ。既定値は楽器のページと同じ −10 dB */
export const VOL: ParamDef & { k: Key } = {
  k: 'vol',
  nm: '音量',
  sym: '',
  name: '音量',
  sub: 'スピーカーへ出す大きさ（0 dB ＝ 波形の最大がフルスケール）',
  unit: 'dB',
  min: -60,
  max: 0,
  v: -10,
  ph: '例 −20',
  list: linList(-60, 0, 1),
  jump: 6,
  sign: 'any',
  format: { input: dbIn, step: (v) => (v > 0 ? '+' : '') + dbIn(v), text: (v) => `${dbIn(v)} dB` },
  fix: (v) => {
    const c = Math.min(0, Math.max(-60, v)),
      w = Math.round(c);
    return [w, c === v ? '' : `${dbIn(v)} dB は範囲外のため${w === 0 ? '上限' : '下限'} ${dbIn(w)} dB にしました`];
  },
  bad: '読めない値です（例 −6・−20）',
  pre: [],
};

/** ピアノの大きさ（ピアノ音響モデルと同じ） */
export const PIANOS = PIANO_TYPES.map((p) => [p.v, p.name] as const);
/** 音律 A と B を入れ替える間隔 [ms] */
export const AB_MS = 2200;
/** ピアノを打ち直す間隔 [ms] */
export const REHIT_MS = 4400;
