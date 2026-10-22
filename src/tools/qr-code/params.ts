/** QR コードのページの入力の定義（型番の行・選択肢・既定の文字列） */
import type { ParamDef } from '../../lib/param-def';
import type { Mode } from './encode';
import type { Ecc } from './spec';

export const TEXT0 = 'https://nanase.cc/tools/qr-code/';
/** 文字列の長さの上限（型番 40 の数字モードの容量を少し超える程度） */
export const MAX_LEN = 8000;

export const ECC_CHOICES: readonly [Ecc, string, string][] = [
  ['L', 'L 7%', '符号語の約 7 % まで直せる'],
  ['M', 'M 15%', '符号語の約 15 % まで直せる'],
  ['Q', 'Q 25%', '符号語の約 25 % まで直せる'],
  ['H', 'H 30%', '符号語の約 30 % まで直せる'],
];
export const MODE_CHOICES: readonly [Mode | 'auto', string, string][] = [
  ['auto', '自動', '符号化できるモードのうち、ビット列がいちばん短くなるもの'],
  ['num', '数字', '0〜9 だけ。3 文字を 10 ビットにする'],
  ['alnum', '英数字', '0〜9・A〜Z・空白と $ % * + - . / : の 45 文字。2 文字を 11 ビットにする'],
  ['byte', 'バイト', '文字を UTF-8 のバイトにして、1 バイトを 8 ビットにする'],
  ['kanji', '漢字', 'Shift_JIS の 2 バイト文字だけ。1 文字を 13 ビットにする'],
];
export const BOOST_CHOICES: readonly [string, string, string][] = [
  ['0', '上げない', '選んだレベルのまま'],
  ['1', '上げる', '同じ型番に入る範囲で、誤り訂正のレベルを上げる'],
];

/** 自動で選んだ型番（欄の「自動（3）」の表示に使う。client.ts が入れる） */
let autoVer = 0;
export const setAutoVer = (v: number): void => {
  autoVer = v;
};
const verText = (v: number) => (v === 0 ? (autoVer ? `自動（${autoVer}）` : '自動') : String(v));

export const VER: ParamDef = {
  k: 'ver',
  nm: '型番',
  sym: '',
  name: '型番',
  sub: '1〜40。型番 v の QR コードは 17 + 4v モジュール角。0 は自動で、文字列が入る最小の型番にする',
  unit: '',
  min: 0,
  max: 40,
  v: 0,
  ph: '例 0（自動）・5',
  pre: [
    [0, '自動'],
    [1, '1'],
    [10, '10'],
    [20, '20'],
    [40, '40'],
  ],
  lin: { step: 1, big: 5 },
  sign: 'nonneg',
  notation: 'plain',
  inputmode: 'decimal',
  bad: '0〜40 の整数を入れてください（0 は自動）',
  fix: (v) => (Number.isInteger(v) ? null : [Math.round(v), '整数に丸めました']),
  format: { input: (v) => String(v), view: verText, step: verText, text: (v) => (v === 0 ? '自動' : `型番 ${v}`) },
};
