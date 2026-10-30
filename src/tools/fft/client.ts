/**
 * FFT のページの入口: 入力 → 段ごとの FFT の記録 → バタフライ図・拡大・式・計算結果。
 * 進み具合 pos（バタフライの数）は再生（requestAnimationFrame）・帯のドラッグ・キーで動かす
 */
import { Choice } from '../../lib/choice';
import { $ } from '../../lib/dom';
import { RM } from '../../lib/motion';
import { initToolPage } from '../../lib/tool-page';
import { fftOps } from './count';
import {
  type BfFig,
  big,
  buildBf,
  drawBf,
  fxHtml,
  inputAt,
  inputSvg,
  nodeAt,
  type Run,
  record,
  type View,
  zoomSvg,
} from './fig';
import { BASE } from './params';
import { dft, flow, type Kind } from './radix2';
import { type Sig, signal } from './signals';

initToolPage();

const txt = (el: Element, s: string) => {
  if (el.textContent !== s) el.textContent = s;
};
const html = (el: Element, s: string) => {
  if (el.innerHTML !== s) el.innerHTML = s;
};

/* ---------- 状態 ---------- */
let re: Float64Array = new Float64Array(8),
  im: Float64Array = new Float64Array(8),
  R: Run,
  B: BfFig;
const V: View = { pos: 0, sel: null };
const len = () => R.ops.length;
const nbf = () => (R.N / 2) * R.f.m;

/* ---------- 入力 ---------- */
const kindCh = new Choice<Kind>($('#ff-kind'), () => restart());
const nCh = new Choice<string>($('#ff-n'), () => {
  if (!sigCh.value) sigCh.set('rand');
  setSig();
  restart();
});
const sigCh = new Choice<Sig | ''>($('#ff-sig'), () => {
  setSig();
  recompute();
});
const spCh = new Choice<string>($('#p-sp'));
function setSig(): void {
  [re, im] = signal(sigCh.value || 'rand', Number(nCh.value), 3);
}

/* ---------- 計算 ---------- */
const bfSvg = $<SVGSVGElement>('#ff-bf'),
  bfw = $('#ff-bfw');
function recompute(): void {
  R = record(flow(re, im, kindCh.value), dft(re, im));
  V.pos = Math.min(V.pos, len());
  B = buildBf(bfSvg, R, Math.max(300, Math.round(bfw.clientWidth || 900)));
  ticks();
  drawStatic();
  draw(true);
}
/** 点の数か間引きを変えたら最初から */
function restart(): void {
  V.pos = 0;
  V.sel = null;
  recompute();
}

/* ---------- 描く ---------- */
const zp = $<SVGSVGElement>('#ff-zp');
let lastKey = '';
function draw(force = false): void {
  const n = len(),
    p = n ? V.pos / n : 0,
    i0 = Math.floor(V.pos),
    o = R.ops[Math.min(i0, n - 1)];
  $('#tp-fill').style.width = `${p * 100}%`;
  $('#tp-th').style.left = `${p * 100}%`;
  let k = 0;
  for (let i = 0; i < Math.min(i0, n); i++) if (R.ops[i].t === 'bf') k++;
  const st = V.pos >= n ? '完了' : o.t === 'rev' ? '並べ替え' : `段 ${o.s} / ${R.f.m}`;
  const trk = $('#tp-trk');
  trk.setAttribute('aria-valuenow', p.toFixed(3));
  trk.setAttribute('aria-valuetext', `${st}、掛け算 ${k} / ${nbf()}`);
  html($('#tp-a'), V.pos >= n ? '完了' : o.t === 'rev' ? '並べ替え' : `段 <b>${o.s}</b> / ${R.f.m}`);
  html($('#tp-b'), `掛け算 <b>${k}</b> / ${nbf()}`);
  drawBf(B, R, V);
  const [z, zt] = zoomSvg(R, V);
  zp.innerHTML = z;
  txt($('#ff-zt'), zt);
  /* 式と入力は操作が変わったときだけ */
  const key = `${i0}|${V.sel ? `${V.sel.c},${V.sel.r}` : ''}`;
  if (force || key !== lastKey) html($('#ff-fx'), fxHtml(R, V));
  lastKey = key;
}
/** 入力と計算結果（入力・点の数・間引きが変わったとき） */
function drawStatic(): void {
  const N = R.N,
    f = fftOps(N, R.kind, '4/2', false);
  $('#ff-in').innerHTML = inputSvg(re, im);
  txt($('#o-cm'), String(nbf()));
  txt($('#o-st'), String(R.f.m));
  txt($('#o-bf'), String(nbf()));
  txt($('#o-mul'), big(f.mul));
  txt($('#o-add'), big(f.add));
  txt($('#m-n'), String(N));
  txt($('#m-st'), String(R.f.m));
  txt($('#m-f'), String(nbf()));
}
/** 再生の帯の目盛り: 段の区切り */
function ticks(): void {
  const tk = $<SVGSVGElement>('#tp-tk'),
    w = Math.max(1, tk.clientWidth),
    n = len();
  let d = '';
  R.ops.forEach((o, i) => {
    if (i && o.c !== R.ops[i - 1].c) d += `M${((i / n) * w).toFixed(1)} 0v7`;
  });
  tk.setAttribute('viewBox', `0 0 ${w} 7`);
  tk.querySelector('.mj')?.setAttribute('d', d);
}

