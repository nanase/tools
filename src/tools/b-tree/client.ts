/**
 * B木のページの入口。操作の列を先に記録し、再生で 1 手ずつ図と音へ出す。
 * 工程は追加・検索・範囲・削除の 4 つで、切り替えるとその工程を初めから再生する。
 * 表示は 単独（1 行）・比較（複数の行を同時に）・一覧（1 行と計算量の表）の 3 つ
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { RM } from '../../lib/motion';
import { ParamGroup } from '../../lib/param';
import { autoPause } from '../../lib/pause';
import { store, stored, storeToggle } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import type { BarShape } from '../list-queue-stack/model';
import { rng, SHAPES } from '../list-queue-stack/model';
import { SortAudio, TONE_MAX } from '../sort/audio';
import { type Cell, drawFig, hitAt, readColors } from './fig';
import {
  type Avg,
  average,
  BIG_O,
  DEFS,
  type Def,
  type DelMode,
  defOf,
  ENTRY,
  FILL,
  type Frame,
  howOf,
  inspect,
  levelsFor,
  type Method,
  makeKeys,
  makeOps,
  type Op,
  type OpKey,
  runTrace,
  type Shape,
  STAGES,
  type Stage,
  type StageOps,
  vmOf,
} from './model';
import { type Key, SIZE, SPEED, VOL } from './params';

initToolPage();

type Mode = 'one' | 'cmp' | 'list';
type By = 'str' | 'm' | 'shape';

const fmt = (v: number): string => v.toLocaleString('en-US');
const def = (id: string): Def => defOf(id) ?? DEFS[0];
const isShape = (v: unknown): v is BarShape => SHAPES.some((s) => s[0] === v);
const canBulk = (d: Def): boolean => d.kind === 'b' || d.kind === 'bp';
const canFree = (d: Def): boolean => d.kind === 'bp';
/** 比較の対象が次数のときに並べる次数 */
const CMP_M = [3, 4, 8, 16] as const;
/** 手で足せるキーの数の上限 */
const addMax = (): number => 2 * n;

/* ---------- 状態 ---------- */
const root = $('#bt');
const cv = $<HTMLCanvasElement>('#bt-cv');
const audio = new SortAudio();
let cur = defOf(String(stored('cur')))?.id ?? 'b';
let sel = loadSel(stored('sel'));
let shape: BarShape = isShape(stored('shape')) ? (stored('shape') as BarShape) : 'rand';
let n = SIZE.v;
let rate = SPEED.v;
let seed = 3;
let stage: Stage = 0;
/** 手で足した操作を含む操作の列（単独と一覧） */
let ops: StageOps = [[], [], [], []];
let manual = false;
let pressCount = 0;
let cells: Cell[] = [];
let step = 0;
let hear = 0;
let hover: number | null = null;
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
  return a.length ? DEFS.map((d) => d.id).filter((id) => a.includes(id)) : ['b', 'bp', 'bs', 'bst'];
}

/* ---------- 選択肢 ---------- */
const modeCh = new Choice<Mode>($('#bt-mode'), (m) => changeMode(m));
let mode: Mode = modeCh.value;
const mCh = new Choice<string>($('#p-m'), () => {
  if (booted) startOver();
});
const methodCh = new Choice<Method>($('#p-method'), () => {
  if (booted) startOver();
});
const delCh = new Choice<DelMode>($('#p-del'), () => {
  if (booted) startOver();
});
const byCh = new Choice<By>($('#p-by'), () => {
  if (booted) startOver();
});
const rowsCh = new Choice<string>($('#p-rows'), () => buildLevels());
const pageCh = new Choice<string>($('#p-page'), () => buildLevels());
/* スマートフォンの幅では数字が読める 15 個から始める */
const SIZE_NOW = { ...SIZE, v: matchMedia('(max-width:619.98px)').matches ? 15 : SIZE.v };
const pg = new ParamGroup<Key>([SPEED, SIZE_NOW, VOL], (v, k) => {
  rate = v.sp;
  audio.vol(v.vol);
  n = v.n;
  if (!booted) return;
  if (k === 'n') startOver();
});
const mVal = (): number => Number(mCh.value);

