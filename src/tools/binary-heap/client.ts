/**
 * 二分ヒープのページの入口。操作の列を先に記録し、再生で 1 手ずつ図と音へ出す。
 * 格納とソートは別の工程で、切り替えるとその工程を初めから再生する。
 * 表示は 単独（1 行）・比較（複数の行を同時に）・一覧（1 行と計算量の表）の 3 つ
 */

import { bigO } from '../../lib/big-o';
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { RM } from '../../lib/motion';
import { ParamGroup } from '../../lib/param';
import { autoPause } from '../../lib/pause';
import { store, stored, storeToggle } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import type { BarShape } from '../list-queue-stack/model';
import { SHAPES } from '../list-queue-stack/model';
import { SortAudio, TONE_MAX } from '../sort/audio';
import { type Cell, drawFig, hitAt, readColors } from './fig';
import {
  ADD_MAX,
  BIG_O,
  barVals,
  countOp,
  DEFS,
  type Def,
  defOf,
  type Frame,
  howOf,
  KEYS,
  type Method,
  type OpKey,
  opName,
  parentOf,
  runTrace,
  sortTokens,
  storeTokens,
  type Trace,
  totalOf,
  VM,
} from './model';
import { type Key, SIZE, SPEED, VOL } from './params';

initToolPage();

type Mode = 'one' | 'cmp' | 'list';
/** 工程。op は一覧の表から選んだ操作だけを実行している間 */
type Stage = 'store' | 'sort' | 'op';
type By = 'build' | 'str';
/** 比較の行の組み立て */
interface Spec {
  def: Def;
  name: string;
  /** その行の格納の操作 */
  storeT: OpKey[];
  pre: OpKey[];
  tokens: OpKey[];
}
interface HeapCell extends Cell {
  /** この工程を終えたときの回数（比較の回数のバーの目盛り） */
  total: number;
  totStore: number;
  totSort: number;
}

const fmt = (v: number): string => v.toLocaleString('en-US');
const lastCount = (t: Trace): number => {
  const z = t.frames[t.frames.length - 1];
  return z.cmp + z.mov;
};
const def = (id: string): Def => defOf(id) ?? DEFS[0];
const isShape = (v: unknown): v is BarShape => SHAPES.some((s) => s[0] === v);
/** 操作の表で回数を見せる要素数 */
const N_SHOW = 31;
/** 一覧の表から操作を見るときに、先に入れておく要素の割合 */
const PRE_RATE = 2 / 3;
const METHODS: readonly (readonly [Method, string])[] = [
  ['add', '1 個ずつ追加'],
  ['build', 'まとめて構築'],
];

/* ---------- 状態 ---------- */
const root = $('#hp');
const cv = $<HTMLCanvasElement>('#hp-cv');
const audio = new SortAudio();
let cur = defOf(String(stored('cur')))?.id ?? 'bin';
let sel = loadSel(stored('sel'));
let shape: BarShape = isShape(stored('shape')) ? (stored('shape') as BarShape) : 'rand';
let n = SIZE.v;
let rate = SPEED.v;
let seed = 3;
let stage: Stage = 'store';
/** 格納の操作（手で足した操作を含む） */
let storeT: OpKey[] = [];
let pre: OpKey[] = [];
let tokens: OpKey[] = [];
/** 手で操作したか・一覧の表から操作を選んだか（リセットできる間） */
let manual = false;
let cells: HeapCell[] = [];
let step = 0;
let hear = 0;
let hover: number | null = null;
/** なぞっているときに図へ出す文 */
let hoverText: string | null = null;
let booted = false;

let playing = false;
let acc = 0;
let last = 0;
let raf = 0;
let dirty = false;
let moving = false;
let snap = true;

function loadSel(v: unknown): string[] {
  const a = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!defOf(x)) : [];
  return a.length ? DEFS.map((d) => d.id).filter((id) => a.includes(id)) : ['bin', 'pr', 'fb', 'ar'];
}

