/** 水晶発振回路のページの入口: 水晶の選択 → 入力 → 計算 → 回路図の動き・地点の札・波形・発振する範囲・計算結果・共振の鋭さ */
import { $, $$ } from '../../lib/dom';
import { fmt, fmtR, ro } from '../../lib/format';
import { RM } from '../../lib/motion';
import { ParamGroup } from '../../lib/param';
import { posOf } from '../../lib/param-core';
import { DV, nice, SW } from '../../lib/scope';
import { store, stored } from '../../lib/store';
import { initToolPage } from '../../lib/tool-page';
import { CRYSTALS, type Crystal, XT } from './crystals';
import { drawMap, drawQ, type MapAxis, type MapInfo, mapPick, stateColors } from './fig';
import { amp, MARGIN_OK, type Parts, type Probe, probe, type Result, STATE_NAME, solve, TAU, VDD } from './model';
import { type Key, PARAMS, VIEW_PARAMS, type ViewKey } from './params';
import { BADGE_W, PROBE_NAME, PROBES, type ProbeId, SEGS } from './schematic';

initToolPage();
const put = (id: string, s: string) => {
  const e = document.getElementById(id);
  if (e && e.innerHTML !== s) e.innerHTML = s;
};
const text = (el: Element | null, s: string) => {
  if (el && el.textContent !== s) el.textContent = s;
};

/* ---------- 状態 ---------- */
const s0 = stored('xt');
let xt: Crystal = typeof s0 === 'string' && XT[s0] ? (XT[s0] as Crystal) : (XT.m16 as Crystal);
let parts: Parts = { ...xt.def };
let res: Result = solve(xt, parts);
type View = 'sch' | 'map';
type Mode = 'st' | 'up';
type Speed = 'slow' | 'normal';
const pick = <T extends string>(k: string, ok: readonly T[], d: T): T => {
  const v = stored(k);
  return ok.includes(v as T) ? (v as T) : d;
};
let view = pick<View>('view', ['sch', 'map'], 'sch');
let axis = pick<MapAxis>('axis', ['c', 'rd'], 'c');
let mode = pick<Mode>('mode', ['st', 'up'], 'st');
let speed = pick<Speed>('speed', ['slow', 'normal'], 'slow');
const ch0 = stored('chs');
const chs: ProbeId[] =
  Array.isArray(ch0) && ch0.length >= 1 && ch0.length <= 2 && ch0.every((c) => PROBES.includes(c as ProbeId))
    ? (ch0 as ProbeId[])
    : ['xin', 'xout'];
/** 1 周期を何秒で見せるか */
const PERIOD: Record<Speed, number> = { slow: 1.5, normal: 0.4 };
/** 起動を何秒で見せるか */
const SHOW = 7;

/* 時間: wall は再生中だけ進む表示の時刻 [s]。power を入れた時刻を 0 にする */
let wall = RM.matches ? SHOW * 2 : 0,
  phase = 0,
  power = true,
  /** 電源を切った表示の時刻（切っていなければ null） */
  offWall: number | null = null,
  playing = !RM.matches;
/** 起動の表示の長さ（実際の時間） */
const span = () => (Number.isFinite(res.ts) ? res.ts * 1.35 : 1e-3);
const realOf = (w: number) => (w / SHOW) * span();
const realNow = () => realOf(wall);
const offReal = () => (offWall == null ? null : realOf(offWall));

/* ---------- 入力 ---------- */
let ready = false;
const g = new ParamGroup<Key>(
  PARAMS.map((d) => ({ ...d, v: xt.def[d.k] })),
  (vals) => {
    parts = { ...vals };
    if (ready) changed(true);
  },
  $('#eser'),
);
parts = g.values();
/** 表示の設定（電流の粒の速さの倍率） */
let ptMul = 1;
const gv = new ParamGroup<ViewKey>(VIEW_PARAMS, (vals) => {
  ptMul = vals.pt;
});
ptMul = gv.get('pt');

