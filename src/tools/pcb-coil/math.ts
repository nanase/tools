/** MathML の組み立て（動作原理と式の固定部分と、現在の値を代入した式） */
import { parts } from '../../lib/format';
import type { Coil, Shape } from './coil';
import { partsF, sig } from './params';

export const mi = (x: string, up?: boolean): string => `<mi${up ? ' mathvariant="normal"' : ''}>${x}</mi>`;
export const mn = (x: string): string => `<mn>${x}</mn>`;
export const mo = (x: string): string => `<mo>${x}</mo>`;
export const sub = (b: string, x: string): string => `<msub>${b}${x}</msub>`;
export const sup = (b: string, x: string): string => `<msup>${b}${x}</msup>`;
export const frac = (a: string, b: string): string => `<mfrac>${a}${b}</mfrac>`;
export const row = (...a: string[]): string => `<mrow>${a.join('')}</mrow>`;
export const par = (x: string): string => `<mrow><mo>(</mo>${x}<mo>)</mo></mrow>`;
export const sqrt = (x: string): string => `<msqrt>${x}</msqrt>`;
export const blk = (x: string): string => `<math display="block">${x}</math>`;
export const inl = (x: string): string => `<math>${x}</math>`;

export const EQ = mo('='),
  MI = mo('−'),
  PL = mo('+'),
  DOT = '<mo>&#x22C5;</mo>',
  AP = '<mo>&#x2248;</mo>',
  CM = '<mo>,</mo><mspace width="1em"/>',
  SLASH = '<mo lspace="0" rspace="0">/</mo>';
export const two = mn('2'),
  one = mn('1'),
  pi = mi('π');
export const dO = sub(mi('d'), mi('out')),
  dI = sub(mi('d'), mi('in')),
  dA = sub(mi('d'), mi('avg'));
export const n_ = mi('n'),
  w_ = mi('w'),
  s_ = mi('s'),
  t_ = mi('t'),
  f_ = mi('f'),
  L_ = mi('L'),
  rho = mi('ρ'),
  dl = mi('δ'),
  ell = mi('ℓ');
export const mu0 = sub(mi('μ'), mn('0')),
  rCu = sub(mi('ρ'), mi('Cu', true));
export const Ls = (x: string): string => sub(L_, mi(x));
export const cS = (k: number): string => sub(mi('c'), mn(String(k)));
export const KS = (k: number): string => sub(mi('K'), mn(String(k)));
export const aS = (k: number): string => sub(mi('α'), mn(String(k)));
export const Rdc = sub(mi('R'), mi('DC', true)),
  Rac = sub(mi('R'), mi('AC', true)),
  tef = sub(t_, mi('eff'));
export const ln = (x: string): string => row('<mi>ln</mi><mo>&#x2061;</mo>', par(x));
export const sq = (x: string): string => sup(x, two);

/* ---------- 現在の値を代入した式 ---------- */
const num = (v: number, s = 4): string => `<mn>${sig(v, s)}</mn>`;
const qty = (v: number, u: string, s = 4): string => {
  const [n, x] = u === 'F' ? partsF(v, s) : parts(v, u, s);
  return `<mrow><mn>${n}</mn><mspace width="0.17em"/><mi mathvariant="normal">${x}</mi></mrow>`;
};
const mm = (v: number, s = 4): string =>
  `<mrow>${num(v, s)}<mspace width="0.17em"/><mi mathvariant="normal">mm</mi></mrow>`;

/** 代入した式（#subst の中身）。w・s は画面の値 [mm] */
export function substHtml(g: Coil, sh: Shape, w: number, s: number): string {
  const [c1, c2, c3, c4] = sh.c,
    dO_ = g.d * 1e3,
    dI_ = g.din * 1e3,
    dA_ = g.davg * 1e3,
    r3 = num(g.rho, 3);
  let h = blk(
    row(dI, EQ, mm(dO_), MI, two, DOT, num(g.n), DOT, mm(w), MI, two, DOT, num(g.n - 1), DOT, mm(s), EQ, mm(dI_)),
  );
  h += blk(row(dA, EQ, mm(dA_), CM, rho, EQ, frac(row(num(dO_), MI, num(dI_)), row(num(dO_), PL, num(dI_))), AP, r3));
  h += blk(
    row(
      cS(1),
      EQ,
      num(c1),
      CM,
      cS(2),
      EQ,
      num(c2),
      CM,
      cS(3),
      EQ,
      num(c3),
      CM,
      cS(4),
      EQ,
      num(c4),
      `<mspace width="1em"/><mtext>（${sh.ab}）</mtext>`,
    ),
  );
  h += blk(
    row(
      Ls('gmd'),
      EQ,
      frac(row(mu0, DOT, sup(num(g.n), two), DOT, mm(dA_), DOT, num(c1)), two),
      par(row(ln(frac(num(c2), r3)), PL, num(c3), DOT, r3, PL, num(c4), DOT, sq(r3))),
      AP,
      qty(g.L, 'H', 4),
    ),
  );
  h += blk(row(dl, AP, qty(g.dl, 'm', 3), CM, tef, AP, qty(g.teff, 'm', 3), CM, Rac, AP, qty(g.rac, 'Ω', 3)));
  h += blk(
    row(
      mi('Q'),
      EQ,
      frac(row(two, pi, DOT, qty(g.f, 'Hz'), DOT, qty(g.L, 'H', 4)), qty(g.rac, 'Ω', 3)),
      AP,
      num(g.q, 3),
      CM,
      mi('C'),
      AP,
      qty(g.c, 'F', 3),
    ),
  );
  return h;
}
