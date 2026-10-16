/** フォーカシングマスクの入力の定義（数値の行と選択肢） */
import { minus } from '../../lib/format';
import type { ParamDef, ParamFormat } from '../../lib/param-def';
import type { MaskKind } from './mask';

/** 有効数字 s 桁、負はマイナス記号。keep なら末尾の 0 を残す（計算結果） */
export const sig = (v: number, s = 4, keep = false): string => {
  const t = v.toPrecision(s);
  return minus(keep && !t.includes('e') ? t : String(Number(t)));
};

const plainF = (u: string, s = 4): ParamFormat => ({
  input: (v) => sig(v, s),
  step: (v) => sig(v, 3),
  text: (v) => `${sig(v, s)}${u ? ` ${u}` : ''}`,
});

export type Key =
  | 'thr'
  | 'th'
  | 'bf'
  | 'rot'
  | 'bar'
  | 'hd'
  | 'D'
  | 'f'
  | 'obs'
  | 'coma'
  | 'ast'
  | 'T'
  | 'see'
  | 'px'
  | 'ex';

export const THR: ParamDef = {
  k: 'thr',
  nm: 'しきい値',
  sym: '',
  name: 'しきい値',
  sub: '画像の明るさがこの値より明るい所を「白」、暗い所を「黒」とみなす（境目は少しぼかす）',
  unit: '%',
  min: 1,
  max: 99,
  v: 50,
  ph: '例 50',
  pre: [
    [25, '25'],
    [50, '50'],
    [75, '75'],
  ],
  lin: { step: 1, big: 5 },
  notation: 'plain',
  format: plainF('%', 3),
};

export const TH: ParamDef = {
  k: 'th',
  nm: 'θ',
  sym: '<i>θ</i>',
  name: '斜めの格子の角度',
  sub: '中央の格子と斜めの格子のなす角。大きいほど光条のずれが大きいが、X が開いて交点が読みにくい。Bahtinov は約 20°。トライ・バーティノフは 10°。キャリーは左の 2 区画の開き（右は 10/12 倍）',
  unit: '°',
  min: 3,
  max: 45,
  v: 20,
  ph: '例 20',
  pre: [
    [10, '10'],
    [12, '12'],
    [15, '15'],
    [20, '20'],
    [30, '30'],
  ],
  lin: { step: 1, big: 5 },
  notation: 'plain',
  format: plainF('°', 3),
};

export const BF: ParamDef = {
  k: 'bf',
  nm: 'B',
  sym: '<i>B</i>',
  name: 'バーティノフ係数',
  sub: '焦点距離 ÷ 格子の周期（スリットと桟を合わせた幅）。大きいほど格子が細かく、光条の点が中心から離れる。150〜200 が目安',
  unit: '',
  min: 50,
  max: 300,
  v: 150,
  ph: '例 150',
  pre: [
    [100, '100'],
    [150, '150'],
    [200, '200'],
    [250, '250'],
  ],
  lin: { step: 10, big: 50 },
  notation: 'plain',
  format: plainF('', 3),
};

export const ROT: ParamDef = {
  k: 'rot',
  nm: 'φ',
  sym: '<i>φ</i>',
  name: 'マスクの回転',
  sub: 'マスクを鏡筒の軸のまわりに回す角度。スパイダーの光条と重ならない向きにすると読みやすい',
  unit: '°',
  min: -90,
  max: 90,
  v: 0,
  ph: '例 0',
  pre: [
    [-45, '−45'],
    [0, '0'],
    [45, '45'],
  ],
  lin: { step: 1, big: 15 },
  sign: 'any',
  notation: 'plain',
  format: plainF('°', 3),
};

export const BAR: ParamDef = {
  k: 'bar',
  nm: 'w',
  sym: '<i>w</i>',
  name: '区画の間の桟の幅',
  sub: '区画を分ける桟（マスクを支える板）の幅。桟が光をさえぎるぶん、区画の重心が外へ寄り、光条のずれが少し大きくなる',
  unit: 'mm',
  min: 0,
  max: 20,
  v: 3,
  ph: '例 3',
  pre: [
    [0, '0'],
    [3, '3'],
    [6, '6'],
  ],
  lin: { step: 0.5, big: 2 },
  sign: 'nonneg',
  notation: 'plain',
  format: plainF('mm', 3),
};