/** 発振する範囲を入力の欄の下端に帯で塗る（並びの位置は欄の地と同じ） */
function bands(): void {
  const sc = stateColors();
  for (const d of PARAMS) {
    const k = d.k,
      sc0 = $(`#p-${k} .sc`);
    let band = sc0.querySelector<HTMLElement>('.xo-band');
    if (!band) {
      band = document.createElement('span');
      band.className = 'xo-band';
      band.setAttribute('aria-hidden', 'true');
      sc0.appendChild(band);
    }
    const L = g.list(k),
      n = L.length;
    if (n < 2) continue;
    const key = (v: number) => Math.log(Math.max(v, 1e-15));
    const st = L.map((v) => solve(xt, { ...parts, [k]: v }).st);
    const pos = L.map((v) => posOf(L, key, v));
    const stops: string[] = [];
    for (let i = 0; i < n; i++) {
      const a = i ? ((pos[i - 1] as number) + (pos[i] as number)) / 2 : 0,
        b = i < n - 1 ? ((pos[i] as number) + (pos[i + 1] as number)) / 2 : 1,
        c = sc[st[i] as number];
      stops.push(`${c} ${(a * 100).toFixed(2)}% ${(b * 100).toFixed(2)}%`);
    }
    band.style.background = `linear-gradient(90deg,${stops.join(',')})`;
    /* 欄の地は薄く、今の値までの塗りは少し濃く。塗りの幅に合わせて、欄の全体と同じ位置に色が来るよう伸ばす */
    const mix = (pct: number) =>
      `linear-gradient(90deg,${stops.map((x) => x.replace(/^(\S+)/, `color-mix(in srgb,$1 ${pct}%,transparent)`)).join(',')})`;
    sc0.classList.add('xo-tint');
    sc0.style.setProperty('--xo-tint', mix(22));
    const fillEl = sc0.querySelector<HTMLElement>('.sc-f'),
      w = Number.parseFloat(fillEl?.style.width ?? '0');
    sc0.style.setProperty('--xo-tint2', mix(55));
    if (fillEl) fillEl.style.backgroundSize = w > 0.5 ? `${(100 / w) * 100}% 100%` : '0 0';
  }
}

/* ---------- 水晶の切り替え ---------- */
const sel = $<HTMLSelectElement>('#xo-xt');
function setCrystal(x: Crystal): void {
  xt = x;
  store('xt', x.id);
  sel.value = x.id;
  text($('#xo-use'), x.use);
  for (const d of PARAMS) {
    g.update(d.k, { v: x.def[d.k] });
    g.set(d.k, x.def[d.k], { silent: true });
  }
  parts = g.values();
  changed(true);
}
sel.addEventListener('change', () => {
  const x = XT[sel.value];
  if (x) setCrystal(x);
});
const step = (d: number) => {
  const i = CRYSTALS.indexOf(xt);
  setCrystal(CRYSTALS[(i + d + CRYSTALS.length) % CRYSTALS.length] as Crystal);
};
$('#xo-prev').addEventListener('click', () => step(-1));
$('#xo-next').addEventListener('click', () => step(1));

/** 値が変わったら計算し直し、電源を入れ直したところから見せる */
function changed(restart: boolean): void {
  res = solve(xt, parts);
  if (restart) powerOn();
  labels();
  showResults();
  bands();
  drawQ($<HTMLCanvasElement>('#xo-q'), res);
  if (view === 'map') redrawMap();
}

/* ---------- 回路図の値 ---------- */
const sch = $<SVGSVGElement>('#xo-sch');
function labels(): void {
  const t = (id: string, s: string) => text(sch.querySelector(`#${id}`), s);
  t('s-rf', fmt(parts.rf, 'Ω', 3));
  t('s-rd', fmt(parts.rd, 'Ω', 3));
  t('s-c1', fmt(parts.c1, 'F', 3));
  t('s-c2', fmt(parts.c2, 'F', 3));
  t('s-xt', xt.name.replace(/ (音叉型|AT カット|セラミック発振子)$/, ''));
  t('s-rm', `Rm ${fmt(xt.rm, 'Ω', 3)}`);
}

