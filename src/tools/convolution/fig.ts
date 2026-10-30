/**
 * 畳み込みのページの図（SVG を組み立てる）: 重ねて滑らせる図・入力の側からの図・出力 y(t)・
 * 入力と核の小さい図・振幅スペクトル。連続のインパルス（高さ 1/dt）は矢印で、高さは面積で描く
 */
import { at, type Sig, slide, spectrum } from './conv';
import type { Mode, Which } from './params';

const NS = 'http://www.w3.org/2000/svg';
type Attrs = Record<string, string | number>;
function el(tag: string, a: Attrs, parent?: Element): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const k in a) e.setAttribute(k, String(a[k]));
  parent?.appendChild(e);
  return e;
}
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
/** 軸の数値 */
const fmt = (v: number) =>
  (Math.abs(v) >= 10 ? v.toFixed(0) : Math.abs(v) >= 1 ? String(+v.toFixed(2)) : String(+v.toPrecision(2))).replace(
    /^-/,
    '−',
  );
/** 面積・y(t) の値 */
export const fmt3 = (v: number): string => (Math.abs(v) < 5e-4 ? '0.000' : v.toFixed(3).replace(/^-/, '−'));
/** 1・1.2・1.5・2・2.5・3・4・5・6・8 × 10ⁿ のうち v 以上の最小 */
export function nice(v: number): number {
  const e = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (v <= m * e * 1.001) return m * e;
  return 10 * e;
}
/** インパルスとみなす高さ（連続の 1/dt = 100 の柱） */
const BIG = 8;
const tv = (s: Sig, i: number) => s.t0 + i * s.dt;

/** 図の枠: 目盛りと軸。X・Y は値から座標へ */
export interface Frame {
  X: (t: number) => number;
  Y: (v: number) => number;
  W: number;
  H: number;
  L: number;
  R: number;
  T: number;
  B: number;
  xr: readonly number[];
  yr: readonly number[];
}
const FR = new WeakMap<SVGSVGElement, Frame>();
/** 小さい図の枠（なぞって描くときに座標を値へ戻す） */
export const frameOf = (svg: SVGSVGElement): Frame | undefined => FR.get(svg);

function frame(
  svg: SVGSVGElement,
  xr: readonly number[],
  yr: readonly number[],
  o: { h: number; tick: number; nox?: boolean; w?: number },
): Frame {
  const W = o.w ?? 800,
    H = o.h,
    L = 38,
    R = 10,
    T = 8,
    B = o.nox ? 8 : 24;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.textContent = '';
  const X = (t: number) => L + ((t - xr[0]) / (xr[1] - xr[0])) * (W - L - R);
  const Y = (v: number) => T + ((yr[1] - v) / (yr[1] - yr[0])) * (H - T - B);
  for (let t = Math.ceil(xr[0] / o.tick - 1e-9) * o.tick; t <= xr[1] + 1e-9; t += o.tick) {
    el('line', { class: 'cv-gl', x1: X(t), x2: X(t), y1: T, y2: H - B }, svg);
    /* 右端は軸の名前に譲る */
    if (!o.nox && X(t) < W - R - 34)
      el('text', { x: X(t), y: H - 7, 'text-anchor': 'middle' }, svg).textContent = fmt(+t.toFixed(3));
  }
  for (const v of [yr[0], (yr[0] + yr[1]) / 2, yr[1], 0]) {
    if (v < yr[0] || v > yr[1]) continue;
    el('line', { class: v === 0 ? 'cv-gb' : 'cv-gl', x1: L, x2: W - R, y1: Y(v), y2: Y(v) }, svg);
  }
  el('text', { x: L - 5, y: Y(yr[1]) + 4, 'text-anchor': 'end' }, svg).textContent = fmt(yr[1]);
  if (yr[0] < 0) el('text', { x: L - 5, y: Y(yr[0]) + 4, 'text-anchor': 'end' }, svg).textContent = fmt(yr[0]);
  el('rect', { class: 'cv-gb', x: L, y: T, width: W - L - R, height: H - T - B }, svg);
  const f = { X, Y, W, H, L, R, T, B, xr, yr };
  FR.set(svg, f);
  return f;
}
const tickOf = (mode: Mode, xr: readonly number[], w = 800) =>
  mode === 'c' ? (xr[1] - xr[0] > 7 ? 1 : 0.5) : w < 600 ? 4 : 2;

