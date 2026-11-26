/* ラプラス変換のページの章（ビルド時に HTML にする）。形は z 変換のページと同じ（lib/chapter-html.ts） */
import { finishChapters, makeChapters, type Part } from '../../lib/chapter-html';

export const TOC: Part[] = [
  [
    's 平面と波',
    [
      ['q1', 's 平面の 1 点はどんな波を表すのか'],
      ['q2', 'なぜ s は複素数なのか'],
      ['q3', '実数の波はなぜ 2 つの点で表すのか'],
    ],
  ],
  [
    '伝達関数と s 平面',
    [
      ['q4', 'この波で揺れる系は s 平面でどう見えるのか'],
      ['q5', '虚軸で切った断面は何を表すのか'],
      ['q6', '極が右半分へ出るとどうなるのか'],
    ],
  ],
];
const C = makeChapters(TOC);
const { part, head: qh, nav: qnav } = C;

/* 式の部品（MathML） */
const eST = '<msup><mi>e</mi><mrow><mi>s</mi><mi>t</mi></mrow></msup>';
const eSgT = '<msup><mi>e</mi><mrow><mi>σ</mi><mi>t</mi></mrow></msup>';
const pTerm = (sg: string) =>
  `<mo>(</mo><mi>s</mi><mo>−</mo><mo>(</mo><mi>σ</mi><mo>${sg}</mo><mi>j</mi><mi>ω</mi><mo>)</mo><mo>)</mo>`;
const p2 = '<msup><mrow><mo>|</mo><mi>p</mi><mo>|</mo></mrow><mn>2</mn></msup>';
const run = (id: string) => `<button class="tg" id="${id}" aria-pressed="true"><span class="led"></span>再生</button>`;
/** s 平面の canvas。点はドラッグか矢印キーで動かす */
const sCv = (label: string) =>
  `<canvas class="sp" tabindex="0" aria-label="${label}。ドラッグか矢印キーで移動"></canvas>`;
/* 式の中の値は数字で高さが変わるので、mpadded で高さを決めて行を動かさない */
/** 今の値が入る文。最も長い文の高さを先に取る（design/page.md の .hh） */
const live = (id: string, ph: string) => `<p class="live hh" id="${id}" data-ph="${ph}"></p>`;