/* ---------- 選択肢 ---------- */
const modeCh = new Choice<Mode>($('#hp-mode'), (m) => changeMode(m));
let mode: Mode = modeCh.value;
const methodCh = new Choice<Method>($('#p-method'), () => {
  if (booted) startOver();
});
const dirCh = new Choice<'max' | 'min'>($('#p-dir'), () => {
  if (!booted) return;
  counts.clear();
  startOver();
});
const byCh = new Choice<By>($('#p-by'), () => {
  if (booted) startOver();
});
const pg = new ParamGroup<Key>([SPEED, SIZE, VOL], (v, k) => {
  rate = v.sp;
  audio.vol(v.vol);
  n = v.n;
  if (!booted) return;
  if (k === 'n') startOver();
});
const isMax = (): boolean => dirCh.value === 'max';

/* ---------- 実行 ---------- */
const END_SAY: Record<Stage, string | undefined> = {
  store: '格納 完了',
  sort: 'ソート 完了',
  op: undefined,
};
const baseOpt = (vals: number[]) => ({ vals, max: isMax(), seed });
function specOf(d: Def, name: string, st: OpKey[], vals: number[]): Spec {
  if (stage === 'op') return { def: d, name, storeT: st, pre, tokens };
  return stage === 'sort'
    ? { def: d, name, storeT: st, pre: st, tokens: sortTokens(d, baseOpt(vals), st) }
    : { def: d, name, storeT: st, pre: [], tokens: st };
}
function specs(vals: number[]): Spec[] {
  if (mode !== 'cmp') {
    const d = def(cur);
    return [{ def: d, name: d.name, storeT, pre, tokens }];
  }
  if (byCh.value === 'build') return METHODS.map(([m, name]) => specOf(def('bin'), name, storeTokens(m, n), vals));
  return sel.map((id) => specOf(def(id), def(id).name, storeT, vals));
}
function buildCells(): void {
  const vals = barVals(shape, n, seed);
  cells = specs(vals).map((s) => {
    const trace = runTrace(s.def, {
      ...baseOpt(vals),
      tokens: s.tokens,
      pre: s.pre,
      endSay: END_SAY[stage],
    });
    return {
      trace,
      name: s.name,
      pos: new Map(),
      total: lastCount(trace),
      totStore: totalOf(s.def, { ...baseOpt(vals), tokens: s.storeT }),
      totSort: totalOf(s.def, {
        ...baseOpt(vals),
        pre: s.storeT,
        tokens: sortTokens(s.def, baseOpt(vals), s.storeT),
      }),
    };
  });
  if (hear >= cells.length) hear = 0;
}
const maxStep = (): number => cells.reduce((m, c) => Math.max(m, c.trace.frames.length - 1), 0);
const frameOf = (c: Cell, s = step): Frame => c.trace.frames[Math.min(s, c.trace.frames.length - 1)];

/** 記録し直す。位置は at へ移る */
function rebuild(at = 0): void {
  buildCells();
  step = Math.min(at, maxStep());
  acc = 0;
  snap = true;
  hover = null;
  hoverText = null;
  syncReset();
  syncAll();
  paint();
}
/** 工程に入る: 格納はいつも空から、ソートは格納の結果から始める */
function enter(s: Stage): void {
  stage = s;
  if (s === 'store') {
    pre = [];
    tokens = [...storeT];
  } else if (s === 'sort') {
    pre = [...storeT];
    tokens = sortTokens(def(cur), baseOpt(barVals(shape, n, seed)), storeT);
  }
}
/** 手での操作を捨て、今の設定で初めから。工程はそのまま */
function startOver(): void {
  setPlay(false);
  storeT = storeTokens(methodCh.value, n);
  manual = false;
  enter(stage === 'op' ? 'store' : stage);
  rebuild(0);
}

