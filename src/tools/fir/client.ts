/** FIR フィルタのページの入口: 入力 → 設計と解析（Worker）→ 結果・グラフ・零点・係数・代入式、試聴（Web Audio） */
import { Choice } from '../../lib/choice';
import { $ } from '../../lib/dom';
import { fmt, fmtR, plain, ro } from '../../lib/format';
import { ParamGroup } from '../../lib/param';
import { SW } from '../../lib/scope';
import { storeToggle } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { fcList, hzT } from '../biquad/params';
import { fixed, LV_HOT, lvX, sig } from '../biquad/plot';
import { iirMults } from './analysis';
import { design, type Method, type Result, remezTaps, run, type Spec, specBands, windowTaps } from './design';
import { coefText } from './export';
import { iirSubst, substHtml } from './math';
import { type Key, methodOf, nList, PARAMS, type TypeDef, typeOf, winOf } from './params';
import { type Ch2, type FrPlot, frPlot, IH, type IrPlot, irPlot, type YMode, type ZPlot, zPlot } from './plot';
import { dpOf, dsOf, type Freqs, fitHz, needsOdd, rangesHz, twoEdges } from './spec';
import { WIN_K, type Win } from './window';
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
const pressed = (id: string) => $(`${id} [aria-pressed="true"]`).dataset.v ?? '';
let type: TypeDef = typeOf(pressed('#p-type')),
  method: Method = methodOf(pressed('#p-method')).v,
  win: Win = winOf(pressed('#p-win')).v,
  auto = pressed('#p-auto') === '1',
  ys = pressed('#p-ys') as YMode,
  c2 = pressed('#p-c2') as Ch2;
let g: ParamGroup<Key> | null = null;
const val = (k: Key): number => g?.get(k) ?? Number.NaN;
/** 最後に設計した結果（グラフの元） */
let S: { s: Spec; r: Result } | null = null;

const spec = (): Spec => ({
  t: type.v,
  fs: val('fs'),
  f1: val('f1'),
  f2: val('f2'),
  df: val('df'),
  ap: val('ap'),
  as: val('as'),
  method,
  win,
  auto,
  n: val('n'),
  beta: val('beta'),
  wp: val('wp'),
  ws: val('ws'),
});

/* ---------- 設計（短いものはその場で、長いものは Web Worker で。Worker は一度に 1 つ、待ちは最新の 1 つだけ） ---------- */
/** その場で設計するタップ数の目安の上限（これを超えると 50 ms ほどかかることがある） */
const SYNC_N = 120;
/** タップ数の目安（仕様から求めるときは式の値。最小二乗法は等リップルより長くなる） */
const estN = (s: Spec): number =>
  !s.auto ? s.n : s.method === 'window' ? windowTaps(s) : remezTaps(s) * (s.method === 'ls' ? 1.3 : 1);
let worker: Worker | null = null,
  useWorker = typeof Worker !== 'undefined',
  busy: Job | null = null,
  pending: Job | null = null,
  seq = 0,
  /** 表示している結果の番号（古い結果が後から届いたら捨てる） */
  shown = 0;
function mkWorker(): Worker {
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<Reply>) => {
    const j = busy;
    if (!j || e.data.id !== j.id) return;
    busy = null;
    show(j, e.data.r);
    next();
  };
  w.onerror = (e) => {
    e.preventDefault();
    worker = null;
    useWorker = false;
    const j = busy;
    busy = null;
    if (j) compute(j);
    next();
  };
  return w;
}
/** メインスレッドで設計する */
function compute(j: Job): void {
  let r: Result | null = null;
  try {
    r = run(j.s);
  } catch {
    r = null;
  }
  show(j, r);
}
function post(j: Job): void {
  if (busy) {
    pending = j;
    return;
  }
  if (useWorker)
    try {
      worker ??= mkWorker();
      busy = j;
      worker.postMessage(j);
      txt('#o-aux', '計算中…');
      return;
    } catch {
      busy = null;
      useWorker = false;
    }
  compute(j);
}
function next(): void {
  const p = pending;
  pending = null;
  if (p) post(p);
}
function request(s = spec()): void {
  const j: Job = { id: ++seq, s };
  if (estN(s) <= SYNC_N || !useWorker) {
    pending = null;
    compute(j);
  } else post(j);
}
function show(j: Job, r: Result | null): void {
  if (!busy && !pending) txt('#o-aux', '');
  if (j.id < shown) return;
  shown = j.id;
  if (!r) {
    toast('この仕様では設計できませんでした。遷移帯域幅やカットオフ周波数を見直してください');
    return;
  }
  S = { s: j.s, r };
  render();
}

