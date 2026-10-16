/**
 * チューナーの入力の定義（基準ピッチ）と選択肢（表示・合格の幅・音名・音律・移調）。
 * .astro の描画とブラウザの動作の両方で使う
 */
import { linList } from '../../lib/eseries';
import type { ParamDef } from '../../lib/param-def';

export type Key = 'ref';

/** 基準ピッチ（A4）。0.5 Hz 刻みで 390〜490 Hz（市販機の広いもの Peterson StroboStomp HD と同じ範囲） */
export const REF: ParamDef & { k: Key } = {
  k: 'ref',
  nm: 'fA4',
  sym: '<i>f</i><sub>A4</sub>',
  name: '基準ピッチ',
  sub: 'A4（ト音記号の五線の第 2 間の A）の周波数。ISO 16 は 440 Hz。オーケストラでは 442・443 Hz、古楽では 415 Hz も使います',
  unit: 'Hz',
  min: 390,
  max: 490,
  v: 440,
  list: linList(390, 490, 0.5),
  jump: 10,
  snap: true,
  notation: 'plain',
  inputmode: 'decimal',
  ph: '例 442',
  bad: '読めない値です（例 440・442・415）',
  pre: [
    [415, '415'],
    [440, '440'],
    [442, '442'],
    [443, '443'],
  ],
};

/** 表示: 針のメータか、12 音のストロボ */
export type View = 'meter' | 'strobe';
/** 合格の幅 [セント] */
export const TOLS = [1, 2, 3, 5] as const;
/** 針の動き: 読み値をならす時定数 [s] */
export const RESP = { fast: 0.06, std: 0.16, slow: 0.4 } as const;
export type Resp = keyof typeof RESP;
/** 目盛りの端 [セント] */
export const SCALES = [50, 20] as const;
/** 縞の速さ: 周波数の差（機械式と同じ）か、セントに比例 */
export type Spd = 'hz' | 'cent';

/**
 * 音律: 主音 C のとき、A を 0 にそろえた平均律からのずれ [セント]（C, C♯, D, … B）。
 * 各音律の定義（どの 5 度を何コンマ狭めるか）から求めた値で、ヴェルクマイスター III・キルンベルガー III・ヴァロッティは
 * Wikipedia の表、ピタゴラス（ウルフは G♯–E♭）と 1/4 コンマ・ミーントーンは K. Gann の表と照合した
 */
export const TEMPERAMENTS: readonly (readonly [string, string, readonly number[]])[] = [
  ['et', '平均律', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ['pyth', 'ピタゴラス', [-5.87, 7.82, -1.96, -11.73, 1.96, -7.82, 5.87, -3.91, 9.78, 0, -9.78, 3.91]],
  [
    'mean',
    '1/4 コンマ・ミーントーン',
    [10.26, -13.69, 3.42, 20.53, -3.42, 13.69, -10.26, 6.84, -17.11, 0, 17.11, -6.84],
  ],
  ['wm3', 'ヴェルクマイスター III', [11.73, 1.96, 3.91, 5.87, 1.96, 9.78, 0, 7.82, 3.91, 0, 7.82, 3.91]],
  ['kb3', 'キルンベルガー III', [10.26, 0.49, 3.42, 4.4, -3.42, 8.31, 0.49, 6.84, 2.44, 0, 6.35, -1.47]],
  ['val', 'ヴァロッティ', [5.87, 0, 1.96, 3.91, -1.96, 7.82, -1.96, 3.91, 1.96, 0, 5.87, -3.91]],
  ['yg2', 'ヤング 第 2', [5.87, -3.91, 1.96, 0, -1.96, 3.91, -5.87, 3.91, -1.96, 0, 1.96, -3.91]],
];

/**
 * 主音 ton（ピッチクラス）の音律の、ピッチクラスごとのずれ [セント]。主音を C に置き換えた表を回し、A を 0 にそろえ直す
 * （基準ピッチの A はどの音律・主音でも変えない）。平均律は null
 */
export function deviations(tem: string, ton: number): number[] | null {
  const t = TEMPERAMENTS.find((x) => x[0] === tem);
  if (!t || t[0] === 'et') return null;
  const T = t[2],
    k = (p: number) => T[(((p - ton) % 12) + 12) % 12];
  return Array.from({ length: 12 }, (_, p) => k(p) - k(9));
}

/** 主音の選択肢（ピッチクラス） */
export const TONICS = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'] as const;

/** 移調: 記譜の音名で出すときに実音へ足す半音数（B♭ 管は記譜の C で実音の B♭ が鳴る） */
export const TRANSPOSE: readonly (readonly [number, string, string])[] = [
  [0, 'なし（C）', '実音の音名で出す'],
  [2, 'B♭ 管', 'クラリネット・トランペット・ソプラノ・サックスなど。実音より長 2 度高い音名で出す'],
  [9, 'E♭ 管', 'アルト・サックスなど。実音より長 6 度高い音名で出す'],
  [7, 'F 管', 'ホルンなど。実音より完全 5 度高い音名で出す'],
];

/** 純正律の長 3 度（5:4）・短 3 度（6:5）の、平均律からのずれ [セント]（メータの ▼） */
export const JUST_M3 = 1200 * Math.log2(5 / 4) - 400;
export const JUST_m3 = 1200 * Math.log2(6 / 5) - 300;