function line(f: Frame, xs: number[], ys: number[], cls: string, parent: Element): SVGElement {
  let d = '';
  const a = f.xr[0] - 1e-9,
    b = f.xr[1] + 1e-9,
    lo = f.yr[0] - (f.yr[1] - f.yr[0]) * 0.04,
    hi = f.yr[1] + (f.yr[1] - f.yr[0]) * 0.04;
  let on = false;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] < a || xs[i] > b) continue;
    d += `${on ? 'L' : 'M'}${f.X(xs[i]).toFixed(1)} ${f.Y(clamp(ys[i], lo, hi)).toFixed(1)}`;
    on = true;
  }
  return el('path', { d, class: cls }, parent);
}
function stems(f: Frame, xs: number[], ys: number[], cls: string, dcls: string, parent: Element): SVGElement {
  const g = el('g', {}, parent);
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] < f.xr[0] || xs[i] > f.xr[1] || ys[i] === 0) continue;
    const y = f.Y(clamp(ys[i], f.yr[0], f.yr[1]));
    el('line', { x1: f.X(xs[i]), x2: f.X(xs[i]), y1: f.Y(0), y2: y, class: cls }, g);
    el('circle', { cx: f.X(xs[i]), cy: y, r: 3.6, class: dcls }, g);
  }
  return g;
}
/** 信号を描く。flipAt を与えると h(flipAt − τ) として描く */
function plot(f: Frame, mode: Mode, s: Sig, cls: string, dcls: string, parent: Element, flipAt?: number): SVGElement {
  const xs: number[] = [],
    ys: number[] = [];
  for (let i = 0; i < s.v.length; i++) {
    xs.push(flipAt == null ? tv(s, i) : flipAt - tv(s, i));
    ys.push(s.v[i]);
  }
  if (mode === 'd') return stems(f, xs, ys, cls, dcls, parent);
  if (!ys.some((v) => Math.abs(v) >= BIG)) {
    if (flipAt != null) {
      xs.reverse();
      ys.reverse();
    }
    return line(f, xs, ys, cls, parent);
  }
  /* インパルスの列: 矢印の高さは面積 */
  const g = el('g', {}, parent);
  for (let i = 0; i < ys.length; i++) {
    if (Math.abs(ys[i]) < BIG || xs[i] < f.xr[0] || xs[i] > f.xr[1]) continue;
    const a = ys[i] * s.dt,
      x = f.X(xs[i]),
      y = f.Y(clamp(a, f.yr[0], f.yr[1])),
      d = 8 * Math.sign(a);
    el('line', { x1: x, x2: x, y1: f.Y(0), y2: y, class: cls }, g);
    el('path', { d: `M${x - 5} ${y + d}L${x} ${y}L${x + 5} ${y + d}`, class: cls }, g);
  }
  return g;
}
/** 積を塗る（正と負を分けて） */
function area(f: Frame, mode: Mode, s: Sig, p: Float64Array, parent: Element): void {
  const g = el('g', {}, parent);
  if (mode === 'd') {
    for (let i = 0; i < p.length; i++) {
      if (p[i] === 0) continue;
      const y0 = f.Y(0),
        y1 = f.Y(clamp(p[i], f.yr[0], f.yr[1]));
      el(
        'rect',
        {
          x: f.X(tv(s, i)) - 5,
          y: Math.min(y0, y1),
          width: 10,
          height: Math.abs(y1 - y0),
          class: `cv-pa${p[i] < 0 ? ' neg' : ''}`,
        },
        g,
      );
    }
    return;
  }
  for (const sg of [1, -1]) {
    let d = '',
      on = false;
    for (let i = 0; i < p.length; i++) {
      const v = sg * p[i] > 0 ? clamp(p[i], f.yr[0], f.yr[1]) : 0,
        x = f.X(tv(s, i)).toFixed(1);
      if (v !== 0 && !on) {
        d += `M${x} ${f.Y(0).toFixed(1)}`;
        on = true;
      }
      if (on) d += `L${x} ${f.Y(v).toFixed(1)}`;
      if (v === 0 && on) {
        d += 'Z';
        on = false;
      }
    }
    if (on) d += `L${f.X(tv(s, p.length - 1)).toFixed(1)} ${f.Y(0).toFixed(1)}Z`;
    if (d) el('path', { d, class: `cv-pa${sg < 0 ? ' neg' : ''}` }, g);
  }
}
function cursor(f: Frame, t: number, svg: SVGSVGElement): void {
  el('line', { class: 'cv-cur', x1: f.X(t), x2: f.X(t), y1: f.T, y2: f.H - f.B }, svg);
}
function label(f: Frame, s: string, svg: SVGSVGElement): void {
  el('text', { x: f.L + 8, y: f.T + 17, class: 'cv-lb' }, svg).textContent = s;
}
function axis(f: Frame, s: string, svg: SVGSVGElement): void {
  el('text', { x: f.W - f.R - 4, y: f.H - 7, 'text-anchor': 'end', class: 'cv-ax' }, svg).textContent = s;
}