/* ---------- 実行 ---------- */
const methodOf = (d: Def): Method => (canBulk(d) ? methodCh.value : 'add');
function traceOf(d: Def, m: number, s: BarShape, list?: StageOps) {
  const keys = makeKeys(s, n, seed);
  return runTrace(d, m, list ?? makeOps(keys, seed, methodOf(d)), {
    free: delCh.value === 'empty',
    vm: vmOf(n),
  });
}
function buildCells(): void {
  const d = def(cur);
  let rows: { name: string; t: Cell['trace'] }[];
  if (mode !== 'cmp') rows = [{ name: d.name, t: traceOf(d, mVal(), shape, ops) }];
  else if (byCh.value === 'm') rows = CMP_M.map((m) => ({ name: `次数 ${m}`, t: traceOf(d, m, shape) }));
  else if (byCh.value === 'shape') rows = SHAPES.map(([s, name]) => ({ name, t: traceOf(d, mVal(), s) }));
  else rows = sel.map((id) => ({ name: def(id).name, t: traceOf(def(id), mVal(), shape) }));
  cells = rows.map((r) => ({ trace: r.t, name: r.name, pos: new Map() }));
  shapes = new WeakMap();
  if (hear >= cells.length) hear = 0;
}
/** 工程の範囲のコマの番号 */
const span = (c: Cell): readonly [number, number] => {
  const t = c.trace,
    a = t.starts[stage];
  return [a, stage < 3 ? t.starts[(stage + 1) as Stage] - 1 : t.frames.length - 1];
};
const maxStep = (): number =>
  cells.reduce((m, c) => {
    const [a, b] = span(c);
    return Math.max(m, b - a);
  }, 0);
const frameOf = (c: Cell, s = step): Frame => {
  const [a, b] = span(c);
  return c.trace.frames[Math.min(b, a + s)];
};
let shapes = new WeakMap<Frame, Shape>();
function shapeOf(c: Cell, f: Frame): Shape {
  let v = shapes.get(f);
  if (!v) {
    v = inspect(c.trace, f);
    shapes.set(f, v);
  }
  return v;
}

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
/** 手での操作を捨て、今の設定で初めから。工程はそのまま */
function startOver(): void {
  setPlay(false);
  ops = makeOps(makeKeys(shape, n, seed), seed, methodOf(def(cur)));
  manual = false;
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
/** s 手目に鳴らす音（キーの列） */
function tonesAt(s: number): number[] {
  const c = cells[hear];
  if (!c) return [];
  const f = frameOf(c, s),
    out = [...f.hot, ...f.got];
  if (f.cell) {
    const v = f.N[f.cell[0]]?.k[f.cell[1]];
    if (v != null) out.push(v);
  }
  return out;
}
const vmNow = (): number => cells[hear]?.trace.vm ?? 99;
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
  audio.play(list, vmNow(), dt, Math.min(0.22, Math.max(0.028, 1.8 / rate)));
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
    audio.play(tonesAt(step), vmNow(), 0.02, 0.1);
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
    frameOf: (c) => frameOf(c),
    hover,
    say,
    now,
    rate,
    snap: snap || RM.matches,
  });
  snap = false;
  $('#bt-say').textContent = say;
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
    t = $('#bt-stT');
  $('#bt-led').className = `led${playing ? ' on' : end && step > 0 ? ' bt-ok' : txt ? ' half' : ''}`;
  if (t.textContent !== txt) t.textContent = txt;
  $('#bt-st').hidden = !txt;
}
/** 工程のボタン: 選択中・回数・次に押すボタンの印 */
function syncStages(): void {
  const one = mode !== 'cmp',
    c = cells[0];
  for (const b of $$<HTMLButtonElement>('#bt-steps button')) {
    const s = Number(b.dataset.s) as Stage,
      v = c?.trace.totals[s];
    b.setAttribute('aria-pressed', String(stage === s));
    $('em', b).textContent = one && v ? `${fmt(v.r + v.w)} 回` : '';
    b.classList.toggle('next', s === stage + 1 && step >= maxStep());
  }
}
function syncResults(): void {
  if (mode === 'cmp') {
    const top = Math.max(
      1,
      ...cells.map((c) => {
        const v = c.trace.totals[stage];
        return v.r + v.w;
      }),
    );
    cells.forEach((c, i) => {
      const f = frameOf(c),
        tr = $(`#bt-rt tr[data-i="${i}"]`),
        cell = $$('.bt-cell')[i],
        [, end] = span(c);
      if (!tr || !cell) return;
      const sum = f.cnt.r + f.cnt.w,
        z = shapeOf(c, f);
      $('em', cell).textContent = `${fmt(sum)} 回`;
      cell.toggleAttribute('data-done', c.trace.starts[stage] + step >= end);
      $<HTMLElement>('.bt-cb b', cell).style.width = `${(sum / top) * 100}%`;
      const td = $$('td', tr),
        tot = c.trace.totals;
      td[0].textContent = fmt(sum);
      td[1].textContent = fmt(f.cnt.r);
      td[2].textContent = fmt(f.cnt.w);
      td[3].textContent = String(z.depth);
      td[4].textContent = `${Math.round(z.fill * 100)} %`;
      for (const s of [0, 1, 2, 3] as const) td[5 + s].textContent = fmt(tot[s].r + tot[s].w);
    });
    return;
  }
  const c = cells[0],
    f = frameOf(c),
    z = shapeOf(c, f);
  $('#o-t').textContent = fmt(f.cnt.r + f.cnt.w);
  $('#o-r').textContent = fmt(f.cnt.r);
  $('#o-w').textContent = fmt(f.cnt.w);
  $('#o-c').textContent = fmt(f.cnt.c);
  $('#o-s').textContent = fmt(f.cnt.s);
  $('#o-m').textContent = fmt(f.cnt.m);
  $('#o-d').textContent = z.depth ? String(z.depth) : '–';
  $('#o-n').textContent = fmt(z.nodes);
  $('#o-k').textContent = fmt(new Set(z.keys).size);
  $('#o-f').textContent = z.nodes ? `${Math.round(z.fill * 100)} %` : '–';
}

