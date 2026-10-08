import type { Series } from '../../lib/eseries';
import { fmt } from '../../lib/format';
import type { ParamDef, ParamPatch } from '../../lib/param-def';
import { HI, INIT, LO, ohmsOf, short } from './model';

/** ドラッグと ‹ › の刻みに選べる E 系列 */
export const STEP_SERIES: readonly Series[] = [6, 12, 24, 48, 96, 192];
export const STEP_SERIES_INIT: Series = 24;

/** よく使う抵抗値（小さい順） */
const PRE = [10, 100, 220, 470, 1e3, 4.7e3, 10e3, 47e3, 100e3, 1e6];

/** E 系列 s で変わる項目 */
export const seriesPatch = (s: Series): ParamPatch => ({
  series: s,
  stepLabel: `E${s} で`,
  hint: `↑↓: E${s} で隣の値　PgUp/PgDn: 10 倍・1/10　Enter: 確定　Esc: 戻す`,
});

/**
 * 抵抗値の行。確定した値の範囲・桁への丸めと色帯への当てはめはページ側（model の fromValue）で行うので、
 * fix でそのまま通す
 */
export const R_DEF: ParamDef = {
  k: 'R',
  nm: 'R',
  sym: '<i>R</i>',
  name: '抵抗値',
  sub: '色の並びに直す値',
  unit: 'Ω',
  min: LO,
  max: HI,
  v: ohmsOf(INIT),
  ph: '例 4.7k',
  pre: PRE.map((v) => [v, short(v)]),
  sig: 6,
  format: { text: (v) => fmt(v, 'Ω', 6) },
  fix: (v) => [v, ''],
  bad: '読めない値です（例 4.7k・4k7・4R7・1M）',
  ...seriesPatch(STEP_SERIES_INIT),
};