/* ---------- 再生 ---------- */
function setPlay(on: boolean): void {
  playing = on;
  const b = $('#tp-pp'),
    t = on ? '一時停止' : '再生';
  b.classList.toggle('on', on);
  b.title = t;
  b.setAttribute('aria-label', t);
  if (on) {
    audio.ready();
    last = performance.now();
    kick();
  }
  syncStatus();
}
function kick(): void {
  if (!raf) raf = requestAnimationFrame(tick);
}
function paint(): void {
  dirty = true;
  kick();
}
/** s 手目に鳴らす音（値の列） */
function tonesAt(s: number): number[] {
  const t: Trace | undefined = cells[hear]?.trace;
  if (!t || s >= t.frames.length) return [];
  const f = t.frames[s];
  return [...f.w, ...f.r].map((id) => t.vals[id]);
}
function advance(dt: number): void {
  acc += rate * dt;
  const k = Math.floor(acc);
  if (k <= 0) return;
  acc -= k;
  const end = maxStep(),
    to = Math.min(end, step + k),
    list: number[] = [],
    stride = Math.max(1, Math.floor((to - step) / TONE_MAX));
  for (let s = step + 1; s <= to; s += stride) list.push(...tonesAt(s));
  step = to;
  audio.play(list, VM, dt, Math.min(0.22, Math.max(0.028, 1.8 / rate)));
  dirty = true;
  if (step >= end) setPlay(false);
}
function tick(now: number): void {
  raf = 0;
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  if (playing) advance(dt);
  if (dirty || moving) {
    dirty = false;
    draw(now);
  }
  if (playing || moving) kick();
}
function seekTo(s: number, sound = false): void {
  const to = Math.max(0, Math.min(maxStep(), Math.round(s)));
  if (Math.abs(to - step) > 1) snap = true;
  step = to;
  if (sound) {
    audio.ready();
    audio.play(tonesAt(step), VM, 0.02, 0.1);
  }
  syncStatus();
  paint();
}

