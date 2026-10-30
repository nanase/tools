/**
 * 分岐図のページの入力の定義（パラメータ r・初めの値・音量）と選択肢（写像・拡大・音）。
 * .astro の描画とブラウザの動作の両方で使う
 */
import { linList } from '../../lib/eseries';
import { minus } from '../../lib/format';
import type { ParamDef, ParamFormat } from '../../lib/param-def';
import { MAPS, type MapId, R_INF_LOGISTIC } from './map';

export type Key = 'r' | 'x0' | 'vol';

const sig = (v: number, s: number) => String(Number(v.toPrecision(s)));
const plainF = (s: number): ParamFormat => ({
  input: (v) => sig(v, s),
  step: (v) => sig(v, s),
  text: (v) => sig(v, s),
});

/** 写像ごとの名前・記号・式と、r の欄のプリセット */
export const MAP_INFO: Record<MapId, { name: string; sym: string; eq: string; pre: [number, string, string?][] }> = {
  logistic: {
    name: 'ロジスティク',
    sym: 'r',
    eq: '<i>x</i><sub><i>n</i>+1</sub> = <i>r</i> <i>x</i><sub><i>n</i></sub>(1 − <i>x</i><sub><i>n</i></sub>)',
    pre: [
      [3, '3', '周期 1 → 2'],
      [1 + Math.sqrt(6), '3.4495', '周期 2 → 4'],
      [R_INF_LOGISTIC, '3.5699', '集積点'],
      [1 + 2 * Math.sqrt(2), '3.8284', '周期 3 の窓'],
      [4, '4', '上端'],
    ],
  },
  sine: {
    name: '正弦',
    sym: 'r',
    eq: '<i>x</i><sub><i>n</i>+1</sub> = <i>r</i> sin π<i>x</i><sub><i>n</i></sub>',
    pre: [
      [0.8655792688, '0.8656', '集積点'],
      [1, '1', '上端'],
    ],
  },
  tent: {
    name: 'テント',
    sym: 'μ',
    eq: '<i>x</i><sub><i>n</i>+1</sub> = <i>μ</i> min(<i>x</i><sub><i>n</i></sub>, 1 − <i>x</i><sub><i>n</i></sub>)',
    pre: [
      [1, '1', 'カオスの始まり'],
      [Math.SQRT2, '1.4142', '2 つの帯が 1 つに'],
      [2, '2', '上端'],
    ],
  },
};
export const MAP_CHOICES = (Object.keys(MAPS) as MapId[]).map((k) => [k, MAP_INFO[k].name] as const);

/** r の欄の定義（写像に合わせて範囲・記号・プリセットを差し替える） */
export function rPatch(id: MapId): Pick<ParamDef, 'nm' | 'sym' | 'min' | 'max' | 'v' | 'ph' | 'pre'> {
  const m = MAPS[id],
    s = MAP_INFO[id].sym;
  return {
    nm: s,
    sym: `<i>${s}</i>`,
    min: m.lo,
    max: m.hi,
    v: id === 'logistic' ? 3.5 : id === 'sine' ? 0.85 : 1.5,
    ph: `例 ${id === 'logistic' ? 3.5 : id === 'sine' ? 0.85 : 1.5}`,
    pre: MAP_INFO[id].pre,
  };
}

export const R: ParamDef & { k: Key } = {
  k: 'r',
  name: 'パラメータ',
  sub: '分岐図・リアプノフ指数の上をドラッグしても変わる',
  unit: '',
  ...rPatch('logistic'),
  lin: { step: 0.001, big: 0.01 },
  notation: 'plain',
  sign: 'nonneg',
  inputmode: 'decimal',
  format: plainF(6),
  bad: '数を入れてください（例 3.5）',
};

export const X0: ParamDef & { k: Key } = {
  k: 'x0',
  nm: 'x0',
  sym: '<i>x</i><sub>0</sub>',
  name: '初めの値',
  sub: 'クモの巣図と時系列の出発点',
  unit: '',
  min: 0.01,
  max: 0.99,
  v: 0.3,
  ph: '例 0.3',
  pre: [],
  lin: { step: 0.01, big: 0.1 },
  notation: 'plain',
  sign: 'pos',
  inputmode: 'decimal',
  format: plainF(4),
  bad: '数を入れてください（例 0.3）',
};

/* ---------- 音 ---------- */
const dbIn = (v: number): string => minus(String(Math.round(v)));
/** 音量 [dB]（0 dB = 波形の最大がフルスケール）。既定値は音の枠の決まりの −30 dB */
export const VOL: ParamDef & { k: Key } = {
  k: 'vol',
  nm: 'A',
  sym: '<i>A</i>',
  name: '音量',
  sub: 'スピーカーへ出す大きさ（0 dB = フルスケール）',
  unit: 'dB',
  min: -60,
  max: 0,
  v: -30,
  ph: '例 −20',
  list: linList(-60, 0, 1),
  jump: 6,
  sign: 'any',
  format: { input: dbIn, step: (v) => (v > 0 ? '+' : '') + dbIn(v), text: (v) => `${dbIn(v)} dB` },
  fix: (v) => {
    const c = Math.min(0, Math.max(-60, v)),
      w = Math.round(c);
    return [w, c === v ? '' : `${dbIn(v)} dB は範囲外のため${w === 0 ? '上限' : '下限'} ${dbIn(w)} dB にしました`];
  },
  bad: '読めない値です（例 −6・−20）',
  pre: [],
};
export const SND_MODES = [
  ['wave', '波形', '値の列をそのまま波形に（毎秒 880 回）'],
  ['melody', '旋律', '値を音の高さに（毎秒 8 音）'],
] as const;
export const SCALES = [
  ['cont', '連続'],
  ['penta', '五音音階'],
] as const;
/** 波形で写像をまわす回数 [回/s] と、旋律の音符の数 [音/s]・最も低い音 [Hz]・オクターブの幅 */
export const WAVE_RATE = 880;
export const MELODY_RATE = 8;
export const MELODY_LO = 220;
export const MELODY_OCT = 2;

/* ---------- 拡大 ---------- */
export interface View {
  r0: number;
  r1: number;
  y0: number;
  y1: number;
  /** 上下を反転して描く（δ 倍の拡大で、枝の向きをそろえる） */
  flip?: boolean;
  /** 過渡を捨てる回数の倍率（集積点の近くは収束が遅い） */
  deep?: number;
}
/** ロジスティク写像の拡大のプリセット [名前, 範囲]。null は写像の既定の範囲 */
export const ZOOMS: readonly (readonly [string, View | null])[] = [
  ['全体', null],
  ['周期倍分岐', { r0: 3.4, r1: 3.6, y0: 0.28, y1: 0.92 }],
  ['集積点の付近', { r0: 3.5625, r1: 3.5735, y0: 0.32, y1: 0.92, deep: 2 }],
  ['周期 3 の窓', { r0: 3.8406, r1: 3.8572, y0: 0.43, y1: 0.55 }],
  ['周期 5 の窓', { r0: 3.7375, r1: 3.7445, y0: 0.2, y1: 1 }],
];
/** δ 倍の拡大の段の数 */
export const FEIG_LEVELS = 5;

/* ---------- 掃引 ---------- */
/** 表示の範囲を左端から右端まで動かす時間 [s]（×1） */
export const SWEEP_S = 24;
export const SPEEDS = [0.5, 1, 2] as const;