/** 図に要る信号と縦の幅 */
export interface Fig {
  mode: Mode;
  /** 滑らせた位置 */
  t: number;
  /** 反転する（畳み込み）か、しない（相関）か */
  flip: boolean;
  x: Sig;
  h: Sig;
  /** 滑らせる核（相関では h を反転したもの） */
  hh: Sig;
  y: Sig;
  /** 図の横軸と、滑らせる範囲 */
  view: readonly number[];
  tr: readonly number[];
  /** 大きい図の横の幅（viewBox の単位）。狭い画面では小さくして文字を読める大きさにする */
  w: number;
  /** 縦の幅: 入力と核、出力、積 */
  ax: number;
  ay: number;
  ap: number;
}
const hasNeg = (s: Sig) => s.v.some((q) => q < -1e-9);

/** 出力の側から: x(τ) と h(t − τ) を重ね、積を塗る */
export function overlay(svg: SVGSVGElement, F: Fig, h: number): number {
  const v = F.view,
    neg = hasNeg(F.x) || hasNeg(F.hh),
    f = frame(svg, v, [neg ? -F.ax * 1.1 : -F.ax * 0.12, F.ax * 1.15], { h, w: F.w, tick: tickOf(F.mode, v, F.w) }),
    sl = slide(F.x, F.hh, F.t);
  area(f, F.mode, F.x, sl.p, svg);
  plot(f, F.mode, F.x, 'cv-x', 'cv-dx', svg);
  plot(f, F.mode, F.hh, 'cv-h', 'cv-dh', svg, F.t);
  cursor(f, F.t, svg);
  label(f, F.flip ? 'x(τ)　h(t − τ)' : 'x(τ)　h(τ − t)', svg);
  el('text', { x: f.X(F.t) + 7, y: f.T + 17, class: 'cv-lab' }, svg).textContent =
    `${F.mode === 'c' ? '∫' : 'Σ'} = ${fmt3(sl.area)}`;
  axis(f, 'τ', svg);
  return sl.area;
}

/** 入力の側から: 入力の各点（連続では 0.25 ごとの帯）が出す核の写しと、t までに出た写しの和 */
export function inputSide(svg: SVGSVGElement, F: Fig, h: number): void {
  const { x, hh, y, ay, mode } = F,
    v = F.view,
    f = frame(svg, v, [-ay * (hasNeg(y) ? 1.1 : 0.3), ay * 1.15], { h, w: F.w, tick: tickOf(mode, v, F.w) }),
    per = mode === 'c' ? Math.round(0.25 / x.dt) : 1;
  for (let i0 = 0; i0 < x.v.length; i0 += per) {
    let a = 0;
    for (let i = i0; i < Math.min(x.v.length, i0 + per); i++) a += x.v[i] * x.dt;
    const tau = tv(x, i0);
    if (Math.abs(a) < 1e-9 || tau > F.t) continue;
    const xs: number[] = [],
      ys: number[] = [];
    for (let j = 0; j < hh.v.length; j++) {
      xs.push(tau + tv(hh, j));
      ys.push(a * hh.v[j]);
    }
    if (mode === 'd') stems(f, xs, ys, 'cv-c', 'cv-dc', svg);
    else if (!ys.some((q) => Math.abs(q) >= BIG)) line(f, xs, ys, 'cv-c', svg);
  }
  /* 和は細かい刻みのまま、t までに出た分を足す（写しの帯は見せるためだけの粗さ） */
  const acc = new Float64Array(y.v.length);
  for (let i = 0; i < x.v.length; i++) {
    const tau = tv(x, i),
      a = x.v[i] * x.dt;
    if (a === 0 || tau > F.t + 1e-9) continue;
    const j0 = Math.max(0, Math.floor((tau + hh.t0 - y.t0) / y.dt) - 1),
      j1 = Math.min(acc.length - 1, Math.ceil((tau + hh.t0 + (hh.v.length - 1) * hh.dt - y.t0) / y.dt) + 1);
    for (let j = j0; j <= j1; j++) acc[j] += a * at(hh, tv(y, j) - tau);
  }
  const xs = Array.from(y.v, (_, i) => tv(y, i)),
    ys = Array.from(acc);
  if (mode === 'd') stems(f, xs, ys, 'cv-y', 'cv-dy', svg);
  else {
    line(f, xs, Array.from(y.v), 'cv-y ghost', svg);
    line(f, xs, ys, 'cv-y', svg);
  }
  cursor(f, F.t, svg);
  label(f, 'Σ x(τ) h(t − τ)', svg);
  axis(f, 't', svg);
}

