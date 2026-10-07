/** FIR フィルタの入力の定義（応答の種類・設計法・窓と数値の行） */
import { linList } from '../../lib/eseries';
import { minus, parts, plain } from '../../lib/format';
import type { ParamDef, ParamFormat } from '../../lib/param-def';
import { fcList, hzIn, hzT } from '../biquad/params';
import { type Method, N_MAX, N_MIN } from './design';
import type { Resp } from './spec';
import type { Win } from './window';

export interface TypeDef {
  v: Resp;
  /** 略称（チップ） */
  ab: string;
  t: string;
}
export const TYPES: readonly TypeDef[] = [
  { v: 'lowpass', ab: 'LPF', t: 'ローパスフィルタ' },
  { v: 'highpass', ab: 'HPF', t: 'ハイパスフィルタ' },
  { v: 'bandpass', ab: 'BPF', t: 'バンドパスフィルタ' },
  { v: 'bandstop', ab: 'BSF', t: 'バンドストップフィルタ' },
];
export const typeOf = (v: string): TypeDef => TYPES.find((t) => t.v === v) ?? TYPES[0];

export const METHODS: readonly { v: Method; ab: string; t: string }[] = [
  { v: 'window', ab: '窓関数法', t: '理想の応答に窓を掛ける' },
  { v: 'remez', ab: '等リップル', t: 'Parks–McClellan 法（Remez の交換法）で最大誤差を最小にする' },
  { v: 'ls', ab: '最小二乗', t: '帯域ごとの二乗誤差の積分を最小にする' },
];
export const methodOf = (v: string) => METHODS.find((m) => m.v === v) ?? METHODS[0];

export const WINS: readonly { v: Win; ab: string }[] = [
  { v: 'rect', ab: '矩形' },
  { v: 'hann', ab: 'ハン' },
  { v: 'hamming', ab: 'ハミング' },
  { v: 'blackman', ab: 'ブラックマン' },
  { v: 'kaiser', ab: 'カイザー' },
];
export const winOf = (v: string) => WINS.find((w) => w.v === v) ?? WINS[4];

/* ---------- 表記 ---------- */
const HZ: ParamFormat = { input: hzIn, step: (v) => parts(v, '', 4).join(''), text: hzT };
/** dB: 有効数字 4 桁 */
const dbIn = (v: number): string => plain(v, 4);
const dbT = (v: number): string => `${dbIn(v)} dB`;
const DB: ParamFormat = { input: dbIn, step: (v) => plain(v, 3), text: dbT };
const PLAIN: ParamFormat = { input: (v) => plain(v, 4), step: (v) => plain(v, 3), text: (v) => plain(v, 4) };

/** 範囲外を丸める（「… は範囲外のため上限 … にしました」） */
const clamp =
  (min: number, max: number, text: (v: number) => string) =>
  (v: number): readonly [number, string] => {
    const w = Math.min(max, Math.max(min, v));
    return [w, w === v ? '' : `${text(v)} は範囲外のため${w === max ? '上限' : '下限'} ${text(w)} にしました`];
  };

/** 1-2-5 の並び */
const r125 = (a: number, b: number): number[] => {
  const o: number[] = [];
  for (let e = Math.floor(Math.log10(a)); e <= Math.ceil(Math.log10(b)); e++)
    for (const m of [1, 2, 5]) {
      const v = Number((m * 10 ** e).toPrecision(3));
      if (v >= a * (1 - 1e-9) && v <= b * (1 + 1e-9)) o.push(v);
    }
  return o;
};

/** タップ数の並び。HPF・BSF は奇数だけ */
export const nList = (odd: boolean): number[] =>
  Array.from({ length: N_MAX - N_MIN + 1 }, (_, i) => N_MIN + i).filter((n) => !odd || n % 2 === 1);

export type Key = 'f1' | 'f2' | 'df' | 'ap' | 'as' | 'fs' | 'n' | 'beta' | 'wp' | 'ws' | 'vol';

export const FS0 = 48e3;
type Def = ParamDef & { k: Key };

const FSLIST = [1e3, 2e3, 5e3, 8e3, 11025, 16e3, 22050, 24e3, 32e3, 44100, 48e3, 88200, 96e3, 176400, 192e3];
const freq = (k: 'f1' | 'f2' | 'df', name: string, sym: string, sub: string, v: number): Def => ({
  k,
  nm: k === 'df' ? 'Δf' : k === 'f1' ? 'fc1' : 'fc2',
  sym,
  name,
  sub,
  unit: 'Hz',
  min: 1,
  max: FS0 / 2,
  v,
  ph: '例 1.5k',
  list: fcList(FS0),
  log: true,
  jump: 10,
  sig: 5,
  format: HZ,
  pre: [],
  tk: [
    [1, '1'],
    [10, '10'],
    [100, '100'],
    [1e3, '1k'],
    [1e4, '10k'],
  ],
});

