/** 双2次フィルタのページの入口: 入力 → 係数・特性の計算 → 結果・グラフ・係数・代入式、精密計算（Worker）、試聴（Web Audio） */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { prevOf } from '../../lib/eseries';
import { fmt, fmtR, ro } from '../../lib/format';
import { ParamGroup } from '../../lib/param';
import { DV, SH, SW } from '../../lib/scope';
import { storeToggle } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { type Analysis, analyze, coef, type FilterParams, type Summary } from './filter';
import { hzMath, substHtml } from './math';
import { fcPatch, hzT, type Key, L0, LENS, PARAMS, sup, type TypeDef, typeOf } from './params';
import { type FrPlot, fixed, frIndex, frPlot, IH, type ImpPlot, impPlot, LV_HOT, lvX, sig } from './plot';
import type { Job, Reply } from './worker';

const html = (id: string, s: string) => {
  $(id).innerHTML = s;
};
const txt = (id: string, s: string) => {
  $(id).textContent = s;
};
initToolPage();

/* ---------- 知らせ ---------- */
let toastT: ReturnType<typeof setTimeout> | undefined;
function toast(msg: string): void {
  const t = $('#toast');
  t.textContent = msg;
  delete t.dataset.off;
  clearTimeout(toastT);
  toastT = setTimeout(() => {
    t.dataset.off = '';
  }, 2600);
}

/* ---------- 状態 ---------- */
let type: TypeDef = typeOf($('#p-type [aria-pressed="true"]').dataset.v ?? '');
/** 最後に計算した結果（グラフの元） */
let S: { N: number; fs: number; fc: number; res: Analysis } | null = null;
/** 計算のたびに増やす。精密計算の結果が今の入力のものかを見分ける */
let ver = 0;
/** 計算結果の枠に出ている結果の N */
let lastN = 0;
let g: ParamGroup<Key> | null = null;
const val = (k: Key): number => g?.get(k) ?? NaN;
const prm = (): FilterParams => ({ t: type.v, fs: val('fs'), fc: val('fc'), q: val('q'), g: val('g') });

/* ---------- 計算と描画 ---------- */
const dBh = (v: number) => `${fixed(v, 3)}<span class="u">dB</span>`;
function showResults(r: Summary, N: number): void {
  html('#o-afc', dBh(r.aFc));
  html('#o-max', dBh(r.max));
  html('#o-maxf', ro(r.maxF, 'Hz', 5));
  html('#o-min', dBh(r.min));
  html('#o-minf', ro(r.minF, 'Hz', 5));
  html('#o-sum', fixed(r.sum, 6));
  txt('#o-n', N >= 65536 ? `${N}（2${sup(Math.log2(N))}）` : String(N));
  txt('#o-df', `Δf = fs/N = ${fmtR(val('fs') / N, 'Hz', 5)}`);
}

function compute(): void {
  const p = prm(),
    N = val('n');
  const res = analyze(p, N, true);
  S = { N, fs: p.fs, fc: p.fc, res };
  ver++;
  lastN = N;
  showResults(res, N);
  renderCoef();
  renderBlk();
  drawFr();
  drawImp();
  renderSubst();
  txt('#mt', type.ab);
  txt('#mfc', fmt(p.fc, 'Hz'));
  txt('#mq2', String(Number(p.q.toPrecision(4))));
  txt('#ma', `${fixed(res.aFc, 2)} dB`);
  setIIR();
  syncPrec();
}

/* ---------- 係数・ブロック図 ---------- */
let normOn = true;
function renderCoef(): void {
  if (!S) return;
  const co = S.res.co,
    a0 = co[3],
    v = normOn ? co.map((c) => c / a0) : co;
  ['b0', 'b1', 'b2', 'a0', 'a1', 'a2'].forEach((id, i) => {
    txt(`#c-${id}`, fixed(v[i], 9));
  });
}
/* ブロック図と係数は同じものの 2 つの表し方。既定はブロック図 */
new Choice($('#bview'), (v) => {
  $('#v-blk').hidden = v !== 'blk';
  $('#v-coef').hidden = v !== 'coef';
});
new Choice($('#cmode'), (v) => {
  normOn = v === '1';
  html('#hz', hzMath(normOn));
  renderCoef();
});
function renderBlk(): void {
  if (!S) return;
  const nb = S.res.nb;
  for (const i of [0, 1, 2]) txt(`#bd-b${i}`, fixed(nb[i], 6));
  txt('#bd-a1', fixed(nb[3], 6));
  txt('#bd-a2', fixed(nb[4], 6));
}

