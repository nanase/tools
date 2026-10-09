/** 動作原理と式の固定部分（ビルド時だけ使い、ブラウザへは送らない） */
import {
  APPROX,
  blk,
  DOT,
  EQ,
  FN,
  frac,
  inl,
  MI,
  mi,
  mn,
  mo,
  PL,
  par,
  row,
  SLASH,
  sqrt,
  sub,
  sup,
} from '../biquad/math';

/* ---------- 記号 ---------- */
const N = mi('N'),
  n = mi('n'),
  k = mi('k'),
  w = mi('ω'),
  pi = mi('π'),
  one = mn(1),
  two = mn(2),
  M = mi('M');
const idx = (v: string, i: string) => row(v, '<mo stretchy="false">[</mo>', i, '<mo stretchy="false">]</mo>');
const hS = (i: string) => idx(mi('h'), i),
  hdS = (i: string) => idx(sub(mi('h'), mi('d')), i),
  wS = (i: string) => idx(mi('w'), i);
const Nm1 = row(N, MI, one),
  nmM = row(n, MI, M);
const dp = sub(mi('δ'), mi('p')),
  ds = sub(mi('δ'), mi('s')),
  Ap = sub(mi('A'), mi('p')),
  As = sub(mi('A'), mi('s')),
  fsS = sub(mi('f'), mi('s')),
  dW = row(mi('Δ'), w),
  dF = row(mi('Δ'), mi('f'));
const cos = (x: string) => row('<mi>cos</mi>', FN, x),
  sin = (x: string) => row('<mi>sin</mi>', FN, x),
  log10 = (x: string) => row(sub('<mi>log</mi>', mn(10)), FN, x);
const sum = (from: string, to: string) => `<munderover><mo>&#x2211;</mo>${from}${to}</munderover>`;
const ejw = (x: string) => sup(mi('e'), row(MI, mi('j'), w, x));
const tx = (s: string) => `<mtext>${s}</mtext>`,
  /** 式の後ろの注記（「（ハン）」） */
  mtext = (s: string) => tx(`（${s}）`);

/* ---------- 動作原理（節ごとの本文。見出しと式の箱は Theory.astro） ---------- */
/** 本文の出典番号 */
const rf = (i: number) => `<a class="rf" href="#thy-r${i}">[${i}]</a>`;
const Np2 = row(N, PL, two);

/** FIR フィルタと直線位相 */
export const THY_FIR =
  `<p>FIR フィルタは、入力 ${inl(idx(mi('x'), n))} の今と過去 ${inl(Nm1)} サンプルの値に係数 ${inl(hS(k))} を掛けて足し、出力を求めるフィルタです。出力を戻さないので常に安定です${rf(1)}。</p>` +
  `<p>係数を中央で左右対称にすると、すべての周波数が ${inl(row(M, EQ, par(Nm1), SLASH, two))} サンプルだけ遅れる直線位相になります。</p>` +
  `<p>${inl(N)} が偶数のフィルタは ${inl(row(mi('z'), EQ, MI, one))} に零点を持ちます。${inl(row(mi('z'), EQ, MI, one))} は ${inl(row(fsS, SLASH, two))} に当たるので、HPF と BSF は ${inl(N)} を奇数にします。</p>`;

/** 仕様 */
export const THY_SPEC =
  '<p>仕様の 2 つの量を、振幅の許容値に直して使います。</p>' +
  '<dl class="syms">' +
  `<dt>${inl(Ap)}</dt><dd>通過域リップル</dd>` +
  `<dt>${inl(As)}</dt><dd>阻止域減衰</dd>` +
  `<dt>${inl(dp)}</dt><dd>通過域の許容</dd>` +
  `<dt>${inl(ds)}</dt><dd>阻止域の許容</dd>` +
  '</dl>';

