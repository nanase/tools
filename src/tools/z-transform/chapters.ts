/* z 変換のページの章（ビルド時に HTML にする） */
import { finishChapters, makeChapters, type Part } from '../../lib/chapter-html';

export const TOC: Part[] = [
  [
    '数列と z 平面',
    [
      ['q1', 'z を 1 つ決めると何が出てくるか'],
      ['q2', 'z 変換の和はどこで収まるか'],
      ['q3', '実数の数列に点が 2 つ要るのはなぜか'],
    ],
  ],
  [
    's 平面から z 平面へ',
    [
      ['q4', 'e<sup>st</sup> を標本化すると z はどこにあるか'],
      ['q5', '速く回る波は標本でどう見えるか'],
    ],
  ],
  [
    'デジタルフィルタと z',
    [
      ['q6', 'z⁻¹ を掛けると数列はどうなるか'],
      ['q7', '出力を戻すと何が起きるか'],
      ['q8', '単位円の上を歩くと何が見えるか'],
    ],
  ],
];
const C = makeChapters(TOC);
/** 問いの並び。番号は 1 から通しで振る */
export const QS = C.QS;
const part = C.part;
const qh = C.head;
const qnav = C.nav;

const raw = (): string => `

${part(0)}
<section class="ch" id="q1">
  ${qh('q1')}
  <div class="g2">
    <div class="pnl"><h3>z 平面</h3><div class="aux">● zⁿ</div><div class="scope"><div id="q1z"></div></div></div>
    <div class="pnl"><h3>数列の実部</h3><div class="aux">Re zⁿ</div><div class="scope"><div id="q1s"></div></div></div>
  </div>
  <div class="ctl">
    <button class="chip" data-p="0.88,36">円の内側</button><button class="chip" data-p="1,36">円の上</button><button class="chip" data-p="1.06,36">円の外側</button><button class="chip" data-p="0.85,0">正の実軸</button><button class="chip" data-p="0.9,180">負の実軸</button>
    <span class="sp"></span>
    <button class="tg" id="q1run" aria-pressed="true"><span class="led"></span>再生</button>
    <button class="tg" id="q1snd" aria-pressed="false"><span class="led"></span>音</button>
  </div>
  <p class="live" id="q1t"></p>
  <div class="eq">
    <math display="block"><mi>x</mi><mo>[</mo><mi>n</mi><mo>]</mo><mo>=</mo><msup data-k="zn"><mi>z</mi><mi>n</mi></msup><mo>=</mo><msup data-k="r"><mi>r</mi><mi>n</mi></msup><msup data-k="th"><mi>e</mi><mrow><mi>j</mi><mi>θ</mi><mi>n</mi></mrow></msup><mspace width="1.2em"/><mtext>Re</mtext><mspace width=".3em"/><msup><mi>z</mi><mi>n</mi></msup><mo>=</mo><msup data-k="r"><mi>r</mi><mi>n</mi></msup><mi>cos</mi><mrow data-k="th"><mi>θ</mi><mi>n</mi></mrow></math>
    <span class="zn">r = |z| は 1 標本ごとに掛かる倍率、θ = ∠z は 1 標本ごとに回る角度です。音は Re zⁿ を 1 秒 8000 標本で鳴らしたものです。聞き取れるよう、縮み方だけ 1/100 に緩めました。</span>
  </div>
  <p class="take">z は 1 標本ごとに掛ける数で、z を 1 つ決めると数列が 1 本決まります。z 平面の点はそのまま数列の名前になります。</p>
</section>

<section class="ch" id="q2">
  ${qh('q2')}
  <div class="g2">
    <div class="pnl"><h3>z 平面</h3><div class="aux"><span style="color:var(--ch1)">● a</span><span style="color:var(--ch2)">● z</span></div><div class="scope"><div id="q2z"></div></div></div>
    <div class="pnl"><h3>部分和</h3><div class="aux">Σ (a z⁻¹)ⁿ</div><div class="scope"><div id="q2s"></div></div></div>
  </div>
  <div class="ctl">
    <span class="lb">通った z の点</span><span class="lb" style="color:var(--ch2)">● 収束域</span><span class="lb" style="color:var(--warn)">● 収束域の外</span>
    <button class="chip" id="q2clr">消去</button>
    <span class="sp"></span>
    <button class="tg" id="q2roc" aria-pressed="false"><span class="led"></span>収束域</button>
  </div>
  <p class="live" id="q2t"></p>
  <div class="eq">
    <math display="block"><mi>X</mi><mo>(</mo><mi>z</mi><mo>)</mo><mo>=</mo><munderover><mo>∑</mo><mrow><mi>n</mi><mo>=</mo><mn>0</mn></mrow><mi>∞</mi></munderover><msup data-k="a"><mi>a</mi><mi>n</mi></msup><msup data-k="z"><mi>z</mi><mrow><mo>−</mo><mi>n</mi></mrow></msup><mo>=</mo><munderover><mo>∑</mo><mrow><mi>n</mi><mo>=</mo><mn>0</mn></mrow><mi>∞</mi></munderover><msup data-k="q"><mrow><mo>(</mo><mi>a</mi><msup><mi>z</mi><mrow><mo>−</mo><mn>1</mn></mrow></msup><mo>)</mo></mrow><mi>n</mi></msup><mo>=</mo><mfrac><mn>1</mn><mrow data-k="den"><mn>1</mn><mo>−</mo><mi>a</mi><msup><mi>z</mi><mrow><mo>−</mo><mn>1</mn></mrow></msup></mrow></mfrac><mo>=</mo><mfrac><mi>z</mi><mrow data-k="den"><mi>z</mi><mo>−</mo><mi>a</mi></mrow></mfrac></math>
    <span class="zn">問い 1 の z を a と呼び直し、z は和を求める点にしました。和は n ≥ 0 の項だけでとります（片側 z 変換）。和が収まるのは |a z⁻¹| &lt; 1 のときです。</span>
  </div>
  <p class="take">和が収まるのは半径 |a| の円の外側（|z| &gt; |a|、収束域）だけで、z を a に近づけるほど X(z) は大きくなります。この a が X(z) の極です。</p>
</section>

<section class="ch" id="q3">
  ${qh('q3')}
  <div class="g2">
    <div class="pnl"><h3>z 平面</h3><div class="aux"><span style="color:var(--ch1)">● aⁿ</span><span style="color:var(--ch2)">● āⁿ</span></div><div class="scope"><div id="q3z"></div></div></div>
    <div class="pnl"><h3>(aⁿ + āⁿ) / 2</h3><div class="scope"><div id="q3s"></div></div></div>
  </div>
  <div class="ctl"><span class="sp"></span><button class="tg" id="q3run" aria-pressed="true"><span class="led"></span>再生</button></div>
  <p class="live" id="q3t"></p>
  <div class="eq">
    <math display="block"><msup><mi>r</mi><mi>n</mi></msup><mi>cos</mi><mi>θ</mi><mi>n</mi><mo>=</mo><mfrac><mn>1</mn><mn>2</mn></mfrac><msup data-k="a"><mi>a</mi><mi>n</mi></msup><mo>+</mo><mfrac><mn>1</mn><mn>2</mn></mfrac><msup data-k="q"><mover><mi>a</mi><mo>¯</mo></mover><mi>n</mi></msup><mspace width="1.2em"/><mo>⟷</mo><mspace width="1.2em"/><mi>X</mi><mo>(</mo><mi>z</mi><mo>)</mo><mo>=</mo><mfrac><mrow><mn>1</mn><mo>/</mo><mn>2</mn></mrow><mrow data-k="a"><mn>1</mn><mo>−</mo><mi>a</mi><msup><mi>z</mi><mrow><mo>−</mo><mn>1</mn></mrow></msup></mrow></mfrac><mo>+</mo><mfrac><mrow><mn>1</mn><mo>/</mo><mn>2</mn></mrow><mrow data-k="q"><mn>1</mn><mo>−</mo><mover><mi>a</mi><mo>¯</mo></mover><msup><mi>z</mi><mrow><mo>−</mo><mn>1</mn></mrow></msup></mrow></mfrac></math>
    <span class="zn">ā は a の共役（実軸で折り返した点）です。極は a と ā の 2 つです。</span>
  </div>
  <p class="take">実数の振動 rⁿcos θn は逆向きに回る共役な 2 本の点の列を半分ずつ足したものです。極や零点が実軸を挟んで対になるのはこのためです。</p>
</section>

${part(1)}
<section class="ch" id="q4">
  ${qh('q4')}
  <div class="g3s">
    <div class="pnl"><h3>s 平面</h3><div class="scope"><div id="q4p"></div></div></div>
    <div class="pnl"><h3>z 平面</h3><div class="scope"><div id="q4z"></div></div></div>
    <div class="pnl wide"><h3>波と標本</h3><div class="aux"><span style="color:var(--ch2)">— Re e<sup>st</sup></span><span style="color:var(--ch1)">● 標本</span></div><div class="scope"><div id="q4w"></div></div></div>
  </div>
  <div class="ctl"><button class="chip" data-s="-0.1,0.25">ゆっくり減る</button><button class="chip" data-s="0,0.4">続く</button><button class="chip" data-s="0.08,0.3">膨らむ</button><button class="chip" data-s="-0.25,0">回らない</button></div>
  <p class="live" id="q4t"></p>
  <div class="eq">
    <math display="block"><mi>x</mi><mo>(</mo><mi>n</mi><mi>T</mi><mo>)</mo><mo>=</mo><msup><mi>e</mi><mrow><mi>s</mi><mi>n</mi><mi>T</mi></mrow></msup><mo>=</mo><msup><mrow><mo>(</mo><msup data-k="sT"><mi>e</mi><mrow><mi>s</mi><mi>T</mi></mrow></msup><mo>)</mo></mrow><mi>n</mi></msup><mo>=</mo><msup data-k="sT"><mi>z</mi><mi>n</mi></msup><mspace width="1.4em"/><mi>z</mi><mo>=</mo><msup><mi>e</mi><mrow><mi>s</mi><mi>T</mi></mrow></msup><mo>=</mo><msup data-k="sig"><mi>e</mi><mrow><mi>σ</mi><mi>T</mi></mrow></msup><mo>·</mo><msup data-k="om"><mi>e</mi><mrow><mi>j</mi><mi>ω</mi><mi>T</mi></mrow></msup></math>
    <span class="zn">s = σ + jω、T は標本化の間隔です。図の目盛りは T を 1 とした値です。s 平面は縦と横の目盛りの間隔が違います。</span>
  </div>
  <p class="take">標本の列は z = e<sup>sT</sup> の zⁿ になります。s 平面の虚軸は単位円に、左半分は円の内側に、右半分は円の外側に写ります。</p>
</section>

<section class="ch" id="q5">
  ${qh('q5')}
  <div class="g3w">
    <div class="pnl"><h3>s 平面</h3><div class="scope"><div id="q5p"></div></div></div>
    <div class="pnl wide"><h3>波と標本</h3><div class="aux"><span style="color:var(--ch2)">— f の波</span><span>‐‐ 同じ標本を通る波</span></div><div class="scope"><div id="q5w"></div></div></div>
    <div class="pnl"><h3>z 平面</h3><div class="aux">fs = 8000 Hz</div><div class="scope"><div id="q5z"></div></div></div>
  </div>
  <div class="ctl">
    <div class="rng"><span class="lb">f</span><input type="range" id="q5f" min="0" max="12000" step="50" value="1000" aria-label="周波数"><output id="q5o">1000 Hz</output></div>
  </div>
  <div class="ctl">
    <button class="chip" data-f="1000">1000</button><button class="chip" data-f="3000">3000</button><button class="chip" data-f="5000">5000</button><button class="chip" data-f="7000">7000</button><button class="chip" data-f="9000">9000</button><button class="chip" data-f="11000">11000</button><span class="lb">Hz</span>
    <span class="sp"></span>
    <div class="seg" id="q5src"><button data-m="c" aria-pressed="false">連続の波</button><button data-m="s" aria-pressed="true">標本の列</button></div>
    <button class="tg" id="q5snd" aria-pressed="false"><span class="led"></span>音</button>
  </div>
  <p class="live" id="q5t"></p>
  <div class="eq">
    <math display="block"><mi>z</mi><mo>=</mo><msup><mi>e</mi><mrow><mi>j</mi><mi>ω</mi><mi>T</mi></mrow></msup><mo>=</mo><msup><mi>e</mi><mrow><mi>j</mi><mn>2</mn><mi>π</mi><mi data-k="f">f</mi><mo>/</mo><msub><mi>f</mi><mi>s</mi></msub></mrow></msup><mspace width="1.4em"/><msup><mi>e</mi><mrow><mi>j</mi><mn>2</mn><mi>π</mi><mo>(</mo><mi>f</mi><mo>+</mo><msub><mi>f</mi><mi>s</mi></msub><mo>)</mo><mo>/</mo><msub><mi>f</mi><mi>s</mi></msub></mrow></msup><mo>=</mo><msup><mi>e</mi><mrow><mi>j</mi><mn>2</mn><mi>π</mi><mi>f</mi><mo>/</mo><msub><mi>f</mi><mi>s</mi></msub></mrow></msup><mo>·</mo><msup data-k="T"><mi>e</mi><mrow><mi>j</mi><mn>2</mn><mi>π</mi></mrow></msup><mo>=</mo><msup><mi>e</mi><mrow><mi>j</mi><mn>2</mn><mi>π</mi><mi>f</mi><mo>/</mo><msub><mi>f</mi><mi>s</mi></msub></mrow></msup></math>
    <span class="zn">fs = 1/T はサンプリング周波数、ω = 2πf です。cos の波は e<sup>jωt</sup> と e<sup>−jωt</sup> を半分ずつ足したものなので、s も z も上下の 2 点になります（問い 3）。標本の列の音は窓付き sinc で連続の音に戻して鳴らします。</span>
  </div>
  <p class="take">f が fs 増えるごとに z は単位円を 1 周して同じ点に戻ります。単位円は s 平面の虚軸を巻き付けたものです。</p>
</section>

${part(2)}
<section class="ch" id="q6">
  ${qh('q6')}
  <div class="pnl"><h3>数列と z の次数</h3><div class="aux">● x[n]　○ 掛ける前</div><div class="scope"><div id="q6s"></div></div></div>
  <p class="eqline" id="q6p"></p>
  <div class="ctl">
    <button class="tg" id="q6m">× z⁻¹</button><button class="tg" id="q6d">× z</button><button class="chip" id="q6r">元に戻す</button>
  </div>
  <p class="live" id="q6t"></p>
  <div class="eq">
    <math display="block"><msup data-k="d1"><mi>z</mi><mrow><mo>−</mo><mn>1</mn></mrow></msup><mi>X</mi><mo>(</mo><mi>z</mi><mo>)</mo><mo>=</mo><munder><mo>∑</mo><mi>n</mi></munder><mi>x</mi><mo>[</mo><mi>n</mi><mo>]</mo><msup data-k="d1"><mi>z</mi><mrow><mo>−</mo><mo>(</mo><mi>n</mi><mo>+</mo><mn>1</mn><mo>)</mo></mrow></msup><mo>=</mo><munder><mo>∑</mo><mi>n</mi></munder><mi>x</mi><mo>[</mo><mrow data-k="d1"><mi>n</mi><mo>−</mo><mn>1</mn></mrow><mo>]</mo><msup><mi>z</mi><mrow><mo>−</mo><mi>n</mi></mrow></msup></math>
    <span class="zn">z⁻ⁿ の係数が n 番目の値です。z⁻¹ を掛けると全部の項の次数が 1 つ上がります。</span>
  </div>
  <p class="take">z⁻¹ を掛けると全部の項の次数が 1 つ上がり、数列は 1 標本遅れます。z⁻¹ は 1 標本の遅延素子です。</p>
</section>

<section class="ch" id="q7">
  ${qh('q7')}
  <div class="g3">
    <div class="pnl"><h3>ブロック図</h3><div class="scope"><div id="q7d"></div></div></div>
    <div class="pnl"><h3>インパルス応答</h3><div class="aux" style="color:var(--ch2)">● y[n]</div><div class="scope"><div id="q7y"></div></div></div>
    <div class="pnl"><h3>z 平面</h3><div class="aux">× 極</div><div class="scope"><div id="q7z"></div></div></div>
  </div>
  <div class="ctl">
    <div class="rng"><span class="lb">a</span><input type="range" id="q7a" min="-1.2" max="1.2" step="0.05" value="0.8" aria-label="a"><output id="q7o">0.80</output></div>
    <span class="sp"></span>
    <button class="tg" id="q7snd" aria-pressed="false"><span class="led"></span>ノイズで試聴</button>
  </div>
  <p class="live" id="q7t"></p>
  <div class="eq">
    <math display="block"><mi>y</mi><mo>[</mo><mi>n</mi><mo>]</mo><mo>=</mo><mi>x</mi><mo>[</mo><mi>n</mi><mo>]</mo><mo>+</mo><mrow data-k="fb"><mi>a</mi><mi>y</mi><mo>[</mo><mi>n</mi><mo>−</mo><mn>1</mn><mo>]</mo></mrow><mspace width="1em"/><mo>⟶</mo><mspace width="1em"/><mi>Y</mi><mo>=</mo><mi>X</mi><mo>+</mo><mrow data-k="fb"><mi>a</mi><msup><mi>z</mi><mrow><mo>−</mo><mn>1</mn></mrow></msup><mi>Y</mi></mrow><mspace width="1em"/><mo>⟶</mo><mspace width="1em"/><mi>H</mi><mo>(</mo><mi>z</mi><mo>)</mo><mo>=</mo><mfrac><mn>1</mn><mrow data-k="den"><mn>1</mn><mo>−</mo><mi>a</mi><msup><mi>z</mi><mrow><mo>−</mo><mn>1</mn></mrow></msup></mrow></mfrac><mo>=</mo><mfrac><mi>z</mi><mrow data-k="den"><mi>z</mi><mo>−</mo><mi>a</mi></mrow></mfrac></math>
    <span class="zn">H(z) は伝達関数です。分母が 0 になる z = a が極です。音はノイズを 1 秒 8000 標本でこの式に通し、膨らむときは上限で止めます。</span>
  </div>
  <p class="take">出力を戻すと、1 つのインパルスが問い 2 の数列 aⁿ になります。a は伝達関数の極で、|a| &lt; 1 なら列は消えていきます。</p>
</section>

<section class="ch" id="q8">
  ${qh('q8')}
  <div class="g2">
    <div class="pnl"><h3>z 平面</h3><div class="aux" style="color:var(--ch1)">× 極</div><div class="scope"><div id="q8z"></div></div></div>
    <div class="pnl"><h3>周波数特性</h3><div class="aux"><span>|H(e<sup>jω</sup>)|</span></div><div class="scope"><div id="q8f"></div></div></div>
  </div>
  <div class="ctl">
    <button class="tg" id="q8run" aria-pressed="true"><span class="led"></span>再生</button>
    <span class="sp"></span>
    <button class="tg" id="q8sw" aria-pressed="false"><span class="led"></span>掃引で試聴</button>
  </div>
  <p class="live" id="q8t"></p>
  <div class="eq">
    <math display="block"><mo>|</mo><mi>H</mi><mo>(</mo><msup><mi>e</mi><mrow><mi>j</mi><mi>ω</mi></mrow></msup><mo>)</mo><mo>|</mo><mo>=</mo><mfrac><mn>1</mn><mrow data-k="den"><mo>|</mo><msup><mi>e</mi><mrow><mi>j</mi><mi>ω</mi></mrow></msup><mo>−</mo><mi>p</mi><mo>|</mo><mspace width=".2em"/><mo>|</mo><msup><mi>e</mi><mrow><mi>j</mi><mi>ω</mi></mrow></msup><mo>−</mo><mover><mi>p</mi><mo>¯</mo></mover><mo>|</mo></mrow></mfrac><mspace width="1.2em"/><mi>H</mi><mo>(</mo><mi>z</mi><mo>)</mo><mo>=</mo><mfrac><mn>1</mn><mrow data-k="den"><mo>(</mo><mn>1</mn><mo>−</mo><mi>p</mi><msup><mi>z</mi><mrow><mo>−</mo><mn>1</mn></mrow></msup><mo>)</mo><mo>(</mo><mn>1</mn><mo>−</mo><mover><mi>p</mi><mo>¯</mo></mover><msup><mi>z</mi><mrow><mo>−</mo><mn>1</mn></mrow></msup><mo>)</mo></mrow></mfrac></math>
    <span class="zn">p と p̄ は極です。ω は単位円の上の角で、問い 5 の ωT と同じ量です。音は 1 秒 8000 標本でこの式に通します。零点も置いた計算は「<a class="lnk" href="../pole-zero/">極と零点</a>」のページで試せます。</span>
  </div>
  <p class="take">単位円の上を歩くことは周波数を上げることで、極の近くを通ると距離が縮んで |H| に山ができます。</p>
</section>
${qnav()}`;

/** 章の HTML */
export const chaptersHtml = (): string => finishChapters(raw());
