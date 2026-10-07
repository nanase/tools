/** カメラレンズの入力の定義（数値の行と選択肢） */
import { minus } from '../../lib/format';
import type { ParamDef, ParamFormat } from '../../lib/param-def';

/** 有効数字 s 桁、負はマイナス記号。keep なら末尾の 0 を残す（計算結果） */
export const sig = (v: number, s = 4, keep = false): string => {
  const t = v.toPrecision(s);
  return minus(keep && !t.includes('e') ? t : String(Number(t)));
};

/** ピントの距離の無限遠（入力の値。これ以上は無限遠として扱う） */
export const INF = 1e5;
const isInf = (v: number) => v >= INF * 0.999;
export const mT = (v: number): string => (isInf(v) ? '∞' : `${sig(v, 3)} m`);

const plainF = (u: string, s = 4): ParamFormat => ({
  input: (v) => sig(v, s),
  step: (v) => sig(v, 3),
  text: (v) => `${sig(v, s)}${u ? ` ${u}` : ''}`,
});

export type Key = 'f' | 'N' | 'fd' | 'coc' | 'pan' | 'tilt';

export const FOCAL: ParamDef = {
  k: 'f',
  nm: 'f',
  sym: '<i>f</i>',
  name: '焦点距離',
  sub: 'レンズの処方を相似に拡大・縮小して合わせる。長いほど画角が狭く、ボケが大きい',
  unit: 'mm',
  min: 8,
  max: 800,
  v: 50,
  ph: '例 50',
  pre: [
    [24, '24'],
    [35, '35'],
    [50, '50'],
    [85, '85'],
    [135, '135'],
    [200, '200'],
  ],
  tk: [
    [10, '10'],
    [20, '20'],
    [50, '50'],
    [100, '100'],
    [200, '200'],
    [500, '500'],
  ],
  list: [
    8, 10, 12, 14, 16, 18, 20, 21, 24, 28, 35, 40, 50, 55, 58, 70, 85, 100, 105, 135, 180, 200, 300, 400, 500, 600, 800,
  ],
  log: true,
  notation: 'plain',
  format: plainF('mm'),
};

/** 1/3 段ごとの F 値 */
export const FSTOPS = [
  1, 1.1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10, 11, 13, 14, 16, 18, 20,
  22, 25, 29, 32,
];
export const FNUM: ParamDef = {
  k: 'N',
  nm: 'N',
  sym: '<i>N</i>',
  name: '絞り（F 値）',
  sub: '焦点距離 ÷ 入射瞳の径。大きいほど絞りが小さく、被写界深度が深い。下限はレンズの開放 F 値',
  unit: '',
  min: 2,
  max: 32,
  v: 2.8,
  ph: '例 2.8',
  pre: [
    [2, '2'],
    [2.8, '2.8'],
    [4, '4'],
    [5.6, '5.6'],
    [8, '8'],
    [11, '11'],
    [16, '16'],
  ],
  tk: [
    [2, '2'],
    [4, '4'],
    [8, '8'],
    [16, '16'],
    [32, '32'],
  ],
  list: FSTOPS,
  log: true,
  notation: 'plain',
  format: { ...plainF('', 3), text: (v) => `F${sig(v, 3)}` },
};

export const FOCUS: ParamDef = {
  k: 'fd',
  nm: 's',
  sym: '<i>s</i>',
  name: 'ピントの距離',
  sub: 'センサーの面から、ピントを合わせる面まで。映像を押すと、その点に合わせる',
  unit: 'm',
  min: 0.2,
  max: INF,
  v: 2,
  ph: '例 2',
  pre: [
    [0.5, '0.5'],
    [1, '1'],
    [2, '2'],
    [4, '4'],
    [8, '8'],
    [16, '16'],
    [INF, '∞', '無限遠'],
  ],
  tk: [
    [0.5, '0.5'],
    [1, '1'],
    [2, '2'],
    [5, '5'],
    [10, '10'],
    [50, '50'],
    [INF, '∞'],
  ],
  list: [
    0.2,
    0.25,
    0.3,
    0.35,
    0.4,
    0.45,
    0.5,
    0.6,
    0.7,
    0.8,
    0.9,
    1,
    1.2,
    1.5,
    2,
    2.5,
    3,
    4,
    5,
    6,
    8,
    10,
    12,
    16,
    20,
    30,
    50,
    100,
    INF,
  ],
  log: true,
  notation: 'plain',
  format: { input: (v) => (isInf(v) ? '∞' : sig(v, 4)), step: (v) => (isInf(v) ? '∞' : sig(v, 3)), text: mT },
  bad: '読めない値です（例 1.5・3m。無限遠は ∞ のボタン）',
};

export const COC: ParamDef = {
  k: 'coc',
  nm: 'c',
  sym: '<i>c</i>',
  name: '許容錯乱円',
  sub: 'ボケがこの径より小さければピントが合って見なすときの径。被写界深度の計算だけに使う。35 mm 判では 0.03 mm が多い',
  unit: 'mm',
  min: 0.005,
  max: 0.1,
  v: 0.03,
  ph: '例 0.03',
  pre: [
    [0.02, '0.02'],
    [0.03, '0.03'],
    [0.05, '0.05'],
  ],
  tk: [],
  list: [0.005, 0.01, 0.015, 0.019, 0.02, 0.025, 0.03, 0.033, 0.035, 0.04, 0.05, 0.06, 0.08, 0.1],
  log: true,
  notation: 'plain',
  format: plainF('mm', 3),
  slider: false,
};

const angle = (k: 'pan' | 'tilt', name: string, sub: string, lim: number): ParamDef => ({
  k,
  nm: k === 'pan' ? 'φ' : 'θ',
  sym: k === 'pan' ? '<i>φ</i>' : '<i>θ</i>',
  name,
  sub,
  unit: '°',
  min: -lim,
  max: lim,
  v: 0,
  ph: '例 0',
  pre: [],
  tk: [
    [-lim, minus(String(-lim))],
    [0, '0'],
    [lim, String(lim)],
  ],
  lin: { step: 0.5, big: 5, major: lim, minor: lim / 6 },
  sign: 'any',
  notation: 'plain',
  format: {
    input: (v) => sig(v, 3),
    step: (v) => sig(v, 3),
    text: (v) => `${sig(v, 3)}°`,
  },
  fix: (v) => {
    const w = Math.round(v * 10) / 10;
    if (w < -lim) return [-lim, `下限 ${minus(String(-lim))}° にしました`];
    if (w > lim) return [lim, `上限 ${lim}° にしました`];
    return [w, ''];
  },
});
export const PAN = angle('pan', '方位', '撮影者の向き（右が正）。映像をドラッグしても変わる', 60);
export const TILT = angle('tilt', '仰角', '撮影者の向き（上が正）。映像をドラッグしても変わる', 30);

export const PARAMS: ParamDef[] = [FOCAL, FNUM, FOCUS, COC, PAN, TILT];

/** 絞り羽根の枚数（0 は円） */
export const BLADES = [0, 5, 6, 7, 8, 9] as const;
/** 拡大 */
export const ZOOMS = [1, 2, 4, 8] as const;
