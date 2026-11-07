/**
 * リスト・キュー・スタックのページの入口。追加と取り出しの手順を先に記録し、再生で 1 手ずつ図と音へ出す。
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
import { SortAudio, TONE_MAX } from '../sort/audio';
import { type Cell, drawFig, readColors, rowAt } from './fig';
import {
  type BarShape,
  barVals,
  baseTokens,
  canRun,
  DEFS,
  type Def,
  defOf,
  type Frame,
  type Op,
  type OpKey,
  opCurve,
  type Rule,
  type RuleIn,
  type RuleOut,
  runTrace,
  SHAPES,
  type Token,
  VM,
} from './model';
import { type Key, SIZE, SPEED, VOL } from './params';

initToolPage();

type Mode = 'one' | 'cmp' | 'list';
type Pat = 'bulk' | 'mix';

const fmt = (v: number): string => v.toLocaleString('en-US');
const def = (id: string): Def => defOf(id) ?? DEFS[0];
const isShape = (v: unknown): v is BarShape => SHAPES.some((s) => s[0] === v);
/** 操作の表で回数を見せるバーの数 */
const N_SHOW = 32;
/** 一覧の表から操作を見るときに、先に入れておくバーの割合 */
const PRE_RATE = 2 / 3;

/* ---------- 状態 ---------- */
const root = $('#ls');
const cv = $<HTMLCanvasElement>('#ls-cv');
const audio = new SortAudio();
let cur = defOf(String(stored('cur')))?.id ?? 'stack';
let sel = loadSel(stored('sel'));
let shape: BarShape = isShape(stored('shape')) ? (stored('shape') as BarShape) : 'ramp';
const rules: Record<string, Rule> = (stored('rules') as Record<string, Rule>) ?? {};
let n = SIZE.v;
let rate = SPEED.v;
let seed = 3;
let tokens: Token[] = [];
/** 始める前に入れておくバーの数 */
let pre = 0;
/** 手で操作したか・一覧の表から操作を選んだか（リセットできる間） */
let manual = false;
let cells: Cell[] = [];
let step = 0;
let hear = 0;
let booted = false;

let playing = false;
let acc = 0;
let last = 0;
let raf = 0;
let dirty = false;
let moving = false;
let snap = true;
let animT = 0;

function loadSel(v: unknown): string[] {
  const a = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!defOf(x)) : [];
  return a.length ? DEFS.map((d) => d.id).filter((id) => a.includes(id)) : ['stack', 'queue', 'sll'];
}
/** データ構造の今の決まり。選べない場所が残っていれば、そのデータ構造の既定値に戻す */
function ruleOf(d: Def): Rule | undefined {
  if (!d.rule) return undefined;
  const r = rules[d.id] ?? d.rule;
  return d.noIn?.includes(r.in) ? { in: d.rule.in, out: r.out } : r;
}

/* ---------- 選択肢 ---------- */
const modeCh = new Choice<Mode>($('#ls-mode'), (m) => changeMode(m));
let mode: Mode = modeCh.value;
const patCh = new Choice<Pat>($('#p-pat'), () => {
  if (booted) startOver();
});
const inCh = new Choice<RuleIn>($('#ls-ri'), (v) => setRule('in', v));
const outCh = new Choice<RuleOut>($('#ls-ro'), (v) => setRule('out', v));
const pg = new ParamGroup<Key>([SPEED, SIZE, VOL], (v, k) => {
  rate = v.sp;
  audio.vol(v.vol);
  n = v.n;
  if (!booted) return;
  if (k === 'n') startOver();
});