/* ---------- 見出しと選択の表示 ---------- */
function syncAll(): void {
  root.dataset.mode = mode;
  const d = def(cur);
  $('#hd-fig').textContent = mode === 'cmp' ? '比較' : d.name;
  cv.setAttribute('aria-label', mode === 'cmp' ? cells.map((c) => c.name).join('・') : d.name);
  const strCmp = mode === 'cmp' && byCh.value === 'str';
  $('#bt-an').textContent = strCmp ? `${sel.length} / ${DEFS.length}` : '';
  for (const b of $$<HTMLButtonElement>('#bt-str [data-v]')) {
    const id = b.dataset.v ?? '';
    b.setAttribute('aria-pressed', String(strCmp ? sel.includes(id) : id === cur));
  }
  for (const b of $$<HTMLButtonElement>('#bt-shape [data-v]'))
    b.setAttribute('aria-pressed', String(b.dataset.v === shape));
  $('#bt-byw').hidden = mode !== 'cmp';
  for (const el of $$('#bt [data-for]')) (el as HTMLElement).hidden = el.dataset.for !== d.id;
  syncRows();
  if (mode !== 'cmp') buildOps();
  if (mode === 'list') buildMatrix();
  if (mode === 'cmp') {
    buildRank();
    buildRace();
  }
  syncSel();
  syncStages();
}
/** 今のデータ構造で使えない行を無効にし、次数の補足を出す */
function syncRows(): void {
  const d = def(cur),
    strCmp = mode === 'cmp' && byCh.value === 'str',
    m = mVal();
  mCh.setOff((!strCmp && d.kind === 'bst') || (mode === 'cmp' && byCh.value === 'm'));
  mCh.note(
    d.kind === 'bst' && !strCmp
      ? '二分探索木は 1 ノードに 1 個'
      : d.kind === 'td' && m % 2 && !strCmp
        ? `トップダウン分割は次数 ${m + 1} で実行`
        : m === 3
          ? '2-3 木と同じ'
          : m === 4
            ? '2-3-4 木と同じ'
            : '',
  );
  methodCh.setOff(!strCmp && !canBulk(d), 'B木と B+木だけ');
  if (strCmp) methodCh.note('B木と B+木だけに適用');
  delCh.setOff(!strCmp && !canFree(d), 'B+木だけ');
  if (strCmp) delCh.note('空で解放は B+木だけに適用');
}
function syncReset(): void {
  $('#bt-reset').hidden = !manual;
  $('#bt-reset2').hidden = !(manual && mode === 'cmp');
}
let lastKey = '';
function syncSel(): void {
  for (const b of $$('.bt-c.sel')) b.classList.remove('sel');
  document.querySelector(`.bt-c[data-a="${cur}"][data-k="${lastKey}"]`)?.classList.add('sel');
}