/* ---------- 表示窓の共通 ---------- */
/** ポインタの位置を SVG の座標（x）にする */
function svgX(svg: SVGSVGElement, ev: PointerEvent): number | null {
  const m = svg.getScreenCTM();
  return m ? new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse()).x : null;
}
/** 表示窓の上でカーソルを動かす。x が範囲外なら null を渡す */
function bindCursor(svg: SVGSVGElement, at: (x: number | null) => void): void {
  const move = (e: PointerEvent) => {
    const x = svgX(svg, e);
    if (x != null) at(x);
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', () => at(null));
}
/** CH の表示の切替 */
function bindChannel(btn: HTMLElement, scope: HTMLElement, cls: string): void {
  btn.addEventListener('click', () => {
    const on = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(on));
    scope.classList.toggle(cls, !on);
  });
}

/* ---------- 周波数特性 ---------- */
let frK: number | null = null,
  FR: FrPlot | null = null;
function drawFr(): void {
  if (!S) return;
  const { N, fs, fc, res } = S;
  FR = frPlot({ N, fs, fc, mag: res.mag, ph: res.ph, max: res.max, bot: val('bot') });
  html('#fr-grid', FR.grid);
  $('#fr-t1').setAttribute('d', FR.mag);
  $('#fr-t2').setAttribute('d', FR.phase);
  $('#fr-fc').setAttribute('d', FR.fcLine);
  html('#fr-axes', FR.axes);
  txt('#fr-vd', `${FR.dv} dB`);
  txt('#fr-x', `${fmt(FR.f0, 'Hz', 3)} – ${fmt(FR.f1, 'Hz', 3)}`);
  txt('#fr-aux', `N = ${N} の FFT`);
  frCursor();
  $('#fr-svg').setAttribute(
    'aria-label',
    `周波数特性。横軸は ${fmt(FR.f0, 'Hz', 3)} から ${fmt(FR.f1, 'Hz', 3)} の対数、縦軸は振幅 ${FR.dv} dB/div と位相 60°/div。fc ${fmt(fc, 'Hz')} での振幅 ${fixed(res.aFc, 2)} dB、最大 ${fixed(res.max, 2)} dB、最小 ${fixed(res.min, 2)} dB。`,
  );
}
function frCursor(): void {
  if (!S || !FR) return;
  const { N, fs, fc, res } = S,
    k = frIndex(frK ?? fc, fs, N);
  $('#fr-cur').setAttribute('d', frK == null ? '' : `M${FR.X((k * fs) / N).toFixed(1)} 0V${SH}`);
  html(
    '#fr-rd',
    `CUR <b>${fmtR((k * fs) / N, 'Hz', 4)}</b> <b>${fixed(res.mag[k], 2)}</b> dB <b>${fixed(res.ph[k], 1)}</b>°`,
  );
}
bindCursor($('#fr-svg'), (x) => {
  if (!FR) return;
  frK = x == null || x < 0 || x > SW ? null : FR.F(x);
  frCursor();
});
bindChannel($('#ch1f'), $('#fr-scope'), 'hide1');
bindChannel($('#ch2f'), $('#fr-scope'), 'hide2');
storeToggle($('#ch1f'));
storeToggle($('#ch2f'));

/* ---------- インパルス応答 ---------- */
let imK: number | null = null,
  IM: ImpPlot | null = null,
  /** 表示長 L（選択肢） */
  len = L0;