/* ---------- 描く ---------- */
function draw(now: number): void {
  if (!cells.length) return;
  const cmp = mode === 'cmp',
    say = hoverText ?? (cmp ? '' : frameOf(cells[0]).say);
  moving = drawFig(cv, cells, {
    cmp,
    step,
    hover,
    say,
    now,
    rate,
    snap: snap || RM.matches,
  });
  snap = false;
  $('#hp-say').textContent = say;
  syncTrack();
  syncResults();
  syncStatus();
  syncStages();
  if (!cmp) syncOps();
}
const mmss = (v: number): string => {
  const s = Math.floor(v);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
function syncTrack(): void {
  const tot = maxStep(),
    pc = `${((tot ? step / tot : 0) * 100).toFixed(2)}%`,
    trk = $('#tp-trk');
  $('#tp-fill').style.width = pc;
  $('#tp-th').style.left = pc;
  $('#tp-a').textContent = fmt(step);
  $('#tp-b').textContent = fmt(tot);
  $('#tp-t').textContent = tot / rate < 0.1 ? '' : `${mmss(step / rate)} / ${mmss(tot / rate)}`;
  trk.setAttribute('aria-valuemax', String(tot));
  trk.setAttribute('aria-valuenow', String(step));
  trk.setAttribute('aria-valuetext', `${fmt(step)} / ${fmt(tot)} 手順`);
}
function syncStatus(): void {
  if (!cells.length) return;
  const end = step >= maxStep(),
    txt = playing ? '実行中' : end && step > 0 ? '完了' : step > 0 ? '一時停止中' : '',
    t = $('#hp-stT');
  $('#hp-led').className = `led${playing ? ' on' : end && step > 0 ? ' hp-ok' : txt ? ' half' : ''}`;
  if (t.textContent !== txt) t.textContent = txt;
  $('#hp-st').hidden = !txt;
}
/** 工程のボタン: 選択中・回数・次に押すボタンの印 */
function syncStages(): void {
  const one = mode !== 'cmp',
    c = cells[0],
    tree = !one || c?.trace.def.kind !== 'array';
  for (const b of $$<HTMLButtonElement>('#hp-steps button')) {
    const s = b.dataset.s as Stage;
    b.setAttribute('aria-pressed', String(stage === s));
    $('em', b).textContent = one && c ? `${fmt(s === 'store' ? c.totStore : c.totSort)} 回` : '';
    $('span', b).textContent =
      s === 'store'
        ? one && tree
          ? '全部を木に入れる'
          : '全部を入れる'
        : one && tree
          ? '根から順に取り出す'
          : '順に取り出す';
    b.classList.toggle('next', s === 'sort' && stage === 'store' && step >= maxStep());
  }
}
function syncResults(): void {
  if (mode === 'cmp') {
    cells.forEach((c, i) => {
      const f = frameOf(c),
        tr = $(`#hp-rt tr[data-i="${i}"]`),
        cell = $$('.hp-cell')[i];
      if (!tr || !cell) return;
      $('em', cell).textContent = `${fmt(f.cmp + f.mov)} 回`;
      cell.toggleAttribute('data-done', step >= c.trace.frames.length - 1);
      $<HTMLElement>('.hp-cb b', cell).style.width = `${((f.cmp + f.mov) / maxTotal()) * 100}%`;
      const td = $$('td', tr);
      td[0].textContent = fmt(f.cmp + f.mov);
      td[1].textContent = fmt(f.cmp);
      td[2].textContent = fmt(f.mov);
      td[3].textContent = String(f.h.length);
      td[4].textContent = c.trace.def.kind === 'array' ? '–' : String(f.bad);
      td[5].textContent = fmt(c.totStore);
      td[6].textContent = fmt(c.totSort);
      td[7].textContent = fmt(c.totStore + c.totSort);
    });
    return;
  }
  const c = cells[0],
    f = frameOf(c),
    t = c.trace,
    d = t.def;
  $('#o-t').textContent = fmt(f.cmp + f.mov);
  $('#o-c').textContent = fmt(f.cmp);
  $('#o-m').textContent = fmt(f.mov);
  $('#o-l').textContent = String(f.h.length);
  $('#o-v').textContent = d.kind === 'array' ? '–' : String(f.depth);
  $('#o-b').textContent = d.kind === 'array' ? '–' : String(f.bad);
  const vals = f.h.map((id) => t.vals[id]);
  $('#o-pkL').textContent = isMax() ? '最大値' : '最小値';
  $('#o-pk').textContent = vals.length ? String(isMax() ? Math.max(...vals) : Math.min(...vals)) : '–';
  $('#o-s1').textContent = fmt(c.totStore);
  $('#o-s2').textContent = fmt(c.totSort);
  $('#o-s').textContent = fmt(c.totStore + c.totSort);
}

/* ---------- 見出しと選択の表示 ---------- */
function syncAll(): void {
  root.dataset.mode = mode;
  const d = def(cur);
  $('#hd-fig').textContent = mode === 'cmp' ? '比較' : d.name;
  cv.setAttribute('aria-label', mode === 'cmp' ? cells.map((c) => c.name).join('・') : d.name);
  const strCmp = mode === 'cmp' && byCh.value === 'str';
  $('#hp-an').textContent = strCmp ? `${sel.length} / ${DEFS.length}` : '';
  for (const b of $$<HTMLButtonElement>('#hp-str [data-v]')) {
    const id = b.dataset.v ?? '';
    b.setAttribute('aria-pressed', String(mode === 'cmp' ? strCmp && sel.includes(id) : id === cur));
    b.disabled = mode === 'cmp' && !strCmp;
  }
  for (const b of $$<HTMLButtonElement>('#hp-shape [data-v]'))
    b.setAttribute('aria-pressed', String(b.dataset.v === shape));
  $('#hp-byw').hidden = mode !== 'cmp';
  for (const el of $$('#hp [data-for]')) (el as HTMLElement).hidden = el.dataset.for !== d.id;
  if (mode !== 'cmp') buildOps();
  if (mode === 'cmp') {
    buildRank();
    buildRace();
  }
  syncSel();
  syncStages();
}
function syncReset(): void {
  $('#hp-reset').hidden = !manual;
  $('#hp-reset2').hidden = !(manual && mode === 'cmp');
}
let lastKey = '';
function syncSel(): void {
  for (const b of $$('.hp-c.sel')) b.classList.remove('sel');
  document.querySelector(`.hp-c[data-a="${cur}"][data-k="${lastKey}"]`)?.classList.add('sel');
}

/* ---------- 操作の枠 ---------- */
const counts = new Map<string, number>();
function countOf(d: Def, k: OpKey): number {
  const key = `${d.id}:${k}`;
  let c = counts.get(key);
  if (c === undefined) {
    c = countOp(d, k, N_SHOW, isMax());
    counts.set(key, c);
  }
  return c;
}
const countText = (v: number): string => `${Number.isInteger(v) ? v : v.toFixed(1)} 回`;
function buildOps(): void {
  const d = def(cur);
  $('#hp-ops').innerHTML = KEYS.map(
    ([k]) =>
      `<tr data-k="${k}"><td class="hp-ob"><button type="button">${opName(k, isMax())}</button></td><td class="hp-how">${howOf(d, k)}</td><td class="hp-oo">${bigO(BIG_O[d.id][k])}</td><td class="hp-on">${countText(countOf(d, k))}</td></tr>`,
  ).join('');
}
function syncOps(): void {
  const c = cells[0],
    f = frameOf(c),
    empty = !f.h.length,
    waiting = f.next < c.trace.n;
  for (const tr of $$('#hp-ops tr[data-k]')) {
    const k = tr.dataset.k as OpKey;
    $<HTMLButtonElement>('button', tr).disabled =
      k === 'build' ? !waiting : k === 'add' ? f.h.length >= ADD_MAX : empty;
  }
}
$('#hp-ops').addEventListener('click', (e) => {
  const t = e.target as Element,
    b = t.closest<HTMLButtonElement>('button'),
    tr = t.closest<HTMLElement>('tr[data-k]');
  if (!b || !tr || b.disabled) return;
  /* 今の位置までの操作に、押した操作を続ける */
  const f = frameOf(cells[0]);
  tokens = [...tokens.slice(0, f.tok), tr.dataset.k as OpKey];
  if (stage === 'store') storeT = [...tokens];
  manual = true;
  setPlay(false);
  const first = runTrace(def(cur), { ...baseOpt(barVals(shape, n, seed)), tokens, pre }).frames.findIndex(
    (x) => x.tok === tokens.length,
  );
  rebuild(Math.max(0, first - 1));
  setPlay(true);
});
$('#hp-reset').addEventListener('click', startOver);
$('#hp-reset2').addEventListener('click', startOver);

/* ---------- 工程の切り替え ---------- */
$('#hp-steps').addEventListener('click', (e) => {
  const s = (e.target as Element).closest<HTMLElement>('button')?.dataset.s as Stage | undefined;
  if (!s) return;
  setPlay(false);
  lastKey = '';
  enter(s);
  rebuild(0);
  setPlay(true);
});

/* ---------- 比較の枠 ---------- */
const maxTotal = (): number => Math.max(1, ...cells.map((c) => c.total));
function buildRace(): void {
  const host = $('#hp-race'),
    m = cells.length;
  host.style.setProperty('--cols', String(m <= 1 ? 1 : m <= 4 ? 2 : 3));
  host.textContent = '';
  cells.forEach((c, i) => {
    const b = document.createElement('button'),
      head = document.createElement('div'),
      led = document.createElement('span'),
      name = document.createElement('span'),
      done = document.createElement('span'),
      em = document.createElement('em'),
      bar = document.createElement('i'),
      cvs = document.createElement('canvas');
    b.type = 'button';
    b.className = 'hp-cell';
    b.setAttribute('aria-pressed', String(i === hear));
    b.title = '音を聞く';
    head.className = 'hp-ch';
    led.className = `led${i === hear ? ' on' : ''}`;
    led.setAttribute('aria-hidden', 'true');
    name.className = 'hp-cn';
    name.textContent = c.name;
    em.textContent = '0 回';
    done.className = 'hp-dn';
    done.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5l2.8 2.8L10 3.5"/></svg>完了';
    head.append(led, name, done, em);
    bar.className = 'hp-cb';
    bar.append(document.createElement('b'));
    b.append(head, bar, cvs);
    b.addEventListener('click', () => setHear(i));
    c.cv = cvs;
    host.append(b);
  });
}

/* ---------- 比較の表 ---------- */
function buildRank(): void {
  $('#hp-rt').innerHTML =
    `<thead><tr><th class="l"></th><th>比較と移動</th><th>比較</th><th>移動</th><th>要素数</th><th>条件違反の枝</th><th>格納の合計</th><th>ソートの合計</th><th>合計</th></tr></thead><tbody>${cells
      .map(
        (c, i) =>
          `<tr data-i="${i}"><th class="l" scope="row"><button type="button" class="hp-hear" aria-pressed="${i === hear}"><span class="led${i === hear ? ' on' : ''}" aria-hidden="true"></span>${c.name}</button></th><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`,
      )
      .join('')}</tbody>`;
}
function setHear(i: number): void {
  hear = i;
  audio.ready();
  $$('#hp-rt tr[data-i]').forEach((tr, k) => {
    $('.hp-hear', tr).setAttribute('aria-pressed', String(k === i));
    $('.led', tr).classList.toggle('on', k === i);
  });
  $$('.hp-cell').forEach((c, k) => {
    c.setAttribute('aria-pressed', String(k === i));
    $('.led', c).classList.toggle('on', k === i);
  });
  paint();
}
$('#hp-rt').addEventListener('click', (e) => {
  const tr = (e.target as Element).closest<HTMLElement>('tr[data-i]');
  if (tr && (e.target as Element).closest('.hp-hear')) setHear(Number(tr.dataset.i));
});

/* ---------- なぞると親と子が光る ---------- */
function showFamily(idx: number | null): void {
  if (idx === hover) return;
  hover = idx;
  if (idx == null) hoverText = null;
  else {
    const c = cells[0],
      f = frameOf(c),
      d = c.trace.def.d,
      kids: number[] = [];
    for (let k = 1; k <= d; k++) if (d * idx + k < f.h.length) kids.push(d * idx + k);
    hoverText = `添字 ${idx}　親 ${idx > 0 ? parentOf(idx, d) : 'なし'}　子 ${kids.length ? kids.join('・') : 'なし'}`;
  }
  paint();
}
function pointAt(e: PointerEvent): void {
  if (mode === 'cmp' || !cells[0]?.trace.def.d) return;
  const b = cv.getBoundingClientRect();
  showFamily(hitAt(e.clientX - b.left, e.clientY - b.top));
}
cv.addEventListener('pointermove', pointAt);
cv.addEventListener('pointerdown', pointAt);
cv.addEventListener('pointerleave', () => showFamily(null));

/* ---------- 表示の切り替え ---------- */
function changeMode(m: Mode): void {
  if (!booted) return;
  if (mode === 'cmp' && byCh.value === 'str' && cells[hear]) cur = cells[hear].trace.def.id;
  mode = m;
  if (m === 'cmp' && !sel.includes(cur)) sel = DEFS.map((d) => d.id).filter((id) => sel.includes(id) || id === cur);
  hear = m === 'cmp' && byCh.value === 'str' ? Math.max(0, sel.indexOf(cur)) : 0;
  store('cur', cur);
  store('sel', sel);
  lastKey = '';
  startOver();
  if (m === 'list' && matchMedia('(max-width:999.98px)').matches)
    $('.a-mat').scrollIntoView({ block: 'start', behavior: RM.matches ? 'auto' : 'smooth' });
}
$('#hp-str').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('[data-v]'),
    id = b?.dataset.v;
  if (!id || b?.disabled) return;
  if (mode === 'cmp') {
    if (sel.includes(id)) {
      if (sel.length > 1) sel = sel.filter((x) => x !== id);
    } else sel = DEFS.map((d) => d.id).filter((x) => sel.includes(x) || x === id);
    store('sel', sel);
  } else {
    cur = id;
    store('cur', cur);
  }
  lastKey = '';
  startOver();
});
$('#hp-shape').addEventListener('click', (e) => {
  const k = (e.target as Element).closest<HTMLElement>('[data-v]')?.dataset.v;
  if (!isShape(k)) return;
  shape = k;
  store('shape', k);
  startOver();
});
$('#hp-new').addEventListener('click', () => {
  seed += 7;
  startOver();
});

