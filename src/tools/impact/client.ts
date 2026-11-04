/**
 * 天体衝突のページの入口。条件を変えるとワーカーで計算し直す。再生は押したときだけ始める。
 * 計算の途中で再生すると、できたコマまで進んで続きを待つ
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { RM } from '../../lib/motion';
import { ParamGroup } from '../../lib/param';
import { initToolPage } from '../../lib/tool-page';
import { bodyView, CrossFig, craterView, defaultView, PRE_N, RATIO, type View, zoomLimits } from './fig';
import { BODIES, type BodyKey, type Condition, EJECTA, type ImpactorKey, plan, type TargetKey } from './model';
import { fmtLen, fmtMt, fmtT, PARAMS, type PKey, PRESETS, sci } from './params';
import { addFrame, analyze, type Run } from './run';
import type { Out } from './worker';

initToolPage();

/** 標準の速さで 1 コマにかける時間 [ms] */
const MS_PER_FRAME = 130,
  FRAG_N = 14000;

const cv = $<HTMLCanvasElement>('#ip-cv'),
  fig = new CrossFig(cv),
  panel = $('#ip-fig');

const S = {
  L: 1000,
  v: 20,
  th: 45,
  imp: 'stone' as ImpactorKey,
  body: 'earth' as BodyKey,
  air: true,
  tgt: 'rock' as TargetKey,
  q: 70,
};
let run: Run | null = null,
  worker: Worker | null = null,
  fi = 0,
  playing = false,
  rate = 1,
  dirty = true,
  lastTs = 0,
  t0 = 0,
  timer = 0,
  ready = false,
  view: View = { w: 1, cx: 0, cy: 0 },
  showP = true,
  showLines = false;

const cond = (): Condition => ({ ...S, air: S.air && BODIES[S.body].rho0 > 0 });

function start(): void {
  worker?.terminate();
  worker = null;
  const c = cond(),
    pl = plan(c),
    b = BODIES[c.body];
  run = {
    c,
    pl,
    info: null,
    frames: [],
    land: [],
    res: null,
    secs: 0,
    lastGrid: null,
    tFall: null,
    tr: null,
    trFixed: false,
    aMax: -1,
    aSeen: 0,
    mt: null,
    st: [0, 0, Infinity, Infinity, Infinity],
    col: null,
  };
  fi = -PRE_N;
  playing = false;
  dirty = true;
  showOut();
  if (pl.e.kind === 'airburst') return;
  t0 = performance.now();
  const r = run,
    w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker = w;
  w.onmessage = (e: MessageEvent<Out>) => {
    if (r !== run) return;
    const m = e.data;
    if (m.kind === 'info') {
      r.info = m.info;
      view = defaultView(r);
    } else if (m.kind === 'frame') {
      addFrame(r, m.f);
      analyze(r);
    } else {
      r.res = m.r;
      r.secs = (performance.now() - t0) / 1000;
      analyze(r);
      w.terminate();
      worker = null;
      showOut();
    }
    dirty = true;
  };
  w.postMessage({
    D: pl.domain,
    Lc: pl.Lc,
    v: pl.vS,
    thetaDeg: c.th,
    g: b.g,
    target: c.tgt,
    impactor: c.imp,
    airRho: c.air ? b.rho0 : 0,
    atmH: b.H,
    R: b.R,
    dxN: c.q,
    cVib: pl.cVib,
    tMaxF: 6,
    ej: { law: EJECTA[c.tgt], a: c.L / 2, Rc: pl.size / 2, n: FRAG_N },
  });
}
const later = () => {
  clearTimeout(timer);
  timer = window.setTimeout(start, 300);
  showOut();
  syncPresets();
};

/* ---------- 入力 ---------- */
const P = new ParamGroup<PKey>(PARAMS, (v) => {
  S.L = v.L;
  S.v = v.v;
  S.th = v.th;
  if (ready) later();
});
const cImp = new Choice<ImpactorKey>($('#p-imp'), (v) => {
    S.imp = v;
    later();
  }),
  cBody = new Choice<BodyKey>($('#p-body'), (v) => {
    S.body = v;
    syncAir();
    later();
  }),
  cAir = new Choice<'1' | '0'>($('#p-air'), (v) => {
    S.air = v === '1';
    later();
  }),
  cTgt = new Choice<TargetKey>($('#p-tgt'), (v) => {
    S.tgt = v;
    later();
  });
