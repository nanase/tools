/**
 * 分岐図のページの図（Canvas）: 枠と目盛り、分岐図の濃さの画像、リアプノフ指数、クモの巣図、縦向きの時系列。
 * 隣り合う図は軸を 1 本ずつ共有するので、上下の余白（クモの巣図と分岐図）と左右の余白（クモの巣図と時系列）をそろえる
 */
import { iterate, lyapunov, type MapDef } from './map';
import type { View } from './params';

/** テーマの色（CSS 変数を読む） */
export interface Col {
  screen: string;
  ink: string;
  ink2: string;
  ink3: string;
  grid: string;
  grid2: string;
  sink: string;
  ch1: string;
  ch2: string;
}
export function readCol(): Col {
  const s = getComputedStyle(document.documentElement),
    g = (n: string) => s.getPropertyValue(n).trim();
  return {
    screen: g('--screen'),
    ink: g('--ink'),
    ink2: g('--ink-2'),
    ink3: g('--ink-3'),
    grid: g('--grid'),
    grid2: g('--grid-2'),
    sink: g('--screen-ink'),
    ch1: g('--ch1'),
    ch2: g('--ch2'),
  };
}
const rgb = (h: string): [number, number, number] => {
  let s = h.replace('#', '');
  if (s.length === 3) s = s.replace(/./g, '$&$&');
  const v = Number.parseInt(s, 16);
  return [v >> 16, (v >> 8) & 255, v & 255];
};
export const rgba = (h: string, a: number): string => {
  const [r, g, b] = rgb(h);
  return `rgba(${r},${g},${b},${a})`;
};
const clamp01 = (x: number): number => (x > 0 ? (x < 1 ? x : 1) : 0);

/** 図の余白 [px]。上下はクモの巣図と分岐図、左右はクモの巣図と時系列で同じ値を使う */
export const PAD = { l: 38, r: 12, t: 8, b: 20 };
const MONO = '10px "Fira Mono", ui-monospace, monospace';
const MATH = 'italic 12px "Cambria Math", "STIX Two Math", serif';

export interface Fit {
  c: CanvasRenderingContext2D;
  w: number;
  h: number;
  d: number;
}
/** キャンバスの画素を表示の大きさ × 画素密度（2 まで）に合わせる */
export function fitCanvas(cv: HTMLCanvasElement): Fit {
  const b = cv.getBoundingClientRect(),
    d = Math.min(2, window.devicePixelRatio || 1),
    w = Math.max(1, Math.round(b.width * d)),
    h = Math.max(1, Math.round(b.height * d));
  if (cv.width !== w || cv.height !== h) {
    cv.width = w;
    cv.height = h;
  }
  const c = cv.getContext('2d') as CanvasRenderingContext2D;
  c.setTransform(d, 0, 0, d, 0, 0);
  return { c, w: b.width, h: b.height, d };
}

export interface Frame {
  l: number;
  t: number;
  pw: number;
  ph: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  X(v: number): number;
  Y(v: number): number;
}
const niceStep = (span: number, n: number): number => {
  const raw = span / n,
    e = Math.floor(Math.log10(raw)),
    m = raw / 10 ** e;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * 10 ** e;
};
const digits = (s: number): number => Math.max(0, -Math.floor(Math.log10(s) + 1e-9));
const minus = (s: string): string => s.replace(/^-/, '−');