/* ---------- 結果 ---------- */
const dBu = (v: number) => `${Number.isFinite(v) ? plain(v, 4, true) : v > 0 ? '∞' : '—'}<span class="u">dB</span>`;
function sub(id: string, text: string, ng = false): void {
  const e = $(id);
  e.textContent = text;
  e.classList.toggle('ng', ng);
}
function render(): void {
  if (!S) return;
  const { s, r } = S,
    { d, m } = r,
    N = d.N,
    M = (N - 1) / 2;
  txt('#o-n', String(N));
  txt('#o-ns', `次数 ${N - 1}・タイプ ${N % 2 ? 'I（奇数長）' : 'II（偶数長）'}`);
  html('#o-d', `${M}<span class="u">サンプル</span>`);
  txt('#o-ds', fmtR(M / s.fs, 's', 4));
  html('#o-ap', dBu(m.ripple));
  const okP = m.dp <= dpOf(s.ap) * (1 + 1e-6),
    okS = m.ds <= dsOf(s.as) * (1 + 1e-6);
  sub('#o-aps', okP ? `仕様 ${plain(s.ap, 4)} dB 以下` : `仕様の ${plain(s.ap, 4)} dB を超えます`, !okP);
  html('#o-as', dBu(m.atten));
  sub('#o-ass', okS ? `仕様 ${plain(s.as, 4)} dB 以上` : `仕様の ${plain(s.as, 4)} dB に届きません`, !okS);
  html('#o-tw', ro(m.trans * s.fs, 'Hz', 4));
  txt('#o-tws', `仕様 ${hzT(s.df)}${twoEdges(s.t) ? '・広い方' : ''}`);
  html('#o-mul', `${Math.ceil(N / 2)}<span class="u">回</span>`);
  txt('#o-muls', `対称性を使わないと ${N} 回`);
  html('#o-iir', `楕円 ${r.iir.ellip}<span class="u">次</span>`);
  txt('#o-iirs', `乗算 ${iirMults(r.iir.ellip)} 回・バタワースなら ${r.iir.butter} 次・位相は非直線`);
  txt('#mt', type.ab);
  txt('#mn', String(N));
  txt('#md', `${M} S`);
  txt('#ma', Number.isFinite(m.atten) ? `${fixed(m.atten, 1)} dB` : '∞');
  designNote();
  drawFr();
  drawImp();
  drawZ();
  renderCoef();
  html('#subst', substHtml(s, d) + iirSubst(r.iir, s.t));
  setFir();
}

/** タップ数の決め方の行に、仕様から求めた値と、反復の様子を出す */
function designNote(): void {
  if (!S) return;
  const { s, r } = S,
    d = r.d,
    parts: string[] = [];
  let er = false;
  if (s.auto) {
    parts.push(`N = ${d.N}`);
    if (s.method === 'window' && s.win === 'kaiser') parts.push(`β = ${sig(d.beta, 4, true)}`);
    if (s.method !== 'window') parts.push(`Ws/Wp = ${sig(d.ws, 4, true)}`);
  }
  if (d.fallback) parts.push('誤差が倍精度の丸め誤差に近く Remez 交換が進まないため、最小二乗法の係数です');
  else if (d.iter != null)
    parts.push(d.converged ? `Remez 交換 ${d.iter} 回` : `Remez 交換が ${d.iter} 回で収束しません`);
  if (d.iter != null && !d.converged) er = true;
  let tail = '';
  if (s.auto && d.capped) {
    tail = `（上限の ${d.N} でも仕様を満たしません）`;
    er = true;
  } else if (s.auto && s.method === 'window' && s.win !== 'kaiser' && s.as > WIN_K[s.win].as)
    tail = `（${winOf(s.win).ab}窓の阻止域減衰は約 ${WIN_K[s.win].as} dB）`;
  auto$.note(parts.length ? `${s.auto ? '仕様から: ' : ''}${parts.join('・')}${tail}` : tail, er ? 'er' : '');
}

