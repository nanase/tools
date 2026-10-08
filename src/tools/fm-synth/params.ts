/** FM 音源の入力の定義: オペレータの値の範囲と初期値、鍵盤、音量、表示の設定 */
import { linList } from '../../lib/eseries';
import { minus, plain } from '../../lib/format';
import type { ParamDef, ParamFormat, ParamPatch } from '../../lib/param-def';

export type Op = 1 | 2 | 3 | 4;
export const OPS: readonly Op[] = [1, 2, 3, 4];

/** 周波数比の並び: OPN の MUL と同じ 0.5・1〜15 */
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
  sub: '基本周波数に掛ける倍率',
  unit: '',
  min: 0.5,
  max: 15,
  v: R0[n - 1],
  ph: '例 2',
  list: RATIOS,
  snap: true,
  notation: 'plain',
  format: { input: p3, view: (v) => `×${p3(v)}`, step: p3, text: (v) => `×${p3(v)}` },
  bad: '読めない値です（例 0.5・2）',
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
/** dB: 整数（JJY シミュレータの音量と同じ表記） */
const dbIn = (v: number): string => minus(String(Math.round(v)));
const DB: ParamFormat = { input: dbIn, step: (v) => (v > 0 ? '+' : '') + dbIn(v), text: (v) => `${dbIn(v)} dB` };

export type Key = 'vol';
export const VOL: ParamDef & { k: Key } = {
  k: 'vol',
  nm: 'A',
  sym: '<i>A</i>',
  name: '音量',
  sub: 'スピーカーへ出す大きさ（0 dB = 波形と同じ大きさ）',
  unit: 'dB',
  min: -60,
  max: 0,
  v: -30,
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
