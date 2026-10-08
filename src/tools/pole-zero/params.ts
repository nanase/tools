/** 極と零点のページの入力の定義（数値の行・選択肢・プリセット） */
import { linList, pow2List } from '../../lib/eseries';
import { fmt, minus, parts } from '../../lib/format';
import type { ParamDef, ParamFormat } from '../../lib/param-def';
import { type GainMode, polar, type Spot } from './pz';

/* ---------- 表記 ---------- */
const hzIn = (v: number): string => {
  const [n, x] = parts(v, '', 5);
  return x ? `${n} ${x}` : n;
};
export const hzT = (v: number): string => fmt(v, 'Hz', 5);
const HZ: ParamFormat = { input: hzIn, step: (v) => parts(v, '', 4).join(''), text: hzT };
const dbIn = (v: number): string => minus(String(Number(v.toFixed(2))));
const dbT = (v: number): string => `${dbIn(v)} dB`;
const DB: ParamFormat = { input: dbIn, step: (v) => (v > 0 ? '+' : '') + dbIn(v), text: dbT };
const num = (v: number): string => minus(String(Number(v.toPrecision(6))));
const NUM: ParamFormat = { input: num, step: (v) => minus(String(Number(v.toPrecision(4)))), text: num };
const degT = (v: number): string => `${num(v)}°`;
const DEG: ParamFormat = { input: num, step: num, text: degT };

/** 範囲外を丸める */
const clamp =
  (min: number, max: number, text: (v: number) => string) =>
  (v: number): readonly [number, string] => {
    const w = Math.min(max, Math.max(min, v));
    return [w, w === v ? '' : `${text(v)} は範囲外のため${w === max ? '上限' : '下限'} ${text(w)} にしました`];
  };

/* ---------- 選んだ点の位置（保存しない。点の並びと一緒に保存する） ---------- */
export type SelKey = 'r' | 'th';

/** 半径の上限（z 平面の表示は 4.5 まで） */
export const RMAX = 4;
/** 半径の並び: 単位円の近くを細かく */
const RLIST = [
  ...linList(0, 0.8, 0.05),
  ...linList(0.82, 0.9, 0.02),
  ...linList(0.91, 0.98, 0.01),
  ...linList(0.982, 0.998, 0.002),
  1,
  ...linList(1.002, 1.01, 0.002),
  ...linList(1.02, 1.1, 0.02),
  ...linList(1.15, 2, 0.05),
  ...linList(2.1, RMAX, 0.1),
];

export const SEL: (ParamDef & { k: SelKey })[] = [
  {
    k: 'r',
    nm: 'r',
    sym: '<i>r</i>',
    name: '半径',
    sub: '原点からの距離。極は 1 以上で不安定になる',
    unit: '',
    min: 0,
    max: RMAX,
    v: 0.9,
    ph: '例 0.95',
    list: RLIST,
    jump: 5,
    sign: 'nonneg',
    notation: 'plain',
    sig: 6,
    format: NUM,
    fix: clamp(0, RMAX, num),
    stepLabel: ' ',
    inputmode: 'decimal',
    pre: [
      [0, '0'],
      [0.5, '0.5'],
      [0.9, '0.9'],
      [0.99, '0.99'],
      [1, '1'],
    ],
  },
  {
    k: 'th',
    nm: 'θ',
    sym: '<i>θ</i>',
    name: '角度',
    sub: '実軸の正の向きからの角度。180° が fs/2 にあたる。0° と 180° は実軸の上の 1 個、ほかは共役の対',
    unit: '°',
    min: 0,
    max: 180,
    v: 45,
    ph: '例 30',
    lin: { step: 1, big: 15 },
    sign: 'nonneg',
    notation: 'plain',
    sig: 6,
    format: DEG,
    fix: clamp(0, 180, degT),
    inputmode: 'decimal',
    pre: [
      [0, '0'],
      [45, '45'],
      [90, '90'],
      [135, '135'],
      [180, '180'],
    ],
  },
];

/* ---------- 設定（保存する） ---------- */
export type Key = 'fs' | 'bot' | 'vol' | 'sf';

export const FS0 = 48e3;
const FSLIST = [
  10, 20, 50, 100, 200, 500, 1e3, 2e3, 5e3, 8e3, 11025, 16e3, 22050, 24e3, 32e3, 44100, 48e3, 88200, 96e3, 176400,
  192e3,
];
/** ISO 266 の 1/3 オクターブ（R10）で 20 Hz … 2 kHz */
const SAWLIST = [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1e3, 1250, 1600, 2e3];