/* ---------- 計算結果 ---------- */
const sig = (v: number) => (v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toPrecision(2));
function showResults(): void {
  const r = res,
    osc = r.st !== 0;
  put('o-f', osc ? ro(r.f, 'Hz', 9) : '—');
  put('m-f', osc ? `公称値から ${r.ppm >= 0 ? '+' : '−'}${Math.abs(r.ppm).toFixed(1)} ppm` : '');
  const note =
    r.st === 0
      ? '負性抵抗が Rm に届かず、発振しません'
      : r.st === 3
        ? '励振レベルが上限を超えています'
        : r.st === 1
          ? '余裕度が 5 倍未満で、起動しないことがあります'
          : '';
  put('n-f', note);
  $('#o-f').closest('dd')?.classList.toggle('xo-off', !osc);
  /* 余裕度 */
  put('o-mg', r.margin > 0 ? `${sig(r.margin)}<span class="u">倍</span>` : '0<span class="u">倍</span>');
  put('m-mg', `${MARGIN_OK} 倍以上で安定`);
  mark('o-mg', r.margin < 1 ? 'ng' : r.margin < MARGIN_OK ? 'cau' : '');
  put('o-rn', r.rneg > 0 ? ro(r.rneg, 'Ω', 3) : 'なし');
  put('m-rn', `水晶の Rm ${fmtR(xt.rm, 'Ω', 3)}`);
  mark('o-rn', r.rneg < xt.rm ? 'ng' : '');
  put('o-q', Math.round(r.q).toLocaleString('en-US'));
  put('m-q', `帯域幅 ${fmtR(r.fs / r.q, 'Hz', 3)}`);
  put('o-ts', osc ? ro(r.ts, 's', 3) : '—');
  put('m-ts', `時定数 ${osc ? fmtR(1 / r.alpha, 's', 3) : '—'}`);
  put('o-dl', osc ? ro(r.p, 'W', 3) : '—');
  put('m-dl', Number.isFinite(xt.pmax) ? `上限 ${fmt(xt.pmax, 'W', 3)}` : '上限の記載なし');
  mark('o-dl', r.st === 3 ? 'ng' : '');
  put('o-cl', ro(r.cl, 'F', 3));
  put('m-cl', `水晶の指定 ${fmt(xt.cl, 'F', 3)}`);
  mark('o-cl', Math.abs(r.ppm) > xt.tol ? 'cau' : '');
  $('#xo-m').setAttribute('data-st', STATE_NAME[r.st]);
}
function mark(id: string, c: '' | 'ng' | 'cau'): void {
  const dd = $(`#${id}`).closest('dd');
  dd?.classList.toggle('xo-ng', c === 'ng');
  dd?.classList.toggle('xo-cau', c === 'cau');
}

/* ---------- 表示の切り替え ---------- */
function segs(id: string, cur: string, on: (v: string) => void): void {
  const box = $(`#${id}`);
  const sync = (v: string) => {
    for (const b of $$<HTMLButtonElement>('button', box)) b.setAttribute('aria-pressed', String(b.dataset.v === v));
  };
  sync(cur);
  box.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('button[data-v]');
    if (!b?.dataset.v) return;
    sync(b.dataset.v);
    on(b.dataset.v);
  });
}
segs('xo-view', view, (v) => {
  view = v as View;
  store('view', view);
  syncView();
});
function syncView(): void {
  $('#xo-schv').hidden = view !== 'sch';
  $('#xo-mapv').hidden = view !== 'map';
  if (view === 'map') redrawMap();
}
segs('xo-axis', axis, (v) => {
  axis = v as MapAxis;
  store('axis', axis);
  redrawMap();
});
segs('xo-mode', mode, (v) => {
  mode = v as Mode;
  store('mode', mode);
});
segs('xo-sp', speed, (v) => {
  speed = v as Speed;
  store('speed', speed);
});

