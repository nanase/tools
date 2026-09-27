/** フラグの枠の行と、年の注記（DOM に依存しない） */
import { OPT_ROWS } from '../jjy/options';
import type { Res, Val } from './decoder';

/** [値の HTML, 注記, 警告か] */
export type FlagOut = readonly [string, string?, boolean?];
/** [ビット名, 項目名, 値を出す関数] */
export type Flag = readonly [string, string, (r: Res) => FlagOut];

/** 選択肢の表示（シミュレータの選択肢と同じ言い回し） */
const labels = (k: 'stopAfter' | 'stopDuration'): Record<number, string> =>
  Object.fromEntries((OPT_ROWS.find((r) => r.k === k)?.ch ?? []).map(([v, l]) => [Number(v), l]));
const ST_AFTER = labels('stopAfter'),
  ST_DUR = labels('stopDuration');

const NA_CS = 'コールサインの分は送られません',
  NA_ST = '停波の予告の分は送られません';
const bitv = (b: Val, f: (b: number) => FlagOut): FlagOut =>
  b === 1 || b === 0 ? f(b) : b === undefined ? ['—'] : ['読めません', '', true];
/** ST1〜3・ST5〜6 の値 */
const code = (v: Val, L: Record<number, string>): FlagOut =>
  v === undefined ? ['—'] : Number.isNaN(v) ? ['読めません', '', true] : [L[v] || `${v}（未定義）`, '', !L[v]];

export const FLAGS: readonly Flag[] = [
  [
    'PA1',
    '時のパリティ',
    (r) => (r.pa1 == null ? ['—'] : r.pa1 ? ['一致'] : ['不一致', '時のビットか PA1 に誤りがあります', true]),
  ],
  [
    'PA2',
    '分のパリティ',
    (r) => (r.pa2 == null ? ['—'] : r.pa2 ? ['一致'] : ['不一致', '分のビットか PA2 に誤りがあります', true]),
  ],
  [
    'M・P',
    'マーカの位置',
    (r) =>
      r.mkN
        ? [
            `${r.mkOk}<span class="u">/ ${r.mkN}</span>`,
            r.mkOk < r.mkN ? 'マーカのない位置があります' : '',
            r.mkOk < r.mkN,
          ]
        : ['—'],
  ],
  [
    '',
    '曜日の照合',
    (r) =>
      r.wdOk == null
        ? ['—', r.cs ? NA_CS : '']
        : r.wdOk
          ? ['一致', '年と通算日から計算']
          : ['不一致', '年と通算日から計算した曜日と違います', true],
  ],
  ['SU1', '夏時間の予告', (r) => bitv(r.su1, (b) => (b ? ['あり', '6 日以内に開始か終了'] : ['なし']))],
  [
    'SU2',
    '夏時間の実施',
    (r) => (r.cs ? ['—', NA_CS] : r.cs == null ? ['—'] : bitv(r.su2, (b) => (b ? ['あり', '実施中'] : ['なし']))),
  ],
  [
    'LS1',
    '閏秒の予告',
    (r) => (r.st ? ['—', NA_ST] : r.st == null ? ['—'] : bitv(r.ls1, (b) => (b ? ['あり', '月末に実施'] : ['なし']))),
  ],
  [
    'LS2',
    '閏秒の種別',
    (r) =>
      r.st
        ? ['—', NA_ST]
        : r.st == null
          ? ['—']
          : r.ls1 === 0
            ? ['—', 'LS1 が「あり」のときだけ']
            : bitv(r.ls2, (b) => [b ? '挿入' : '削除']),
  ],
  [
    'JJY',
    'コールサイン',
    (r) =>
      r.cs == null ? ['—'] : r.cs ? ['受信', '40–48 秒のモールス符号'] : ['なし', '毎時 15 分と 45 分に送られます'],
  ],
  [
    'ST1–3',
    '停波の予告',
    (r) => (r.cs === false ? ['—', 'コールサインの分だけ'] : r.cs == null ? ['—'] : code(r.stA, ST_AFTER)),
  ],
  [
    'ST4',
    '停波の時間帯',
    (r) => (r.st ? bitv(r.st4, (b) => [b ? '昼間だけ' : '終日']) : r.st == null ? ['—'] : ['—', '停波の予告の分だけ']),
  ],
  ['ST5–6', '停波の期間', (r) => (r.st ? code(r.st56, ST_DUR) : r.st == null ? ['—'] : ['—', '停波の予告の分だけ'])],
];

/** 年の注記 */
export const yNote = (r: Res): string =>
  r.yCarry
    ? '前の分から引き継ぎ'
    : r.y !== undefined && r.y >= 0
      ? `下 2 桁 ${String(r.y).padStart(2, '0')}`
      : r.cs
        ? 'コールサインの分は送られません'
        : '';