/** 窓関数法 */
export const THY_WIN =
  `<p>窓関数法は、理想のフィルタのインパルス応答 ${inl(hdS(n))} を ${inl(N)} 点で切り出し、窓 ${inl(wS(n))} を掛けて両端をなだらかにします${rf(1)}。${inl(hdS(n))} は無限に続く sinc 関数です。</p>` +
  '<ol class="flow" aria-label="窓関数法の手順">' +
  `<li><b>理想の応答 ${inl(hdS(n))}</b><span>無限に続く sinc 関数</span></li>` +
  `<li><b>${inl(N)} 点で切り出す</b></li>` +
  `<li><b>窓 ${inl(wS(n))} を掛ける</b><span>両端をなだらかに</span></li>` +
  '</ol>' +
  '<p>窓の形で阻止域の深さと遷移帯域の幅が決まります。</p>';

/** カイザー窓 */
export const THY_KAISER = `<p>カイザー窓は ${inl(mi('β'))} で形を変えられます。Kaiser の式で、仕様から ${inl(mi('β'))} と ${inl(N)} を求めます${rf(2)}。</p>`;

/** ほかの窓 */
export const THY_WINS =
  `<p>ほかの窓の阻止域の減衰は、窓ごとにほぼ決まっています${rf(3)}。タップ数は遷移帯域幅から求めます。</p>` +
  '<div class="tt-w"><table class="tt">' +
  `<thead><tr><th>窓</th><th class="num">阻止域の減衰</th><th class="num">${inl(k)}</th></tr></thead><tbody>` +
  [
    ['矩形', 21, 0.9],
    ['ハン', 44, 3.1],
    ['ハミング', 53, 3.3],
    ['ブラックマン', 75, 5.5],
  ]
    .map(([t, a, c]) => `<tr><th>${t}</th><td class="num">${a} dB</td><td class="num">${c}</td></tr>`)
    .join('') +
  '</tbody></table></div>' +
  `<p>ハン窓とブラックマン窓は両端が 0 になります。そこで、${inl(Np2)} 点の窓の両端を除いた ${inl(N)} 点を使います。</p>`;

/** 等リップルと最小二乗 */
export const THY_OPT =
  `<p>等リップル（Parks–McClellan 法）は、重み付き誤差 ${inl(row(mi('E'), par(w)))} の最大値を最小にします${rf(4)}。</p>` +
  `<p>最適な解では、誤差の大きさが ${inl(row(mi('r'), PL, one))} 個以上の周波数で等しく、符号が交互に変わります。これを交代定理といいます。${inl(mi('r'))} は余弦の項の数です。</p>` +
  `<p>Remez の交換法は、その周波数の組を、誤差が最大になる周波数へ入れ替えながら求めます${rf(5)}。</p>` +
  `<p>最小二乗法は、誤差の二乗を帯域で積分した値を最小にします${rf(6)}。</p>` +
  '<ul class="tl">' +
  '<li>どちらも遷移帯域は誤差に数えない</li>' +
  `<li>仕様から求めるときは、仕様を満たす最小の ${inl(N)} を探す</li>` +
  '</ul>';

/** 実際の特性 */
export const THY_REAL =
  '<p>実際のリップル・減衰・遷移帯域幅は、係数に 0 を足して FFT した振幅から求めます。</p>' +
  '<p>遷移帯域幅は、通過域の許容を外れる周波数から、阻止域の許容を下回る周波数までの幅です。通過域の許容には、仕様と実際の大きい方を使います。</p>';

/** 同じ仕様の IIR フィルタ */
export const THY_IIR = `<p>同じ仕様の IIR フィルタの次数は、帯域の端を双一次変換で写したアナログの楕円フィルタとバタワースフィルタの次数の式で求めます${rf(7)}。</p>`;

/* ---------- 式 ---------- */
/** 畳み込み */
const EQ_CONV = blk(row(idx(mi('y'), n), EQ, sum(row(k, EQ, mn(0)), Nm1), hS(k), idx(mi('x'), row(n, MI, k))));
/** 直線位相と群遅延 */
const EQ_LIN =
  blk(row(hS(n), EQ, hS(row(Nm1, MI, n)))) +
  blk(
    row(
      mi('H'),
      par(sup(mi('e'), row(mi('j'), w))),
      EQ,
      mi('A'),
      par(w),
      ejw(M),
      mo(','),
      '<mspace width="1em"/>',
      M,
      EQ,
      frac(Nm1, two),
    ),
  ) +
  blk(row(mi('τ'), par(w), EQ, MI, frac(row(mi('d'), mi('θ')), row(mi('d'), w)), EQ, M));
