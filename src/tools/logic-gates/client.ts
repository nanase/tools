/**
 * 論理ゲートのページの入口。回路を選び、入力のスイッチか真理値表の行で入力を変える。
 * 入力を変えるたびに、落ち着くまでをゲート 1 段ずつ進めて記録し、タイミングチャートに描く。
 * チャートを押すと、その時刻の状態を回路図と真理値表に出す（再現）
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { forget, store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { type Bit, type GateType, GNAME, hazards, makeSim, SAMPLE, SAMPLES, type Sample, truthTable } from './circuits';
import {
  type ChartGeo,
  chartRows,
  chartSvg,
  circuitSvg,
  fmtBit,
  htmlLabel,
  type Notation,
  paint,
  type SymStyle,
  type View,
  type Wave,
} from './svg';

initToolPage();

const DEF_ID = 'xor';
/** チャートに出すコマ数 */
const N = 28;

const sel = $<HTMLSelectElement>('#lg-sel'),
  bench = $('#lg-bench'),
  chart = $('#lg-chart'),
  ttBox = $('#lg-tt'),
  midBtn = $<HTMLButtonElement>('#lg-mid');

type Snap = Record<string, Bit>;
/** 記録の 1 コマ。n は通し番号 */
interface Rec {
  n: number;
  o: Snap;
}
const st = {
  c: SAMPLE[DEF_ID] as Sample,
  sim: makeSim(SAMPLE[DEF_ID]),
  sym: 'mil' as SymStyle,
  nt: '01' as Notation,
  wave: 'sq' as Wave,
  mid: stored('mid') === true,
  /** CLK の立ち上がりの直後（D フリップフロップの表の行） */
  edge: false,
  /** 回路の下の知らせ（発振・不定） */
  note: '',
  osc: 0 as ReturnType<typeof setInterval> | 0,
  oscN: 0,
  /** 記録（古い順） */
  hist: [] as Rec[],
  total: 0,
  /** 直前の変化: 落ち着くまでの段数（−1 は落ち着かない）とハザードの出た出力 */
  steps: null as number | null,
  hz: [] as string[],
  /** 再現している記録の通し番号 */
  pick: null as number | null,
  hov: null as number | null,
  geo: null as ChartGeo | null,
};

/* ---------- 記録 ---------- */
function snap(): Snap {
  const o: Snap = {};
  for (const n of st.c.nodes) if (n.t !== 'j') o[n.id] = st.sim.val(n.id);
  return o;
}
function push(o: Snap): void {
  st.hist.push({ n: ++st.total, o });
  if (st.hist.length > 4 * N) st.hist.shift();
}
function resetHist(): void {
  st.hist = [];
  st.steps = null;
  st.hz = [];
  st.pick = null;
  st.hov = null;
  const o = snap();
  for (let i = 0; i < N; i++) push(o);
}
/** 入力を変えた直後から落ち着くまでを 1 段ずつ記録し、出力のハザードを数える */
function run(): number {
  const last = st.hist[st.hist.length - 1]?.o ?? snap();
  push(last);
  push(last);
  const seg: Snap[] = [snap()];
  push(seg[0]);
  let k = -1;
  for (let i = 0; i < 120; i++) {
    const n = st.sim.tick();
    const o = snap();
    seg.push(o);
    push(o);
    if (!n) {
      k = i;
      break;
    }
  }
  st.steps = k;
  st.hz =
    k < 0
      ? []
      : [
          ...new Set(
            hazards(
              seg,
              st.sim.p.outputs.map((n) => n.id),
            ).map(([id]) => id),
          ),
        ];
  return k;
}
function stopOsc(): void {
  if (st.osc) clearInterval(st.osc);
  st.osc = 0;
  st.oscN = 0;
}
/** 入力が変わったあと。落ち着かなければ少しずつ進めて見せる */
function settle(): void {
  stopOsc();
  st.note = '';
  if (run() >= 0) return;
  const c = st.c;
  st.note = c.osc ? '発振中' : 'どちらに落ち着くかは不定';
  st.osc = setInterval(() => {
    st.sim.tick();
    push(snap());
    /* 実際の回路では、わずかな差でどちらかに落ち着く */
    if (!c.osc && ++st.oscN > 7) {
      const g = st.sim.p.gates.find((x) => x.id.endsWith('g1'));
      if (g) st.sim.v[g.id] = Math.random() < 0.5 ? 0 : 1;
      if (st.sim.settle() >= 0) {
        push(snap());
        stopOsc();
      }
    }
    refresh();
  }, 260);
}