/* ---------- 実行 ---------- */
function shownDefs(): Def[] {
  return mode === 'cmp' ? sel.map(def) : [def(cur)];
}
function buildCells(): void {
  const vals = barVals(shape, n, seed);
  cells = shownDefs().map((d) => ({
    trace: runTrace(d, { n, vals, tokens, pre, rule: ruleOf(d), seed }),
    pos: new Map(),
  }));
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
  syncReset();
  syncAll();
  paint();
}
/** 手での操作を捨て、今の設定で初めから */
function startOver(): void {
  setPlay(false);
  tokens = baseTokens(patCh.value, n, seed);
  pre = 0;
  manual = false;
  rebuild(0);
}
function setRule(key: 'in' | 'out', v: RuleIn | RuleOut): void {
  if (!booted) return;
  for (const d of shownDefs()) {
    if (!d.rule || (key === 'in' && d.noIn?.includes(v as RuleIn))) continue;
    rules[d.id] = { ...(ruleOf(d) as Rule), [key]: v };
  }
  store('rules', rules);
  const was = playing;
  setPlay(false);
  rebuild(step);
  syncRules();
  if (was) setPlay(true);
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
  const c = cells[hear],
    t = c?.trace;
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
  const dt = animT ? Math.min(200, now - animT) : 16,
    tau = Math.max(30, Math.min(450 / rate, 90));
  animT = now;
  moving = drawFig(cv, cells, {
    cmp: mode === 'cmp',
    hear,
    n,
    step,
    snap: snap || RM.matches,
    k: 1 - Math.exp(-dt / tau),
  });
  snap = false;
  syncTrack();
  syncResults();
  syncStatus();
  if (mode === 'one') syncOps();
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
    t = $('#ls-stT');
  $('#ls-led').className = `led${playing ? ' on' : end && step > 0 ? ' ls-ok' : txt ? ' half' : ''}`;
  if (t.textContent !== txt) t.textContent = txt;
  $('#ls-st').hidden = !txt;
}
const avgOf = (f: Frame): string => (f.wN ? `${(f.wS / f.wN).toFixed(1)} 回` : '–');
const maxOf = (f: Frame): string => (f.wN ? `${f.wM} 回` : '–');
const keepOf = (f: Frame): string => (f.outN > 1 ? `${Math.round((f.ord / (f.outN - 1)) * 100)} %` : '–');
const lenOf = (f: Frame): number => f.items.reduce((c: number, v) => (v == null ? c : c + 1), 0);
function syncResults(): void {
  if (mode === 'cmp') {
    cells.forEach((c, i) => {
      const f = frameOf(c),
        tr = $(`#ls-rt tr[data-i="${i}"]`);
      if (!tr) return;
      const td = $$('td', tr);
      td[0].textContent = fmt(f.reads + f.writes);
      td[1].textContent = String(lenOf(f));
      td[2].textContent = String(f.max);
      td[3].textContent = avgOf(f);
      td[4].textContent = maxOf(f);
      td[5].textContent = keepOf(f);
    });
    return;
  }
  const f = frameOf(cells[0]);
  $('#ls-say').textContent = f.say;
  $('#o-t').textContent = fmt(f.reads + f.writes);
  $('#o-r').textContent = fmt(f.reads);
  $('#o-w').textContent = fmt(f.writes);
  $('#o-l').textContent = String(lenOf(f));
  $('#o-m').textContent = String(f.max);
  $('#o-a').textContent = avgOf(f);
  $('#o-x').textContent = maxOf(f);
  $('#o-k').textContent = keepOf(f);
}

