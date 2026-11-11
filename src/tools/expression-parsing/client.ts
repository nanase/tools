/**
 * 式の構文解析のページの入口。式を手順ごとに先に記録し、再生で 1 手ずつ図と音へ出す。
 * 字句解析・構文解析・計算は別の工程で、切り替えるとその工程を初めから再生する。
 * 表示は 単独・比較（決まりか手法を並べる）・一覧（1 つの図と、式ごとの表）の 3 つ
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { RM } from '../../lib/motion';
import { ParamGroup } from '../../lib/param';
import { autoPause } from '../../lib/pause';
import { store, stored, storeToggle } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { SortAudio, TONE_MAX } from '../sort/audio';
import { type Cell, drawFig, framesOf, readColors, type Stage } from './fig';
import {
  build,
  calcTones,
  checkRule,
  fmt,
  lexTones,
  MAX_LEN,
  METHODS,
  type MethodId,
  methodOf,
  parseTones,
  RULES,
  type RuleDef,
  ruleOf,
  SAMPLES,
  SYM,
  setAssoc,
  swapRows,
  TONE_VM,
  type Trace,
} from './model';
import { type Key, SPEED, VOL } from './params';

initToolPage();

type Mode = 'one' | 'cmp' | 'list';
type By = 'rule' | 'method';
type Table = 'ans' | 'steps';
const STAGES: readonly Stage[] = ['lex', 'parse', 'calc'];

const num = (v: number): string => v.toLocaleString('en-US');
const ansOf = (t: Trace): string => (t.err ? 'エラー' : t.aborted ? '打ち切り' : fmt(t.ans));
const stepsOf = (t: Trace): string => `${num(t.steps)}${t.aborted ? '+' : ''}`;

/* ---------- 状態 ---------- */
const root = $('#ep');
const cv = $<HTMLCanvasElement>('#ep-cv');
const input = $<HTMLInputElement>('#ep-in');
const audio = new SortAudio();
const savedExpr = stored('expr');
let expr = typeof savedExpr === 'string' && savedExpr.length <= MAX_LEN ? savedExpr : SAMPLES[0][0];
let custom = checkRule(stored('custom'));
let ruleId = ((): string => {
  const v = stored('rule');
  return v === 'custom' && custom ? 'custom' : typeof v === 'string' && ruleOf(v) ? v : 'std';
})();
let methodId = (methodOf(String(stored('method')))?.id ?? 'sy') as MethodId;
let stage: Stage = 'parse';
let table: Table = 'ans';
let cells: Cell[] = [];
let step = 0;
let hear = 0;
let booted = false;

let rate = SPEED.v;
let playing = false;
let acc = 0;
let last = 0;
let raf = 0;
let dirty = false;
let moving = false;
let snap = true;

const ruleDef = (id = ruleId): RuleDef => (id === 'custom' && custom ? custom : (ruleOf(id) ?? RULES[0]));

/* ---------- 記録 ---------- */
const cache = new Map<string, Trace>();
function traceOf(src: string, rid: string, mid: MethodId): Trace {
  const k = `${src}|${rid}|${mid}`;
  let t = cache.get(k);
  if (!t) {
    t = build(src, ruleDef(rid), mid);
    cache.set(k, t);
  }
  return t;
}

/* ---------- 選択肢 ---------- */
const modeCh = new Choice<Mode>($('#ep-mode'), (m) => changeMode(m));
let mode: Mode = modeCh.value;
const byCh = new Choice<By>($('#p-by'), () => {
  if (booted) rebuild(false);
});
const tableCh = new Choice<Table>($('#ep-tbl'), (v) => {
  table = v;
  if (booted) buildMatrix();
});
table = tableCh.value;
const pg = new ParamGroup<Key>([SPEED, VOL], (v) => {
  rate = v.sp;
  audio.vol(v.vol);
});

