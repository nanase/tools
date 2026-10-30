/** FFT のページの入力の定義（点の数・再生の速さ・数える点の数の行） */
import type { ParamDef } from '../../lib/param-def';

/** 図の点の数 */
export const NS = [4, 8, 16] as const;
/** 再生の 1× で 1 秒に進むバタフライの数。並べ替えはこの半分（全部の行が動くので） */
export const BASE = 0.75;
/** 再生の速さ [値, 表示] */
export const SPEEDS = [
  [1, '1×'],
  [4, '4×'],
  [16, '16×'],
] as const;

/** 演算の数を数える点の数: 2〜2^20 */
const CN = Array.from({ length: 20 }, (_, i) => 2 ** (i + 1));
const big = (v: number) => v.toLocaleString('ja-JP');
export const COUNT_N: ParamDef = {
  k: 'cn',
  nm: 'N',
  sym: '<i>N</i>',
  name: '点の数',
  sub: '数える点の数（2 の累乗）。バタフライ図の N とは別',
  unit: '点',
  v: 1024,
  list: CN,
  log: true,
  min: CN[0],
  max: CN[CN.length - 1],
  ph: '例 1024',
  pre: [],
  notation: 'plain',
  sign: 'pos',
  inputmode: 'decimal',
  snap: true,
  bad: '2 の累乗を入れてください（例 1024）',
  format: { input: String, view: big, step: big, text: (x) => `${big(x)} 点` },
};