/* ---------- 発振する範囲 ---------- */
const mapCv = $<HTMLCanvasElement>('#xo-map');
let mapInfo: MapInfo | null = null;
function redrawMap(): void {
  mapInfo = drawMap(mapCv, xt, parts, axis);
  text($('#xo-axl'), axis === 'c' ? '横 C1 · 縦 C2' : '横 Rd · 縦 C1 = C2');
  $('#xo-dash').style.visibility = axis === 'c' ? 'visible' : 'hidden';
}
/** 並びの中で最も近い値（対数で比べる） */
function near(k: Key, v: number): number {
  const L = g.list(k);
  let best = L[0] as number;
  for (const x of L) if (Math.abs(Math.log(x / v)) < Math.abs(Math.log(best / v))) best = x;
  return best;
}
let dragging = false,
  pend: [number, number] | null = null;
function mapTo(e: PointerEvent): void {
  if (!mapInfo) return;
  const b = mapCv.getBoundingClientRect(),
    [vx, vy] = mapPick(mapInfo, e.clientX - b.left, e.clientY - b.top);
  pend = [vx, vy];
}
function applyPend(): void {
  if (!pend) return;
  const [vx, vy] = pend;
  pend = null;
  if (axis === 'c') {
    g.set('c1', near('c1', vx), { silent: true });
    g.set('c2', near('c2', vy), { silent: true });
  } else {
    g.set('rd', near('rd', vx), { silent: true });
    g.set('c1', near('c1', vy), { silent: true });
    g.set('c2', near('c2', vy), { silent: true });
  }
  parts = g.values();
  changed(true);
}
mapCv.addEventListener('pointerdown', (e) => {
  dragging = true;
  mapCv.setPointerCapture(e.pointerId);
  mapTo(e);
});
mapCv.addEventListener('pointermove', (e) => dragging && mapTo(e));
const endDrag = () => {
  dragging = false;
};
mapCv.addEventListener('pointerup', endDrag);
mapCv.addEventListener('pointercancel', endDrag);

/* ---------- 再生・速さ・電源 ---------- */
const pp = $<HTMLButtonElement>('#xo-pp');
function syncPlay(): void {
  pp.classList.toggle('on', playing);
  pp.title = playing ? '一時停止' : '再生';
  pp.setAttribute('aria-label', pp.title);
}
pp.addEventListener('click', () => {
  playing = !playing;
  syncPlay();
});
syncPlay();
const pw = $<HTMLButtonElement>('#xo-pw');
function powerOn(): void {
  power = true;
  wall = RM.matches ? SHOW * 2 : 0;
  offWall = null;
  pw.setAttribute('aria-pressed', 'true');
}
pw.addEventListener('click', () => {
  if (power) {
    power = false;
    offWall = wall;
    pw.setAttribute('aria-pressed', 'false');
  } else powerOn();
});

/* ---------- 波形の地点 ---------- */
const chBox = $('#xo-chs');
function syncCh(): void {
  for (const b of $$<HTMLButtonElement>('button', chBox)) {
    const i = chs.indexOf(b.dataset.pr as ProbeId);
    b.setAttribute('aria-pressed', String(i >= 0));
    b.classList.toggle('c1', i === 0);
    b.classList.toggle('c2', i === 1);
  }
  for (const el of sch.querySelectorAll<SVGGElement>('[data-pr]')) {
    const i = chs.indexOf(el.dataset.pr as ProbeId);
    el.classList.toggle('c1', i === 0);
    el.classList.toggle('c2', i === 1);
  }
  store('chs', chs);
}
function toggleCh(k: ProbeId): void {
  const i = chs.indexOf(k);
  if (i >= 0) {
    if (chs.length > 1) chs.splice(i, 1);
  } else {
    chs.push(k);
    if (chs.length > 2) chs.shift();
  }
  syncCh();
}
chBox.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button[data-pr]');
  if (b) toggleCh(b.dataset.pr as ProbeId);
});
sch.addEventListener('click', (e) => {
  const el = (e.target as Element).closest<SVGGElement>('[data-pr]');
  if (el) toggleCh(el.dataset.pr as ProbeId);
});
sch.addEventListener('keydown', (e) => {
  const el = (e.target as Element).closest<SVGGElement>('[data-pr]');
  if (!el || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault();
  toggleCh(el.dataset.pr as ProbeId);
});
syncCh();

/* ---------- 回路図の色と粒 ---------- */
const NS = 'http://www.w3.org/2000/svg';
const nets = [...sch.querySelectorAll<SVGElement>('[data-n]')];
const rgbOf = (s: string): [number, number, number] => {
  const h = s.trim().replace('#', '');
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16) || 0) as [number, number, number];
};
let c0: [number, number, number] = [163, 171, 177],
  c1: [number, number, number] = [93, 158, 0];
