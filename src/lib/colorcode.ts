/**
 * 抵抗器のカラーコード（IEC 60062:2016）: 色と数字・乗数・許容差・温度係数の対応、値の符号化。
 * DOM に依存しない。表示色は受動素子組み合わせ計算機の回路図の部品と共通
 */

export type ColorKey = 'k' | 'br' | 'r' | 'o' | 'y' | 'g' | 'b' | 'v' | 'gy' | 'w' | 'gd' | 'sv' | 'pk' | 'no';

export interface BandColor {
  /** 名前 */
  n: string;
  /** SVG の fill（金・銀は BAND_GRADIENTS の参照）。帯なしは null */
  fill: string | null;
  /** CSS の背景（金・銀のグラデーション）。省略時は fill */
  css?: string;
  /** 数字 */
  d?: number;
  /** 乗数の指数（10 の m 乗） */
  m?: number;
  /** 許容差（%） */
  t?: number;
  /** 温度係数（ppm/K） */
  tc?: number;
}

/** 色の表（この順に並べる） */
export const COLORS: Readonly<Record<ColorKey, BandColor>> = {
  k: { n: '黒', fill: '#0b0000', d: 0, m: 0, tc: 250 },
  br: { n: '茶', fill: '#643234', d: 1, m: 1, t: 1, tc: 100 },
  r: { n: '赤', fill: '#ff0000', d: 2, m: 2, t: 2, tc: 50 },
  o: { n: '橙', fill: '#fc6604', d: 3, m: 3, t: 0.05, tc: 15 },
  y: { n: '黄', fill: '#fcfe04', d: 4, m: 4, t: 0.02, tc: 25 },
  g: { n: '緑', fill: '#34ce34', d: 5, m: 5, t: 0.5, tc: 20 },
  b: { n: '青', fill: '#6466fc', d: 6, m: 6, t: 0.25, tc: 10 },
  v: { n: '紫', fill: '#cc66fc', d: 7, m: 7, t: 0.1, tc: 5 },
  gy: { n: '灰', fill: '#949294', d: 8, m: 8, t: 0.01, tc: 1 },
  w: { n: '白', fill: '#ffffff', d: 9, m: 9 },
  gd: {
    n: '金',
    fill: 'url(#lu-g)',
    css: 'linear-gradient(0deg,#cc9a34,#f5ebd6 66%,#cc9a34)',
    m: -1,
    t: 5,
  },
  sv: {
    n: '銀',
    fill: 'url(#lu-s)',
    css: 'linear-gradient(0deg,#cccecc,#f5f5f5 66%,#cccecc)',
    m: -2,
    t: 10,
  },
  pk: { n: '桃', fill: '#fc96c4', m: -3 },
  no: { n: 'なし', fill: null, t: 20 },
};

export const COLOR_KEYS = Object.keys(COLORS) as readonly ColorKey[];

type Field = 'd' | 'm' | 't' | 'tc';
const by = (f: Field): ColorKey[] =>
  COLOR_KEYS.filter((k) => COLORS[k][f] != null).sort((a, b) => (COLORS[a][f] ?? 0) - (COLORS[b][f] ?? 0));

/** 数字の色（0〜9 の順） */
export const DIGIT_KEYS: readonly ColorKey[] = by('d');
/** 乗数の色（×0.001 から ×10^9 の順） */
export const MULT_KEYS: readonly ColorKey[] = by('m');
/** 許容差の色（小さい順。最後は帯なしの ±20 %） */
export const TOL_KEYS: readonly ColorKey[] = by('t');
/** 温度係数の色（小さい順） */
export const TC_KEYS: readonly ColorKey[] = by('tc');

/** 乗数の指数の範囲（桃 ×0.001 〜 白 ×10^9） */
export const MULT_MIN = -3,
  MULT_MAX = 9;

/** 乗数 10^m の色 */
export const multKey = (m: number): ColorKey | undefined => MULT_KEYS.find((k) => COLORS[k].m === m);

/** 色見本の CSS の背景 */
export const cssOf = (k: ColorKey): string => COLORS[k].css ?? COLORS[k].fill ?? 'none';

/** 値 v を nd 桁の数字と乗数の指数に分ける。ちょうど表せないとき・乗数の範囲外のときは null */
export function encode(v: number, nd: number): { d: number[]; m: number } | null {
  if (!(v > 0) || !Number.isFinite(v)) return null;
  let e = Math.floor(Math.log10(v)) - (nd - 1),
    r = Math.round(v / 10 ** e);
  if (r >= 10 ** nd) {
    r = Math.round(r / 10);
    e++;
  }
  if (r < 10 ** (nd - 1)) {
    e--;
    r = Math.round(v / 10 ** e);
  }
  if (Math.abs(r * 10 ** e - v) > v * 1e-9 || e < MULT_MIN || e > MULT_MAX) return null;
  return { d: String(r).split('').map(Number), m: e };
}

/** 数字と乗数から値に戻す */
export const decode = (d: readonly number[], m: number): number =>
  Number((d.reduce((a, x) => a * 10 + x, 0) * 10 ** m).toPrecision(12));

/** SVG の defs の中身: 金・銀の帯のグラデーション（lu-g・lu-s）と本体の陰影（bdsh） */
export const BAND_GRADIENTS =
  '<linearGradient id="lu-g" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#cc9a34"/><stop offset=".66" stop-color="#f5ebd6"/><stop offset="1" stop-color="#cc9a34"/></linearGradient>' +
  '<linearGradient id="lu-s" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#cccecc"/><stop offset=".66" stop-color="#f5f5f5"/><stop offset="1" stop-color="#cccecc"/></linearGradient>' +
  '<linearGradient id="bdsh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".18"/></linearGradient>';

/** 抵抗器の本体の色（肌色） */
export const RESISTOR_BODY = '#fbddc9';
