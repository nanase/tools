/**
 * ディクショナリのページの入口。操作の列を先に記録し、再生で 1 手ずつ図と音へ出す。
 * 工程は追加・検索・削除の 3 つで、切り替えるとその工程を初めから再生する。
 * 表示は 単独（1 つの表）・比較（複数の表を同時に）・一覧（1 つの表と計算量の表）の 3 つ。
 * 再生と枠の組み立ては赤黒木のページと同じ形にしている
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
import { type Cell, describe, drawFig, hitAt, readColors, shapeOf } from './fig';
import {
  type Avg,
  average,
  BIG_O,
  DEFS,
  type Def,
  defOf,
  type Frame,
  freshKey,
  HASHES,
  type HashKey,
  howOf,
  type KeySet,
  keyOk,
  loadText,
  makeKeys,
  makeOps,
  meaningOf,
  type Op,
  type OpKey,
  runTrace,
  SETS,
  STAGES,
  type Stage,
  type StageOps,
} from './model';
import { type Key, SIZE, SPEED, VOL } from './params';

initToolPage();

type Mode = 'one' | 'cmp' | 'list';
type By = 'str' | 'hash';

const fmt = (v: number): string => v.toLocaleString('en-US');
const def = (id: string): Def => defOf(id) ?? DEFS[0];
/** 手で足せるキーの数の上限 */
const addMax = (): number => 2 * n + 8;

/* ---------- 状態 ---------- */
const root = $('#dc');
const cv = $<HTMLCanvasElement>('#dc-cv');
const inK = $<HTMLInputElement>('#dc-k');
const inV = $<HTMLInputElement>('#dc-v');
const audio = new SortAudio();
let cur = defOf(String(stored('cur')))?.id ?? 'chain';
let sel = loadSel(stored('sel'));
let n = SIZE.v;
let rate = SPEED.v;
let seed = 3;
let stage: Stage = 0;
/** 手で足した操作を含む操作の列（単独と一覧） */
let ops: StageOps = [[], [], []];
let manual = false;
let pressCount = 0;
let cells: Cell[] = [];
let step = 0;
let hear = 0;
let hover: string | null = null;
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
  return a.length ? DEFS.map((d) => d.id).filter((id) => a.includes(id)) : DEFS.map((d) => d.id);
}

/* ---------- 選択肢 ---------- */
const modeCh = new Choice<Mode>($('#dc-mode'), (m) => changeMode(m));
let mode: Mode = modeCh.value;
const byCh = new Choice<By>($('#p-by'), () => {
  if (booted) startOver();
});
const setCh = new Choice<KeySet>($('#p-set'), () => {
  if (booted) startOver();
});
const hashCh = new Choice<HashKey>($('#p-hash'), () => {
  if (booted) startOver();
});
const growCh = new Choice<string>($('#p-grow'), () => {
  if (booted) startOver();
});
/* スマートフォンの幅では 12 個から始める */
const SIZE_NOW = { ...SIZE, v: matchMedia('(max-width:619.98px)').matches ? 12 : SIZE.v };
const pg = new ParamGroup<Key>([SPEED, SIZE_NOW, VOL], (v, k) => {
  rate = v.sp;
  audio.vol(v.vol);
  n = v.n;
  if (!booted) return;
  if (k === 'n') startOver();
});
const optOf = (hash: HashKey = hashCh.value) => ({ n, hash, grow: growCh.value === '1' });

