/**
 * 畳み込みのページの入口: 入力と核の形 → 畳み込み → 2 つの見方の図・出力・周波数・計算結果。
 * 滑らせる位置 t は再生（requestAnimationFrame）・帯のドラッグ・キーで動かす。入力と核の小さい図はなぞって描ける
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { RM } from '../../lib/motion';
import { ParamGroup } from '../../lib/param';
import { initToolPage } from '../../lib/tool-page';
import { area, at, conv, flip, moments, type Sig, shape, slide, sumOf } from './conv';
import { type Fig, fmt3, frameOf, inputSide, mini, nice, output, overlay, spec } from './fig';
import { GRID, type Kind, type Mode, SPEED, STEP, T0, type Which, WIDTHS, type WKey } from './params';

initToolPage();

const txt = (el: Element, s: string) => {
  if (el.textContent !== s) el.textContent = s;
};

/* ---------- 入力 ---------- */
let W = {} as Record<WKey, number>;
let ready = false;
const P = new ParamGroup<WKey>(WIDTHS, (v) => {
  W = v;
  if (ready) update();
});
W = P.values();
const modeCh = new Choice<Mode>($('#cv-mode'), (m) => {
  if (m === 'c') {
    /* サイコロは離散だけ */
    if (xsCh.value === 'dice') xsCh.set('rect');
    if (hsCh.value === 'dice') hsCh.set('exp');
  }
  t = T0[m];
  setRun(false);
  update();
});
const viewCh = new Choice<'out' | 'in'>($('#cv-view'), () => draw());
const xsCh = new Choice<Kind>($('#p-xs'), (v) => {
  /* サイコロの和: 核もサイコロにする */
  if (v === 'dice') hsCh.set('dice');
  else if (hsCh.value === 'dice') hsCh.set('exp');
  update();
});
const hsCh = new Choice<Kind>($('#p-hs'), (v) => {
  if (v !== 'dice' && xsCh.value === 'dice') xsCh.set('rect');
  if (v === 'dice' && xsCh.value !== 'dice') xsCh.set('dice');
  update();
});
const dnCh = new Choice<string>($('#p-dn'), () => update());
let flipOn = true;
const flipBtn = $('#cv-flip');
flipBtn.addEventListener('click', () => {
  flipOn = !flipOn;
  flipBtn.setAttribute('aria-pressed', String(flipOn));
  flipBtn.querySelector('.led')?.classList.toggle('on', flipOn);
  flipBtn.title = flipOn ? '押すと反転せずに滑らせる（相関）' : '押すと反転して滑らせる（畳み込み）';
  update();
});

/** 手で描いた形（モードと入力・核ごと）。なぞり始めた時点の形を写して書き換える */
const HAND: Record<Mode, Record<Which, Float64Array | null>> = { c: { x: null, h: null }, d: { x: null, h: null } };

function make(which: Which, mode: Mode): Sig {
  const g = GRID[mode][which],
    kind = (which === 'x' ? xsCh : hsCh).value,
    hd = HAND[mode][which];
  if (kind === 'hand' && hd) return { t0: g[0], dt: g[1], v: hd.slice() };
  if (kind === 'dice') {
    const die = shape('dice', 0, g[0], g[2], 1);
    if (which === 'h') return die;
    /* 入力は n − 1 個の和（核と畳み込むと n 個の和） */
    const s = sumOf(shape('dice', 0, 0, 7, 1), Number(dnCh.value) - 1),
      v = new Float64Array(g[2]);
    for (let i = 0; i < g[2]; i++) v[i] = at(s, g[0] + i);
    return { t0: g[0], dt: 1, v };
  }
  const w = mode === 'c' ? W[which === 'x' ? 'xa' : 'ha'] : W[which === 'x' ? 'xn' : 'hn'];
  /* 核の見本は面積 1（ステップ・正弦波・雑音は面積を決められないので高さ 1） */
  const norm = which === 'h' && kind !== 'step' && kind !== 'noise' && kind !== 'burst';
  return shape(kind === 'hand' ? 'rect' : kind, w, g[0], g[2], g[1], norm);
}

