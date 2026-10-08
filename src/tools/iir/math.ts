/** 動作原理と式のうち、今の値を代入した式（ブラウザで書き換える） */
import { parts } from '../../lib/format';
import { APPROX, blk, DOT, EQ, FN, frac, mi, mn, mo, par, row, sub, two } from '../biquad/math';
import { epsOf } from './analog';
import { type Design, isBand } from './design';
import { sig } from './plot';

/** 量（数値 + 単位）。計算した値は keep で末尾の 0 を残す */
const qty = (v: number, u: string, s = 4, keep = false) => {
  const [n, x] = parts(v, u, s, keep);
  return `<mrow><mn>${n}</mn><mspace width="0.17em"/><mi mathvariant="normal">${x}</mi></mrow>`;
};
const numR = (v: number, s = 5) => `<mn>${sig(v, s, true)}</mn>`;

/** 基準の端のプリワーピング、ε と選択度、最小の次数を代入した式 */
export function substHtml(D: Design, sym: (k: 'f1' | 'f2') => [string, string]): string {
  const s = D.spec,
    fsQ = qty(s.fs, 'Hz');
  let h = '';
  for (const k of isBand(s.resp) ? (['f1', 'f2'] as const) : (['f1'] as const)) {
    const f = s[k],
      [o, fs] = sym(k),
      w = 2 * s.fs * Math.tan((Math.PI * f) / s.fs);
    h += blk(
      row(
        o,
        EQ,
        two,
        DOT,
        fsQ,
        DOT,
        row('<mi>tan</mi>', FN, par(frac(row(mi('π'), DOT, qty(f, 'Hz')), fsQ))),
        APPROX,
        qty(w, 'rad/s', 5, true),
        '<mspace width="0.6em"/>',
        '<mo stretchy="false">(</mo>',
        row(two, mi('π'), fs),
        EQ,
        qty(2 * Math.PI * f, 'rad/s', 5, true),
        '<mo stretchy="false">)</mo>',
      ),
    );
  }
  if (s.mode === 'spec' && D.sel) {
    const ep = epsOf(s.ap),
      es = epsOf(s.as);
    h += blk(
      row(
        sub(mi('ε'), mi('p')),
        APPROX,
        numR(ep),
        mo(','),
        '<mspace width="1em"/>',
        sub(mi('ε'), mi('s')),
        APPROX,
        numR(es),
        mo(','),
        '<mspace width="1em"/>',
        sub(mi('Ω'), mi('s')),
        APPROX,
        numR(D.sel),
      ),
    );
    if (D.exact != null) h += blk(row(mi('N'), mo('&#x2265;'), numR(D.exact), mo('&#x2192;'), mi('N'), EQ, mn(D.N)));
  }
  return h;
}

/** 直接形の伝達関数 */
export function baMath(n: number): string {
  const t = (c: string, k: number) =>
    k === 0 ? sub(mi(c), mn(0)) : row(sub(mi(c), mn(k)), `<msup><mi>z</mi><mrow><mo>−</mo><mn>${k}</mn></mrow></msup>`);
  const num = row(t('b', 0), mo('+'), t('b', 1), mo('+'), mo('⋯'), mo('+'), t('b', n)),
    den = row(mn(1), mo('+'), t('a', 1), mo('+'), mo('⋯'), mo('+'), t('a', n));
  return blk(row(mi('H'), par(mi('z')), EQ, frac(num, den)));
}