new Choice<'70' | '100' | '140'>($('#p-q'), (v) => {
  S.q = +v;
  later();
});
function syncAir(): void {
  cAir.setOff(BODIES[S.body].rho0 === 0, '大気なし');
}
S.imp = cImp.value;
S.body = cBody.value;
S.air = cAir.value === '1';
S.tgt = cTgt.value;
S.q = +(new Choice<string>($('#p-q')).value || 70);
syncAir();

const preBox = $('#ip-pre');
function syncPresets(): void {
  $$('button', preBox).forEach((b, i) => {
    const p = PRESETS[i],
      on =
        p.L === S.L &&
        p.v === S.v &&
        p.th === S.th &&
        p.imp === S.imp &&
        p.body === S.body &&
        p.tgt === S.tgt &&
        (S.air || BODIES[S.body].rho0 === 0);
    b.setAttribute('aria-pressed', String(on));
  });
}
preBox.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button[data-i]');
  if (!b) return;
  const p = PRESETS[Number(b.dataset.i)];
  P.set('L', p.L, { silent: true });
  P.set('v', p.v, { silent: true });
  P.set('th', p.th, { silent: true });
  cImp.choose(p.imp);
  cBody.choose(p.body);
  cTgt.choose(p.tgt);
  cAir.choose('1');
  Object.assign(S, { L: p.L, v: p.v, th: p.th, imp: p.imp, body: p.body, tgt: p.tgt, air: true });
  syncAir();
  syncPresets();
  clearTimeout(timer);
  start();
});

/* ---------- 表示の切り替え ---------- */
new Choice<'1' | '0'>($('#ip-p'), (v) => {
  showP = v === '1';
  dirty = true;
});
new Choice<'1' | '0'>($('#ip-l'), (v) => {
  showLines = v === '1';
  panel.classList.toggle('lines', showLines);
  dirty = true;
});
new Choice<string>($('#ip-rate'), (v) => {
  rate = +v;
});
rate = +new Choice<string>($('#ip-rate')).value;
$('#ip-range').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button[data-v]');
  if (!b || !run?.info) return;
  view = b.dataset.v === 'crater' ? craterView(run) : b.dataset.v === 'body' ? bodyView(run) : defaultView(run);
  dirty = true;
});

/* ---------- 図の操作: ホイール・2 本指で拡大と縮小、ドラッグで移動 ---------- */
function zoomAt(w: number, ax: number, ay: number): void {
  if (!run?.info) return;
  const [lo, hi] = zoomLimits(run),
    nw = Math.max(lo, Math.min(hi, w)),
    k = view.w - nw;
  view.cx += ax * k;
  view.cy -= ay * k;
  view.w = nw;
  dirty = true;
}
const relX = (x: number, b: DOMRect) => (x - b.left) / b.width - 0.5,
  relY = (y: number, b: DOMRect) => ((y - b.top) / b.height - 0.5) * RATIO;
cv.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const b = cv.getBoundingClientRect();
    zoomAt(view.w * Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), relX(e.clientX, b), relY(e.clientY, b));
  },
  { passive: false },
);
const pts = new Map<number, [number, number]>();
let pinch = 0;
cv.addEventListener('pointerdown', (e) => {
  cv.setPointerCapture(e.pointerId);
  pts.set(e.pointerId, [e.clientX, e.clientY]);
  pinch = 0;
  cv.classList.add('drag');
});
cv.addEventListener('pointermove', (e) => {
  const p = pts.get(e.pointerId);
  if (!p) return;
  const b = cv.getBoundingClientRect();
  if (pts.size === 1) {
    view.cx -= ((e.clientX - p[0]) / b.width) * view.w;
    view.cy += ((e.clientY - p[1]) / b.width) * view.w;
    dirty = true;
  }
  pts.set(e.pointerId, [e.clientX, e.clientY]);
  if (pts.size === 2) {
    const [a, c] = [...pts.values()],
      dist = Math.hypot(a[0] - c[0], a[1] - c[1]);
    if (pinch) zoomAt((view.w * pinch) / dist, relX((a[0] + c[0]) / 2, b), relY((a[1] + c[1]) / 2, b));
    pinch = dist;
  }
});
const ptrEnd = (e: PointerEvent) => {
  pts.delete(e.pointerId);
  pinch = 0;
  cv.classList.remove('drag');
};
cv.addEventListener('pointerup', ptrEnd);
cv.addEventListener('pointercancel', ptrEnd);

