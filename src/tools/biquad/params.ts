/** 双2次フィルタの入力の定義（フィルタの種類と数値の行） */
import { linList, pow2List, prevOf } from '../../lib/eseries';
import { fmt, minus, parts } from '../../lib/format';
import type { ParamDef, ParamFormat, ParamPatch } from '../../lib/param-def';
import type { FilterType } from './filter';

export interface TypeDef {
  v: FilterType;
  /** 略称（チップ） */
  ab: string;
  t: string;
  /** 増幅量 G を使う */
  g?: boolean;
}

export const TYPES: readonly TypeDef[] = [
  { v: 'lowpass', ab: 'LPF', t: 'ローパスフィルタ' },
  { v: 'highpass', ab: 'HPF', t: 'ハイパスフィルタ' },
  { v: 'bandpass', ab: 'BPF', t: 'バンドパスフィルタ' },
  { v: 'bandstop', ab: 'BSF', t: 'バンドストップ（ノッチ）フィルタ' },
  { v: 'lowshelf', ab: 'LSF', t: 'ローシェルフフィルタ', g: true },
  { v: 'highshelf', ab: 'HSF', t: 'ハイシェルフフィルタ', g: true },
  { v: 'peaking', ab: 'PEQ', t: 'ピーキングフィルタ', g: true },
  { v: 'allpass', ab: 'APF', t: 'オールパスフィルタ' },
];
export const typeOf = (v: string): TypeDef => TYPES.find((t) => t.v === v) ?? TYPES[0];

/* ---------- 表記 ---------- */
const SUPS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
/** 上付きの数字（2¹⁶ など） */
export const sup = (n: number): string => String(n).replace(/\d/g, (c) => SUPS[Number(c)]);
/** 周波数: 入力欄 */
export const hzIn = (v: number): string => {
  const [n, x] = parts(v, '', 5);
  return x ? `${n} ${x}` : n;
};
/** 周波数: メッセージ・読み上げ */
export const hzT = (v: number): string => fmt(v, 'Hz', 5);
const HZ: ParamFormat = { input: hzIn, step: (v) => parts(v, '', 4).join(''), text: hzT };
/** dB: 小数 2 桁まで */
export const dbIn = (v: number): string => minus(String(Number(v.toFixed(2))));
const dbT = (v: number): string => `${dbIn(v)} dB`;
const DB: ParamFormat = { input: dbIn, step: (v) => (v > 0 ? '+' : '') + dbIn(v), text: dbT };
/** 点数: 65536 以上は 2 の累乗で短く書く */
const nS = (v: number): string => (v >= 65536 ? `2${sup(Math.round(Math.log2(v)))}` : String(v));
const COUNT: ParamFormat = { input: String, step: nS, text: String };

/** 範囲外を丸める（画面案の言い回し「… は範囲外のため上限 … にしました」） */
const clamp =
  (min: number, max: number, text: (v: number) => string) =>
  (v: number): readonly [number, string] => {
    const w = Math.min(max, Math.max(min, v));
    return [w, w === v ? '' : `${text(v)} は範囲外のため${w === max ? '上限' : '下限'} ${text(w)} にしました`];
  };

/* ---------- 値の並び ---------- */
/** ISO 266 の 1/3 オクターブ（R10） */
const R10 = [1, 1.25, 1.6, 2, 2.5, 3.15, 4, 5, 6.3, 8];
/** fc の並び: 1 Hz 以上 fs/2 未満の R10 */
export function fcList(fs: number): number[] {
  const o: number[] = [],
    h = fs / 2;
  for (let d = 0; d <= 5; d++)
    for (const b of R10) {
      const x = Number((b * 10 ** d).toPrecision(3));
      if (x < h * (1 - 1e-9)) o.push(x);
    }
  return o;
}

/** fc の範囲・並び・補正は fs で決まる（fs が変わるたびに update する） */
export function fcPatch(fs: number): ParamPatch {
  const h = fs / 2,
    list = fcList(fs);
  return {
    max: h,
    list,
    sub: `fs/2 = ${hzT(h)} 未満`,
    fix: (v) => {
      if (v < 1) return [1, `${hzT(v)} は範囲外のため下限 1 Hz にしました`];
      if (v >= h * (1 - 1e-9)) {
        const w = prevOf(list, h) ?? list[0];
        return [w, `fs/2 = ${hzT(h)} 未満にするため ${hzT(w)} にしました`];
      }
      return [v, ''];
    },
  };
}

