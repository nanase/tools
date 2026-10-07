/**
 * 図の SVG の組み立て（DOM に依存しない）: z 平面（格子・単位円・極と零点・e^{jω} からの線）と、
 * 周波数特性（振幅と、位相か群遅延。横軸は線形か対数）
 */
import { minus, parts } from '../../lib/format';
import { DV, nice, SH, SW } from '../../lib/scope';
import { sig, trace } from '../biquad/plot';
import { type Curves, EPS, type Kind, order, type Pt, rad } from './pz';

const f1 = (v: number) => v.toFixed(1);

/* ---------- z 平面 ---------- */
/** z 平面の図の一辺（SVG の座標） */
export const ZS = 400;
const ZC = ZS / 2;

/** 表示の範囲（中心から端まで）。点がすべて入るいちばん狭いもの */
export const VIEWS = [1.5, 2.5, 4.5] as const;
export const viewOf = (pts: readonly Pt[]): number => {
  const r = Math.max(0, ...pts.map(rad));
  return VIEWS.find((v) => r <= v - 0.1) ?? VIEWS[VIEWS.length - 1];
};

export interface Plane {
  /** 中心から端までの値 */
  v: number;
  /** 1 あたりの長さ */
  s: number;
  x: (re: number) => number;
  y: (im: number) => number;
  re: (x: number) => number;
  im: (y: number) => number;
}

export function plane(v: number): Plane {
  const s = ZC / v;
  return { v, s, x: (re) => ZC + re * s, y: (im) => ZC - im * s, re: (x) => (x - ZC) / s, im: (y) => (ZC - y) / s };
}

/** 格子・軸・単位円・単位円の上の周波数の目盛り。hz は角度 → 周波数の表記 */
export function planeGrid(P: Plane, hz: (deg: number) => string): string {
  const st = P.v > 3 ? 1 : 0.5;
  let g = '';
  for (let k = Math.ceil(-P.v / st); k * st <= P.v + 1e-9; k++) {
    if (k === 0) continue;
    const x = f1(P.x(k * st)),
      y = f1(P.y(k * st));
    g += `<path class="gl" d="M${x} 0V${ZS}M0 ${y}H${ZS}"/>`;
  }
  g += `<path class="gb" d="M${ZC} 0V${ZS}M0 ${ZC}H${ZS}"/><rect class="gb" x="0" y="0" width="${ZS}" height="${ZS}"/>`;
  /* 半径 0.5 ごとの円（単位円のほか。図の外は切る: z-clip は pole-zero.astro） */
  g += '<g clip-path="url(#z-clip)">';
  for (let r = 0.5; r < P.v * 1.42; r += 0.5)
    if (Math.abs(r - 1) > 1e-9) g += `<circle class="gl2" cx="${ZC}" cy="${ZC}" r="${f1(r * P.s)}"/>`;
  g += '</g>';
  g += `<circle class="uc" cx="${ZC}" cy="${ZC}" r="${f1(P.s)}"/>`;
  /* 単位円の上の 30° ごとの目盛り */
  for (let d = 0; d < 360; d += 30) {
    const c = Math.cos((d * Math.PI) / 180),
      s = Math.sin((d * Math.PI) / 180);
    g += `<path class="uc" d="M${f1(P.x(c))} ${f1(P.y(s))}L${f1(P.x(c * (1 + 7 / P.s)))} ${f1(P.y(s * (1 + 7 / P.s)))}"/>`;
  }
  /* 実軸の数値（原点の右下） */
  for (let k = Math.ceil(-P.v / st); k * st <= P.v + 1e-9; k++) {
    const v = k * st;
    if (k === 0 || Math.abs(v) > P.v - 0.2 || (st === 0.5 && k % 2 !== 0 && P.v > 2)) continue;
    g += `<text x="${f1(P.x(v) + 3)}" y="${ZC + 14}">${minus(String(v))}</text>`;
  }
  g += `<text x="${ZS - 6}" y="${ZC - 6}" text-anchor="end">Re</text><text x="${ZC + 6}" y="14">Im</text>`;
  /* 周波数: 0（z = 1）、fs/4（z = j）、fs/2（z = −1） */
  const o = 1 + 14 / P.s;
  g += `<text class="fq" x="${ZC + 6}" y="${f1(P.y(o) - 2)}">${hz(90)}</text>`;
  g += `<text class="fq" x="${f1(P.x(-o) - 2)}" y="${ZC - 6}" text-anchor="end">${hz(180)}</text>`;
  g += `<text class="fq" x="${f1(P.x(o) + 2)}" y="${ZC - 6}">${hz(0)}</text>`;
  return g;
}