/* ---------- 入力 ---------- */
function setInput(id: string, v: Bit): void {
  const s = st.sim;
  if (!(id in s.inp)) return;
  const was = s.inp[id];
  s.inp[id] = v;
  st.pick = null;
  const e = st.c.edge;
  if (e) {
    if (id === e) st.edge = !was && v === 1;
    else if (was !== v) st.edge = false;
  }
  settle();
  refresh();
}
function setRow(k: number): void {
  const c = st.c;
  st.pick = null;
  if (c.seq) {
    const r = c.seq.rows[k],
      cols = c.seq.cols;
    /* クロックの立ち上がりは、ほかの入力を決めてから */
    const order = r.c.map((_, i) => i).sort((a, b) => Number(r.c[a] === '↑') - Number(r.c[b] === '↑'));
    for (const i of order) {
      const id = cols[i],
        v = r.c[i];
      if (!(id in st.sim.inp)) continue;
      if (v === '↑') {
        st.sim.inp[id] = 0;
        st.sim.settle();
        setInput(id, 1);
      } else if (v === 0 || v === 1) setInput(id, v);
      else if (v === '0・1') setInput(id, 0);
    }
    return;
  }
  const t = truthTable(c),
    row = t.rows[k];
  for (const id of t.ins) st.sim.inp[id] = row[id];
  st.edge = false;
  settle();
  refresh();
}

/* ---------- 表示 ---------- */
const fmt = (v: Bit): string => fmtBit(v, st.nt);
/** 表の中の文字（数の 0・1 だけを置き換える） */
const fmtCell = (v: number | string): string =>
  v === 0 || v === 1
    ? fmt(v)
    : st.nt === 'LH'
      ? String(v)
          .replace(/(^|[^\d])0(?!\d)/g, '$1L')
          .replace(/(^|[^\d])1(?!\d)/g, '$1H')
      : String(v);

/** 今出している状態（再現中なら記録の 1 コマ） */
function shown(): View & { now: boolean } {
  const o = st.pick == null ? null : st.hist.find((h) => h.n === st.pick)?.o;
  if (!o) return { inp: st.sim.inp, val: st.sim.val, now: true };
  const p = st.sim.p;
  const val = (id: string): Bit => {
    const n = p.N.get(id);
    return n?.t === 'j' ? val(n.ins[0].s) : (o[id] ?? 0);
  };
  const inp: Record<string, Bit> = {};
  for (const n of p.inputs) inp[n.id] = o[n.id];
  return { inp, val, now: false };
}
function rowNow(m: View): number {
  const c = st.c;
  if (c.seq) return c.seq.rows.findIndex((r) => r.m(m.inp, m.inp === st.sim.inp ? st.edge : false));
  const t = truthTable(c);
  return t.rows.findIndex((r) => t.ins.every((id) => r[id] === m.inp[id]));
}

