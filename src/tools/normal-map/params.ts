/** 法線マップのページの入力の定義 */
import { minus } from '../../lib/format';
import type { ParamDef } from '../../lib/param-def';

const sig = (v: number, s: number): string => minus(String(Number(v.toPrecision(s))));
function row(d: Omit<ParamDef, 'format' | 'fix' | 'pre' | 'notation'> & { s: number; pre: ParamDef['pre'] }): ParamDef {
  const text = (v: number) => `${sig(v, d.s)}${d.unit ? ` ${d.unit}` : ''}`;
  return {
    notation: 'plain',
    ...d,
    format: { input: (v) => sig(v, d.s), step: (v) => sig(v, d.s), text },
    fix: (v) => {
      if (v < d.min) return [d.min, `${text(v)} は範囲外のため下限 ${text(d.min)} にしました`];
      if (v > d.max) return [d.max, `${text(v)} は範囲外のため上限 ${text(d.max)} にしました`];
      return [v, ''];
    },
  };
}

export const EL = row({
  k: 'el',
  nm: '見る角度',
  sym: '',
  name: '見る角度',
  sub: '板の面からの角度。90° で真上から',
  unit: '°',
  min: 6,
  max: 89,
  v: 50,
  ph: '例 50',
  lin: { step: 1, big: 10 },
  s: 2,
  pre: [
    [15, '15'],
    [50, '50'],
    [89, '89'],
  ],
});
export const HS = row({
  k: 'hs',
  nm: '凹凸の高さ',
  sym: '',
  name: '凹凸の高さ',
  sub: '1 倍で板の幅の 4 %。比較では左右の両方に効く',
  unit: '倍',
  min: 0,
  max: 2,
  v: 1,
  ph: '例 1',
  lin: { step: 0.05, big: 0.25 },
  sign: 'nonneg',
  s: 3,
  pre: [
    [0, '0'],
    [0.5, '0.5'],
    [1, '1'],
    [2, '2'],
  ],
});

export const PARAMS: readonly ParamDef[] = [EL, HS];
export type Key = 'el' | 'hs';
