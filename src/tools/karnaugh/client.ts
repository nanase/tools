/**
 * カルノー図のページの入口。真理値表かカルノー図の出力を押して 0 → 1 → X と切り替えると、
 * 最小の解を求め直し、カルノー図の囲み・式・回路を描き直す。行か回路の入力を押すと、その入力の値を回路に出す
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { forget, store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import type { SymStyle } from '../logic-gates/svg';
import { fmtV, type Notation } from './kmap';
import { type Form, MAX_N, type Val } from './logic';
import { DEF_ID, SAMPLE, SAMPLES } from './samples';
import { capText, exprList, initState, mapHtml, outTabs, type Res, solHtml, solve, statHtml, ttHtml } from './view';

initToolPage();

/** 出力の数の上限 */
const MAX_OUT = 8;
const sel = $<HTMLSelectElement>('#km-sel'),
  ttBox = $('#km-tt'),
  mapBox = $('#km-map'),
  exBox = $('#km-ex'),
  ckt = $('#km-ckt'),
  hzBtn = $<HTMLButtonElement>('#km-hz');
const st = initState();
let R: Res = solve(st);

/* ---------- 描画 ---------- */
const fmt = (v: Val) => fmtV(v, st.nt);
/** 回路の値を塗る（作り直さない） */
function paintCkt(): void {
  const v = R.ckt.ev(st.cur),
    n = st.n;
  for (const e of $$<SVGElement>('[data-s]', ckt)) e.classList.toggle('on', !!v[e.dataset.s ?? '']);
  for (const g of $$<SVGGElement>('[data-in]', ckt)) {
    const on = !!((st.cur >> (n - 1 - Number(g.dataset.in))) & 1);
    g.classList.toggle('on', on);
    g.setAttribute('aria-checked', String(on));
    const t = g.querySelector('.km-swv');
    if (t) t.textContent = fmt(on ? 1 : 0);
  }
  for (const g of $$<SVGGElement>('[data-out]', ckt)) g.classList.toggle('on', !!v[g.dataset.out ?? '']);
}
/** 今の入力の行の強調（表） */
function markRow(): void {
  for (const tr of $$<HTMLElement>('tr[data-row]', ttBox))
    tr.classList.toggle('now', Number(tr.dataset.row) === st.cur);
}
function setCur(k: number): void {
  st.cur = k;
  markRow();
  paintCkt();
}
/** すべて描き直す */
function render(): void {
  R = solve(st);
  const tt = ttBox.scrollTop;
  ttBox.innerHTML = ttHtml(st, R);
  ttBox.scrollTop = tt;
  mapBox.innerHTML = mapHtml(st, R);
  exBox.innerHTML = exprList(st, R);
  $('#km-stat').innerHTML = statHtml(R);
  $('#km-sol').innerHTML = solHtml(st, R);
  $('#km-capt').textContent = capText(st);
  ckt.innerHTML = R.ckt.svg;
  $('#km-ttn').textContent = `${1 << st.n} 行`;
  const outs = $('#km-outs');
  outs.innerHTML = outTabs(st);
  (outs.parentElement as HTMLElement).hidden = st.outs.length < 2;
  $('#km-on').textContent = String(st.outs.length);
  $<HTMLButtonElement>('#km-om').disabled = st.outs.length <= 1;
  $<HTMLButtonElement>('#km-op').disabled = st.outs.length >= MAX_OUT;
  for (const b of $$<HTMLButtonElement>('#km-n button'))
    b.setAttribute('aria-pressed', String(Number(b.dataset.v) === st.n));
  const smp = SAMPLE[st.sid];
  sel.value = st.sid;
  $('#km-sub').textContent = smp ? smp.sub : '自分で作る真理値表';
  $('#km-rev').hidden = !(st.edited && smp);
  const sop = st.form === 'sop';
  $('#km-l1').textContent = sop ? 'まとめる値' : '';
  $('#km-l0').textContent = sop ? '' : 'まとめる値';
  $('.km-lv.v1').textContent = fmt(1);
  $('.km-lv.v0').textContent = fmt(0);
  const can = R.min.sols[st.sol].length > 1;
  hzBtn.disabled = !can;
  hzBtn.setAttribute('aria-pressed', String(st.hz));
  hzBtn.querySelector('.led')?.classList.toggle('on', st.hz);
  const hn = $('#km-hzn');
  hn.textContent = st.hz ? (R.nHz ? `破線の項 ${R.nHz} 個を追加` : '追加する項なし') : '';
  hn.classList.toggle('warn', st.hz && R.nHz > 0);
  paintCkt();
}