/* ---------- 計算 ---------- */
/** 大きい図の viewBox の幅: 表示の幅の 1.3 倍（440〜800） */
const figW = () => Math.round(Math.min(800, Math.max(440, ($('#f-y').clientWidth || 800) * 1.3)));
let F: Fig;
let t = T0.c;
function compute(): void {
  const mode = modeCh.value,
    x = make('x', mode),
    h = make('h', mode),
    hh = flipOn ? h : flip(h),
    y = conv(x, hh);
  /* 縦の幅: インパルス（高さ 1/dt）は外して決める */
  const mx = (s: Sig) => {
    let m = 0;
    for (const v of s.v) if (Math.abs(v) < 8) m = Math.max(m, Math.abs(v));
    return m || 1;
  };
  let ay = 1e-9;
  for (const v of y.v) ay = Math.max(ay, Math.abs(v));
  /* 横の範囲: 離散は信号のある所に合わせて詰める（サイコロの和の広さまで） */
  let view: [number, number] = [GRID[mode].view[0], GRID[mode].view[1]],
    tr: [number, number] = [GRID[mode].tr[0], GRID[mode].tr[1]];
  if (mode === 'd') {
    const [x0, x1] = ext(x),
      [y0, y1] = ext(y),
      lo = Math.max(view[0], Math.min(x0, y0) - 2),
      hi = Math.min(view[1], Math.max(lo + 16, x1 + 2, y1 + 2));
    view = [lo, hi];
    tr = [lo + 1, hi - 1];
  }
  t = Math.min(tr[1], Math.max(tr[0], t));
  let ap = 0;
  const [a, b] = tr;
  for (let u = a; u <= b; u += mode === 'c' ? 0.1 : 1)
    for (const v of slide(x, hh, u).p) if (Math.abs(v) < 8) ap = Math.max(ap, Math.abs(v));
  F = {
    mode,
    t,
    flip: flipOn,
    w: figW(),
    view,
    tr,
    x,
    h,
    hh,
    y,
    ax: nice(Math.max(mx(x), mx(h))),
    ay: nice(ay),
    ap: nice(ap || 1),
  };
}

/* ---------- 描く ---------- */
const svg = (id: string) => $<SVGSVGElement>(id);
const fOv = svg('#f-ov'),
  fIn = svg('#f-in'),
  fY = svg('#f-y'),
  mnX = svg('#mn-x'),
  mnH = svg('#mn-h');
const nz = (s: Sig) => {
  let a = -1,
    b = -1;
  for (let i = 0; i < s.v.length; i++)
    if (Math.abs(s.v[i]) > 1e-12) {
      if (a < 0) a = i;
      b = i;
    }
  return a < 0 ? 0 : b - a + 1;
};
/** 0 でない所の最初と最後の時刻 */
function ext(s: Sig): [number, number] {
  let a = Number.POSITIVE_INFINITY,
    b = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < s.v.length; i++)
    if (Math.abs(s.v[i]) > 1e-12) {
      a = Math.min(a, s.t0 + i * s.dt);
      b = s.t0 + i * s.dt;
    }
  return Number.isFinite(a) ? [a, b] : [0, 0];
}
const span = (s: Sig) => {
  const n = nz(s);
  return n ? (n - 1) * s.dt : 0;
};
const sec = (v: number) => `${v.toFixed(1)} s`;

