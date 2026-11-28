/**
 * リレーで作る論理回路のページの入口。回路を選び、スイッチか押しボタンで入力を変える。
 * 時間は実際の速さか 1/20 で進め、リレーが動くたびに音を鳴らす。電流の通る線は橙で塗り、黄色い粒を + から − へ流す。
 * 組み合わせ回路は真理値表、順序回路は直近 10 秒のタイミングチャートを右に出す
 */
import { Choice } from '../../lib/choice';
import { $, $$ } from '../../lib/dom';
import { forget, store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { ensure, play, setSound, soundOn } from './audio';
import { DEF, DEFS, type Def } from './circuits';
import { buildCircuit, type Circuit, conduct, ideal, loadsOn, type Pt } from './net';
import { IC_MIN, type RelayEvent } from './relay';
import { Sim } from './sim';
import {
  armAngle,
  bladeAngle,
  type ChartRow,
  ccTip,
  chartSvg,
  circuitSvg,
  type FlowRun,
  flowRuns,
  legendHtml,
  linkEnds,
} from './svg';

initToolPage();

const DEF_ID = 'and';
/** タイミングチャートの窓 [ms] */
const WIN = 10000;
/** 電流の粒の間隔と速さ [図の単位/秒] */
const GAP = 18,
  PX_S = 60;
const NS = 'http://www.w3.org/2000/svg';

const sel = $<HTMLSelectElement>('#ry-sel'),
  bench = $('#ry-bench'),
  ttBox = $('#ry-tt'),
  chart = $('#ry-chart'),
  hint = $('#ry-hint > span'),
  sndBtn = $<HTMLButtonElement>('#ry-snd');

interface Els {
  svg: SVGSVGElement;
  w: (Element | null)[];
  c: [Extract<Circuit['D'][number], { k: 'c' }>, Element][];
  cc: [Extract<Circuit['D'][number], { k: 'cc' }>, Element][];
  ld: [Extract<Circuit['D'][number], { k: 'load' }>, Element][];
  mr: SVGGElement[];
  keys: SVGGElement[];
  cap: Element[];
  /** 同じリレーの接点をつなぐ点線と、両端の接点 */
  lk: [Element, Circuit['D'][number], Circuit['D'][number]][];
  /** 電流の粒: 通り道・区間の長さ・粒・進んだ距離・見せているか */
  runs: (FlowRun & { seg: number[]; len: number; dots: SVGCircleElement[]; ph: number; vis: boolean })[];
}
const st = {
  def: DEF[DEF_ID] as Def,
  sim: null as unknown as Sim,
  speed: 1,
  el: null as Els | null,
  /** 前に塗ったときの接点の状態（変わったときだけ電流を計算し直す） */
  sig: '',
  /** 電流の通る辺と向き */
  on: new Map<number, 1 | -1>(),
  /** 記録（タイミングチャート）: id → [壁の時刻 ms, 値] */
  hist: new Map<string, [number, number][]>(),
  /** 壁の時刻と回路の時刻の対応（この時刻に回路は sim0） */
  wall0: 0,
  sim0: 0,
  lastChart: 0,
};

/* ---------- 図 ---------- */
function draw(): void {
  const def = st.def;
  bench.innerHTML = circuitSvg(def, st.sim.G);
  const svg = bench.querySelector('svg') as SVGSVGElement;
  const G = st.sim.G;
  st.el = {
    svg,
    w: G.E.map((_, i) => svg.querySelector(`[data-w="${i}"]`)),
    c: G.D.flatMap((d) =>
      d.k === 'c' ? [[d, svg.querySelector(`[data-e="${d.e}"]`) as Element] as const] : [],
    ) as Els['c'],
    cc: G.D.flatMap((d) =>
      d.k === 'cc' ? [[d, svg.querySelector(`[data-cc="${d.eb}"]`) as Element] as const] : [],
    ) as Els['cc'],
    ld: G.D.flatMap((d) =>
      d.k === 'load' ? [[d, svg.querySelector(`[data-ld="${d.e}"]`) as Element] as const] : [],
    ) as Els['ld'],
    mr: $$<SVGGElement>('[data-mr]', svg),
    keys: $$<SVGGElement>('[data-key]', svg),
    cap: $$('[data-capr]', svg),
    lk: G.L.map(([i, j], k) => [svg.querySelector(`[data-lk="${k}"]`) as Element, G.D[i], G.D[j]]),
    runs: [],
  };
  const pts = svg.querySelector('.pts') as SVGGElement;
  for (const r of flowRuns(G)) {
    const seg = r.pts.slice(1).map((p, i) => Math.hypot(p[0] - r.pts[i][0], p[1] - r.pts[i][1])),
      len = seg.reduce((a, b) => a + b, 0),
      dots: SVGCircleElement[] = [];
    for (let k = Math.max(1, Math.round(len / GAP)); k > 0; k--) {
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('r', '2.6');
      c.setAttribute('class', 'pt');
      c.setAttribute('visibility', 'hidden');
      pts.appendChild(c);
      dots.push(c);
    }
    st.el.runs.push({ ...r, seg, len, dots, ph: 0, vis: false });
  }
  /* 図は縮めず、枠より広ければ横にスクロールする（文字を 13〜15 px に保つ） */
  svg.style.minWidth = `${G.W}px`;
  $('#ry-lg').innerHTML = legendHtml(def, G);
  st.sig = '';
  bench.scrollLeft = 0;
  paint();
}
const rd = (v: number) => Math.round(v * 100) / 100;
/** 折れ線の上の距離 s の点 */
function along(r: Els['runs'][number], s: number): Pt {
  let i = 0;
  while (i < r.seg.length - 1 && s > r.seg[i]) s -= r.seg[i++];
  const [x0, y0] = r.pts[i],
    [x1, y1] = r.pts[i + 1],
    f = r.seg[i] ? s / r.seg[i] : 0;
  return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
}
/** 今の状態を図に塗る。dt は粒を進める実際の時間 [秒] */
function paint(dt = 0): void {
  const el = st.el,
    sim = st.sim;
  if (!el) return;
  const cs = sim.cs,
    R = sim.R;
  const sig = [...Object.values(R).map((r) => `${+r.a}${+r.b}`), ...Object.values(sim.inp)].join('');
  if (sig !== st.sig) {
    st.sig = sig;
    const on = conduct(sim.G, cs);
    st.on = on;
    for (const [i, w] of el.w.entries()) w?.classList.toggle('on', on.has(i));
    for (const [d, g] of el.c) g.classList.toggle('on', on.has(d.e));
    for (const [d, g] of el.cc) g.classList.toggle('on', on.has(d.ea) || on.has(d.eb));
    for (const [d, g] of el.ld) {
      const o = on.has(d.e);
      g.classList.toggle('on', o);
      g.querySelector('.lamp')?.classList.toggle('on', o);
    }
    for (const k of el.keys) {
      const id = k.dataset.key as string,
        v = !!sim.inp[id];
      k.classList.toggle('on', v);
      k.classList.toggle('down', v);
      k.setAttribute(k.getAttribute('role') === 'switch' ? 'aria-checked' : 'aria-pressed', String(v));
      const t = k.querySelector('[data-kv]');
      if (t) t.textContent = v ? '1' : '0';
      el.svg.querySelector(`[data-kw="${id}"]`)?.classList.toggle('on', v);
    }
    if (st.def.g !== 'seq') {
      const cur = st.def.ins.map((q) => (sim.inp[q.id] ? 1 : 0)).join('');
      for (const tr of $$<HTMLElement>('tr[data-row]', ttBox)) tr.classList.toggle('now', tr.dataset.row === cur);
    }
  }
  /* 札はコンデンサの充電・放電で変わるので毎回 */
  const h = st.def.hint?.(sim.inp, R) ?? '';
  if (hint.textContent !== h) hint.textContent = h;
  /* 接極子と刃は動いている間も描く */
  for (const [d, g] of el.c) {
    const r = cs(d.r);
    g.querySelector('.blade')?.setAttribute(
      'transform',
      `rotate(${bladeAngle(d.t, d.t === 'a' ? r.a : r.b, r.x)} ${d.x + 8} ${d.y})`,
    );
  }
  for (const [d, g] of el.cc) {
    const r = cs(d.r),
      [x2, y2] = ccTip(d, r.a, r.b, r.x),
      bl = g.querySelector('.blade');
    bl?.setAttribute('x2', String(x2));
    bl?.setAttribute('y2', String(y2));
  }
  for (const m of el.mr) {
    const r = R[m.dataset.mr as string];
    if (!r) continue;
    m.querySelector('.marm')?.setAttribute('transform', armAngle(rd(r.x)));
    m.classList.toggle('on', r.coil || r.held);
  }
  /* コンデンサの枝は電流の流れる間だけ。放電の間はコイルにも電流 */
  for (const c of el.cap) {
    const ic = R[(c as HTMLElement).dataset.capr as string]?.ic ?? 0,
      g = c.parentElement as HTMLElement | null;
    c.classList.toggle('on', Math.abs(ic) > IC_MIN);
    g?.classList.toggle('on', st.on.has(Number(g.dataset.ld)) || ic < -IC_MIN);
  }
  for (const [l, a, b] of el.lk) {
    const [[x1, y1], [x2, y2]] = linkEnds(a, b, cs);
    l.setAttribute('x1', String(x1));
    l.setAttribute('y1', String(y1));
    l.setAttribute('x2', String(x2));
    l.setAttribute('y2', String(y2));
  }
  /*
   * 電流の粒。電池からの電流はどの区間も同じ速さで、u から v へ（向きが −1 なら逆へ）流す。
   * コンデンサの電流は大きさに比例した速さで、充電は枝の向き、放電は逆向き（コイルは同じ向き）
   */
  for (const r of el.runs) {
    let dir = st.on.get(r.e) ?? 0,
      f = 1;
    const ic = R[r.cap ?? r.coil ?? '']?.ic ?? 0;
    if (r.cap) {
      dir = Math.abs(ic) > IC_MIN ? Math.sign(ic) : 0;
      f = Math.abs(ic);
    } else if (!dir && r.coil && ic < -IC_MIN) {
      dir = 1;
      f = -ic;
    }
    if (!dir) {
      if (r.vis) for (const c of r.dots) c.setAttribute('visibility', 'hidden');
      r.vis = false;
      continue;
    }
    r.ph = (r.ph + dir * f * dt * PX_S) % r.len;
    const gap = r.len / r.dots.length;
    r.dots.forEach((c, k) => {
      const [x, y] = along(r, (((r.ph + k * gap) % r.len) + r.len) % r.len);
      c.setAttribute('cx', x.toFixed(1));
      c.setAttribute('cy', y.toFixed(1));
      if (!r.vis) c.setAttribute('visibility', 'visible');
    });
    r.vis = true;
  }
}

/* ---------- 真理値表とタイミングチャート ---------- */
function drawTable(): void {
  const def = st.def,
    G = st.sim.G;
  const seq = def.g === 'seq';
  $('#hd-tt').textContent = seq ? 'タイミングチャート' : '真理値表';
  ttBox.hidden = seq;
  chart.hidden = !seq;
  if (seq) {
    $('#ry-ttn').textContent = '直近 10 秒';
    drawChart(performance.now());
    return;
  }
  const lds = G.E.flatMap((e, i) => (e.k === 'load' && e.ld.kind === 'lamp' ? [[e.ld.lb, i] as const] : []));
  const n = def.ins.length;
  let s = `<table class="ry-tt"><thead><tr>${def.ins.map((q) => `<th scope="col" class="ti">${q.lb}</th>`).join('')}${lds.map(([lb]) => `<th scope="col" class="to">${lb}</th>`).join('')}</tr></thead><tbody>`;
  for (let k = 0; k < 1 << n; k++) {
    const v: Record<string, number> = {};
    def.ins.forEach((q, j) => {
      v[q.id] = (k >> (n - 1 - j)) & 1;
    });
    const on = loadsOn(G, ideal(v));
    const key = def.ins.map((q) => v[q.id]).join('');
    s += `<tr data-row="${key}">${def.ins.map((q) => `<td class="ti">${v[q.id]}</td>`).join('')}${lds.map(([, i]) => `<td class="to${on.has(i) ? ' one' : ''}">${+on.has(i)}</td>`).join('')}</tr>`;
  }
  $('#ry-ttn').textContent = `${1 << n} 行`;
  ttBox.innerHTML = `${s}</tbody></table>`;
  st.sig = '';
}
function chartRows(): ChartRow[] {
  const def = st.def,
    rows: ChartRow[] = [];
  const ev = (id: string) => st.hist.get(id) ?? [];
  for (const q of def.ins) rows.push({ lb: q.lb, k: 'in', ev: ev(`i:${q.id}`) });
  for (const id of Object.keys(st.sim.R)) rows.push({ lb: id, k: 'rel', ev: ev(`r:${id}`) });
  for (const e of st.sim.G.E)
    if (e.k === 'load' && e.ld.kind === 'lamp') rows.push({ lb: e.ld.lb, k: 'out', ev: ev(`l:${e.ld.lb}`) });
  return rows;
}
function drawChart(now: number): void {
  st.lastChart = now;
  chart.innerHTML = chartSvg(chartRows(), now, WIN, chart.clientWidth);
}

/* ---------- 時間 ---------- */
const wallOf = (t: number) => st.wall0 + (t - st.sim0) / st.speed;
function record(id: string, t: number, v: number): void {
  let l = st.hist.get(id);
  if (!l) {
    l = [];
    st.hist.set(id, l);
  }
  l.push([wallOf(t), v]);
  /* 窓より古い記録を捨てる（最後の 1 つは窓の左端の値に使う） */
  const lim = performance.now() - WIN - 1000;
  let k = 0;
  while (k < l.length - 1 && l[k + 1][0] < lim) k++;
  if (k) l.splice(0, k);
}
let last = 0;
function loop(ts: number): void {
  const dt = Math.min(50, ts - (last || ts));
  last = ts;
  const sim = st.sim;
  st.wall0 = ts - dt;
  st.sim0 = sim.t;
  const t0 = sim.t;
  const ev: RelayEvent[] = sim.advance(dt * st.speed);
  if (ev.length) play(ev.map((e) => ({ e, dt: (e.t - t0) / st.speed / 1000 })));
  paint(dt / 1000);
  if (st.def.g === 'seq' && ts - st.lastChart > 50) drawChart(ts);
  requestAnimationFrame(loop);
}

/* ---------- 回路 ---------- */
function load(id: string): void {
  const def = DEF[id] ?? DEF[DEF_ID];
  st.def = def;
  st.hist = new Map();
  st.sim = new Sim(def, buildCircuit(def.rungs, def.ins.length));
  st.sim.settle();
  const now = performance.now();
  st.wall0 = now;
  st.sim0 = st.sim.t;
  /* 落ち着いた状態を記録の始まりにする */
  for (const q of def.ins) st.hist.set(`i:${q.id}`, [[now - WIN, st.sim.inp[q.id]]]);
  for (const [k, r] of Object.entries(st.sim.R)) st.hist.set(`r:${k}`, [[now - WIN, +r.a]]);
  for (const e of st.sim.G.E)
    if (e.k === 'load' && e.ld.kind === 'lamp')
      st.hist.set(`l:${e.ld.lb}`, [[now - WIN, +loadsOn(st.sim.G, st.sim.cs).has(st.sim.G.E.indexOf(e))]]);
  st.sim.log = record;
  st.speed = def.speed ?? 1;
  speed.set(String(st.speed));
  sel.value = def.id;
  $('#ry-sub').textContent = def.sub;
  if (def.id === DEF_ID) forget('sid');
  else store('sid', def.id);
  draw();
  drawTable();
}

/* ---------- 操作 ---------- */
const speed = new Choice<string>($('#ry-speed'), (v) => {
  st.speed = Number(v);
});
sel.addEventListener('change', () => load(sel.value));
const step = (d: number) => {
  const i = DEFS.findIndex((c) => c.id === st.def.id);
  load(DEFS[(i + d + DEFS.length) % DEFS.length].id);
};
$('#ry-prev').addEventListener('click', () => step(-1));
$('#ry-next').addEventListener('click', () => step(1));

const input = (k: Element | null) => {
  const id = (k as HTMLElement | null)?.dataset.key;
  return id ? st.def.ins.find((q) => q.id === id) : undefined;
};
bench.addEventListener('click', (e) => {
  const q = input((e.target as Element).closest('[data-key]'));
  if (q && q.kind !== 'push') st.sim.set(q.id, st.sim.inp[q.id] ? 0 : 1);
});
/* 押しボタンは押している間だけ閉じる */
let held: string | null = null;
const release = () => {
  if (held) st.sim.set(held, 0);
  held = null;
};
bench.addEventListener('pointerdown', (e) => {
  ensure();
  const q = input((e.target as Element).closest('[data-key]'));
  if (q?.kind !== 'push') return;
  e.preventDefault();
  held = q.id;
  st.sim.set(q.id, 1);
});
addEventListener('pointerup', release);
addEventListener('pointercancel', release);
bench.addEventListener('keydown', (e) => {
  if (e.key !== ' ' && e.key !== 'Enter') return;
  const q = input((e.target as Element).closest('[data-key]'));
  if (!q) return;
  e.preventDefault();
  ensure();
  if (q.kind === 'push') st.sim.set(q.id, 1);
  else if (!e.repeat) st.sim.set(q.id, st.sim.inp[q.id] ? 0 : 1);
});
bench.addEventListener('keyup', (e) => {
  const q = input((e.target as Element).closest('[data-key]'));
  if (q?.kind === 'push' && (e.key === ' ' || e.key === 'Enter')) st.sim.set(q.id, 0);
});
ttBox.addEventListener('pointerdown', () => ensure());
ttBox.addEventListener('click', (e) => {
  const tr = (e.target as Element).closest<HTMLElement>('tr[data-row]');
  if (!tr) return;
  const r = tr.dataset.row as string;
  st.def.ins.forEach((q, j) => {
    st.sim.set(q.id, Number(r[j]));
  });
});

sndBtn.addEventListener('click', () => {
  const v = !soundOn();
  setSound(v);
  sndBtn.setAttribute('aria-pressed', String(v));
});

new ResizeObserver(() => {
  if (st.def.g === 'seq') drawChart(performance.now());
}).observe(chart);

const saved = stored('sid');
load(typeof saved === 'string' && DEF[saved] ? saved : DEF_ID);
requestAnimationFrame(loop);
