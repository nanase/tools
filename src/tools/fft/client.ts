/**
 * FFT のページの入口: 入力 → 段ごとの FFT の記録 → バタフライ図・拡大・式・計算結果。
 * 進み具合 pos（バタフライの数）は再生（requestAnimationFrame）・帯のドラッグ・キーで動かす。演算の数の枠は別に数える
 */
import { Choice } from '../../lib/choice';
import { $ } from '../../lib/dom';
import { RM } from '../../lib/motion';
import { ParamGroup } from '../../lib/param';
import { initToolPage } from '../../lib/tool-page';
import { fft, plan } from '../spectrum/fft';
import { dftOps, fftOps, ops } from './count';
import {
  type BfFig,
  big,
  buildBf,
  countSvg,
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
import { BASE, COUNT_N } from './params';
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
    f = fftOps(N, R.kind, '4/2', false),
    d = dftOps(N);
  $('#ff-in').innerHTML = inputSvg(re, im);
  txt($('#o-cm'), String(nbf()));
  txt($('#o-cm-d'), `定義どおりなら ${big(N * N)} 回（${+((N * N) / nbf()).toFixed(1)} 分の 1）`);
  txt($('#o-st'), String(R.f.m));
  txt($('#o-bf'), String(nbf()));
  txt($('#o-mul'), big(f.mul));
  txt($('#o-mul-d'), `定義どおり ${big(d.mul)}`);
  txt($('#o-add'), big(f.add));
  txt($('#o-add-d'), `定義どおり ${big(d.add)}`);
  txt($('#m-n'), String(N));
  txt($('#m-f'), String(nbf()));
  txt($('#m-d'), big(N * N));
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

/* ---------- 入力の棒をドラッグ ---------- */
const inSvg = $<SVGSVGElement>('#ff-in');
function putIn(e: PointerEvent): void {
  const h = inputAt(inSvg, R.N, e);
  if (!h) return;
  const [n, v] = h;
  if (re[n] === v && im[n] === 0) return;
  re[n] = v;
  im[n] = 0;
  sigCh.set('');
  recompute();
}
inSvg.addEventListener('pointerdown', (e) => {
  inSvg.setPointerCapture(e.pointerId);
  putIn(e);
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

/* ---------- 演算の数 ---------- */
let cn = COUNT_N.v;
const cmCh = new Choice<'c' | 'r'>($('#ff-cm'), () => drawCount());
new ParamGroup<'cn'>([COUNT_N], (v) => {
  cn = v.cn;
  drawCount();
});
function drawCount(): void {
  const real = cmCh.value === 'r',
    [a, b] = ops(cn, real);
  $('#ff-cnt').innerHTML =
    `<span class="k">定義どおり</span><div class="bar"><i style="width:100%"></i></div><span>${big(a)}</span>` +
    `<span class="k">FFT</span><div class="bar f"><i style="width:${Math.max(0.4, (100 * b) / a)}%"></i></div><span>${big(b)}</span>`;
  $('#ff-cg').innerHTML = countSvg(cn, real);
  txt(
    $('#ff-cnote'),
    `${big(cn)} 点: ${(a / b).toLocaleString('ja-JP', { maximumFractionDigits: 1 })} 分の 1${real ? '（FFT は 1・−i・(1 − i)/√2 を掛けずに数える）' : ''}`,
  );
}

/* ---------- このブラウザで測る（スペクトラムアナライザの FFT と定義どおりの和） ---------- */
$('#ff-bench').addEventListener('click', async (e) => {
  const btn = e.currentTarget as HTMLButtonElement,
    out = $('#ff-bout'),
    rows: string[] = [];
  btn.disabled = true;
  out.innerHTML = '<p class="cnote">測っています…</p>';
  /* minMs の間くり返した 1 回あたり [ms] */
  const time = (fn: () => void, minMs: number) => {
    let n = 0;
    const t0 = performance.now();
    let t1 = t0;
    while (t1 - t0 < minMs) {
      fn();
      n++;
      t1 = performance.now();
    }
    return (t1 - t0) / n;
  };
  for (let k = 6; k <= 14; k += 2) {
    await new Promise((r) => setTimeout(r, 0));
    const N = 2 ** k,
      xr = Float64Array.from({ length: N }, () => Math.random()),
      xi = new Float64Array(N),
      p = plan(N),
      tf = time(() => {
        p.re.set(xr);
        p.im.fill(0);
        fft(p);
      }, 60),
      td = k <= 12 ? time(() => dft(xr, xi), 60) : null;
    rows.push(
      `<tr><td>${big(N)}</td><td>${tf.toFixed(4)}</td><td>${td === null ? '—' : td.toFixed(2)}</td><td>${td === null ? '—' : `${big(Math.round(td / tf))} 倍`}</td></tr>`,
    );
    out.innerHTML = `<table class="ff-t"><thead><tr><th>N</th><th>FFT ms</th><th>定義どおり ms</th><th>比</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }
  out.insertAdjacentHTML('beforeend', '<p class="cnote">1 回あたり。定義どおりは 4,096 点まで</p>');
  btn.disabled = false;
});

/* ---------- 起動 ---------- */
setSig();
recompute();
drawCount();
/* 保存した値を戻したあと（マイクロタスク）に入力を作り直し、動きを減らす設定でなければ動かす */
queueMicrotask(() => {
  if (!sigCh.value) sigCh.set('rand');
  setSig();
  restart();
  if (!RM.matches) setRun(true);
});