/* ---------- 再生 ---------- */
const nFrames = () => run?.frames.length ?? 0;
function setFi(i: number): void {
  playing = false;
  fi = Math.max(0, Math.min(nFrames() - 1, i));
  dirty = true;
}
const pp = $('#ip-pp');
pp.addEventListener('click', () => {
  if (!nFrames()) return;
  if (playing) playing = false;
  else {
    if (fi >= nFrames() - 1) fi = -PRE_N;
    playing = true;
  }
  dirty = true;
});
$('#ip-home').addEventListener('click', () => {
  playing = false;
  fi = -PRE_N;
  dirty = true;
});
const trk = $('#ip-trk');
let seeking = false;
const seek = (e: PointerEvent) => {
  const b = trk.getBoundingClientRect();
  setFi(((e.clientX - b.left) / b.width) * (nFrames() - 1));
};
trk.addEventListener('pointerdown', (e) => {
  seeking = true;
  trk.setPointerCapture(e.pointerId);
  seek(e);
});
trk.addEventListener('pointermove', (e) => {
  if (seeking) seek(e);
});
trk.addEventListener('pointerup', () => {
  seeking = false;
});
trk.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') setFi(Math.floor(fi) + 1);
  else if (e.key === 'ArrowLeft') setFi(Math.ceil(fi) - 1);
  else return;
  e.preventDefault();
});
const stBox = $('#ip-st');
stBox.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button[data-i]');
  const r = run;
  if (!b || !r || !nFrames()) return;
  const i = Number(b.dataset.i),
    k = r.frames.findIndex((f) => f.t >= r.st[i]);
  setFi(k < 0 ? nFrames() - 1 : k);
});

/* ---------- 表示 ---------- */
const stageBtns = $$('button', stBox),
  stageT = stageBtns.map((b) => b.querySelector('span') as HTMLElement),
  ledEl = $('#ip-led'),
  stEl = $('#ip-state'),
  tagEl = $('#ip-tag'),
  msgEl = $('#ip-msg'),
  fillEl = $('#ip-fill'),
  thEl = $('#ip-th'),
  nowEl = $('#ip-now'),
  endEl = $('#ip-end');

function paint(): void {
  const r = run;
  if (!r) return;
  const frames = r.frames,
    n = frames.length,
    burst = r.pl.e.kind === 'airburst';
  const i0 = Math.max(0, Math.floor(fi)),
    f = frames[i0],
    next = frames[Math.min(n - 1, i0 + 1)],
    t = f ? f.t + (next.t - f.t) * Math.max(0, fi - i0) : 0,
    working = !burst && !r.res;
  ledEl.classList.toggle('on', working);
  panel.classList.toggle('busy', working);
  stEl.textContent = burst
    ? ''
    : working
      ? r.tFall != null
        ? '噴出物を計算中…'
        : `計算中… ${n && r.info ? Math.min(95, ((frames[n - 1].t / r.info.Tg / 3) ** 0.5 * 100) | 0) : 0}%`
      : `計算 ${r.secs.toFixed(0)} 秒・${r.info?.n.toLocaleString('en-US')} 粒子`;
  msgEl.hidden = !burst;
  if (burst) fig.clear();
  else fig.draw(r, fi, view, { showP, showLines, flash: !RM.matches });
  const tag = burst || !f || fi < 0 ? '' : `衝突から ${fmtT(t)}`;
  tagEl.textContent = tag;
  tagEl.hidden = !tag;
  let cur = 0;
  for (let i = 0; i < 5; i++) if (t >= r.st[i]) cur = i;
  stageBtns.forEach((b, i) => {
    b.setAttribute('aria-pressed', String(!burst && i === cur));
    stageT[i].textContent = r.st[i] < Infinity ? (i === 0 ? '0 秒〜' : `${fmtT(r.st[i])}〜`) : '—';
  });
  const pos = n > 1 ? Math.max(fi, 0) / (n - 1) : 0;
  fillEl.style.width = `${pos * 100}%`;
  thEl.style.left = `${pos * 100}%`;
  trk.setAttribute('aria-valuenow', pos.toFixed(3));
  nowEl.textContent = burst ? '' : `衝突から ${fi < 0 ? '0 秒' : fmtT(t)}`;
  endEl.textContent = burst ? '' : r.res && n ? fmtT(frames[n - 1].t) : '計算中';
  pp.classList.toggle('on', playing);
  pp.title = playing ? '一時停止' : '再生';
  pp.setAttribute('aria-label', pp.title);
}