/** 窓関数法 */
const EQ_WIN =
  blk(row(hS(n), EQ, hdS(n), DOT, wS(n))) +
  blk(
    row(
      hdS(n),
      EQ,
      frac(sin(par(row(sub(w, mi('c')), par(nmM)))), row(pi, par(nmM))),
      mo(','),
      '<mspace width="1em"/>',
      sub(w, mi('c')),
      EQ,
      frac(row(two, pi, sub(mi('f'), mi('c'))), fsS),
    ),
  );
const c2 = (num: string, den: string) => cos(frac(row(two, pi, num), den));
const c4 = (num: string, den: string) => cos(frac(row(mn(4), pi, num), den));
const np1 = par(row(n, PL, one)),
  Np1 = row(N, PL, one);
/** 窓（ハン・ハミング・ブラックマン・カイザー） */
const EQ_WINS =
  blk(row(mi('w'), EQ, mn(0.5), MI, mn(0.5), c2(np1, Np1), '<mspace width="1em"/>', mtext('ハン'))) +
  blk(row(mi('w'), EQ, mn(0.54), MI, mn(0.46), c2(n, Nm1), '<mspace width="1em"/>', mtext('ハミング'))) +
  blk(
    row(
      mi('w'),
      EQ,
      mn(0.42),
      MI,
      mn(0.5),
      c2(np1, Np1),
      PL,
      mn(0.08),
      c4(np1, Np1),
      '<mspace width="1em"/>',
      mtext('ブラックマン'),
    ),
  ) +
  blk(
    row(
      mi('w'),
      EQ,
      frac(
        row(sub(mi('I', true), mn(0)), par(row(mi('β'), sqrt(row(one, MI, sup(par(frac(nmM, M)), two)))))),
        row(sub(mi('I', true), mn(0)), par(mi('β'))),
      ),
      '<mspace width="1em"/>',
      mtext('カイザー'),
    ),
  );
/** 仕様の許容値 */
const EQ_TOL = blk(
  row(
    dp,
    EQ,
    frac(row(sup(mn(10), row(Ap, SLASH, mn(20))), MI, one), row(sup(mn(10), row(Ap, SLASH, mn(20))), PL, one)),
    mo(','),
    '<mspace width="1em"/>',
    ds,
    EQ,
    sup(mn(10), row(MI, As, SLASH, mn(20))),
  ),
);
/** Kaiser の式 */
const EQ_KAISER =
  blk(
    row(
      mi('A'),
      EQ,
      MI,
      mn(20),
      log10(row('<mi>min</mi>', par(row(dp, mo(','), ds)))),
      mo(','),
      '<mspace width="1em"/>',
      dW,
      EQ,
      frac(row(two, pi, dF), fsS),
    ),
  ) +
  blk(
    row(
      mi('β'),
      EQ,
      `<mrow><mo>{</mo><mtable columnalign="left">` +
        `<mtr><mtd>${row(mn(0.1102), par(row(mi('A'), MI, mn(8.7))))}</mtd><mtd>${row(mi('A'), mo('&gt;'), mn(50))}</mtd></mtr>` +
        `<mtr><mtd>${row(mn(0.5842), sup(par(row(mi('A'), MI, mn(21))), mn(0.4)), PL, mn(0.07886), par(row(mi('A'), MI, mn(21))))}</mtd><mtd>${row(mn(21), mo('≤'), mi('A'), mo('≤'), mn(50))}</mtd></mtr>` +
        `<mtr><mtd>${mn(0)}</mtd><mtd>${row(mi('A'), mo('&lt;'), mn(21))}</mtd></mtr>` +
        '</mtable></mrow>',
    ),
  ) +
  blk(row(Nm1, EQ, frac(row(mi('A'), MI, mn(8)), row(mn(2.285), dW))));