/* ---------- 操作の枠 ---------- */
const avgs = new Map<string, Avg>();
function avgOf(d: Def): Avg {
  const key = `${d.id}:${mVal()}`;
  let v = avgs.get(key);
  if (!v) {
    v = average(d, mVal());
    avgs.set(key, v);
  }
  return v;
}
const countText = (v: number): string => `${v.toFixed(1)} 回`;
function buildOps(): void {
  const d = def(cur),
    a = avgOf(d);
  $('#bt-ops').innerHTML = STAGES.map(
    ([k, t]) =>
      `<tr data-k="${k}"><td class="bt-ob"><button type="button">${t}</button></td><td class="bt-how">${howOf(d, k)}</td><td class="bt-oo">${BIG_O[d.id][k]}</td><td class="bt-on">${countText(a[k])}</td></tr>`,
  ).join('');
}
function syncOps(): void {
  const c = cells[0],
    f = frameOf(c),
    size = new Set(shapeOf(c, f).keys).size;
  for (const tr of $$('#bt-ops tr[data-k]')) {
    const k = tr.dataset.k as OpKey;
    $<HTMLButtonElement>('button', tr).disabled = k === 'add' ? size >= addMax() : size === 0;
  }
}
/** 今の木に対する新しい操作 */
function newOp(k: OpKey, have: readonly number[]): Op | null {
  const r = rng(seed * 31 + ++pressCount * 17 + 5),
    pick = () => have[Math.floor(r() * have.length)],
    vm = vmOf(n);
  if (k === 'add') {
    const used = new Set(have),
      free: number[] = [];
    for (let v = 1; v <= vm; v++) if (!used.has(v)) free.push(v);
    return free.length ? { t: 'add', k: free[Math.floor(r() * free.length)] } : null;
  }
  if (!have.length) return null;
  if (k === 'find') return { t: 'find', k: pick() };
  if (k === 'del') return { t: 'del', k: pick() };
  const s = [...have].sort((a, b) => a - b),
    a = Math.floor(r() * s.length);
  return { t: 'range', lo: s[a], hi: s[Math.min(s.length - 1, a + 2 + Math.floor(r() * 8))] };
}
$('#bt-ops').addEventListener('click', (e) => {
  const t = e.target as Element,
    b = t.closest<HTMLButtonElement>('button'),
    tr = t.closest<HTMLElement>('tr[data-k]');
  if (!b || !tr || b.disabled) return;
  /* 今の位置までの操作に、押した操作を続ける */
  const k = tr.dataset.k as OpKey,
    c = cells[0],
    f = frameOf(c),
    op = newOp(k, [...new Set(shapeOf(c, f).keys)]);
  if (!op) return;
  const list = ops.map((a) => [...a]) as unknown as [Op[], Op[], Op[], Op[]];
  /* 別の種類の操作も今の工程に続ける。木の続きから動かすため */
  list[stage] = [...list[stage].slice(0, f.tok), op];
  ops = list;
  manual = true;
  setPlay(false);
  buildCells();
  const t2 = cells[0].trace,
    [a] = span(cells[0]),
    first = t2.frames.findIndex((x, i) => i >= a && x.tok === list[stage].length - 1);
  rebuild(Math.max(0, first - a));
  setPlay(true);
});
$('#bt-reset').addEventListener('click', startOver);
$('#bt-reset2').addEventListener('click', startOver);