function readColors(): void {
  const cs = getComputedStyle(sch);
  c0 = rgbOf(cs.getPropertyValue('--xo-v0') || '#a3abb1');
  c1 = rgbOf(cs.getPropertyValue('--xo-v1') || '#5d9e00');
}
const vcol = (v: number) => {
  const t = Math.max(0, Math.min(1, v / VDD));
  return `rgb(${c0.map((a, i) => Math.round(a + ((c1[i] as number) - a) * t)).join(',')})`;
};
/** 粒の間隔と速さ。速さは電流の 0.35 乗（555 と同じ。20 mA で 160 図の単位/秒） */
const GAP = 15;
const pxPerSec = (i: number) => {
  const a = Math.abs(i);
  return a < 1e-7 ? 0 : Math.max(3, 160 * (a / 0.02) ** 0.35);
};
const ptsG = document.createElementNS(NS, 'g');
sch.insertBefore(ptsG, sch.querySelector('.xo-lead'));
const runs = SEGS.map((s) => {
  const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]),
    n = Math.max(1, Math.round(len / GAP)),
    dots = Array.from({ length: n }, () => {
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('r', '2.6');
      c.setAttribute('class', 'xo-pt');
      ptsG.appendChild(c);
      return c;
    });
  return { s, len, dots, gap: len / n, ph: 0 };
});

/* ---------- 地点の札の小さな波形 ---------- */
const spk = new Map(
  [...sch.querySelectorAll<SVGGElement>('[data-pr]')].map((el) => [
    el.dataset.pr as ProbeId,
    el.querySelector('.xo-spk') as SVGPathElement,
  ]),
);
const valOf = (p: Probe, k: ProbeId) => (k === 'ix' ? p.ix : p[k]);
function sparks(a: number, ph: number, on: boolean): void {
  /* 2 周期を左から右へ流す（左端が今） */
  const N = 28,
    x0 = 23,
    x1 = BADGE_W - 4,
    mid = 12,
    hh = 8;
  for (const k of PROBES) {
    let d = '';
    for (let i = 0; i <= N; i++) {
      const p = probe(res, parts, a, ph - (i / N) * 2 * TAU, on),
        v = valOf(p, k),
        y = k === 'ix' ? mid - (res.i > 0 ? (v / res.i) * hh : 0) : mid + hh - (v / VDD) * 2 * hh;
      d += `${i ? 'L' : 'M'}${(x0 + ((x1 - x0) * i) / N).toFixed(1)} ${y.toFixed(1)}`;
    }
    spk.get(k)?.setAttribute('d', d);
  }
}

/* ---------- 波形 ---------- */
const t1 = $<SVGPathElement>('#xo-t1'),
  t2 = $<SVGPathElement>('#xo-t2'),
  envF = $<SVGPathElement>('#xo-envf'),
  axesG = $<SVGGElement>('#xo-axes');
const ROWS = 5,
  SH = ROWS * DV;