const len$ = new Choice($('#p-len'), (v) => {
  len = Number(v);
  len$.note('');
  drawImp();
});
/** 解析長 N を超える表示長は選べない。超えていたら N にする */
function limitLen(N: number): void {
  for (const L of LENS) len$.disable(String(L), L > N);
  if (len > N) {
    len = N;
    len$.set(String(N));
    len$.note(`N に合わせて ${N} にしました`, 'er');
  }
}
function drawImp(): void {
  if (!S) return;
  const { N, res } = S;
  IM = impPlot(res.h, N, len);
  const st = $('#im-st');
  st.setAttribute('d', IM.stem);
  st.style.strokeWidth = String(IM.width);
  html('#im-dots', IM.dots);
  $('#im-z').setAttribute('d', IM.zero);
  html('#im-axes', IM.axes);
  txt('#im-vd', String(IM.vd));
  txt('#im-hd', String(IM.d));
  imCursor();
  $('#im-svg').setAttribute(
    'aria-label',
    `インパルス応答。n = 0 から ${Math.min(len, N)} まで、横軸 ${IM.d} サンプル/div、縦軸 ${IM.vd}/div。h[0] = ${fixed(res.h[0], 6)}。`,
  );
}
function imCursor(): void {
  if (!S || !IM) return;
  const h = S.res.h,
    k = Math.max(0, Math.min(IM.nEnd - 1, imK ?? 0));
  $('#im-cur').setAttribute('d', imK == null ? '' : `M${IM.X(k).toFixed(1)} 0V${IH}`);
  html('#im-rd', `CUR <i>n</i> = <b>${k}</b> <i>h</i> = <b>${sig(h[k], 6, true)}</b>`);
}
bindCursor($('#im-svg'), (x) => {
  if (!IM) return;
  imK = x == null || x < DV - 4 || x > SW ? null : Math.round(((x - DV) / DV) * IM.d);
  imCursor();
});

/* ---------- 動作原理と式 ---------- */
function renderSubst(): void {
  html('#subst', substHtml(val('fs'), val('fc'), val('q'), val('g'), !!type.g));
}

/* ---------- 精密計算（Web Worker） ---------- */
const precBtn = $<HTMLButtonElement>('#precBtn');
let worker: Worker | null = null,
  job: (Job & { ver: number }) | null = null;
function mkWorker(): Worker {
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<Reply>) => {
    if (job && e.data.id === job.id) done(job, e.data.r);
  };
  w.onerror = (e) => {
    e.preventDefault();
    if (job) done(job, null);
    worker = null;
  };
  return w;
}
function syncPrec(): void {
  const np = val('np'),
    busy = !!job;
  precBtn.disabled = busy || np === lastN;
  precBtn.textContent = busy ? '計算中…' : '精密計算';
  precBtn.title = job
    ? `N′ = ${job.N} で計算しています`
    : np === lastN
      ? `N′ = ${np} で計算済み`
      : `N′ = ${np} で計算結果を求め直す`;
}
function done(j: Job & { ver: number }, r: Summary | null): void {
  job = null;
  if (!r) toast('計算できませんでした。N′ を小さくしてください');
  else if (j.ver === ver) {
    showResults(r, j.N);
    lastN = j.N;
  }
  syncPrec();
}
precBtn.addEventListener('click', () => {
  const N = val('np');
  if (job || N === lastN) return;
  const j = { id: Date.now(), ver, p: prm(), N };
  job = j;
  syncPrec();
  try {
    worker ??= mkWorker();
    worker.postMessage(j satisfies Job);
  } catch {
    /* Worker を使えない環境ではメインスレッドで計算する */
    setTimeout(() => {
      let r: Summary | null = null;
      try {
        r = analyze(j.p, j.N, false);
      } catch {
        r = null;
      }
      done(j, r);
    }, 30);
  }
});

/* ---------- 試聴（Web Audio API: ホワイトノイズ → 音量 → IIRFilterNode → レベル計測） ---------- */
interface Sound {
  ctx: AudioContext;
  gain: GainNode;
  an: AnalyserNode;
  iir: IIRFilterNode | null;
  buf: Float32Array<ArrayBuffer>;
}
let snd: Sound | null = null,
  playing = false,
  raf = 0,
  level = -Infinity;
