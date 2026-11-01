/** ローリングシャッターのページの入力の定義 */
import { linList } from '../../lib/eseries';
import { fmt, minus } from '../../lib/format';
import type { ParamDef, ParamFormat } from '../../lib/param-def';
import { MOTO } from './motion';

/** 有効数字 s 桁、負はマイナス記号 */
export const sig = (v: number, s = 3): string => minus(String(Number(v.toPrecision(s))));
/** 計算結果の表記（有効数字 3 桁、末尾の 0 を残す） */
export const sig3 = (v: number): string => {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const t = Math.abs(v) >= 1000 ? String(Number(v.toPrecision(3))) : v.toPrecision(3);
  return minus(t);
};

const fmtU = (u: string, s = 3): ParamFormat => ({
  input: (v) => sig(v, s),
  step: (v) => sig(v, s),
  text: (v) => `${sig(v, s)} ${u}`,
});
const clamp =
  (min: number, max: number, text: (v: number) => string) =>
  (v: number): readonly [number, string] => {
    if (v < min) return [min, `${text(v)} は範囲外のため下限 ${text(min)} にしました`];
    if (v > max) return [max, `${text(v)} は範囲外のため上限 ${text(max)} にしました`];
    return [v, ''];
  };
function row(
  d: Omit<ParamDef, 'format' | 'fix' | 'pre' | 'notation'> & {
    s?: number;
    pre?: ParamDef['pre'];
    format?: ParamFormat;
    notation?: ParamDef['notation'];
  },
): ParamDef {
  const f = d.format ?? fmtU(d.unit, d.s);
  return {
    notation: 'plain',
    ...d,
    format: f,
    fix: clamp(d.min, d.max, f.text as (v: number) => string),
    pre: d.pre ?? [],
  };
}
const steps = (...seg: [number, number, number][]): number[] => [
  ...new Set(seg.flatMap(([a, b, s]) => linList(a, b, s)).map((v) => Number(v.toFixed(6)))),
];

/* ---------- カメラ ---------- */
/**
 * 走査時間の例（静止画の電子シャッターで、最初の行から最後の行まで）。数値は第三者の計測で、
 * iPhone は CineD、ほかは horshack の計測（動作原理と式の出典）
 */
export const CAMS: readonly (readonly [key: string, label: string, tr: number, title: string])[] = [
  ['gs', 'グローバル', 0, 'グローバルシャッター（全部の行を同時に露光する。Sony α9 III など）'],
  ['z9', 'Z9', 3.73e-3, 'Nikon Z9（積層型）3.73 ms'],
  ['ip', 'iPhone', 5.3e-3, 'iPhone 15 Pro の主カメラ 5.3 ms'],
  ['r6', 'R6', 19.4e-3, 'Canon EOS R6 の電子シャッター 19.4 ms'],
  ['a7', 'α7 IV', 67.6e-3, 'Sony α7 IV の電子シャッター 67.6 ms'],
  ['gfx', 'GFX 50S', 299e-3, 'Fujifilm GFX 50S の電子シャッター 299 ms'],
];
/** 露光時間の例（シャッター速度の分母） */
export const SHUTTERS = [8000, 2000, 500, 125, 60, 30] as const;
/** 1/3 段ごとのシャッター速度（分母） */
const THIRDS = [
  16000, 12800, 10000, 8000, 6400, 5000, 4000, 3200, 2500, 2000, 1600, 1250, 1000, 800, 640, 500, 400, 320, 250, 200,
  160, 125, 100, 80, 60, 50, 40, 30, 25, 20, 15,
];
/** シャッター速度の表記（1/2000 など） */
export function shutter(s: number): string {
  const r = 1 / s;
  const near = THIRDS.find((x) => Math.abs(x - r) / x < 0.015);
  if (near) return `1/${near}`;
  return r >= 2 ? `1/${Math.round(r)}` : `${sig(s)}`;
}

export type Key = 'tr' | 'te' | 'rpm' | 'vt' | 'vc' | 'vb' | 'vg' | 'tg' | 'tm' | 'rr';

export const TR: ParamDef = {
  k: 'tr',
  nm: 'Tr',
  sym: '<i>T</i><sub>r</sub>',
  name: '走査時間',
  sub: '最初の行と最後の行の露光の始まりの差',
  unit: 's',
  min: 0,
  floor: 1e-4,
  max: 0.5,
  v: 19.4e-3,
  series: 24,
  ends: true,
  sign: 'nonneg',
  sig: 3,
  inputmode: 'decimal',
  ph: '例 19.4m',
  pre: CAMS.map(([, l, v, t]) => [v, l, t] as [number, string, string]).sort((a, b) => a[0] - b[0]),
};
export const TE: ParamDef = {
  k: 'te',
  nm: 'Te',
  sym: '<i>T</i><sub>e</sub>',
  name: '露光時間',
  sub: '1 行が光を受ける時間（シャッター速度）',
  unit: 's',
  min: 1 / 16000,
  max: 1 / 15,
  v: 1 / 2000,
  list: [...THIRDS].reverse().map((x) => 1 / x),
  log: true,
  sig: 3,
  inputmode: 'decimal',
  ph: '例 500u',
  pre: SHUTTERS.map((x) => [1 / x, `1/${x}`] as [number, string]).reverse(),
  format: { view: shutter, step: shutter, text: (v) => `${shutter(v)} s（${fmt(v, 's', 3)}）` },
};

