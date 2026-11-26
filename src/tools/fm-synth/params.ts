/** FM 音源の入力の定義: オペレータの値の範囲と初期値、鍵盤、音量、表示の設定 */
import { linList } from '../../lib/eseries';
import { minus, plain } from '../../lib/format';
import type { ParamDef, ParamFormat, ParamPatch } from '../../lib/param-def';
import { TRANSPOSE } from '../fm-synthesizer/params';

export type Op = 1 | 2 | 3 | 4;
export const OPS: readonly Op[] = [1, 2, 3, 4];

/** 周波数比の並び（‹ › とドラッグで移る値）: OPN の MUL と同じ 0.5・1〜15。入力では端数も使える */
export const RATIOS = [0.5, ...linList(1, 15, 1)];
/** 変調指数（モジュレータ）: 0〜10 rad を 0.1 刻み */
export const IDX = { min: 0, max: 10, step: 0.1 } as const;
/** 出力レベル（キャリア）: −60〜0 dB を 1 dB 刻み */
export const LVL = { min: -60, max: 0, step: 1 } as const;

/** 初期値（OP1〜OP4）: アルゴリズム 4 で OP1 → OP2、OP3 → OP4 の 2 組 */
export const W0 = ['sin', 'sin', 'sin', 'sin'],
  R0 = [1, 1, 1, 2],
  I0 = [1.5, 1, 2, 1],
  L0 = [0, -3, 0, -12];

/* ---------- オペレータの数値の行（周波数比と、変調指数か出力レベル） ---------- */
const p3 = (v: number) => plain(v, 3);
/** 周波数比の行（キー r1〜r4。ブラウザに p:r1〜p:r4 として保存する） */
export const ratioDef = (n: Op): ParamDef => ({
  k: `r${n}`,
  nm: `OP${n}`,
  sym: '',
  name: `OP${n} の周波数比`,
  sub: '基本周波数に掛ける倍率（端数も可）',
  unit: '',
  min: 0.5,
  max: 15,
  v: R0[n - 1],
  ph: '例 2',
  list: RATIOS,
  notation: 'plain',
  format: { input: p3, view: (v) => `×${p3(v)}`, step: p3, text: (v) => `×${p3(v)}` },
  fix: fixTo(0.5, 15, 0.001, (v) => `×${p3(v)}`),
  bad: '読めない値です（例 0.5・1.41）',
  pre: [],
});
/** 範囲外を丸め、刻みに合わせる */
const fixTo =
  (min: number, max: number, step: number, text: (v: number) => string) =>
  (v: number): readonly [number, string] => {
    const c = Math.min(max, Math.max(min, v)),
      w = Number((Math.round(c / step) * step).toFixed(6));
    return [w, c !== v ? `${text(v)} は範囲外のため${w === max ? '上限' : '下限'} ${text(w)} にしました` : ''];
  };
const dbT = (v: number) => `${minus(String(Math.round(v)))} dB`;
/** 強さの行（キー a1〜a4）の、キャリア（出力レベル）とモジュレータ（変調指数）で変わる項目 */
export const ampPatch = (n: Op, car: boolean): ParamPatch =>
  car
    ? {
        nm: `OP${n}`,
        name: `OP${n} の出力レベル`,
        sub: 'キャリアの振幅（0 dB = フルスケール）',
        unit: 'dB',
        min: LVL.min,
        max: LVL.max,
        v: L0[n - 1],
        list: linList(LVL.min, LVL.max, LVL.step),
        jump: 6,
        sign: 'any',
        format: { input: (v) => minus(String(Math.round(v))), view: dbT, text: dbT },
        fix: fixTo(LVL.min, LVL.max, LVL.step, dbT),
        bad: '読めない値です（例 −6・−20）',
      }
    : {
        nm: `OP${n}`,
        name: `OP${n} の変調指数`,
        sub: 'モジュレータの振幅（変調先の位相をずらす最大の量 [rad]）',
        unit: '',
        min: IDX.min,
        max: IDX.max,
        v: I0[n - 1],
        list: linList(IDX.min, IDX.max, IDX.step),
        jump: 10,
        sign: 'nonneg',
        format: { input: p3, view: (v) => `I ${p3(v)}`, text: (v) => `I ${p3(v)}` },
        fix: fixTo(IDX.min, IDX.max, IDX.step, (v) => `I ${p3(v)}`),
        bad: '読めない値です（例 1.5）',
      };
