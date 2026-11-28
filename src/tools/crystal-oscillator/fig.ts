/** キャンバスの図: 発振する範囲（2 つの値の平面を状態で塗る）と、共振の鋭さ（水晶の電流の周波数特性と Q） */
import { fmt } from '../../lib/format';
import type { Crystal } from './crystals';
import { admittance, CS, type Parts, type Result, type State, solve } from './model';

const css = (n: string, fb: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fb;
export const stateColors = (): string[] => [
  css('--xo-s0', '#c3c8c1'),
  css('--xo-s1', '#e3b23c'),
  css('--xo-s2', '#6aab3f'),
  css('--xo-s3', '#d2505a'),
];

/** 高解像度の画面に合わせて大きさを決め、消す */
export function sizeCanvas(cv: HTMLCanvasElement): [CanvasRenderingContext2D, number, number] {
  const dpr = Math.min(2, window.devicePixelRatio || 1),
    w = cv.clientWidth,
    h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const g = cv.getContext('2d') as CanvasRenderingContext2D;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return [g, w, h];
}

/* ---------- 発振する範囲 ---------- */
export type MapAxis = 'c' | 'rd';
interface Range {
  lo: number;
  hi: number;
  u: string;
  ticks: number[];
}
const RC: Range = { lo: 2e-12, hi: 470e-12, u: 'F', ticks: [2e-12, 10e-12, 47e-12, 220e-12] };
const RR: Range = { lo: 10, hi: 4.7e6, u: 'Ω', ticks: [10, 1e3, 100e3, 4.7e6] };
export interface MapInfo {
  axis: MapAxis;
  x0: number;
  y0: number;
  w: number;
  h: number;
  rx: Range;
  ry: Range;
}
const PAD = { l: 52, r: 8, t: 8, b: 26 };
const frac = (v: number, r: Range) => Math.log(v / r.lo) / Math.log(r.hi / r.lo);
const at = (f: number, r: Range) => r.lo * (r.hi / r.lo) ** f;

/** 横 C1・縦 C2（axis 'c'）か、横 Rd・縦 C1 = C2（axis 'rd'）の平面を塗る */
export function drawMap(cv: HTMLCanvasElement, x: Crystal, p: Parts, axis: MapAxis): MapInfo {
  const [g, W, H] = sizeCanvas(cv),
    w = W - PAD.l - PAD.r,
    h = H - PAD.t - PAD.b,
    rx = axis === 'c' ? RC : RR,
    ry = RC,
    sc = stateColors();
  const nx = Math.max(40, Math.round(w / 6)),
    ny = Math.max(30, Math.round(h / 6));
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      const vx = at((i + 0.5) / nx, rx),
        vy = at((j + 0.5) / ny, ry),
        q: Parts = axis === 'c' ? { ...p, c1: vx, c2: vy } : { ...p, rd: vx, c1: vy, c2: vy };
      g.fillStyle = sc[solve(x, q).st] as string;
      const x0 = PAD.l + (i / nx) * w,
        y0 = PAD.t + h - ((j + 1) / ny) * h;
      g.fillRect(Math.floor(x0), Math.floor(y0), Math.ceil(w / nx) + 1, Math.ceil(h / ny) + 1);
    }
  const ink = css('--ink', '#15191c'),
    ink3 = css('--ink-3', '#687078'),
    mono = css('--mono', 'monospace');
  /* 公称の周波数になる組み合わせ（負荷容量 = 指定）の破線 */
  if (axis === 'c') {
    g.strokeStyle = ink;
    g.lineWidth = 1.5;
    g.setLineDash([5, 4]);
    g.beginPath();
    let first = true;
    for (let i = 0; i <= 240; i++) {
      const c1 = at(i / 240, rx) + CS;
      if (c1 <= x.cl * 1.0001) continue;
      const c2 = (x.cl * c1) / (c1 - x.cl) - CS;
      if (c2 < ry.lo || c2 > ry.hi) continue;
      const px = PAD.l + frac(c1 - CS, rx) * w,
        py = PAD.t + h - frac(c2, ry) * h;
      if (first) g.moveTo(px, py);
      else g.lineTo(px, py);
      first = false;
    }
    g.stroke();
    g.setLineDash([]);
  }
  /* 今の値 */
  const vx = axis === 'c' ? p.c1 : Math.max(p.rd, rx.lo),
    px = PAD.l + Math.min(1, Math.max(0, frac(vx, rx))) * w,
    py = PAD.t + h - Math.min(1, Math.max(0, frac(axis === 'c' ? p.c2 : p.c1, ry))) * h;
  g.fillStyle = css('--surface', '#fafbf8');
  g.strokeStyle = ink;
  g.lineWidth = 2;
  g.beginPath();
  g.arc(px, py, 7, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  /* 目盛り */
  g.fillStyle = ink3;
  g.font = `13px ${mono}`;
  g.textBaseline = 'alphabetic';
  for (const v of rx.ticks) {
    const s = fmt(v, rx.u, 2),
      tw = g.measureText(s).width,
      tx = PAD.l + frac(v, rx) * w;
    g.fillText(s, Math.max(PAD.l, Math.min(W - tw, tx - tw / 2)), H - 7);
  }
  g.textAlign = 'right';
  for (const v of ry.ticks) {
    const ty = PAD.t + h - frac(v, ry) * h;
    g.fillText(fmt(v, 'F', 2), PAD.l - 6, Math.max(PAD.t + 10, Math.min(PAD.t + h, ty + 4)));
  }
  g.textAlign = 'left';
  return { axis, x0: PAD.l, y0: PAD.t, w, h, rx, ry };
}

/** 図の上の位置 → 値（横・縦） */
export function mapPick(m: MapInfo, x: number, y: number): [number, number] {
  const fx = Math.max(0, Math.min(1, (x - m.x0) / m.w)),
    fy = Math.max(0, Math.min(1, (m.y0 + m.h - y) / m.h));
  return [at(fx, m.rx), at(fy, m.ry)];
}

/* ---------- 共振の鋭さ ---------- */
/** 横は fs からのずれ（± 帯域幅の 2.5 倍）、縦は同じ電圧で水晶に流れる電流（山の高さで 1） */
export function drawQ(cv: HTMLCanvasElement, r: Result): void {
  const [g, W, H] = sizeCanvas(cv),
    x = r.x,
    bw = r.fs / r.q,
    span = bw * 5,
    pb = 22,
    pt = 8,
    h = H - pb - pt;
  const grid = css('--grid', '#dde1d8'),
    ink = css('--ink', '#15191c'),
    ink2 = css('--ink-2', '#48505a'),
    ink3 = css('--ink-3', '#687078'),
    ch1 = css('--ch1', '#9a6c00'),
    mono = css('--mono', 'monospace'),
    sans = css('--sans', 'sans-serif');
  g.strokeStyle = grid;
  g.lineWidth = 1;
  g.beginPath();
  for (let i = 1; i < 10; i++) {
    const gx = Math.round((W * i) / 10) + 0.5;
    g.moveTo(gx, pt);
    g.lineTo(gx, pt + h);
  }
  for (let j = 0; j <= 4; j++) {
    const gy = Math.round(pt + (h * j) / 4) + 0.5;
    g.moveTo(0, gy);
    g.lineTo(W, gy);
  }
  g.stroke();
  const top = admittance(x, r.lm, r.fs, 0);
  g.strokeStyle = ch1;
  g.lineWidth = 2;
  g.beginPath();
  for (let i = 0; i <= W; i++) {
    const y = pt + h - (admittance(x, r.lm, r.fs, (i / W - 0.5) * span) / top) * h;
    if (i) g.lineTo(i, y);
    else g.moveTo(i, y);
  }
  g.stroke();
  /* 山の高さの 1/√2 での幅 = fs / Q */
  const y2 = pt + h - h / Math.SQRT2,
    xa = W / 2 - (bw / 2 / span) * W,
    xb = W / 2 + (bw / 2 / span) * W;
  g.strokeStyle = ink2;
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(xa, y2);
  g.lineTo(xb, y2);
  g.moveTo(xa, y2 - 6);
  g.lineTo(xa, y2 + 6);
  g.moveTo(xb, y2 - 6);
  g.lineTo(xb, y2 + 6);
  g.stroke();
  g.fillStyle = ink;
  g.font = `600 13px ${sans}`;
  g.fillText(`幅 ${fmt(bw, 'Hz', 3)}`, xb + 8, y2 + 4);
  g.font = `700 15px ${mono}`;
  g.fillText(`Q = ${Math.round(r.q).toLocaleString('en-US')}`, 8, pt + 18);
  g.fillStyle = ink3;
  g.font = `13px ${mono}`;
  const l = `−${fmt(span / 2, 'Hz', 2)}`,
    rr = `+${fmt(span / 2, 'Hz', 2)}`;
  g.fillText(l, 2, H - 6);
  g.fillText(rr, W - g.measureText(rr).width - 2, H - 6);
  g.fillText('fs', W / 2 - g.measureText('fs').width / 2, H - 6);
}

export type { State };
