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

/** 本文の出典番号 */
const rf = (i: number) => `<a class="rf" href="#thy-r${i}">[${i}]</a>`;
const LE = mo('≤'),
  Rtot = sub(mi('R'), mi('tot')),
  kij = sub(mi('k'), row(mi('i'), mi('j')));

/* ---------- 節ごとの本文（見出しと式の箱は Theory.astro） ---------- */
/** うずまきの形 */
export const THY_SHAPE =
  '<p>うずまきの形は、次の 4 つの値で決まります。多角形の径は、向かい合う辺の間で測ります。</p>' +
  '<dl class="syms">' +
  `<dt>${inl(n_)}</dt><dd>巻数</dd>` +
  `<dt>${inl(w_)}</dt><dd>配線の幅</dd>` +
  `<dt>${inl(s_)}</dt><dd>配線の間隔</dd>` +
  `<dt>${inl(dO)}</dt><dd>外径</dd>` +
  '</dl>' +
  `<p>内径 ${inl(dI)} は論文の定義のとおり、巻線が ${inl(row(w_, PL, s_))} 間隔で ${inl(n_)} 本並ぶとして求めます${rf(1)}。</p>` +
  `<p>配線の長さ ${inl(ell)} は、図に描いたうずまきの中心線の長さです。多角形は 1 周ごとに辺を 1 間隔ずつ内側へずらし、円はアルキメデスのらせんで描きます。</p>` +
  `<p>充填率 ${inl(rho)} は 0 に近いほど中空で、1 に近いほど中心まで巻いたコイルです。</p>`;

/** インダクタンス */
export const THY_L =
  `<p>インダクタンスは、Mohan らの 3 つの近似式で求めます${rf(1)}。</p>` +
  '<div class="tt-w"><table class="tt">' +
  '<thead><tr><th>式</th><th>使い方</th><th>円形</th></tr></thead><tbody>' +
  `<tr><th>電流シート近似 ${inl(Ls('gmd'))}</th><td>主値</td><td>出す</td></tr>` +
  `<tr><th>修正 Wheeler 式 ${inl(Ls('mw'))}</th><td>比較</td><td>出さない</td></tr>` +
  `<tr><th>単項式近似 ${inl(Ls('mon'))}</th><td>比較</td><td>出さない</td></tr>` +
  '</tbody></table></div>' +
  '<p>主値の電流シート近似は、4 つの形すべてに係数があり、電磁気の関係から導かれた式です。' +
  `${inl(row(s_, SLASH, w_))} が大きいほど誤差が増えます。論文の最大誤差 8&nbsp;% は、${inl(row(s_, LE, mn('3'), w_))} の範囲の値です。</p>` +
  '<p>修正 Wheeler 式と単項式近似は、論文に円形の係数がないため、円形では出しません。' +
  '単項式近似は外径 100〜480 µm の IC 上のコイルに当てはめた式で、プリント基板の寸法はその範囲の外にあります。</p>';

/** 抵抗と Q */
export const THY_R =
  `<p>直流抵抗は、銅の抵抗率 ${inl(row(rCu, EQ, mn('1.7241'), '<mo>×</mo>', sup(mn('10'), row(MI, mn('8'))), '<mspace width="0.17em"/>', mi('Ω·m', true)))} から求めます。この値は 20 °C のものです${rf(2)}。</p>` +
  `<p>周波数が上がると、電流は表面から表皮の深さ ${inl(dl)} ほどの層に集まります。そこで Yue と Wong にならい、電流が片側の面から指数関数的に減るとみなした実効厚さ ${inl(tef)} で交流抵抗を求めます${rf(3)}。</p>` +
  `<p>共振の量は次のとおりです${rf(4)}。</p>` +
  '<dl class="syms">' +
  `<dt>${inl(Q)}</dt><dd>コイルの誘導性リアクタンスと交流抵抗の比</dd>` +
  `<dt>${inl(C)}</dt><dd>共振コンデンサ。コイルと組み合わせて ${inl(f_)} で共振させる値</dd>` +
  `<dt>${inl(mi('B'))}</dt><dd>帯域幅。共振の鋭さの目安</dd>` +
  '</dl>';

