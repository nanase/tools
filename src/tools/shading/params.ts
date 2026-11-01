/** シェーディングのページの入力の定義 */
import { linList } from '../../lib/eseries';
import { minus } from '../../lib/format';
import type { ParamDef, ParamFormat } from '../../lib/param-def';

const sig = (v: number, s = 3): string => minus(String(Number(v.toPrecision(s))));

const fmtU = (u: string, s = 3): ParamFormat => ({
  input: (v) => sig(v, s),
  step: (v) => sig(v, s),
  text: (v) => `${sig(v, s)}${u ? ` ${u}` : ''}`,
});
const clamp =
  (min: number, max: number, text: (v: number) => string) =>
  (v: number): readonly [number, string] => {
    if (v < min) return [min, `${text(v)} は範囲外のため下限 ${text(min)} にしました`];
    if (v > max) return [max, `${text(v)} は範囲外のため上限 ${text(max)} にしました`];
    return [v, ''];
  };
function row(
  d: Omit<ParamDef, 'format' | 'fix' | 'pre' | 'notation'> & { s?: number; pre?: ParamDef['pre'] },
): ParamDef {
  const f = fmtU(d.unit, d.s);
  return {
    notation: 'plain',
    ...d,
    format: f,
    fix: clamp(d.min, d.max, f.text as (v: number) => string),
    pre: d.pre ?? [],
  };
}

export const INC = row({
  k: 'inc',
  nm: 'θ',
  sym: '<i>θ</i>',
  name: '光の角度',
  sub: '視線からの角度。90° を超えると後ろから当たる',
  unit: '°',
  min: 0,
  max: 179,
  v: 50,
  ph: '例 50',
  lin: { step: 1, big: 10 },
  s: 3,
  pre: [
    [0, '0'],
    [50, '50'],
    [90, '90'],
    [150, '150'],
  ],
});
export const AZ = row({
  k: 'az',
  nm: 'φ',
  sym: '<i>φ</i>',
  name: '光の方位',
  sub: '画面の右が 0°、上が 90°',
  unit: '°',
  min: -180,
  max: 180,
  v: 50,
  ph: '例 50',
  lin: { step: 5, big: 30 },
  sign: 'any',
  s: 3,
  pre: [
    [-90, '−90'],
    [0, '0'],
    [50, '50'],
    [90, '90'],
  ],
});
export const DIST = row({
  k: 'dist',
  nm: 'd',
  sym: '<i>d</i>',
  name: '光の距離',
  sub: '球の中心から。球の半径が 1',
  unit: '',
  min: 1.2,
  max: 20,
  v: 3,
  ph: '例 3',
  list: [1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 14, 20],
  log: true,
  s: 2,
  pre: [
    [1.5, '1.5'],
    [3, '3'],
    [10, '10'],
  ],
});
export const POWER = row({
  k: 'pw',
  nm: 'P',
  sym: '',
  name: '明るさ',
  sub: '1 で白い Lambert の明るさが 1',
  unit: '倍',
  min: 0.1,
  max: 8,
  v: 1,
  ph: '例 1',
  list: [0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.7, 1, 1.4, 2, 3, 4, 5.6, 8],
  log: true,
  s: 2,
  pre: [
    [0.5, '0.5'],
    [1, '1'],
    [2, '2'],
  ],
});
export const KELVIN = row({
  k: 'kv',
  nm: 'T',
  sym: '',
  name: '色温度',
  sub: '黒体の色',
  unit: 'K',
  min: 1800,
  max: 12000,
  v: 6500,
  ph: '例 6500',
  list: [...linList(1800, 3000, 100), ...linList(3200, 6600, 200), ...linList(7000, 12000, 500)].filter(
    (v, i, a) => a.indexOf(v) === i,
  ),
  s: 4,
  pre: [
    [2700, '2700'],
    [4000, '4000'],
    [5000, '5000'],
    [6500, '6500'],
    [10000, '10000'],
  ],
});
export const AMB = row({
  k: 'amb',
  nm: 'A',
  sym: '',
  name: '環境光',
  sub: '全方向から同じ明るさで来る光',
  unit: '',
  min: 0,
  max: 1,
  v: 0.06,
  ph: '例 0.06',
  lin: { step: 0.01, big: 0.1 },
  s: 2,
  pre: [
    [0, '0'],
    [0.06, '0.06'],
    [0.3, '0.3'],
    [1, '1'],
  ],
});
export const ROUGH = row({
  k: 'rough',
  nm: 'r',
  sym: '<i>r</i>',
  name: '粗さ',
  sub: 'α = r²。Blinn-Phong の指数は 2/α² − 2',
  unit: '',
  min: 0.05,
  max: 1,
  v: 0.35,
  ph: '例 0.35',
  lin: { step: 0.01, big: 0.1 },
  s: 2,
  pre: [
    [0.1, '0.1'],
    [0.35, '0.35'],
    [0.6, '0.6'],
    [1, '1'],
  ],
});
export const METAL = row({
  k: 'metal',
  nm: 'm',
  sym: '<i>m</i>',
  name: 'メタリック',
  sub: '1 で拡散がなくなり、色が鏡面の色になる',
  unit: '',
  min: 0,
  max: 1,
  v: 0,
  ph: '例 0',
  lin: { step: 0.01, big: 0.1 },
  s: 2,
  pre: [
    [0, '0'],
    [1, '1'],
  ],
});
export const F0 = row({
  k: 'f0',
  nm: 'F₀',
  sym: '<i>F</i><sub>0</sub>',
  name: '非金属の反射率',
  sub: '垂直に入る光の反射率。水 0.02、プラスチック 0.04、宝石 0.16',
  unit: '',
  min: 0,
  max: 0.16,
  v: 0.04,
  ph: '例 0.04',
  lin: { step: 0.005, big: 0.02 },
  s: 2,
  pre: [
    [0.02, '0.02'],
    [0.04, '0.04'],
    [0.08, '0.08'],
    [0.16, '0.16'],
  ],
});
export const DIV = row({
  k: 'div',
  nm: 'N',
  sym: '<i>N</i>',
  name: '分割数',
  sub: '球は緯度の分割数（経度は 2 倍）。床は縦横の分割数',
  unit: '',
  min: 3,
  max: 48,
  v: 10,
  ph: '例 10',
  list: [3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 48],
  s: 2,
  pre: [
    [5, '5'],
    [10, '10'],
    [24, '24'],
  ],
});

export const PARAMS: readonly ParamDef[] = [INC, AZ, DIST, POWER, KELVIN, AMB, ROUGH, METAL, F0, DIV];
export type Key = 'inc' | 'az' | 'dist' | 'pw' | 'kv' | 'amb' | 'rough' | 'metal' | 'f0' | 'div';
