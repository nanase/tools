/**
 * クラスタリングのページの入口。計算は Worker で行い、手順の記録（Run）を時刻に合わせて図にする。
 * 表示は 単独（大きな図 1 枚）・比較（最大 9 個を同時に）・一覧（手法 × データの格子）の 3 つ。
 * データの「描画」では、描いた色を正解として同じ 3 つの表示で調べられる
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { RM } from '../../lib/motion';
import { ParamGroup } from '../../lib/param';
import { store, stored, storeToggle } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { type Data, frameAt, type Params, type Run, range, rng, shuffle } from './core';
import { BOX, ctxOf, DATA, type DataId, dataOf, drawnData, makeData } from './data';
import {
  cutHeight,
  dendroCut,
  dendroY,
  drawCanvas,
  drawRun,
  drawTruth,
  markerSvg,
  prepare,
  readColors,
  sideBox,
  toBox,
} from './fig';
import { DEF_SEL, findMethod, METHODS, methodOf } from './methods';
import { METHOD_PARAMS, OUTLIER, SIZE } from './params';
import type { Job, Out } from './worker';

initToolPage();

type Mode = 'one' | 'cmp' | 'list';
type Axis = 'method' | 'data';

const MAX_CMP = 9;
/** 比較と一覧の再生の長さ [ms]。手法ごとの手順の数によらず同時に終わる */
const SYNC_T = 9000;
/** 一覧の点の数とコマの数の上限 */
const LIST_N = 150;
const LIST_FRAMES = 48;
const MAX_DRAW = 3000;
/** 比較と一覧で使う描いた点の数の上限。多くのマスを速く出すため。パラメータは抽出した点の間隔から決まる */
const LIM_CMP = 1000;
const LIM_LIST = 300;
const MIN_POINTS = 8;
const CMP_DATA = DATA.map((d) => d.id as string);

/* ---------- 状態 ---------- */
const root = $('#cl');
const S = {
  m: findMethod(String(stored('m')))?.id ?? 'kmeans',
  d: stored('d') === 'draw' ? 'draw' : ((dataOf(String(stored('d')))?.id ?? 'blobs') as string),
  n: SIZE.v,
  out: 0,
  seed: 1,
  sel: Array.isArray(stored('sel'))
    ? (stored('sel') as string[]).filter((v) => findMethod(v)).slice(0, MAX_CMP)
    : [...DEF_SEL],
  regions: true,
};
if (!S.sel.length) S.sel = [...DEF_SEL];
interface Drawn {
  x: number[];
  y: number[];
  t: number[];
}
const draw: Drawn & { ver: number; brush: number; size: number; tool: 'draw' | 'play' } = {
  x: [],
  y: [],
  t: [],
  ver: 0,
  brush: 0,
  size: 0.07,
  tool: 'draw',
};
{
  const sv = stored('draw') as Drawn | undefined;
  if (sv && Array.isArray(sv.x) && sv.x.length === sv.y?.length && sv.x.length === sv.t?.length) {
    draw.x = sv.x.slice(0, MAX_DRAW);
    draw.y = sv.y.slice(0, MAX_DRAW);
    draw.t = sv.t.slice(0, MAX_DRAW);
  }
}
let booted = false;
let run: Run | null = null;

/* ---------- データ ---------- */
const dataCache = new Map<string, Data>();
function getData(id: string, n: number, seed: number, out = 0, lim = 0): Data {
  const k = id === 'draw' ? `draw:${draw.ver}:${lim}` : `${id}:${n}:${seed}:${out}`;
  let d = dataCache.get(k);
  if (!d) {
    if (id === 'draw') {
      const m = draw.x.length,
        ix = lim && m > lim ? shuffle(range(m), rng(draw.ver + 7)).slice(0, lim) : range(m);
      d = drawnData(
        ix.map((i) => draw.x[i]),
        ix.map((i) => draw.y[i]),
        ix.map((i) => draw.t[i]),
      );
    } else d = makeData(id as DataId, n, seed, out / 100);
    if (dataCache.size > 200) dataCache.clear();
    dataCache.set(k, d);
  }
  return d;
}
const curData = (): Data => getData(S.d, S.n, S.seed, S.out);
const hasDraw = (): boolean => draw.x.length >= MIN_POINTS;
const isDrawing = (): boolean => S.d === 'draw' && draw.tool === 'draw' && mode === 'one';

/* ---------- パラメータ: 手法とデータの組ごとに持つ ---------- */
const P = new Map<string, Params>();
const paramsOf = (mid: string, d: Data): Params => {
  const k = `${mid}:${d.id}:${d.n}`;
  let p = P.get(k);
  if (!p) {
    p = methodOf(mid).def(ctxOf(d));
    P.set(k, p);
  }
  return p;
};