const raw = (): string => `

${part(0)}
<section class="ch" id="q1">
  ${qh('q1')}
  <div class="g2">
    <div class="pnl"><h3>s 平面</h3><div class="aux"><span style="color:var(--ch1)">◎ s</span></div><div class="scope">${sCv('s 平面の点 s')}</div></div>
    <div class="pnl"><h3>波</h3><div class="aux"><span style="color:var(--ch2)">— Re e<sup>st</sup></span><span>‐‐ ±e<sup>σt</sup></span></div><div class="scope"><canvas role="img" aria-label="波 Re e^st の時間変化"></canvas></div></div>
  </div>
  <div class="ctl">
    <button class="chip" data-p="-0.4,6.28">減衰振動</button><button class="chip" data-p="0,6.28">持続振動</button><button class="chip" data-p="0.3,6.28">増大振動</button><button class="chip" data-p="-0.8,0">実軸の上</button>
    <span class="sp"></span>
    ${run('q1run')}
  </div>
  ${live('q1t', 'σ = −0.30 なので 1 秒ごとに 0.74 倍に膨らみます。ω = −6.28 rad/s なので 1 秒に 1.00 回まわります。ω が負だと逆向きに回りますが、実部の波は ω が正のときと同じです。')}
  <div class="eq">
    <math display="block"><mtext>Re</mtext><mspace width=".3em"/><mrow data-k="s">${eST}</mrow><mo>=</mo><mrow data-k="env">${eSgT}</mrow><mo>·</mo><mrow data-k="rot"><mi>cos</mi><mi>ω</mi><mi>t</mi></mrow><mspace width="1.2em"/><mi>s</mi><mo>=</mo><mi>σ</mi><mo>+</mo><mi>j</mi><mi>ω</mi><mo>=</mo><mpadded height=".72em" depth=".22em"><mn id="lap-v-sg">−0.30</mn></mpadded><mo id="lap-v-pm">+</mo><mpadded height=".72em" depth=".22em"><mn id="lap-v-om">6.28</mn></mpadded><mi>j</mi></math>
    <span class="zn">σ は 1 秒あたりの縮み方、ω は 1 秒あたりに回る角度（rad/s）です。点線の下線の項に指を載せると、図の同じ所が光ります。</span>
  </div>
  <p class="take">s は波 e<sup>st</sup> の名前です。横の位置 σ が縮み方を、縦の位置 ω が回る速さを決めます。</p>
</section>

<section class="ch" id="q2">
  ${qh('q2')}
  <div class="g2">
    <div class="pnl"><h3>s 平面</h3><div class="aux"><span style="color:var(--ch1)">◎ s</span></div><div class="scope">${sCv('s 平面の点 s')}</div></div>
    <div class="pnl"><h3>回る矢印とその実部</h3><div class="aux"><span style="color:var(--ch1)">→ e<sup>st</sup></span><span style="color:var(--ch2)">— 実部</span></div><div class="scope"><canvas role="img" aria-label="回る矢印 e^st と、その実部が下へ描く波"></canvas></div></div>
  </div>
  <div class="ctl"><span class="sp"></span>${run('q2run')}</div>
  ${live('q2t', '矢印は反時計回りに 1 秒 1.00 回まわりながら、長さが 1 秒ごとに 0.74 倍になります。実部の波は、矢印の先を実軸に落とした位置です。')}
  <div class="eq">
    <math display="block">${eST}<mo>=</mo><msup><mi>e</mi><mrow><mo>(</mo><mi>σ</mi><mo>+</mo><mi>j</mi><mi>ω</mi><mo>)</mo><mi>t</mi></mrow></msup><mo>=</mo><mrow data-k="env">${eSgT}</mrow><mo>·</mo><mrow data-k="rot"><msup><mi>e</mi><mrow><mi>j</mi><mi>ω</mi><mi>t</mi></mrow></msup></mrow><mspace width="1.2em"/><mrow data-k="re"><mtext>Re</mtext><mspace width=".3em"/>${eST}</mrow><mo>=</mo>${eSgT}<mi>cos</mi><mi>ω</mi><mi>t</mi></math>
    <span class="zn">e<sup>σt</sup> は矢印の長さ、e<sup>jωt</sup> は矢印の向きです。下の波は、上で回る矢印の先を実軸に落とした位置を、時間の順に下へ並べたものです。</span>
  </div>
  <p class="take">縮む速さ σ と回る速さ ω を 1 つの数にまとめたものが複素数 s です。</p>
</section>

<section class="ch" id="q3">
  ${qh('q3')}
  <div class="g2">
    <div class="pnl"><h3>s 平面</h3><div class="aux"><span style="color:var(--ch1)">◎ s</span><span style="color:var(--ch2)">◎ s̄</span></div><div class="scope">${sCv('s 平面の点 s と共役 s̄')}</div></div>
    <div class="pnl"><h3>2 本の矢印の和</h3><div class="aux"><span style="color:var(--ch1)">→ ½e<sup>st</sup></span><span style="color:var(--ch2)">→ ½e<sup>s̄t</sup></span></div><div class="scope"><canvas role="img" aria-label="逆向きに回る 2 本の矢印と、その和"></canvas></div></div>
  </div>
  <div class="ctl"><span class="sp"></span>${run('q3run')}</div>
  ${live('q3t', '2 本の矢印は同じ速さで逆向きに回ります。虚部が打ち消し合い、和はいつも実軸の上にあります。')}
  <div class="eq">
    <math display="block">${eSgT}<mi>cos</mi><mi>ω</mi><mi>t</mi><mo>=</mo><mrow data-k="a"><mfrac><mn>1</mn><mn>2</mn></mfrac>${eST}</mrow><mo>+</mo><mrow data-k="b"><mfrac><mn>1</mn><mn>2</mn></mfrac><msup><mi>e</mi><mrow><mover><mi>s</mi><mo>¯</mo></mover><mi>t</mi></mrow></msup></mrow><mspace width="1.2em"/><mover><mi>s</mi><mo>¯</mo></mover><mo>=</mo><mi>σ</mi><mo>−</mo><mi>j</mi><mi>ω</mi></math>
    <span class="zn">s̄ は s の共役で、虚部の符号を反転した点（実軸で折り返した点）です。</span>
  </div>
  <p class="take">実数の波は s と共役 s̄ の 2 点で 1 組になります。実数の信号の極が実軸を挟んで対で現れるのはこのためです。</p>
</section>

${part(1)}
<section class="ch" id="q4">
  ${qh('q4')}
  <div class="g3w">
    <div class="pnl"><h3>s 平面</h3><div class="aux"><span style="color:var(--ch1)">× 極</span></div><div class="scope">${sCv('s 平面の極')}</div></div>
    <div class="pnl wide"><h3>s 平面の上の |H(s)|</h3><div class="aux">高さは対数</div><div class="scope"><canvas class="sf" tabindex="0" aria-label="s 平面の上の |H(s)| の曲面。横にドラッグか矢印キーで回転"></canvas></div></div>
  </div>
  ${live('q4t', '極は −0.30 ± 6.28j です。インパルスを入れると、系は 1 秒に 1.00 回振れながら、1 秒ごとに 0.74 倍に膨らみます。')}
  <div class="eq">
    <math display="block"><mi>H</mi><mo>(</mo><mi>s</mi><mo>)</mo><mo>=</mo><mfrac><mrow>${p2}</mrow><mrow data-k="den">${pTerm('+')}${pTerm('−')}</mrow></mfrac><mspace width="1.2em"/><mi>h</mi><mo>(</mo><mi>t</mi><mo>)</mo><mo>=</mo><mfrac><mrow>${p2}</mrow><mi>ω</mi></mfrac>${eSgT}<mi>sin</mi><mi>ω</mi><mi>t</mi></math>
    <span class="zn">H(s) は伝達関数、h(t) はインパルス応答です。|p|² は ω = 0 で大きさを 1 にそろえる係数です。曲面の高さは 20 log₁₀|H| で、上下の端で打ち切っています。</span>
  </div>
  <p class="take">系の極は、系が自分から出す波の s です。曲面はその真上で突き上がります。</p>
</section>

<section class="ch" id="q5">
  ${qh('q5')}
  <div class="g3w">
    <div class="pnl"><h3>s 平面</h3><div class="aux"><span style="color:var(--ch1)">× 極</span></div><div class="scope">${sCv('s 平面の極')}</div></div>
    <div class="pnl wide"><h3>σ &gt; 0 を切り落とした曲面</h3><div class="scope"><canvas class="sf" tabindex="0" aria-label="虚軸で切った |H(s)| の曲面。横にドラッグか矢印キーで回転"></canvas></div></div>
    <div class="pnl"><h3>断面</h3><div class="aux"><span style="color:var(--ch2)">— |H(jω)|</span></div><div class="scope"><canvas role="img" aria-label="虚軸の断面 |H(jω)|"></canvas></div></div>
  </div>
  ${live('q5t', '断面の山は ω ≈ ±10.0 rad/s にあり、問い 1 の波の回る速さと同じです。極は虚軸から 0.30 離れています。離れると山は低くなだらかになります。')}
  <div class="eq">
    <math display="block"><mrow data-k="jw"><mi>H</mi><mo>(</mo><mi>j</mi><mi>ω</mi><mo>)</mo></mrow><mo>=</mo><msubsup><mo>∫</mo><mn>0</mn><mi>∞</mi></msubsup><mi>h</mi><mo>(</mo><mi>t</mi><mo>)</mo><msup><mi>e</mi><mrow><mo>−</mo><mi>j</mi><mi>ω</mi><mi>t</mi></mrow></msup><mi>d</mi><mi>t</mi></math>
    <span class="zn">ラプラス変換の式に s = jω を入れるとフーリエ変換の式になります。h(t) のフーリエ変換が周波数特性です。</span>
  </div>
  <p class="take">周波数特性は、伝達関数の曲面を虚軸で切った断面です。極が虚軸に近いほど山は高く細くなります。</p>
</section>

<section class="ch" id="q6">
  ${qh('q6')}
  <div class="g2">
    <div class="pnl"><h3>s 平面と収束域</h3><div class="aux"><span style="color:var(--ch1)">× 極</span></div><div class="scope">${sCv('s 平面の極と収束域')}</div></div>
    <div class="pnl"><h3>インパルス応答と面積</h3><div class="aux"><span style="color:var(--ch2)">— h(t)</span><span>▨ |h(t)| の面積</span></div><div class="scope"><canvas role="img" aria-label="インパルス応答 h(t) と、0 から t までの |h(t)| の面積"></canvas></div></div>
  </div>
  <div class="ctl">
    <button class="chip" data-p6="-0.3">左半分</button><button class="chip" data-p6="0">虚軸の上</button><button class="chip" data-p6="0.2">右半分</button>
    <span class="sp"></span>
    ${run('q6run')}
  </div>
  ${live('q6t', '極の実部 −0.30 < 0 なので、収束域 Re s > −0.30 に虚軸が入ります。面積は約 20.00 で止まり、フーリエ変換の積分は収束します。')}
  <div class="eq">
    <math display="block"><mrow data-k="roc"><mtext>収束域</mtext><mo>:</mo><mtext>Re</mtext><mspace width=".3em"/><mi>s</mi><mo>&gt;</mo><mpadded height=".72em" depth=".22em"><mn id="lap-v-roc">−0.30</mn></mpadded></mrow><mspace width="1.2em"/><msubsup><mo>∫</mo><mn>0</mn><mi>∞</mi></msubsup><mo>|</mo><mi>h</mi><mo>(</mo><mi>t</mi><mo>)</mo><mo>|</mo><mi>d</mi><mi>t</mi><mo>&lt;</mo><mi>∞</mi></math>
    <span class="zn">片側ラプラス変換（t ≥ 0 だけを積分）の収束域は、一番右の極より右の半平面です。右の式が成り立てば、フーリエ変換の積分も収束します。図は 0〜10 秒の面積で、文の値は h(t) が 1 万分の 1 に縮むまでの和です。</span>
  </div>
  <p class="take">虚軸が収束域に入るのは、極がすべて左半分にあるときだけです。そのときだけ断面がフーリエ変換になります。</p>
</section>
${qnav()}`;

/** 章の HTML */
export const chaptersHtml = (): string => finishChapters(raw());
