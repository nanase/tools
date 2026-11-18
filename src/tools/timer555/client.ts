/** 555 ページの入口: 回路の選択 → 入力 → 時間を進める計算 → 波形・回路図の動き・計算結果・代入式 */
import { $, $$ } from '../../lib/dom';
import { fmt, fmtR, mqty, ro } from '../../lib/format';
import { RM } from '../../lib/motion';
import { ParamGroup } from '../../lib/param';
import { mapper, nice, ScopeView, SW } from '../../lib/scope';
import { store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { CIR, CIRCUITS, type CirId, type Live, ldr, rstV, type Timing, type Vals, VF, VRST } from './circuits';
import { FlowView } from './flow';
import { solve, steady } from './model';
import { type Key, PARAMS } from './params';
import { drawCircuit, SHAPE_KEYS } from './schematic';
import { Sim } from './sim';

initToolPage();
const html = (id: string, s: string) => {
  const n = $(id);
  if (n.innerHTML !== s) n.innerHTML = s;
};
const MDOT = '<mo>&#x22C5;</mo>';
const ONLY = 'この回路では使いません';
const CORE: Key[] = ['r1', 'r2', 'c1'];
const EXTRA: Key[] = ['pos', 'cv', 'lux', 'vin'];
const R2_STD = { nm: 'R2', sym: '<i>R</i><sub>2</sub>', name: 'タイミング抵抗 2', sub: 'DIS–THR 間' };
const R2_VR = { nm: 'VR', sym: 'VR', name: '可変抵抗', sub: 'つまみの両端の間' };

/* ---------- 状態 ---------- */
const isCir = (x: unknown): x is CirId => typeof x === 'string' && x in CIR;
const s0 = stored('cir');
let cid: CirId = isCir(s0) ? s0 : 'astable';
let v = {} as Vals;
const live: Live = { power: true, trig: false, rst: false };
let sim = new Sim();
let playing = true;
type Speed = 'slow' | 'normal' | 'real';
const sp0 = stored('speed');
let speed: Speed = sp0 === 'slow' || sp0 === 'normal' || sp0 === 'real' ? sp0 : RM.matches ? 'real' : 'slow';
/** ほかの回路に移る前の値（このページを開いている間だけ） */
const mem: Partial<Record<CirId, Partial<Vals>>> = {};

const scope = new ScopeView($('#wave'));
/** VCC を縦の何 div に収めるか（縦 3 div の窓。0 V は下端） */
const VDIV = 2.7;
const flow = new FlowView($<SVGSVGElement>('#t5-sch'));
const sch = $<SVGSVGElement>('#t5-sch');
const sel = $<HTMLSelectElement>('#t5-cir');

/* ---------- 回路の図 ---------- */
let branchK: string[] = [];
function redraw(): void {
  const d = drawCircuit(cid, v);
  flow.set(d);
  branchK = d.branches.map((b) => b.k);
  pot = d.pot ?? null;
  labels();
}
let pot: ReturnType<typeof drawCircuit>['pot'] | null = null;
function labels(): void {
  const t = (id: string, s: string) => {
    const e = sch.querySelector(`#${id}`);
    if (e && e.textContent !== s) e.textContent = s;
  };
  t('s-vcc', fmt(v.vcc, 'V', 3));
  t('s-r1', fmt(v.r1, 'Ω', 3));
  t('s-r2', fmt(v.r2, 'Ω', 3));
  t('s-c1', fmt(v.c1, 'F', 3));
  t('s-cv', fmt(Math.min(v.cv, v.vcc), 'V', 3));
  t('s-vin', fmt(Math.min(v.vin, v.vcc), 'V', 3));
  t('s-lux', fmt(ldr(v.lux), 'Ω', 2));
}

/* ---------- 計算結果 ---------- */
const NOTE = new Set(['f', 'P', 'rst']);
const row = (id: string, dt: string, main = false, sub = true) =>
  `<div class="m${main ? ' m-main' : ''}"><dt>${dt}</dt><dd><span id="o-${id}"></span>${sub ? `<span class="m-sub t5-ms" id="m-${id}"></span>` : ''}${NOTE.has(id) ? `<span class="m-note" id="n-${id}"></span>` : ''}</dd></div>`;
function buildMetrics(): void {
  const c = CIR[cid];
  let h = '';
  if (c.kind === 'osc') {
    h =
      row('f', '発振周波数 <i>f</i>', true) +
      row('tH', 'H レベル時間 <i>t</i><sub>H</sub>') +
      row('tL', 'L レベル時間 <i>t</i><sub>L</sub>') +
      row('T', '周期 <i>T</i>') +
      row('D', 'デューティ比 <i>D</i>') +
      row('first', '電源を入れて最初の H');
    if (cid === 'vco') h += row('U', 'しきい値（CV・CV/2）', false, false).replace('class="m"', 'class="m m-wide"');
    else if (cid === 'dark') h += row('rst', 'RST の電圧', false, false) + row('ldr', 'CdS の抵抗', false, false);
    else
      h +=
        row('I', '<i>R</i><sub>1</sub> の最大電流', false, false) +
        row('P', '<i>R</i><sub>1</sub> の最大損失', false, false);
  } else if (c.kind === 'mono') {
    h =
      row('tp', 'H の時間 <i>t</i>', true) +
      row('I', '<i>R</i><sub>1</sub> の最大電流', false, false) +
      row('P', '<i>R</i><sub>1</sub> の最大損失', false, false);
  } else {
    h = row('q', '出力', true, false) + row('U', '上のしきい値', false, false) + row('L', '下のしきい値', false, false);
    if (c.kind === 'schmitt') h += row('hy', 'ヒステリシス幅', false, false);
  }
  html('#t5-m', h);
}
const put = (id: string, s: string) => {
  const e = document.getElementById(id);
  if (e && e.innerHTML !== s) e.innerHTML = s;
};
const meas = (id: string, x: number | undefined, u: string) =>
  put(`m-${id}`, x == null ? '波形から —' : `波形から ${fmtR(x, u)}`);
const pct = (x: number) => `${(x * 100).toFixed(2)}<span class="u">%</span>`;
function showResults(): void {
  const c = CIR[cid],
    tm: Timing = c.timing(v),
    m = sim.measure();
  if (c.kind === 'osc') {
    const ok = tm.T != null;
    put('o-f', ok ? ro(1 / (tm.T as number), 'Hz') : '—');
    put('o-tH', ok ? ro(tm.tH as number, 's') : '—');
    put('o-tL', ok ? ro(tm.tL as number, 's') : '—');
    put('o-T', ok ? ro(tm.T as number, 's') : '—');
    put('o-D', ok ? pct((tm.tH as number) / (tm.T as number)) : '—');
    put('o-first', ok ? ro(tm.first as number, 's') : '—');
    meas('f', m.f, 'Hz');
    meas('tH', m.tH, 's');
    meas('tL', m.tL, 's');
    meas('T', m.f && 1 / m.f, 's');
    put('m-D', m.D == null ? '波形から —' : `波形から ${(m.D * 100).toFixed(2)} %`);
    meas('first', m.first, 's');
    let note = '';
    if (!ok) note = 'CV が VCC 以上で発振しません';
    else if (cid === 'dark' && rstV(v) < VRST) note = '明るいので RST が L で止まっています';
    put('n-f', note);
    if (cid === 'vco') {
      const U = Math.min(v.cv, v.vcc);
      put('o-U', `${fmtR(U, 'V')} ・ ${fmtR(U / 2, 'V')}`);
    } else if (cid === 'dark') {
      put('o-rst', ro(rstV(v), 'V'));
      put('n-rst', rstV(v) < VRST ? `${VRST} V 未満で停止` : '');
      put('o-ldr', ro(ldr(v.lux), 'Ω'));
    }
  }
  if (c.kind === 'mono') {
    put('o-tp', ro(tm.tp as number, 's'));
    meas('tp', m.tp, 's');
  }
  if (c.keys.includes('r1') && cid !== 'vco' && cid !== 'dark') {
    const P = (v.vcc * v.vcc) / v.r1;
    put('o-I', ro(v.vcc / v.r1, 'A'));
    put('o-P', ro(P, 'W'));
    put('n-P', P > 0.25 ? '1/4 W 抵抗の定格を超えます' : '');
  }
  if (c.kind === 'latch' || c.kind === 'schmitt') {
    put('o-q', sim.q && live.power ? 'H' : 'L');
    put('o-U', ro((2 * v.vcc) / 3, 'V'));
    put('o-L', ro(v.vcc / 3, 'V'));
    if (c.kind === 'schmitt') put('o-hy', ro(v.vcc / 3, 'V'));
  }
  subst(tm);
}

/* ---------- 代入した式 ---------- */
const mi = (s: string, sub?: string) => (sub ? `<msub><mi>${s}</mi><mn>${sub}</mn></msub>` : `<mi>${s}</mi>`);
const mt = (s: string) => `<math display="block">${s}</math>`;
const approx = (lhs: string, x: string) => mt(`<mphantom>${lhs}</mphantom><mo>&#x2248;</mo>${x}`);
function subst(tm: Timing): void {
  const R1 = mqty(v.r1, 'Ω'),
    R2 = mqty(v.r2, 'Ω'),
    C1 = mqty(v.c1, 'F'),
    ln = (n: number) => `<mi>ln</mi><mo>&#x2061;</mo><mn>${n}</mn>`,
    f = mi('f'),
    tH = '<msub><mi>t</mi><mi mathvariant="normal">H</mi></msub>',
    tL = '<msub><mi>t</mi><mi mathvariant="normal">L</mi></msub>',
    D = mi('D'),
    pc = '<mspace width="0.2em"/><mi mathvariant="normal">%</mi>';
  let s = '';
  switch (cid) {
    case 'astable':
    case 'alt':
    case 'dark': {
      const o = solve(v);
      s =
        mt(
          `${f}<mo>=</mo><mfrac><mn>1</mn><mrow>${ln(2)}${MDOT}<mrow><mo>(</mo>${R1}<mo>+</mo><mn>2</mn>${MDOT}${R2}<mo>)</mo></mrow>${MDOT}${C1}</mrow></mfrac>`,
        ) +
        approx(f, mqty(o.f, 'Hz', true)) +
        mt(
          `${D}<mo>=</mo><mfrac><mrow>${R1}<mo>+</mo>${R2}</mrow><mrow>${R1}<mo>+</mo><mn>2</mn>${MDOT}${R2}</mrow></mfrac><mo>&#xD7;</mo><mn>100</mn>${pc}`,
        ) +
        approx(D, `<mn>${o.D.toFixed(2)}</mn>${pc}`);
      break;
    }
    case 'diode':
      s =
        mt(`${tH}<mo>=</mo>${ln(2)}${MDOT}${R1}${MDOT}${C1}`) +
        approx(tH, mqty(tm.tH as number, 's', true)) +
        mt(`${tL}<mo>=</mo>${ln(2)}${MDOT}${R2}${MDOT}${C1}`) +
        approx(tL, mqty(tm.tL as number, 's', true)) +
        mt(
          `${D}<mo>=</mo><mfrac>${R1}<mrow>${R1}<mo>+</mo>${R2}</mrow></mfrac><mo>&#xD7;</mo><mn>100</mn>${pc}<mo>&#x2248;</mo><mn>${(((tm.tH as number) / (tm.T as number)) * 100).toFixed(2)}</mn>${pc}`,
        );
      break;
    case 'pwm': {
      const Ra = mqty((v.r2 * v.pos) / 100, 'Ω'),
        Rb = mqty((v.r2 * (100 - v.pos)) / 100, 'Ω');
      s =
        mt(
          `${tH}<mo>=</mo>${ln(2)}${MDOT}<mrow><mo>(</mo>${R1}<mo>+</mo>${Ra}<mo>)</mo></mrow>${MDOT}${C1}<mo>&#x2248;</mo>${mqty(tm.tH as number, 's', true)}`,
        ) +
        mt(`${tL}<mo>=</mo>${ln(2)}${MDOT}${Rb}${MDOT}${C1}<mo>&#x2248;</mo>${mqty(tm.tL as number, 's', true)}`) +
        mt(
          `${f}<mo>=</mo><mfrac><mn>1</mn><mrow>${tH}<mo>+</mo>${tL}</mrow></mfrac><mo>&#x2248;</mo>${mqty(1 / (tm.T as number), 'Hz', true)}`,
        );
      break;
    }
    case 'vco': {
      const U = Math.min(v.cv, v.vcc),
        V = mqty(v.vcc, 'V'),
        Uq = mqty(U, 'V'),
        Lq = mqty(U / 2, 'V');
      s =
        mt(
          `${tH}<mo>=</mo><mrow><mo>(</mo>${R1}<mo>+</mo>${R2}<mo>)</mo></mrow>${MDOT}${C1}${MDOT}<mi>ln</mi><mo>&#x2061;</mo><mfrac><mrow>${V}<mo>&#x2212;</mo>${Lq}</mrow><mrow>${V}<mo>&#x2212;</mo>${Uq}</mrow></mfrac>`,
        ) +
        approx(tH, tm.tH != null ? mqty(tm.tH, 's', true) : '<mtext>発振しない</mtext>') +
        mt(
          `${tL}<mo>=</mo>${ln(2)}${MDOT}${R2}${MDOT}${C1}<mo>&#x2248;</mo>${mqty(tm.tL ?? v.r2 * v.c1 * Math.LN2, 's', true)}`,
        );
      break;
    }
    case 'mono':
      s =
        mt(`${mi('t')}<mo>=</mo>${ln(3)}${MDOT}${R1}${MDOT}${C1}`) + approx(mi('t'), mqty(tm.tp as number, 's', true));
      break;
    case 'bistable':
      s = mt(
        `<mtext>TRIG &lt; </mtext><mfrac><mn>1</mn><mn>3</mn></mfrac>${mi('V', 'CC')}<mo>&#x2192;</mo><mtext>H</mtext><mo>,</mo><mspace width="1em"/><mtext>RST = L</mtext><mo>&#x2192;</mo><mtext>L</mtext>`,
      );
      break;
    case 'schmitt': {
      const V = mqty(v.vcc, 'V');
      s =
        mt(
          `<mtext>上のしきい値</mtext><mo>=</mo><mfrac><mn>2</mn><mn>3</mn></mfrac>${MDOT}${V}<mo>&#x2248;</mo>${mqty((2 * v.vcc) / 3, 'V', true)}`,
        ) +
        mt(
          `<mtext>下のしきい値</mtext><mo>=</mo><mfrac><mn>1</mn><mn>3</mn></mfrac>${MDOT}${V}<mo>&#x2248;</mo>${mqty(v.vcc / 3, 'V', true)}`,
        );
      break;
    }
  }
  html('#subst', s);
}

/* ---------- 入力 ---------- */
function rows(): void {
  const c = CIR[cid];
  for (const k of CORE) g?.setOff(k, !c.keys.includes(k), ONLY);
  for (const k of EXTRA) $(`#p-${k}`).hidden = !c.keys.includes(k);
  g?.update('r2', cid === 'pwm' ? R2_VR : R2_STD);
}
const defOf = (id: CirId, k: Key) => CIR[id].def[k] ?? (PARAMS.find((d) => d.k === k)?.v as number);
let g: ParamGroup<Key> | null = null;
let ready = false;
g = new ParamGroup<Key>(
  PARAMS.map((d) => ({ ...d, v: defOf(cid, d.k) })),
  (vals, k) => {
    v = { ...vals };
    if (!ready) return;
    if (k && SHAPE_KEYS[cid]?.includes(k)) redraw();
    else labels();
    showResults();
  },
  $('#eser'),
);
v = g.values();

/* ---------- 回路の切り替え ---------- */
function setCircuit(id: CirId, first = false): void {
  if (!first) mem[cid] = { ...v };
  cid = id;
  store('cir', id);
  sel.value = id;
  const c = CIR[id];
  if (!first && g)
    for (const d of PARAMS) {
      const dv = defOf(id, d.k);
      g.update(d.k, { v: dv });
      g.set(d.k, mem[id]?.[d.k] ?? dv, { silent: true });
    }
  if (g) v = g.values();
  rows();
  $('#t5-use').textContent = $('#t5-use').title = c.use.join('・');
  const tg = $('#wave-ch2');
  tg.innerHTML = `<i class="sw c2" aria-hidden="true"></i>CH2 ${c.ch2}`;
  tg.title =
    c.kind === 'latch'
      ? 'TRIG の電圧（2 番ピン）'
      : c.kind === 'schmitt'
        ? '入力の電圧（2・6 番ピン）'
        : 'C1 の電圧（2・6 番ピン）';
  for (const b of $$<HTMLButtonElement>('button', $('#t5-sp'))) b.disabled = c.kind === 'latch' || c.kind === 'schmitt';
  sim = new Sim();
  live.power = true;
  live.trig = live.rst = false;
  syncPower();
  span0 = 0;
  buildMetrics();
  redraw();
  showResults();
}
sel.addEventListener('change', () => isCir(sel.value) && setCircuit(sel.value));
const step = (d: number) => {
  const i = CIRCUITS.findIndex((c) => c.id === cid);
  setCircuit((CIRCUITS[(i + d + CIRCUITS.length) % CIRCUITS.length] as (typeof CIRCUITS)[number]).id);
};
$('#t5-prev').addEventListener('click', () => step(-1));
$('#t5-next').addEventListener('click', () => step(1));

/* ---------- 再生・速さ・電源 ---------- */
const pp = $<HTMLButtonElement>('#t5-pp');
pp.addEventListener('click', () => {
  playing = !playing;
  pp.classList.toggle('on', playing);
  pp.title = playing ? '一時停止' : '再生';
  pp.setAttribute('aria-label', pp.title);
});
const spBox = $('#t5-sp');
function syncSpeed(): void {
  for (const b of $$<HTMLButtonElement>('button', spBox)) b.setAttribute('aria-pressed', String(b.dataset.v === speed));
}
spBox.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button[data-v]');
  if (!b) return;
  speed = b.dataset.v as Speed;
  store('speed', speed);
  syncSpeed();
});
syncSpeed();
const pw = $<HTMLButtonElement>('#t5-pw');
function syncPower(): void {
  pw.setAttribute('aria-pressed', String(live.power));
  pw.textContent = live.power ? '電源 入' : '電源 切';
}
function togglePower(): void {
  live.power = !live.power;
  if (live.power) sim.powerOn();
  syncPower();
}
pw.addEventListener('click', togglePower);

