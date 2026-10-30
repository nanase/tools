/** ドップラー効果の入力の定義 */
import { linList } from '../../lib/eseries';
import { minus } from '../../lib/format';
import type { ParamDef, ParamFormat } from '../../lib/param-def';

/** 有効数字 s 桁、負はマイナス記号 */
const sig = (v: number, s = 4): string => minus(String(Number(v.toPrecision(s))));
const fmtU = (u: string, s = 4): ParamFormat => ({
  input: (v) => sig(v, s),
  step: (v) => sig(v, s),
  text: (v) => `${sig(v, s)} ${u}`,
});
/** 範囲外を丸める */
const clamp =
  (min: number, max: number, text: (v: number) => string) =>
  (v: number): readonly [number, string] => {
    if (v < min) return [min, `${text(v)} は範囲外のため下限 ${text(min)} にしました`];
    if (v > max) return [max, `${text(v)} は範囲外のため上限 ${text(max)} にしました`];
    return [v, ''];
  };
/** 並びを与えた数値の行 */
function row(
  d: Omit<ParamDef, 'format' | 'fix' | 'pre' | 'notation'> & {
    s?: number;
    pre?: ParamDef['pre'];
    format?: ParamFormat;
  },
): ParamDef {
  const f = d.format ?? fmtU(d.unit, d.s);
  return {
    ...d,
    notation: 'plain',
    format: f,
    fix: clamp(d.min, d.max, f.text as (v: number) => string),
    pre: d.pre ?? [],
  };
}
/** 区間ごとに刻みを変えた並び */
const steps = (...seg: [number, number, number][]): number[] => [
  ...new Set(seg.flatMap(([a, b, s]) => linList(a, b, s)).map((v) => Number(v.toFixed(6)))),
];

/** 20 °C の音速 [m/s]（プリセットのマッハ数の換算） */
const C20 = 343.2;
const mach = (m: number) => Math.round(m * C20 * 3.6);

export type SrcKey = 'v' | 'd';
/** 音源の速さ [km/h]。上限はマッハ 3（20 °C） */
export const SPEED: ParamDef = row({
  k: 'v',
  nm: 'v',
  sym: '<i>v</i>',
  name: '音源の速さ',
  sub: '道路に沿って左から右へ',
  unit: 'km/h',
  min: 5,
  max: mach(3),
  v: 60,
  ph: '例 60',
  list: steps([5, 100, 5], [100, 400, 10], [400, 1000, 50], [1000, mach(3), 100]).concat(mach(3)),
  log: true,
  jump: 5,
  pre: [
    [30, '30'],
    [60, '60'],
    [100, '100'],
    [300, '300'],
    [mach(0.8), 'M 0.8', 'マッハ 0.8（20 °C）'],
    [mach(1.5), 'M 1.5', 'マッハ 1.5（20 °C）'],
    [mach(2.2), 'M 2.2', 'マッハ 2.2（20 °C）'],
  ],
  s: 4,
});

/** 道路から聞き手までの距離 [m]（図で聞き手をドラッグしても変わる） */
export const DIST: ParamDef = row({
  k: 'd',
  nm: 'd',
  sym: '<i>d</i>',
  name: 'すれ違う距離',
  sub: '道路の中心から聞き手まで',
  unit: 'm',
  min: 1,
  max: 80,
  v: 10,
  ph: '例 10',
  list: steps([1, 10, 0.5], [10, 80, 1]),
  log: true,
  jump: 4,
  pre: [
    [3, '3'],
    [10, '10'],
    [30, '30'],
    [60, '60'],
  ],
  s: 3,
});

export type MoreKey = 'u' | 'tone' | 'temp' | 'rh';
/** 聞き手の速さ [km/h]（音源と同じ向きが正） */
export const LSPEED: ParamDef = row({
  k: 'u',
  nm: 'u',
  sym: '<i>u</i>',
  name: '聞き手の速さ',
  sub: '道路に沿って。右向きが正',
  unit: 'km/h',
  min: -300,
  max: 300,
  v: 0,
  ph: '例 −60',
  list: linList(-300, 300, 5),
  jump: 4,
  sign: 'any',
  pre: [
    [-60, '−60'],
    [0, '0'],
    [60, '60'],
  ],
  s: 3,
});

/** 正弦波の周波数 [Hz] */
export const TONE: ParamDef = row({
  k: 'tone',
  nm: 'f₀',
  sym: '<i>f</i><sub>0</sub>',
  name: '正弦波の周波数',
  sub: '音源を正弦波にしたとき',
  unit: 'Hz',
  min: 100,
  max: 4000,
  v: 1000,
  ph: '例 1000',
  list: steps([100, 1000, 10], [1000, 4000, 50]),
  log: true,
  jump: 10,
  pre: [
    [440, '440'],
    [1000, '1000'],
    [2000, '2000'],
  ],
  s: 4,
});

/** 気温 [°C] */
export const TEMP: ParamDef = row({
  k: 'temp',
  nm: 'T',
  sym: '<i>T</i>',
  name: '気温',
  sub: '音速と空気の吸収が変わる',
  unit: '°C',
  min: -20,
  max: 40,
  v: 20,
  ph: '例 20',
  list: linList(-20, 40, 1),
  jump: 5,
  sign: 'any',
  s: 3,
});

/** 相対湿度 [%] */
export const RH: ParamDef = row({
  k: 'rh',
  nm: 'RH',
  sym: '<i>h</i><sub>r</sub>',
  name: '湿度',
  sub: '相対湿度。空気の吸収が変わる',
  unit: '%',
  min: 5,
  max: 100,
  v: 50,
  ph: '例 50',
  list: linList(5, 100, 5),
  jump: 2,
  s: 3,
});

const dbIn = (v: number) => minus(String(Math.round(v)));
/** 音量 [dB]（0 dB で、音源から 10 m の音を −12 dBFS にする。音源ごとに大きさをそろえる） */
export const VOL: ParamDef = row({
  k: 'vol',
  nm: '音量',
  sym: '',
  name: '音量',
  sub: '0 dB で音源から 10 m の音を −12 dBFS（音源ごとにそろえる）',
  unit: 'dB',
  min: -60,
  max: 10,
  v: -10,
  ph: '例 −10',
  list: linList(-60, 10, 1),
  jump: 6,
  sign: 'any',
  format: { input: dbIn, step: dbIn, text: (v) => `${dbIn(v)} dB` },
});