/* ---------- 計算の Worker ---------- */
interface Req {
  key: string;
  job: Omit<Job, 'id'>;
  cbs: ((r: Run) => void)[];
}
const POOL = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
const runCache = new Map<string, Run>();
const queue: Req[] = [];
const pending = new Map<string, Req>();
const idle: Worker[] = [];
const active = new Map<number, Req>();
let jobId = 0;
function dispatch(): void {
  while (queue.length) {
    let w = idle.pop();
    if (!w && active.size < POOL) {
      w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = onResult;
    }
    if (!w) return;
    const r = queue.shift() as Req,
      id = ++jobId;
    active.set(id, r);
    const job: Job = { ...r.job, id };
    w.postMessage(job);
  }
}
function onResult(this: Worker, e: MessageEvent<Out>): void {
  const r = active.get(e.data.id);
  active.delete(e.data.id);
  idle.push(this);
  if (r) {
    if (runCache.size > 600) runCache.delete(runCache.keys().next().value as string);
    runCache.set(r.key, e.data.run);
    pending.delete(r.key);
    for (const cb of r.cbs) cb(e.data.run);
  }
  dispatch();
}
/** 計算を頼む。結果があればすぐ返す。front は順番を先頭にする */
function request(mid: string, d: Data, p: Params, max: number, front: boolean, cb: (r: Run) => void): void {
  const q: Params = { ...p, seed: S.seed },
    key = JSON.stringify([mid, d.id === 'draw' ? `draw:${draw.ver}` : `${d.id}:${d.n}:${S.out}`, q, max, d.n]),
    got = runCache.get(key);
  if (got) {
    cb(got);
    return;
  }
  const had = pending.get(key);
  if (had) {
    had.cbs.push(cb);
    if (front) {
      const at = queue.indexOf(had);
      if (at > 0) {
        queue.splice(at, 1);
        queue.unshift(had);
      }
    }
    return;
  }
  const r: Req = { key, job: { mid, d, p: q, max }, cbs: [cb] };
  pending.set(key, r);
  if (front) queue.unshift(r);
  else queue.push(r);
  dispatch();
}
/** まだ始まっていない計算を捨てる */
function dropQueue(): void {
  for (const r of queue) pending.delete(r.key);
  queue.length = 0;
}

/* ---------- 再生 ---------- */
const T = { ms: 0, on: false, sp: 1 };
let last = 0,
  raf = 0;
const total = (): number => (mode === 'one' ? run?.T || 1 : SYNC_T);
function setPlay(on: boolean): void {
  T.on = on;
  const b = $('#tp-pp'),
    t = on ? '一時停止' : '再生';
  b.classList.toggle('on', on);
  b.title = t;
  b.setAttribute('aria-label', t);
  if (on) {
    if (T.ms >= total()) T.ms = 0;
    last = performance.now();
    kick();
  }
  syncStatus();
}
function kick(): void {
  if (!raf) raf = requestAnimationFrame(tick);
}
function tick(now: number): void {
  raf = 0;
  const dt = Math.min(100, Math.max(0, now - last));
  last = now;
  if (T.on) {
    T.ms += dt * T.sp;
    if (T.ms >= total()) {
      T.ms = total();
      setPlay(false);
    }
    paint();
    if (T.on) kick();
  }
}
/** 開いた直後や選び直した直後は、動きを減らす設定でなければ再生する */
function autoStart(): void {
  if (RM.matches) {
    T.ms = total();
    setPlay(false);
  } else {
    T.ms = 0;
    setPlay(true);
  }
  paint();
}
function seek(ms: number): void {
  T.ms = Math.max(0, Math.min(total(), ms));
  paint();
}
function stepBy(dir: number): void {
  setPlay(false);
  if (mode === 'one' && run) {
    const j = Math.max(0, Math.min(run.frames.length - 1, frameAt(run, T.ms) + dir));
    seek(j ? run.t[j - 1] + 0.01 : 0);
  } else seek(T.ms + (dir * SYNC_T) / 60);
}
$('#tp-pp').addEventListener('click', () => setPlay(!T.on));
$('#tp-home').addEventListener('click', () => seek(0));
$('#tp-back').addEventListener('click', () => stepBy(-1));
$('#tp-step').addEventListener('click', () => stepBy(1));
{
  const trk = $('#tp-trk'),
    at = (e: PointerEvent): number => {
      const b = trk.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - b.left) / Math.max(1, b.width))) * total();
    };
  trk.addEventListener('pointerdown', (e) => {
    trk.setPointerCapture(e.pointerId);
    setPlay(false);
    seek(at(e));
  });
  trk.addEventListener('pointermove', (e) => {
    if (trk.hasPointerCapture(e.pointerId)) seek(at(e));
  });
  trk.addEventListener('keydown', (e) => {
    const big = total() / 20,
      to = {
        ArrowLeft: -1,
        ArrowDown: -1,
        ArrowRight: 1,
        ArrowUp: 1,
      }[e.key];
    if (to !== undefined) {
      e.preventDefault();
      stepBy(to);
    } else if (e.key === 'PageDown' || e.key === 'PageUp' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setPlay(false);
      seek(e.key === 'Home' ? 0 : e.key === 'End' ? total() : T.ms + (e.key === 'PageUp' ? big : -big));
    }
  });
}
const speedCh = new Choice<string>($('#cl-sp'), (v) => {
  T.sp = Number(v);
});

