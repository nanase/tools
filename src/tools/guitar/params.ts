/** ギター音響モデルの入力の定義（数値の行・選択肢・表示の設定） */
import { linList } from '../../lib/eseries';
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

/* ---------- 弦 ---------- */
export type StrKey = 'd' | 'T';
/** 外径 [mm] と張力 [N]（選んだ弦の値。初期値は弦のセットで決まる） */
export const DIA: ParamDef = {
  ...lin({
    k: 'd',
    nm: 'd',
    sym: '<i>d</i>',
    name: '外径',
    sub: '弦の太さ。巻弦は巻線を含む外側の直径。太いほど線密度が増え、同じ張力なら音が低くなる',
    unit: 'mm',
    min: 0.2,
    max: 1.6,
    v: 0.65,
    ph: '例 0.65',
    step: 0.001,
    big: 0.05,
    s: 4,
  }),
  list: linList(0.2, 1.6, 0.01),
  lin: undefined,
  sign: 'pos',
};
export const TEN: ParamDef = {
  ...lin({
    k: 'T',
    nm: 'T',
    sym: '<i>T</i>',
    name: '張力',
    sub: '弦を引っ張る力。強いほど波が速く伝わり、音が高くなる。調弦に合わせる間は、音程が合う値を求めて入れる',
    unit: 'N',
    min: 10,
    max: 250,
    v: 70,
    ph: '例 70',
    step: 0.1,
    big: 5,
    s: 4,
  }),
  list: linList(10, 250, 0.5),
  lin: undefined,
};
/** 弦長 [mm] */
export const SCALE: ParamDef = lin({
  k: 'L',
  nm: 'L',
  sym: '<i>L</i>',
  name: '弦長',
  sub: 'ナットから駒（サドル）までの長さ（スケール）。クラシックは 650 mm、スチール弦の多くは 645 mm 前後',
  unit: 'mm',
  min: 500,
  max: 700,
  v: 650,
  ph: '例 650',
  step: 1,
  big: 10,
  pre: [
    [630, '630'],
    [645, '645'],
    [650, '650'],
    [660, '660'],
  ],
});

/* ---------- 弾き方 ---------- */
export const POS: ParamDef = lin({
  k: 'pos',
  nm: 'x',
  sym: '<i>x</i><sub>p</sub>',
  name: '弾く位置',
  sub: '駒から弾く点までの距離。駒に近いほど高い倍音が強く硬い音に、離れるほど柔らかい音になる。ちょうど 1/n の点では n 倍音が出ない',
  unit: 'mm',
  min: 15,
  max: 320,
  v: 130,
  ph: '例 130',
  step: 1,
  big: 10,
  pre: [
    [40, '40', '駒のすぐ近く（スル・ポンティチェロ）'],
    [80, '80'],
    [130, '130', 'サウンドホールの駒側の端あたり'],
    [200, '200'],
    [300, '300', '指板の上（スル・タスト）'],
  ],
});
export const SLANT: ParamDef = lin({
  k: 'slant',
  nm: 'φ',
  sym: '<i>φ</i>',
  name: '弾く位置の傾き',
  sub: '右手の指が並ぶ線の、弦に直角な向きからの傾き。弾く位置は 3 弦と 4 弦の間での値で、正なら低い弦ほど駒から離れた点（親指が指板の側）を弾く',
  unit: '°',
  min: -45,
  max: 45,
  v: 0,
  ph: '例 20',
  step: 5,
  big: 15,
  sign: 'any',
  pre: [
    [0, '0'],
    [15, '15'],
    [30, '30'],
  ],
});
export const AMP: ParamDef = lin({
  k: 'amp',
  nm: 'A',
  sym: '<i>A</i>',
  name: '強さ',
  sub: '弾く点で弦を引く量（離す直前の変位）。大きいほど大きな音になる',
  unit: 'mm',
  min: 0.1,
  max: 5,
  v: 1.2,
  ph: '例 1.2',
  step: 0.1,
  big: 0.5,
  pre: [
    [0.3, 'pp'],
    [0.7, 'p'],
    [1.2, 'mf'],
    [2, 'f'],
    [3, 'ff'],
  ],
});
export const ANGLE: ParamDef = lin({
  k: 'ang',
  nm: 'θ',
  sym: '<i>θ</i>',
  name: '弾く向き',
  sub: '弦を引く向きの、表板からの角度。90° は表板に向かって押し込む向き（アポヤンド）、0° は表板と平行。垂直の振動は表板を強く揺らして大きな音になり早く減衰し、平行の振動は長く残る',
  unit: '°',
  min: 0,
  max: 90,
  v: 45,
  ph: '例 45',
  step: 5,
  big: 15,
});

/* ---------- 胴 ---------- */
export const THICK: ParamDef = {
  ...lin({
    k: 'h',
    nm: 'h',
    sym: '<i>h</i>',
    name: '表板の厚さ',
    sub: '表板（響板）の厚さ。厚いほど硬く重くなり、表板の共振が高くなって、駒が動きにくくなる（音が小さく、長く伸びる）',
    unit: 'mm',
    min: 1.5,
    max: 4,
    v: 2.5,
    ph: '例 2.5',
    step: 0.1,
    big: 0.5,
  }),
};
export const VOLUME: ParamDef = {
  ...lin({
    k: 'V',
    nm: 'V',
    sym: '<i>V</i>',
    name: '胴の容積',
    sub: '胴の中の空気の量。大きいほどヘルムホルツ共振（空気の共振）が低くなる',
    unit: 'L',
    min: 6,
    max: 30,
    v: 13,
    ph: '例 13',
    step: 0.5,
    big: 2,
  }),
};
export const HOLE: ParamDef = {
  ...lin({
    k: 'dh',
    nm: 'D',
    sym: '<i>D</i><sub>h</sub>',
    name: 'サウンドホールの直径',
    sub: '表板の丸い穴の直径。大きいほどヘルムホルツ共振が高くなる',
    unit: 'mm',
    min: 40,
    max: 130,
    v: 85,
    ph: '例 85',
    step: 1,
    big: 5,
  }),
};

/* ---------- 演奏と音 ---------- */
/** 音量の初期値 [dB]（0 dB で、1 m 先の音圧 1 Pa をフルスケールにする） */
export const VOL0 = -10;

/* ---------- 選択肢 ---------- */
/** フレットノイズの大きさ */
export const NOISE = [
  ['0', 'なし'],
  ['0.5', '小'],
  ['1', '標準'],
  ['2', '大'],
] as const;
/** 振幅の強調（実際の変位に掛ける倍率） */
export const EXAG = [1, 2, 3, 5, 10] as const;
/** スローで見るときの速さ（実時間に対する割合の逆数） */
export const SLOW = [1, 5, 10, 50, 100] as const;
/** 出力の波形に出す長さ [s] */
export const SPANS = [0.02, 0.2, 2] as const;
/** スペクトラムの横軸の右端 [Hz] */
export const FMAX = [2000, 5000, 10000] as const;
