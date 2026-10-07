/** JPEG のページの入力の定義（品質の行と、選択肢） */
import type { ParamDef } from '../../lib/param-def';

/** 品質（IJG の 1〜100、整数） */
export const QUALITY: ParamDef = {
  k: 'q',
  nm: 'q',
  sym: '<i>q</i>',
  name: '品質',
  sub: 'IJG（libjpeg）の品質。量子化テーブルは 50 で基準の表のまま、下げるほど粗く、100 ですべて 1 になる。cjpeg の既定は 75',
  unit: '',
  min: 1,
  max: 100,
  v: 50,
  ph: '例 75',
  lin: { step: 1, big: 10, major: 25, minor: 5 },
  notation: 'plain',
  sig: 3,
  inputmode: 'decimal',
  bad: '読めない値です（例 75）',
  fix: (v) => {
    const w = Math.min(100, Math.max(1, Math.round(v)));
    return [w, w === v ? '' : `${String(v)} は 1〜100 の整数ではないため ${w} にしました`];
  },
  pre: [
    [10, '10'],
    [25, '25'],
    [50, '50'],
    [75, '75'],
    [90, '90'],
    [95, '95'],
    [100, '100'],
  ],
  tk: [
    [1, '1'],
    [25, '25'],
    [50, '50'],
    [75, '75'],
    [100, '100'],
  ],
};

/** 色差の間引き [値, 表示, title] */
export const SUBS = [
  ['444', '4:4:4', '間引かない（MCU 8×8 画素）'],
  ['422', '4:2:2', '色差を横だけ 1/2 にする（MCU 16×8 画素）'],
  ['420', '4:2:0', '色差を縦横とも 1/2 にする（MCU 16×16 画素）。cjpeg の既定'],
] as const;

/** 量子化テーブル */
export const QTABS = [
  ['k', 'Annex K', 'ITU-T T.81 Annex K の表 K.1（輝度）と K.2（色差）。高い周波数ほど粗く、色差は輝度より粗い'],
  ['flat', '平坦', 'どの周波数も同じ 16（品質 50 のとき）。輝度と色差も同じ'],
] as const;

/** ハフマン表 */
export const HUFFS = [
  ['std', '標準', 'ITU-T T.81 Annex K の表 K.3〜K.6。どの画像にも同じ表を使う'],
  ['opt', '最適化', 'この画像の記号の出現回数から作った表（T.81 K.2 の手順、cjpeg の -optimize）'],
] as const;

/** 復号の色差の補間 */
export const UPS = [
  ['near', '最近傍', '間引いた色差の値をそのまま繰り返す'],
  ['lin', '線形', '隣の標本と 3:1 の重みで補間する（libjpeg 6b と libjpeg-turbo の既定）'],
] as const;

/** 画像の表示 */
export const VIEWS = [
  ['dec', '復号', '符号化した JPEG を、このツールの復号器で戻した画像'],
  ['org', '元', '符号化する前の画像'],
  ['diff', '差', '復号した画像と元の画像の差（灰色が差 0）'],
  ['bits', 'ビット数', '8×8 画素ごとのビット数（色差は MCU の中で等分）'],
] as const;

/** 差の強調 */
export const GAINS = [1, 4, 16] as const;
/** 拡大する範囲 [画素] */
export const ZOOMS = [16, 32, 64] as const;

/** 長い辺の上限 [画素]。これを超える画像は縮小する */
export const MAX_SIDE = 1024;