/** 極か零点の印。pole なら ×、零点なら ○ */
const mark = (k: Kind, x: number, y: number, cls: string): string =>
  k === 'p'
    ? `<path class="${cls}" d="M${f1(x - 6)} ${f1(y - 6)}L${f1(x + 6)} ${f1(y + 6)}M${f1(x - 6)} ${f1(y + 6)}L${f1(x + 6)} ${f1(y - 6)}"/>`
    : `<circle class="${cls}" cx="${f1(x)}" cy="${f1(y)}" r="6"/>`;

/** 点の名前（z1・p2 …）。点の並びの順に、極と零点で別に数える */
export function labels(pts: readonly Pt[]): Map<number, string> {
  const m = new Map<number, string>(),
    n = { p: 0, z: 0 };
  for (const p of pts) m.set(p.id, `${p.k}${++n[p.k]}`);
  return m;
}

/**
 * 極と零点の印と名前。sel は選んだ点の id。重なった実軸の点は「×個数」を添える。
 * 極と零点の個数が違うときは、原点に足りない側の根（破線）を個数と一緒に描く
 */
export function planePts(P: Plane, pts: readonly Pt[], sel: number | null): string {
  const lab = labels(pts);
  let s = '',
    t = '';
  const seen = new Set<number>();
  for (const p of pts) {
    if (seen.has(p.id)) continue;
    const same = pts.filter(
      (q) => q.k === p.k && Math.abs(q.re - p.re) < EPS && Math.abs(q.im - p.im) < EPS && !seen.has(q.id),
    );
    for (const q of same) seen.add(q.id);
    const x = P.x(p.re),
      y = P.y(p.im),
      bad = p.k === 'p' && rad(p) > 1 + EPS,
      cls = `${p.k === 'p' ? 'pp' : 'zz'}${bad ? ' bad' : ''}`,
      on = same.some((q) => q.id === sel);
    const ys = p.im > 0 ? [y, P.y(-p.im)] : [y];
    for (const yy of ys) {
      if (on) s += `<circle class="psel" cx="${f1(x)}" cy="${f1(yy)}" r="12"/>`;
      s += mark(p.k, x, yy, cls);
    }
    const name = lab.get(p.id) ?? '';
    /* 名前は極を右上、零点を右下に置く（同じ角度の極と零点で重ならない） */
    t += `<text class="pl${bad ? ' bad' : ''}" x="${f1(x + 9)}" y="${f1(p.k === 'p' ? y - 8 : y + 17)}">${name}${same.length > 1 ? ` ×${same.length}` : ''}</text>`;
  }
  const d = order(pts, 'p') - order(pts, 'z');
  if (d) {
    const k: Kind = d > 0 ? 'z' : 'p';
    s += mark(k, ZC, ZC, `${k === 'p' ? 'pp' : 'zz'} imp`);
    if (Math.abs(d) > 1)
      t += `<text class="pl imp" x="${ZC - 9}" y="${ZC + 18}" text-anchor="end">×${Math.abs(d)}</text>`;
  }
  return s + t;
}

