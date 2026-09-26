/** 送出する情報の選択肢の行（ChoiceRow）と、分や設定によって使わない行・注記（DOM に依存しない） */
import { callSignOn, type Options, stopOn } from './code';
import { type Jst, nextCallSign } from './time';

type Row<K extends keyof Options> = {
  k: K;
  /** 置く枠: 1 は「夏時間・閏秒」、2 は「コールサイン・停波」 */
  tab: 1 | 2;
  /** ビット名（記号の列） */
  sym: string;
  name: string;
  sub: string;
  /** 選択肢が多い行: 項目名を行の幅いっぱいに出し、チップを下に並べる */
  wide?: boolean;
  ch: readonly (readonly [Options[K], string])[];
};
export type OptRow = { [K in keyof Options]: Row<K> }[keyof Options];

const B2 = [
  [false, 'なし'],
  [true, 'あり'],
] as const;

export const OPT_ROWS: readonly OptRow[] = [
  { tab: 1, k: 'summerTimeNotice', sym: 'SU1', name: '夏時間の予告', sub: '38 秒・6 日以内に開始か終了', ch: B2 },
  { tab: 1, k: 'summerTime', sym: 'SU2', name: '夏時間の実施', sub: '40 秒', ch: B2 },
  { tab: 1, k: 'leapSecondNotice', sym: 'LS1', name: '閏秒の予告', sub: '53 秒・月末に実施', ch: B2 },
  {
    tab: 1,
    k: 'leapSecondType',
    sym: 'LS2',
    name: '閏秒の種別',
    sub: '54 秒',
    ch: [
      [true, '挿入'],
      [false, '削除'],
    ],
  },
  {
    tab: 2,
    k: 'callSign',
    sym: 'JJY',
    name: 'コールサイン',
    sub: '40–48 秒',
    ch: [
      ['default', '15・45 分'],
      ['force', '常に'],
      ['disable', '送らない'],
    ],
  },
  {
    tab: 2,
    k: 'stopAfter',
    sym: 'ST1–3',
    name: '停波の予告',
    sub: '50–52 秒・停波が始まるまで',
    wide: true,
    ch: [
      [0, '予定なし'],
      [6, '2 時間以内'],
      [5, '12 時間以内'],
      [4, '24 時間以内'],
      [3, '2 日以内'],
      [2, '3〜6 日以内'],
      [1, '7 日以内'],
    ],
  },
  {
    tab: 2,
    k: 'stopType',
    sym: 'ST4',
    name: '停波の時間帯',
    sub: '53 秒',
    ch: [
      [false, '終日'],
      [true, '昼間だけ'],
    ],
  },
  {
    tab: 2,
    k: 'stopDuration',
    sym: 'ST5–6',
    name: '停波の期間',
    sub: '54–55 秒',
    wide: true,
    ch: [
      [3, '2 日間以内'],
      [2, '2〜6 日間'],
      [1, '7 日間以上・未定'],
    ],
  },
];

/** 押した選択肢（data-v の文字列）を設定に写す。知らない値なら何もしない */
export function apply(o: Options, row: OptRow, v: string): void {
  const hit = row.ch.find(([x]) => String(x) === v);
  if (hit) Object.assign(o, { [row.k]: hit[0] });
}

/** 設定によって使わない（押せない）行 */
export const offRows = (o: Options): Partial<Record<keyof Options, boolean>> => ({
  leapSecondType: !o.leapSecondNotice,
  stopType: o.stopAfter === 0,
  stopDuration: o.stopAfter === 0,
});

/** 行の下の注記。t はいま表示している分 */
export function rowNotes(t: Pick<Jst, 'h' | 'mi'>, o: Options): Record<keyof Options, string> {
  const cs = callSignOn(t.mi, o),
    st = stopOn(t.mi, o),
    nx = nextCallSign(t);
  const onlyCs =
    o.callSign === 'disable' ? 'コールサインを送らないため使いません' : `コールサインの分だけ使います（次は ${nx}）`;
  const noStop = '停波の予告があるときだけ使います';
  return {
    summerTimeNotice: '',
    summerTime: cs ? 'この分はコールサインを送るため使いません' : '',
    leapSecondNotice: st ? 'この分は停波の予告を送るため使いません' : '',
    leapSecondType: !o.leapSecondNotice
      ? 'LS1 が「あり」のときだけ使います'
      : st
        ? 'この分は停波の予告を送るため使いません'
        : '',
    callSign: o.callSign === 'default' ? (cs ? 'この分は 40–48 秒に送ります' : `次は ${nx} に送ります`) : '',
    stopAfter: cs ? '' : onlyCs,
    stopType: o.stopAfter === 0 ? noStop : cs ? '' : onlyCs,
    stopDuration: o.stopAfter === 0 ? noStop : cs ? '' : onlyCs,
  };
}
