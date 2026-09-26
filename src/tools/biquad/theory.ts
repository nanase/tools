/** 動作原理と式の固定部分（ビルド時だけ使い、ブラウザへは送らない） */
import type { FilterType } from './filter';
import {
  AA,
  al,
  aS,
  blk,
  brk,
  bS,
  cosw,
  EQ,
  FN,
  fcS,
  frac,
  fsS,
  inl,
  MI,
  mi,
  mn,
  mo,
  one,
  PL,
  par,
  row,
  SLASH,
  sinw,
  sq,
  sqrt,
  sub,
  sup,
  two,
  w0,
  zi,
} from './math';

/* ---------- 動作原理 ---------- */
export const THEORY_P =
  `双2次フィルタは、入力 ${inl(sq('x'))} の今と 2 サンプル前までの値、出力 ${inl(sq('y'))} の 2 サンプル前までの値に係数を掛けて足し、次の出力を求める 2 次の IIR フィルタです。` +
  `伝達関数 ${inl(mi('H') + par(mi('z')))} の分子と分母がどちらも ${inl(zi(1))} の 2 次式なので、この名で呼ばれます。` +
  `係数は Audio EQ Cookbook の式で、種類ごとに ${inl(fcS)}・${inl(mi('Q'))}・${inl(mi('G'))}・${inl(fsS)} から求めます。` +
  `周波数特性は、長さ ${inl(mi('N'))} のインパルス応答 ${inl(sq('h'))} を FFT して求めます。周波数の刻みは ${inl(row(fsS, SLASH, mi('N')))} なので、${inl(mi('Q'))} が大きく応答が長く続くときは、${inl(mi('N'))} を大きくしないとピークを取りこぼします。`;

/** 差分方程式 */
export const EQ_DIFF = blk(
  row(
    sq('y'),
    EQ,
    bS(0),
    sq('x'),
    PL,
    bS(1),
    sq('x', 1),
    PL,
    bS(2),
    sq('x', 2),
    MI,
    aS(1),
    sq('y', 1),
    MI,
    aS(2),
    sq('y', 2),
  ),
);
/** ω0 と α */
export const EQ_COM = blk(w0 + EQ + frac(row(two, mi('π'), fcS), fsS)) + blk(al + EQ + frac(sinw, row(two, mi('Q'))));
/** A（増幅量を使う種類だけ出す） */
export const eqA = (attrs = ''): string => blk(AA + EQ + sup(mn(10), row(mi('G'), SLASH, mn(40))), attrs);
/** FFT による振幅 */
export const EQ_FFT = blk(
  row(
    mi('A'),
    par(sub(mi('f'), mi('k'))),
    EQ,
    mn(20),
    sub('<mi>log</mi>', mn(10)),
    FN,
    row(
      '<mo>|</mo>',
      `<munderover><mo>&#x2211;</mo>${row(mi('n'), EQ, mn(0))}${row(mi('N'), MI, one)}</munderover>`,
      sq('h'),
      sup(mi('e'), row(MI, mi('j'), frac(row(two, mi('π'), mi('k'), mi('n')), mi('N')))),
      '<mo>|</mo>',
    ),
    mo(','),
    '<mspace width="1em"/>',
    sub(mi('f'), mi('k')),
    EQ,
    frac(row(mi('k'), fsS), mi('N')),
  ),
);

/* ---------- 種類ごとの係数（Cookbook） ---------- */
const m2c = row(MI, two, cosw),
  Ap = par(row(AA, PL, one)),
  Am = par(row(AA, MI, one)),
  sa = row(two, sqrt(AA), al);
const AC3: [string, string][] = [
  [aS(0), row(one, PL, al)],
  [aS(1), m2c],
  [aS(2), row(one, MI, al)],
];
const b02 = bS(0) + EQ + bS(2);
const FORM: Record<FilterType, [string, string][]> = {
  lowpass: [[b02, frac(row(one, MI, cosw), two)], [bS(1), row(one, MI, cosw)], ...AC3],
  highpass: [[b02, frac(row(one, PL, cosw), two)], [bS(1), row(MI, par(row(one, PL, cosw)))], ...AC3],
  bandpass: [[bS(0), al], [bS(1), mn(0)], [bS(2), row(MI, al)], ...AC3],
  bandstop: [[b02, one], [bS(1), m2c], ...AC3],
  lowshelf: [
    [bS(0), row(AA, brk(row(Ap, MI, Am, cosw, PL, sa)))],
    [bS(1), row(two, AA, brk(row(Am, MI, Ap, cosw)))],
    [bS(2), row(AA, brk(row(Ap, MI, Am, cosw, MI, sa)))],
    [aS(0), row(Ap, PL, Am, cosw, PL, sa)],
    [aS(1), row(MI, two, brk(row(Am, PL, Ap, cosw)))],
    [aS(2), row(Ap, PL, Am, cosw, MI, sa)],
  ],
  highshelf: [
    [bS(0), row(AA, brk(row(Ap, PL, Am, cosw, PL, sa)))],
    [bS(1), row(MI, two, AA, brk(row(Am, PL, Ap, cosw)))],
    [bS(2), row(AA, brk(row(Ap, PL, Am, cosw, MI, sa)))],
    [aS(0), row(Ap, MI, Am, cosw, PL, sa)],
    [aS(1), row(two, brk(row(Am, MI, Ap, cosw)))],
    [aS(2), row(Ap, MI, Am, cosw, MI, sa)],
  ],
  peaking: [
    [bS(0), row(one, PL, al, AA)],
    [bS(1), m2c],
    [bS(2), row(one, MI, al, AA)],
    [aS(0), row(one, PL, frac(al, AA))],
    [aS(1), m2c],
    [aS(2), row(one, MI, frac(al, AA))],
  ],
  allpass: [[bS(0), row(one, MI, al)], [bS(1), m2c], [bS(2), row(one, PL, al)], ...AC3],
};

/** 種類ごとの係数の式（block の math を並べたもの） */
export const formHtml = (t: FilterType): string => FORM[t].map(([l, r]) => blk(l + EQ + r)).join('');