/** ほかの窓のタップ数 */
const EQ_WINN = blk(
  row(
    N,
    mo('≥'),
    frac(row(mi('k'), fsS), dF),
    mo(','),
    '<mspace width="1em"/>',
    mi('k'),
    EQ,
    mn(0.9),
    mo(','),
    mn(3.1),
    mo(','),
    mn(3.3),
    mo(','),
    mn(5.5),
    '<mspace width="0.5em"/>',
    mtext('矩形・ハン・ハミング・ブラックマン'),
  ),
);
/** 等リップルと最小二乗 */
const EQ_OPT =
  blk(row(mi('E'), par(w), EQ, mi('W'), par(w), '<mo>[</mo>', mi('D'), par(w), MI, mi('A'), par(w), '<mo>]</mo>')) +
  blk(
    row(
      mi('E'),
      par(sub(w, mi('i'))),
      EQ,
      sup(par(row(MI, one)), mi('i')),
      mi('δ'),
      mo(','),
      '<mspace width="1em"/>',
      mi('i'),
      EQ,
      mn(0),
      mo(','),
      one,
      mo(','),
      mo('…'),
      mo(','),
      mi('r'),
    ),
  ) +
  blk(
    row(
      Nm1,
      APPROX,
      frac(row(MI, mn(10), log10(par(row(dp, ds))), MI, mn(13)), row(mn(2.324), dW)),
      mo(','),
      '<mspace width="1em"/>',
      frac(sub(mi('W'), mi('s')), sub(mi('W'), mi('p'))),
      EQ,
      frac(dp, ds),
    ),
  ) +
  blk(
    row(
      '<mi>min</mi>',
      '<mspace width="0.3em"/>',
      sum(tx('帯域'), ''),
      mi('W'),
      '<mo>∫</mo>',
      sup(par(row(mi('A'), par(w), MI, mi('D'))), two),
      mi('d'),
      w,
    ),
  );
/** IIR フィルタの次数 */
const EQ_IIR =
  blk(
    row(
      sub(mi('n'), tx('楕円')),
      mo('≥'),
      frac(
        row(mi('K'), par(mi('k')), mi('K'), par(sqrt(row(one, MI, sup(sub(mi('k'), one), two))))),
        row(mi('K'), par(sqrt(row(one, MI, sup(mi('k'), two)))), mi('K'), par(sub(mi('k'), one))),
      ),
      mo(','),
      '<mspace width="1em"/>',
      sub(mi('n'), tx('バタワース')),
      mo('≥'),
      frac(
        row('<mi>log</mi>', FN, par(row(one, SLASH, sub(mi('k'), one)))),
        row('<mi>log</mi>', FN, par(row(one, SLASH, mi('k')))),
      ),
    ),
  ) +
  blk(
    row(
      mi('k'),
      EQ,
      frac(sub(mi('Ω'), mi('p')), sub(mi('Ω'), mi('s'))),
      mo(','),
      '<mspace width="0.6em"/>',
      sub(mi('k'), one),
      EQ,
      sqrt(frac(row(sup(mn(10), row(Ap, SLASH, mn(10))), MI, one), row(sup(mn(10), row(As, SLASH, mn(10))), MI, one))),
      mo(','),
      '<mspace width="0.6em"/>',
      mi('Ω'),
      EQ,
      '<mi>tan</mi>',
      FN,
      frac(row(pi, mi('f')), fsS),
    ),
  );

/** 節ごとの式の固定部分（代入した式は client.ts が #subst に入れる） */
export const EQS_FIR = EQ_CONV + EQ_LIN;
export const EQS_SPEC = EQ_TOL;
export const EQS_WIN = EQ_WIN + EQ_WINS;
export const EQS_KAISER = EQ_KAISER;
export const EQS_WINN = EQ_WINN;
export const EQS_OPT = EQ_OPT;
export const EQS_IIR = EQ_IIR;