export const HD: ParamDef = {
  k: 'hd',
  nm: 'd',
  sym: '<i>d</i>',
  name: '穴の径',
  sub: 'ハルトマン・シャイナーの穴の直径（口径に対する割合）。穴は口径の 60 % の円の上に等間隔に並べる',
  unit: '%',
  min: 5,
  max: 40,
  v: 18,
  ph: '例 18',
  pre: [
    [10, '10'],
    [18, '18'],
    [30, '30'],
  ],
  lin: { step: 1, big: 5 },
  notation: 'plain',
  format: plainF('%', 3),
};

export const DIA: ParamDef = {
  k: 'D',
  nm: 'D',
  sym: '<i>D</i>',
  name: '口径',
  sub: '対物（主鏡）の有効径',
  unit: 'mm',
  min: 30,
  max: 400,
  v: 100,
  ph: '例 100',
  pre: [
    [60, '60'],
    [80, '80'],
    [100, '100'],
    [150, '150'],
    [200, '200'],
    [280, '280'],
  ],
  list: [
    30, 40, 50, 60, 66, 70, 76, 80, 90, 100, 102, 115, 120, 127, 130, 150, 180, 200, 203, 235, 250, 280, 300, 356, 400,
  ],
  log: true,
  notation: 'plain',
  format: plainF('mm', 3),
};

export const FOC: ParamDef = {
  k: 'f',
  nm: 'f',
  sym: '<i>f</i>',
  name: '焦点距離',
  sub: '望遠鏡の合成焦点距離。F 値（焦点距離 ÷ 口径）が大きいほど、ピントの合う範囲が広く、光条のずれは小さい',
  unit: 'mm',
  min: 150,
  max: 4000,
  v: 700,
  ph: '例 700',
  pre: [
    [400, '400'],
    [700, '700'],
    [1000, '1000'],
    [2000, '2000'],
  ],
  list: [
    150, 200, 250, 300, 350, 400, 450, 500, 530, 550, 600, 650, 700, 750, 800, 900, 1000, 1200, 1250, 1400, 1500, 1600,
    1800, 2000, 2350, 2500, 2800, 3000, 3500, 4000,
  ],
  log: true,
  notation: 'plain',
  format: plainF('mm', 4),
};

export const OBS: ParamDef = {
  k: 'obs',
  nm: 'ε',
  sym: '<i>ε</i>',
  name: '中央遮蔽',
  sub: '副鏡の影の径 ÷ 口径。中央遮蔽があると区画の重心が外へ寄り、光条のずれが大きくなる',
  unit: '%',
  min: 0,
  max: 50,
  v: 30,
  ph: '例 30',
  pre: [
    [25, '25'],
    [35, '35'],
  ],
  lin: { step: 1, big: 5 },
  sign: 'nonneg',
  notation: 'plain',
  format: plainF('%', 3),
};

/** 収差は波面のずれ（ゼルニケの係数、RMS）を、波長 550 nm を単位にして入れる */
const ab = (k: 'coma' | 'ast', name: string, sub: string): ParamDef => ({
  k,
  nm: name,
  sym: '',
  name,
  sub,
  unit: 'λ',
  min: 0,
  max: 1,
  v: 0,
  ph: '例 0.1',
  pre: [
    [0, '0'],
    [0.1, '0.1'],
    [0.25, '0.25'],
  ],
  lin: { step: 0.01, big: 0.05 },
  sign: 'nonneg',
  notation: 'plain',
  format: plainF('λ', 3),
});
export const COMA = ab(
  'coma',
  '光軸のずれ（コマ）',
  '光軸がずれたときに出るコマ収差の大きさ（RMS、λ = 550 nm）。トライ・バーティノフでは、3 組の光条が同時に合わなくなる',
);
export const AST = ab('ast', '非点収差', '縦と横でピントの位置が違う収差の大きさ（RMS、λ = 550 nm）');

export const TEMP: ParamDef = {
  k: 'T',
  nm: 'T',
  sym: '<i>T</i>',
  name: '星の色温度',
  sub: '星の光を黒体放射とみなしたときの温度。6500 K で白、低いと赤く、高いと青い',
  unit: 'K',
  min: 2500,
  max: 20000,
  v: 5800,
  ph: '例 5800',
  pre: [
    [3500, '3500', 'M 型（ベテルギウス）'],
    [5800, '5800', 'G 型（太陽）'],
    [9600, '9600', 'A 型（ベガ）'],
  ],
  list: [2500, 3000, 3500, 4000, 4500, 5000, 5800, 6500, 7500, 8500, 9600, 11000, 13000, 16000, 20000],
  log: true,
  notation: 'plain',
  format: plainF('K', 4),
};

