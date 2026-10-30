/** 画像の畳み込みのページの入力の定義（カーネルの例・画像・端の処理・速さ・数値の行） */
import type { ParamDef, ParamFormat } from '../../lib/param-def';
import type { Unit } from '../../lib/parse';
import type { Edge, KernelName } from './image';

/** 画像の大きさと、入力の周りに見せる端の外の幅（画素） */
export const W = 256;
export const H = 192;
export const PAD = 8;

/** カーネルの例 [名前, 表示, title] */
export const KN: readonly (readonly [KernelName, string, string])[] = [
  ['id', '恒等', '中央だけ 1。画像は変わらない'],
  ['box', '平均化', '窓の中の平均'],
  ['disk', '円形ぼけ', 'ピントが外れたレンズのぼけ（円の中で一定）'],
  ['gauss', 'ガウシアン', '正規分布の重みで平滑化'],
  ['motion', 'モーションブラー', '横方向の手ぶれ'],
  ['sharpen', '鮮鋭化', '中央を強め、周囲を引く'],
  ['unsharp', 'アンシャープマスク', '元 + k ×（元 − ガウシアン）'],
  ['edge', 'エッジ検出', '係数の和 0'],
  ['laplace', 'ラプラシアン', '2 次微分（係数の和 0）'],
  ['sobelx', 'Sobel x', '横方向の微分（右が明るいと正）'],
  ['sobely', 'Sobel y', '縦方向の微分（下が明るいと正）'],
  ['emboss', 'エンボス', '斜めにずらした画像を引く'],
  ['shift', '平行移動', '右へ 2 画素'],
];
/** 比べるための非線形の処理（畳み込みでない） */
export type NcName = 'median' | 'grad';
export const NC: readonly (readonly [NcName, string, string])[] = [
  ['median', 'メディアン', '窓の中の中央値'],
  ['grad', '勾配強度', 'Sobel x・y の結果から √(Gx² + Gy²)'],
];
export type KindName = KernelName | NcName;

export type SrcName = 'chart' | 'moon' | 'own' | 'draw';
export const SRCS: readonly (readonly [SrcName, string, string])[] = [
  ['chart', 'テスト画像', '点・線・縞・ノイズなどを並べた画像'],
  ['moon', '月面', '月の表側の一部（NASA SVS の CGI Moon Kit）'],
  ['own', 'ファイル', 'この端末の画像を読み込む（送信しない）'],
  ['draw', '手描き', '白と黒で描き足す'],
];
export const EDGES: readonly (readonly [Edge, string, string])[] = [
  ['clamp', '延長', '端の画素をそのまま外へ延ばす'],
  ['zero', 'ゼロ', '外を 0（黒）で埋める'],
  ['mirror', '折り返し', '端で鏡のように折り返す'],
  ['wrap', '周期', '反対側の端につなぐ（FFT での畳み込みと同じ）'],
];
/** 再生の速さ [値, 表示, 1 秒に進む画素] */
export const SPEEDS: readonly (readonly [string, string, number])[] = [
  ['slow', 'ゆっくり', 5],
  ['mid', 'ふつう', 900],
  ['fast', '速く', 16000],
];

const sig = (v: number, s: number) => String(Number(v.toPrecision(s)));
const plainF = (u: string): ParamFormat => ({
  input: (v) => sig(v, 4),
  step: (v) => sig(v, 3),
  text: (v) => `${sig(v, 4)}${u ? ` ${u}` : ''}`,
});
/** 並びを与える行。min・max は並びの端 */
function listed(
  d: Pick<ParamDef, 'k' | 'nm' | 'sym' | 'name' | 'sub' | 'v'> & { list: readonly number[]; unit?: Unit },
): ParamDef {
  return {
    ...d,
    unit: d.unit ?? '',
    min: d.list[0],
    max: d.list[d.list.length - 1],
    ph: `例 ${d.v}`,
    pre: [],
    notation: 'plain',
    sign: 'pos',
    inputmode: 'decimal',
    snap: true,
    bad: '数を入れてください（例 5）',
    format: plainF(d.unit ?? ''),
  };
}

export type ParamKey = 'n' | 'm' | 's' | 'kk';
export const PARAMS: ParamDef[] = [
  listed({
    k: 'n',
    nm: 'n',
    sym: '<i>n</i>',
    name: '大きさ',
    sub: 'カーネルの幅（奇数）',
    unit: '画素',
    v: 5,
    list: [3, 5, 7, 9, 11, 15],
  }),
  listed({
    k: 'm',
    nm: 'n',
    sym: '<i>n</i>',
    name: '大きさ',
    sub: 'メディアンの窓の幅',
    unit: '画素',
    v: 5,
    list: [3, 5, 7],
  }),
  listed({
    k: 's',
    nm: 'σ',
    sym: '<i>σ</i>',
    name: '標準偏差',
    sub: 'ぼけの広がり。±3σ で打ち切る',
    unit: '画素',
    v: 1.2,
    list: [0.5, 0.7, 1, 1.2, 1.5, 2, 2.5, 3],
  }),
  listed({
    k: 'kk',
    nm: 'k',
    sym: '<i>k</i>',
    name: '強さ',
    sub: '強調の度合い',
    v: 1.5,
    list: [0.25, 0.5, 1, 1.5, 2, 3, 4],
  }),
];
/** カーネルごとに使う数値の行 */
export const USES: Partial<Record<KindName, readonly ParamKey[]>> = {
  box: ['n'],
  disk: ['n'],
  motion: ['n'],
  gauss: ['s'],
  unsharp: ['s', 'kk'],
  sharpen: ['kk'],
  median: ['m'],
};