/* ---------- 工程の切り替え ---------- */
function enter(s: Stage): void {
  stage = s;
  step = 0;
  acc = 0;
  snap = true;
  hover = null;
  hoverText = null;
}
$('#bt-steps').addEventListener('click', (e) => {
  const v = (e.target as Element).closest<HTMLElement>('button')?.dataset.s;
  if (v == null) return;
  setPlay(false);
  lastKey = '';
  enter(Number(v) as Stage);
  syncAll();
  paint();
  setPlay(true);
});

/* ---------- 比較の枠 ---------- */
function buildRace(): void {
  const host = $('#bt-race'),
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
    b.className = 'bt-cell';
    b.setAttribute('aria-pressed', String(i === hear));
    b.title = '音を聞く';
    head.className = 'bt-ch';
    led.className = `led${i === hear ? ' on' : ''}`;
    led.setAttribute('aria-hidden', 'true');
    name.className = 'bt-cn';
    name.textContent = c.name;
    em.textContent = '0 回';
    done.className = 'bt-dn';
    done.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5l2.8 2.8L10 3.5"/></svg>完了';
    head.append(led, name, done, em);
    bar.className = 'bt-cb';
    bar.append(document.createElement('b'));
    b.append(head, bar, cvs);
    b.addEventListener('click', () => setHear(i));
    c.cv = cvs;
    host.append(b);
  });
}

/* ---------- 比較の表 ---------- */
function buildRank(): void {
  const head = ['読み書き', '読み込み', '書き込み', '段数', '充填率', ...STAGES.map((s) => `${s[1]}の合計`)];
  $('#bt-rt').innerHTML =
    `<thead><tr><th class="l"></th>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${cells
      .map(
        (c, i) =>
          `<tr data-i="${i}"><th class="l" scope="row"><button type="button" class="bt-hear" aria-pressed="${i === hear}"><span class="led${i === hear ? ' on' : ''}" aria-hidden="true"></span>${c.name}</button></th>${'<td></td>'.repeat(head.length)}</tr>`,
      )
      .join('')}</tbody>`;
}
function setHear(i: number): void {
  hear = i;
  audio.ready();
  $$('#bt-rt tr[data-i]').forEach((tr, k) => {
    $('.bt-hear', tr).setAttribute('aria-pressed', String(k === i));
    $('.led', tr).classList.toggle('on', k === i);
  });
  $$('.bt-cell').forEach((c, k) => {
    c.setAttribute('aria-pressed', String(k === i));
    $('.led', c).classList.toggle('on', k === i);
  });
  paint();
}
$('#bt-rt').addEventListener('click', (e) => {
  const tr = (e.target as Element).closest<HTMLElement>('tr[data-i]');
  if (tr && (e.target as Element).closest('.bt-hear')) setHear(Number(tr.dataset.i));
});