function draw(): void {
  F.t = t;
  const inView = viewCh.value === 'in';
  $('#v-out').hidden = inView;
  $('#v-in').hidden = !inView;
  const yt = inView ? slide(F.x, F.hh, t).area : overlay(fOv, F, 250);
  if (inView) inputSide(fIn, F, 330);
  output(fY, F, yt, 170);
  /* 帯と値 */
  const [a, b] = F.tr,
    p = (t - a) / (b - a),
    ts = F.mode === 'c' ? t.toFixed(2) : String(Math.round(t));
  $('#tp-fill').style.width = `${p * 100}%`;
  $('#tp-th').style.left = `${p * 100}%`;
  const trk = $('#tp-trk');
  trk.setAttribute('aria-valuenow', ts);
  trk.setAttribute('aria-valuetext', `t = ${ts}、y = ${fmt3(yt)}`);
  txt($('#tp-t'), ts);
  txt($('#tp-y'), fmt3(yt));
  txt($('#o-yt'), fmt3(yt));
  txt($('#m-t'), ts);
  txt($('#m-yt'), fmt3(yt));
}
/** 形が変わったときだけ描くもの（小さい図・周波数・計算結果） */
function drawStatic(): void {
  const mode = F.mode;
  mini(mnX, F, 'x', GRID[mode].x);
  mini(mnH, F, 'h', GRID[mode].h);
  spec(svg('#fq-x'), F, 'x', 80, false);
  spec(svg('#fq-h'), F, 'h', 80, false);
  spec(svg('#fq-y'), F, 'y', 100, true);
  const ax = area(F.x),
    ah = area(F.hh),
    ay = area(F.y);
  txt($('#o-ax'), fmt3(ax));
  txt($('#o-ah'), fmt3(ah));
  txt($('#o-ay'), fmt3(ay));
  txt($('#m-ay'), fmt3(ay));
  txt(
    $('#o-len'),
    mode === 'd'
      ? `${nz(F.x)} + ${nz(F.hh)} − 1 = ${nz(F.x) + nz(F.hh) - 1} 点`
      : `${sec(span(F.x))} + ${sec(span(F.hh))} = ${sec(span(F.x) + span(F.hh))}`,
  );
  /* 重心と分散は、負の値がなく面積のあるときだけ（確率の分布として足し算になる） */
  const pos = (s: Sig) => s.v.every((v) => v > -1e-12) && area(s) > 1e-9;
  if (pos(F.x) && pos(F.hh)) {
    const mx = moments(F.x),
      mh = moments(F.hh),
      my = moments(F.y),
      f = (v: number) => (+v.toFixed(3)).toString().replace(/^-/, '−');
    txt($('#o-mu'), `${f(mx.mean)} + ${f(mh.mean)} = ${f(my.mean)}`);
    txt($('#o-var'), `${f(mx.vari)} + ${f(mh.vari)} = ${f(my.vari)}`);
  } else {
    txt($('#o-mu'), '—');
    txt($('#o-var'), '—');
  }
  $('#lg-h').textContent = flipOn ? '核 h（反転して t へ）' : '核 h（反転せずに t へ）';
}
function update(): void {
  const mode = modeCh.value;
  /* 行の出し入れ: 幅は連続と離散で別の行、サイコロでは幅の代わりに数 */
  const dice = xsCh.value === 'dice';
  $('#p-xa').hidden = mode !== 'c';
  $('#p-xn').hidden = mode !== 'd' || dice;
  $('#p-ha').hidden = mode !== 'c';
  $('#p-hn').hidden = mode !== 'd' || dice;
  $('#p-dn').hidden = !dice;
  for (const [ch, w] of [
    [xsCh, 'x'],
    [hsCh, 'h'],
  ] as const)
    for (const b of $$<HTMLButtonElement>('button[data-v]', ch.root)) {
      const v = b.dataset.v;
      b.disabled = (v === 'dice' && mode === 'c') || (v === 'hand' && !HAND[mode][w]);
    }
  compute();
  drawStatic();
  draw();
}

/* ---------- なぞって描く ---------- */
function bindDraw(el: SVGSVGElement, which: Which): void {
  let last: [number, number] | null = null;
  const put = (e: PointerEvent) => {
    const f = frameOf(el);
    if (!f) return;
    const r = el.getBoundingClientRect(),
      u = ((e.clientX - r.left) / r.width) * f.W,
      w = ((e.clientY - r.top) / r.height) * f.H,
      tt = f.xr[0] + ((u - f.L) / (f.W - f.L - f.R)) * (f.xr[1] - f.xr[0]),
      v = Math.max(f.yr[0], Math.min(f.yr[1], f.yr[1] - ((w - f.T) / (f.H - f.T - f.B)) * (f.yr[1] - f.yr[0]))),
      mode = modeCh.value,
      g = GRID[mode][which],
      ch = which === 'x' ? xsCh : hsCh;
    if (ch.value !== 'hand' || !HAND[mode][which]) {
      /* 今の形から描き始める（インパルスは面積の高さにする） */
      const s = which === 'x' ? F.x : F.h;
      HAND[mode][which] = Float64Array.from(s.v, (q) => (Math.abs(q) >= 8 ? q * g[1] : q));
      ch.set('hand');
      if (which === 'x' && hsCh.value === 'dice') hsCh.set('exp');
      if (which === 'h' && xsCh.value === 'dice') xsCh.set('rect');
    }
    const H = HAND[mode][which];
    if (!H) return;
    const i = Math.round((tt - g[0]) / g[1]);
    if (mode === 'd') {
      if (i >= 0 && i < g[2]) H[i] = Math.round(v * 20) / 20;
    } else {
      const [i0, v0] = last ?? [i, v],
        lo = Math.max(0, Math.min(i0, i)),
        hi = Math.min(g[2] - 1, Math.max(i0, i));
      for (let k = lo; k <= hi; k++) H[k] = i === i0 ? v : v0 + ((v - v0) * (k - i0)) / (i - i0);
      last = [i, v];
    }
    update();
  };
  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId);
    last = null;
    put(e);
  });
  el.addEventListener('pointermove', (e) => {
    if (el.hasPointerCapture(e.pointerId)) put(e);
  });
}
bindDraw(mnX, 'x');
bindDraw(mnH, 'h');

