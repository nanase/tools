/** 動作原理と式の MathML。一般の式（EQS）はビルド時に、この分の符号を代入した式は画面で作る */
import { FIELDS, PA1, PA2 } from '../jjy/code';
import { IT, MDOT, pa, sec, sub, wsum, xsum } from '../jjy/math';
import type { Res, Sym } from './decoder';

const msec = '<mspace width="0.17em"/><mi mathvariant="normal">ms</mi>';
const sb = (a: string, b: string | number) => `<msub><mi>${a}</mi><mn>${b}</mn></msub>`;
const fr2 = (a: string, b: string) => `<mfrac><mrow>${a}</mrow><mrow>${b}</mrow></mfrac>`;
const br = (x: string) => `<mo stretchy="false">[</mo>${x}<mo stretchy="false">]</mo>`;
const f0 = sb('f', 0),
  fs = sub('f', 's'),
  AH = sub('A', 'H'),
  AL = sub('A', 'L');
const sumk = `<munderover><mo>&#x2211;</mo><mrow><mi>k</mi><mo>=</mo><mi>n</mi><mo>&#x2212;</mo><mi>N</mi><mo>+</mo><mn>1</mn></mrow><mi>n</mi></munderover>`;
const arg = `<mrow><mo>(</mo><mn>2</mn><mi>π</mi>${IT}${fr2(`${f0}${IT}<mi>k</mi>`, fs)}<mo>)</mo></mrow>`;
const xk = `<mi>x</mi>${br('<mi>k</mi>')}`;
const sq = (v: string) => `<mi>${v}</mi><msup><mrow>${br('<mi>n</mi>')}</mrow><mn>2</mn></msup>`;
const sp = '<mo>,</mo><mspace width="1em"/>';
const row = (a: string, b: string) => `<mtr><mtd><mtext>${a}</mtext></mtd><mtd>${b}</mtd></mtr>`;
const rng = (a: string, b: string) => `<mn>${a}</mn>${sec}<mo>&#x2264;</mo><mi>τ</mi><mo>&lt;</mo><mn>${b}</mn>${sec}`;

