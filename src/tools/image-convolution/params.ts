/** 画像の畳み込みのページの入力の定義（核の見本・画像・端・速さ・数値の行） */
import type { ParamDef, ParamFormat } from '../../lib/param-def';
import type { Unit } from '../../lib/parse';
import type { Edge, KernelName } from './image';

/** 画像の大きさと、入力の周りに見せる「画像の外」の幅（画素） */
export const W = 256;
export const H = 192;
export const PAD = 8;

/** 核の見本 [名前, 表示, title] */
export const KN: readonly (readonly [KernelName, string, string])[] = [
  ['id', '恒等', 'デルタ関数。画像は変わらない'],
  ['box', '平均', '窓の中の平均（箱形）'],
  ['disk', 'ピンぼけ', 'ピントの合わないレンズの点像（円柱）'],
  ['gauss', 'ガウス', '大気のゆらぎなどのぼけ（正規分布）'],
  ['motion', 'ぶれ', '横に動いたときのぶれ'],
  ['sharpen', '鮮鋭化', 'エッジ強調（デルタ関数 − 平滑化）'],
  ['unsharp', 'アンシャープ', 'アンシャープマスク（元 + k·（元 − ガウス））'],
  ['edge', 'エッジ', 'エッジ検出（和 0）'],
  ['laplace', 'ラプラシアン', '2 階の差分（和 0）'],
  ['sobelx', 'Sobel x', '横の勾配（右が明るいと正）'],
  ['sobely', 'Sobel y', '縦の勾配（下が明るいと正）'],
  ['emboss', '浮き彫り', 'ずらして引く'],
  ['shift', 'ずらす', '右へ 2 画素ずらす'],
];
/** 比べるための畳み込みでない処理 */
export type NcName = 'median' | 'grad';
export const NC: readonly (readonly [NcName, string, string])[] = [
  ['median', 'メディアン', '窓の中の値を並べた真ん中（畳み込みでない）'],
  ['grad', '勾配の大きさ', 'Sobel x と y の結果の √(Gx² + Gy²)（畳み込みの後の計算）'],
];
export type KindName = KernelName | NcName;

export type SrcName = 'chart' | 'moon' | 'own' | 'draw';
export const SRCS: readonly (readonly [SrcName, string, string])[] = [
  ['chart', '試験図', 'JPEG のページと同じ試験図'],
  ['moon', '月面', '月の表側の一部（NASA SVS の CGI Moon Kit）'],
  ['own', '手持ち', 'この端末の画像ファイル（送信しない）'],
  ['draw', '描く', '点・線・縁から始めて、白と黒で描き足す'],
];
export const EDGES: readonly (readonly [Edge, string, string])[] = [
  ['clamp', 'のばす', '端の画素の値をのばす'],
  ['zero', '0', '画像の外を 0（黒）とする'],
  ['mirror', '鏡', '端で折り返す（端の画素も写す）'],
  ['wrap', '反対側', '反対側の端から回る（周波数での畳み込みと同じ）'],
];
/** 走査の速さ [値, 表示, 1 秒に進む画素] */
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
    sub: '核の幅（奇数）',
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
    sub: 'ガウスの広がり。核は ±3σ で打ち切る',
    unit: '画素',
    v: 1.2,
    list: [0.5, 0.7, 1, 1.2, 1.5, 2, 2.5, 3],
  }),
  listed({
    k: 'kk',
    nm: 'k',
    sym: '<i>k</i>',
    name: '強さ',
    sub: '元との差を何倍して足すか',
    v: 1.5,
    list: [0.25, 0.5, 1, 1.5, 2, 3, 4],
  }),
];
/** 核ごとに使う数値の行 */
export const USES: Partial<Record<KindName, readonly ParamKey[]>> = {
  box: ['n'],
  disk: ['n'],
  motion: ['n'],
  gauss: ['s'],
  unsharp: ['s', 'kk'],
  sharpen: ['kk'],
  median: ['m'],
};
