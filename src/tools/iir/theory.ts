/** 動作原理と式の固定部分（ビルド時だけ使い、ブラウザへは送らない） */
import {
  blk,
  EQ,
  FN,
  frac,
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
  sq,
  sqrt,
  sub,
  sup,
  two,
  zi,
} from '../biquad/math';

const om = mi('Ω'),
  abs2 = (x: string) => sup(row('<mo>|</mo>', x, '<mo>|</mo>'), two),
  HjO = row(mi('H'), par(row(mi('j'), om))),
  ep = sub(mi('ε'), mi('p')),
  es = sub(mi('ε'), mi('s')),
  Ap = sub(mi('A'), mi('p')),
  As = sub(mi('A'), mi('s')),
  Os = sub(om, mi('s')),
  O0 = sub(om, mn(0)),
  fsS = sub(mi('f'), mi('s')),
  N = mi('N'),
  TN = (x: string) => row(sub(mi('T'), N), par(x)),
  fn = (name: string, x: string) => row(`<mi>${name}</mi>`, FN, x),
  inv1 = (x: string) => frac(one, x),
  geq = mo('&#x2265;');

/* ---------- 原型 ---------- */
export const THEORY_P1 =
  `古典的な IIR フィルタは、振幅の形が分かっているアナログフィルタ（原型）から作ります。原型は基準の端を ${inl(row(om, EQ, mn(1)))} rad/s に置いた LPF で、近似ごとに振幅の 2 乗を次の形にします。` +
  `${inl(sub(mi('T'), N))} はチェビシェフ多項式、${inl(sub(mi('R'), N))} はヤコビの楕円関数で表すチェビシェフ有理関数、${inl(sub(mi('θ'), N))} は逆 Bessel 多項式です。` +
  `ベッセルフィルタだけは振幅でなく群遅延（位相の傾き）を平坦にしたもので、直流の近くで遅延がそろい、波形の形が崩れにくくなります。`;

export const EQ_PROTO = [
  blk(row(abs2(HjO), EQ, inv1(row(one, PL, sup(mi('ε'), two), sup(om, row(two, N)))))),
  blk(row(abs2(HjO), EQ, inv1(row(one, PL, sup(ep, two), sup(TN(om), two))))),
  blk(row(abs2(HjO), EQ, inv1(row(one, PL, frac(sup(es, two), sup(TN(frac(Os, om)), two)))))),
  blk(row(abs2(HjO), EQ, inv1(row(one, PL, sup(ep, two), sup(row(sub(mi('R'), N), par(om)), two))))),
  blk(
    row(
      mi('H'),
      par(mi('s')),
      EQ,
      frac(row(sub(mi('θ'), N), par(mn(0))), row(sub(mi('θ'), N), par(mi('s')))),
      mo(','),
      '<mspace width="1em"/>',
      sub(mi('θ'), N),
      par(mi('s')),
      EQ,
      `<munderover><mo>&#x2211;</mo>${row(mi('k'), EQ, mn(0))}${N}</munderover>`,
      frac(
        row(par(row(two, N, MI, mi('k'))), mo('!')),
        row(sup(two, row(N, MI, mi('k'))), mi('k'), mo('!'), par(row(N, MI, mi('k'))), mo('!')),
      ),
      sup(mi('s'), mi('k')),
    ),
  ),
  blk(
    row(
      ep,
      EQ,
      sqrt(row(sup(mn(10), row(Ap, SLASH, mn(10))), MI, one)),
      mo(','),
      '<mspace width="1em"/>',
      es,
      EQ,
      sqrt(row(sup(mn(10), row(As, SLASH, mn(10))), MI, one)),
    ),
  ),
].join('');

/* ---------- 次数 ---------- */
const kk = mi('k'),
  k1 = sub(mi('k'), mn(1)),
  K = (x: string) => row(mi('K'), par(x)),
  Kp = (x: string) => row(sup(mi('K'), mo('′')), par(x));

export const THEORY_P2 =
  `仕様から設計するときは、阻止域端を原型の周波数にした選択度 ${inl(Os)} と、${inl(row(es, SLASH, ep))} から最小の次数を求めます。` +
  `楕円フィルタの次数は第 1 種完全楕円積分 ${inl(K(kk))} の比で表されます。整数に切り上げた次数では、通過域と阻止域の減衰はそのままに、遷移域が仕様より狭くなるように選択度を求め直します（次数の式を ${inl(kk)} について解く）。` +
  `楕円関数と完全楕円積分は、降下 Landen 変換の母数の列 ${inl(row(sub(kk, mi('n')), EQ, sup(par(row(sub(kk, row(mi('n'), MI, one)), SLASH, par(row(one, PL, `<msubsup>${kk}${row(mi('n'), MI, one)}<mo>′</mo></msubsup>`)))), two)))} で求めます。`;