/* ---------- 一覧の表 ---------- */
const figTop = () => $('.a-fig').scrollIntoView({ block: 'start', behavior: RM.matches ? 'auto' : 'smooth' });
function showOp(key: OpKey): void {
  stage = 'op';
  tokens = [key];
  pre = key === 'build' ? [] : Array(Math.floor(n * PRE_RATE)).fill('add');
  manual = true;
}
$('#hp-mx').addEventListener('click', (e) => {
  const t = e.target as Element,
    cell = t.closest<HTMLElement>('.hp-c'),
    row = t.closest<HTMLElement>('.hp-mr'),
    col = t.closest<HTMLElement>('.hp-mh');
  setPlay(false);
  if (cell) {
    cur = cell.dataset.a as string;
    lastKey = cell.dataset.k as string;
    store('cur', cur);
    showOp(cell.dataset.k as OpKey);
    rebuild(0);
    if (matchMedia('(max-width:999.98px)').matches) figTop();
    setPlay(true);
  } else if (row) {
    cur = row.dataset.a as string;
    store('cur', cur);
    lastKey = '';
    mode = 'one';
    modeCh.choose('one');
    startOver();
    figTop();
  } else if (col) {
    sel = DEFS.map((d) => d.id);
    store('sel', sel);
    showOp(col.dataset.k as OpKey);
    byCh.choose('str');
    mode = 'cmp';
    modeCh.choose('cmp');
    hear = 0;
    rebuild(0);
    figTop();
    setPlay(true);
  }
});

