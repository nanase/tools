/**
 * 数式（MathML）: 部品と、ブラウザで書き換える式（距離と角度の式、係数の伝達関数）。
 * 動作原理と式の固定部分は theory.ts（ビルド時だけ使う）
 */
import { minus } from '../../lib/format';
import { blk, EQ, frac, MI, mi, mn, mo, PL, par, row, sub, sup, zi } from '../biquad/math';

export { blk, DOT, EQ, FN, frac, inl, MI, mi, mn, mo, PL, par, row, SLASH, sub, sup, zi } from '../biquad/math';

export const APPROX = '<mo>&#x2248;</mo>',
  TIMES = '<mo>&#x00D7;</mo>',
  EQUIV = '<mo>&#x2261;</mo>',
  ABS = (x: string) => row('<mo>|</mo>', x, '<mo>|</mo>'),
  ANG = '<mo>&#x2220;</mo>',
  DEGS = '<mo lspace="0">°</mo>';
export const ejw = sup(mi('e'), row(mi('j'), mi('ω')));
export const Hz_ = row(mi('H'), par(mi('z')));
export const Hw = row(mi('H'), par(ejw));
export const sum = (i: string, a: string, b: string) =>
  `<munderover><mo>&#x2211;</mo>${row(mi(i), EQ, a)}${b}</munderover>`;
export const prod = (i: string, a: string, b: string) =>
  `<munderover><mo>&#x220F;</mo>${row(mi(i), EQ, a)}${b}</munderover>`;
/** 下付きだけの ∏・Σ（∏_z など） */
export const prodU = (x: string) => `<munder><mo>&#x220F;</mo>${x}</munder>`;
export const sumU = (x: string) => `<munder><mo>&#x2211;</mo>${x}</munder>`;
export const dS = (k: string) => sub(mi('d'), mi(k)),
  phS = (k: string) => sub(mi('φ'), mi(k));

/**
 * 計算した値の <mn>。有効数字 s 桁で末尾の 0 を残す。1e-4 未満と 1e6 以上は 10 の累乗で書く
 */
export function mnum(v: number, s = 4): string {
  if (Number.isNaN(v)) return mo('—');
  if (!Number.isFinite(v)) return row(v < 0 ? MI : '', mi('∞', true));
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-4 || a >= 1e6)) {
    const [m, e] = v.toExponential(s - 1).split('e');
    return row(mn(minus(m)), TIMES, sup(mn('10'), mn(minus(String(Number(e))))));
  }
  return mn(minus(v.toPrecision(s).includes('e') ? String(Number(v.toPrecision(s))) : v.toPrecision(s)));
}

/** 角度 [°]（小数 2 桁） */
export const mdeg = (v: number): string => row(mn(minus(v.toFixed(2).replace(/^-0\.00$/, '0.00'))), DEGS);

export interface GeoSum {
  k: number;
  /** 零点・極までの距離の積 */
  pz: number;
  pp: number;
  /** 零点・極の角度の和 [°] */
  sz: number;
  sp: number;
}

/**
 * 距離と角度の式: |H| = k ∏d_z / ∏d_p と、その代入 ≈ 値（dB）。∠H = Σφ_z − Σφ_p と、その代入 = 値（折り返し）。
 * 狭い画面でも収まるよう、代入した式は次の行（class="cont"）に分ける
 */
export function geoMath(g: GeoSum): string {
  const mag = g.k * (g.pz / g.pp),
    db = 20 * Math.log10(mag),
    ph = g.sz - g.sp,
    w = ph - 360 * Math.round(ph / 360),
    wr = w <= -180 ? w + 360 : w,
    cont = ' class="cont"';
  const dbS = Number.isFinite(db) ? minus(db.toFixed(2)) : db < 0 ? '−∞' : '∞';
  return (
    blk(row(ABS(Hw), EQ, mi('k'), frac(row(prodU(mi('z')), dS('z')), row(prodU(mi('p')), dS('p'))))) +
    blk(
      row(
        EQ,
        mnum(g.k),
        TIMES,
        frac(mnum(g.pz), mnum(g.pp)),
        APPROX,
        mnum(mag),
        par(row(mn(dbS), '<mspace width="0.17em"/>', mi('dB', true))),
      ),
      cont,
    ) +
    blk(row(ANG, Hw, EQ, row(sumU(mi('z')), phS('z')), MI, row(sumU(mi('p')), phS('p')))) +
    blk(
      row(
        EQ,
        mdeg(g.sz),
        MI,
        g.sp < 0 ? par(mdeg(g.sp)) : mdeg(g.sp),
        EQ,
        mdeg(ph),
        Math.abs(wr - ph) > 1e-9 ? EQUIV + mdeg(wr) : '',
      ),
      cont,
    )
  );
}

/** 伝達関数の形（直接形）。M・N は分子・分母の次数 */
export function tfMath(M: number, N: number): string {
  const terms = (c: string, n: number, first: string) => {
    const t = [first];
    for (let i = 1; i <= n; i++) {
      if (n > 3 && i === 2) {
        t.push(PL, mo('⋯'));
        i = n - 1;
        continue;
      }
      t.push(PL, row(sub(mi(c), mn(i)), zi(i)));
    }
    return row(...t);
  };
  return blk(row(Hz_, EQ, frac(terms('b', M, sub(mi('b'), mn(0))), terms('a', N, mn(1)))));
}

/** 双2次の縦続の形。S は段の数 */
export function sosMath(S: number): string {
  const b = (j: number) => sub(mi('b'), row(mn(j), mi('i'))),
    a = (j: number) => sub(mi('a'), row(mn(j), mi('i')));
  return blk(
    row(
      Hz_,
      EQ,
      prod('i', mn(1), mn(S)),
      frac(row(b(0), PL, b(1), zi(1), PL, b(2), zi(2)), row(mn(1), PL, a(1), zi(1), PL, a(2), zi(2))),
    ),
  );
}