/* ---------- 図の操作（電源・押しボタン・つまみ） ---------- */
type Btn = 'trig' | 'rst';
let held: Btn | null = null,
  dragging = false;
const toSvg = (e: PointerEvent) => {
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(sch.getScreenCTM()?.inverse());
  return [p.x, p.y] as const;
};
function potTo(e: PointerEvent): void {
  if (!pot || !g) return;
  const [x, y] = toSvg(e),
    t = Math.max(0, Math.min(1, ((pot.axis === 'x' ? x : y) - pot.a) / (pot.b - pot.a)));
  if (pot.k === 'pos') g.set('pos', Math.max(1, Math.min(99, Math.round(t * 100))));
  else g.set(pot.k, Math.round(t * v.vcc * 10) / 10 || (pot.k === 'cv' ? 0.5 : 0));
}
sch.addEventListener('pointerdown', (e) => {
  const t = e.target as Element;
  const b = t.closest<SVGElement>('[data-btn]')?.dataset.btn;
  if (b === 'pw') {
    togglePower();
    return;
  }
  if (b === 'trig' || b === 'rst') {
    held = b;
    live[b] = true;
  } else if (t.closest('.t5-pot')) {
    dragging = true;
    potTo(e);
  } else return;
  e.preventDefault();
  sch.setPointerCapture(e.pointerId);
});
sch.addEventListener('pointermove', (e) => {
  if (dragging) potTo(e);
});
const release = () => {
  if (held) live[held] = false;
  held = null;
  dragging = false;
};
sch.addEventListener('pointerup', release);
sch.addEventListener('pointercancel', release);
sch.addEventListener('keydown', (e) => {
  const b = (e.target as Element).closest<SVGElement>('[data-btn]')?.dataset.btn;
  if (!b || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault();
  if (b === 'pw') togglePower();
  else if ((b === 'trig' || b === 'rst') && !e.repeat) live[b] = true;
});
sch.addEventListener('keyup', (e) => {
  const b = (e.target as Element).closest<SVGElement>('[data-btn]')?.dataset.btn;
  if (b === 'trig' || b === 'rst') live[b] = false;
});

/* ---------- 波形 ---------- */
let span0 = 0;
/** 速さの目安: 1 周期（単安定は H の時間）を実際の何秒で見せるか */
const WALL: Record<Speed, number> = { slow: 3, normal: 0.8, real: 0 };
function drawThr(lines: [number, string][], Y: (x: number) => string): void {
  $('#thr-l').setAttribute('d', lines.map(([u]) => `M0 ${Y(u)}H${SW}`).join(''));
  const cc = '<tspan dy="2" font-size="0.75em">CC</tspan>';
  const t2 = $('#thr-t2'),
    t1 = $('#thr-t1');
  const [a, b] = lines;
  t2.setAttribute('y', a ? String(+Y(a[0]) - 6) : '-99');
  t2.innerHTML = a ? a[1].replace('CC', cc) : '';
  t1.setAttribute('y', b ? String(+Y(b[0]) + 15) : '-99');
  t1.innerHTML = b ? b[1].replace('CC', cc) : '';
}
function thresholds(): [number, string][] {
  const c = CIR[cid];
  if (c.kind === 'latch') return [[v.vcc / 3, '1/3 VCC']];
  if (cid === 'vco') {
    const U = Math.min(v.cv, v.vcc);
    return [
      [U, 'CV'],
      [U / 2, 'CV/2'],
    ];
  }
  return [
    [(2 * v.vcc) / 3, '2/3 VCC'],
    [v.vcc / 3, '1/3 VCC'],
  ];
}
function drawWave(tm: Timing): string {
  const c = CIR[cid],
    lines = thresholds();
  /* 実時間で周期が短い発振は、今までどおり止まった波形（トリガで固定） */
  if (c.kind === 'osc' && speed === 'real' && tm.T != null && tm.T < 0.1) {
    const env = c.env(v, live);
    const w = steady(
      { vcc: v.vcc, U: env.U, tH: tm.tH as number, tL: tm.tL as number, tau1: env.hi[1], tau2: env.lo[1] },
      { gy: scope.gy, vdiv: VDIV },
    );
    const { Y } = mapper(w.td, w.vd, scope.gy);
    drawThr(lines, Y);
    scope.draw({
      td: w.td,
      vd: w.vd,
      trig: v.vcc / 2,
      ch1: w.ch1,
      ch2: w.ch2,
      label: `出力波形（定常状態）。周期 ${fmtR(tm.T, 's')}、横軸 ${fmt(w.td, 's', 3)}/div、縦軸 ${fmt(w.vd, 'V', 3)}/div。`,
    });
    return '定常状態';
  }
  const span = span0,
    td = span / 10,
    vd = nice(v.vcc / VDIV),
    { Y } = mapper(td, vd, scope.gy),
    t0 = Math.max(0, sim.t - span),
    X = (t: number) => ((t - t0) / span) * SW;
  /* 窓の左端（t0）より古い記録は描かない。左端は直前の点との間を補って始める */
  const h = sim.hist;
  let k = h.findIndex((p) => p[0] >= t0);
  if (k < 0) k = h.length;
  const pts = h.slice(k);
  const prev = h[k - 1],
    next = h[k];
  if (prev && next && prev[0] < t0) {
    const f = (t0 - prev[0]) / (next[0] - prev[0] || 1);
    pts.unshift([t0, prev[1] + (next[1] - prev[1]) * f, prev[2]]);
  }
  let ch1 = '',
    ch2 = '';
  pts.forEach((p, i) => {
    const x = X(p[0]).toFixed(1);
    ch1 += `${i ? 'L' : 'M'}${x} ${Y(p[2])}`;
    ch2 += `${i ? 'L' : 'M'}${x} ${Y(p[1])}`;
  });
  drawThr(lines, Y);
  scope.draw({
    td,
    vd,
    trig: v.vcc / 2,
    ch1,
    ch2,
    label: `出力波形。横軸 ${fmt(td, 's', 3)}/div、縦軸 ${fmt(vd, 'V', 3)}/div。`,
  });
  return '';
}

/* ---------- LED の明るさ（実時間で速いときは点いている時間の割合） ---------- */
function ledBright(win: number, inv: boolean): number {
  const h = sim.hist;
  if (!h.length) return 0;
  const end = sim.t,
    from = end - Math.max(win, 1e-9);
  let on = 0,
    tot = 0;
  for (let i = h.length - 1; i > 0; i--) {
    const [t1] = h[i] as [number, number, number],
      [t0, , o0] = h[i - 1] as [number, number, number];
    if (t1 <= from) break;
    const d = Math.min(t1, end) - Math.max(t0, from);
    if (d <= 0) continue;
    tot += d;
    if (o0 > 0 !== inv) on += d;
  }
  if (!tot) {
    const o = (h[h.length - 1] as [number, number, number])[2] > 0;
    return o !== inv ? 1 : 0;
  }
  return on / tot;
}

/* ---------- フレーム ---------- */
let last = performance.now(),
  resT = 0;
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const c = CIR[cid],
    tm = c.timing(v);
  const ref = c.kind === 'osc' ? tm.T : c.kind === 'mono' ? tm.tp : undefined;
  let rate = 1;
  if (ref != null && speed !== 'real') rate = Math.min(1, ref / WALL[speed]);
  const want = ref != null ? nice(ref * 0.3) * 10 : 10;
  if (!span0 || (ref != null && (span0 < want / 2.5 || span0 > want * 2.5))) span0 = want;
  const env = c.env(v, live),
    simDt = playing ? dt * rate : 0;
  if (playing) sim.run(simDt, span0, env);
  const st = c.state(v, sim, live);
  st.n.src = v.vcc;
  flow.update(st, v.vcc, playing ? dt : 0, branchK);
  /* 図の電源スイッチ・ボタン・LED */
  sch.querySelector('#t5-sw')?.setAttribute('d', live.power ? 'M30 24L54 24' : 'M30 24L51 11');
  for (const b of sch.querySelectorAll<SVGGElement>('[data-bar]'))
    b.setAttribute('transform', live[b.dataset.bar as Btn] ? 'translate(3 0)' : 'translate(-5 0)');
  const lit = (id: string, inv: boolean) => {
    const e = sch.querySelector<SVGElement>(`#${id}`);
    if (!e) return;
    const on = live.power && v.vcc > VF;
    e.style.fillOpacity =
      on && playing ? String(ledBright(simDt * 1.5, inv)) : on ? String(+((sim.q === 1) !== inv)) : '0';
  };
  lit('led', false);
  lit('led2', false);
  lit('led1', true);
  const aux = drawWave(tm);
  const ra = $('#t5-rate');
  const txt = aux || (rate >= 0.999 ? '実時間' : `実際の 1/${Math.round(1 / rate).toLocaleString('ja-JP')} の速さ`);
  if (ra.textContent !== txt) ra.textContent = txt;
  resT += dt;
  if (resT > 0.2) {
    resT = 0;
    showResults();
  }
  requestAnimationFrame(frame);
}

setCircuit(cid, true);
ready = true;
requestAnimationFrame(frame);