/* ---------- 描く ---------- */
const mainCv = $<HTMLCanvasElement>('#cl-cv');
function syncTrack(): void {
  const t = total(),
    u = Math.min(1, T.ms / t),
    pc = `${(u * 100).toFixed(2)}%`;
  $('#tp-fill').style.width = pc;
  $('#tp-th').style.left = pc;
  const trk = $('#tp-trk');
  trk.setAttribute('aria-valuenow', u.toFixed(3));
  const a = $('#tp-a');
  if (mode === 'one' && run) {
    const s = `${frameAt(run, T.ms) + 1} / ${run.frames.length} 手順`;
    if (a.textContent !== s) a.textContent = s;
  } else {
    const s = `${Math.round(u * 100)} %`;
    if (a.textContent !== s) a.textContent = s;
  }
}
function syncStatus(): void {
  const t = $('#cl-stT'),
    led = $('#cl-led'),
    wait = mode === 'one' && !isDrawing() && !run,
    txt = isDrawing()
      ? ''
      : wait
        ? '計算中'
        : T.on
          ? '実行中'
          : T.ms >= total()
            ? '完了'
            : T.ms > 0
              ? '一時停止中'
              : '';
  led.className = `led${T.on ? ' on' : txt === '完了' ? ' cl-ok' : txt ? ' half' : ''}`;
  if (t.textContent !== txt) t.textContent = txt;
  $('#cl-st').hidden = !txt;
}
function paint(): void {
  syncTrack();
  syncStatus();
  const u = Math.min(1, T.ms / total());
  if (mode === 'one') paintOne();
  else if (mode === 'cmp') paintCmp(u);
  else paintList(u);
}
function paintOne(): void {
  if (isDrawing()) {
    drawCanvas(mainCv, draw.x, draw.y, draw.t);
    const cnt = $('#cl-cnt');
    cnt.textContent = `${fmtN(draw.x.length)} / ${fmtN(MAX_DRAW)} 点`;
    cnt.classList.toggle('max', draw.x.length >= MAX_DRAW);
    setSay('');
    return;
  }
  if (!run) return;
  const fi = frameAt(run, T.ms),
    fr = run.frames[fi];
  drawRun(mainCv, run, fi, { regions: S.regions });
  setSay(fr.say);
  for (const b of $$('.cl-step')) b.classList.toggle('on', Number(b.dataset.st) === fr.st);
}
function setSay(s: string): void {
  const el = $('#cl-say');
  if (el.textContent !== s) el.textContent = s;
}

/* ---------- 単独: 計算結果としくみ ---------- */
function syncLegend(): void {
  const host = $('#cl-lg');
  host.textContent = '';
  if (isDrawing()) {
    addKey(host, 'dot', '色ごとのまとまりが正解');
    return;
  }
  const M = methodOf(S.m);
  for (const [cls, t] of M.leg) addKey(host, cls, t);
}
function addKey(host: HTMLElement, cls: string, t: string): void {
  const s = document.createElement('span'),
    i = document.createElement('i');
  s.className = 'stag';
  i.className = `cl-k ${cls}`;
  i.setAttribute('aria-hidden', 'true');
  s.append(i, t);
  host.append(s);
}
const fmtN = (v: number): string => v.toLocaleString('en-US');
function syncResult(r: Run): void {
  const samp = $('#cl-samp');
  samp.hidden = !r.full;
  if (r.full) samp.textContent = `全 ${fmtN(r.full.n)} 点から ${fmtN(r.d.n)} 点を抽出して計算`;
  $('#o-ari').textContent = r.ari === null ? '–' : r.ari.toFixed(2);
  $('#o-nc').textContent = String(r.nc);
  $('#o-nz').textContent = String(r.noise);
  $('#o-it').textContent = fmtN(r.iters);
  $('#o-di').textContent = fmtN(r.dist);
  $('#m-sse').hidden = r.sse === undefined;
  $('#m-ll').hidden = r.ll === undefined;
  if (r.sse !== undefined) $('#o-sse').textContent = r.sse.toFixed(2);
  if (r.ll !== undefined) $('#o-ll').textContent = r.ll.toFixed(2);
  const cnt = new Map<number, number>();
  for (const v of r.labels) if (v >= 0) cnt.set(v, (cnt.get(v) ?? 0) + 1);
  const rows = [...cnt.entries()].sort((a, b) => a[0] - b[0]),
    show = rows.filter(([c]) => c < 8),
    rest = rows.filter(([c]) => c >= 8).reduce((s, x) => s + x[1], 0),
    max = Math.max(1, ...rows.map((x) => x[1]));
  $('#o-sz').innerHTML =
    show
      .map(
        ([c, n]) =>
          `<div class="cl-szr">${markerSvg(c)}<span>クラスタ ${c + 1}</span><i style="width:${(n / max) * 100}%;background:var(--cl-${c})"></i><span>${fmtN(n)}</span></div>`,
      )
      .join('') +
    (rest
      ? `<div class="cl-szr"><span class="cl-k dot" aria-hidden="true"></span><span>その他</span><i style="width:${(rest / max) * 100}%;background:var(--screen-ink)"></i><span>${fmtN(rest)}</span></div>`
      : '');
}
function syncSteps(r: Run): void {
  const host = $('#cl-steps'),
    steps = methodOf(S.m).steps,
    first = new Map<number, number>(),
    lastF = new Map<number, number>();
  r.frames.forEach((f, i) => {
    if (!first.has(f.st)) first.set(f.st, i);
    lastF.set(f.st, i);
  });
  host.textContent = '';
  steps.forEach(([h, t], st) => {
    const b = document.createElement('button'),
      cv = document.createElement('canvas'),
      tt = document.createElement('b'),
      em = document.createElement('em'),
      sp = document.createElement('span');
    b.type = 'button';
    b.className = 'cl-step';
    b.dataset.st = String(st);
    em.textContent = String(st + 1);
    tt.append(em, h);
    sp.textContent = t;
    b.append(cv, tt, sp);
    host.append(b);
  });
  /* 絵は全部のカードを並べて幅が決まってから描く */
  $$<HTMLButtonElement>('.cl-step', host).forEach((b, st) => {
    const cv = $<HTMLCanvasElement>('canvas', b),
      a = first.get(st);
    if (a === undefined) {
      /* その段階が起きなかったとき（ノイズなしなど）は最後の図を出す */
      b.disabled = true;
      drawRun(cv, r, r.frames.length - 1, { thumb: true });
      return;
    }
    const z = lastF.get(st) as number;
    drawRun(cv, r, st === 0 ? z : Math.round((a + z) / 2), { thumb: true });
    b.addEventListener('click', () => {
      setPlay(false);
      seek(a ? r.t[a - 1] + 0.01 : 0);
    });
  });
}
let wantOne = 0;
function loadOne(restart: boolean): void {
  const d = curData(),
    tk = ++wantOne;
  if (d.n < MIN_POINTS) {
    run = null;
    setPlay(false);
    prepare(mainCv);
    setSay(`点を ${MIN_POINTS} 個以上描画`);
    paint();
    return;
  }
  run = runIfSame(run, d);
  request(S.m, d, paramsOf(S.m, d), 0, true, (r) => {
    if (tk !== wantOne || mode !== 'one') return;
    const keepEnd = !restart;
    run = r;
    syncResult(r);
    syncSteps(r);
    if (keepEnd) {
      T.ms = r.T;
      paint();
    } else if (isDrawing()) paint();
    else autoStart();
  });
  syncStatus();
}
/* 切り替えの間は前の図を残すが、別のデータの図は残さない */
const runIfSame = (r: Run | null, d: Data): Run | null => (r && r.d.id === d.id && r.d.n === d.n ? r : null);
/** パラメータの変更は最後の結果をすぐ見せる */
function afterParam(): void {
  setPlay(false);
  loadOne(false);
}

