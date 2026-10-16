/** ハロのページの入力の定義（数値の行） */
import { minus } from '../../lib/format';
import type { ParamDef, ParamFormat } from '../../lib/param-def';

/** 有効数字 s 桁、負はマイナス記号。keep なら末尾の 0 を残す（計算結果） */
export const sig = (v: number, s = 3, keep = false): string => {
  const t = v.toPrecision(s);
  return minus(keep && !t.includes('e') ? t : String(Number(t)));
};
/** 小数 n 桁で固定（計算結果の角度など） */
export const fix = (v: number, n = 2): string => minus(v.toFixed(n));

const plainF = (u: string, s = 3): ParamFormat => ({
  input: (v) => sig(v, s),
  step: (v) => sig(v, s),
  text: (v) => `${sig(v, s)}${u ? ` ${u}` : ''}`,
});

/** 全体の入力（保存する） */
export type Key = 'el' | 'age' | 'tau' | 'rough' | 'hc' | 'p2' | 'fov' | 'ev';
/** 母集団ごとの入力（選んでいる母集団の値を出す） */
export type PopKey = 'w' | 'tilt' | 'rot' | 'ca' | 'pyr' | 'd';

export const ELEV: ParamDef = {
  k: 'el',
  nm: 'h',
  sym: '<i>h</i>',
  name: '高度',
  sub: '光源（太陽か月）の地平線からの高さ（大気差を除いた真の高度）。0° 未満は地平線の下で、上空の雲だけが照らされる',
  unit: '°',
  min: -5,
  max: 90,
  v: 23,
  ph: '例 23',
  pre: [
    [-2, '−2', '日の入りの後'],
    [0, '0'],
    [5, '5'],
    [22, '22', '環天頂アークが最も明るい'],
    [32, '32', '環天頂アークが消える'],
    [45, '45'],
    [60, '60'],
    [68, '68', '環水平アークが最も明るい'],
  ],
  lin: { step: 1, big: 5 },
  sign: 'any',
  notation: 'plain',
  format: { ...plainF('°', 3), input: (v) => minus(String(v)), step: (v) => minus(String(v)) },
};

export const AGE: ParamDef = {
  k: 'age',
  nm: '月齢',
  sym: '',
  name: '月齢',
  sub: '新月からの日数。満ち欠けで月の明るさが変わる（満月が最も明るい）',
  unit: '日',
  min: 3,
  max: 26.5,
  v: 14.8,
  ph: '例 14.8',
  pre: [
    [7.4, '7.4', '上弦'],
    [14.8, '14.8', '満月'],
    [22.1, '22.1', '下弦'],
  ],
  lin: { step: 0.1, big: 1 },
  notation: 'plain',
  format: plainF('日', 3),
};

export const TAU: ParamDef = {
  k: 'tau',
  nm: 'τ',
  sym: '<i>τ</i>',
  name: '雲の厚さ',
  sub: '巻雲の光学的厚さ（真上に通したとき）。厚いほど白っぽく、太陽が弱まる。ハロは 1 前後で最も目立つ',
  unit: '',
  min: 0.02,
  max: 3,
  v: 0.3,
  ph: '例 0.3',
  pre: [
    [0.1, '0.1'],
    [0.3, '0.3'],
    [1, '1'],
    [2, '2'],
  ],
  list: [0.02, 0.03, 0.05, 0.07, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.7, 1, 1.5, 2, 3],
  log: true,
  notation: 'plain',
  format: plainF('', 2),
};

export const ROUGH: ParamDef = {
  k: 'rough',
  nm: '粗い結晶',
  sym: '',
  name: '粗い結晶',
  sub: '面が粗く、光をハロにせず四方へ散らす結晶の割合。実際の巻雲では 6 割ほど（Forster & Mayer 2022）',
  unit: '%',
  min: 0,
  max: 95,
  v: 63,
  ph: '例 63',
  pre: [
    [0, '0'],
    [63, '63'],
    [90, '90'],
  ],
  lin: { step: 1, big: 10 },
  notation: 'plain',
  format: plainF('%', 3),
};

export const HC: ParamDef = {
  k: 'hc',
  nm: '雲の高さ',
  sym: '',
  name: '雲の高さ',
  sub: '巻雲の層の高さ。高いほど日の入りの後も長く照らされる（地球の影に入るのが遅い）',
  unit: 'km',
  min: 3,
  max: 14,
  v: 8,
  ph: '例 8',
  pre: [
    [6, '6'],
    [8, '8'],
    [10, '10'],
  ],
  lin: { step: 0.5, big: 2 },
  notation: 'plain',
  format: plainF('km', 3),
};

export const P2: ParamDef = {
  k: 'p2',
  nm: '2 個目の結晶',
  sym: '',
  name: '2 個目の結晶',
  sub: '結晶を出た光が、もう 1 つの結晶を通る割合。ハロがぼやけ、44° 幻日のような珍しいハロが出る',
  unit: '%',
  min: 0,
  max: 50,
  v: 0,
  ph: '例 10',
  pre: [
    [0, '0'],
    [10, '10'],
    [30, '30'],
  ],
  lin: { step: 1, big: 5 },
  notation: 'plain',
  format: plainF('%', 3),
};