/** 計算結果の枠 */
const O = {
  d: $('#o-d'),
  ds: $('#o-ds'),
  dp: $('#o-dp'),
  dps: $('#o-dps'),
  kind: $('#o-kind'),
  kinds: $('#o-kinds'),
  v: $('#o-v'),
  vs: $('#o-vs'),
  far: $('#o-far'),
  fars: $('#o-fars'),
  t: $('#o-t'),
  ts: $('#o-ts'),
  esc: $('#o-esc'),
  escs: $('#o-escs'),
  e: $('#o-e'),
  es: $('#o-es'),
};
function showOut(): void {
  const c = cond(),
    pl = plan(c),
    same = !!run?.res && JSON.stringify(run.c) === JSON.stringify(c),
    m = same ? run?.mt : null,
    res = same ? run?.res : null,
    burst = pl.e.kind === 'airburst',
    wait = burst ? '—' : '計算中',
    /* 文献の式は天体より十分小さいクレーターのもの */
    inRange = pl.f.Dfr < BODIES[c.body].R;
  O.d.textContent = m ? fmtLen(m.D) : wait;
  O.ds.textContent = burst ? '空中で爆発' : inRange ? `文献の式 ${fmtLen(pl.f.Dfr)}` : '文献の式の範囲外';
  O.dp.textContent = m ? fmtLen(m.depth) : wait;
  O.dps.textContent = burst || !inRange ? '' : `文献の式 ${fmtLen(pl.f.dfr)}`;
  O.kind.textContent = burst || c.tgt === 'water' ? '—' : pl.f.kind;
  O.kinds.textContent = burst || c.tgt === 'water' || !inRange ? '' : `${fmtLen(pl.f.Dc)} から複雑クレーター`;
  O.v.textContent = `${(pl.e.v / 1000).toFixed(1)} km/s`;
  O.vs.textContent =
    pl.e.kind === 'none'
      ? '大気なし'
      : pl.e.zs != null
        ? `高度 ${(pl.e.zs / 1000).toFixed(0)} km で砕ける`
        : '砕けない';
  O.far.textContent = res ? fmtLen(res.farS) : wait;
  O.fars.textContent = '';
  O.t.textContent = res ? fmtT(res.tDone) : wait;
  O.ts.textContent = res ? `崩壊の終わり ${fmtT(res.tFall)}` : '';
  O.esc.textContent = res ? `${(res.escFrac * 100).toFixed(1)}%` : wait;
  O.escs.textContent = res ? `軌道に残った物 ${(res.orbitFrac * 100).toFixed(1)}%（${fmtT(res.t)} 後）` : '';
  O.e.textContent = fmtMt(pl.E);
  O.es.textContent = `広島型原爆の約 ${sci(pl.E / 6.3e13)} 倍`;
}

function frame(ts: number): void {
  const dt = Math.min(100, ts - lastTs);
  lastTs = ts;
  if (playing) {
    const n = nFrames();
    if (fi >= n - 1) {
      if (run?.res) playing = false;
    } else fi = Math.min(n - 1, fi + (dt / MS_PER_FRAME) * rate);
    dirty = true;
  }
  if (dirty) {
    dirty = false;
    paint();
  }
  requestAnimationFrame(frame);
}
new ResizeObserver(() => {
  dirty = true;
}).observe(cv);

/* 保存した値は ParamGroup と Choice がマイクロタスクで戻すので、そのあとに始める */
queueMicrotask(() => {
  const v = P.values();
  S.L = v.L;
  S.v = v.v;
  S.th = v.th;
  ready = true;
  syncPresets();
  start();
  requestAnimationFrame(frame);
});