/* ---------- 表示窓の共通 ---------- */
function svgPt(svg: SVGSVGElement, ev: PointerEvent): DOMPoint | null {
  const m = svg.getScreenCTM();
  return m ? new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse()) : null;
}
/** 表示窓の上でカーソルを動かす。外へ出たら null を渡す */
function bindCursor(svg: SVGSVGElement, at: (p: DOMPoint | null) => void): void {
  const move = (e: PointerEvent) => {
    const p = svgPt(svg, e);
    if (p) at(p);
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', () => at(null));
}
/** CH の表示の切替（押すたびに保存する） */
function bindChannel(btn: HTMLElement, scope: HTMLElement, cls: string): void {
  btn.addEventListener('click', () => {
    const on = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(on));
    scope.classList.toggle(cls, !on);
  });
  storeToggle(btn);
}

/* ---------- 周波数特性 ---------- */
let frF: number | null = null,
  FR: FrPlot | null = null;
function drawFr(): void {
  if (!S) return;
  const { s, r } = S,
    { fr, m, d } = r;
  FR = frPlot({
    fr,
    fs: s.fs,
    bands: specBands(s),
    dp: dpOf(s.ap),
    ds: dsOf(s.as),
    ymode: ys,
    ch2: c2,
    M: (d.N - 1) / 2,
    depth: Math.max(s.as, Math.min(m.atten, 200)),
    pmax: m.passMax,
    pmin: m.passMin,
  });
  $('#fr-t1').setAttribute('d', FR.mag);
  $('#fr-t2').setAttribute('d', FR.ch2);
  $('#fr-mask').setAttribute('d', FR.mask);
  html('#fr-axes', FR.axes);
  txt('#fr-vd', FR.dv1);
  txt('#fr-c2', c2 === 'ph' ? 'PHASE' : 'GRP DELAY');
  txt('#fr-vd2', FR.dv2);
  txt('#fr-x', fmt(s.fs / 20, 'Hz', 4));
  txt('#fr-aux', `${fr.L} 点の FFT`);
  $('#fr-svg').setAttribute(
    'aria-label',
    `周波数特性。横軸は 0 から ${hzT(s.fs / 2)} の線形、縦軸は振幅 ${FR.dv1}/div。通過域リップル ${plain(m.ripple, 3)} dB、阻止域減衰 ${plain(m.atten, 3)} dB。破線は仕様の枠。`,
  );
  frCursor();
}
function frCursor(): void {
  if (!S || !FR) return;
  const { s, r } = S,
    { fr } = r,
    K = fr.mag.length,
    k = Math.max(0, Math.min(K - 1, Math.round((frF ?? 0) * fr.L)));
  $('#fr-cur').setAttribute('d', frF == null ? '' : `M${FR.X(k / fr.L).toFixed(1)} 0V240`);
  const a = fr.mag[k],
    amp = ys === 'lin' ? `<b>${fixed(a, 5)}</b>` : `<b>${fixed(20 * Math.log10(a), 2)}</b> dB`,
    ch2 = c2 === 'ph' ? `<b>${fixed(fr.ph[k], 1)}</b>°` : `<b>${fixed(fr.gd[k], 2)}</b> S`;
  html('#fr-rd', frF == null ? '' : `CUR <b>${fmtR((k / fr.L) * s.fs, 'Hz', 4)}</b> ${amp} ${ch2}`);
}
bindCursor($('#fr-svg'), (p) => {
  if (!FR) return;
  frF = p == null || p.x < 0 || p.x > SW ? null : FR.F(p.x);
  frCursor();
});
bindChannel($('#ch1f'), $('#fr-scope'), 'hide1');
bindChannel($('#ch2f'), $('#fr-scope'), 'hide2');
new Choice<YMode>($('#p-ys'), (v) => {
  ys = v;
  drawFr();
});
new Choice<Ch2>($('#p-c2'), (v) => {
  c2 = v;
  drawFr();
});

/* ---------- インパルス応答 ---------- */
let imN: number | null = null,
  IM: IrPlot | null = null;
