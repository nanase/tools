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

/** 本文の出典番号 */
const rf = (i: number) => `<a class="rf" href="#thy-r${i}">[${i}]</a>`;

/* ---------- 節ごとの本文（見出しと式の箱は Theory.astro） ---------- */
/** 極と零点 */
export const THY_PZ =
  `<p>伝達関数 ${inl(Hz_)} の分子が 0 になる ${inl(mi('z'))} を零点 ${inl(zm)}、分母が 0 になる ${inl(mi('z'))} を極 ${inl(pn)} と呼びます。</p>` +
  '<p>係数が実数なら、実軸の上にない極と零点は複素共役の対で現れます。</p>';

/** 振幅と位相（図の前） */
export const THY_RESP =
  `<p>周波数特性は、${inl(mi('z'))} を単位円の上の点 ${inl(ejw)} に置いた ${inl(Hw)} です${rf(1)}。${inl(row(w, EQ, two, mi('π'), mi('f'), SLASH, fs))} です。</p>` +
  `<p>${inl(ejw)} から各零点・各極へ線を引き、次のように置きます${rf(2)}。</p>` +
  '<dl class="syms">' +
  `<dt>${inl(mi('d'))}</dt><dd>線の長さ</dd>` +
  `<dt>${inl(mi('φ'))}</dt><dd>実軸の正の向きからの線の角度</dd>` +
  '</dl>';

/** 振幅と位相（図の後） */
export const THY_RESP2 =
  '<ul class="tl">' +
  '<li><b>振幅:</b> 零点までの長さの積を、極までの長さの積で割ったもの</li>' +
  '<li><b>位相:</b> 零点の角度の和から、極の角度の和を引いたもの</li>' +
  '</ul>' +
  '<p>極が単位円に近いと、その角度の近くの周波数で極までの線が短くなり、振幅が大きくなります。これが共振です。単位円の上の零点は、その周波数を消します。</p>';

/** 原点の根 */
export const THY_ORIGIN =
  `<p>因果的なフィルタは ${inl(zi(1))} の多項式で書きます。そのため、極と零点の個数が違うときは、少ない側の根を原点に足したのと同じになります${rf(2)}。</p>` +
  `<p>原点の根は振幅を変えず、位相を ${inl(w)} ずつずらします。${inl(mi('z'))} 平面には破線で描いています。</p>`;

/** 安定と、アナログの極に移す見方 */
export const THY_STAB =
  '<p>すべての極が単位円の内側にあれば安定です。</p>' +
  `<p>極 ${inl(mi('p'))} を ${inl(row(mi('s'), EQ, fs, ln, mi('p')))} とアナログの極に移すと、共振の ${inl(mi('Q'))} と減衰の時定数 ${inl(mi('τ'))} が分かります。</p>`;

/** 双2次の縦続 */
export const THY_SOS =
  `<p>高い次数のフィルタは、極の対と近い零点の対を組んだ双2次の段に分け、縦続につなぐと係数の丸めに強くなります${rf(1)}。</p>` +
  `<p>段は、単位円に近い極から順に、いちばん近い零点と組みます${rf(3)}。</p>`;

/** 試聴 */
export const THY_SND =
  '<p>試聴では、点を動かしている間も音が途切れないようにします。点ごとの 1 次・2 次の因子の係数を、時定数 10 ms で新しい値へ近づけます。</p>' +
  `<p>安定な 2 次の分母 ${inl(row(one, PL, sub(mi('a'), one), zi(1), PL, sub(mi('a'), two), zi(2)))} の係数の範囲は、次の三角形で、凸です。そのため、安定な係数の間を直線で動かしても、途中で不安定になりません。</p>`;

/** このツールで決めたこと */
export const THY_OWN =
  '<ul class="tl">' +
  `<li>${inl(mi('Q'))} と時定数を、${inl(row(mi('z'), EQ, sup(mi('e'), row(mi('s'), mi('T')))))} でアナログの 2 次系の極に移して求める見方</li>` +
  '<li>試聴の係数の切り替え方</li>' +
  '</ul>';

const zw = (c: string) => par(row(ejw, MI, c));
/** 式（順に H(z)・振幅・位相・群遅延・共役の対・安定・Q と時定数） */
const B = [
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
  ),
  blk(row(ABS(Hw), EQ, mi('k'), frac(row(PM, ABS(row(ejw, MI, zm))), row(PN, ABS(row(ejw, MI, pn)))))),
  blk(row(ANG, Hw, EQ, SM, ANG, zw(zm), MI, SN, ANG, zw(pn), PL, par(row(mi('N'), MI, mi('M'))), w)),
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
  ),
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
  ),
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
  ),
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
  ),
];
const a1 = sub(mi('a'), one),
  a2 = sub(mi('a'), two);
/** 節ごとの式 */
export const EQS_PZ = B[0] + B[4];
export const EQS_RESP = B[1] + B[2] + B[3];
export const EQS_STAB = B[5] + B[6];
/** 安定な 2 次の分母の係数の三角形 */
export const EQS_TRI = blk(row(ABS(a2), lt, one)) + blk(row(ABS(a1), lt, one, PL, a2));