/* ---------- 題材 ---------- */
export const RPM: ParamDef = row({
  k: 'rpm',
  nm: 'n',
  sym: '<i>n</i>',
  name: '回転数',
  sub: '1 分あたりの回転数',
  unit: 'rpm',
  min: 60,
  max: 12000,
  v: 2400,
  ph: '例 2400',
  list: steps([60, 600, 30], [600, 3000, 100], [3000, 12000, 500]),
  log: true,
  pre: [
    [1200, '扇風機', '扇風機 1200 rpm'],
    [2400, '飛行機', '小型機のプロペラ 2400 rpm'],
    [7200, 'ドローン', 'ドローンのプロペラ 7200 rpm'],
  ],
  s: 4,
});
const kmh = (k: Key, name: string, sub: string, v: number, min: number, max: number, pre: ParamDef['pre']): ParamDef =>
  row({
    k,
    nm: 'v',
    sym: k === 'vb' ? '<i>v</i><sub>b</sub>' : '<i>v</i>',
    name,
    sub,
    unit: 'km/h',
    min,
    max,
    v,
    ph: `例 ${v}`,
    list: steps([1, 20, 1], [20, 100, 5], [100, 400, 10]).filter((x) => x >= min && x <= max),
    log: true,
    pre,
    s: 3,
  });
export const VT = kmh('vt', '速さ', '左から右へ', 120, 10, 400, [
  [80, '80'],
  [130, '130'],
  [300, '300'],
]);
export const VC = kmh('vc', '車の速さ', '左から右へ', 60, 10, 200, [
  [30, '30'],
  [60, '60'],
  [100, '100'],
]);
export const VB = kmh('vb', '自転車の速さ', '車の手前を左から右へ', 18, 3, 40, [
  [12, '12'],
  [18, '18'],
  [30, '30'],
]);
const ms = (v: number) => `${minus(String(Math.round(v * 1000)))}`;
const timeRow = (
  k: Key,
  name: string,
  sub: string,
  v: number,
  min: number,
  max: number,
  step: number,
  pre: ParamDef['pre'],
): ParamDef =>
  row({
    k,
    nm: 't',
    sym: '<i>t</i>',
    name,
    sub,
    unit: 's',
    min,
    max,
    v,
    sign: 'any',
    ph: `例 ${v}`,
    lin: { step, big: step * 10 },
    pre,
    format: { input: (x) => sig(x, 3), step: (x) => `${ms(x)} ms`, view: (x) => ms(x), text: (x) => `${ms(x)} ms` },
  });
export const VG = row({
  k: 'vg',
  nm: 'V',
  sym: '<i>V</i>',
  name: 'ヘッドスピード',
  sub: 'インパクトでのクラブの先の速さ',
  unit: 'm/s',
  min: 20,
  max: 55,
  v: 40,
  ph: '例 40',
  lin: { step: 1, big: 5 },
  pre: [
    [33, '33'],
    [40, '40'],
    [50, '50'],
  ],
});
export const TG = timeRow('tg', 'インパクトからの時間', '負はインパクトの前', -0.01, -0.3, 0.25, 0.005, [
  [-0.2, '−200'],
  [-0.05, '−50'],
  [0, '0'],
]);
export const TM = timeRow('tm', '踏み切りからの時間', '頂上 0.77 s', 0.77, 0, MOTO.flight, 0.01, [
  [0.4, '400'],
  [0.77, '770'],
  [1.2, '1200'],
]);
export const RR = row({
  k: 'rr',
  nm: 'n',
  sym: '<i>n</i>',
  name: 'ローターの回転数',
  sub: '主ローター（テールローターは 5.2 倍）',
  unit: 'rpm',
  min: 60,
  max: 600,
  v: 390,
  ph: '例 390',
  list: steps([60, 600, 10]),
  log: true,
  pre: [
    [120, '120'],
    [390, '390'],
  ],
  s: 3,
});

export const PARAMS: readonly ParamDef[] = [TR, TE, RPM, VT, VC, VB, VG, TG, TM, RR];
/** 題材ごとに出す行 */
export const SUBJECT_ROWS = {
  prop: ['rpm', 'nb', 'rev'],
  train: ['vt'],
  car: ['vc', 'vb'],
  golf: ['vg', 'tg'],
  moto: ['tm'],
  heli: ['rr'],
} as const;