function setVol(): void {
  if (!snd) return;
  snd.gain.gain.setTargetAtTime(10 ** (val('vol') / 20), snd.ctx.currentTime, 0.02);
}
/** 係数は再生装置のサンプリング周波数で求め直す（fc・Q・G は画面と同じ） */
function setIIR(): void {
  if (!snd) return;
  const r = snd.ctx.sampleRate,
    fc0 = val('fc'),
    fc = Math.min(fc0, r * 0.49);
  const co = coef(type.v, r, fc, val('q'), val('g'));
  let n: IIRFilterNode;
  try {
    n = snd.ctx.createIIRFilter(co.slice(0, 3), co.slice(3));
  } catch {
    return;
  }
  snd.gain.connect(n);
  n.connect(snd.an);
  if (snd.iir) {
    try {
      snd.gain.disconnect(snd.iir);
      snd.iir.disconnect();
    } catch {
      /* 既に切断済み */
    }
  }
  snd.iir = n;
  txt('#lv-fs', fmt(r, 'Hz', 4) + (fc < fc0 ? `（fc を ${fmt(fc, 'Hz', 3)} に制限）` : ''));
}
function drawLv(v: number): void {
  const x = Number.isFinite(v) ? lvX(v) : 0,
    hot = lvX(LV_HOT);
  $('#lv-bar').setAttribute('width', Math.min(x, hot).toFixed(1));
  const h = $('#lv-hot');
  h.setAttribute('x', String(hot));
  h.setAttribute('width', Math.max(0, x - hot).toFixed(1));
  txt('#lv-t', Number.isFinite(v) && v > -120 ? fixed(v, 1) : '---');
}
function meter(): void {
  if (!snd) return;
  snd.an.getFloatTimeDomainData(snd.buf);
  let s = 0;
  for (const x of snd.buf) s += x * x;
  level = Math.max(10 * Math.log10(s / snd.buf.length), level - 0.6);
  drawLv(level);
  raf = requestAnimationFrame(meter);
}
function open(): Sound | null {
  const AC =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  const c = new AC(),
    len = c.sampleRate * 2,
    b = c.createBuffer(1, len, c.sampleRate),
    d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = b;
  src.loop = true;
  const s: Sound = { ctx: c, gain: c.createGain(), an: c.createAnalyser(), iir: null, buf: new Float32Array(2048) };
  s.an.fftSize = 2048;
  src.connect(s.gain);
  s.an.connect(c.destination);
  s.gain.gain.value = 10 ** (val('vol') / 20);
  snd = s;
  setIIR();
  src.start();
  return s;
}
async function play(on: boolean): Promise<void> {
  if (on && !snd && !open()) {
    toast('この環境では音を鳴らせません');
    return;
  }
  playing = on;
  const btn = $('#playBtn');
  btn.setAttribute('aria-pressed', String(on));
  $('.led', btn).classList.toggle('on', on);
  txt('#playT', on ? '停止' : '再生');
  cancelAnimationFrame(raf);
  if (on) {
    await snd?.ctx.resume();
    raf = requestAnimationFrame(meter);
  } else {
    await snd?.ctx.suspend();
    level = -Infinity;
    drawLv(-Infinity);
  }
}
$('#playBtn').addEventListener('click', () => {
  void play(!playing);
});

/* ---------- 入力 ---------- */
/** 増幅量 G は LSF・HSF・PEQ だけで使う。使わない間は欄を破線にして理由を出す */
function useGain(): void {
  g?.setOff('g', !type.g, `${type.ab} では使いません`);
}
new Choice($('#p-type'), (v) => {
  type = typeOf(v);
  useGain();
  /* math 要素は HTMLElement ではないので hidden は属性で切り替える */
  $('#eq-a').toggleAttribute('hidden', !type.g);
  for (const e of $$('.egrp')) e.hidden = e.dataset.t !== type.v;
  compute();
});

/* 値の確定。範囲や表示長だけのものは、係数と特性を計算し直さない */
g = new ParamGroup<Key>(PARAMS, (_, k) => {
  if (!k) return;
  if (k === 'vol') setVol();
  else if (k === 'bot') drawFr();
  else if (k === 'np') syncPrec();
  else compute();
});
const G = g;
/* fs → fc の上限、N → 表示長 L の上限 */
G.on('fs', (fs) => {
  G.update('fc', fcPatch(fs));
  const h = fs / 2;
  if (G.get('fc') >= h * (1 - 1e-9)) {
    const L = G.list('fc'),
      w = prevOf(L, h) ?? L[0];
    G.set('fc', w, { silent: true });
    G.note('fc', `fs/2 = ${hzT(h)} 未満にするため ${hzT(w)} にしました`, 'er');
  }
});
G.on('n', limitLen);
limitLen(G.get('n'));
useGain();
compute();
drawLv(-Infinity);