/* ---------- パラメータの行 ---------- */
const METHOD_KEYS = METHOD_PARAMS.map((d) => d.k);
let syncing = false;
const pgM = new ParamGroup<string>(
  METHOD_PARAMS,
  (v, k) => {
    if (!booted || !k || syncing) return;
    paramsOf(S.m, curData())[k] = v[k];
    afterParam();
  },
  null,
  { save: false },
);
const CHOICE_KEYS = ['init', 'cov'];
const chs: Record<string, Choice<string>> = Object.fromEntries(
  CHOICE_KEYS.map((k) => [
    k,
    new Choice<string>($(`#p-${k}`), (v) => {
      if (!booted) return;
      paramsOf(S.m, curData())[k] = Number(v);
      afterParam();
    }),
  ]),
);
function syncParams(): void {
  const d = curData(),
    keys = d.n >= MIN_POINTS && mode === 'one' ? methodOf(S.m).keys : [],
    p = d.n >= MIN_POINTS ? paramsOf(S.m, d) : {},
    def = d.n >= MIN_POINTS ? methodOf(S.m).def(ctxOf(d)) : {};
  syncing = true;
  for (const k of METHOD_KEYS) {
    const on = keys.includes(k);
    $(`#p-${k}`).hidden = !on;
    if (on) {
      pgM.update(k, { v: def[k] });
      pgM.set(k, p[k], { silent: true });
    } else pgM.set(k, pgM.def(k).v, { silent: true });
  }
  for (const k of CHOICE_KEYS) {
    const on = keys.includes(k);
    $(`#p-${k}`).hidden = !on;
    if (on) chs[k].set(String(p[k]));
  }
  syncing = false;
  $('#cl-par').hidden = !keys.length;
}
const pgD = new ParamGroup<'n' | 'out'>([SIZE, OUTLIER], (v, k) => {
  S.n = v.n;
  S.out = v.out;
  if (!booted || !k) return;
  apply(true);
});

