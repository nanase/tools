/** ピアノ音響モデルの入力の定義（数値の行・選択肢・表示の設定） */
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
  (min: number, max: number, text: (v: number) => string, step?: number) =>
  (v: number): readonly [number, string] => {
    const w = step ? Number((Math.round(v / step) * step).toFixed(6)) : v;
    if (w < min) return [min, `${text(v)} は範囲外のため下限 ${text(min)} にしました`];
    if (w > max) return [max, `${text(v)} は範囲外のため上限 ${text(max)} にしました`];
    return [w, ''];
  };
/** 一様な刻みの数値の行 */
function lin(
  d: Omit<ParamDef, 'list' | 'lin' | 'format' | 'fix' | 'pre'> & {
    step: number;
    big: number;
    s?: number;
    pre?: ParamDef['pre'];
  },
): ParamDef {
  const f = fmtU(d.unit, d.s);
  return {
    ...d,
    lin: { step: d.step, big: d.big },
    format: f,
    fix: clamp(d.min, d.max, f.text as (v: number) => string, d.step),
    pre: d.pre ?? [],
  };
}

/* ---------- 打鍵 ---------- */
/** ハンマーの速さ [m/s] */
export const VEL: ParamDef = lin({
  k: 'vel',
  nm: 'v',
  sym: '<i>v</i><sub>H</sub>',
  name: '強さ',
  sub: '弦に当たる直前のハンマーの速さ。速いほどフェルトが強く押しつぶされて硬くなり、大きく明るい音になる',
  unit: 'm/s',
  min: 0.3,
  max: 7,
  v: 2.5,
  ph: '例 2.5',
  step: 0.1,
  big: 0.5,
  pre: [
    [0.8, 'pp'],
    [1.5, 'p'],
    [2.5, 'mf'],
    [4, 'f'],
    [6, 'ff'],
  ],
});

/* ---------- 弦 ---------- */
/** ユニゾンの弦の調律のずれの幅 [セント] */
export const UNI: ParamDef = lin({
  k: 'uni',
  nm: 'Δ',
  sym: 'Δ<i>c</i>',
  name: 'ユニゾンのずれ',
  sub: '1 つの鍵の 2〜3 本の弦の、第 1 部分音の高さのばらつきの幅。少しずれていると、うなりと「後に残る音」が生まれる',
  unit: 'セント',
  min: 0,
  max: 6,
  v: 1,
  sign: 'nonneg',
  ph: '例 1',
  step: 0.1,
  big: 0.5,
  s: 3,
  pre: [
    [0, '0'],
    [0.5, '0.5'],
    [1, '1'],
    [2, '2'],
    [4, '4'],
  ],
});

/* ---------- 響板 ---------- */
export const THICK: ParamDef = lin({
  k: 'h',
  nm: 'h',
  sym: '<i>h</i>',
  name: '響板の厚さ',
  sub: '響板の板の厚さ。厚いほど硬く重くなり、駒が動きにくくなる（音が小さく、長く伸びる）',
  unit: 'mm',
  min: 6,
  max: 12,
  v: 9,
  ph: '例 9',
  step: 0.1,
  big: 0.5,
});

/* ---------- 残響（部屋） ---------- */
export const DIST: ParamDef = lin({
  k: 'dist',
  nm: 'r',
  sym: '<i>r</i>',
  name: '聴く位置',
  sub: '楽器から聴く人までの距離。遠いほど、直接届く音に対して部屋の響きが大きくなる（全体の大きさは 1 m 先の直接音にそろえる）',
  unit: 'm',
  min: 1,
  max: 30,
  v: 8,
  ph: '例 8',
  step: 0.5,
  big: 2,
});

/* ---------- 演奏と音 ---------- */
/** 音量の初期値 [dB]（0 dB で、1 m 先の音圧 1 Pa をフルスケールにする。ギターと同じ） */
export const VOL0 = -10;

/* ---------- 選択肢 ---------- */
/** ハンマーの硬さ（整音）: フェルトの硬さ K に掛ける倍率 */
export const HARD = [
  ['0.6', '柔らかい'],
  ['1', '標準'],
  ['1.6', '硬い'],
] as const;
/** 鍵盤の音の大きさ */
export const THUMP = [
  ['0', 'なし'],
  ['0.5', '小'],
  ['1', '標準'],
  ['2', '大'],
] as const;
/** A4 の周波数 [Hz] */
export const A4S = [440, 442, 443] as const;
/** 振幅の強調（実際の変位に掛ける倍率） */
export const EXAG = [1, 2, 5, 10, 20] as const;
/** スローで見るときの速さ（実時間に対する割合の逆数） */
export const SLOW = [1, 5, 10, 50, 100] as const;
/** 出力の波形に出す長さ [s] */
export const SPANS = [0.02, 0.2, 2] as const;
/** スペクトラムの横軸の右端 [Hz] */
export const FMAX = [2000, 5000, 10000] as const;