function drawCircuit(): void {
  bench.innerHTML = circuitSvg(st.c, st.sym);
}
function drawTable(): void {
  const c = st.c;
  const head = $('#hd-tt');
  head.textContent = c.seq ? '動作の表' : '真理値表';
  let s: string;
  if (c.seq) {
    const q = c.seq,
      nIn = st.sim.p.inputs.length;
    $('#lg-ttn').textContent = '前の状態も使う';
    s = `<table class="lg-tt seq"><thead><tr>${q.cols.map((k, i) => `<th scope="col" class="${i < nIn ? 'ti' : 'to'}">${htmlLabel(k)}</th>`).join('')}<th class="tn"><span class="sr">動作</span></th></tr></thead><tbody>`;
    q.rows.forEach((r, k) => {
      s += `<tr data-row="${k}"${r.warn ? ' class="wr"' : ''}>`;
      r.c.forEach((v, i) => {
        const span = i === r.c.length - 1 && r.c.length < q.cols.length ? ` colspan="${q.cols.length - i}"` : '';
        s += `<td class="${i < nIn ? 'ti' : 'to'}${v === 1 ? ' one' : ''}"${span}>${fmtCell(v)}</td>`;
      });
      s += `<td class="tn">${r.nt}</td></tr>`;
    });
  } else {
    const t = truthTable(c);
    $('#lg-ttn').textContent = `${t.rows.length} 行`;
    s = `<table class="lg-tt"><thead><tr>${t.ins.map((k) => `<th scope="col" class="ti">${htmlLabel(k)}</th>`).join('')}${t.outs.map((k) => `<th scope="col" class="to">${htmlLabel(k)}</th>`).join('')}${c.extra ? '<th class="tn"><span class="sr">補足</span></th>' : ''}</tr></thead><tbody>`;
    t.rows.forEach((r, k) => {
      s += `<tr data-row="${k}">${t.ins.map((id) => `<td class="ti">${fmt(r[id])}</td>`).join('')}${t.outs.map((id) => `<td class="to${r[id] ? ' one' : ''}">${fmt(r[id])}</td>`).join('')}${c.extra ? `<td class="tn">${c.extra(r)}</td>` : ''}</tr>`;
    });
  }
  ttBox.innerHTML = `${s}</tbody></table>`;
}
function drawStatic(): void {
  const c = st.c,
    p = st.sim.p;
  sel.value = c.id;
  $('#lg-sub').textContent = c.sub;
  $('#lg-ex').innerHTML = c.expr.map((e) => `<span>${e}</span>`).join('');
  $('#lg-stat').textContent = `ゲート ${p.gateCount} 個・${p.depth == null ? '輪になった回路' : `最長 ${p.depth} 段`}`;
  $('#lg-uses').innerHTML = c.uses.map((u) => `<li>${u}</li>`).join('');
  hideTip();
  drawCircuit();
  drawTable();
}
function drawChart(): void {
  const hs = st.hist.slice(-N);
  if (st.pick != null && !hs.some((h) => h.n === st.pick)) st.pick = null;
  const ix = (n: number | null) => (n == null ? null : hs.findIndex((h) => h.n === n));
  const r = chartSvg(
    chartRows(st.c, st.mid),
    hs.map((h) => h.o),
    {
      w: chart.clientWidth,
      nt: st.nt,
      wave: st.wave,
      sel: ix(st.pick),
      hov: ix(st.hov),
    },
  );
  chart.innerHTML = r.svg;
  st.geo = r.geo;
  const last = hs[hs.length - 1].n;
  const ago = st.pick == null ? 0 : last - st.pick;
  chart.setAttribute('aria-valuenow', String(-ago));
  chart.setAttribute('aria-valuetext', st.pick == null ? '今' : `${ago} 段前`);
  let h: string;
  if (st.pick != null)
    h = `<span class="lg-rpi">${ago} 段前の状態を表示中</span><button type="button" class="tg" id="lg-live">今に戻る</button>`;
  else if (st.c.osc && st.sim.inp.EN) h = '<span>発振中</span>';
  else if (st.steps == null) h = '<span>入力を変えた後の動きを 1 段ずつ記録</span>';
  else
    h = `<span>${st.steps < 0 ? '落ち着かない' : st.steps ? `${st.steps} 段で安定` : '出力の変化なし'}</span>${st.hz.length ? `<span class="lg-hz">ハザード: ${st.hz.map(htmlLabel).join('・')}</span>` : '<span>ハザードなし</span>'}`;
  $('#lg-tinfo').innerHTML = h;
  const rp = $('#lg-rp');
  rp.textContent = st.pick == null ? '' : `${ago} 段前の状態`;
  rp.classList.toggle('on', st.pick != null);
}
/** 値の塗り直し（作り直さない） */
function refresh(): void {
  const c = st.c,
    m = shown();
  const svg = bench.querySelector<SVGSVGElement>('svg');
  if (svg) paint(svg, m, st.nt, m.now ? st.hz : []);
  bench.classList.toggle('replay', !m.now);
  if (tipG) showTip(tipG);
  const k = rowNow(m);
  const t = c.seq ? null : truthTable(c);
  for (const tr of $$('tr[data-row]', ttBox)) {
    const on = Number(tr.dataset.row) === k;
    tr.classList.toggle('now', on);
    /* 再現した時刻の出力が表と違えば、その欄に印（ハザードの最中） */
    if (t)
      for (const [i, td] of $$('td.to', tr).entries())
        td.classList.toggle('mis', !m.now && on && t.rows[k][t.outs[i]] !== m.val(t.outs[i]));
  }
  const vv: Record<string, Bit> = { ...m.inp };
  for (const n of st.sim.p.outputs) vv[n.id] = m.val(n.id);
  $('#lg-xtr').textContent = c.extra ? c.extra(vv) : '';
  const note = $('#lg-note');
  note.textContent = fmtCell(st.note || c.hint || '');
  note.classList.toggle('warn', !!st.note && !c.osc);
  drawChart();
}

