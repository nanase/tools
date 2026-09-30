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
  mo,
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
  `2 層以上では、どの層にも同じうずまきを重ねます。直列では電流が同じ向きに回るようビアでつなぎ、各層の ${inl(sub(L_, one))}（電流シート近似）と、層 ${inl(mi('i'))}・${inl(mi('j'))} の結合係数 ${inl(sub(mi('k'), row(mi('i'), mi('j'))))} から全体を求めます。` +
    `結合係数は、各巻きを同じ面積の円形ループに置き換え、同軸の円形ループの相互インダクタンス（Maxwell の式）を足し合わせて、同じループで求めた 1 層の自己インダクタンスとの比をとります。層の間隔がコイルの径より十分に狭いと結合係数は 1 に近づき、直列の ${inl(L_)} は層数の 2 乗倍に近づきます。` +
    `並列では各層の電圧が等しいとして電流の分かれ方を求めます。${inl(L_)} はほとんど増えず、抵抗が下がります。電流の分かれ方はインダクタンスだけで決めるので、抵抗の比が大きい低い周波数では実際と合いません。` +
    `直列の層の間には電位差があり、容量が自己共振周波数 ${inl(sub(f_, mi('SRF', true)))} を下げます。重なった配線を平行平板とみなし、電位が配線に沿って直線的に変わるとして静電エネルギーから等価な容量 ${inl(sub(C, mi('p')))} を求めます（2 層で 1/3 になる Zolfaghari らの結果を ${inl(n_)} 層へ広げたもの）。縁の容量や巻線の間の容量を含めないので、実際の自己共振はこれより低くなります。`,
  `条件から探すでは、コイルを共振コンデンサと直列にして電圧 ${inl(mi('V'))} で駆動するとみなします。共振では電流が ${inl(row(mi('I'), EQ, mi('V'), SLASH, sub(mi('R'), mi('tot'))))} になり、磁気モーメントは電流と各巻きの面積の和の積です（直列は全層、並列は 1 層ぶん）。` +
    `離れた所の磁界は磁気双極子の式で求め、1 V で駆動したときの 1 m 先（コイルの軸上）の値で比べます。電圧で駆動すると、巻数を増やしても抵抗が同じ割合で増えるため磁界はあまり変わらず、面積が広いほど、配線が太いほど強くなります。` +
    `直列の抵抗 ${inl(sub(mi('R'), mi('tot')))} は、コイルの交流抵抗、抵抗の下限、帯域を満たす Q の上限から決まる値のうち大きいものとし、足りない分は抵抗を足すとします。抵抗の上限を超えるもの、配線の長さが波長の 1/10 を超えるもの、自己共振が周波数の 3 倍より低いものは除きます。`,
  `この計算は近接効果（隣の巻線の磁界で電流が偏る効果）を含めていません。巻線の間隔が狭いほど実際の交流抵抗は大きく、${inl(Q)} は小さくなります。` +
    `同じ層の巻線の間の容量による自己共振は考えていません。自己共振周波数に近づくと、実際のインダクタンスと ${inl(Q)} はこの計算から大きく外れます。配線の長さが波長の 1/10 を超える周波数では、集中定数としての計算は目安になりません。` +
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
  ) +
  blk(
    row(
      mi('M'),
      par(row(mi('a'), mo(','), mi('b'), mo(','), mi('h'))),
      EQ,
      mu0,
      sqrt(row(mi('a'), mi('b'))),
      par(
        row(
          par(row(frac(two, mi('κ')), MI, mi('κ'))),
          mi('K'),
          par(mi('κ')),
          MI,
          frac(two, mi('κ')),
          mi('E'),
          par(mi('κ')),
        ),
      ),
      CM,
      sup(mi('κ'), two),
      EQ,
      frac(row(mn('4'), mi('a'), mi('b')), row(sup(par(row(mi('a'), PL, mi('b'))), two), PL, sup(mi('h'), two))),
    ),
  ) +
  blk(
    row(
      sub(mi('k'), row(mi('i'), mi('j'))),
      EQ,
      frac(
        row(
          '<munder><mo>∑</mo><mrow><mi>t</mi><mo>,</mo><mi>u</mi></mrow></munder>',
          mi('M'),
          par(row(sub(mi('r'), mi('t')), mo(','), sub(mi('r'), mi('u')), mo(','), sub(mi('h'), row(mi('i'), mi('j'))))),
        ),
        row(
          '<munder><mo>∑</mo><mi>t</mi></munder>',
          sub(L_, mi('t')),
          PL,
          '<munder><mo>∑</mo><mrow><mi>t</mi><mo>≠</mo><mi>u</mi></mrow></munder>',
          mi('M'),
          par(row(sub(mi('r'), mi('t')), mo(','), sub(mi('r'), mi('u')), mo(','), mn('0'))),
        ),
      ),
      CM,
      sub(L_, mi('t')),
      EQ,
      mu0,
      sub(mi('r'), mi('t')),
      par(row(ln(frac(row(mn('8'), sub(mi('r'), mi('t'))), row(mn('0.2235'), par(row(w_, PL, t_))))), MI, two)),
    ),
  ) +
  blk(
    row(
      sub(L_, mi('ser', true)),
      EQ,
      sub(L_, one),
      '<munder><mo>∑</mo><mi>i</mi></munder><munder><mo>∑</mo><mi>j</mi></munder>',
      sub(mi('k'), row(mi('i'), mi('j'))),
      CM,
      sub(L_, mi('par', true)),
      EQ,
      frac(sub(L_, one), row(sup(mi('𝟏'), mi('T', true)), sup(mi('𝐊'), row(MI, one)), mi('𝟏'))),
      '<mspace width="1em"/>',
      row('<mtext>（</mtext>', sub(mi('k'), row(mi('i'), mi('i'))), EQ, one, '<mtext>）</mtext>'),
    ),
  ) +
  blk(
    row(
      sub(C, mi('i')),
      EQ,
      frac(row(sub(mi('ε'), mn('0')), sub(mi('ε'), mi('r')), w_, sub(ell, one)), sub(mi('h'), mi('i'))),
      CM,
      sub(C, mi('p')),
      EQ,
      frac(mn('4'), row(mn('3'), sup(n_, two))),
      '<munder><mo>∑</mo><mi>i</mi></munder>',
      sub(C, mi('i')),
      CM,
      sub(f_, mi('SRF', true)),
      EQ,
      frac(one, row(two, pi, sqrt(row(L_, sub(C, mi('p')))))),
    ),
  ) +
  blk(
    row(
      sub(mi('R'), mi('tot')),
      EQ,
      '<mo>max</mo>',
      par(row(Rac, mo(','), sub(mi('R'), mi('min')), mo(','), frac(row(two, pi, f_, L_), sub(Q, mi('max'))))),
      CM,
      frac(one, sub(Q, mi('max'))),
      EQ,
      '<mo>max</mo>',
      par(row(mi('a'), MI, frac(one, mi('a')))),
      '<mspace width="0.5em"/>',
      par(row(mi('a'), EQ, one, '<mo>±</mo>', mi('B'))),
    ),
  ) +
  blk(
    row(
      mi('m'),
      EQ,
      frac(mi('V'), sub(mi('R'), mi('tot'))),
      '<munder><mo>∑</mo><mi>t</mi></munder>',
      pi,
      sq(sub(mi('r'), mi('t'))),
      CM,
      mi('H'),
      par(mi('r')),
      EQ,
      frac(mi('m'), row(two, pi, sup(mi('r'), mn('3')))),
      '<mspace width="1em"/><mtext>（軸上、</mtext>',
      mi('r'),
      EQ,
      mn('1'),
      '<mspace width="0.17em"/><mi mathvariant="normal">m</mi><mtext>）</mtext>',
    ),
  );