/* ---------- 再生の操作 ---------- */
$('#tp-pp').addEventListener('click', () => {
  if (playing) {
    setPlay(false);
    return;
  }
  if (step >= maxStep()) seekTo(0);
  setPlay(true);
});
$('#tp-home').addEventListener('click', () => {
  setPlay(false);
  seekTo(0);
});
$('#tp-step').addEventListener('click', () => {
  setPlay(false);
  seekTo(step + 1, true);
});
$('#tp-back').addEventListener('click', () => {
  setPlay(false);
  seekTo(step - 1, true);
});
const trk = $('#tp-trk');
const trkAt = (e: PointerEvent): number => {
  const b = trk.getBoundingClientRect();
  return Math.max(0, Math.min(1, (e.clientX - b.left) / Math.max(1, b.width))) * maxStep();
};
trk.addEventListener('pointerdown', (e) => {
  trk.setPointerCapture(e.pointerId);
  setPlay(false);
  seekTo(trkAt(e));
});
trk.addEventListener('pointermove', (e) => {
  if (trk.hasPointerCapture(e.pointerId)) seekTo(trkAt(e));
});
trk.addEventListener('keydown', (e) => {
  const big = Math.max(1, Math.round(maxStep() / 20)),
    to = {
      ArrowLeft: step - 1,
      ArrowDown: step - 1,
      ArrowRight: step + 1,
      ArrowUp: step + 1,
      PageDown: step - big,
      PageUp: step + big,
      Home: 0,
      End: maxStep(),
    }[e.key];
  if (to === undefined) return;
  e.preventDefault();
  setPlay(false);
  seekTo(to);
});

/* ---------- 音 ---------- */
$('#hp-snd').addEventListener('click', () => {
  audio.on = !audio.on;
  $('#hp-snd').setAttribute('aria-pressed', String(audio.on));
  $('#hp-sndL').classList.toggle('on', audio.on);
  $('#hp-sndT').textContent = audio.on ? 'オン' : 'オフ';
});
storeToggle($('#hp-snd'));

autoPause(audio, {
  pause: () => setPlay(false),
  hidden: () => setPlay(false),
});

/* ---------- 起動 ---------- */
readColors();
const recolor = () => {
  readColors();
  paint();
};
new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);
new ResizeObserver(() => {
  snap = true;
  paint();
}).observe(root);
/* 保存した値を戻したあと（マイクロタスク）に組み立てる */
queueMicrotask(() => {
  booted = true;
  mode = modeCh.value;
  const v = pg.values();
  rate = v.sp;
  n = v.n;
  audio.vol(v.vol);
  startOver();
});