/** 出力 y(t): t までを実線、残りを薄い破線 */
export function output(svg: SVGSVGElement, F: Fig, yt: number, h: number): void {
  const { y, ay, mode } = F,
    v = F.view,
    f = frame(svg, v, [-ay * (hasNeg(y) ? 1.1 : 0.15), ay * 1.1], { h, w: F.w, tick: tickOf(mode, v, F.w) }),
    xs = Array.from(y.v, (_, i) => tv(y, i)),
    ys = Array.from(y.v),
    n0 = xs.findIndex((q) => q > F.t + 1e-9),
    n = n0 < 0 ? xs.length : n0;
  if (mode === 'd') {
    stems(f, xs.slice(n), ys.slice(n), 'cv-y', 'cv-dy', svg).setAttribute('opacity', '.28');
    stems(f, xs.slice(0, n), ys.slice(0, n), 'cv-y', 'cv-dy', svg);
  } else {
    line(f, xs, ys, 'cv-y ghost', svg);
    line(f, xs.slice(0, n), ys.slice(0, n), 'cv-y', svg);
  }
  cursor(f, F.t, svg);
  el('circle', { cx: f.X(F.t), cy: f.Y(clamp(yt, f.yr[0], f.yr[1])), r: 5.5, class: 'cv-dy' }, svg);
  label(f, 'y(t)', svg);
  axis(f, 't', svg);
}

/** 入力か核の小さい図（なぞって描く） */
export function mini(svg: SVGSVGElement, F: Fig, which: Which, grid: readonly number[]): void {
  const s = which === 'x' ? F.x : F.h,
    xr = [grid[0], grid[0] + (grid[2] - 1) * grid[1]],
    top = Math.max(0.25, F.ax * 1.1),
    /* 下は負の値を描ける幅を残す */
    f = frame(svg, xr, [hasNeg(s) ? -top : -top * 0.5, top], { h: 120, w: 440, tick: F.mode === 'c' ? 1 : 2 });
  plot(f, F.mode, s, which === 'x' ? 'cv-x' : 'cv-h', which === 'x' ? 'cv-dx' : 'cv-dh', svg);
  label(f, which === 'x' ? 'x(t)' : 'h(t)', svg);
}

/** 振幅スペクトル |X|・|H|・|Y| = |X|·|H|（縦は図ごとの最大に合わせる） */
export function spec(svg: SVGSVGElement, F: Fig, which: Which | 'y', h: number, withAxis: boolean): void {
  const s = which === 'x' ? F.x : which === 'h' ? F.hh : F.y,
    L = 2048,
    m = spectrum(s, L),
    df = 1 / (L * s.dt),
    fmax = F.mode === 'c' ? 4 : 0.5;
  let top = 0;
  for (let k = 0; k * df <= fmax; k++) top = Math.max(top, m[k]);
  const f = frame(svg, [0, fmax], [0, nice(top || 1) * 1.05], {
      h,
      w: 420,
      tick: F.mode === 'c' ? 1 : 0.1,
      nox: !withAxis,
    }),
    xs: number[] = [],
    ys: number[] = [];
  for (let k = 0; k * df <= fmax + 1e-12; k++) {
    xs.push(k * df);
    ys.push(m[k]);
  }
  line(f, xs, ys, which === 'x' ? 'cv-x' : which === 'h' ? 'cv-h' : 'cv-y', svg);
  el('text', { x: f.W - f.R - 8, y: f.T + 17, class: 'cv-lb', 'text-anchor': 'end' }, svg).textContent =
    which === 'x' ? '|X(f)|' : which === 'h' ? '|H(f)|' : '|Y(f)| = |X(f)|·|H(f)|';
  if (withAxis) axis(f, F.mode === 'c' ? 'f [Hz]' : 'f [1/点]', svg);
}