/* ---------- 比較 ---------- */
interface Cell {
  title: string;
  mid: string;
  did: string;
  run: Run | null;
  el: HTMLButtonElement;
  rank?: number;
}
let cells: Cell[] = [];
let cmpTok = 0;
const axisCh = new Choice<Axis>($('#cl-axis'), () => {
  if (booted) apply(true);
});
const byData = (): boolean => axisCh.value === 'data';
function buildCmp(): void {
  const host = $('#cl-cmp'),
    tok = ++cmpTok,
    items: [string, string, string][] = byData()
      ? [...CMP_DATA, ...(hasDraw() ? ['draw'] : [])].map((id) => [dataOf(id)?.name ?? '描画', S.m, id])
      : S.d === 'draw' && !hasDraw()
        ? []
        : S.sel.map((mid) => [methodOf(mid).name, mid, S.d]);
  host.style.setProperty('--cols', items.length > 6 ? '4' : '3');
  host.textContent = '';
  cells = items.map(([title, mid, did]) => {
    const el = document.createElement('button'),
      cv = document.createElement('canvas'),
      head = document.createElement('div'),
      nm = document.createElement('span'),
      em = document.createElement('em');
    el.type = 'button';
    el.className = 'cl-cell';
    head.className = 'cl-ch';
    nm.className = 'cl-cn';
    nm.textContent = title;
    head.append(nm, em);
    el.append(cv, head);
    host.append(el);
    const c: Cell = { title, mid, did, run: null, el };
    el.addEventListener('click', () => {
      S.m = c.mid;
      setData(c.did);
      if (S.d === 'draw') draw.tool = 'play';
      store('m', S.m);
      modeCh.choose('one');
      apply(true);
      figTop();
    });
    return c;
  });
  $('#o-rt').textContent = '';
  for (const c of cells) {
    const d = getData(c.did, S.n, S.seed, S.out, LIM_CMP);
    request(c.mid, d, paramsOf(c.mid, d), 0, false, (r) => {
      if (tok !== cmpTok) return;
      c.run = r;
      syncRanks();
      paintCmp(Math.min(1, T.ms / total()));
    });
  }
  setSay(items.length ? '' : `点を ${MIN_POINTS} 個以上描画`);
}
function syncRanks(): void {
  const done = cells.filter((c) => c.run),
    scored = done
      .filter((c) => (c.run as Run).ari !== null)
      .sort((a, b) => ((b.run as Run).ari as number) - ((a.run as Run).ari as number));
  let pv = '',
    pr = 0;
  scored.forEach((c, i) => {
    const v = ((c.run as Run).ari as number).toFixed(2);
    c.rank = v === pv ? pr : i + 1;
    pv = v;
    pr = c.rank;
  });
  for (const c of cells) {
    const r = c.run;
    if (!r) continue;
    $('em', c.el).textContent = r.ari === null ? `${r.nc} 個` : r.ari.toFixed(2);
    let b = c.el.querySelector<HTMLElement>('.cl-rk');
    if (c.rank && !b) {
      b = document.createElement('span');
      b.className = 'cl-rk';
      $('.cl-ch', c.el).prepend(b);
    }
    if (b && c.rank) {
      b.textContent = String(c.rank);
      b.classList.toggle('top', c.rank === 1);
    }
  }
  const rows = done.slice().sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  $('#o-rt').innerHTML =
    `<thead><tr><th>順位</th><th class="l">${byData() ? 'データ' : '手法'}</th><th>一致度</th><th>クラスタ数</th><th>ノイズ</th><th>反復回数</th><th>距離の計算</th></tr></thead><tbody>${rows
      .map((c) => {
        const r = c.run as Run;
        return `<tr><td>${c.rank ?? '–'}</td><td class="l">${c.title}</td><td>${r.ari === null ? '–' : r.ari.toFixed(2)}</td><td>${r.nc}</td><td>${r.noise}</td><td>${fmtN(r.iters)}</td><td>${fmtN(r.dist)}</td></tr>`;
      })
      .join('')}</tbody>`;
}
function paintCmp(u: number): void {
  for (const c of cells) {
    if (c.run)
      drawRun($<HTMLCanvasElement>('canvas', c.el), c.run, frameAt(c.run, u * c.run.T), {
        thumb: true,
        regions: S.regions,
      });
  }
}

/* ---------- 一覧: 見えているマスだけ計算する ---------- */
const famCh = new Choice<string>($('#cl-fam'), () => {
  if (booted && mode === 'list') buildList();
});
const cellRun = new WeakMap<Element, Run>(),
  cellFi = new WeakMap<Element, number>();
let listObs: IntersectionObserver | null = null,
  listLeft = 0,
  listTok = 0;
