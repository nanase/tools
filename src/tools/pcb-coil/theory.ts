/** 動作原理と式の固定部分（ビルド時だけ使い、ブラウザへは送らない） */
import {
  aS,
  blk,
  CM,
  cS,
  dA,
  dI,
  dl,
  dO,
  EQ,
  ell,
  f_,
  frac,
  inl,
  KS,
  L_,
  Ls,
  ln,
  MI,
  mi,
  mn,
  mu0,
  n_,
  one,
  PL,
  par,
  pi,
  Rac,
  Rdc,
  rCu,
  rho,
  row,
  SLASH,
  s_,
  sq,
  sqrt,
  sub,
  sup,
  t_,
  tef,
  two,
  w_,
} from './math';

const Q = mi('Q'),
  C = mi('C');

export const THEORY: string[] = [
  `うずまきの形は、巻数 ${inl(n_)}・配線の幅 ${inl(w_)}・配線の間隔 ${inl(s_)}・外径 ${inl(dO)} で決まります。多角形の径は向かい合う辺の間で測ります。` +
    `内径 ${inl(dI)} は論文の定義のとおり、巻線が ${inl(row(w_, PL, s_))} 間隔で ${inl(n_)} 本並ぶとして求めます。配線の長さ ${inl(ell)} は、図に描いたうずまきの中心線の長さです。多角形は 1 周ごとに辺を 1 間隔ずつ内側へずらし、円はアルキメデスのらせんで描きます。充填率 ${inl(rho)} は 0 に近いほど中空で、1 に近いほど中心まで巻いたコイルです。`,
  `インダクタンスは Mohan らの 3 つの近似式で求めます。主値には、4 つの形すべてに係数があり、電磁気の関係から導かれた電流シート近似 ${inl(Ls('gmd'))} を使います。` +
    `この式は ${inl(row(s_, SLASH, w_))} が大きいほど誤差が増え、論文の最大誤差 8 % は ${inl(row(s_, '<mo>≤</mo>', mn('3'), w_))} の範囲の値です。` +
    `修正 Wheeler 式 ${inl(Ls('mw'))} と単項式近似 ${inl(Ls('mon'))} は比較として出します。どちらも論文に円形の係数がないため、円形では出しません。` +
    `単項式近似は外径 100〜480 µm の IC 上のコイルに当てはめた式で、プリント基板の寸法はその範囲の外にあります。`,
  `直流抵抗は銅の抵抗率 ${inl(row(rCu, EQ, mn('1.7241'), '<mo>×</mo>', sup(mn('10'), row(MI, mn('8'))), '<mspace width="0.17em"/>', mi('Ω·m', true)))}（20 °C）から求めます。` +
    `周波数が上がると、電流は表面から表皮の深さ ${inl(dl)} ほどの層に集まります。Yue と Wong にならい、電流が片側の面から指数関数的に減るとみなした実効厚さ ${inl(tef)} で交流抵抗を求めます。` +
    `${inl(Q)} はコイルの誘導性リアクタンスと交流抵抗の比で、共振コンデンサ ${inl(C)} はコイルと組み合わせて ${inl(f_)} で共振させる値です。帯域幅 ${inl(row(f_, SLASH, Q))} は共振の鋭さの目安です。`,
  `この計算は近接効果（隣の巻線の磁界で電流が偏る効果）を含めていません。巻線の間隔が狭いほど実際の交流抵抗は大きく、${inl(Q)} は小さくなります。` +
    `巻線の間の容量による自己共振も考えていません。自己共振周波数に近づくと、実際のインダクタンスと ${inl(Q)} はこの計算から大きく外れます。配線の長さが波長の 1/10 を超える周波数では、集中定数としての計算は目安になりません。` +
    `基板の誘電体、近くの銅箔・グランド・金属、引き出し線とビア、裏面を通して外へ出す配線も考えていません。`,
];

const a0 = sub(mi('a'), mn('0')),
  r = mi('r'),
  th = mi('θ'),
  d_ = mi('d');

export const EQS =
  blk(row(dI, EQ, dO, MI, two, n_, w_, MI, two, par(row(n_, MI, one)), s_)) +
  blk(row(dA, EQ, frac(row(dO, PL, dI), two), CM, rho, EQ, frac(row(dO, MI, dI), row(dO, PL, dI)))) +
  blk(
    row(
      Ls('gmd'),
      EQ,
      frac(row(mu0, sup(n_, two), dA, cS(1)), two),
      par(row(ln(frac(cS(2), rho)), PL, cS(3), rho, PL, cS(4), sq(rho))),
    ),
  ) +
  blk(row(Ls('mw'), EQ, frac(row(KS(1), mu0, sup(n_, two), dA), row(one, PL, KS(2), rho)))) +
  blk(
    row(
      Ls('mon'),
      EQ,
      mi('β'),
      sup(dO, aS(1)),
      sup(w_, aS(2)),
      sup(dA, aS(3)),
      sup(n_, aS(4)),
      sup(s_, aS(5)),
      '<mspace width="1em"/>',
      row('<mtext>（</mtext>', Ls('mon'), '<mtext> は nH、長さは µm）</mtext>'),
    ),
  ) +
  blk(
    row(
      r,
      par(th),
      EQ,
      a0,
      MI,
      frac(row(par(row(w_, PL, s_)), th), row(two, pi)),
      CM,
      ell,
      EQ,
      '<msubsup><mo>&#x222B;</mo><mn>0</mn><mrow><mn>2</mn><mi>π</mi><mi>n</mi></mrow></msubsup>',
      sqrt(row(sup(r, two), PL, sup(par(frac(row(d_, r), row(d_, th))), two))),
      '<mspace width="0.17em"/><mi>d</mi><mi>θ</mi>',
      '<mspace width="1em"/><mtext>（円。</mtext>',
      a0,
      EQ,
      frac(dO, two),
      MI,
      frac(w_, two),
      '<mtext>）</mtext>',
    ),
  ) +
  blk(row(Rdc, EQ, frac(row(rCu, ell), row(w_, t_)))) +
  blk(
    row(
      dl,
      EQ,
      sqrt(frac(rCu, row(pi, f_, mu0))),
      CM,
      tef,
      EQ,
      dl,
      par(row(one, MI, sup(mi('e'), row(MI, t_, SLASH, dl)))),
    ),
  ) +
  blk(row(Rac, EQ, frac(row(rCu, ell), row(w_, tef)))) +
  blk(
    row(
      Q,
      EQ,
      frac(row(two, pi, f_, L_), Rac),
      CM,
      C,
      EQ,
      frac(one, row(sq(par(row(two, pi, f_))), L_)),
      CM,
      mi('B'),
      EQ,
      frac(f_, Q),
    ),
  );