function buildCells(): void {
  const old = cells;
  if (mode === 'cmp') {
    const list =
      byCh.value === 'rule'
        ? RULES.map((r) => ({ name: r.name, trace: traceOf(expr, r.id, methodId) }))
        : METHODS.map((m) => ({ name: m.name, trace: traceOf(expr, ruleId, m.id) }));
    cells = list.map((c, i) => ({ ...c, pos: old.length > 1 ? (old[i]?.pos ?? new Map()) : new Map() }));
  } else {
    cells = [{ name: '', trace: traceOf(expr, ruleId, methodId), pos: old.length === 1 ? old[0].pos : new Map() }];
  }
  if (hear >= cells.length) hear = 0;
}
const lenOf = (t: Trace, s: Stage): number => (s === 'lex' ? t.lex.length : framesOf(t, s).length);
const maxStep = (): number => cells.reduce((m, c) => Math.max(m, lenOf(c.trace, stage) - 1), 0);

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
/** s 手目に鳴らす音（音階の値の列） */
function tonesAt(s: number): number[] {
  const t = cells[hear]?.trace;
  if (!t || s >= lenOf(t, stage)) return [];
  if (stage === 'lex') return lexTones(t.lex[s], t.s.length);
  const f = framesOf(t, stage)[s];
  return stage === 'calc' ? calcTones(t, f) : parseTones(f);
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
  audio.play(list, TONE_VM, dt, Math.min(0.22, Math.max(0.028, 1.8 / rate)));
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
    audio.play(tonesAt(step), TONE_VM, 0.02, 0.1);
  }
  syncStatus();
  paint();
}

/* ---------- 描く ---------- */
function draw(now: number): void {
  if (!cells.length) return;
  moving = drawFig(cv, cells, { cmp: mode === 'cmp', stage, step, now, rate, snap: snap || RM.matches });
  snap = false;
  syncSay();
  syncTrack();
  syncResults();
  syncStatus();
  syncStages();
}
function syncSay(): void {
  const t = cells[0]?.trace;
  if (!t || mode === 'cmp') {
    $('#ep-say').textContent = '';
    return;
  }
  const L = stage === 'lex' ? t.lex : framesOf(t, stage);
  $('#ep-say').textContent = L[Math.min(step, L.length - 1)].say;
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
  $('#tp-a').textContent = num(step);
  $('#tp-b').textContent = num(tot);
  $('#tp-t').textContent = tot / rate < 0.1 ? '' : `${mmss(step / rate)} / ${mmss(tot / rate)}`;
  trk.setAttribute('aria-valuemax', String(tot));
  trk.setAttribute('aria-valuenow', String(step));
  trk.setAttribute('aria-valuetext', `${num(step)} / ${num(tot)} 手順`);
}
function syncStatus(): void {
  if (!cells.length) return;
  const end = step >= maxStep(),
    txt = playing ? '実行中' : end && step > 0 ? '完了' : step > 0 ? '一時停止中' : '',
    t = $('#ep-stT');
  $('#ep-led').className = `led${playing ? ' on' : end && step > 0 ? ' ep-ok' : txt ? ' half' : ''}`;
  if (t.textContent !== txt) t.textContent = txt;
  $('#ep-st').hidden = !txt;
}
/** 工程のボタン: 選択中・手順の数・次に押すボタンの印 */
function syncStages(): void {
  const cmp = mode === 'cmp',
    head = cells[0]?.trace,
    at = STAGES.indexOf(stage),
    end = step >= maxStep() && !playing;
  if (!head) return;
  for (const b of $$<HTMLButtonElement>('#ep-steps button')) {
    const s = b.dataset.s as Stage,
      can = s !== 'calc' || cmp || head.calc.length > 0;
    b.setAttribute('aria-pressed', String(stage === s));
    b.disabled = !can;
    $('em', b).textContent = String(Math.max(...cells.map((c) => lenOf(c.trace, s))) - 1);
    b.classList.toggle('next', end && can && STAGES.indexOf(s) === at + 1);
  }
}
function syncResults(): void {
  if (mode === 'cmp') {
    const base = ansOf(cells[0].trace),
      maxSteps = Math.max(1, ...cells.map((c) => c.trace.steps));
    cells.forEach((c, i) => {
      const t = c.trace,
        el = $$('.ep-cell')[i];
      if (!el) return;
      const L = stage === 'lex' ? t.lex : framesOf(t, stage),
        pf = stage === 'parse' ? t.parse[Math.min(step, t.parse.length - 1)] : null,
        st = pf ? pf.step : stage === 'lex' ? 0 : t.steps,
        em = $('em', el),
        ans = ansOf(t);
      el.toggleAttribute('data-done', step >= L.length - 1 && !t.err && !t.aborted);
      if (byCh.value === 'rule') {
        em.textContent = t.err || t.aborted ? ans : `= ${ans}`;
        em.classList.toggle('diff', ans !== base);
      } else {
        em.textContent = `${num(st)}${t.aborted && step >= L.length - 1 ? '+' : ''} 手順`;
        em.classList.remove('diff');
      }
      $<HTMLElement>('.ep-cb b', el).style.width = `${Math.min(100, (st / maxSteps) * 100)}%`;
    });
    return;
  }
  const t = cells[0].trace,
    pf =
      stage === 'parse' ? t.parse[Math.min(step, t.parse.length - 1)] : stage === 'calc' ? t.parse.at(-1) : t.parse[0];
  $('#o-a').textContent = ansOf(t);
  $('#o-s').textContent = t.trunc && stage === 'parse' ? `${num(pf?.step ?? 0)} / ${stepsOf(t)}` : num(pf?.step ?? 0);
  $('#o-c').textContent = num(pf?.cmp ?? 0);
  $('#o-m').textContent = num(pf?.maxS ?? 0);
  $('#o-b').textContent = num(pf?.back ?? 0);
  $('#o-t').textContent = String(t.toks.length);
  $('#o-d').textContent = t.err || t.aborted ? '–' : String(t.depth);
}

