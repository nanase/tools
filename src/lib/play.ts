/**
 * 楽器のページ（ギター・ピアノ・オルガン）の演奏の枠の数値の行: テンポと音量（ParamRow と ParamGroup で使う）。
 * テンポは曲の標準の速さに対する %、音量は 0 dB で 1 m 先の音圧 1 Pa をフルスケールにする
 */
import { linList } from './eseries';
import { minus } from './format';
import type { ParamDef } from './param-def';
import { forget, store, stored } from './store';

export type PlayKey = 'tempo' | 'vol';

/** 範囲外を丸め、整数にする */
const intFix =
  (min: number, max: number, text: (v: number) => string) =>
  (v: number): readonly [number, string] => {
    const c = Math.min(max, Math.max(min, v)),
      w = Math.round(c);
    return [w, c !== v ? `${text(v)} は範囲外のため${w === max ? '上限' : '下限'} ${text(w)} にしました` : ''];
  };

const pctIn = (v: number) => String(Math.round(v));
const pctT = (v: number) => `${pctIn(v)} %`;
export const TEMPO: ParamDef & { k: PlayKey } = {
  k: 'tempo',
  nm: 'テンポ',
  sym: '',
  name: 'テンポ',
  sub: '曲の標準の速さに対する割合。演奏中も変えられる',
  unit: '%',
  min: 25,
  max: 150,
  v: 100,
  ph: '例 80',
  list: linList(25, 150, 5),
  jump: 5,
  notation: 'plain',
  format: { input: pctIn, step: pctIn, text: pctT },
  fix: intFix(25, 150, pctT),
  bad: '読めない値です（例 80・120）',
  pre: [
    [50, '50'],
    [75, '75'],
    [100, '100'],
    [125, '125'],
  ],
};

const dbIn = (v: number) => minus(String(Math.round(v)));
const dbT = (v: number) => `${dbIn(v)} dB`;
/** 音量の行。v0 は既定値 [dB] */
export const outVol = (v0: number): ParamDef & { k: PlayKey } => ({
  k: 'vol',
  nm: '音量',
  sym: '',
  name: '音量',
  sub: 'スピーカーへ出す大きさ（0 dB で、1 m 先の音圧 1 Pa をフルスケールにする）',
  unit: 'dB',
  min: -60,
  max: 0,
  v: v0,
  ph: '例 −20',
  list: linList(-60, 0, 1),
  jump: 6,
  sign: 'any',
  format: { input: dbIn, step: dbIn, text: dbT },
  fix: intFix(-60, 0, dbT),
  bad: '読めない値です（例 −6・−20）',
  pre: [],
});

/** 以前の保存（スライダーの tempo・vol）を、行の保存（p:tempo・p:vol）へ移す。ParamGroup を作る前に呼ぶ */
export function movePlayStore(): void {
  for (const k of ['tempo', 'vol']) {
    const v = stored(k);
    if (typeof v === 'number' && stored(`p:${k}`) === undefined) store(`p:${k}`, v);
    forget(k);
  }
}