function drawImp(): void {
  if (!S) return;
  const { d } = S.r,
    win$ = S.s.method === 'window';
  IM = irPlot(d.h, win$ ? d.hd : undefined, win$ ? d.w : undefined);
  const st = $('#im-st');
  st.setAttribute('d', IM.stem);
  st.style.strokeWidth = String(IM.width);
  html('#im-dots', IM.dots);
  $('#im-z').setAttribute('d', IM.zero);
  $('#im-c').setAttribute('d', IM.center);
  $('#im-i').setAttribute('d', IM.ideal);
  $('#im-w').setAttribute('d', IM.win);
  html('#im-axes', IM.axes);
  txt('#im-vd', sig(IM.vd, 3));
  txt('#im-hd', String(IM.d));
  for (const b of [$('#ch2i'), $('#wini')]) b.hidden = !win$;
  $('#im-svg').setAttribute(
    'aria-label',
    `インパルス応答（係数）。n = 0 から ${d.N - 1} まで、n = ${(d.N - 1) / 2} を中心に左右対称。横軸 ${IM.d} サンプル/div、縦軸 ${sig(IM.vd, 3)}/div。`,
  );
  imCursor();
}
function imCursor(): void {
  if (!S || !IM) return;
  const d = S.r.d;
  if (imN == null) {
    $('#im-cur').setAttribute('d', '');
    html('#im-rd', '');
    return;
  }
  const n = Math.max(0, Math.min(d.N - 1, imN));
  $('#im-cur').setAttribute('d', `M${IM.X(n).toFixed(1)} 0V${IH}`);
  let s = `CUR <i>n</i> = <b>${n}</b> <i>h</i> = <b>${sig(d.h[n], 6, true)}</b>`;
  if (d.hd && d.w && S.s.method === 'window')
    s += ` <i>h</i><sub>d</sub> = <b>${sig(d.hd[n], 6, true)}</b> <i>w</i> = <b>${sig(d.w[n], 6, true)}</b>`;
  html('#im-rd', s);
}
bindCursor($('#im-svg'), (p) => {
  if (!IM) return;
  imN = p == null || p.x < 0 || p.x > SW ? null : Math.round((p.x - IM.X(0)) / (IM.X(1) - IM.X(0)));
  imCursor();
});
bindChannel($('#ch2i'), $('#im-scope'), 'hide2');
bindChannel($('#wini'), $('#im-scope'), 'hidew');

/* ---------- 零点 ---------- */
let ZP: ZPlot | null = null;
function drawZ(): void {
  if (!S) return;
  const { r } = S,
    N = r.d.N;
  ZP = zPlot(r.z, N - 1);
  html('#z-ring', ZP.ring);
  html('#z-dots', ZP.dots);
  html('#z-pole', ZP.pole);
  html('#z-axes', ZP.axes);
  const n = r.z.re.length;
  txt('#z-n', ZP.out ? `${n}（表示の外に ${ZP.out}）` : String(n));
  txt('#z-on', String(ZP.on));
  txt('#z-p', String(N - 1));
  txt('#z-dv', plain(ZP.R / 5, 3));
  $('#z-svg').setAttribute(
    'aria-label',
    `z 平面の零点。零点 ${n} 個のうち単位円の上に ${ZP.on} 個。原点に ${N - 1} 重の極。`,
  );
  zCursor(null);
}
function zCursor(p: DOMPoint | null): void {
  const sel = $('#z-sel'),
    z = S?.r.z;
  if (!ZP || !S || !z || !p || p.x < 0 || p.x > SW || p.y < 0 || p.y > SW) {
    sel.setAttribute('cx', '-100');
    html('#z-rd', '');
    return;
  }
  /* カーソルに最も近い零点 */
  let bi = -1,
    bd = Infinity;
  for (let i = 0; i < z.re.length; i++) {
    const [x, y] = ZP.P(z.re[i], z.im[i]),
      dd = (x - p.x) ** 2 + (y - p.y) ** 2;
    if (dd < bd) {
      bd = dd;
      bi = i;
    }
  }
  if (bi < 0 || bd > 30 ** 2) {
    sel.setAttribute('cx', '-100');
    html('#z-rd', '');
    return;
  }
  const re = z.re[bi],
    im = z.im[bi],
    [x, y] = ZP.P(re, im),
    a = Math.atan2(im, re);
  sel.setAttribute('cx', x.toFixed(1));
  sel.setAttribute('cy', y.toFixed(1));
  html(
    '#z-rd',
    `ZERO <i>z</i> = <b>${sig(re, 4, true)} ${im < 0 ? '−' : '+'} j${sig(Math.abs(im), 4, true)}</b> |<i>z</i>| = <b>${sig(Math.hypot(re, im), 4, true)}</b> ∠ <b>${fixed((a * 180) / Math.PI, 1)}</b>° → <b>${fmtR((Math.abs(a) / (2 * Math.PI)) * S.s.fs, 'Hz', 4)}</b>`,
  );
}
bindCursor($('#z-svg'), zCursor);

