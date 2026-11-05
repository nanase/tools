/** クラスタリングのページの数値入力の定義 */
import type { ParamDef } from '../../lib/param-def';
import type { Unit } from '../../lib/parse';

const num = (
  k: string,
  name: string,
  min: number,
  max: number,
  step: number,
  v: number,
  dec = 0,
  unit: Unit = '',
): ParamDef => {
  const f = (x: number): string => x.toFixed(dec);
  return {
    k,
    nm: name,
    sym: '',
    name,
    sub: '',
    unit,
    min,
    max,
    v,
    ph: `例 ${f(v)}`,
    lin: { step, big: step * 5 },
    sign: min === 0 ? 'nonneg' : 'pos',
    notation: 'plain',
    format: { input: f, view: f, step: f, text: (x) => (unit ? `${f(x)} ${unit}` : f(x)) },
    pre: [],
  };
};

/** 手法のパラメータ。行は手法ごとに出し分ける */
export const METHOD_PARAMS: ParamDef[] = [
  num('k', 'クラスタ数 k', 2, 12, 1, 3),
  num('batch', 'バッチの割合', 0.05, 0.5, 0.05, 0.1, 2),
  num('miter', '反復回数', 5, 60, 5, 25),
  num('fz', 'ファジィ係数', 1.2, 4, 0.1, 2, 1),
  num('kmax', 'k の上限', 2, 16, 1, 12),
  num('ksig', 'カーネルの幅', 0.02, 0.4, 0.01, 0.05, 2),
  num('T', 'CF の半径の上限', 0.01, 0.15, 0.005, 0.045, 3),
  num('reps', '代表点の数', 1, 12, 1, 6),
  num('alpha', '収縮率', 0, 0.9, 0.05, 0.2, 2),
  num('eps', '半径 ε', 0.02, 0.3, 0.005, 0.07, 3),
  num('minPts', '最小点数', 2, 20, 1, 5),
  num('cut', '切断の閾値', 0.01, 0.3, 0.005, 0.07, 3),
  num('mcs', '最小クラスタサイズ', 3, 200, 1, 18),
  num('h', 'バンド幅', 0.03, 0.4, 0.005, 0.13, 3),
  num('qsig', 'バンド幅', 0.01, 0.2, 0.005, 0.08, 3),
  num('tau', '接続距離の上限', 0.02, 0.6, 0.01, 0.33, 2),
  num('dc', 'カットオフ距離', 0.01, 0.3, 0.005, 0.065, 3),
  num('xi', 'ノイズの閾値', 0, 0.8, 0.05, 0.15, 2),
  num('K', '成分数の上限', 2, 12, 1, 8),
  num('a0', '混合比の事前分布', 0.001, 1, 0.001, 0.01, 3),
  num('viter', '反復回数の上限', 10, 150, 10, 80),
  num('nn', '近傍数', 2, 24, 1, 8),
  num('lnn', '近傍数', 2, 40, 1, 16),
  num('mnn', '近傍数', 2, 28, 1, 12),
  num('pref', '選好度の倍率', 0.5, 40, 0.5, 12, 1),
  num('aiter', '反復回数の上限', 50, 400, 50, 200),
  num('infl', 'インフレーション係数', 1.1, 4, 0.05, 1.25, 2),
  num('res', '解像度', 0.1, 3, 0.1, 0.1, 1),
  num('gx', '格子の幅', 3, 14, 1, 8),
  num('ep', 'エポック数', 1, 30, 1, 8),
  num('m', 'ノードの数', 3, 60, 1, 24),
  num('gmax', 'ノード数の上限', 4, 80, 1, 34),
  num('cell', 'セルの一辺', 0.02, 0.3, 0.005, 0.07, 3),
  num('ctau', '密度の閾値', 1, 20, 1, 2),
];

/** データのパラメータ */
export const SIZE = num('n', '点の数', 50, 400, 10, 300, 0, '点');
export const OUTLIER = num('out', '外れ値', 0, 20, 1, 0, 0, '%');