/** Q: √2 刻み 0.011 … 128 */
const QLIST = Array.from({ length: 28 }, (_, i) => 2 ** ((i - 13) / 2));
const FSLIST = [
  10, 20, 50, 100, 200, 500, 1e3, 2e3, 5e3, 8e3, 11025, 16e3, 22050, 24e3, 32e3, 44100, 48e3, 88200, 96e3, 176400,
  192e3,
];

export type Key = 'fc' | 'q' | 'g' | 'fs' | 'vol' | 'n' | 'bot' | 'np';

/** インパルス応答の表示長 L の選択肢（グラフの 8 div に入れるサンプル数）と初期値。解析長 N を超えるものは選べない */
export const LENS = pow2List(3, 12);
export const L0 = 256;

export const FS0 = 48e3;
type Def = ParamDef & { k: Key };

const DEFS: Def[] = [
  {
    k: 'fc',
    nm: 'fc',
    sym: '<i>f</i><sub>c</sub>',
    name: 'カットオフ周波数',
    sub: '',
    unit: 'Hz',
    min: 1,
    max: FS0 / 2,
    v: 1000,
    ph: '例 1.5k',
    log: true,
    jump: 10,
    sig: 5,
    format: HZ,
    pre: [
      [10, '10'],
      [100, '100'],
      [1e3, '1k'],
      [1e4, '10k'],
    ],
    ...fcPatch(FS0),
  },
  {
    k: 'q',
    nm: 'Q',
    sym: '<i>Q</i>',
    name: 'Q 値',
    sub: '鋭さ（帯域幅の逆数）',
    unit: '',
    min: 0.01,
    max: 128,
    v: Math.SQRT1_2,
    ph: '例 0.707',
    list: QLIST,
    log: true,
    jump: 2,
    notation: 'plain',
    sig: 4,
    fix: clamp(0.01, 128, (v) => String(Number(v.toPrecision(4)))),
    pre: [
      [0.5, '0.5'],
      [Math.SQRT1_2, '0.7071'],
      [1, '1'],
      [Math.SQRT2, '1.414'],
      [2, '2'],
      [4, '4'],
      [8, '8'],
      [16, '16'],
    ],
  },
  {
    k: 'g',
    nm: 'G',
    sym: '<i>G</i>',
    name: '増幅量',
    sub: 'LSF・HSF・PEQ で使う',
    unit: 'dB',
    min: -40,
    max: 40,
    v: 6,
    ph: '例 −6',
    list: linList(-40, 40, 0.5),
    jump: 10,
    sign: 'any',
    format: DB,
    fix: clamp(-40, 40, dbT),
    pre: [
      [-9, '−9'],
      [-6, '−6'],
      [-3, '−3'],
      [0, '0'],
      [3, '+3'],
      [6, '+6'],
      [9, '+9'],
    ],
  },
  {
    k: 'fs',
    nm: 'fs',
    sym: '<i>f</i><sub>s</sub>',
    name: 'サンプリング周波数',
    sub: '係数を求める基準',
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
    pre: [
      [22050, '22.05k'],
      [32e3, '32k'],
      [44100, '44.1k'],
      [48e3, '48k'],
      [88200, '88.2k'],
      [96e3, '96k'],
      [192e3, '192k'],
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
    format: DB,
    fix: clamp(-80, 30, dbT),
    pre: [],
  },
  {
    k: 'n',
    nm: 'N',
    sym: '<i>N</i>',
    name: 'インパルス長',
    sub: 'グラフと計算結果の FFT 点数',
    unit: '',
    min: 256,
    max: 32768,
    v: 1024,
    ph: '例 4096',
    list: pow2List(8, 15),
    log: true,
    snap: true,
    jump: 2,
    format: COUNT,
    pre: [],
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
    pre: [],
  },
  {
    k: 'np',
    nm: 'N′',
    sym: '<i>N</i>′',
    name: '精密計算の長さ',
    sub: '「精密計算」で使うインパルス長（FFT 点数）',
    unit: '',
    min: 65536,
    max: 2 ** 24,
    v: 65536,
    ph: '例 65536',
    list: pow2List(16, 24),
    log: true,
    snap: true,
    jump: 2,
    format: COUNT,
    pre: [],
  },
];

/** ‹ › の読み上げは「fc を 1 つ上の …」（並びの行の既定「fc を1 つ上の」に空白を足す） */
export const PARAMS: Def[] = DEFS.map((d) => ({ stepLabel: ' ', ...d }));
