/** 動作原理と式のうち、今の値を代入した式（ブラウザで書き換える） */
import { mqty } from '../../lib/format';
import { APPROX, blk, DOT, EQ, frac, MI, mi, mn, mo, PL, par, row, SLASH, sub, sup } from '../biquad/math';
import { sig } from '../biquad/plot';
import { ellipKc, type IirOrder } from './analysis';
import { type Design, remezTaps, type Spec, windowTaps } from './design';
import { dpOf, dsOf, twoEdges } from './spec';
import { kaiserBeta, kaiserOrder, WIN_K } from './window';

/** 入力の値 */
const num = (v: number) => mn(sig(v, 4));
/** 計算した値（末尾の 0 を残す） */
const numR = (v: number) => mn(sig(v, 4, true));
const N = mi('N'),
  one = mn(1),
  Nm1 = row(N, MI, one),
  dp = sub(mi('δ'), mi('p')),
  ds = sub(mi('δ'), mi('s')),
  dW = row(mi('Δ'), mi('ω')),
  log10 = (x: string) => row(sub('<mi>log</mi>', mn(10)), '<mo>&#x2061;</mo>', x);
const qty = (v: number) => `<mrow>${mqty(v, 'Hz')}</mrow>`;

/** 今の値を代入した式 */
export function substHtml(s: Spec, d: Design): string {
  const p = dpOf(s.ap),
    q = dsOf(s.as),
    dw = (2 * Math.PI * s.df) / s.fs,
    g = sup(mn(10), row(num(s.ap), SLASH, mn(20)));
  let h = blk(
    row(
      dp,
      EQ,
      frac(row(g, MI, one), row(g, PL, one)),
      APPROX,
      numR(p),
      mo(','),
      '<mspace width="1em"/>',
      ds,
      EQ,
      sup(mn(10), row(MI, num(s.as), SLASH, mn(20))),
      APPROX,
      numR(q),
    ),
  );
  h += blk(
    row(
      dW,
      EQ,
      frac(row(mn(2), mi('π'), DOT, qty(s.df)), qty(s.fs)),
      APPROX,
      numR(dw),
      '<mspace width="0.17em"/>',
      mi('rad', true),
    ),
  );
  if (!s.auto) return h + blk(row(N, EQ, mn(d.N), '<mspace width="1em"/>', '<mtext>（指定）</mtext>'));
  if (s.method === 'window') {
    if (s.win === 'kaiser') {
      const A = -20 * Math.log10(Math.min(p, q));
      h += blk(
        row(
          mi('A'),
          EQ,
          numR(A),
          '<mspace width="0.17em"/>',
          mi('dB', true),
          mo(','),
          '<mspace width="1em"/>',
          mi('β'),
          APPROX,
          numR(kaiserBeta(A)),
        ),
      );
      h += blk(
        row(
          Nm1,
          EQ,
          frac(row(numR(A), MI, mn(8)), row(mn(2.285), DOT, numR(dw))),
          APPROX,
          numR(kaiserOrder(A, dw)),
          mo('→'),
          N,
          EQ,
          mn(windowTaps(s)),
        ),
      );
    } else {
      const k = WIN_K[s.win].k;
      h += blk(
        row(
          N,
          mo('≥'),
          frac(row(mn(k), DOT, qty(s.fs)), qty(s.df)),
          APPROX,
          numR((k * s.fs) / s.df),
          mo('→'),
          N,
          EQ,
          mn(windowTaps(s)),
        ),
      );
    }
  } else {
    const est = (-10 * Math.log10(p * q) - 13) / (2.324 * dw);
    h += blk(
      row(
        Nm1,
        APPROX,
        frac(row(MI, mn(10), log10(par(row(numR(p), DOT, numR(q)))), MI, mn(13)), row(mn(2.324), DOT, numR(dw))),
        APPROX,
        numR(est),
        mo('→'),
        N,
        EQ,
        mn(remezTaps(s)),
      ),
    );
    const r = s.method === 'remez' ? frac(dp, ds) : sup(par(frac(dp, ds)), mn(2));
    h += blk(
      row(
        frac(sub(mi('W'), mi('s')), sub(mi('W'), mi('p'))),
        EQ,
        r,
        APPROX,
        numR(d.ws),
        mo(','),
        '<mspace width="1em"/>',
        '<mtext>仕様を満たす最小の </mtext>',
        N,
        EQ,
        mn(d.N),
      ),
    );
  }
  return h;
}

/** 同じ仕様の IIR フィルタの次数を代入した式（BPF・BSF は低域の原型の次数を 2 倍する） */
export function iirSubst({ k, k1 }: IirOrder, t: Spec['t']): string {
  const ne = (ellipKc(Math.sqrt(1 - k * k)) * ellipKc(k1)) / (ellipKc(k) * ellipKc(Math.sqrt(1 - k1 * k1))),
    nb = Math.log(1 / k1) / Math.log(1 / k),
    x2 = twoEdges(t) ? row(mo('×'), mn(2)) : '';
  return blk(
    row(
      mi('k'),
      APPROX,
      numR(k),
      mo(','),
      '<mspace width="0.6em"/>',
      sub(mi('k'), one),
      APPROX,
      numR(k1),
      mo(','),
      '<mspace width="0.6em"/>',
      sub(mi('n'), '<mtext>楕円</mtext>'),
      mo('≥'),
      numR(ne),
      x2,
      mo(','),
      '<mspace width="0.6em"/>',
      sub(mi('n'), '<mtext>バタワース</mtext>'),
      mo('≥'),
      numR(nb),
      x2,
    ),
  );
}
