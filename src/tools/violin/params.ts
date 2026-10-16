/** ヴァイオリン音響モデルの入力の定義（数値の行・選択肢・表示の設定） */
import { linList } from '../../lib/eseries';
import { minus } from '../../lib/format';
import type { ParamDef, ParamFormat } from '../../lib/param-def';

/** 有効数字 s 桁、負はマイナス記号 */
const sig = (v: number, s = 4): string => minus(String(Number(v.toPrecision(s))));
const fmtU = (u: string, s = 4): ParamFormat => ({
  input: (v) => sig(v, s),
  step: (v) => sig(v, s),
  text: (v) => `${sig(v, s)}${u ? ` ${u}` : ''}`,
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

/* ---------- 弓 ---------- */
export type BowKey = 'vb' | 'fb' | 'beta';
export const BOW_V: ParamDef = {
  ...lin({
    k: 'vb',
    nm: 'v_b',
    sym: '<i>v</i><sub>b</sub>',
    name: '弓の速さ',
    sub: '弓を動かす速さ。速いほど振れが大きく、大きな音になる。弓圧の上限も速さに比例して上がる',
    unit: 'm/s',
    min: 0.05,
    max: 1,
    v: 0.3,
    ph: '例 0.3',
    step: 0.01,
    big: 0.05,
    s: 3,
  }),
  list: linList(0.05, 1, 0.01),
  lin: undefined,
  sign: 'pos',
};
export const BOW_F: ParamDef = {
  ...lin({
    k: 'fb',
    nm: 'F',
    sym: '<i>F</i>',
    name: '弓圧',
    sub: '弓を弦に押し付ける力（重音のときは 2 本の弦の和）。弱すぎると笛のようなかすれた音、強すぎるとつぶれた音になる',
    unit: 'N',
    min: 0.02,
    max: 4,
    v: 0.8,
    ph: '例 0.8',
    step: 0.01,
    big: 0.1,
    s: 3,
  }),
  list: linList(0.02, 4, 0.02),
  lin: undefined,
  sign: 'pos',
};
export const BETA: ParamDef = {
  ...lin({
    k: 'beta',
    nm: 'β',
    sym: '<i>β</i>',
    name: '駒からの距離',
    sub: '弓が触れる位置の、駒からの距離 ÷ 振動する長さ。駒に近いほど高い倍音が強い硬い音で、強い弓圧が要る',
    unit: '× L',
    min: 0.03,
    max: 0.25,
    v: 0.1,
    ph: '例 0.1',
    step: 0.005,
    big: 0.02,
    s: 3,
  }),
  list: linList(0.03, 0.25, 0.005),
  lin: undefined,
  sign: 'pos',
};

/* ---------- 左手 ---------- */
export type LhKey = 'vw' | 'vh';
export const VIB_W: ParamDef = lin({
  k: 'vw',
  nm: '幅',
  sym: '',
  name: 'ビブラートの幅',
  sub: '音の高さを揺らす幅（上下の全幅）。曲では、長い音にだけ、音の出だしから少し遅れて掛ける',
  unit: 'セント',
  min: 0,
  max: 100,
  v: 50,
  ph: '例 50',
  step: 1,
  big: 10,
});
export const VIB_HZ: ParamDef = lin({
  k: 'vh',
  nm: '速さ',
  sym: '',
  name: 'ビブラートの速さ',
  sub: '1 秒あたりに揺らす回数',
  unit: 'Hz',
  min: 3,
  max: 9,
  v: 5.9,
  ph: '例 5.9',
  step: 0.1,
  big: 0.5,
  s: 2,
});

/* ---------- 調弦 ---------- */
export type TuneKey = 'tnE' | 'tnA' | 'tnD' | 'tnG';
/** 符号つきの整数（正は +、負はマイナス記号） */
const cent = (v: number): string => (v > 0 ? `+${v}` : minus(String(v))),
  centT = (v: number): string => `${cent(v)} セント`;
/** 弦ごとの調弦のずれ [セント]（0 = E 線 … 3 = G 線）。開放弦の音の高さを、糸巻きで張力を変えてずらす */
export const TUNES: readonly (ParamDef & { k: TuneKey })[] = (['E', 'A', 'D', 'G'] as const).map((n) => ({
  ...lin({
    k: `tn${n}`,
    nm: `${n} 線`,
    sym: '',
    name: `${n} 線`,
    sub: '開放弦の音の高さを、平均律（A4 = 440 Hz）からずらす（糸巻きで張力を変えるのと同じ）。押さえた音も同じだけずれる。弓で弾くと、弓圧が強いほど音は少し低くなる',
    unit: 'セント',
    min: -100,
    max: 100,
    v: 0,
    ph: '例 +10',
    step: 1,
    big: 5,
  }),
  k: `tn${n}` as TuneKey,
  sign: 'any' as const,
  format: { input: cent, step: cent, text: centT },
  fix: clamp(-100, 100, centT, 1),
}));

/* ---------- 部屋 ---------- */
export const DIST: ParamDef = lin({
  k: 'dist',
  nm: 'r',
  sym: '<i>r</i>',
  name: '聴く位置',
  sub: '楽器から聴く人までの距離。遠いほど、直接届く音に対して部屋の響きが大きくなる（全体の大きさは 1 m 先の直接音にそろえる）',
  unit: 'm',
  min: 1,
  max: 30,
  v: 4,
  ph: '例 4',
  step: 0.5,
  big: 2,
});

/* ---------- 演奏と音 ---------- */
/** 音量の初期値 [dB]（0 dB で、1 m 先の音圧 1 Pa をフルスケールにする） */
export const VOL0 = -10;
/** 曲で使う弓圧の、標準に対する割合 [%] */
export const PRESS: ParamDef = lin({
  k: 'bowp',
  nm: '弓圧',
  sym: '',
  name: '弓圧',
  sub: '曲で弦に掛ける弓圧の、標準（弦ごとに Schelleng の上限の約 0.39 倍）に対する割合。演奏中も変えられる。小さすぎるとかすれた音、大きすぎるとつぶれた音になる',
  unit: '%',
  min: 40,
  max: 200,
  v: 100,
  ph: '例 80',
  step: 5,
  big: 10,
});

/* ---------- 選択肢 ---------- */
/** 弓が触れる弦の組（弓の傾きの 7 段）。s は弦（0 = E 線 … 3 = G 線） */
export const LEVELS = [
  { n: 'G', s: [3] },
  { n: 'G・D', s: [3, 2] },
  { n: 'D', s: [2] },
  { n: 'D・A', s: [2, 1] },
  { n: 'A', s: [1] },
  { n: 'A・E', s: [1, 0] },
  { n: 'E', s: [0] },
] as const;
/** 弦 q だけを弾く段 */
export const levelOf = (q: number): number => 6 - 2 * q;
/** 振幅の強調（実際の変位に掛ける倍率） */
export const EXAG = [1, 5, 20, 50] as const;
/** スローで見るときの速さ（実時間に対する割合の逆数） */
export const SLOW = [50, 200, 1000] as const;
/** 出力の波形に出す長さ [s] */
export const SPANS = [0.02, 0.1] as const;
/** スペクトラムの横軸の右端 [Hz] */
export const FMAX = [2000, 5000, 10000] as const;
/** 弱音器の質量 [kg]（駒の上端に載せる）。ゴムは約 1 g の実測（Elie ほか 2014）、金属は 5 g の計算例（Euphonics 7.5）に合わせた */
export const MUTES = [
  ['0', 'なし', 0],
  ['rubber', 'ゴム', 0.001],
  ['metal', '金属', 0.005],
] as const;
/** 楽器の個体（胴のモードの乱数の種） */
export const SEEDS = [40, 7, 23, 61] as const;