/* ---------- 実行 ---------- */
const opsOf = (set: KeySet): StageOps => makeOps(makeKeys(set, n, seed), set, seed);
function buildCells(): void {
  const d = def(cur);
  let rows: { name: string; t: Cell['trace'] }[];
  if (mode !== 'cmp') rows = [{ name: d.name, t: runTrace(d, ops, optOf()) }];
  else if (byCh.value === 'hash')
    rows = SETS.flatMap(([set, sn]) =>
      HASHES.map(([hk, hn]) => ({ name: `${sn}・${hn}`, t: runTrace(d, opsOf(set), optOf(hk)) })),
    );
  else rows = sel.map((id) => ({ name: def(id).name, t: runTrace(def(id), opsOf(setCh.value), optOf()) }));
  cells = rows.map((r) => ({ trace: r.t, name: r.name, pos: new Map() }));
  if (hear >= cells.length) hear = 0;
}
/** 工程の範囲のコマの番号 */
const span = (c: Cell): readonly [number, number] => {
  const t = c.trace,
    a = t.starts[stage];
  return [a, stage < 2 ? t.starts[(stage + 1) as Stage] - 1 : t.frames.length - 1];
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
  ops = opsOf(setCh.value);
  manual = false;
  rebuild(0);
  suggest();
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
/** s 手目に鳴らす音（場所の番号 + 1） */
function tonesAt(s: number): number[] {
  const c = cells[hear];
  if (!c) return [];
  const f = frameOf(c, s);
  return [...f.look, ...f.put, ...f.got].slice(0, 2).map((a) => (a[1] as number) + 1);
}
function vmNow(): number {
  const c = cells[hear];
  if (!c) return 8;
  const f = frameOf(c);
  return c.trace.def.kind === 'list' ? Math.max(8, c.trace.maxE) : f.M;
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
  $('#dc-say').textContent = say;
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
    t = $('#dc-stT');
  $('#dc-led').className = `led${playing ? ' on' : end && step > 0 ? ' dc-ok' : txt ? ' half' : ''}`;
  if (t.textContent !== txt) t.textContent = txt;
  $('#dc-st').hidden = !txt;
}
/** 工程のボタン: 選択中・回数・次に押すボタンの印 */
function syncStages(): void {
  const one = mode !== 'cmp',
    c = cells[0];
  for (const b of $$<HTMLButtonElement>('#dc-steps button')) {
    const s = Number(b.dataset.s) as Stage,
      v = c?.trace.totals[s];
    b.setAttribute('aria-pressed', String(stage === s));
    $('em', b).textContent = one && v ? `${fmt(v.p + v.mv)} 回` : '';
    b.classList.toggle('next', s === stage + 1 && step >= maxStep());
  }
}
function syncResults(): void {
  if (mode === 'cmp') {
    const top = Math.max(
      1,
      ...cells.map((c) => {
        const v = c.trace.totals[stage];
        return v.p + v.mv;
      }),
    );
    cells.forEach((c, i) => {
      const f = frameOf(c),
        tr = $(`#dc-rt tr[data-i="${i}"]`),
        cell = $$('.dc-cell')[i],
        [, end] = span(c);
      if (!tr || !cell) return;
      const sum = f.cnt.p + f.cnt.mv,
        z = shapeOf(f, c.trace),
        list = c.trace.def.kind === 'list';
      $('em', cell).textContent = `${fmt(sum)} 回`;
      cell.toggleAttribute('data-done', c.trace.starts[stage] + step >= end);
      $<HTMLElement>('.dc-cb b', cell).style.width = `${(sum / top) * 100}%`;
      const td = $$('td', tr),
        tot = c.trace.totals;
      td[0].textContent = fmt(sum);
      td[1].textContent = fmt(f.cnt.p);
      td[2].textContent = fmt(f.cnt.mv);
      td[3].textContent = list ? '–' : z.load.toFixed(2);
      td[4].textContent = z.n ? String(z.max) : '–';
      for (const s of [0, 1, 2] as const) td[5 + s].textContent = fmt(tot[s].p + tot[s].mv);
    });
    return;
  }
  const c = cells[0],
    f = frameOf(c),
    z = shapeOf(f, c.trace),
    d = c.trace.def,
    list = d.kind === 'list';
  $('#o-p').textContent = fmt(f.cnt.p);
  $('#o-mv').textContent = fmt(f.cnt.mv);
  $('#o-n').textContent = fmt(z.n);
  $('#o-m').textContent = list ? '–' : fmt(f.M);
  $('#o-lf').textContent = list ? '–' : z.load.toFixed(2);
  $('#o-lm').textContent = list ? '–' : growCh.value === '1' ? loadText(d) : 'なし';
  $('#o-mean').textContent = z.n ? z.mean.toFixed(2) : '–';
  $('#o-max').textContent = z.n ? String(z.max) : '–';
  $('#o-tb').textContent = d.kind === 'open' || d.kind === 'compact' ? fmt(z.tomb) : '–';
}

/* ---------- 見出しと選択の表示 ---------- */
function syncAll(): void {
  root.dataset.mode = mode;
  const d = def(cur);
  $('#hd-fig').textContent = mode === 'cmp' ? '比較' : d.name;
  cv.setAttribute('aria-label', mode === 'cmp' ? cells.map((c) => c.name).join('・') : d.name);
  const strCmp = mode === 'cmp' && byCh.value === 'str';
  $('#dc-an').textContent = strCmp ? `${sel.length} / ${DEFS.length}` : '';
  for (const b of $$<HTMLButtonElement>('#dc-str [data-v]')) {
    const id = b.dataset.v ?? '';
    b.setAttribute('aria-pressed', String(strCmp ? sel.includes(id) : id === cur));
  }
  $('#dc-byw').hidden = mode !== 'cmp';
  for (const el of $$('#dc [data-for]')) (el as HTMLElement).hidden = el.dataset.for !== d.id;
  if (mode !== 'cmp') buildOps();
  if (mode === 'list') buildMatrix();
  if (mode === 'cmp') {
    buildRank();
    buildRace();
  }
  syncSel();
  syncStages();
}
function syncReset(): void {
  $('#dc-reset').hidden = !manual;
  $('#dc-reset2').hidden = !(manual && mode === 'cmp');
}
let lastKey = '';
function syncSel(): void {
  for (const b of $$('.dc-c.sel')) b.classList.remove('sel');
  document.querySelector(`.dc-c[data-a="${cur}"][data-k="${lastKey}"]`)?.classList.add('sel');
}

/* ---------- 操作の枠 ---------- */
const avgs = new Map<string, Avg>();
function avgOf(d: Def): Avg {
  const key = `${d.id}:${hashCh.value}:${growCh.value}`;
  let v = avgs.get(key);
  if (!v) {
    v = average(d, hashCh.value, growCh.value === '1');
    avgs.set(key, v);
  }
  return v;
}
function buildOps(): void {
  const d = def(cur),
    a = avgOf(d);
  $('#dc-ops').innerHTML = STAGES.map(
    ([k, t]) =>
      `<tr data-k="${k}"><td class="dc-ob"><button type="button">${t}</button></td><td class="dc-how">${howOf(d, k)}</td><td class="dc-oo">${bigO(BIG_O[d.kind][k][0])}</td><td class="dc-on">調べた ${a[k].p.toFixed(1)}<br>移動 ${a[k].mv.toFixed(1)}</td></tr>`,
  ).join('');
}
/** 入力のキー。英小文字と数字だけにそろえる */
const keyNow = (): string => inK.value.trim().toLowerCase();
function syncOps(): void {
  const z = shapeOf(frameOf(cells[0]), cells[0].trace),
    k = keyNow(),
    ok = keyOk(k);
  inK.setAttribute('aria-invalid', String(!!k && !ok));
  for (const tr of $$('#dc-ops tr[data-k]')) {
    const t = tr.dataset.k as OpKey;
    $<HTMLButtonElement>('button', tr).disabled =
      !ok || (t === 'add' ? z.n >= addMax() || z.at.has(k) : t === 'del' ? !z.n : false);
  }
}
/** 入力欄に表にない新しいキーを入れる */
function suggest(): void {
  if (!cells.length || mode === 'cmp') return;
  const t = cells[0].trace,
    z = shapeOf(t.frames[t.frames.length - 1], t),
    k = freshKey(setCh.value, [...z.at.keys(), ...t.keys], seed * 31 + ++pressCount * 17);
  if (!k) return;
  inK.value = k;
  inV.value = meaningOf(k);
  syncOps();
}
inK.addEventListener('input', () => {
  const k = keyNow();
  if (keyOk(k)) inV.value = cells[0]?.trace.vals.get(k) ?? meaningOf(k);
  syncOps();
});
$('#dc-ops').addEventListener('click', (e) => {
  const t = e.target as Element,
    b = t.closest<HTMLButtonElement>('button'),
    tr = t.closest<HTMLElement>('tr[data-k]');
  if (!b || !tr || b.disabled) return;
  const k = tr.dataset.k as OpKey,
    key = keyNow(),
    f = frameOf(cells[0]);
  if (!keyOk(key)) return;
  const v = inV.value.trim().slice(0, 12),
    op: Op = k === 'add' && v && v !== meaningOf(key) ? { t: k, k: key, v } : { t: k, k: key };
  /* 今の位置までの操作に、押した操作を続ける */
  const list = ops.map((a) => [...a]) as unknown as [Op[], Op[], Op[]];
  list[stage] = [...list[stage].slice(0, f.tok < 0 && step > 0 ? list[stage].length : f.tok + 1), op];
  ops = list;
  manual = true;
  setPlay(false);
  buildCells();
  const t2 = cells[0].trace,
    [a] = span(cells[0]),
    first = t2.frames.findIndex((x, i) => i >= a && x.tok === list[stage].length - 1);
  rebuild(Math.max(0, first - a));
  setPlay(true);
  if (k === 'add') suggest();
});
$('#dc-reset').addEventListener('click', startOver);
$('#dc-reset2').addEventListener('click', startOver);

/* ---------- 工程の切り替え ---------- */
function enter(s: Stage): void {
  stage = s;
  step = 0;
  acc = 0;
  snap = true;
  hover = null;
  hoverText = null;
}
$('#dc-steps').addEventListener('click', (e) => {
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
  const host = $('#dc-race'),
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
    b.className = 'dc-cell';
    b.setAttribute('aria-pressed', String(i === hear));
    b.title = '音を聞く';
    head.className = 'dc-ch';
    led.className = `led${i === hear ? ' on' : ''}`;
    led.setAttribute('aria-hidden', 'true');
    name.className = 'dc-cn';
    name.textContent = c.name;
    em.textContent = '0 回';
    done.className = 'dc-dn';
    done.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5l2.8 2.8L10 3.5"/></svg>完了';
    head.append(led, name, done, em);
    bar.className = 'dc-cb';
    bar.append(document.createElement('b'));
    b.append(head, bar, cvs);
    b.addEventListener('click', () => setHear(i));
    c.cv = cvs;
    host.append(b);
  });
}