export const EQ_ORDER = [
  blk(row(N, geq, frac(fn('log', par(row(es, SLASH, ep))), fn('log', Os)))),
  blk(row(N, geq, frac(fn('arccosh', par(row(es, SLASH, ep))), fn('arccosh', Os)))),
  blk(
    row(
      N,
      geq,
      frac(row(K(kk), Kp(k1)), row(Kp(kk), K(k1))),
      mo(','),
      '<mspace width="1em"/>',
      kk,
      EQ,
      inv1(Os),
      mo(','),
      '<mspace width="0.6em"/>',
      k1,
      EQ,
      frac(ep, es),
    ),
  ),
  blk(
    row(
      K(kk),
      EQ,
      frac(mi('π'), two),
      `<munderover><mo>&#x220F;</mo>${row(mi('n'), EQ, one)}<mi>∞</mi></munderover>`,
      par(row(one, PL, sub(kk, mi('n')))),
      mo(','),
      '<mspace width="1em"/>',
      Kp(kk),
      EQ,
      K(sqrt(row(one, MI, sup(kk, two)))),
    ),
  ),
].join('');

/* ---------- 周波数変換と双一次変換 ---------- */
const s = mi('s'),
  arrow = mo('&#x2192;');
export const THEORY_P3 =
  `原型を周波数変換で目的の応答にし、双一次変換でデジタルフィルタにします。双一次変換は周波数軸を ${inl('<mi>tan</mi>')} で縮めて ${inl(row(fsS, SLASH, two))} に収めるので、端の周波数をあらかじめ逆向きに伸ばしておきます（プリワーピング）。` +
  `こうすると端の周波数と減衰は仕様どおりになりますが、その間の形は縮みに合わせて歪みます。ベッセルフィルタの平坦な群遅延は、この歪みで崩れます。`;

export const EQ_XFORM = [
  blk(
    row(s, arrow, frac(s, sub(om, mi('c'))), mo(','), '<mspace width="1.2em"/>', s, arrow, frac(sub(om, mi('c')), s)),
  ),
  blk(
    row(
      s,
      arrow,
      frac(row(sup(s, two), PL, sup(O0, two)), row(mi('B'), s)),
      mo(','),
      '<mspace width="1.2em"/>',
      s,
      arrow,
      frac(row(mi('B'), s), row(sup(s, two), PL, sup(O0, two))),
    ),
  ),
  blk(
    row(
      O0,
      EQ,
      sqrt(row(sub(om, mn(1)), sub(om, mn(2)))),
      mo(','),
      '<mspace width="1em"/>',
      mi('B'),
      EQ,
      sub(om, mn(2)),
      MI,
      sub(om, mn(1)),
    ),
  ),
  blk(
    row(
      om,
      EQ,
      two,
      fsS,
      fn('tan', par(frac(row(mi('π'), mi('f')), fsS))),
      mo(','),
      '<mspace width="1em"/>',
      s,
      EQ,
      two,
      fsS,
      frac(row(one, MI, zi(1)), row(one, PL, zi(1))),
    ),
  ),
].join('');

/* ---------- インパルス不変法 ---------- */
const T = mi('T'),
  pk = sub(mi('p'), mi('k')),
  rk = sub(mi('r'), mi('k'));
export const THEORY_P4 = `インパルス不変法は、アナログのインパルス応答を標本化して ${inl(row(sq('h'), EQ, T, sub(mi('h'), mi('a')), par(row(mi('n'), T))))} とします（${inl(row(T, EQ, one, SLASH, fsS))}）。周波数軸は縮みませんが、${inl(row(fsS, SLASH, two))} を越える成分が折り返すので、高域で減衰しない HPF と BSF には使えません。`;

export const EQ_IMP = blk(
  row(
    mi('H'),
    par(mi('z')),
    EQ,
    `<munder><mo>&#x2211;</mo>${mi('k')}</munder>`,
    frac(row(T, rk), row(one, MI, sup(mi('e'), row(pk, T)), zi(1))),
    mo(','),
    '<mspace width="1em"/>',
    sub(mi('H'), mi('a')),
    par(s),
    EQ,
    `<munder><mo>&#x2211;</mo>${mi('k')}</munder>`,
    frac(rk, row(s, MI, pk)),
  ),
);

/* ---------- 実装 ---------- */
const bi = (j: number) => sub(mi('b'), row(mn(j), mi('i'))),
  ai = (j: number) => sub(mi('a'), row(mn(j), mi('i')));
export const THEORY_P5 =
  `実装では、極と零点を 2 つずつ組んだ双2次の縦続（SOS）にします。単位円に最も近い極から順に、それに最も近い零点と組みます。` +
  `段のゲインは、各段の出力の振幅の最大が 1 になるように配ると、固定小数点でも途中であふれにくくなります。` +
  `分母を 1 つの高次の多項式にした直接形は、極が近く集まる高い次数や狭い帯域で係数の丸めに弱く、わずかな誤差で極が大きく動き、単位円の外へ出ることもあります。` +
  `群遅延 ${inl(row(mi('τ'), par(mi('ω')), EQ, MI, row('<mi>d</mi>', mi('φ')), SLASH, row('<mi>d</mi>', mi('ω'))))} は、極と零点ごとの寄与の和で求めます。`;

export const EQ_SOS = blk(
  row(
    mi('H'),
    par(mi('z')),
    EQ,
    `<munder><mo>&#x220F;</mo>${mi('i')}</munder>`,
    frac(row(bi(0), PL, bi(1), zi(1), PL, bi(2), zi(2)), row(one, PL, ai(1), zi(1), PL, ai(2), zi(2))),
  ),
);