/* ---------- なぞるとノードと親子が光る ---------- */
function showNode(id: number | null): void {
  if (id === hover) return;
  hover = id;
  hoverText = null;
  if (id != null) {
    const c = cells[0],
      f = frameOf(c),
      v = f.N[id];
    if (v) {
      const cap = id === f.root ? c.trace.rootK : c.trace.maxK;
      hoverText = `ページ ${v.pg}　キー ${v.k.length} / ${cap}${v.leaf ? '' : `　枝 ${v.c.filter((x) => x >= 0).length}`}`;
    }
  }
  paint();
}
function pointAt(e: PointerEvent): void {
  if (mode === 'cmp') return;
  const b = cv.getBoundingClientRect();
  showNode(hitAt(e.clientX - b.left, e.clientY - b.top));
}
cv.addEventListener('pointermove', pointAt);
cv.addEventListener('pointerdown', pointAt);
cv.addEventListener('pointerleave', () => showNode(null));

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
$('#bt-str').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('[data-v]'),
    id = b?.dataset.v;
  if (!id || b?.disabled) return;
  if (mode === 'cmp' && byCh.value === 'str') {
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
$('#bt-shape').addEventListener('click', (e) => {
  const k = (e.target as Element).closest<HTMLElement>('[data-v]')?.dataset.v;
  if (!isShape(k)) return;
  shape = k;
  store('shape', k);
  startOver();
});
$('#bt-new').addEventListener('click', () => {
  seed += 7;
  startOver();
});

/* ---------- 一覧の表 ---------- */
const COLS: readonly (readonly [OpKey, string, Stage])[] = [
  ['find', '検索', 1],
  ['add', '追加', 0],
  ['range', '範囲', 2],
];
function buildMatrix(): void {
  const head = `<thead><tr><th></th>${COLS.map(([k, t]) => `<th scope="col"><button type="button" class="bt-mh" data-k="${k}" title="データ構造を比較">${t}</button></th>`).join('')}<th scope="col" title="1 回の追加で書くページの数。キー 31 個の実測">書く<br>ページ</th><th scope="col" title="ノードの枠に入っているキーの割合。キー 31 個の実測">充填率</th><th scope="col" title="キー 31 個の実測">段数</th></tr></thead>`,
    body = DEFS.map((d) => {
      const a = avgOf(d);
      return `<tr><th scope="row"><button type="button" class="bt-mr" data-a="${d.id}">${d.name}</button></th>${COLS.map(([k]) => `<td><button type="button" class="bt-c${BIG_O[d.id][k] === 'O(n)' ? ' on' : ''}" data-a="${d.id}" data-k="${k}" title="${d.name}: ${k}">${BIG_O[d.id][k]}</button></td>`).join('')}<td class="bt-st">${a.wr.toFixed(1)}</td><td class="bt-st">${Math.round(a.fill * 100)} %</td><td class="bt-st">${a.depth.toFixed(1)}</td></tr>`;
    }).join('');
  $('#bt-mx').innerHTML = `${head}<tbody>${body}</tbody>`;
}
const figTop = () => $('.a-fig').scrollIntoView({ block: 'start', behavior: RM.matches ? 'auto' : 'smooth' });
const stageOfKey = (k: string): Stage => (COLS.find((c) => c[0] === k)?.[2] ?? 0) as Stage;
$('#bt-mx').addEventListener('click', (e) => {
  const t = e.target as Element,
    cell = t.closest<HTMLElement>('.bt-c'),
    row = t.closest<HTMLElement>('.bt-mr'),
    col = t.closest<HTMLElement>('.bt-mh');
  if (!cell && !row && !col) return;
  setPlay(false);
  if (cell) {
    cur = cell.dataset.a as string;
    lastKey = cell.dataset.k as string;
    store('cur', cur);
    enter(stageOfKey(lastKey));
    startOver();
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
    enter(stageOfKey(col.dataset.k as string));
    byCh.choose('str');
    mode = 'cmp';
    modeCh.choose('cmp');
    hear = 0;
    startOver();
    figTop();
    setPlay(true);
  }
});

/* ---------- データベースの段数 ---------- */
function buildLevels(): void {
  const v = levelsFor(Number(rowsCh.value), Number(pageCh.value)),
    bar = (t: string, x: number, on: boolean) =>
      `<div class="bt-lvr${on ? ' on' : ''}"><span>${t}</span><span class="bt-lvb"><b style="width:${(x / v.bin) * 100}%"></b></span><em>${x} 段</em></div>`;
  $('#bt-lv').innerHTML =
    bar('二分探索木', v.bin, false) +
    bar(`B+木 次数 ${v.fan}`, v.bt, true) +
    `<p class="bt-lvn">キーとポインタで ${ENTRY} バイト・充填率 ${Math.round(FILL * 100)} %</p>`;
}

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
$('#bt-snd').addEventListener('click', () => {
  audio.on = !audio.on;
  $('#bt-snd').setAttribute('aria-pressed', String(audio.on));
  $('#bt-sndL').classList.toggle('on', audio.on);
  $('#bt-sndT').textContent = audio.on ? 'オン' : 'オフ';
});
storeToggle($('#bt-snd'));

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
  buildLevels();
  startOver();
});