const isI = (k: ProbeId) => k === 'ix';
/** 縦軸: 電圧は 0 V を下端に 1 V/div、電流は中央を 0 にして切りのよい値 */
function yScale(k: ProbeId): { y: (v: number) => number; div: number; u: string; zero: number } {
  if (!isI(k)) return { y: (v) => SH - (v / 1) * DV, div: 1, u: 'V', zero: SH };
  const d = nice(Math.max(res.i, 1e-9) / 2.2);
  return { y: (v) => SH / 2 - (v / d) * DV, div: d, u: 'A', zero: SH / 2 };
}
function axisLabels(k: ProbeId, side: 'l' | 'r', cls: string): string {
  const s = yScale(k);
  let a = '';
  for (let j = 0; j <= ROWS; j++) {
    const y = j * DV,
      v = isI(k) ? ((SH / 2 - y) / DV) * s.div : ((SH - y) / DV) * s.div;
    if (isI(k) && j % 1) continue;
    const t = Math.abs(v) < 1e-15 ? '0' : fmt(v, s.u, 2);
    a +=
      side === 'l'
        ? `<text class="${cls}" x="-8" y="${y + 4}" text-anchor="end">${t}</text>`
        : `<text class="${cls}" x="${SW + 8}" y="${y + 4}">${t}</text>`;
  }
  return a;
}
let lastAxes = '';
function drawWave(a: number, ph: number, on: boolean): void {
  const ca = chs[0] as ProbeId,
    cb = chs[1];
  let td: number;
  if (mode === 'st') {
    /* 4 周期ほどを 10 div に。表示の時間で左から右へ流れる（左端が今） */
    const T = 1 / res.f;
    td = nice((4 * T) / 10);
    const cyc = (10 * td) / T,
      N = 400;
    const path = (k: ProbeId) => {
      const s = yScale(k);
      let d = '';
      for (let i = 0; i <= N; i++) {
        const p = probe(res, parts, a, ph - (i / N) * cyc * TAU, on),
          y = Math.max(-12, Math.min(SH + 12, s.y(valOf(p, k))));
        d += `${i ? 'L' : 'M'}${((i * SW) / N).toFixed(1)} ${y.toFixed(1)}`;
      }
      return d;
    };
    t1.setAttribute('d', path(ca));
    t2.setAttribute('d', cb ? path(cb) : '');
    envF.setAttribute('d', '');
  } else {
    /* 起動: XIN の振れ幅の外形を、電源を入れてからの実際の時間で */
    const T = Math.max(span(), (offReal() ?? 0) + 4 * res.tau * (offWall == null ? 0 : 1));
    td = T / 10;
    const N = 200,
      s = yScale('xin'),
      off = offReal();
    let top = '',
      bot = '';
    for (let i = 0; i <= N; i++) {
      const tt = (i / N) * T,
        aa = amp(res, tt, off),
        m = off != null && tt >= off ? 0 : VDD / 2,
        x = ((i * SW) / N).toFixed(1);
      top += `${i ? 'L' : 'M'}${x} ${s.y(m + aa).toFixed(1)}`;
      bot = `L${x} ${s.y(m - aa).toFixed(1)}${bot}`;
    }
    envF.setAttribute('d', `${top}${bot}Z`);
    t1.setAttribute('d', top);
    /* 今の時刻と起動時間 */
    const xc = (Math.min(realNow(), T) / T) * SW;
    let d2 = `M${xc.toFixed(1)} 0V${SH}`;
    if (Number.isFinite(res.ts) && res.ts < T) {
      const xs = ((res.ts / T) * SW).toFixed(1);
      d2 += `M${xs} 0V${SH}`;
    }
    t2.setAttribute('d', d2);
  }
  /* 目盛りの数字（変わったときだけ書く） */
  let ax = '';
  for (let i = 1; i <= 9; i += 2)
    ax += `<text x="${i * DV}" y="${SH + 17}" text-anchor="middle">${fmt(i * td, 's', 3)}</text>`;
  ax += `<text x="0" y="${SH + 17}" text-anchor="middle">0</text>`;
  if (mode === 'st') {
    ax += axisLabels(ca, 'l', 'xo-a1');
    if (cb) ax += axisLabels(cb, 'r', 'xo-a2');
  } else {
    ax += axisLabels('xin', 'l', 'xo-a1');
    if (Number.isFinite(res.ts) && res.ts < td * 10)
      ax += `<text class="xo-a2" x="${((res.ts / (td * 10)) * SW + 4).toFixed(1)}" y="12">起動時間</text>`;
  }
  if (ax !== lastAxes) {
    axesG.innerHTML = ax;
    lastAxes = ax;
  }
  text($('#xo-td'), fmt(td, 's', 3));
  const tag = (k: ProbeId | undefined, n: 1 | 2) =>
    k
      ? `<i class="sw${n === 2 ? ' c2' : ''}" aria-hidden="true"></i>CH${n} ${PROBE_NAME[k]} <b>${fmt(yScale(k).div, yScale(k).u, 3)}</b>/div`
      : '';
  put('xo-c1', mode === 'st' ? tag(ca, 1) : tag('xin', 1).replace('CH1 XIN', 'XIN の振れ幅'));
  put('xo-c2', mode === 'st' ? tag(cb, 2) : '<i class="sw c2" aria-hidden="true"></i>今の時刻');
}