/* ---------- 枠 ---------- */
function setPressed(host: HTMLElement, v: string): void {
  for (const b of $$('[data-v]', host)) b.setAttribute('aria-pressed', String(b.dataset.v === v));
}
function buildRule(): void {
  const host = $('#ep-rule'),
    was = host.querySelector('[data-v="custom"]');
  setPressed(host, ruleId);
  if (ruleId === 'custom' && !was) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.v = 'custom';
    b.setAttribute('aria-pressed', 'true');
    b.textContent = '編集中';
    host.append(b);
  }
  if (ruleId !== 'custom' && was) was.remove();
  const def = ruleDef(),
    body = $('#ep-rb');
  body.textContent = '';
  def.rank.forEach((row, i) => {
    const tr = document.createElement('tr'),
      syms = [...new Set(row.map((o) => (o === 'neg' ? '−（符号）' : SYM[o])))].join('　'),
      bin = row.some((o) => o !== 'neg'),
      right = row.some((o) => def.right.includes(o));
    tr.innerHTML = `<td class="n">${i + 1}</td><td class="o"></td><td>${
      bin
        ? `<div class="seg" data-row="${i}" role="group" aria-label="結合"><button type="button" data-as="L" aria-pressed="${!right}">左結合</button><button type="button" data-as="R" aria-pressed="${right}">右結合</button></div>`
        : '<span class="ep-out">–</span>'
    }</td><td class="r"><button type="button" class="mv" data-up="${i}"${i === 0 ? ' disabled' : ''} title="順位を上げる" aria-label="順位を上げる">↑</button><button type="button" class="mv" data-dn="${i}"${i === def.rank.length - 1 ? ' disabled' : ''} title="順位を下げる" aria-label="順位を下げる">↓</button></td>`;
    $('.o', tr).textContent = syms;
    body.append(tr);
  });
  holdRuleRows(body);
}
/** 表の段の数（決まりで 1〜5）で下の枠が動かないよう、いちばん多い段の数の高さを取っておく */
const RANK_MAX = Math.max(...RULES.map((r) => r.rank.length));
function holdRuleRows(body: HTMLTableSectionElement | HTMLElement): void {
  const rw = body.closest<HTMLElement>('.ep-rw'),
    head = rw?.querySelector('thead');
  if (!rw || !head) return;
  const rowH = Math.max(0, ...[...body.children].map((r) => r.getBoundingClientRect().height));
  if (!rowH) return;
  /* 10 は表の上の余白（.ep-rt の margin-top） */
  const h = Math.ceil(head.getBoundingClientRect().height + rowH * RANK_MAX + 10);
  if (h > (Number.parseFloat(rw.style.minHeight) || 0)) rw.style.minHeight = `${h}px`;
}
function buildRace(): void {
  const host = $('#ep-race'),
    m = cells.length;
  host.style.setProperty('--cols', String(m <= 4 ? 2 : 3));
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
    b.className = 'ep-cell';
    b.setAttribute('aria-pressed', String(i === hear));
    b.title = '音を聞く';
    head.className = 'ep-ch';
    led.className = `led${i === hear ? ' on' : ''}`;
    led.setAttribute('aria-hidden', 'true');
    name.className = 'ep-cn';
    name.textContent = c.name;
    done.className = 'ep-dn';
    done.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5l2.8 2.8L10 3.5"/></svg>完了';
    head.append(led, name, done, em);
    bar.className = 'ep-cb';
    bar.append(document.createElement('b'));
    b.append(head, bar, cvs);
    b.addEventListener('click', () => setHear(i));
    c.cv = cvs;
    host.append(b);
  });
}
function buildRank(): void {
  const body = $('#ep-rkb');
  $('#ep-rkh').textContent = byCh.value === 'rule' ? '決まり' : '手法';
  body.textContent = '';
  cells.forEach((c, i) => {
    const t = c.trace,
      tr = document.createElement('tr'),
      vals = [
        ansOf(t),
        stepsOf(t),
        num(t.cmp),
        String(t.maxS),
        num(t.back),
        t.err || t.aborted ? '–' : String(t.depth),
      ];
    tr.dataset.i = String(i);
    tr.innerHTML = `<th class="l" scope="row"><button type="button" class="ep-hear" aria-pressed="${i === hear}"><span class="led${i === hear ? ' on' : ''}" aria-hidden="true"></span><span></span></button></th>`;
    $('.ep-hear span:last-child', tr).textContent = c.name;
    for (const v of vals) {
      const td = document.createElement('td');
      td.textContent = v;
      tr.append(td);
    }
    body.append(tr);
  });
}
function setHear(i: number): void {
  hear = i;
  audio.ready();
  $$('#ep-rkb tr[data-i]').forEach((tr, k) => {
    $('.ep-hear', tr).setAttribute('aria-pressed', String(k === i));
    $('.led', tr).classList.toggle('on', k === i);
  });
  $$('.ep-cell').forEach((c, k) => {
    c.setAttribute('aria-pressed', String(k === i));
    $('.led', c).classList.toggle('on', k === i);
  });
  paint();
}
$('#ep-rkb').addEventListener('click', (e) => {
  const tr = (e.target as Element).closest<HTMLElement>('tr[data-i]');
  if (tr && (e.target as Element).closest('.ep-hear')) setHear(Number(tr.dataset.i));
});
/** 一覧の表。行は見本の式、列は決まりか手法。自分で編集した決まりも手順の数の表に使う */
function buildMatrix(): void {
  const mx = $('#ep-mx'),
    ans = table === 'ans';
  $('#hd-mat').textContent = ans ? '式と決まりの答え' : '式と手法の手順の数';
  $('#ep-matN').textContent = ans
    ? '色付きは数学の慣習と違う答え'
    : `決まりは ${ruleDef().name}。色付きは最少の 3 倍以上`;
  const cols = ans ? RULES.map((r) => ({ id: r.id, name: r.name })) : METHODS.map((m) => ({ id: m.id, name: m.name }));
  mx.textContent = '';
  const head = document.createElement('thead'),
    hr = document.createElement('tr');
  hr.append(document.createElement('th'));
  for (const c of cols) {
    const th = document.createElement('th'),
      b = document.createElement('button');
    th.scope = 'col';
    b.type = 'button';
    b.className = 'ep-mh';
    b.dataset.col = c.id;
    b.textContent = c.name;
    th.append(b);
    hr.append(th);
  }
  head.append(hr);
  const body = document.createElement('tbody');
  for (const [src, note] of SAMPLES) {
    const tr = document.createElement('tr'),
      th = document.createElement('th'),
      rb = document.createElement('button');
    th.scope = 'row';
    rb.type = 'button';
    rb.className = 'ep-mr';
    rb.dataset.row = src;
    rb.title = `${note}: 比較`;
    rb.textContent = src;
    th.append(rb);
    tr.append(th);
    const list = cols.map((c) => (ans ? traceOf(src, c.id, 'pr') : traceOf(src, ruleId, c.id as MethodId))),
      base = ans ? ansOf(list[0]) : '',
      min = ans ? 0 : Math.min(...list.map((t) => Math.max(1, t.steps)));
    list.forEach((t, k) => {
      const td = document.createElement('td'),
        b = document.createElement('button'),
        c = cols[k],
        sel = src === expr && (ans ? ruleId === c.id : methodId === c.id),
        hot = ans ? ansOf(t) !== base : t.steps >= min * 3;
      b.type = 'button';
      b.className = `ep-c${hot ? ' on' : ''}${sel ? ' sel' : ''}${ans && t.err ? ' er' : ''}`;
      b.dataset.src = src;
      b.dataset[ans ? 'r' : 'm'] = c.id;
      b.title = `${src}: ${c.name}`;
      b.textContent = ans ? ansOf(t) : stepsOf(t);
      td.append(b);
      tr.append(td);
    });
    body.append(tr);
  }
  mx.append(head, body);
}
function syncAll(): void {
  root.dataset.mode = mode;
  const cmp = mode === 'cmp';
  $('#hd-fig').textContent = cmp ? '比較' : '式の構文解析';
  cv.setAttribute('aria-label', cmp ? cells.map((c) => c.name).join('・') : '式の構文解析');
  if (input.value !== expr) input.value = expr;
  setPressed($('#ep-smp'), expr);
  setPressed($('#ep-met'), methodId);
  $('#ep-man').textContent = methodOf(methodId)?.ex ?? '';
  $('#ep-byw').hidden = !cmp;
  buildRule();
  if (cmp) {
    buildRank();
    buildRace();
  }
  if (mode === 'list') buildMatrix();
  syncStages();
}