/** 地・目盛り・軸の名前を描き、座標の変換を返す。flip は縦を上から下へ増やす */
export function frame(
  F: Fit,
  ax: { x0: number; x1: number; y0: number; y1: number; flip?: boolean },
  col: Col,
  opt: { xl?: string; yl?: string; noX?: boolean } = {},
): Frame {
  const { c, w, h } = F,
    pw = w - PAD.l - PAD.r,
    ph = h - PAD.t - PAD.b;
  const P: Frame = {
    l: PAD.l,
    t: PAD.t,
    pw,
    ph,
    ...ax,
    X: (v) => PAD.l + ((v - ax.x0) / (ax.x1 - ax.x0)) * pw,
    Y: ax.flip
      ? (v) => PAD.t + ((v - ax.y0) / (ax.y1 - ax.y0)) * ph
      : (v) => PAD.t + (1 - (v - ax.y0) / (ax.y1 - ax.y0)) * ph,
  };
  c.fillStyle = col.screen;
  c.fillRect(0, 0, w, h);
  c.lineWidth = 1;
  c.font = MONO;
  c.fillStyle = col.sink;
  const sx = niceStep(ax.x1 - ax.x0, Math.max(2, Math.round(pw / 80))),
    sy = niceStep(ax.y1 - ax.y0, Math.max(2, Math.round(ph / 40)));
  c.strokeStyle = col.grid;
  c.beginPath();
  c.textAlign = 'center';
  c.textBaseline = 'top';
  for (let v = Math.ceil(ax.x0 / sx - 1e-9) * sx; v <= ax.x1 + sx * 1e-6; v += sx) {
    const X = Math.round(P.X(v)) + 0.5;
    c.moveTo(X, P.t);
    c.lineTo(X, P.t + ph);
    if (!opt.noX) c.fillText(minus(v.toFixed(digits(sx))), X, P.t + ph + 4);
  }
  c.textAlign = 'right';
  c.textBaseline = 'middle';
  for (let v = Math.ceil(ax.y0 / sy - 1e-9) * sy; v <= ax.y1 + sy * 1e-6; v += sy) {
    const Y = Math.round(P.Y(v)) + 0.5;
    c.moveTo(P.l, Y);
    c.lineTo(P.l + pw, Y);
    c.fillText(minus(v.toFixed(digits(sy))), P.l - 4, Y);
  }
  c.stroke();
  c.strokeStyle = col.grid2;
  c.strokeRect(P.l + 0.5, P.t + 0.5, pw - 1, ph - 1);
  c.fillStyle = col.ink2;
  c.font = MATH;
  if (opt.xl) {
    c.textAlign = 'right';
    c.textBaseline = 'bottom';
    c.fillText(opt.xl, P.l + pw - 4, P.t + ph - 3);
  }
  if (opt.yl) {
    c.textAlign = 'left';
    c.textBaseline = 'top';
    c.fillText(opt.yl, P.l + 4, P.t + 3);
  }
  return P;
}

/** 縦線と、その上の点（r の位置と軌道の値） */
function cursor(c: CanvasRenderingContext2D, P: Frame, X: number, col: Col): void {
  c.strokeStyle = rgba(col.ch1, 0.75);
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(X, P.t);
  c.lineTo(X, P.t + P.ph);
  c.stroke();
}

/** 過渡を捨てたあとの軌道の値（重なりを除いて最大 n 個） */
export function attractor(m: MapDef, r: number, x0: number, n = 64): number[] {
  let x = iterate(m, r, x0, 2000);
  const o: number[] = [];
  for (let i = 0; i < n; i++) {
    x = clamp01(m.f(x, r));
    o.push(x);
  }
  return o;
}

/* ---------- 分岐図 ---------- */
/**
 * 分岐図の濃さの画像（W × H 画素）。列ごとに skip 回の過渡を捨て、keep 回の値を升に数えて、
 * 回数を 1 − exp(−n/s) で濃さにする（周期の点は濃く、カオスの帯は薄く）
 */
export function bifImage(
  m: MapDef,
  v: View,
  W: number,
  H: number,
  skip: number,
  keep: number,
  col: Col,
): HTMLCanvasElement {
  const cnt = new Uint32Array(W * H),
    k = H / (v.y1 - v.y0);
  for (let i = 0; i < W; i++) {
    const r = v.r0 + ((i + 0.5) / W) * (v.r1 - v.r0);
    let x = iterate(m, r, 0.3, skip);
    for (let n = 0; n < keep; n++) {
      x = clamp01(m.f(x, r));
      let j = Math.floor((v.y1 - x) * k);
      if (v.flip) j = H - 1 - j;
      if (j >= 0 && j < H) cnt[j * W + i]++;
    }
  }
  const img = new ImageData(W, H),
    bg = rgb(col.screen),
    fg = rgb(col.ink),
    s = (2 * keep) / H + 0.6;
  for (let p = 0; p < W * H; p++) {
    const a = cnt[p] ? 1 - Math.exp(-cnt[p] / s) : 0;
    img.data[p * 4] = bg[0] + (fg[0] - bg[0]) * a;
    img.data[p * 4 + 1] = bg[1] + (fg[1] - bg[1]) * a;
    img.data[p * 4 + 2] = bg[2] + (fg[2] - bg[2]) * a;
    img.data[p * 4 + 3] = 255;
  }
  const oc = document.createElement('canvas');
  oc.width = W;
  oc.height = H;
  (oc.getContext('2d') as CanvasRenderingContext2D).putImageData(img, 0, 0);
  return oc;
}