/** 2 層以上: 重ね方と直列 */
export const THY_SER =
  '<p>2 層以上では、どの層にも同じうずまきを重ねます。</p>' +
  '<h4>直列</h4>' +
  `<p>直列では、電流が同じ向きに回るようビアでつなぎます。各層の ${inl(sub(L_, one))} と、層 ${inl(mi('i'))}・${inl(mi('j'))} の結合係数 ${inl(kij)} から全体を求めます。${inl(sub(L_, one))} は電流シート近似の値です。</p>` +
  `<p>結合係数は、次の手順で求めます${rf(5)}。</p>` +
  '<ol class="flow" aria-label="結合係数の求め方">' +
  '<li><b>円形ループに置き換える</b><span>各巻きを同じ面積の円に</span></li>' +
  '<li><b>相互インダクタンスを足す</b><span>同軸の円形ループ（Maxwell の式）</span></li>' +
  '<li><b>自己インダクタンスとの比をとる</b><span>同じループで求めた 1 層の値</span></li>' +
  '</ol>' +
  `<p>層の間隔がコイルの径より十分に狭いと、結合係数は 1 に近づきます。このとき直列の ${inl(L_)} は、層数の 2 乗倍に近づきます。</p>`;

/** 2 層以上: 並列 */
export const THY_PAR =
  `<p>並列では、各層の電圧が等しいとして電流の分かれ方を求めます。${inl(L_)} はほとんど増えず、抵抗が下がります。</p>` +
  '<p>電流の分かれ方はインダクタンスだけで決めます。そのため、抵抗の比が大きい低い周波数では実際と合いません。</p>';

/** 2 層以上: 層の間の容量 */
export const THY_CP =
  `<p>直列の層の間には電位差があり、その容量が自己共振周波数 ${inl(sub(f_, mi('SRF', true)))} を下げます。</p>` +
  `<p>重なった配線を平行平板とみなし、電位が配線に沿って直線的に変わるとして、静電エネルギーから等価な容量 ${inl(sub(C, mi('p')))} を求めます。2 層で ${inl(row(one, SLASH, mn('3')))} になる Zolfaghari らの結果${rf(6)}を、${inl(n_)} 層へ広げたものです。</p>` +
  '<p>縁の容量や巻線の間の容量を含めないので、実際の自己共振はこれより低くなります。</p>';

/** 条件から探す */
export const THY_FIND =
  `<p>条件から探すでは、コイルを共振コンデンサと直列にして、電圧 ${inl(mi('V'))} で駆動するとみなします。</p>` +
  `<p>共振では、電流が ${inl(row(mi('I'), EQ, mi('V'), SLASH, Rtot))} になります。磁気モーメントは、電流と各巻きの面積の和の積です。面積の和は、直列では全層、並列では 1 層ぶんです。</p>` +
  `<p>離れた所の磁界は磁気双極子の式で求めます${rf(7)}。比べるのは、1 V で駆動したときの、コイルの軸上 1 m 先の値です。</p>` +
  '<p>電圧で駆動すると、巻数を増やしても抵抗が同じ割合で増えるため、磁界はあまり変わりません。面積が広いほど、配線が太いほど強くなります。</p>' +
  `<p>直列の抵抗 ${inl(Rtot)} は、次の値のうち大きいものとします。足りない分は抵抗を足すとします。</p>` +
  '<ul class="tl">' +
  '<li>コイルの交流抵抗</li>' +
  '<li>抵抗の下限</li>' +
  `<li>帯域を満たす ${inl(Q)} の上限から決まる値</li>` +
  '</ul>' +
  '<p>次のものは除きます。</p>' +
  '<ul class="tl">' +
  '<li>抵抗の上限を超えるもの</li>' +
  `<li>配線の長さが波長の ${inl(row(one, SLASH, mn('10')))} を超えるもの</li>` +
  '<li>自己共振が周波数の 3 倍より低いもの</li>' +
  '</ul>';