/* ---------- 比較の表 ---------- */
function buildRank(): void {
  const head = ['調べた回数と移動', '調べた回数', '移動', '負荷率', '最大', ...STAGES.map((s) => `${s[1]}の合計`)];
  $('#dc-rt').innerHTML =
    `<thead><tr><th class="l"></th>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${cells
      .map(
        (c, i) =>
          `<tr data-i="${i}"><th class="l" scope="row"><button type="button" class="dc-hear" aria-pressed="${i === hear}"><span class="led${i === hear ? ' on' : ''}" aria-hidden="true"></span>${c.name}</button></th>${'<td></td>'.repeat(head.length)}</tr>`,
      )
      .join('')}</tbody>`;
}
function setHear(i: number): void {
  hear = i;
  audio.ready();
  $$('#dc-rt tr[data-i]').forEach((tr, k) => {
    $('.dc-hear', tr).setAttribute('aria-pressed', String(k === i));
    $('.led', tr).classList.toggle('on', k === i);
  });
  $$('.dc-cell').forEach((c, k) => {
    c.setAttribute('aria-pressed', String(k === i));
    $('.led', c).classList.toggle('on', k === i);
  });
  paint();
}
$('#dc-rt').addEventListener('click', (e) => {
  const tr = (e.target as Element).closest<HTMLElement>('tr[data-i]');
  if (tr && (e.target as Element).closest('.dc-hear')) setHear(Number(tr.dataset.i));
});

