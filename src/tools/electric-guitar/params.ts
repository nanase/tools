/**
 * エレキギターの入力の定義: 機材の種類ごとのつまみ（数値の行）と選択肢、移調、音量の既定値。
 * 行は種類ごとに 1 組だけ作り、設定の窓を開いたペダルの値を出し入れする
 */
import type { ParamDef } from '../../lib/param-def';
import { FIXED, type Fixed, KINDS, type Kind, type KnobDef, type PickDef } from './pedals';

/** 音量の既定値 [dB]（既定のまま鳴らして −26 LUFS 前後） */
export const VOL0 = -14;

/** 種類（ペダル 12 種と、動かせない機材 3 つ） */
export type Any = Kind | Fixed;
export const defOf = (a: Any) => (a in FIXED ? FIXED[a as Fixed] : KINDS[a as Kind]);
export const ANY: readonly Any[] = ['pu', 'amp', 'cab', ...(Object.keys(KINDS) as Kind[])];

/** 範囲外を丸める */
const fix =
  (min: number, max: number, text: (v: number) => string, step: number) =>
  (v: number): readonly [number, string] => {
    const w = Number((Math.round(v / step) * step).toFixed(6));
    if (w < min) return [min, `${text(v)} は範囲外のため下限 ${text(min)} にしました`];
    if (w > max) return [max, `${text(v)} は範囲外のため上限 ${text(max)} にしました`];
    return [w, ''];
  };

/** 行の鍵: 種類_項目（例 od_gain） */
export const keyOf = (a: Any, k: string): string => `${a}_${k}`;
/** 設定の値と行の値の倍率 */
export const scaleOf = (d: KnobDef): number => d.scale ?? 10;
/** 種類 a のつまみ d の数値の行 */
function knobDef(a: Any, d: KnobDef): ParamDef {
  const min = d.min ?? 0,
    max = d.max ?? 10,
    step = d.step ?? 0.1,
    dig = d.dig ?? 1,
    unit = d.unit ?? '',
    show = (v: number) => v.toFixed(dig),
    text = (v: number) => (unit ? `${show(v)} ${unit}` : show(v));
  return {
    k: keyOf(a, d.k),
    nm: d.name,
    sym: '',
    name: d.name,
    sub: d.sub,
    unit,
    min,
    max,
    v: Number((d.v * scaleOf(d)).toFixed(6)),
    ph: `例 ${show((min + max) / 2)}`,
    lin: { step, big: step * 10 },
    notation: 'plain',
    sign: 'nonneg',
    format: { input: show, step: show, text },
    fix: fix(min, max, text, step),
    pre: [],
  };
}
/** 種類ごとの数値の行 */
export const KNOB_ROWS: Record<Any, ParamDef[]> = Object.fromEntries(
  ANY.map((a) => [a, defOf(a).knobs.map((d) => knobDef(a, d))]),
) as Record<Any, ParamDef[]>;
export const ALL_KNOB_ROWS = Object.values(KNOB_ROWS).flat();
/** 種類ごとの選択の行 */
export const PICK_ROWS: Record<Any, readonly PickDef[]> = Object.fromEntries(
  ANY.map((a) => [a, defOf(a).picks ?? []]),
) as Record<Any, readonly PickDef[]>;

/** 数値の行を、ほかの設定で使わないとき（無効にする理由） */
export function knobOff(a: Any, k: string, v: Record<string, number | string>): string {
  if (a === 'wah' && k === 'pedal' && v.mode !== 'manual') return 'オートでは使いません';
  if (a === 'wah' && k === 'sens' && v.mode === 'manual') return 'ペダルでは使いません';
  if (a === 'cab' && k === 'fb' && v.type === 'off') return 'スピーカーなしでは使いません';
  return '';
}

/** 移調の符号付きの表記 */
const keyText = (v: number): string => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0');
/** フレーズの移調 [半音]。上げるときはカポ、下げるときは調弦を下げる */
export const KEY: ParamDef & { k: 'key' } = {
  k: 'key',
  nm: '移調',
  sym: '',
  name: '移調',
  sub: 'フレーズの高さ [半音] · 上げるときはカポ、下げるときは全音下げのチューニングまで',
  unit: '',
  min: -2,
  max: 9,
  v: 0,
  ph: '例 +2',
  lin: { step: 1, big: 2 },
  notation: 'plain',
  sign: 'any',
  format: { input: keyText, step: keyText, text: (v) => `${keyText(v)} 半音` },
  fix: fix(-2, 9, (v) => `${keyText(v)} 半音`, 1),
  pre: [
    [-2, '−2'],
    [0, '0'],
    [2, '+2'],
    [5, '+5'],
  ],
};