/* ---------- 係数の書き出し ---------- */
const cf$ = new Choice<'txt' | 'c'>($('#p-cf'), () => renderCoef());
const ct$ = new Choice<'f64' | 'f32'>($('#p-ct'), () => renderCoef());
function renderCoef(): void {
  if (!S) return;
  txt('#coefs', coefText(S.s, S.r.d, cf$.value, ct$.value));
}
/** クリップボードへ写す。写せないときは係数の欄を選んでおく（手で写せるように） */
async function copyText(s: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(s);
    return true;
  } catch {
    const r = document.createRange(),
      sel = getSelection();
    r.selectNodeContents($('#coefs'));
    sel?.removeAllRanges();
    sel?.addRange(r);
    return false;
  }
}
$('#copyBtn').addEventListener('click', async () => {
  if (!S) return;
  const ok = await copyText($('#coefs').textContent ?? '');
  toast(ok ? `係数 ${S.r.d.N} 個をコピーしました` : 'コピーできませんでした。選んだ係数を写してください');
});

/* ---------- 試聴（Web Audio API: ホワイトノイズ → 音量 → ConvolverNode → レベル計測） ---------- */
interface Sound {
  ctx: AudioContext;
  gain: GainNode;
  an: AnalyserNode;
  conv: ConvolverNode | null;
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
/** 係数を畳み込みの応答にする。再生装置が fs で動かないときは、その周波数で設計し直す（周波数・仕様は画面と同じ） */
function setFir(): void {
  if (!snd || !S) return;
  const c = snd.ctx,
    rate = c.sampleRate;
  let h = S.r.d.h,
    note = '';
  if (rate !== S.s.fs) {
    const f = fitHz(S.s.t, rate, { f1: S.s.f1, f2: S.s.f2, df: S.s.df });
    try {
      h = design({ ...S.s, fs: rate, ...f.v }).h;
    } catch {
      return;
    }
    note = `（この周波数で設計し直し${f.fixed.length ? '、周波数を制限' : ''}）`;
  }
  const b = c.createBuffer(1, h.length, rate),
    ch = b.getChannelData(0);
  h.forEach((v, i) => {
    ch[i] = v;
  });
  const n = c.createConvolver();
  n.normalize = false;
  n.buffer = b;
  snd.gain.connect(n);
  n.connect(snd.an);
  if (snd.conv) {
    try {
      snd.gain.disconnect(snd.conv);
      snd.conv.disconnect();
    } catch {
      /* 既に切断済み */
    }
  }
  snd.conv = n;
  txt('#lv-fs', fmt(rate, 'Hz', 5) + note);
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
  /* 再生装置を fs で動かす。その周波数を使えない環境では既定の周波数で開き、設計し直す */
  let c: AudioContext;
  try {
    c = new AC({ sampleRate: val('fs') });
  } catch {
    c = new AC();
  }
  const len = c.sampleRate * 2,
    b = c.createBuffer(1, len, c.sampleRate),
    d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = b;
  src.loop = true;
  const s: Sound = { ctx: c, gain: c.createGain(), an: c.createAnalyser(), conv: null, buf: new Float32Array(2048) };
  s.an.fftSize = 2048;
  src.connect(s.gain);
  s.an.connect(c.destination);
  s.gain.gain.value = 10 ** (val('vol') / 20);
  snd = s;
  setFir();
  src.start();
  return s;
}
/** fs が変わったら、再生装置を新しい fs で開き直す */
async function reopen(): Promise<void> {
  if (!snd || snd.ctx.sampleRate === val('fs')) return;
  const old = snd;
  snd = null;
  cancelAnimationFrame(raf);
  await old.ctx.close();
  const s = playing ? open() : null;
  if (s) {
    await s.ctx.resume();
    raf = requestAnimationFrame(meter);
  }
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
const FK = ['f1', 'f2', 'df'] as const;
const freqs = (): Freqs => ({ f1: val('f1'), f2: val('f2'), df: val('df') });

/** f1・f2・df の範囲をほかの値と fs に合わせる */
function syncRanges(): void {
  const G = g;
  if (!G) return;
  const fs = val('fs'),
    r = rangesHz(type.v, fs, freqs()),
    list = fcList(fs);
  for (const k of FK) G.update(k, { min: r[k][0], max: r[k][1], list });
}
/** 帯域を作れない値を直して知らせる */
function fitFreqs(why: string): void {
  const G = g;
  if (!G) return;
  const f = fitHz(type.v, val('fs'), freqs());
  for (const k of f.fixed) {
    G.set(k, f.v[k], { silent: true });
    G.note(k, `${why}${hzT(f.v[k])} にしました`, 'er');
  }
  syncRanges();
}

/** 応答の種類に合わせて、カットオフ周波数の行とタップ数の並びを変える */
function applyType(): void {
  const G = g;
  if (!G) return;
  const two = twoEdges(type.v);
  const lo = type.v === 'lowpass' || type.v === 'bandstop';
  G.update('f1', {
    sym: two ? '<i>f</i><sub>c1</sub>' : '<i>f</i><sub>c</sub>',
    nm: two ? 'fc1' : 'fc',
    name: two ? '下側のカットオフ周波数' : 'カットオフ周波数',
    sub: `${two ? '下側の' : ''}遷移帯域の中央。${lo ? '通過' : '阻止'}域の端は −Δf/2、${lo ? '阻止' : '通過'}域の端は +Δf/2`,
  });
  G.update('f2', {
    sub: `上側の遷移帯域の中央。${lo ? '阻止' : '通過'}域の端は −Δf/2、${lo ? '通過' : '阻止'}域の端は +Δf/2`,
  });
  $('#p-f2').hidden = !two;
  fitFreqs(`${type.ab} の帯域を作れるように `);
  const odd = needsOdd(type.v);
  G.update('n', { list: nList(odd) });
  const n = val('n');
  if (odd && n % 2 === 0) {
    G.set('n', n + 1, { silent: true });
    G.note('n', `${type.ab} は奇数にするため ${n + 1} にしました`, 'er');
  }
}

/** 設計法・決め方・窓に合わせて行を出し入れする */
function applyMode(): void {
  $('#p-win').hidden = method !== 'window';
  $('#p-n').hidden = auto;
  $('#p-beta').hidden = auto || method !== 'window' || win !== 'kaiser';
  $('#p-wp').hidden = $('#p-ws').hidden = auto || method === 'window';
}

new Choice($('#p-type'), (v) => {
  type = typeOf(v);
  applyType();
  request();
});
new Choice($('#p-method'), (v) => {
  method = methodOf(v).v;
  applyMode();
  request();
});
new Choice($('#p-win'), (v) => {
  win = winOf(v).v;
  applyMode();
  request();
});
const auto$ = new Choice($('#p-auto'), (v) => {
  auto = v === '1';
  /* 指定へ切り替えたら、仕様から求めた値から始める */
  if (!auto && S && g) {
    const d = S.r.d;
    g.set('n', d.N, { silent: true });
    g.set('beta', Number(d.beta.toFixed(2)), { silent: true });
    g.set('wp', Number(d.wp.toPrecision(4)), { silent: true });
    g.set('ws', Number(d.ws.toPrecision(4)), { silent: true });
  }
  applyMode();
  request();
});

/* 値の確定。音量だけのものは設計し直さない */
g = new ParamGroup<Key>(PARAMS, (_, k) => {
  if (!k) return;
  if (k === 'vol') setVol();
  else request();
});
const G = g;
for (const k of FK) G.on(k, syncRanges);
G.on('fs', () => {
  fitFreqs(`fs/2 = ${hzT(val('fs') / 2)} に収めるため `);
  void reopen();
});
applyType();
applyMode();
request();
drawLv(-Infinity);