/** 記録し直す。end なら工程の最後の手順へ移る（決まりを変えたときは組み変わる様子を見せる） */
function rebuild(end: boolean, play = false): void {
  setPlay(false);
  buildCells();
  if (stage === 'calc' && !cells.some((c) => c.trace.calc.length)) stage = 'parse';
  step = end ? maxStep() : 0;
  acc = 0;
  syncAll();
  paint();
  if (play) setPlay(true);
}
function clearCells(): void {
  cells = [];
  snap = true;
}

/* ---------- 操作 ---------- */
function setExpr(v: string, end: boolean, play: boolean): void {
  expr = v;
  store('expr', v);
  if (stage === 'lex' && !end) stage = 'parse';
  clearCells();
  rebuild(end, play);
}
$('#ep-smp').addEventListener('click', (e) => {
  const v = (e.target as Element).closest<HTMLElement>('[data-v]')?.dataset.v;
  if (v == null) return;
  if (stage === 'calc') stage = 'parse';
  setExpr(v, false, true);
});
input.maxLength = MAX_LEN;
input.addEventListener('input', () => {
  if (stage === 'lex') stage = 'parse';
  setExpr(input.value, true, false);
});
$('#ep-met').addEventListener('click', (e) => {
  const v = (e.target as Element).closest<HTMLElement>('[data-v]')?.dataset.v;
  if (!v) return;
  methodId = v as MethodId;
  store('method', v);
  if (stage !== 'parse') stage = 'parse';
  clearCells();
  rebuild(false, true);
});
function setRule(id: string): void {
  ruleId = id;
  store('rule', id);
  rebuild(stage !== 'lex');
}
$('#ep-rule').addEventListener('click', (e) => {
  const v = (e.target as Element).closest<HTMLElement>('[data-v]')?.dataset.v;
  if (v && v !== 'custom') setRule(v);
});
function editRule(next: RuleDef): void {
  custom = next;
  store('custom', next);
  for (const k of cache.keys()) if (k.includes('|custom|')) cache.delete(k);
  setRule('custom');
}
$('#ep-rb').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button');
  if (!b || b.disabled) return;
  const def = ruleDef();
  if (b.dataset.up != null) {
    const i = Number(b.dataset.up);
    editRule(swapRows(def, i, i - 1));
  } else if (b.dataset.dn != null) {
    const i = Number(b.dataset.dn);
    editRule(swapRows(def, i, i + 1));
  } else if (b.dataset.as) {
    const row = Number((b.parentElement as HTMLElement).dataset.row),
      right = b.dataset.as === 'R';
    if (b.getAttribute('aria-pressed') !== 'true') editRule(setAssoc(def, row, right));
  }
});
$('#ep-steps').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button');
  if (!b || b.disabled) return;
  setPlay(false);
  stage = b.dataset.s as Stage;
  step = 0;
  acc = 0;
  snap = true;
  syncStages();
  paint();
  setPlay(true);
});
function changeMode(m: Mode): void {
  if (!booted) return;
  mode = m;
  hear = 0;
  clearCells();
  rebuild(false);
  if (m === 'list' && matchMedia('(max-width:999.98px)').matches)
    $('.a-mat').scrollIntoView({ block: 'start', behavior: RM.matches ? 'auto' : 'smooth' });
}
const figTop = () => $('.a-fig').scrollIntoView({ block: 'start', behavior: RM.matches ? 'auto' : 'smooth' });
$('#ep-mx').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button');
  if (!b) return;
  const narrow = matchMedia('(max-width:999.98px)').matches;
  stage = 'parse';
  if (b.dataset.src != null) {
    expr = b.dataset.src;
    store('expr', expr);
    if (b.dataset.r) {
      ruleId = b.dataset.r;
      store('rule', ruleId);
    }
    if (b.dataset.m) {
      methodId = b.dataset.m as MethodId;
      store('method', methodId);
    }
    clearCells();
    rebuild(false, true);
    if (narrow) figTop();
  } else if (b.dataset.row != null) {
    expr = b.dataset.row;
    store('expr', expr);
    byCh.choose(table === 'ans' ? 'rule' : 'method');
    mode = 'cmp';
    modeCh.choose('cmp');
    hear = 0;
    clearCells();
    rebuild(false, true);
    figTop();
  } else if (b.dataset.col) {
    if (table === 'ans') {
      ruleId = b.dataset.col;
      store('rule', ruleId);
    } else {
      methodId = b.dataset.col as MethodId;
      store('method', methodId);
    }
    clearCells();
    rebuild(false, true);
    if (narrow) figTop();
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
$('#ep-snd').addEventListener('click', () => {
  audio.on = !audio.on;
  $('#ep-snd').setAttribute('aria-pressed', String(audio.on));
  $('#ep-sndL').classList.toggle('on', audio.on);
  $('#ep-sndT').textContent = audio.on ? 'オン' : 'オフ';
});
storeToggle($('#ep-snd'));
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
  table = tableCh.value;
  const v = pg.values();
  rate = v.sp;
  audio.vol(v.vol);
  rebuild(false);
});