export const FOV: ParamDef = {
  k: 'fov',
  nm: '画角',
  sym: '',
  name: '画角',
  sub: '魚眼とカメラの横の画角。全天では使わない',
  unit: '°',
  min: 40,
  max: 180,
  v: 160,
  ph: '例 120',
  pre: [
    [60, '60'],
    [100, '100'],
    [160, '160'],
    [180, '180'],
  ],
  lin: { step: 5, big: 20 },
  notation: 'plain',
  format: plainF('°', 3),
};

export const EV: ParamDef = {
  k: 'ev',
  nm: '露出',
  sym: '',
  name: '露出',
  sub: '自動で決めた露出からの補正。+1 で 2 倍明るい',
  unit: 'EV',
  min: -4,
  max: 4,
  v: 0,
  ph: '例 +1',
  pre: [
    [-2, '−2'],
    [0, '0'],
    [2, '+2'],
  ],
  lin: { step: 0.5, big: 1 },
  sign: 'any',
  notation: 'plain',
  format: {
    input: (v) => minus(String(v)),
    step: (v) => minus(String(v)),
    view: (v) => (v > 0 ? `+${v}` : minus(String(v))),
    text: (v) => `${v > 0 ? '+' : ''}${minus(String(v))} EV`,
  },
};

export const PARAMS: ParamDef[] = [ELEV, AGE, TAU, ROUGH, HC, P2, FOV, EV];

/* ---------- 母集団 ---------- */

export const W: ParamDef = {
  k: 'w',
  nm: '割合',
  sym: '<i>w</i>',
  name: '割合',
  sub: '母集団の結晶の数の比（表面積をそろえた結晶で数える）。ほかの母集団との比だけが効く',
  unit: '%',
  min: 0,
  max: 100,
  v: 50,
  ph: '例 50',
  pre: [
    [0, '0', 'この母集団を使わない'],
    [25, '25'],
    [50, '50'],
    [100, '100'],
  ],
  lin: { step: 1, big: 10 },
  notation: 'plain',
  format: plainF('%', 3),
};

export const TILT: ParamDef = {
  k: 'tilt',
  nm: 'σ',
  sym: '<i>σ</i>',
  name: '傾き',
  sub: '向きのばらつき（標準偏差）。板は c 軸と鉛直、柱と Parry は c 軸と水平のなす角。小さいほどハロが鋭い',
  unit: '°',
  min: 0,
  max: 30,
  v: 1,
  ph: '例 1',
  pre: [
    [0.3, '0.3'],
    [1, '1'],
    [3, '3'],
    [18, '18'],
  ],
  list: [0, 0.1, 0.2, 0.3, 0.5, 0.7, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 15, 18, 20, 25, 30],
  notation: 'plain',
  format: plainF('°', 3),
};

export const ROT: ParamDef = {
  k: 'rot',
  nm: '回転',
  sym: '',
  name: '回転',
  sub: 'Parry は側面が水平からずれる角、Lowitz は長い対角線のまわりに回る角のばらつき（標準偏差）。90° は一様に全回転',
  unit: '°',
  min: 0,
  max: 90,
  v: 1,
  ph: '例 15',
  pre: [
    [1, '1'],
    [15, '15'],
    [20, '20'],
    [90, '90', '全回転（古典の Lowitz）'],
  ],
  list: [0, 0.3, 0.5, 1, 2, 3, 5, 8, 10, 15, 20, 25, 30, 45, 60, 90],
  notation: 'plain',
  format: plainF('°', 3),
};

export const CA: ParamDef = {
  k: 'ca',
  nm: 'c/a',
  sym: '<i>c</i>/<i>a</i>',
  name: '長さ ÷ 径',
  sub: '六角柱の長さ ÷ 頂点の間の径。1 より小さいと板、大きいと柱',
  unit: '',
  min: 0.05,
  max: 5,
  v: 1,
  ph: '例 0.3',
  pre: [
    [0.1, '0.1'],
    [0.3, '0.3'],
    [1, '1'],
    [2, '2'],
  ],
  list: [0.05, 0.07, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.7, 1, 1.2, 1.5, 2, 3, 4, 5],
  log: true,
  notation: 'plain',
  format: plainF('', 2),
};

export const PYR: ParamDef = {
  k: 'pyr',
  nm: '錐面',
  sym: '',
  name: '錐面',
  sub: '両端の錐（c 軸に 28° 傾いた面）の高さの割合。0 は錐面なし、100 % は尖る。9°・18°・20°・23°・24°・35° の暈が出る',
  unit: '%',
  min: 0,
  max: 100,
  v: 0,
  ph: '例 50',
  pre: [
    [0, '0'],
    [50, '50'],
    [100, '100'],
  ],
  lin: { step: 5, big: 10 },
  notation: 'plain',
  format: plainF('%', 3),
};

export const SIZE: ParamDef = {
  k: 'd',
  nm: 'D',
  sym: '<i>D</i>',
  name: '大きさ',
  sub: '結晶の径。小さいほど回折でハロがにじみ、色が淡い（半値全幅 ≈ 3.2λ/D）',
  unit: 'µm',
  min: 20,
  max: 1000,
  v: 100,
  ph: '例 100',
  pre: [
    [30, '30'],
    [100, '100'],
    [300, '300'],
  ],
  list: [20, 25, 30, 40, 50, 60, 80, 100, 120, 150, 200, 300, 400, 500, 700, 1000],
  log: true,
  notation: 'plain',
  format: plainF('µm', 3),
};

export const POP_PARAMS: ParamDef[] = [W, TILT, ROT, CA, PYR, SIZE];