/* ---------- 滑らせる ---------- */
let running = false,
  raf = 0,
  last = 0,
  acc = 0;
function setT(v: number): void {
  const [a, b] = F.tr;
  t = Math.min(b, Math.max(a, v));
  draw();
}
function loop(now: number): void {
  raf = 0;
  if (!running) return;
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)),
    mode = modeCh.value,
    [, b] = F.tr;
  last = now;
  if (mode === 'c') t += dt * SPEED.c;
  else {
    /* 離散は 1 点ずつ */
    acc += dt * SPEED.d;
    while (acc >= 1) {
      acc -= 1;
      t += 1;
    }
  }
  if (t >= b) {
    t = b;
    setRun(false);
  }
  draw();
  if (running) raf = requestAnimationFrame(loop);
}
function setRun(on: boolean): void {
  running = on;
  const pp = $('#tp-pp');
  pp.classList.toggle('on', on);
  pp.title = on ? '止める' : '滑らせる';
  pp.setAttribute('aria-label', on ? '止める' : '滑らせる');
  if (on && !raf) {
    last = performance.now();
    acc = 0;
    raf = requestAnimationFrame(loop);
  }
}
$('#tp-pp').addEventListener('click', () => {
  const [a, b] = F.tr;
  if (!running && t >= b - 1e-9) t = a;
  setRun(!running);
});
$('#tp-home').addEventListener('click', () => {
  setRun(false);
  setT(F.tr[0]);
});
$('#tp-step').addEventListener('click', () => {
  setRun(false);
  const m = modeCh.value;
  setT(m === 'd' ? Math.round(t) + 1 : Math.round((t + STEP.c) * 100) / 100);
});
const trk = $('#tp-trk');
const fromX = (e: PointerEvent) => {
  const r = trk.getBoundingClientRect(),
    [a, b] = F.tr,
    v = a + Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (b - a);
  setT(modeCh.value === 'd' ? Math.round(v) : v);
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
  const m = modeCh.value,
    s = STEP[m] * (e.shiftKey ? 10 : 1),
    [a, b] = F.tr,
    d = { ArrowRight: s, ArrowUp: s, ArrowLeft: -s, ArrowDown: -s }[e.key];
  if (d != null) setT(m === 'd' ? Math.round(t + d) : Math.round((t + d) * 100) / 100);
  else if (e.key === 'Home') setT(a);
  else if (e.key === 'End') setT(b);
  else return;
  e.preventDefault();
  setRun(false);
});

/* 画面の幅が変わったら大きい図の幅を合わせる */
let rz = 0;
addEventListener('resize', () => {
  cancelAnimationFrame(rz);
  rz = requestAnimationFrame(() => {
    const w = figW();
    if (w !== F.w) {
      F.w = w;
      draw();
    }
  });
});

/* ---------- 起動 ---------- */
ready = true;
update();
/* 保存した値を戻したあと（マイクロタスク）にもう一度合わせ、動きを減らす設定でなければ滑らせる */
queueMicrotask(() => {
  /* 手描きは保存しない。保存した選択が使えなければ見本へ戻す */
  const m = modeCh.value;
  if (xsCh.value === 'hand' || (m === 'c' && xsCh.value === 'dice')) xsCh.set('rect');
  if (hsCh.value === 'hand' || (m === 'c' && hsCh.value === 'dice')) hsCh.set('exp');
  if ((xsCh.value === 'dice') !== (hsCh.value === 'dice')) {
    xsCh.set('rect');
    hsCh.set('exp');
  }
  t = T0[m];
  update();
  if (!RM.matches) {
    t = F.tr[0];
    setRun(true);
  }
});