export const PARAMS: (ParamDef & { k: Key })[] = [
  {
    k: 'fs',
    nm: 'fs',
    sym: '<i>f</i><sub>s</sub>',
    name: 'サンプリング周波数',
    sub: '周波数の目盛りと共振の周波数の基準。試聴は再生装置のサンプリング周波数で鳴らす',
    unit: 'Hz',
    min: 10,
    max: 192e3,
    v: FS0,
    ph: '例 44.1k',
    list: FSLIST,
    log: true,
    jump: 3,
    sig: 5,
    format: HZ,
    fix: clamp(10, 192e3, hzT),
    stepLabel: ' ',
    pre: [
      [22050, '22.05k'],
      [44100, '44.1k'],
      [48e3, '48k'],
      [96e3, '96k'],
    ],
  },
  {
    k: 'bot',
    nm: 'Amin',
    sym: '<i>A</i><sub>min</sub>',
    name: '最小振幅',
    sub: '周波数特性のグラフの縦軸の下端',
    unit: 'dB',
    min: -150,
    max: 0,
    v: -60,
    ph: '例 −90',
    list: linList(-150, 0, 10),
    jump: 3,
    sign: 'any',
    format: DB,
    fix: clamp(-150, 0, dbT),
    stepLabel: ' ',
    pre: [],
  },
  {
    k: 'vol',
    nm: '音量',
    sym: '',
    name: '音量',
    sub: '入力の音の大きさ（0 dB = フルスケール）。フィルタは最大の利得を 0 dB にそろえて掛ける',
    unit: 'dB',
    min: -80,
    max: 30,
    v: -30,
    ph: '例 −30',
    list: linList(-80, 30, 1),
    jump: 10,
    sign: 'any',
    format: DB,
    fix: clamp(-80, 30, dbT),
    stepLabel: ' ',
    pre: [],
  },
  {
    k: 'sf',
    nm: 'f0',
    sym: '<i>f</i><sub>0</sub>',
    name: '鋸歯状波の周波数',
    sub: '鋸歯状波の基本周波数',
    unit: 'Hz',
    min: 20,
    max: 2e3,
    v: 110,
    ph: '例 220',
    list: SAWLIST,
    log: true,
    jump: 3,
    sig: 5,
    format: HZ,
    fix: clamp(20, 2e3, hzT),
    stepLabel: ' ',
    pre: [
      [55, '55'],
      [110, '110'],
      [220, '220'],
      [440, '440'],
    ],
  },
];

/* ---------- 選択肢 ---------- */
export const GAINS: readonly (readonly [GainMode, string, string])[] = [
  ['one', '1', '距離の積の比そのもの'],
  ['peak', '最大を 0 dB', '振幅の最大が 0 dB になる k'],
  ['dc', '直流を 0 dB', '直流（ω = 0）の振幅が 0 dB になる k'],
];
export const GAIN0: GainMode = 'one';

/** インパルス応答の表示長（グラフの 8 div に入れるサンプル数） */
export const LENS = pow2List(4, 11);
export const L0 = 64;

export type Src = 'noise' | 'saw';
export const SRCS: readonly (readonly [Src, string, string])[] = [
  ['noise', 'ノイズ', 'ホワイトノイズ'],
  ['saw', '鋸歯状波', '鋸歯状波（倍音を多く含む）'],
];

/* ---------- プリセット ---------- */
const D = Math.PI / 180;
const pair = (k: Spot['k'], r: number, deg: number): Spot => polar(k, r, deg * D);

/** 4 次のバターワースの低域通過（双1次変換、fc = fs/8）の極 */
function butter4(): Spot[] {
  /* 周波数を前もってゆがめたアナログの極 s = Ωc e^{jφ}、a = s / 2fs = tan(ωc / 2) e^{jφ} */
  const t = Math.tan(Math.PI / 8),
    out: Spot[] = [];
  for (const phi of [(5 * Math.PI) / 8, (7 * Math.PI) / 8]) {
    const ar = t * Math.cos(phi),
      ai = t * Math.sin(phi);
    /* z = (1 + a) / (1 − a) */
    const nr = 1 + ar,
      dr = 1 - ar,
      di = -ai,
      d2 = dr * dr + di * di;
    out.push({ k: 'p', re: (nr * dr + ai * di) / d2, im: (ai * dr - nr * di) / d2 });
  }
  return out;
}

export interface Preset {
  v: string;
  name: string;
  t: string;
  pts: () => Spot[];
}

export const PRESETS: readonly Preset[] = [
  { v: 'none', name: 'なし', t: '極も零点も置かない（H(z) = k）', pts: () => [] },
  { v: 'res', name: '共振器', t: '2 次の共振器（極の対 r = 0.95、θ = 45°）', pts: () => [pair('p', 0.95, 45)] },
  {
    v: 'notch',
    name: 'ノッチ',
    t: '単位円の上の零点で 1 つの周波数を消し、すぐ内側の極で両側を平らに戻す',
    pts: () => [pair('z', 1, 45), pair('p', 0.95, 45)],
  },
  {
    v: 'dc',
    name: 'DC 除去',
    t: 'y[n] = x[n] − x[n − 1] + 0.95 y[n − 1]',
    pts: () => [
      { k: 'z', re: 1, im: 0 },
      { k: 'p', re: 0.95, im: 0 },
    ],
  },
  {
    v: 'lpf',
    name: 'ローパス',
    t: '4 次のバターワース（双1次変換、fc = fs/8）。零点は −1 に 4 個',
    pts: () => [...Array.from({ length: 4 }, (): Spot => ({ k: 'z', re: -1, im: 0 })), ...butter4()],
  },
  {
    v: 'ap',
    name: 'オールパス',
    t: '2 次のオールパス。零点は極を単位円で折り返した 1/r の位置（振幅は k = r² で 1）',
    pts: () => [pair('z', 1.25, 60), pair('p', 0.8, 60)],
  },
  {
    v: 'comb',
    name: 'くし形',
    t: '帰還形のくし形 y[n] = x[n] + 0.8 y[n − 8]。極は半径 0.8^(1/8) に 8 個',
    pts: () => [0, 45, 90, 135, 180].map((d) => pair('p', 0.8 ** (1 / 8), d)),
  },
  {
    v: 'ma',
    name: '移動平均',
    t: '8 点の移動平均の零点（直流を 0 dB にすると平均になる）',
    pts: () => [45, 90, 135, 180].map((d) => pair('z', 1, d)),
  },
];
export const PRESET0 = 'notch';
export const presetOf = (v: string): Preset | undefined => PRESETS.find((p) => p.v === v);