/* ---------- 表の編集 ---------- */
const cyc = (v: Val): Val => (v === 0 ? 1 : v === 1 ? 2 : 0);
function edit(k: number, o: number): void {
  const f = st.outs[o].f;
  f[k] = cyc(f[k]);
  st.o = o;
  st.cur = k;
  st.sol = 0;
  st.edited = true;
  render();
}
function load(id: string): void {
  const s = SAMPLE[id] ?? SAMPLE[DEF_ID];
  st.sid = s.id;
  st.n = s.n;
  st.outs = s.outs.map((o) => ({ name: o.name, f: [...o.f] }));
  st.o = 0;
  st.sol = 0;
  st.cur = 0;
  st.edited = false;
  if (s.id === DEF_ID) forget('sid');
  else store('sid', s.id);
  render();
}
/** 出力の名前: 1 つなら Y、複数なら Y1・Y2…（サンプルの名前は残す） */
function rename(): void {
  const smp = SAMPLE[st.sid];
  st.outs.forEach((o, i) => {
    const keep = smp && i < smp.outs.length && o.name === smp.outs[i].name;
    if (!keep) o.name = st.outs.length > 1 ? `Y${i + 1}` : 'Y';
  });
}
/** 入力の数を変える: 空の表にする */
function setN(n: number): void {
  if (n === st.n) return;
  st.n = n;
  st.sid = '';
  st.edited = false;
  st.outs = st.outs.map((o) => ({ name: o.name, f: Array<Val>(1 << n).fill(0) }));
  rename();
  st.cur = 0;
  st.sol = 0;
  forget('sid');
  render();
}

/* ---------- 操作 ---------- */
sel.addEventListener('change', () => load(sel.value));
const step = (d: number) => {
  const i = SAMPLES.findIndex((s) => s.id === st.sid);
  load(SAMPLES[(i + d + SAMPLES.length) % SAMPLES.length].id);
};
$('#km-prev').addEventListener('click', () => step(-1));
$('#km-next').addEventListener('click', () => step(1));
$('#km-rev').addEventListener('click', () => load(st.sid));
$('#km-n').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('button[data-v]');
  if (b) setN(Math.min(MAX_N, Math.max(2, Number(b.dataset.v))));
});
$('#km-op').addEventListener('click', () => {
  if (st.outs.length >= MAX_OUT) return;
  st.outs.push({ name: '', f: Array<Val>(1 << st.n).fill(0) });
  st.o = st.outs.length - 1;
  st.edited = true;
  rename();
  render();
});
$('#km-om').addEventListener('click', () => {
  if (st.outs.length <= 1) return;
  st.outs.pop();
  st.o = Math.min(st.o, st.outs.length - 1);
  st.edited = true;
  rename();
  render();
});
const pickOut = (o: number) => {
  if (o === st.o || !(o >= 0 && o < st.outs.length)) return;
  st.o = o;
  st.sol = 0;
  render();
};
ttBox.addEventListener('click', (e) => {
  const t = e.target as Element;
  const y = t.closest<HTMLElement>('[data-y]');
  if (y) return edit(Number(y.dataset.y), Number(y.dataset.o));
  const th = t.closest<HTMLElement>('th[data-o]');
  if (th) return pickOut(Number(th.dataset.o));
  const tr = t.closest<HTMLElement>('tr[data-row]');
  if (tr) setCur(Number(tr.dataset.row));
});
mapBox.addEventListener('click', (e) => {
  const c = (e.target as Element).closest<SVGGElement>('.km-c');
  if (c) edit(Number(c.dataset.k), st.o);
});
$('#km-outs').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('[data-o]');
  if (b) pickOut(Number(b.dataset.o));
});
exBox.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('[data-o]');
  if (b) pickOut(Number(b.dataset.o));
});
$('#km-sol').addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('[data-sol]');
  if (!b) return;
  const k = R.min.sols.length;
  st.sol = (st.sol + Number(b.dataset.sol) + k) % k;
  render();
});
hzBtn.addEventListener('click', () => {
  st.hz = !st.hz;
  render();
});
const toggleIn = (g: Element | null) => {
  const i = (g as HTMLElement | null)?.dataset.in;
  if (i != null) setCur(st.cur ^ (1 << (st.n - 1 - Number(i))));
};
ckt.addEventListener('click', (e) => toggleIn((e.target as Element).closest('[data-in]')));
ckt.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const g = (e.target as Element).closest('[data-in]');
  if (!g) return;
  e.preventDefault();
  toggleIn(g);
});
/* 囲み・式の項・ゲート・表の印のどれかに乗せると、同じ項だけを残して薄くする */
const root = $('#km');
root.addEventListener('pointerover', (e) => {
  if (e.pointerType === 'touch') return;
  const j = (e.target as Element).closest<HTMLElement>('[data-t]')?.dataset.t;
  for (const el of $$<HTMLElement>('[data-t]', root)) el.classList.toggle('km-dim', j != null && el.dataset.t !== j);
});
root.addEventListener('pointerleave', () => {
  for (const el of $$<HTMLElement>('.km-dim', root)) el.classList.remove('km-dim');
});

new Choice<Form>($('#km-form'), (v) => {
  st.form = v;
  st.sol = 0;
  render();
});
new Choice<SymStyle>($('#km-sym'), (v) => {
  st.sym = v;
  render();
});
new Choice<Notation>($('#km-nt'), (v) => {
  st.nt = v;
  render();
});

/* 保存したサンプルを開く */
const saved = stored('sid');
load(typeof saved === 'string' && SAMPLE[saved] ? saved : DEF_ID);