/** 計算に含めないもの */
export const THY_LIMIT =
  '<ul class="tl">' +
  `<li><b>近接効果:</b> 隣の巻線の磁界で電流が偏る効果。巻線の間隔が狭いほど、実際の交流抵抗は大きく、${inl(Q)} は小さくなる</li>` +
  '<li>同じ層の巻線の間の容量による自己共振</li>' +
  '<li>基板の誘電体</li>' +
  '<li>近くの銅箔・グランド・金属</li>' +
  '<li>引き出し線とビア</li>' +
  '<li>裏面を通して外へ出す配線</li>' +
  '</ul>' +
  `<p>自己共振周波数に近づくと、実際のインダクタンスと ${inl(Q)} はこの計算から大きく外れます。配線の長さが波長の ${inl(row(one, SLASH, mn('10')))} を超える周波数では、集中定数としての計算は目安になりません。</p>`;

/** 出典 [5] の用途（MathML を含む） */
export const RF_GROVER = `同軸の円形ループの相互インダクタンス（Maxwell の式）、平たい導体の幾何平均距離 ${inl(row(mn('0.2235'), par(row(w_, PL, t_))))}`;

/** このツールで決めたこと */
export const THY_OWN =
  '<ul class="tl">' +
  `<li>${inl(n_)} 層への拡張</li>` +
  '<li>各巻きを同じ面積の円に置き換える近似</li>' +
  '<li>基板の構成の値</li>' +
  '<li>FR-4 の比誘電率 4.4。代表値</li>' +
  '<li>条件から探すときの駆動と評価の方法</li>' +
  '<li>配線の長さ。うずまきの中心線の幾何計算による</li>' +
  '</ul>';

const a0 = sub(mi('a'), mn('0')),
  r = mi('r'),
  th = mi('θ'),
  d_ = mi('d');

/** 式（順に 0 内径・1 平均径と充填率・2〜4 インダクタンスの 3 式・5 配線の長さ・6 直流抵抗・7 表皮の深さ・8 交流抵抗・9 Q と共振・10 相互インダクタンス・11 結合係数・12 直列と並列・13 層の間の容量・14 直列の抵抗・15 磁界） */
const B = [
  blk(row(dI, EQ, dO, MI, two, n_, w_, MI, two, par(row(n_, MI, one)), s_)),
  blk(row(dA, EQ, frac(row(dO, PL, dI), two), CM, rho, EQ, frac(row(dO, MI, dI), row(dO, PL, dI)))),
  blk(
    row(
      Ls('gmd'),
      EQ,
      frac(row(mu0, sup(n_, two), dA, cS(1)), two),
      par(row(ln(frac(cS(2), rho)), PL, cS(3), rho, PL, cS(4), sq(rho))),
    ),
  ),
  blk(row(Ls('mw'), EQ, frac(row(KS(1), mu0, sup(n_, two), dA), row(one, PL, KS(2), rho)))),
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
  ),
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
  ),
  blk(row(Rdc, EQ, frac(row(rCu, ell), row(w_, t_)))),
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
  ),
  blk(row(Rac, EQ, frac(row(rCu, ell), row(w_, tef)))),
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
  ),
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
  ),
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
  ),
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
  ),
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
  ),
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
  ),
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
  ),
];
/** 節ごとの式 */
export const EQS_SHAPE = B[0] + B[1] + B[5];
export const EQS_L = B[2] + B[3] + B[4];
export const EQS_R = B[6] + B[7] + B[8] + B[9];
export const EQS_SER = B[10] + B[11] + B[12];
export const EQS_CP = B[13];
export const EQS_FIND = B[14] + B[15];