const listDatas = (): Data[] => [
  ...DATA.map((D) => getData(D.id, LIST_N, S.seed)),
  ...(hasDraw() ? [getData('draw', LIST_N, S.seed, 0, LIM_LIST)] : []),
];
function buildList(): void {
  const ds = listDatas(),
    fam = famCh.value,
    ms = METHODS.filter((m) => fam === 'all' || m.g === fam),
    head = `<thead><tr><th scope="col"></th>${ds
      .map(
        (d) =>
          `<th scope="col"><button type="button" data-col="${d.id}" title="このデータの上位 6 種を比較"><canvas data-truth="${d.id}"></canvas>${dataOf(d.id)?.name ?? '描画'}</button></th>`,
      )
      .join('')}</tr></thead>`;
  let body = '',
    g0 = '';
  for (const m of ms) {
    if (m.g !== g0) {
      g0 = m.g;
      body += `<tr class="grp"><th colspan="${ds.length + 1}" scope="colgroup">${g0}</th></tr>`;
    }
    body += `<tr><th scope="row"><button type="button" data-row="${m.id}" title="この手法を全データで比較">${m.name}</button></th>${ds
      .map(
        (d) =>
          `<td><button type="button" class="cl-c1" data-m="${m.id}" data-d="${d.id}" title="${m.name}・${dataOf(d.id)?.name ?? '描画'}"><canvas></canvas><small></small></button></td>`,
      )
      .join('')}</tr>`;
  }
  const tb = $('#cl-g');
  tb.innerHTML = `${head}<tbody>${body}</tbody>`;
  for (const cv of $$<HTMLCanvasElement>('[data-truth]', tb)) {
    const d = ds.find((x) => x.id === cv.dataset.truth);
    if (d) drawTruth(cv, d);
  }
  listObs?.disconnect();
  dropQueue();
  listLeft = 0;
  listTok++;
  syncListSay();
  listObs = new IntersectionObserver(
    (es) => {
      for (const e of es) {
        if (!e.isIntersecting || e.target.hasAttribute('data-req')) continue;
        e.target.setAttribute('data-req', '');
        listObs?.unobserve(e.target);
        requestCell(e.target as HTMLElement);
      }
    },
    { root: $('#cl-gw'), rootMargin: '160px' },
  );
  for (const b of $$('.cl-c1', tb)) listObs.observe(b);
}
function requestCell(b: HTMLElement): void {
  const d = getData(b.dataset.d as string, LIST_N, S.seed, 0, LIM_LIST),
    mid = b.dataset.m as string,
    p = paramsOf(mid, d),
    tok = listTok;
  listLeft++;
  syncListSay();
  /* 手法の比べ方が初期配置の運に左右されないように、k-means は k-means++ にする */
  request(mid, d, mid === 'kmeans' ? { ...p, init: 1 } : p, LIST_FRAMES, false, (r) => {
    if (tok !== listTok) return;
    listLeft--;
    syncListSay();
    if (!b.isConnected) return;
    cellRun.set(b, r);
    const s = $('small', b);
    s.textContent = r.ari === null ? `${r.nc} 個` : r.ari.toFixed(2);
    s.classList.toggle('lo', r.ari !== null && r.ari < 0.6);
    b.title = `${b.title}　${r.nc} 個${r.noise ? `　ノイズ ${r.noise} 点` : ''}`;
    paintCell(b, Math.min(1, T.ms / total()));
  });
}
function syncListSay(): void {
  const s = listLeft > 0 ? `計算中　残り ${listLeft} マス` : '';
  const el = $('#cl-lsay');
  if (el.textContent !== s) el.textContent = s;
}
function paintCell(b: HTMLElement, u: number): void {
  const r = cellRun.get(b);
  if (!r) return;
  const fi = frameAt(r, u * r.T);
  if (cellFi.get(b) === fi) return;
  cellFi.set(b, fi);
  drawRun($<HTMLCanvasElement>('canvas', b), r, fi, { thumb: true });
}
function paintList(u: number): void {
  const gw = $('#cl-gw').getBoundingClientRect();
  for (const b of $$('#cl-g .cl-c1')) {
    const q = b.getBoundingClientRect();
    if (q.bottom < gw.top - 60 || q.top > gw.bottom + 60) continue;
    paintCell(b, u);
  }
}
const figTop = (): void => $('.a-fig').scrollIntoView({ block: 'start', behavior: RM.matches ? 'auto' : 'smooth' });
$('#cl-g').addEventListener('click', (e) => {
  const t = e.target as Element,
    cell = t.closest<HTMLElement>('.cl-c1'),
    row = t.closest<HTMLElement>('[data-row]'),
    col = t.closest<HTMLElement>('[data-col]');
  if (cell) {
    S.m = cell.dataset.m as string;
    setData(cell.dataset.d as string);
    if (S.d === 'draw') draw.tool = 'play';
    store('m', S.m);
    modeCh.choose('one');
  } else if (row) {
    S.m = row.dataset.row as string;
    store('m', S.m);
    axisCh.choose('data');
    modeCh.choose('cmp');
  } else if (col) {
    /* そのデータで一致度の高い 6 種を比較する */
    setData(col.dataset.col as string);
    if (S.d === 'draw') draw.tool = 'play';
    const scored = $$(`.cl-c1[data-d="${S.d}"]`)
      .flatMap((b) => {
        const r = cellRun.get(b);
        return r ? [[b.dataset.m as string, r.ari ?? 0] as const] : [];
      })
      .sort((a, b) => b[1] - a[1]);
    if (scored.length) {
      S.sel = scored.slice(0, 6).map((x) => x[0]);
      store('sel', S.sel);
    }
    axisCh.choose('method');
    modeCh.choose('cmp');
  } else return;
  apply(true);
  figTop();
});

/* ---------- 選択 ---------- */
function setData(id: string): void {
  S.d = id;
  store('d', id);
}
$('#cl-ms').addEventListener('click', (e) => {
  const id = (e.target as Element).closest<HTMLElement>('[data-v]')?.dataset.v;
  if (!id) return;
  if (mode === 'cmp' && !byData()) {
    const i = S.sel.indexOf(id);
    if (i >= 0) {
      if (S.sel.length > 1) S.sel.splice(i, 1);
    } else if (S.sel.length < MAX_CMP) S.sel.push(id);
    else return;
    store('sel', S.sel);
    apply(true);
    return;
  }
  S.m = id;
  store('m', id);
  apply(true);
});
$('#cl-ds').addEventListener('click', (e) => {
  const id = (e.target as Element).closest<HTMLElement>('[data-v]')?.dataset.v;
  if (!id) return;
  if (id === 'draw') {
    /* 初めての描画は今のデータを下絵にする */
    if (!draw.x.length) {
      const d = getData(S.d === 'draw' ? 'blobs' : S.d, Math.min(S.n, 200), S.seed);
      draw.x = Array.from(d.x, r4);
      draw.y = Array.from(d.y, r4);
      draw.t = Array.from(d.t, (q) => Math.max(0, q));
      keepDraw();
    }
    draw.tool = 'draw';
  }
  setData(id);
  apply(true);
});
const newData = (): void => {
  S.seed++;
  dataCache.clear();
  apply(true);
};
$('#cl-new').addEventListener('click', newData);
$('#cl-new2').addEventListener('click', newData);

