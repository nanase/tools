/** デモザイクのページの選択肢（手法・表示・画像） */
import type { Method } from './demosaic';

/** 手法 [値, 短い名前, title] */
export const METHOD_L: readonly (readonly [Method, string, string])[] = [
  ['nearest', '最近傍', '同じ 2 × 2 の区画の値を写す'],
  ['bilinear', 'バイリニア', '隣の同じ色の平均'],
  ['mhc', 'MHC', 'Malvar-He-Cutler。5 × 5 の決まった係数で、ほかの色の変化も足す'],
  ['ha', 'HA', 'Hamilton-Adams。勾配の小さい向きに G を補間'],
  ['vng', 'VNG', '8 方向の勾配のうち小さい方向だけを平均'],
  ['ahd', 'AHD', '横と縦で補間した 2 枚から、色が均質な方を選ぶ'],
];
export const methodName = (m: Method): string => METHOD_L.find((x) => x[0] === m)?.[1] ?? m;
export const methodTitle = (m: Method): string => METHOD_L.find((x) => x[0] === m)?.[2] ?? '';

export type View = 'src' | 'mos' | 'out' | 'err';
export const VIEWS: readonly (readonly [View, string, string])[] = [
  ['src', '元画像', 'センサーに当たる前の画像（正解）'],
  ['mos', 'モザイク', 'センサーが測った値。画素ごとにフィルタの色だけ'],
  ['out', '結果', '選んだ手法で復元した画像'],
  ['err', '誤差 ×4', '元画像との差の絶対値を 4 倍。色の付いた所が偽色'],
];

export type SrcName = 'chart' | 'own';
export const SRCS: readonly (readonly [SrcName, string, string])[] = [
  ['chart', 'テスト画像', '柵・ゾーンプレート・ジーメンススター・色の境界・文字・布目'],
  ['own', 'ファイル', 'この端末の画像（送信なし）'],
];

/** 光学ローパスフィルタの代わりのぼかしの標準偏差（画素） */
export const LP_SIGMA = 0.6;
/** 色差のメディアンをくり返す回数 */
export const MED_TIMES = 2;
/** 拡大鏡に映す画素の数（1 辺） */
export const LOUPE = 16;