export const SEE: ParamDef = {
  k: 'see',
  nm: 'シーイング',
  sym: '',
  name: 'シーイング',
  sub: '大気のゆらぎで広がった、長い露出の星像の半値幅。0 で大気なし',
  unit: '″',
  min: 0,
  max: 6,
  v: 2,
  ph: '例 2',
  pre: [
    [0, '0'],
    [1, '1'],
    [2, '2'],
    [4, '4'],
  ],
  lin: { step: 0.1, big: 0.5 },
  sign: 'nonneg',
  notation: 'plain',
  format: plainF('″', 3),
};

export const PIX: ParamDef = {
  k: 'px',
  nm: 'p',
  sym: '<i>p</i>',
  name: '画素の大きさ',
  sub: 'カメラの画素の一辺',
  unit: 'µm',
  min: 1,
  max: 10,
  v: 3.76,
  ph: '例 3.76',
  pre: [
    [2.9, '2.9'],
    [3.76, '3.76'],
    [4.63, '4.63'],
    [5.86, '5.86'],
  ],
  list: [1, 1.45, 2, 2.4, 2.9, 3.45, 3.76, 4.3, 4.63, 5.4, 5.86, 6, 7.4, 9, 10],
  log: true,
  notation: 'plain',
  format: plainF('µm', 3),
};

/** 露出の倍率（2 のべき） */
export const EXP: ParamDef = {
  k: 'ex',
  nm: '露出',
  sym: '',
  name: '露出',
  sub: '映像の明るさの倍率。上げるほど芯が飽和し、暗い光条が見えてくる',
  unit: '',
  min: 1 / 16,
  max: 64,
  v: 1,
  ph: '例 4',
  pre: [
    [1 / 4, '1/4'],
    [1, '1'],
    [4, '4'],
    [16, '16'],
  ],
  list: [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8, 16, 32, 64],
  log: true,
  snap: true,
  notation: 'plain',
  format: {
    input: (v) => (v < 1 ? `1/${Math.round(1 / v)}` : sig(v, 3)),
    view: (v) => `×${v < 1 ? `1/${Math.round(1 / v)}` : sig(v, 3)}`,
    step: (v) => (v < 1 ? `1/${Math.round(1 / v)}` : sig(v, 3)),
    text: (v) => `×${v < 1 ? `1/${Math.round(1 / v)}` : sig(v, 3)}`,
  },
};

export const PARAMS: ParamDef[] = [THR, TH, BF, ROT, BAR, HD, DIA, FOC, OBS, COMA, AST, TEMP, SEE, PIX, EXP];

/** マスクの種類: [値, 表示, title] */
export const MASKS: readonly (readonly [MaskKind, string, string])[] = [
  ['none', 'なし', 'マスクを付けない'],
  ['bahtinov', 'バーティノフ', 'P. Bahtinov（2005）。3 本の光条で合わせる'],
  ['tri', 'トライ・バーティノフ', 'C. Y. Tan（2016）。120° ずつの 3 組で、光軸のずれも分かる'],
  ['carey', 'キャリー', '開きの違う 2 つの X が重なるように合わせる（2009）'],
  ['hartmann', 'ハルトマン', '3 つの穴の像が 1 つになるように合わせる'],
  ['scheiner', 'シャイナー', '2 つの穴の像が 1 つになるように合わせる（C. Scheiner、1619）'],
  ['jwst', 'JWST', 'ジェイムズ・ウェッブ宇宙望遠鏡の主鏡の形（六角形 18 枚と副鏡の支柱 3 本）'],
  ['image', '画像', '用意した画像をマスクにする'],
];

/** マスクごとの斜めの格子の角度の既定値（°） */
export const TH0: Partial<Record<MaskKind, number>> = { bahtinov: 20, tri: 10, carey: 12 };

/** 望遠鏡の形式: 中央遮蔽とスパイダー */
export type ScopeKind = 'refr' | 'newt' | 'sct';
export const SCOPES: readonly (readonly [ScopeKind, string, string])[] = [
  ['refr', '屈折', '中央遮蔽もスパイダーもない'],
  ['newt', 'ニュートン', '副鏡の中央遮蔽と、4 本のスパイダー'],
  ['sct', 'シュミカセ', '副鏡の中央遮蔽（補正板に付くのでスパイダーはない）'],
];
export const OBS0: Record<ScopeKind, number> = { refr: 0, newt: 25, sct: 35 };
