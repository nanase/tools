/** 動作原理と式の固定部分（ビルド時だけ使い、ブラウザへは送らない） */
import {
  ABS,
  ANG,
  blk,
  EQ,
  ejw,
  FN,
  frac,
  Hw,
  Hz_,
  inl,
  MI,
  mi,
  mn,
  mo,
  PL,
  par,
  prod,
  row,
  SLASH,
  sub,
  sum,
  sup,
  zi,
} from './math';

const zm = sub(mi('z'), mi('m')),
  pn = sub(mi('p'), mi('n')),
  fs = sub(mi('f'), mi('s')),
  w = mi('ω'),
  one = mn(1),
  two = mn(2),
  lt = mo('&lt;'),
  /* 関数名の後ろに細い空き（Chrome は U+2061 で空きを入れない） */
  TH = '<mspace width="0.17em"/>',
  Re = `<mi mathvariant="normal">Re</mi>${TH}`,
  ln = `<mi>ln</mi>${FN}${TH}`,
  cos = `<mi>cos</mi>${FN}${TH}`,
  brk = (x: string) => row('<mo>[</mo>', x, '<mo>]</mo>');
const PM = prod('m', one, mi('M')),
  PN = prod('n', one, mi('N')),
  SM = sum('m', one, mi('M')),
  SN = sum('n', one, mi('N'));

export const THEORY: string[] = [
  `伝達関数 ${inl(Hz_)} の分子が 0 になる ${inl(mi('z'))} を零点 ${inl(zm)}、分母が 0 になる ${inl(mi('z'))} を極 ${inl(pn)} と呼びます。係数が実数なら、実軸の上にない極と零点は複素共役の対で現れます。` +
    `周波数特性は、${inl(mi('z'))} を単位円の上の点 ${inl(ejw)}（${inl(row(w, EQ, two, mi('π'), mi('f'), SLASH, fs))}）に置いた ${inl(Hw)} です。`,
  `${inl(ejw)} から各零点・各極へ引いた線の長さを ${inl(mi('d'))}、実軸の正の向きからの線の角度を ${inl(mi('φ'))} とすると、振幅は零点までの長さの積を極までの長さの積で割ったもの、位相は零点の角度の和から極の角度の和を引いたものです。` +
    `極が単位円に近いと、その角度の近くの周波数で極までの線が短くなり、振幅が大きくなります（共振）。単位円の上の零点は、その周波数を消します。`,
  `因果的なフィルタは ${inl(zi(1))} の多項式で書くので、極と零点の個数が違うときは、少ない側の根を原点に足したのと同じになります。原点の根は振幅を変えず、位相を ${inl(w)} ずつずらします（z 平面に破線で描いたもの）。`,
  `すべての極が単位円の内側にあれば安定です。極 ${inl(mi('p'))} を ${inl(row(mi('s'), EQ, fs, ln, mi('p')))} とアナログの極に移すと、共振の ${inl(mi('Q'))} と減衰の時定数 ${inl(mi('τ'))} が分かります。` +
    `高い次数のフィルタは、極の対と近い零点の対を組んだ双2次の段に分け、縦続につなぐと係数の丸めに強くなります。段は単位円に近い極から順に、いちばん近い零点と組みます。`,
  `試聴では、点を動かしている間も音が途切れないよう、点ごとの 1 次・2 次の因子の係数を時定数 10 ms で新しい値へ近づけます。` +
    `安定な 2 次の分母 ${inl(row(one, PL, sub(mi('a'), one), zi(1), PL, sub(mi('a'), two), zi(2)))} の係数の範囲は三角形（${inl(row(ABS(sub(mi('a'), two)), lt, one))}、${inl(row(ABS(sub(mi('a'), one)), lt, one, PL, sub(mi('a'), two)))}）で凸なので、安定な係数の間を直線で動かしても途中で不安定になりません。`,
];

const zw = (c: string) => par(row(ejw, MI, c));
export const EQS =
  blk(
    row(
      Hz_,
      EQ,
      mi('k'),
      frac(row(PM, par(row(one, MI, zm, zi(1)))), row(PN, par(row(one, MI, pn, zi(1))))),
      EQ,
      frac(
        row(sum('i', mn(0), mi('M')), sub(mi('b'), mi('i')), sup(mi('z'), row(MI, mi('i')))),
        row(one, PL, sum('i', one, mi('N')), sub(mi('a'), mi('i')), sup(mi('z'), row(MI, mi('i')))),
      ),
    ),
  ) +
  blk(row(ABS(Hw), EQ, mi('k'), frac(row(PM, ABS(row(ejw, MI, zm))), row(PN, ABS(row(ejw, MI, pn)))))) +
  blk(row(ANG, Hw, EQ, SM, ANG, zw(zm), MI, SN, ANG, zw(pn), PL, par(row(mi('N'), MI, mi('M'))), w)) +
  blk(
    row(
      mi('τ'),
      par(w),
      EQ,
      MI,
      frac(row(mi('d'), mi('φ')), row(mi('d'), w)),
      EQ,
      SN,
      Re,
      brk(frac(pn, zw(pn))),
      MI,
      SM,
      Re,
      brk(frac(zm, zw(zm))),
    ),
  ) +
  blk(
    row(
      par(row(one, MI, mi('c'), zi(1))),
      par(row(one, MI, sup(mi('c'), mo('*')), zi(1))),
      EQ,
      one,
      MI,
      two,
      mi('r'),
      cos,
      mi('θ'),
      zi(1),
      PL,
      sup(mi('r'), two),
      zi(2),
    ),
  ) +
  blk(
    row(
      ABS(pn),
      lt,
      one,
      '<mspace width="1em"/>',
      mo('('),
      mi('n'),
      EQ,
      one,
      mo(','),
      mo('…'),
      mo(','),
      mi('N'),
      mo(')'),
    ),
  ) +
  blk(
    row(
      mi('Q'),
      EQ,
      frac(ABS(mi('s')), row(MI, two, Re, mi('s'))),
      EQ,
      frac(`<msqrt>${row(sup(par(row(ln, mi('r'))), two), PL, sup(mi('θ'), two))}</msqrt>`, row(MI, two, ln, mi('r'))),
      mo(','),
      '<mspace width="1em"/>',
      mi('f'),
      EQ,
      frac(row(mi('θ'), fs), row(two, mi('π'))),
      mo(','),
      '<mspace width="1em"/>',
      mi('τ'),
      EQ,
      MI,
      frac(one, row(fs, ln, mi('r'))),
    ),
  );