/* ---------- なぞるとキーの値と場所が出る ---------- */
function showKey(k: string | null): void {
  if (k === hover) return;
  hover = k;
  hoverText = null;
  if (k != null) {
    const c = cells[0],
      s = describe(c.trace, frameOf(c), k);
    if (s) hoverText = s;
  }
  paint();
}
function pointAt(e: PointerEvent): void {
  if (mode === 'cmp') return;
  const b = cv.getBoundingClientRect();
  showKey(hitAt(e.clientX - b.left, e.clientY - b.top));
}
cv.addEventListener('pointermove', pointAt);
cv.addEventListener('pointerdown', pointAt);
cv.addEventListener('pointerleave', () => showKey(null));

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
$('#dc-str').addEventListener('click', (e) => {
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
$('#dc-new').addEventListener('click', () => {
  seed += 7;
  startOver();
});

/* ---------- 一覧の表 ---------- */
const COLS: readonly (readonly [OpKey, string, Stage])[] = [
  ['find', '検索', 1],
  ['add', '追加', 0],
  ['del', '削除', 2],
];
function buildMatrix(): void {
  const head = `<thead><tr><th></th>${COLS.map(([k, t]) => `<th scope="col"><button type="button" class="dc-mh" data-k="${k}" title="データ構造を比較">${t}</button></th>`).join('')}<th scope="col">負荷率の<br>上限</th><th scope="col">入れた順</th><th scope="col" title="英単語 24 個を 8 通り試した検索 1 回の平均">検索の<br>調べた回数</th></tr></thead>`,
    body = DEFS.map((d) => {
      const o = BIG_O[d.kind];
      return `<tr><th scope="row"><button type="button" class="dc-mr" data-a="${d.id}">${d.name}</button></th>${COLS.map(([k]) => `<td><button type="button" class="dc-c${o[k][0] === 'O(n)' ? ' on' : ''}" data-a="${d.id}" data-k="${k}" title="${d.name}: ${k}">${bigO(o[k][0])}<small>最悪 ${bigO(o[k][1])}</small></button></td>`).join('')}<td class="dc-st">${loadText(d)}</td><td class="dc-st">${o.ord}</td><td class="dc-st">${avgOf(d).find.p.toFixed(1)}</td></tr>`;
    }).join('');
  $('#dc-mx').innerHTML = `${head}<tbody>${body}</tbody>`;
}
const figTop = () => $('.a-fig').scrollIntoView({ block: 'start', behavior: RM.matches ? 'auto' : 'smooth' });
const stageOfKey = (k: string): Stage => (COLS.find((c) => c[0] === k)?.[2] ?? 0) as Stage;
$('#dc-mx').addEventListener('click', (e) => {
  const t = e.target as Element,
    cell = t.closest<HTMLElement>('.dc-c'),
    row = t.closest<HTMLElement>('.dc-mr'),
    col = t.closest<HTMLElement>('.dc-mh');
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
$('#dc-snd').addEventListener('click', () => {
  audio.on = !audio.on;
  $('#dc-snd').setAttribute('aria-pressed', String(audio.on));
  $('#dc-sndL').classList.toggle('on', audio.on);
  $('#dc-sndT').textContent = audio.on ? 'オン' : 'オフ';
});
storeToggle($('#dc-snd'));

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