function load(id: string): void {
  const c = SAMPLE[id] ?? SAMPLE[DEF_ID];
  stopOsc();
  st.c = c;
  st.sim = makeSim(c);
  st.edge = false;
  st.note = '';
  if (c.defIn) Object.assign(st.sim.inp, c.defIn);
  if (c.id === 'haz') Object.assign(st.sim.inp, { B: 1, C: 1 });
  if (c.id === 'mux') Object.assign(st.sim.inp, { A: 1, B: 1 });
  st.sim.settle();
  resetHist();
  if (c.id === DEF_ID) forget('sid');
  else store('sid', c.id);
  drawStatic();
  refresh();
}

/* ---------- 操作 ---------- */
sel.addEventListener('change', () => load(sel.value));
const step = (d: number) => {
  const i = SAMPLES.findIndex((c) => c.id === st.c.id);
  load(SAMPLES[(i + d + SAMPLES.length) % SAMPLES.length].id);
};
$('#lg-prev').addEventListener('click', () => step(-1));
$('#lg-next').addEventListener('click', () => step(1));

const toggleIn = (g: Element | null) => {
  const id = (g as HTMLElement | null)?.dataset.in;
  if (id) setInput(id, st.sim.inp[id] ? 0 : 1);
};
/* ゲートのツールチップ: 名前・働き・今の入力と出力 */
const GROLE: Record<GateType, readonly [string, string]> = {
  not: ['否定', '入力の反転'],
  and: ['論理積', 'すべて 1 のときだけ 1'],
  or: ['論理和', 'どれか 1 つでも 1 なら 1'],
  nand: ['否定論理積', 'AND の反転'],
  nor: ['否定論理和', 'OR の反転'],
  xor: ['排他的論理和', '入力が違うときだけ 1'],
  xnor: ['否定排他的論理和', '入力が同じときだけ 1'],
};
const tip = $('#lg-tip');
let tipG: string | null = null;
function showTip(id: string): void {
  const g = st.sim.p.gates.find((x) => x.id === id),
    el = bench.querySelector<SVGGElement>(`[data-g="${id}"]`);
  if (!g || !el) {
    hideTip();
    return;
  }
  tipG = id;
  const m = shown();
  const ins = g.ins.map((e) => fmt(m.val(e.s))).join('・');
  const [jp, role] = GROLE[g.t];
  tip.innerHTML = `<b>${GNAME[g.t]}</b><span class="lg-tip-j">${jp}</span><span class="lg-tip-r">${fmtCell(role)}</span><span class="lg-tip-v">入力 ${ins} → 出力 ${fmt(m.val(id))}</span>`;
  tip.hidden = false;
  for (const x of bench.querySelectorAll('.gate.hov')) x.classList.remove('hov');
  el.classList.add('hov');
  const box = (tip.offsetParent ?? bench).getBoundingClientRect(),
    r = el.getBoundingClientRect();
  const w = tip.offsetWidth,
    h = tip.offsetHeight;
  const x = Math.max(4, Math.min(r.left + r.width / 2 - box.left - w / 2, box.width - w - 4));
  const above = r.top - box.top - h - 8;
  tip.style.left = `${x}px`;
  tip.style.top = `${above >= 0 ? above : r.bottom - box.top + 8}px`;
}
function hideTip(): void {
  tipG = null;
  tip.hidden = true;
  for (const x of bench.querySelectorAll('.gate.hov')) x.classList.remove('hov');
}
bench.addEventListener('pointerover', (e) => {
  if (e.pointerType === 'touch') return;
  const g = (e.target as Element).closest<SVGGElement>('[data-g]');
  if (g?.dataset.g) showTip(g.dataset.g);
  else if (tipG) hideTip();
});
bench.addEventListener('pointerleave', (e) => {
  if (e.pointerType !== 'touch') hideTip();
});
/* タッチでは押したゲートの説明を出し、ほかを押すと消す */
document.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  const g = (e.target as Element).closest<SVGGElement>('#lg-bench [data-g]');
  if (g?.dataset.g) showTip(g.dataset.g);
  else if (tipG) hideTip();
});