/** e^{jω} から各根への線（零点は CH2、極は CH1 の色。印の下に描く）と、e^{jω} の点と ω の弧（印の上に描く） */
export function planeCursor(P: Plane, pts: readonly Pt[], w: number): { lines: string; dot: string } {
  const cx = P.x(Math.cos(w)),
    cy = P.y(Math.sin(w));
  let l = '';
  const line = (k: Kind, re: number, im: number, imp = false) => {
    l += `<path class="${k === 'p' ? 'lp' : 'lz'}${imp ? ' imp' : ''}" d="M${f1(cx)} ${f1(cy)}L${f1(P.x(re))} ${f1(P.y(im))}"/>`;
  };
  for (const p of pts) {
    line(p.k, p.re, p.im);
    if (p.im > 0) line(p.k, p.re, -p.im);
  }
  const d = order(pts, 'p') - order(pts, 'z');
  if (d) line(d > 0 ? 'z' : 'p', 0, 0, true);
  const ar = 26,
    ax = ZC + ar * Math.cos(w),
    ay = ZC - ar * Math.sin(w),
    mw = w / 2;
  const arc = `<path class="wa" d="M${ZC + ar} ${ZC}A${ar} ${ar} 0 0 0 ${f1(ax)} ${f1(ay)}"/><text class="wl" x="${f1(ZC + (ar + 10) * Math.cos(mw))}" y="${f1(ZC - (ar + 10) * Math.sin(mw) + 4)}" text-anchor="middle">ω</text>`;
  return { lines: l, dot: `${w > 0.05 ? arc : ''}<circle class="cw" cx="${f1(cx)}" cy="${f1(cy)}" r="5"/>` };
}

/* ---------- 周波数特性 ---------- */
/** 横軸。線形なら 0 … π、対数なら π/1000 … π */
export interface FrAxis {
  lin: boolean;
  fs: number;
  w0: number;
  X: (w: number) => number;
  W: (x: number) => number;
}

export function frAxis(lin: boolean, fs: number): FrAxis {
  if (lin) return { lin, fs, w0: 0, X: (w) => (w / Math.PI) * SW, W: (x) => (x / SW) * Math.PI };
  const w0 = Math.PI / 1000,
    L = Math.log(Math.PI / w0);
  return {
    lin,
    fs,
    w0,
    X: (w) => (Math.log(w / w0) / L) * SW,
    W: (x) => w0 * Math.exp((x / SW) * L),
  };
}

/** 横軸に等間隔に並べた角周波数（両端を含む） */
export function frWs(ax: FrAxis, n = 1601): Float64Array {
  const ws = new Float64Array(n);
  for (let i = 0; i < n; i++) ws[i] = ax.W((i / (n - 1)) * SW);
  ws[n - 1] = Math.PI;
  if (ax.lin) ws[0] = 0;
  return ws;
}

/** 振幅の縦軸の 1 div あたり [dB] の候補 */
const DIVS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50];

export interface FrIn {
  ax: FrAxis;
  ws: Float64Array;
  c: Curves;
  /** 縦軸の下端 [dB] */
  bot: number;
  /** CH2 に描くもの: 位相か群遅延 */
  ch2: 'ph' | 'gd';
}

export interface FrPlot {
  grid: string;
  mag: string;
  ch2: string;
  axes: string;
  /** 振幅の 1 div あたり [dB] */
  dv: number;
  /** CH2 の 1 div あたり（位相は 60°、群遅延はサンプル） */
  dv2: number;
}

/** 周波数の目盛りの表記（3 桁、接頭辞つき） */
const hzS = (f: number) => parts(f, '', 3).join('');