const DEFS: Def[] = [
  freq('f1', 'カットオフ周波数', '<i>f</i><sub>c</sub>', '遷移帯域の中央', 6000),
  freq('f2', '上側のカットオフ周波数', '<i>f</i><sub>c2</sub>', '上側の遷移帯域の中央', 12000),
  freq('df', '遷移帯域幅', '<i>Δf</i>', '通過域の端から阻止域の端までの幅', 3000),
  {
    k: 'ap',
    nm: 'Ap',
    sym: '<i>A</i><sub>p</sub>',
    name: '通過域リップル',
    sub: '通過域での振幅の揺れの許容（最大と最小の比、ピーク間）',
    unit: 'dB',
    min: 0.001,
    max: 6,
    v: 0.1,
    ph: '例 0.1',
    list: [...r125(0.001, 5), 6],
    log: true,
    jump: 3,
    format: DB,
    fix: clamp(0.001, 6, dbT),
    pre: [
      [0.01, '0.01'],
      [0.1, '0.1'],
      [0.5, '0.5'],
      [1, '1'],
    ],
    tk: [
      [0.001, '0.001'],
      [0.01, '0.01'],
      [0.1, '0.1'],
      [1, '1'],
    ],
  },
  {
    k: 'as',
    nm: 'As',
    sym: '<i>A</i><sub>s</sub>',
    name: '阻止域減衰',
    sub: '阻止域で抑える量（通過域の振幅 1 に対して）',
    unit: 'dB',
    min: 10,
    max: 150,
    v: 60,
    ph: '例 80',
    list: linList(10, 150, 1),
    jump: 10,
    format: DB,
    fix: clamp(10, 150, dbT),
    pre: [
      [40, '40'],
      [60, '60'],
      [80, '80'],
      [100, '100'],
    ],
    tk: [
      [10, '10'],
      [50, '50'],
      [100, '100'],
      [150, '150'],
    ],
  },
  {
    k: 'fs',
    nm: 'fs',
    sym: '<i>f</i><sub>s</sub>',
    name: 'サンプリング周波数',
    sub: '係数を求める基準',
    unit: 'Hz',
    min: 1e3,
    max: 192e3,
    v: FS0,
    ph: '例 44.1k',
    list: FSLIST,
    log: true,
    jump: 3,
    sig: 5,
    format: HZ,
    fix: clamp(1e3, 192e3, hzT),
    pre: [
      [8e3, '8k'],
      [16e3, '16k'],
      [44100, '44.1k'],
      [48e3, '48k'],
      [96e3, '96k'],
    ],
    tk: [
      [1e3, '1k'],
      [8e3, '8k'],
      [48e3, '48k'],
      [192e3, '192k'],
    ],
  },
  {
    k: 'n',
    nm: 'N',
    sym: '<i>N</i>',
    name: 'タップ数',
    sub: '係数の数（次数 + 1）。HPF・BSF は奇数',
    unit: '',
    min: N_MIN,
    max: N_MAX,
    v: 59,
    ph: '例 101',
    list: nList(false),
    jump: 10,
    snap: true,
    notation: 'plain',
    format: { input: String, step: String, text: String },
    pre: [],
    tk: [
      [3, '3'],
      [255, '255'],
      [511, '511'],
      [767, '767'],
      [1023, '1023'],
    ],
  },
  {
    k: 'beta',
    nm: 'β',
    sym: '<i>β</i>',
    name: 'カイザー窓の形',
    sub: '大きいほど阻止域が深く、遷移帯域が広い（0 で矩形窓）',
    unit: '',
    min: 0,
    max: 20,
    v: 5.65326,
    ph: '例 5.65',
    lin: { step: 0.01, big: 0.5, major: 5, minor: 1 },
    sign: 'nonneg',
    notation: 'plain',
    format: PLAIN,
    pre: [],
    tk: [
      [0, '0'],
      [5, '5'],
      [10, '10'],
      [15, '15'],
      [20, '20'],
    ],
  },
  {
    k: 'wp',
    nm: 'Wp',
    sym: '<i>W</i><sub>p</sub>',
    name: '通過域の重み',
    sub: '誤差の重み。重い帯域ほど誤差が小さくなる',
    unit: '',
    min: 0.001,
    max: 1000,
    v: 1,
    ph: '例 1',
    list: r125(0.001, 1000),
    log: true,
    jump: 3,
    notation: 'plain',
    format: PLAIN,
    pre: [],
    tk: [
      [0.001, '0.001'],
      [1, '1'],
      [1000, '1000'],
    ],
  },
  {
    k: 'ws',
    nm: 'Ws',
    sym: '<i>W</i><sub>s</sub>',
    name: '阻止域の重み',
    sub: '誤差の重み。重い帯域ほど誤差が小さくなる',
    unit: '',
    min: 0.001,
    max: 1000,
    v: 10,
    ph: '例 10',
    list: r125(0.001, 1000),
    log: true,
    jump: 3,
    notation: 'plain',
    format: PLAIN,
    pre: [],
    tk: [
      [0.001, '0.001'],
      [1, '1'],
      [1000, '1000'],
    ],
  },
  {
    k: 'vol',
    nm: '音量',
    sym: '',
    name: '音量',
    sub: 'ホワイトノイズの大きさ（0 dB = フルスケール）',
    unit: 'dB',
    min: -80,
    max: 30,
    v: -30,
    ph: '例 −30',
    list: linList(-80, 30, 1),
    jump: 10,
    sign: 'any',
    format: { input: (v) => minus(String(v)), step: (v) => (v > 0 ? '+' : '') + minus(String(v)), text: dbT },
    fix: clamp(-80, 30, dbT),
    pre: [],
    tk: [
      [-80, '−80'],
      [-40, '−40'],
      [0, '0'],
      [30, '+30'],
    ],
  },
];

/** ▲▼ の読み上げは「fc を 1 つ上の …」 */
export const PARAMS: Def[] = DEFS.map((d) => ({ stepLabel: ' ', ...d }));