/* ---------- 描画 ---------- */
const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;
function keepDraw(): void {
  draw.ver++;
  store('draw', { x: draw.x, y: draw.y, t: draw.t });
  for (const k of P.keys()) if (k.includes(':draw:')) P.delete(k);
}
const brushCh = new Choice<string>($('#cl-br'), (v) => {
  draw.brush = Number(v);
});
for (const b of $$('button[data-c]', $('#cl-br'))) b.innerHTML = markerSvg(Number(b.dataset.c), 13);
const toolCh = new Choice<'draw' | 'play'>($('#cl-tool'), (v) => {
  draw.tool = v;
  apply(v === 'play');
});
{
  const size = $<HTMLInputElement>('#cl-size'),
    setSize = () => {
      draw.size = Number(size.value);
      size.style.setProperty('--p', String((draw.size - Number(size.min)) / (Number(size.max) - Number(size.min))));
    };
  size.addEventListener('input', setSize);
  setSize();
  $('#cl-clear').addEventListener('click', () => {
    draw.x = [];
    draw.y = [];
    draw.t = [];
    keepDraw();
    paint();
  });
  const rnd = (() => {
    let a = 99;
    return () => {
      a = (a * 1664525 + 1013904223) >>> 0;
      return a / 4294967296;
    };
  })();
  const box = (e: PointerEvent): [number, number] => {
    const b = mainCv.getBoundingClientRect();
    return toBox(b.width, b.height, e.clientX - b.left, e.clientY - b.top);
  };
  const dab = (x: number, y: number): void => {
    if (draw.brush < 0) {
      for (let i = draw.x.length - 1; i >= 0; i--)
        if (Math.hypot(draw.x[i] - x, draw.y[i] - y) < draw.size) {
          draw.x.splice(i, 1);
          draw.y.splice(i, 1);
          draw.t.splice(i, 1);
        }
      return;
    }
    for (let q = 0; q < 3 && draw.x.length < MAX_DRAW; q++) {
      const a = rnd() * 2 * Math.PI,
        u = draw.size * Math.sqrt(rnd()),
        px = x + u * Math.cos(a),
        py = y + u * Math.sin(a);
      if (px < 0.01 || px > BOX.w - 0.01 || py < 0.01 || py > BOX.h - 0.01) continue;
      draw.x.push(r4(px));
      draw.y.push(r4(py));
      draw.t.push(draw.brush);
    }
  };
  let on = false,
    lp: [number, number] = [0, 0];
  mainCv.addEventListener('pointerdown', (e) => {
    if (!isDrawing()) return;
    e.preventDefault();
    on = true;
    mainCv.setPointerCapture(e.pointerId);
    lp = box(e);
    dab(...lp);
    paint();
  });
  mainCv.addEventListener('pointermove', (e) => {
    if (!on) return;
    const q = box(e);
    if (Math.hypot(q[0] - lp[0], q[1] - lp[1]) > 0.012) {
      dab(...q);
      lp = q;
      paint();
    }
  });
  const end = (): void => {
    if (!on) return;
    on = false;
    keepDraw();
    paint();
  };
  mainCv.addEventListener('pointerup', end);
  mainCv.addEventListener('pointercancel', end);
}

/* ---------- 階層の切断線のドラッグ ---------- */
{
  let dragging = false;
  const dendro = () => (mode === 'one' && !isDrawing() && run?.side?.type === 'dendro' ? run.side : null);
  const setK = (e: PointerEvent): void => {
    const sd = dendro();
    if (!sd) return;
    const b = mainCv.getBoundingClientRect(),
      k = Math.max(2, Math.min(12, dendroCut(sd, sideBox(b.width, b.height), e.clientY - b.top))),
      p = paramsOf(S.m, curData());
    if (p.k === k) return;
    p.k = k;
    syncing = true;
    pgM.set('k', k, { silent: true });
    syncing = false;
    afterParam();
  };
  mainCv.addEventListener('pointermove', (e) => {
    if (dragging) {
      setK(e);
      return;
    }
    const sd = dendro();
    if (!sd || !run) {
      if (mainCv.style.cursor) mainCv.style.cursor = '';
      return;
    }
    const b = mainCv.getBoundingClientRect(),
      L = sideBox(b.width, b.height),
      y = dendroY(sd.hMax, L, cutHeight(sd, run.d.n));
    mainCv.style.cursor = e.clientX - b.left > L.sw && Math.abs(e.clientY - b.top - y) < 14 ? 'ns-resize' : '';
  });
  mainCv.addEventListener('pointerdown', (e) => {
    if (!dendro()) return;
    const b = mainCv.getBoundingClientRect();
    if (e.clientX - b.left <= sideBox(b.width, b.height).sw) return;
    dragging = true;
    mainCv.setPointerCapture(e.pointerId);
    setK(e);
  });
  const stop = (): void => {
    dragging = false;
  };
  mainCv.addEventListener('pointerup', stop);
  mainCv.addEventListener('pointercancel', stop);
}