export function frPlot({ ax, ws, c, bot: B, ch2 }: FrIn): FrPlot {
  const { X, fs } = ax,
    fw = (w: number) => (w * fs) / (2 * Math.PI);
  let g = '',
    a = '';
  if (ax.lin) {
    const st = nice(fs / 2 / 6);
    for (let f = st; f < fs / 2 - st * 0.05; f += st) {
      const x = f1(X((2 * Math.PI * f) / fs));
      g += `<path class="gl" d="M${x} 0V${SH}"/>`;
    }
    for (let f = 0; f <= fs / 2 + 1e-9; f += st)
      a += `<text x="${f1(X((2 * Math.PI * f) / fs))}" y="${SH + 17}" text-anchor="middle">${hzS(f)}</text>`;
  } else {
    const l0 = Math.log10(fw(ax.w0)),
      l1 = Math.log10(fs / 2);
    for (let d = Math.floor(l0); d <= Math.ceil(l1); d++)
      for (let m = 1; m < 10; m++) {
        const f = m * 10 ** d;
        if (f <= fw(ax.w0) * 1.0001 || f >= (fs / 2) * 0.9999) continue;
        g += `<path class="${m === 1 ? 'gl' : 'gl2'}" d="M${f1(X((2 * Math.PI * f) / fs))} 0V${SH}"/>`;
      }
    for (let d = Math.ceil(l0); d <= Math.floor(l1); d++)
      a += `<text x="${f1(X((2 * Math.PI * 10 ** d) / fs))}" y="${SH + 17}" text-anchor="middle">${hzS(10 ** d)}</text>`;
  }
  for (let j = 1; j < 6; j++) g += `<path class="gl" d="M0 ${j * DV}H${SW}"/>`;
  for (let y = 8; y < SH; y += 8) g += `<path class="gb" d="M0 ${y}h4M${SW} ${y}h-4"/>`;
  g += `<rect class="gb" x="0" y="0" width="${SW}" height="${SH}"/>`;

  /* 振幅: 下端 B から 6 div。最大（∞ を除く）+ 3 dB が入る刻み */
  let mx = -Infinity;
  for (const v of c.db) if (Number.isFinite(v) && v > mx) mx = v;
  const need = Math.max(Number.isFinite(mx) ? mx : 0, 0) + 3;
  const dv = DIVS.find((d) => B + 6 * d >= need) ?? Math.ceil((need - B) / 60) * 10;
  const lim = (y: number) => (Number.isNaN(y) ? NaN : Math.max(-DV, Math.min(SH + DV, y)));
  const Ym = (v: number) => lim(SH - ((v - B) / dv) * DV);
  const n = ws.length,
    xk = (k: number) => X(ws[k - 1]);
  a += '<g class="c1x">';
  for (let j = 0; j <= 6; j++)
    a += `<text x="-10" y="${SH - j * DV + 4}" text-anchor="end">${sig(B + j * dv, 4)}</text>`;
  if (0 >= B && 0 <= B + 6 * dv) a += `<path class="mk1" d="M-8 ${Ym(0) - 5}L-1 ${Ym(0)}L-8 ${Ym(0) + 5}Z"/>`;
  a += '</g><g class="c2x">';

  let p2: string, dv2: number;
  if (ch2 === 'ph') {
    dv2 = 60;
    const Yp = (p: number) => SH / 2 - (p / 60) * DV;
    p2 = trace(n + 1, xk, (k) => c.deg[k - 1], Yp, true);
    for (let j = 0; j <= 6; j++)
      a += `<text class="p2" x="${SW + 11}" y="${SH - j * DV + 4}">${minus(String(-180 + 60 * j))}</text>`;
    a += `<path class="mk2" d="M${SW + 1} ${SH / 2}l7 -5v10Z"/>`;
  } else {
    let lo = 0,
      hi = 0;
    for (const v of c.gd)
      if (Number.isFinite(v)) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    if (hi - lo < 1e-9) hi = lo + 6;
    dv2 = nice((hi - lo) / 6);
    let j0 = 0;
    for (let i = 0; i < 12; i++) {
      j0 = Math.ceil(-lo / dv2 - 1e-9);
      if ((6 - j0) * dv2 >= hi - 1e-9) break;
      dv2 = nice(dv2 * 1.01);
    }
    const y0 = SH - j0 * DV,
      Yg = (v: number) => lim(y0 - (v / dv2) * DV);
    p2 = trace(n + 1, xk, (k) => (Number.isFinite(c.gd[k - 1]) ? c.gd[k - 1] : NaN), Yg, false);
    for (let j = 0; j <= 6; j++)
      a += `<text class="p2" x="${SW + 11}" y="${SH - j * DV + 4}">${sig((j - j0) * dv2, 3)}</text>`;
    a += `<path class="mk2" d="M${SW + 1} ${y0}l7 -5v10Z"/>`;
  }
  a += '</g>';
  return { grid: g, mag: trace(n + 1, xk, (k) => c.db[k - 1], Ym, false), ch2: p2, axes: a, dv, dv2 };
}