/* ---------- フレーム ---------- */
let last = performance.now(),
  colorAt = 0;
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  colorAt -= dt;
  if (colorAt <= 0) {
    readColors();
    colorAt = 0.5;
  }
  applyPend();
  if (playing) {
    wall += dt;
    phase += (dt / PERIOD[speed]) * TAU;
  }
  const off = offReal(),
    a = amp(res, realNow(), off),
    on = power,
    p = probe(res, parts, a, phase, on);
  /* 配線と極板の色・部品の地のグラデーション */
  for (const el of nets) {
    const n = el.dataset.n as string,
      v = n === 'gnd' ? 0 : (p[n as keyof Probe] ?? 0);
    const c = vcol(v);
    if (el.tagName === 'stop') el.setAttribute('stop-color', c);
    else el.style.stroke = c;
  }
  /* 粒 */
  const pdt = playing ? dt : 0;
  for (const r of runs) {
    const i = r.s.i(p),
      v = pxPerSec(i) * ptMul;
    if (!v) {
      for (const c of r.dots) c.setAttribute('visibility', 'hidden');
      continue;
    }
    r.ph = (((r.ph + Math.sign(i) * v * pdt) % r.gap) + r.gap) % r.gap;
    const { a: A, b: B } = r.s;
    r.dots.forEach((c, k) => {
      const f = ((r.ph + k * r.gap) % r.len) / r.len;
      c.setAttribute('cx', (A[0] + (B[0] - A[0]) * f).toFixed(1));
      c.setAttribute('cy', (A[1] + (B[1] - A[1]) * f).toFixed(1));
      c.setAttribute('visibility', 'visible');
    });
  }
  sparks(a, phase, on);
  drawWave(a, phase, on);
  text($('#xo-rate'), res.st === 0 ? '発振しない' : `起動の ${fmtR(res.ts, 's', 3)} を ${SHOW} 秒で表示`);
  requestAnimationFrame(frame);
}

/* ---------- 配色と大きさの変化 ---------- */
const recolor = () => {
  readColors();
  bands();
  drawQ($<HTMLCanvasElement>('#xo-q'), res);
  if (view === 'map') redrawMap();
};
new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);
let rz = 0;
new ResizeObserver(() => {
  cancelAnimationFrame(rz);
  rz = requestAnimationFrame(() => {
    drawQ($<HTMLCanvasElement>('#xo-q'), res);
    if (view === 'map') redrawMap();
  });
}).observe($('#xo-q'));
new ResizeObserver(() => view === 'map' && redrawMap()).observe(mapCv);

sel.value = xt.id;
text($('#xo-use'), xt.use);
ready = true;
syncView();
changed(false);
requestAnimationFrame(frame);