export interface BifState {
  m: MapDef;
  /** 写像の既定の表示範囲の幅（拡大の倍率から過渡の回数を決める） */
  span: number;
  v: View;
  r: number;
  x0: number;
  sym: string;
  /** 掃引中は、この r より右を薄く覆う */
  rev: number | null;
  /** 範囲を拡大するドラッグの四角（キャンバスの座標） */
  box: { x0: number; y0: number; x1: number; y1: number } | null;
}

/** 分岐図を描く。濃さの画像は範囲・大きさ・色が変わったときだけ作り直す */
export class BifFig {
  P: Frame | null = null;
  private key = '';
  private img: HTMLCanvasElement | null = null;
  constructor(readonly cv: HTMLCanvasElement) {}

  draw(s: BifState, col: Col): void {
    const F = fitCanvas(this.cv),
      { v, m } = s;
    const P = frame(F, { x0: v.r0, x1: v.r1, y0: v.y0, y1: v.y1, flip: v.flip }, col, { xl: s.sym, yl: 'x' });
    this.P = P;
    const W = Math.max(1, Math.round(P.pw * F.d)),
      H = Math.max(1, Math.round(P.ph * F.d)),
      zoom = s.span / (v.r1 - v.r0),
      skip = Math.round(500 + 300 * Math.log2(Math.max(1, zoom))) * (v.deep ?? 1),
      keep = Math.round(Math.min(900, 300 + H * 0.8));
    const k = [m.id, v.r0, v.r1, v.y0, v.y1, v.flip, v.deep, W, H, col.screen, col.ink].join();
    if (k !== this.key || !this.img) {
      this.img = bifImage(m, v, W, H, skip, keep, col);
      this.key = k;
    }
    const c = F.c,
      rx = s.rev != null ? P.X(s.rev) : P.l + P.pw;
    c.save();
    c.beginPath();
    c.rect(P.l, P.t, Math.max(0, Math.min(P.pw, rx - P.l)), P.ph);
    c.clip();
    c.drawImage(this.img, P.l, P.t, P.pw, P.ph);
    c.restore();
    c.strokeStyle = col.grid2;
    c.lineWidth = 1;
    c.strokeRect(P.l + 0.5, P.t + 0.5, P.pw - 1, P.ph - 1);
    if (s.r >= v.r0 && s.r <= v.r1) {
      const X = P.X(s.r);
      cursor(c, P, X, col);
      c.fillStyle = col.ch1;
      for (const x of attractor(m, s.r, s.x0)) {
        const Y = P.Y(x);
        if (Y < P.t || Y > P.t + P.ph) continue;
        c.beginPath();
        c.arc(X, Y, 2.6, 0, 7);
        c.fill();
      }
    }
    if (s.box) {
      const b = s.box;
      c.strokeStyle = col.ch2;
      c.lineWidth = 1.5;
      c.setLineDash([4, 3]);
      c.strokeRect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
      c.setLineDash([]);
    }
  }
}

/* ---------- リアプノフ指数 ---------- */
/** 写像ごとの縦の範囲 */
const LY: Record<string, [number, number]> = { logistic: [-2, 1], sine: [-2, 1], tent: [-1, 1] };

/** r の位置の λ（表示用、過渡 1000 回のあと 4000 回の平均） */
export const lamAt = (m: MapDef, r: number, x0: number): number => lyapunov(m, r, x0, 1000, 4000);

export class LyFig {
  P: Frame | null = null;
  private key = '';
  private vals = new Float64Array(0);
  constructor(readonly cv: HTMLCanvasElement) {}

  draw(s: BifState, lam: number, col: Col): void {
    const F = fitCanvas(this.cv),
      { v, m } = s,
      [y0, y1] = LY[m.id];
    const P = frame(F, { x0: v.r0, x1: v.r1, y0, y1 }, col, { xl: s.sym, yl: 'λ' });
    this.P = P;
    const W = Math.max(1, Math.round(P.pw)),
      k = [m.id, v.r0, v.r1, W].join();
    if (k !== this.key) {
      this.vals = new Float64Array(W);
      for (let i = 0; i < W; i++) this.vals[i] = lyapunov(m, v.r0 + ((i + 0.5) / W) * (v.r1 - v.r0), 0.3, 400, 700);
      this.key = k;
    }
    const c = F.c,
      Y0 = P.Y(0),
      cy = (y: number) => Math.min(P.t + P.ph, Math.max(P.t, y)),
      vals = this.vals,
      n = s.rev != null ? Math.max(0, Math.min(W, Math.round(P.X(s.rev) - P.l))) : W;
    c.strokeStyle = col.ink3;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(P.l, Y0);
    c.lineTo(P.l + P.pw, Y0);
    c.stroke();
    /* 正の部分（カオス）を塗る */
    c.fillStyle = rgba(col.ch2, 0.22);
    c.beginPath();
    c.moveTo(P.l, Y0);
    for (let i = 0; i < n; i++) c.lineTo(P.l + i + 0.5, cy(P.Y(Math.max(0, vals[i]))));
    c.lineTo(P.l + n, Y0);
    c.fill();
    c.strokeStyle = col.ch2;
    c.lineWidth = 1.3;
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const y = cy(P.Y(vals[i]));
      if (i) c.lineTo(P.l + i + 0.5, y);
      else c.moveTo(P.l + 0.5, y);
    }
    c.stroke();
    if (s.r >= v.r0 && s.r <= v.r1) {
      const X = P.X(s.r);
      cursor(c, P, X, col);
      c.fillStyle = col.ch1;
      c.beginPath();
      c.arc(X, cy(P.Y(lam)), 3.2, 0, 7);
      c.fill();
    }
  }
}