/* ---------- 見出しと選択の表示 ---------- */
function syncAll(): void {
  root.dataset.mode = mode;
  const d = def(cur);
  $('#hd-fig').textContent = mode === 'cmp' ? '比較' : d.name;
  cv.setAttribute('aria-label', mode === 'cmp' ? sel.map((id) => def(id).name).join('・') : d.name);
  $('#ls-an').textContent = mode === 'cmp' ? `${sel.length} / ${DEFS.length}` : '';
  for (const b of $$<HTMLButtonElement>('#ls-str [data-v]'))
    b.setAttribute('aria-pressed', String(mode === 'cmp' ? sel.includes(b.dataset.v ?? '') : b.dataset.v === cur));
  for (const b of $$<HTMLButtonElement>('#ls-shape [data-v]'))
    b.setAttribute('aria-pressed', String(b.dataset.v === shape));
  $('#ls-say').hidden = mode === 'cmp';
  for (const el of $$('#ls [data-for]')) (el as HTMLElement).hidden = el.dataset.for !== d.id;
  syncRules();
  if (mode === 'one') buildOps();
  if (mode === 'cmp') buildRank();
  syncSel();
}
function syncRules(): void {
  const can = shownDefs().filter((d) => d.rule),
    r = can[0] ? ruleOf(can[0]) : undefined,
    off = !r,
    note = '変更できません';
  inCh.setOff(off, off ? note : '');
  outCh.setOff(off, off ? note : '');
  if (!r) return;
  inCh.set(r.in);
  outCh.set(r.out);
  inCh.disable(
    'sort',
    can.every((d) => d.noIn?.includes('sort')),
  );
}
function syncReset(): void {
  $('#ls-reset').hidden = !manual;
  $('#ls-reset2').hidden = !(manual && mode === 'cmp');
}
function syncSel(): void {
  for (const b of $$('.ls-c.sel')) b.classList.remove('sel');
  document.querySelector(`.ls-c[data-a="${cur}"][data-k="${lastKey}"]`)?.classList.add('sel');
}
let lastKey = '';

/* ---------- 操作の枠 ---------- */
const counts = new Map<string, number>();
function countOf(d: Def, op: Op): number {
  const k = `${d.id}:${op.key}`;
  let c = counts.get(k);
  if (c === undefined) {
    [c] = opCurve(d, op, [N_SHOW]);
    counts.set(k, c);
  }
  return c;
}
const countText = (v: number): string => `${Number.isInteger(v) ? v : v.toFixed(1)} 回`;
function buildOps(): void {
  const d = def(cur);
  $('#ls-ops').innerHTML = d.ops
    .map(
      (o) =>
        `<tr data-k="${o.key}"><td><button type="button">${o.label}</button></td><td class="ls-oo">${bigO(o.o)}</td><td class="ls-on">${countText(countOf(d, o))}</td></tr>`,
    )
    .join('');
}
function syncOps(): void {
  const c = cells[0],
    f = frameOf(c),
    len = lenOf(f);
  for (const tr of $$('#ls-ops tr[data-k]')) {
    const op = c.trace.def.ops.find((o) => o.key === tr.dataset.k);
    if (op) $<HTMLButtonElement>('button', tr).disabled = !canRun(op, len, c.trace.cap);
  }
}
$('#ls-ops').addEventListener('click', (e) => {
  const t = e.target as Element,
    b = t.closest<HTMLButtonElement>('button'),
    tr = t.closest<HTMLElement>('tr[data-k]');
  if (!b || !tr || b.disabled) return;
  /* 今の位置までの操作に、押した操作を続ける */
  const f = frameOf(cells[0]);
  tokens = [...tokens.slice(0, f.tok), tr.dataset.k as OpKey];
  manual = true;
  setPlay(false);
  const vals = barVals(shape, n, seed),
    d = def(cur),
    first = runTrace(d, { n, vals, tokens, pre, rule: ruleOf(d), seed }).frames.findIndex(
      (x) => x.tok === tokens.length,
    );
  rebuild(Math.max(0, first - 1));
  setPlay(true);
});
$('#ls-reset').addEventListener('click', startOver);
$('#ls-reset2').addEventListener('click', startOver);

