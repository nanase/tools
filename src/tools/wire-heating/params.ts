/** 配線の発熱のページの入力の定義 */
import type { ParamDef } from '../../lib/param-def';
import type { Unit } from '../../lib/parse';
import { MAT, type MatId, SURF, type SurfId } from './wire';

export type PKey =
  | 'span'
  | 'I'
  | 'd'
  | 'w'
  | 't'
  | 'len'
  | 'scale'
  | 'f'
  | 'tp'
  | 'Ta'
  | 'wind'
  | 'bI'
  | 'bw'
  | 'tcu'
  | 'tb'
  | 'rate';

/** 1 桁の中の刻み（1・1.2・1.5・2・2.5・3・4・5・6・7・8） */
const MANT = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8];
function decades(lo: number, hi: number): number[] {
  const r: number[] = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++)
    for (const m of MANT) {
      const v = Number((m * 10 ** e).toPrecision(3));
      if (v >= lo * 0.999 && v <= hi * 1.001) r.push(v);
    }
  return r;
}
const plain = (unit: string) => ({
  input: (v: number) => String(Number(v.toPrecision(4))),
  text: (v: number) => `${Number(v.toPrecision(4))}${unit ? ` ${unit}` : ''}`,
});
type Row = Omit<ParamDef, 'k' | 'min' | 'max' | 'log' | 'snap'> & { k: PKey; list: readonly number[]; log?: boolean };
/** 並びの値から min・max を決める行 */
const row = (d: Row): ParamDef & { k: PKey } => ({
  log: true,
  snap: true,
  ...d,
  min: d.list[0],
  max: d.list[d.list.length - 1],
});
const mmRow = (
  k: PKey,
  nm: string,
  sym: string,
  name: string,
  sub: string,
  unit: Unit,
  list: number[],
  v: number,
  pre: [number, string][],
) => row({ k, nm, sym, name, sub, unit, list, v, ph: `例 ${pre[1][1]}`, notation: 'plain', format: plain(unit), pre });

export const PARAMS: (ParamDef & { k: PKey })[] = [
  row({
    k: 'I',
    nm: 'I',
    sym: '<i>I</i>',
    name: '電流',
    sub: '交流は実効値',
    unit: 'A',
    list: decades(0.01, 1000),
    v: 10,
    ph: '例 10',
    jump: 5,
    pre: [
      [1, '1'],
      [10, '10'],
      [100, '100'],
    ],
  }),
  mmRow('d', 'd', '<i>d</i>', '直径', '銅線の太さ', 'mm', decades(0.02, 20), 0.5, [
    [0.2, '0.2'],
    [0.5, '0.5'],
    [1.6, '1.6'],
  ]),
  mmRow('w', 'w', '<i>w</i>', '幅', '角線の幅', 'mm', decades(0.05, 100), 1, [
    [0.5, '0.5'],
    [1, '1'],
    [10, '10'],
  ]),
  mmRow('t', 't', '<i>t</i>', '厚さ', '角線の厚さ', 'mm', [0.018, 0.035, 0.07, 0.105, ...decades(0.15, 20)], 0.035, [
    [0.035, '0.035'],
    [0.5, '0.5'],
    [2, '2'],
  ]),
  mmRow('len', 'L', '<i>L</i>', '長さ', '端子の間の長さ', 'm', decades(0.01, 100), 0.2, [
    [0.1, '0.1'],
    [0.2, '0.2'],
    [1, '1'],
  ]),
  mmRow('scale', 'W', '', '図の幅', '経路を描く図の幅', 'm', decades(0.01, 10), 0.1, [
    [0.05, '0.05'],
    [0.1, '0.1'],
    [1, '1'],
  ]),
  row({
    k: 'f',
    nm: 'f',
    sym: '<i>f</i>',
    name: '周波数',
    sub: '交流の周波数',
    unit: 'Hz',
    list: decades(10, 100e6),
    v: 1e3,
    ph: '例 50',
    jump: 5,
    pre: [
      [50, '50'],
      [1e3, '1k'],
      [1e6, '1M'],
    ],
  }),
  row({
    k: 'tp',
    nm: 'tp',
    sym: '<i>t</i><sub>p</sub>',
    name: 'パルスの幅',
    sub: '電流を流す時間',
    unit: 's',
    list: decades(0.001, 600),
    v: 1,
    ph: '例 1',
    jump: 5,
    pre: [
      [0.01, '10m'],
      [1, '1'],
      [10, '10'],
    ],
  }),
  row({
    k: 'Ta',
    nm: 'Ta',
    sym: '<i>T</i><sub>a</sub>',
    name: '気温',
    sub: '周りの空気の温度',
    unit: '°C',
    list: Array.from({ length: 13 }, (_, i) => -20 + i * 10),
    log: false,
    v: 20,
    ph: '例 20',
    sign: 'any',
    notation: 'plain',
    format: plain('°C'),
    pre: [
      [0, '0'],
      [20, '20'],
      [40, '40'],
    ],
  }),
  row({
    k: 'wind',
    nm: 'v',
    sym: '<i>v</i>',
    name: '風速',
    sub: '線に直角に当たる風',
    unit: 'm/s',
    list: [0, 0.1, 0.2, 0.5, 1, 2, 3, 5, 10, 20],
    log: false,
    v: 0,
    ph: '例 1',
    sign: 'nonneg',
    notation: 'plain',
    format: plain('m/s'),
    pre: [
      [0, '0'],
      [1, '1'],
      [5, '5'],
    ],
  }),
  row({
    k: 'bI',
    nm: 'I',
    sym: '<i>I</i>',
    name: '電流',
    sub: '交流は実効値',
    unit: 'A',
    list: decades(0.01, 100),
    v: 3,
    ph: '例 3',
    jump: 5,
    pre: [
      [1, '1'],
      [3, '3'],
      [10, '10'],
    ],
  }),
  mmRow('bw', 'w', '<i>w</i>', '幅', '配線の幅（0.25 mm 刻み）', 'mm', [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3], 1, [
    [0.25, '0.25'],
    [1, '1'],
    [3, '3'],
  ]),
  mmRow('tcu', 't', '<i>t</i>', '銅箔の厚さ', '1 oz は 35 µm', 'µm', [12, 18, 35, 70, 105, 140], 35, [
    [18, '18'],
    [35, '35'],
    [70, '70'],
  ]),
  mmRow('tb', 'h', '<i>h</i>', '基板の厚さ', 'FR-4', 'mm', [0.4, 0.6, 0.8, 1, 1.2, 1.6, 2, 2.4, 3.2], 1.6, [
    [0.8, '0.8'],
    [1.6, '1.6'],
    [2.4, '2.4'],
  ]),
  row({
    k: 'span',
    nm: '観察時間',
    sym: '',
    name: '観察時間',
    sub: '通電から計算を続ける時間。自動は、定常になるか気温へ戻った時刻の 1.5 倍まで',
    unit: '',
    list: [0, 60, 120, 300, 600, 1200, 1800, 3600, 7200],
    log: false,
    v: 0,
    ph: '例 600（秒）',
    sign: 'nonneg',
    notation: 'plain',
    format: {
      input: String,
      view: (v) => spanText(v),
      step: (v) => spanText(v),
      text: (v) => spanText(v),
    },
    pre: [
      [0, '自動'],
      [600, '10 分'],
      [3600, '1 時間'],
    ],
  }),
  row({
    k: 'rate',
    nm: '速さ',
    sym: '',
    name: '速さ',
    sub: '再生の速さ',
    unit: '',
    list: [0.25, 0.5, 1, 2, 4],
    v: 1,
    ph: '例 1',
    notation: 'plain',
    format: { input: String, view: (v) => `×${v}`, step: (v) => `×${v}`, text: (v) => `${v} 倍` },
    pre: [
      [0.5, '0.5'],
      [1, '1'],
      [2, '2'],
    ],
  }),
];

