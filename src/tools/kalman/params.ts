/** カルマンフィルタのページの入力の定義（数値の行・選択肢・場面） */
import type { ParamDef, ParamFormat } from '../../lib/param-def';
import type { Unit } from '../../lib/parse';

const BAD = '数を入れてください（例 0.3・1e-3）';
const sig = (v: number, s: number) => String(Number(v.toPrecision(s)));
const plainF = (u: string): ParamFormat => ({
  input: (v) => sig(v, 4),
  step: (v) => sig(v, 3),
  text: (v) => `${sig(v, 4)}${u ? ` ${u}` : ''}`,
});
/** 倍率の表記（×1/100・×1・×100） */
export const facText = (v: number): string => (v >= 1 ? `×${sig(v, 3)}` : `×1/${sig(1 / v, 3)}`);
const facF: ParamFormat = { input: (v) => sig(v, 4), view: facText, step: facText, text: facText };

/** 並びを与える行。min・max は並びの端 */
function listed(
  d: Omit<ParamDef, 'min' | 'max' | 'ph' | 'pre' | 'notation' | 'bad' | 'unit'> & {
    list: readonly number[];
    unit?: Unit;
    pre?: ParamDef['pre'];
    format?: ParamFormat;
  },
): ParamDef {
  return {
    unit: '',
    ...d,
    min: d.list[0],
    max: d.list[d.list.length - 1],
    ph: `例 ${d.v}`,
    pre: d.pre ?? [],
    notation: 'plain',
    sign: d.list[0] === 0 ? 'nonneg' : d.list[0] < 0 ? 'any' : 'pos',
    inputmode: 'decimal',
    bad: BAD,
    format: d.format ?? plainF(d.unit ?? ''),
  };
}

/* ---------- 本当の動きと雑音 ---------- */
export type TrueKey = 'sa' | 'sz' | 'v0';
export const TRUE: ParamDef[] = [
  listed({
    k: 'sa',
    nm: 'σa',
    sym: '<i>σ</i><sub><i>a</i></sub>',
    name: '加速度のゆらぎ',
    sub: '台車の加速度の標準偏差。加速度は観測の間隔ごとに変わる白色雑音で、その間は一定。0 なら等速で走り続ける',
    unit: 'm/s²',
    v: 0.3,
    list: [0, 0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 0.8, 1, 1.5, 2, 3, 5],
    log: false,
  }),
  listed({
    k: 'sz',
    nm: 'σz',
    sym: '<i>σ</i><sub><i>z</i></sub>',
    name: '観測の雑音',
    sub: '距離計の値に乗る雑音の標準偏差（白色の正規分布）',
    unit: 'm',
    v: 0.3,
    list: [0.01, 0.02, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 0.8, 1, 1.5, 2],
    log: true,
  }),
  listed({
    k: 'v0',
    nm: 'v0',
    sym: '<i>v</i><sub>0</sub>',
    name: '初めの速さ',
    sub: '台車が走り始めるときの本当の速さ。フィルタは速さ 0 から推定を始める',
    unit: 'm/s',
    v: 0.6,
    list: [-2, -1.5, -1, -0.6, -0.3, 0, 0.3, 0.6, 1, 1.5, 2],
  }),
];

/* ---------- フィルタの設定 ---------- */
export type FiltKey = 'fq' | 'fr' | 'sp0' | 'sv0';
const FAC = [0.0001, 0.001, 0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30, 100, 1000, 10000];
export const FILT: ParamDef[] = [
  listed({
    k: 'fq',
    nm: 'Q̂/Q',
    sym: '<i>Q̂</i>',
    name: 'ゆらぎの見積り',
    sub: 'フィルタが使う過程雑音の分散 Q̂ の、本当の分散 Q に対する倍率。小さくすると動きを過信し、観測を聞かなくなる',
    v: 1,
    list: FAC,
    log: true,
    format: facF,
    pre: [
      [0.001, '×1/1000'],
      [1, '×1'],
      [1000, '×1000'],
    ],
  }),
  listed({
    k: 'fr',
    nm: 'R̂/R',
    sym: '<i>R̂</i>',
    name: '雑音の見積り',
    sub: 'フィルタが使う観測の雑音の分散 R̂ の、本当の分散 R に対する倍率。小さくすると観測を信じすぎ、大きくすると観測を疑いすぎる',
    v: 1,
    list: FAC,
    log: true,
    format: facF,
    pre: [
      [0.01, '×1/100'],
      [1, '×1'],
      [100, '×100'],
    ],
  }),
  listed({
    k: 'sp0',
    nm: 'σp0',
    sym: '<i>σ</i><sub><i>p</i>0</sub>',
    name: '初めの位置の不確かさ',
    sub: '推定を始めるときの位置の標準偏差。本当の初めの位置も、この広さの正規分布から選ぶ',
    unit: 'm',
    v: 1.5,
    list: [0.1, 0.2, 0.3, 0.5, 1, 1.5, 2, 3, 5],
    log: true,
  }),
  listed({
    k: 'sv0',
    nm: 'σv0',
    sym: '<i>σ</i><sub><i>v</i>0</sub>',
    name: '初めの速度の不確かさ',
    sub: '推定を始めるときの速度の標準偏差。0 なら速度 0 と分かっているものとして始める',
    unit: 'm/s',
    v: 1,
    list: [0, 0.1, 0.2, 0.5, 1, 1.5, 2, 3],
  }),
];

/** 観測の間隔 s */
export const TS = [0.05, 0.1, 0.2, 0.5, 1] as const;
/** 再生の速さ */
export const SPEEDS = [1, 0.5, 0.2] as const;

/* ---------- 場面（入力の組。今の値と一致すれば選んだ表示にする） ---------- */
export interface Scene {
  v: string;
  name: string;
  title: string;
  vals: Partial<Record<TrueKey | FiltKey, number>>;
  /** 選んだときに先に進めておく更新の回数（雑音の誤りは時間がたつほどはっきりする） */
  warm: number;
}
export const SCENES: Scene[] = [
  {
    v: 'still',
    name: '止まった台車（1 次元）',
    title: '止まっていると分かっている台車の位置だけを推定する。推定は観測の平均になり、K は 1/k に近づく',
    vals: { sa: 0, v0: 0, sv0: 0, fq: 1, fr: 1 },
    warm: 3,
  },
  {
    v: 'run',
    name: '走る台車',
    title: '加速度がゆらぎながら走る台車の位置と速度を推定する',
    vals: { sa: 0.3, v0: 0.6, sv0: 1, fq: 1, fr: 1 },
    warm: 15,
  },
  {
    v: 'qlow',
    name: '動きを過信',
    title: '過程雑音の分散を本当の 1/1000 と見積もる。不確かさを小さく見積もり、観測を聞かなくなって推定が遅れる',
    vals: { sa: 0.3, v0: 0.6, sv0: 1, fq: 0.001, fr: 1 },
    warm: 120,
  },
  {
    v: 'rlow',
    name: '観測を信じすぎ',
    title: '観測の雑音の分散を本当の 1/100 と見積もる。推定が観測の雑音に振り回される',
    vals: { sa: 0.3, v0: 0.6, sv0: 1, fq: 1, fr: 0.01 },
    warm: 120,
  },
  {
    v: 'rhigh',
    name: '観測を疑いすぎ',
    title: '観測の雑音の分散を本当の 100 倍と見積もる。推定が鈍くなり、見積った範囲が広すぎる',
    vals: { sa: 0.3, v0: 0.6, sv0: 1, fq: 1, fr: 100 },
    warm: 120,
  },
];
