/**
 * 数式（MathML）の部品と、ブラウザで書き換える式（係数の伝達関数、代入した式）。
 * 動作原理と式の固定部分は theory.ts（ビルド時だけ使う）
 */
import { parts } from '../../lib/format';
import { sig } from './plot';

/* ---------- 部品 ---------- */
export const mi = (x: string, up = false) => `<mi${up ? ' mathvariant="normal"' : ''}>${x}</mi>`;
export const mn = (x: string | number) => `<mn>${x}</mn>`;
export const mo = (x: string) => `<mo>${x}</mo>`;
export const sub = (b: string, x: string) => `<msub>${b}${x}</msub>`;
export const sup = (b: string, x: string) => `<msup>${b}${x}</msup>`;
export const frac = (a: string, b: string) => `<mfrac>${a}${b}</mfrac>`;
export const row = (...a: string[]) => `<mrow>${a.join('')}</mrow>`;
export const par = (x: string) => `<mrow><mo>(</mo>${x}<mo>)</mo></mrow>`;
export const brk = (x: string) => `<mrow><mo>[</mo>${x}<mo>]</mo></mrow>`;
export const sqrt = (x: string) => `<msqrt>${x}</msqrt>`;
/** attrs は math 要素に足す属性（' hidden' など） */
export const blk = (x: string, attrs = ''): string => `<math display="block"${attrs}>${x}</math>`;
export const inl = (x: string): string => `<math>${x}</math>`;

export const EQ = mo('='),
  MI = mo('−'),
  PL = mo('+'),
  DOT = '<mo>&#x22C5;</mo>',
  APPROX = '<mo>&#x2248;</mo>',
  SLASH = '<mo lspace="0" rspace="0">/</mo>',
  FN = '<mo>&#x2061;</mo>';
export const bS = (k: number) => sub(mi('b'), mn(k)),
  aS = (k: number) => sub(mi('a'), mn(k));
export const zi = (k: number) => sup(mi('z'), row(MI, mn(k)));
/** x[n]・x[n − k] */
export const sq = (v: string, k = 0) =>
  row(mi(v), '<mo stretchy="false">[</mo>', mi('n'), k ? MI + mn(k) : '', '<mo stretchy="false">]</mo>');
export const fcS = sub(mi('f'), mi('c')),
  fsS = sub(mi('f'), mi('s')),
  w0 = sub(mi('ω'), mn(0));
export const one = mn(1),
  two = mn(2),
  al = mi('α'),
  AA = mi('A');
export const cosw = row('<mi>cos</mi>', FN, w0),
  sinw = row('<mi>sin</mi>', FN, w0);

/** 伝達関数 H(z)。normalized なら分母の a0 を 1 にする */
export function hzMath(normalized: boolean): string {
  const num = row(bS(0), PL, bS(1), zi(1), PL, bS(2), zi(2));
  const den = row(normalized ? one : aS(0), PL, aS(1), zi(1), PL, aS(2), zi(2));
  return blk(mi('H') + par(mi('z')) + EQ + frac(num, den));
}

/* ---------- 代入した式 ---------- */
const qty = (v: number, u: string) => {
  const [n, x] = parts(v, u, 4);
  return `<mrow><mn>${n}</mn><mspace width="0.17em"/><mi mathvariant="normal">${x}</mi></mrow>`;
};
const num = (v: number) => `<mn>${sig(v, 4)}</mn>`;

/** 今の値を ω0・α（と A）に代入した式 */
export function substHtml(fs: number, fc: number, q: number, g: number, gain: boolean): string {
  const w = (2 * Math.PI * fc) / fs,
    a = Math.sin(w) / (2 * q);
  let h = blk(
    `${w0 + EQ + frac(row(two, mi('π'), DOT, qty(fc, 'Hz')), qty(fs, 'Hz')) + APPROX + num(w)}<mspace width="0.17em"/><mi mathvariant="normal">rad</mi>`,
  );
  h += blk(al + EQ + frac(row('<mi>sin</mi>', FN, num(w)), row(two, DOT, num(q))) + APPROX + num(a));
  if (gain) h += blk(AA + EQ + sup(mn(10), row(num(g), SLASH, mn(40))) + APPROX + num(10 ** (g / 40)));
  return h;
}
