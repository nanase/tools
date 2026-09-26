/** 動作原理と式の MathML。一般の式（EQS）はビルド時に、この分の符号を代入した式は画面で作る */
import { type Code, decode, FIELDS, type Field, PA1, PA2 } from './code';

const MDOT = '<mo>&#x22C5;</mo>',
  XOR = '<mo>&#x2295;</mo>';
const bN = (n: number) => `<msub><mi>b</mi><mn>${n}</mn></msub>`;
const sec = '<mspace width="0.17em"/><mi mathvariant="normal">s</mi>';
const sub = (a: string, b: string) => `<msub><mi>${a}</mi><mi mathvariant="normal">${b}</mi></msub>`;
const pa = (n: number) => `<msub><mi>PA</mi><mn>${n}</mn></msub>`;

/** 重みつきの和。v を渡すと各ビットに値を代入する */
function wsum(f: Field, v?: readonly number[]): string {
  return f
    .map(([w, n], i) => {
      const op = i ? '<mo>+</mo>' : '';
      if (v) return `${op}${w === 1 ? '' : `<mn>${w}</mn>${MDOT}`}<mn>${v[n]}</mn>`;
      return `${op}${w === 1 ? '' : `<mn>${w}</mn><mo>&#x2062;</mo>`}${bN(n)}`;
    })
    .join('');
}
/** 排他的論理和 */
const xsum = (L: readonly number[], v?: readonly number[]) =>
  L.map((n, i) => (i ? XOR : '') + (v ? `<mn>${v[n]}</mn>` : bN(n))).join('');

export const EQS = [
  `<math display="block"><mi>τ</mi><mo>=</mo><mrow><mo>{</mo><mtable columnalign="left left">` +
    `<mtr><mtd><mn>0.2</mn>${sec}</mtd><mtd><mtext>マーカ（M・P0〜P5）</mtext></mtd></mtr>` +
    `<mtr><mtd><mn>0.5</mn>${sec}</mtd><mtd><mtext>ビット 1</mtext></mtd></mtr>` +
    `<mtr><mtd><mn>0.8</mn>${sec}</mtd><mtd><mtext>ビット 0</mtext></mtd></mtr></mtable></mrow></math>`,
  `<math display="block">${sub('A', 'L')}<mo>=</mo><mn>0.1</mn><mo>&#x2062;</mo>${sub('A', 'H')}</math>`,
  `<math display="block"><mi>m</mi><mo>=</mo>${wsum(FIELDS.m)}</math>`,
  `<math display="block"><mi>h</mi><mo>=</mo>${wsum(FIELDS.h)}</math>`,
  `<math display="block"><mi>d</mi><mo>=</mo>${wsum(FIELDS.d)}</math>`,
  `<math display="block"><mi>y</mi><mo>=</mo>${wsum(FIELDS.y)}<mo>,</mo><mspace width="1em"/><mi>w</mi><mo>=</mo>${wsum(FIELDS.w)}</math>`,
  `<math display="block">${pa(1)}<mo>=</mo>${xsum(PA1)}</math>`,
  `<math display="block">${pa(2)}<mo>=</mo>${xsum(PA2)}</math>`,
].join('');

/** この分の符号を代入した式（分・時・通算日・パリティ） */
export function substHtml(codes: readonly Code[]): string {
  const v = codes.map((k) => (k === '1' ? 1 : 0)),
    r = decode(codes);
  const x = (L: readonly number[]) => L.reduce((s, n) => s ^ v[n], 0);
  return (
    `<math display="block"><mi>m</mi><mo>=</mo>${wsum(FIELDS.m, v)}<mo>=</mo><mn>${r.m}</mn></math>` +
    `<math display="block"><mi>h</mi><mo>=</mo>${wsum(FIELDS.h, v)}<mo>=</mo><mn>${r.h}</mn></math>` +
    `<math display="block"><mi>d</mi><mo>=</mo>${wsum(FIELDS.d, v)}<mo>=</mo><mn>${r.d}</mn></math>` +
    `<math display="block">${pa(1)}<mo>=</mo>${xsum(PA1, v)}<mo>=</mo><mn>${x(PA1)}</mn><mo>,</mo><mspace width="1em"/>${pa(2)}<mo>=</mo>${xsum(PA2, v)}<mo>=</mo><mn>${x(PA2)}</mn></math>`
  );
}
