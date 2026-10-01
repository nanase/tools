/** MathML の組み立て（動作原理と式の固定部分と、現在の値を代入した式） */
import { parts } from '../../lib/format';
import type { Coil, Shape } from './coil';
import type { Stacked } from './layers';
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
/* 数・量・長さ。計算した値は末尾の 0 を残す（numR・qtyR・mmR） */
const num = (v: number, s = 4, keep = false): string => `<mn>${sig(v, s, keep)}</mn>`;
const numR = (v: number, s = 4): string => num(v, s, true);
const qty = (v: number, u: string, s = 4, keep = false): string => {
  const [n, x] = u === 'F' ? partsF(v, s, keep) : parts(v, u, s, keep);
  return `<mrow><mn>${n}</mn><mspace width="0.17em"/><mi mathvariant="normal">${x}</mi></mrow>`;
};
const qtyR = (v: number, u: string, s = 4): string => qty(v, u, s, true);
const mm = (v: number, s = 4, keep = false): string =>
  `<mrow>${num(v, s, keep)}<mspace width="0.17em"/><mi mathvariant="normal">mm</mi></mrow>`;
const mmR = (v: number, s = 4): string => mm(v, s, true);

/** 代入した式（#subst の中身）。w・s は画面の値 [mm]。多層なら層の合成と自己共振も出す */
export function substHtml(g: Coil & Partial<Stacked>, sh: Shape, w: number, s: number): string {
  /* 多層では電流シート近似は 1 層ぶんの値 */
  const L1 = g.L1 ?? g.L,
    nl = g.nl ?? 1;
  const [c1, c2, c3, c4] = sh.c,
    dO_ = g.d * 1e3,
    dI_ = g.din * 1e3,
    dA_ = g.davg * 1e3,
    r3 = numR(g.rho, 3);
  let h = blk(
    row(dI, EQ, mm(dO_), MI, two, DOT, num(g.n), DOT, mm(w), MI, two, DOT, num(g.n - 1), DOT, mm(s), EQ, mmR(dI_)),
  );
  h += blk(
    row(dA, EQ, mmR(dA_), CM, rho, EQ, frac(row(num(dO_), MI, numR(dI_)), row(num(dO_), PL, numR(dI_))), AP, r3),
  );
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
      frac(row(mu0, DOT, sup(num(g.n), two), DOT, mmR(dA_), DOT, num(c1)), two),
      par(row(ln(frac(num(c2), r3)), PL, num(c3), DOT, r3, PL, num(c4), DOT, sq(r3))),
      AP,
      qtyR(L1, 'H', 4),
    ),
  );
  if (nl > 1) {
    h += blk(
      row(
        L_,
        EQ,
        Ls('gmd'),
        g.conn === 'par' ? '<mo>×</mo>' : DOT,
        numR(g.L / L1, 4),
        EQ,
        qtyR(L1, 'H', 4),
        '<mo>×</mo>',
        numR(g.L / L1, 4),
        AP,
        qtyR(g.L, 'H', 4),
        `<mspace width="1em"/><mtext>（${nl} 層・${g.conn === 'par' ? '並列' : '直列'}）</mtext>`,
      ),
    );
    if (g.conn === 'ser' && g.cp && g.srf)
      h += blk(
        row(
          sub(mi('C'), mi('p')),
          EQ,
          frac(mn('4'), row(mn('3'), DOT, sq(num(nl)))),
          DOT,
          qtyR(g.cSum ?? 0, 'F', 3),
          AP,
          qtyR(g.cp, 'F', 3),
          CM,
          sub(f_, mi('SRF', true)),
          AP,
          qtyR(g.srf, 'Hz', 3),
        ),
      );
  }
  h += blk(row(dl, AP, qtyR(g.dl, 'm', 3), CM, tef, AP, qtyR(g.teff, 'm', 3), CM, Rac, AP, qtyR(g.rac, 'Ω', 3)));
  h += blk(
    row(
      mi('Q'),
      EQ,
      frac(row(two, pi, DOT, qty(g.f, 'Hz'), DOT, qtyR(g.L, 'H', 4)), qtyR(g.rac, 'Ω', 3)),
      AP,
      numR(g.q, 3),
      CM,
      mi('C'),
      AP,
      qtyR(g.c, 'F', 3),
    ),
  );
  return h;
}