/* ---------- 表示の切り替え ---------- */
const modeCh = new Choice<Mode>($('#cl-mode'), () => {
  if (booted) apply(true);
});
let mode: Mode = modeCh.value;
function syncChips(): void {
  const multi = mode === 'cmp' && !byData();
  for (const b of $$('#cl-ms [data-v]')) {
    const v = b.dataset.v as string;
    b.setAttribute('aria-pressed', String(multi ? S.sel.includes(v) : v === S.m));
  }
  for (const b of $$('#cl-ds [data-v]')) b.setAttribute('aria-pressed', String(b.dataset.v === S.d));
  $('#cl-man').textContent = multi ? `${S.sel.length} / ${MAX_CMP} 種を選択` : `${METHODS.length} 種`;
}
function title(): string {
  if (mode === 'list') return '手法 × データ';
  if (isDrawing()) return '描画';
  if (mode === 'cmp')
    return byData() ? `データを比較　${methodOf(S.m).name}` : `手法を比較　${dataOf(S.d)?.name ?? '描画'}`;
  return methodOf(S.m).name;
}
/** 今の状態に合わせて全部を組み直す */
function apply(restart: boolean): void {
  mode = modeCh.value;
  root.dataset.mode = mode;
  const drawing = isDrawing(),
    drawn = S.d === 'draw' && mode === 'one';
  root.classList.toggle('cl-drawing', drawing);
  $('#hd-fig').textContent = title();
  $('#cl-tools').hidden = !drawn;
  $('#cl-brush').hidden = !drawing;
  toolCh.set(draw.tool);
  $('#cl-one').hidden = mode !== 'one';
  $('#cl-cmp').hidden = mode !== 'cmp';
  $('#cl-list').hidden = mode !== 'list';
  $('#cl-axis').hidden = mode !== 'cmp';
  $('#cl-lg').hidden = mode !== 'one';
  $('#cl-samp').hidden = true;
  $('#tp').hidden = drawing;
  $('#hd-out').textContent = mode === 'cmp' ? '順位' : '計算結果';
  $('.a-out').hidden = drawing;
  $('.a-st').hidden = drawing || mode !== 'one';
  $('#cl-res').hidden = mode !== 'one';
  $('#o-rt').hidden = mode !== 'cmp';
  $('#cl-dpar').hidden = S.d === 'draw' || mode === 'list';
  syncChips();
  syncParams();
  syncLegend();
  /* 領域を描く k-means が図にあるときだけトグルを出す */
  $('#cl-reg').hidden =
    drawing || mode === 'list' || !(mode === 'cmp' && !byData() ? S.sel.includes('kmeans') : S.m === 'kmeans');
  dropQueue();
  cmpTok++;
  listObs?.disconnect();
  if (restart || mode !== 'one') {
    setPlay(false);
    T.ms = 0;
  }
  if (mode === 'one') {
    if (drawing) {
      setPlay(false);
      wantOne++;
      paint();
      return;
    }
    if (restart) run = null;
    loadOne(restart);
    return;
  }
  run = null;
  setSay('');
  if (mode === 'cmp') buildCmp();
  else buildList();
  autoStart();
}

/* ---------- その他 ---------- */
/* 閉じている間は絵を描けないので、開いたときに描く */
$('#cl-how .more-h').addEventListener('click', () => {
  if (run && mode === 'one') {
    syncSteps(run);
    paint();
  }
});
$('#cl-reg').addEventListener('click', () => {
  S.regions = !S.regions;
  $('#cl-reg').setAttribute('aria-pressed', String(S.regions));
  paint();
});
storeToggle($('#cl-reg'));

readColors();
const recolor = (): void => {
  readColors();
  if (mode === 'one' && run) syncSteps(run);
  if (mode === 'list') {
    for (const b of $$('#cl-g .cl-c1')) cellFi.delete(b);
    for (const cv of $$<HTMLCanvasElement>('[data-truth]')) {
      const d = listDatas().find((x) => x.id === cv.dataset.truth);
      if (d) drawTruth(cv, d);
    }
  }
  paint();
};
new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);
let lastW = root.clientWidth;
new ResizeObserver(() => {
  if (!booted) return;
  for (const b of $$('#cl-g .cl-c1')) cellFi.delete(b);
  /* しくみの絵は幅が変わったときに描き直す */
  const w = root.clientWidth;
  if (w !== lastW) {
    lastW = w;
    if (mode === 'one' && run && !isDrawing()) syncSteps(run);
  }
  paint();
}).observe(root);
/* 保存した値を戻したあと（マイクロタスク）に組み立てる */
queueMicrotask(() => {
  booted = true;
  S.regions = $('#cl-reg').getAttribute('aria-pressed') !== 'false';
  T.sp = Number(speedCh.value);
  draw.brush = Number(brushCh.value);
  const v = pgD.values();
  S.n = v.n;
  S.out = v.out;
  apply(true);
});