/* ---------- 節点: マウスを載せる・押すと、その値を作った操作を出す ---------- */
bfSvg.addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse') return;
  const p = nodeAt(e.target);
  if (p && !(V.sel && V.sel.c === p.c && V.sel.r === p.r)) {
    V.sel = p;
    draw();
  }
});
bfSvg.addEventListener('pointerleave', (e) => {
  if (e.pointerType === 'mouse' && V.sel) {
    V.sel = null;
    draw();
  }
});
bfSvg.addEventListener('click', (e) => {
  const p = nodeAt(e.target);
  V.sel = p && !(V.sel && V.sel.c === p.c && V.sel.r === p.r) ? p : null;
  draw();
});

/* ---------- 入力の棒をドラッグ: 押した所に近い方（実部か虚部）の点だけを動かす ---------- */
const inSvg = $<SVGSVGElement>('#ff-in');
let part: 're' | 'im' = 're';
function putIn(e: PointerEvent, first = false): void {
  const h = inputAt(inSvg, R.N, e);
  if (!h) return;
  const [n, v] = h;
  if (first) part = Math.abs(im[n]) > 1e-9 && Math.abs(v - im[n]) < Math.abs(v - re[n]) ? 'im' : 're';
  const x = part === 're' ? re : im;
  if (x[n] === v) return;
  x[n] = v;
  sigCh.set('');
  recompute();
}
inSvg.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  inSvg.setPointerCapture(e.pointerId);
  putIn(e, true);
});
inSvg.addEventListener('pointermove', (e) => {
  if (inSvg.hasPointerCapture(e.pointerId)) putIn(e);
});

/* ---------- 再生 ---------- */
let running = false,
  raf = 0,
  last = 0;
function setPos(v: number): void {
  V.pos = Math.min(len(), Math.max(0, v));
  V.sel = null;
  draw();
}
function loop(now: number): void {
  raf = 0;
  if (!running) return;
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)),
    o = R.ops[Math.floor(V.pos)];
  last = now;
  V.pos = Math.min(len(), V.pos + dt * BASE * Number(spCh.value) * (o?.t === 'rev' ? 0.5 : 1));
  if (V.pos >= len()) setRun(false);
  draw();
  if (running) raf = requestAnimationFrame(loop);
}
function setRun(on: boolean): void {
  running = on;
  const pp = $('#tp-pp');
  pp.classList.toggle('on', on);
  pp.title = on ? '止める' : '動かす';
  pp.setAttribute('aria-label', on ? '止める' : '動かす');
  if (on && !raf) {
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }
}
$('#tp-pp').addEventListener('click', () => {
  if (!running && V.pos >= len()) V.pos = 0;
  V.sel = null;
  setRun(!running);
});
$('#tp-home').addEventListener('click', () => {
  setRun(false);
  setPos(0);
});
$('#tp-step').addEventListener('click', () => {
  setRun(false);
  setPos(Math.floor(V.pos + 1e-9) + 1);
});
const trk = $('#tp-trk');
const fromX = (e: PointerEvent) => {
  const r = trk.getBoundingClientRect();
  setPos(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * len());
};
trk.addEventListener('pointerdown', (e) => {
  trk.setPointerCapture(e.pointerId);
  setRun(false);
  fromX(e);
});
trk.addEventListener('pointermove', (e) => {
  if (trk.hasPointerCapture(e.pointerId)) fromX(e);
});
trk.addEventListener('keydown', (e) => {
  const s = e.shiftKey ? 4 : 1,
    d = { ArrowRight: s, ArrowUp: s, ArrowLeft: -s, ArrowDown: -s }[e.key];
  if (d != null) setPos(Math.round(V.pos) + d);
  else if (e.key === 'Home') setPos(0);
  else if (e.key === 'End') setPos(len());
  else return;
  e.preventDefault();
  setRun(false);
});

/* 枠の幅が変わったら図を描き直す */
let lw = 0;
new ResizeObserver(() => {
  const w = bfw.clientWidth;
  if (Math.abs(w - lw) <= 2 || !R) return;
  lw = w;
  B = buildBf(bfSvg, R, Math.max(300, Math.round(w)));
  ticks();
  draw(true);
}).observe(bfw);

/* ---------- 起動 ---------- */
setSig();
recompute();
/* 保存した値を戻したあと（マイクロタスク）に入力を作り直し、動きを減らす設定でなければ動かす */
queueMicrotask(() => {
  if (!sigCh.value) sigCh.set('rand');
  setSig();
  restart();
  if (!RM.matches) setRun(true);
});