/* ---------- 比較の表 ---------- */
function buildRank(): void {
  $('#ls-rt').innerHTML =
    `<thead><tr><th class="l">データ構造</th><th>読み書き</th><th>現在の要素数</th><th>最大の要素数</th><th>平均の待ち回数</th><th>最長の待ち回数</th><th>追加順の維持率</th></tr></thead><tbody>${cells
      .map(
        (c, i) =>
          `<tr data-i="${i}"><th class="l" scope="row"><button type="button" class="ls-hear" aria-pressed="${i === hear}"><span class="led${i === hear ? ' on' : ''}" aria-hidden="true"></span>${c.trace.def.name}</button></th><td></td><td></td><td></td><td></td><td></td><td></td></tr>`,
      )
      .join('')}</tbody>`;
}
function setHear(i: number): void {
  hear = i;
  audio.ready();
  $$('#ls-rt tr[data-i]').forEach((tr, k) => {
    $('.ls-hear', tr).setAttribute('aria-pressed', String(k === i));
    $('.led', tr).classList.toggle('on', k === i);
  });
  paint();
}
$('#ls-rt').addEventListener('click', (e) => {
  const tr = (e.target as Element).closest<HTMLElement>('tr[data-i]');
  if (tr && (e.target as Element).closest('.ls-hear')) setHear(Number(tr.dataset.i));
});
cv.addEventListener('click', (e) => {
  if (mode !== 'cmp') return;
  const b = cv.getBoundingClientRect(),
    i = rowAt(e.clientY - b.top, cells.length, b.width, true);
  if (i >= 0) setHear(i);
});

/* ---------- 表示の切り替え ---------- */
function changeMode(m: Mode): void {
  if (!booted) return;
  if (mode === 'cmp' && cells[hear]) cur = cells[hear].trace.def.id;
  mode = m;
  if (m === 'cmp' && !sel.includes(cur)) sel = DEFS.map((d) => d.id).filter((id) => sel.includes(id) || id === cur);
  if (m === 'cmp') hear = Math.max(0, sel.indexOf(cur));
  store('cur', cur);
  store('sel', sel);
  startOver();
}
$('#ls-str').addEventListener('click', (e) => {
  const id = (e.target as Element).closest<HTMLElement>('[data-v]')?.dataset.v;
  if (!id) return;
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
  const was = playing && !manual;
  startOver();
  if (was) setPlay(true);
});
$('#ls-shape').addEventListener('click', (e) => {
  const k = (e.target as Element).closest<HTMLElement>('[data-v]')?.dataset.v;
  if (!isShape(k)) return;
  shape = k;
  store('shape', k);
  const was = playing;
  setPlay(false);
  rebuild(0);
  if (was) setPlay(true);
});
$('#ls-new').addEventListener('click', () => {
  const was = playing;
  seed += 7;
  startOver();
  if (was) setPlay(true);
});

/* ---------- 一覧の表 ---------- */
const figTop = () => $('.a-fig').scrollIntoView({ block: 'start', behavior: RM.matches ? 'auto' : 'smooth' });
function showOp(key: OpKey): void {
  tokens = [key];
  pre = Math.floor(n * PRE_RATE);
  manual = true;
}
function toCompare(): void {
  mode = 'cmp';
  modeCh.choose('cmp');
  hear = 0;
  store('sel', sel);
  rebuild(0);
  figTop();
  setPlay(true);
}
$('#ls-mx').addEventListener('click', (e) => {
  const t = e.target as Element,
    cell = t.closest<HTMLElement>('.ls-c'),
    row = t.closest<HTMLElement>('.ls-mr'),
    col = t.closest<HTMLElement>('.ls-mh');
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
    const k = col.dataset.k as OpKey;
    sel = DEFS.filter((d) => d.ops.some((o) => o.key === k)).map((d) => d.id);
    showOp(k);
    toCompare();
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
$('#ls-snd').addEventListener('click', () => {
  audio.on = !audio.on;
  $('#ls-snd').setAttribute('aria-pressed', String(audio.on));
  $('#ls-sndL').classList.toggle('on', audio.on);
  $('#ls-sndT').textContent = audio.on ? 'オン' : 'オフ';
});
storeToggle($('#ls-snd'));

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
