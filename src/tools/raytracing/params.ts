/** レイトレーシングのページの入力の定義 */
import { linList } from '../../lib/eseries';
import { minus } from '../../lib/format';
import type { ParamDef, ParamFormat } from '../../lib/param-def';

/** 有効数字 s 桁、負はマイナス記号 */
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

export const MB = row({
  k: 'mb',
  nm: 'n',
  sym: '',
  name: '反射の上限',
  sub: 'ガラスでの屈折も 1 回',
  unit: '回',
  min: 1,
  max: 32,
  v: 8,
  ph: '例 8',
  list: [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 24, 32],
  s: 2,
  pre: [
    [1, '1'],
    [2, '2'],
    [8, '8'],
    [32, '32'],
  ],
});
export const LS = row({
  k: 'ls',
  nm: 's',
  sym: '',
  name: '大きさ',
  sub: '四角の 1 辺・球の直径（部屋の幅は 2 m）。変えても光の総量は同じ',
  unit: 'm',
  min: 0.05,
  max: 1.6,
  v: 0.5,
  ph: '例 0.5',
  list: [0.05, 0.07, 0.1, 0.14, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1, 1.2, 1.4, 1.6],
  log: true,
  s: 2,
  pre: [
    [0.1, '0.1'],
    [0.5, '0.5'],
    [1.2, '1.2'],
  ],
});
export const PW = row({
  k: 'pw',
  nm: 'P',
  sym: '',
  name: '明るさ',
  sub: '光の総量の倍率',
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
export const KV = row({
  k: 'kv',
  nm: 'T',
  sym: '',
  name: '色温度',
  sub: '黒体の色',
  unit: 'K',
  min: 1800,
  max: 12000,
  v: 4000,
  ph: '例 4000',
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
export const YAW = row({
  k: 'yaw',
  nm: 'θ',
  sym: '',
  name: '方位',
  sub: '画像を横にドラッグ',
  unit: '°',
  min: -30,
  max: 30,
  v: 0,
  ph: '例 0',
  lin: { step: 1, big: 5 },
  sign: 'any',
  s: 3,
  pre: [[0, '0']],
});
export const PITCH = row({
  k: 'pit',
  nm: 'φ',
  sym: '',
  name: '仰角',
  sub: '画像を縦にドラッグ',
  unit: '°',
  min: -15,
  max: 15,
  v: 0,
  ph: '例 0',
  lin: { step: 1, big: 5 },
  sign: 'any',
  s: 3,
  pre: [[0, '0']],
});

export const PARAMS: readonly ParamDef[] = [MB, LS, PW, KV, YAW, PITCH];
export type Key = 'mb' | 'ls' | 'pw' | 'kv' | 'yaw' | 'pit';

/** サンプル数の目標の範囲（2 の累乗） */
export const GOALS = Array.from({ length: 15 }, (_, i) => 2 ** i);