/** 一般の式。節ごとに分ける */
export const EQG = {
  /** 包絡線と搬送波の周波数 */
  env: [
    `<math display="block"><mi>I</mi>${br('<mi>n</mi>')}<mo>=</mo>${sumk}${xk}${IT}<mi>cos</mi><mo>&#x2061;</mo>${arg}${sp}<mi>Q</mi>${br('<mi>n</mi>')}<mo>=</mo>${sumk}${xk}${IT}<mi>sin</mi><mo>&#x2061;</mo>${arg}</math>`,
    `<math display="block"><mi>A</mi>${br('<mi>n</mi>')}<mo>=</mo>${fr2('<mn>2</mn>', '<mi>N</mi>')}<msqrt>${sq('I')}<mo>+</mo>${sq('Q')}</msqrt>${sp}<mi>N</mi><mo>=</mo><mi>round</mi><mo>&#x2061;</mo><mrow><mo>(</mo><mi>p</mi>${IT}${fr2(fs, f0)}<mo>)</mo></mrow>${sp}<mi>p</mi><mo>=</mo><mrow><mo>&#x2308;</mo>${f0}${MDOT}<mn>5</mn>${msec}<mo>&#x2309;</mo></mrow></math>`,
    `<math display="block">${f0}<mo>=</mo><mrow><mo>(</mo><mover><mi>k</mi><mo>^</mo></mover><mo>+</mo><mi>δ</mi><mo>)</mo></mrow>${IT}${fr2(fs, sub('N', 'F'))}${sp}<mi>δ</mi><mo>=</mo>${fr2('<mn>1</mn>', '<mn>2</mn>')}${IT}${fr2('<mi>α</mi><mo>&#x2212;</mo><mi>γ</mi>', '<mi>α</mi><mo>&#x2212;</mo><mn>2</mn><mi>β</mi><mo>+</mo><mi>γ</mi>')}</math>`,
  ].join(''),
  /** しきい値と符号 */
  code: [
    `<math display="block"><mi>θ</mi><mo>=</mo>${fr2(`${AH}<mo>+</mo>${AL}`, '<mn>2</mn>')}${sp}${AH}<mo>=</mo>${sb('P', 90)}<mo>&#x2061;</mo><mo stretchy="false">(</mo><mi>A</mi><mo stretchy="false">)</mo>${sp}${AL}<mo>=</mo>${sb('P', 10)}<mo>&#x2061;</mo><mo stretchy="false">(</mo><mi>A</mi><mo stretchy="false">)</mo>${sp}${AL}<mo>=</mo><mn>0.1</mn>${IT}${AH}</math>`,
    `<math display="block"><mi>code</mi><mo>&#x2061;</mo><mo stretchy="false">(</mo><mi>τ</mi><mo stretchy="false">)</mo><mo>=</mo><mrow><mo>{</mo><mtable columnalign="left left">` +
      row('マーカ（M・P0〜P5）', rng('0.1', '0.35')) +
      row('ビット 1', rng('0.35', '0.65')) +
      row('ビット 0', rng('0.65', '0.95')) +
      `<mtr><mtd><mtext>読めない</mtext></mtd><mtd><mtext>それ以外</mtext></mtd></mtr></mtable></mrow></math>`,
  ].join(''),
  /** 分への同期 */
  sync: [
    `<math display="block">${sb('t', 's')}<mo>=</mo>${sb('t', 0)}<mo>+</mo><mi>s</mi>${MDOT}<mn>1</mn>${sec}${sp}<mo>|</mo>${sb('r', 's')}<mo>&#x2212;</mo>${sb('t', 's')}<mo>|</mo><mo>&#x2264;</mo><mn>60</mn>${msec}${sp}${sb('t', 0)}<mo>&#x2190;</mo>${sb('t', 0)}<mo>+</mo>${fr2('<mn>1</mn>', '<mn>10</mn>')}${IT}<mrow><mo>(</mo>${sb('r', 's')}<mo>&#x2212;</mo>${sb('t', 's')}<mo>)</mo></mrow></math>`,
  ].join(''),
  /** 時刻と時計のずれ */
  time: [
    `<math display="block"><mi>m</mi><mo>=</mo>${wsum(FIELDS.m)}</math>`,
    `<math display="block"><mi>h</mi><mo>=</mo>${wsum(FIELDS.h)}</math>`,
    `<math display="block"><mi>d</mi><mo>=</mo>${wsum(FIELDS.d)}</math>`,
    `<math display="block"><mi>y</mi><mo>=</mo>${wsum(FIELDS.y)}${sp}<mi>w</mi><mo>=</mo>${wsum(FIELDS.w)}</math>`,
    `<math display="block">${pa(1)}<mo>=</mo>${xsum(PA1)}</math>`,
    `<math display="block">${pa(2)}<mo>=</mo>${xsum(PA2)}</math>`,
    `<math display="block"><mi>Δ</mi><mo>=</mo>${sub('t', 'JJY')}<mo>&#x2212;</mo>${sub('t', '端末')}</math>`,
  ].join(''),
};
export const EQS = EQG.env + EQG.code + EQG.sync + EQG.time;

/** この分の符号を代入した式（分・時・通算日・パリティ）。読めない・未受信のビットは「?」 */
export function substHtml(c: readonly (Sym | null)[], r: Res): string {
  const v = c.map((k) => (k === '1' ? 1 : k === '0' ? 0 : null));
  const x = (L: readonly number[]) => (L.every((n) => v[n] != null) ? L.reduce((s, n) => s ^ (v[n] ?? 0), 0) : null);
  const res = (q: number | null | undefined) =>
    q != null && q >= 0 ? `<mn>${q}</mn>` : '<mi mathvariant="normal">?</mi>';
  return (
    `<math display="block"><mi>m</mi><mo>=</mo>${wsum(FIELDS.m, v)}<mo>=</mo>${res(r.m)}</math>` +
    `<math display="block"><mi>h</mi><mo>=</mo>${wsum(FIELDS.h, v)}<mo>=</mo>${res(r.h)}</math>` +
    `<math display="block"><mi>d</mi><mo>=</mo>${wsum(FIELDS.d, v)}<mo>=</mo>${res(r.d)}</math>` +
    `<math display="block">${pa(1)}<mo>=</mo>${xsum(PA1, v)}<mo>=</mo>${res(x(PA1))}${sp}${pa(2)}<mo>=</mo>${xsum(PA2, v)}<mo>=</mo>${res(x(PA2))}</math>`
  );
}