/** 観察時間の表記（0 は自動） */
export function spanText(v: number): string {
  return v <= 0
    ? '自動'
    : v < 60
      ? `${v} 秒`
      : v < 3600
        ? `${Number((v / 60).toPrecision(3))} 分`
        : `${Number((v / 3600).toPrecision(3))} 時間`;
}

type Opt = readonly (readonly [string, string] | readonly [string, string, string])[];
export const FORM_OPT: Opt = [
  ['board', '基板'],
  ['line', '線'],
  ['path', '経路'],
];
export const MAT_OPT: Opt = (Object.keys(MAT) as MatId[]).map((k) => [k, MAT[k].n, `融点 ${MAT[k].mp} °C`]);
export const SHAPE_OPT: Opt = [
  ['round', '丸線'],
  ['rect', '角線'],
];
export const SURF_OPT: Opt = (Object.keys(SURF) as SurfId[]).map((k) => [
  k,
  SURF[k].n,
  k === 'pvc' ? 'PVC 0.4 mm・耐熱 105 °C' : `放射率 ${SURF[k].e}`,
]);
export const ENDS_OPT: Opt = [
  ['sink', '気温に固定', '端子へ熱が逃げる'],
  ['free', '断熱', '端子へ熱が逃げない'],
];
export const AC_OPT: Opt = [
  ['dc', '直流'],
  ['ac', '交流'],
];
export const MODE_OPT: Opt = [
  ['cont', '連続'],
  ['pulse', 'パルス'],
];
export const KIND_OPT: Opt = [
  ['line', '直線'],
  ['neck', 'くびれ'],
  ['corner', '直角'],
  ['meander', 'ミアンダ'],
];
export const PRESET_OPT: Opt = [
  ['line', '直線'],
  ['bend', 'U 字'],
  ['zig', 'ジグザグ'],
  ['spiral', '渦巻き'],
];
/** 経路の見本。座標は図の幅を 1 とした割合（縦は 0〜0.56、下向き） */
export const PRESET: Record<string, [number, number][]> = {
  line: [
    [0.08, 0.28],
    [0.36, 0.28],
    [0.64, 0.28],
    [0.92, 0.28],
  ],
  bend: [
    [0.08, 0.1],
    [0.62, 0.1],
    [0.84, 0.2],
    [0.84, 0.36],
    [0.62, 0.46],
    [0.08, 0.46],
  ],
  zig: (() => {
    const a: [number, number][] = [[0.06, 0.28]];
    for (let k = 0; k < 13; k++) a.push([0.14 + k * 0.06, k % 2 ? 0.48 : 0.08]);
    a.push([0.94, 0.28]);
    return a;
  })(),
  spiral: (() => {
    const a: [number, number][] = [];
    for (let k = 0; k <= 34; k++) {
      const u = k / 34,
        th = u * Math.PI * 5.2,
        r = 0.25 - 0.21 * u;
      a.push([0.5 + r * Math.cos(th) * 0.95, 0.28 + r * Math.sin(th) * 0.95]);
    }
    return a;
  })(),
};
/** 経路の図の縦横比（縦 ÷ 横） */
export const PATH_H = 0.56;