bench.addEventListener('click', (e) => toggleIn((e.target as Element).closest('[data-in]')));
bench.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const g = (e.target as Element).closest('[data-in]');
  if (!g) return;
  e.preventDefault();
  toggleIn(g);
});
ttBox.addEventListener('click', (e) => {
  const tr = (e.target as Element).closest<HTMLElement>('tr[data-row]');
  if (tr) setRow(Number(tr.dataset.row));
});

new Choice<SymStyle>($('#lg-sym'), (v) => {
  st.sym = v;
  drawCircuit();
  refresh();
});
new Choice<Notation>($('#lg-nt'), (v) => {
  st.nt = v;
  drawTable();
  refresh();
});
new Choice<Wave>($('#p-wave'), (v) => {
  st.wave = v;
  drawChart();
});
const setMid = (on: boolean) => {
  st.mid = on;
  midBtn.setAttribute('aria-pressed', String(on));
  midBtn.querySelector('.led')?.classList.toggle('on', on);
};
setMid(st.mid);
midBtn.addEventListener('click', () => {
  setMid(!st.mid);
  if (st.mid) store('mid', true);
  else forget('mid');
  drawChart();
});

/* タイミングチャート: 押した時刻の状態を出す。押したままなぞると追う */
function colAt(e: PointerEvent): number | null {
  const g = st.geo;
  if (!g) return null;
  const x = e.clientX - chart.getBoundingClientRect().left;
  const i = Math.floor((x - g.lw) / g.dx);
  const hs = st.hist.slice(-N);
  return i < 0 || i >= hs.length ? null : hs[i].n;
}
function pickAt(n: number | null): void {
  const last = st.hist[st.hist.length - 1].n;
  st.pick = n == null || n === last ? null : n;
  refresh();
}
let drag = false;
chart.addEventListener('pointerdown', (e) => {
  const n = colAt(e);
  if (n == null) return;
  drag = true;
  chart.setPointerCapture(e.pointerId);
  pickAt(n);
});
chart.addEventListener('pointermove', (e) => {
  const n = colAt(e);
  if (drag) {
    if (n != null && n !== st.pick) pickAt(n);
    return;
  }
  if (n !== st.hov && e.pointerType === 'mouse') {
    st.hov = n;
    drawChart();
  }
});
const endDrag = () => {
  drag = false;
};
chart.addEventListener('pointerup', endDrag);
chart.addEventListener('pointercancel', endDrag);
chart.addEventListener('pointerleave', () => {
  if (st.hov == null) return;
  st.hov = null;
  drawChart();
});
chart.addEventListener('keydown', (e) => {
  const hs = st.hist.slice(-N),
    first = hs[0].n,
    last = hs[hs.length - 1].n,
    cur = st.pick ?? last;
  if (e.key === 'ArrowLeft') pickAt(Math.max(first, cur - 1));
  else if (e.key === 'ArrowRight') pickAt(Math.min(last, cur + 1));
  else if (e.key === 'Home') pickAt(first);
  else if (e.key === 'End' || e.key === 'Escape') pickAt(null);
  else return;
  e.preventDefault();
});
$('#lg-tinfo').addEventListener('click', (e) => {
  if ((e.target as Element).closest('#lg-live')) pickAt(null);
});
new ResizeObserver(() => drawChart()).observe(chart);

/* 保存した回路を開く */
const saved = stored('sid');
load(typeof saved === 'string' && SAMPLE[saved] ? saved : DEF_ID);