/** 強さの行（キー a1〜a4）。保存はページ側（キャリアは p:l1〜、モジュレータは p:i1〜） */
export const ampDef = (n: Op, car: boolean): ParamDef =>
  ({ k: `a${n}`, sym: '', ph: '', notation: 'plain', pre: [], ...ampPatch(n, car) }) as ParamDef;

/** 初期のアルゴリズムと帰還量、音量の調整 */
export const ALG0 = 4,
  FB0 = 0,
  NORM0 = 'on';

/* ---------- 鍵盤 ---------- */
/** 鍵盤に並べる音: 2 オクターブと上の C（25 鍵） */
export const KEYS = 25;
/** 鍵盤の左端の C のオクターブ（C1〜C6）。初期は C3〜C5 */
export const OCT = { min: 1, max: 6, v: 3 } as const;
/** 初期の音（MIDI のノート番号。69 = A4 = 440 Hz） */
export const NOTE0 = 69;
/** 平均律の周波数（A4 = 440 Hz） */
export const noteHz = (n: number): number => 440 * 2 ** ((n - 69) / 12);
const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
/** 音名（C4 = 60） */
export const noteName = (n: number): string => `${NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

/* ---------- 音量 ---------- */
/** dB: 整数（JJY のページの音量と同じ表記） */
const dbIn = (v: number): string => minus(String(Math.round(v)));
const DB: ParamFormat = { input: dbIn, step: (v) => (v > 0 ? '+' : '') + dbIn(v), text: (v) => `${dbIn(v)} dB` };

export type Key = 'vol';
export const VOL: ParamDef & { k: Key } = {
  k: 'vol',
  nm: 'A',
  sym: '<i>A</i>',
  name: '音量',
  sub: 'スピーカへ出す大きさ（0 dB = 波形と同じ大きさ）',
  unit: 'dB',
  min: -60,
  max: 0,
  v: -26,
  ph: '例 −20',
  list: linList(-60, 0, 1),
  jump: 6,
  sign: 'any',
  format: DB,
  fix: (v) => {
    const c = Math.min(0, Math.max(-60, v)),
      w = Math.round(c);
    return [w, c === v ? '' : `${dbIn(v)} dB は範囲外のため${w === 0 ? '上限' : '下限'} ${dbIn(w)} dB にしました`];
  },
  bad: '読めない値です（例 −6・−20）',
  pre: [],
};

/* ---------- 表示 ---------- */
/** 波形に出す周期の数 */
export const PERIODS = [1, 2, 4, 8] as const;
/** 波形の表示範囲（中心から端までの振幅、フルスケールを 1 とする） */
export const RANGES = [0.5, 1, 2, 4] as const;
/** スペクトラムの横軸の右端（基本周波数の何倍まで） */
export const HMAX = [8, 16, 32, 64] as const;

/* ---------- 強さ・デチューン・エンベロープ（FMシンセサイザから持ち込んだ行） ---------- */
const intIn = (v: number) => String(Math.round(v));
/** 強さ（1〜127）。画面の鍵盤・曲・波形の図はこの強さ。MIDI 機器と MIDI ファイルはノートのベロシティ */
export const VEL: ParamDef & { k: 'vel' } = {
  k: 'vel',
  nm: '強さ',
  sym: '',
  name: '強さ',
  sub: '鍵盤と曲の音の強さ（MIDI のベロシティと同じ 1〜127。弱いほど暗く小さい音）',
  unit: '',
  min: 1,
  max: 127,
  v: 127,
  ph: '例 64',
  lin: { step: 1, big: 10 },
  sign: 'pos',
  notation: 'plain',
  format: { input: intIn, step: intIn, text: intIn },
  fix: (v) => {
    const c = Math.min(127, Math.max(1, v)),
      w = Math.round(c);
    return [w, c !== v ? `${intIn(v)} は範囲外のため${w === 127 ? '上限' : '下限'} ${w} にしました` : ''];
  },
  bad: '読めない値です（例 64）',
  pre: [],
};

/** デチューンの範囲 [Hz] */
export const DT = { min: -10, max: 10, step: 0.1 } as const;
const hzIn = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '') + plain(Math.abs(Math.round(v * 10) / 10), 3);
const hzT = (v: number) => `${hzIn(v)} Hz`;
/** デチューンの行（キー d1〜d4） */
export const detDef = (n: Op): ParamDef => ({
  k: `d${n}`,
  nm: `OP${n}`,
  sym: '',
  name: `OP${n} のデチューン`,
  sub: '周波数比で決めた周波数に足す量 [Hz]',
  unit: 'Hz',
  min: DT.min,
  max: DT.max,
  v: 0,
  ph: '例 0.5',
  lin: { step: DT.step, big: 1 },
  sign: 'any',
  notation: 'plain',
  format: { input: hzIn, view: hzT, step: hzIn, text: hzT },
  fix: fixTo(DT.min, DT.max, DT.step, hzT),
  bad: '読めない値です（例 0.5・−1）',
  pre: [],
});

/** エンベロープの段: アタック・ディケイ・サステイン・リリース */
export type Seg = 'a' | 'd' | 's' | 'r';
export const SEGS: readonly Seg[] = ['a', 'd', 's', 'r'];
/** 時間の並び [s]（‹ › とドラッグで移る値。入力は 0〜10 s の任意の値） */
export const TIMES = [
  0, 0.001, 0.002, 0.005, 0.01, 0.02, 0.03, 0.05, 0.08, 0.1, 0.15, 0.2, 0.3, 0.5, 0.8, 1, 1.5, 2, 3, 5, 8, 10,
];
export const T_MAX = 10;
/** 時間の表記（1 s 未満は ms） */
export const timeT = (v: number): string =>
  v >= 1 ? `${plain(Number(v.toPrecision(3)), 3)} s` : `${plain(Number((v * 1000).toPrecision(3)), 3)} ms`;
const pctT = (v: number) => `${Math.round(v)} %`;
const SEG_NAME: Record<Seg, string> = { a: 'アタック', d: 'ディケイ', s: 'サステイン', r: 'リリース' };
const SEG_SUB: Record<Seg, string> = {
  a: '0 から最大まで上がる時間',
  d: '最大からサステインへ下がる時間（差が 60 dB 縮む時間）',
  s: '押している間に落ち着く大きさ（最大に対する割合）',
  r: '離してから 60 dB 下がる時間',
};
/** エンベロープの行（キー ea1・ed1・es1・er1 … ）。v0 は既定値（A・D・R は秒、S は %） */
export const envDef = (n: Op, g: Seg, v0: number): ParamDef =>
  g === 's'
    ? {
        k: `es${n}`,
        nm: 'S',
        sym: '',
        name: `OP${n} の${SEG_NAME.s}`,
        sub: SEG_SUB.s,
        unit: '%',
        min: 0,
        max: 100,
        v: v0,
        ph: '例 50',
        lin: { step: 1, big: 10 },
        sign: 'nonneg',
        notation: 'plain',
        format: { input: intIn, view: (v) => `S ${pctT(v)}`, step: intIn, text: pctT },
        fix: fixTo(0, 100, 1, pctT),
        bad: '読めない値です（例 50）',
        pre: [],
      }
    : {
        k: `e${g}${n}`,
        nm: g.toUpperCase(),
        sym: '',
        name: `OP${n} の${SEG_NAME[g]}`,
        sub: SEG_SUB[g],
        unit: 's',
        min: 0,
        max: T_MAX,
        v: v0,
        ph: '例 0.2',
        list: TIMES,
        jump: 3,
        sign: 'nonneg',
        notation: 'plain',
        format: {
          input: (v) => plain(Number(v.toPrecision(4)), 4),
          view: (v) => `${g.toUpperCase()} ${timeT(v)}`,
          text: timeT,
        },
        fix: (v) => {
          const c = Math.min(T_MAX, Math.max(0, v)),
            w = Number(c.toPrecision(3));
          return [
            w,
            c !== v ? `${timeT(v)} は範囲外のため${w === T_MAX ? '上限' : '下限'} ${timeT(w)} にしました` : '',
          ];
        },
        bad: '読めない値です（例 0.2・1.5）',
        pre: [],
      };

/* ---------- 時間変化の表示 ---------- */
/** 表示する時間 [s]（長さの 3/4 で鍵を離す） */
export const SPANS = [1, 2, 4, 8] as const;

/** トランスポーズ（FMシンセサイザと同じ行。このページにはパーカッションがない） */
export const TR: ParamDef & { k: 'tr' } = {
  ...TRANSPOSE,
  sub: '曲・MIDI ファイル・MIDI 機器の音を半音ずつ上げ下げ（画面の鍵盤は移さない）',
};