/* ---------- クモの巣図 ---------- */
/** 縦の範囲 [y0, y1] は分岐図の縦の範囲（拡大したとき、その帯を薄く塗る） */
export function drawCob(cv: HTMLCanvasElement, s: BifState, col: Col): void {
  const F = fitCanvas(cv),
    { m, r } = s,
    c = F.c;
  const P = frame(F, { x0: 0, x1: 1, y0: 0, y1: 1 }, col, { xl: 'xₙ', yl: 'xₙ₊₁' });
  if (s.v.y0 > 0 || s.v.y1 < 1) {
    c.fillStyle = rgba(col.ch2, 0.1);
    const a = P.Y(s.v.y1),
      b = P.Y(s.v.y0);
    c.fillRect(P.l, a, P.pw, b - a);
  }
  c.strokeStyle = col.grid2;
  c.setLineDash([3, 3]);
  c.beginPath();
  c.moveTo(P.X(0), P.Y(0));
  c.lineTo(P.X(1), P.Y(1));
  c.stroke();
  c.setLineDash([]);
  c.strokeStyle = col.ink2;
  c.lineWidth = 1.6;
  c.beginPath();
  for (let i = 0; i <= 240; i++) {
    const x = i / 240,
      y = m.f(x, r);
    if (i) c.lineTo(P.X(x), P.Y(y));
    else c.moveTo(P.X(x), P.Y(y));
  }
  c.stroke();
  /* 階段: 初めの 66 段は薄く、最後の 24 段は濃く */
  const N = 90,
    tail = 24;
  let x = s.x0;
  c.lineWidth = 1.1;
  for (let n = 0; n < N; n++) {
    const y = clamp01(m.f(x, r));
    c.strokeStyle = rgba(col.ch1, n < N - tail ? 0.18 : 0.95);
    c.beginPath();
    c.moveTo(P.X(x), P.Y(n ? x : 0));
    c.lineTo(P.X(x), P.Y(y));
    c.lineTo(P.X(y), P.Y(y));
    c.stroke();
    x = y;
  }
  c.fillStyle = col.ch1;
  for (const z of attractor(m, r, s.x0)) {
    c.beginPath();
    c.arc(P.X(z), P.Y(z), 2.4, 0, 7);
    c.fill();
  }
}

/* ---------- 時系列（縦向き） ---------- */
/** 時系列の段の数 */
export const TS_N = 60;
/** 横が x（クモの巣図の横軸とそろえる）、縦が n（下へ進む） */
export function drawTs(cv: HTMLCanvasElement, s: BifState, col: Col): void {
  const F = fitCanvas(cv),
    { m, r } = s,
    c = F.c,
    o: number[] = [];
  let x = s.x0;
  for (let n = 0; n <= TS_N; n++) {
    o.push(x);
    x = clamp01(m.f(x, r));
  }
  const P = frame(F, { x0: 0, x1: 1, y0: 0, y1: TS_N, flip: true }, col, { xl: 'xₙ', yl: 'n' });
  c.strokeStyle = rgba(col.ch1, 0.5);
  c.lineWidth = 1;
  c.beginPath();
  for (let n = 0; n < o.length; n++) {
    if (n) c.lineTo(P.X(o[n]), P.Y(n));
    else c.moveTo(P.X(o[n]), P.Y(n));
  }
  c.stroke();
  c.fillStyle = col.ch1;
  for (let n = 0; n < o.length; n++) {
    c.beginPath();
    c.arc(P.X(o[n]), P.Y(n), 2, 0, 7);
    c.fill();
  }
}
