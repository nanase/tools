/** トランペット音響モデルの入力の定義（数値の行・選択肢・表示の設定） */
import { linList } from '../../lib/eseries';
import { minus } from '../../lib/format';
import type { ParamDef, ParamFormat } from '../../lib/param-def';

/** 有効数字 s 桁、負はマイナス記号 */
const sig = (v: number, s = 4): string => minus(String(Number(v.toPrecision(s))));
const fmtU = (u: string, s = 4): ParamFormat => ({
  input: (v) => sig(v, s),
  step: (v) => sig(v, s),
  text: (v) => `${sig(v, s)}${u ? ` ${u}` : ''}`,
});
/** 範囲外を丸める */
const clamp =
  (min: number, max: number, text: (v: number) => string, step?: number) =>
  (v: number): readonly [number, string] => {
    const w = step ? Number((Math.round(v / step) * step).toFixed(6)) : v;
    if (w < min) return [min, `${text(v)} は範囲外のため下限 ${text(min)} にしました`];
    if (w > max) return [max, `${text(v)} は範囲外のため上限 ${text(max)} にしました`];
    return [w, ''];
  };
/** 一様な刻みの数値の行 */
function lin(
  d: Omit<ParamDef, 'list' | 'lin' | 'format' | 'fix' | 'pre'> & {
    step: number;
    big: number;
    s?: number;
    pre?: ParamDef['pre'];
  },
): ParamDef {
  const f = fmtU(d.unit, d.s);
  return {
    ...d,
    lin: { step: d.step, big: d.big },
    format: f,
    fix: clamp(d.min, d.max, f.text as (v: number) => string, d.step),
    pre: d.pre ?? [],
  };
}

/* ---------- 吹き方 ---------- */
export type BlowKey = 'pm' | 'fl';
export const PM: ParamDef = {
  ...lin({
    k: 'pm',
    nm: 'p_m',
    sym: '<i>p</i><sub>m</sub>',
    name: '口の圧力',
    sub: '口の中の息の圧力（大気圧との差）。高いほど大きく明るい音になる。強弱を選んでいる間は、強弱と音から決まる値を表示する',
    unit: 'kPa',
    min: 0.5,
    max: 15,
    v: 3.5,
    ph: '例 3.5',
    step: 0.1,
    big: 1,
    s: 3,
  }),
  list: linList(0.5, 15, 0.1),
  lin: undefined,
  sign: 'pos',
};
export const FLIP: ParamDef = {
  ...lin({
    k: 'fl',
    nm: 'f_L',
    sym: '<i>f</i><sub>L</sub>',
    name: '唇の共振',
    sub: '唇の張り（唇だけの共振周波数）。管の共鳴のうち、これより少し高いものが鳴る。唇が自動の間は、鳴らす音に合わせた値を表示する',
    unit: 'Hz',
    min: 100,
    max: 1200,
    v: 390,
    ph: '例 390',
    step: 1,
    big: 20,
    s: 4,
  }),
  list: linList(100, 1200, 1),
  lin: undefined,
  sign: 'pos',
};
/** 強弱の選択肢と、その音が鳴る口の圧力の範囲の中の位置（0〜1、対数） */
export const DYNS = [
  ['pp', 'pp', 0.04],
  ['p', 'p', 0.22],
  ['mp', 'mp', 0.4],
  ['mf', 'mf', 0.55],
  ['f', 'f', 0.78],
  ['ff', 'ff', 0.97],
] as const;
export const dynOf = (v: string): number => DYNS.find((d) => d[0] === v)?.[2] ?? 0.55;

/* ---------- 楽器 ---------- */
export const TEMP: ParamDef = lin({
  k: 'temp',
  nm: 'T',
  sym: '<i>T</i>',
  name: '管の中の温度',
  sub: '管の中の空気の温度。高いほど音速が速く、どの共鳴も高くなる（1 °C で約 3 セント）。唇の張りは 27 °C の調律のまま',
  unit: '°C',
  min: 10,
  max: 37,
  v: 27,
  ph: '例 27',
  step: 1,
  big: 5,
});

/* ---------- 部屋 ---------- */
export const DIST: ParamDef = lin({
  k: 'dist',
  nm: 'r',
  sym: '<i>r</i>',
  name: '聴く位置',
  sub: '楽器から聴く人までの距離。遠いほど、直接届く音に対して部屋の響きが大きくなる（全体の大きさは 1 m 先の直接音にそろえる）',
  unit: 'm',
  min: 1,
  max: 30,
  v: 8,
  ph: '例 8',
  step: 0.5,
  big: 2,
});

/* ---------- 演奏と音 ---------- */
/** 音量の初期値 [dB]（0 dB で、1 m 先の音圧 1 Pa をフルスケールにする）。トランペットは 1 m で 100 dB を超えるので低め */
export const VOL0 = -28;
/**
 * スローの速さ（実時間に対する割合の逆数）。B♭4（466 Hz）で 1 周期が 0.4・1.7・6.9 秒（1 周期 24 コマを 1 秒に 56・14・3.5 コマ。
 * 画面の書き換えより遅く）
 */
export const SLOW = [200, 800, 3200] as const;
/** 出力の波形に出す長さ [s] */
export const SPANS = [0.01, 0.05] as const;
/** スペクトラムの横軸の右端 [Hz] */
export const FMAX = [2000, 5000, 10000] as const;
