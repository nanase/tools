/**
 * 雷鳴のページの図（canvas）: 横から見た断面・届く量の分布・波形・スペクトル。
 * 重い部分（放電路の点・波形）は裏の canvas に一度だけ描き、光らせている間は波面・届いている所・再生の線だけを重ねる
 */
import type { Reply } from './worker';

/** 色（CSS の変数から読む） */
export interface Pal {
  screen: string;
  ink: string;
  ink3: string;
  grid: string;
  grid2: string;
  ch1: string;
  ch2: string;
  accent: string;
  sky: string;
  cloud: string;
  earth: string;
  hill: string;
  flash: string;
  mono: string;
}
export function palette(el: Element): Pal {
  const cs = getComputedStyle(el),
    v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    screen: v('--screen'),
    ink: v('--ink'),
    ink3: v('--ink-3'),
    grid: v('--grid'),
    grid2: v('--grid-2'),
    ch1: v('--ch1'),
    ch2: v('--ch2'),
    accent: v('--accent'),
    sky: v('--th-sky'),
    cloud: v('--th-cloud'),
    earth: v('--th-earth'),
    hill: v('--th-hill'),
    flash: v('--th-flash'),
    mono: v('--mono'),
  };
}

const rgb = (h: string): [number, number, number] => {
  const s = h.replace('#', ''),
    v = Number.parseInt(s.length === 3 ? [...s].map((c) => c + c).join('') : s, 16);
  return [v >> 16, (v >> 8) & 255, v & 255];
};
/** a と b の間の色（u = 0 で a） */
const mix = (a: string, b: string, u: number): string => {
  const x = rgb(a),
    y = rgb(b);
  return `rgb(${x.map((c, i) => Math.round(c + (y[i] - c) * u)).join(',')})`;
};

/** canvas の大きさを CSS の幅と決めた高さ [px] に合わせる（高さは data-h に覚え、height 属性は画素数に使う） */
export function sizeCanvas(cv: HTMLCanvasElement, h: number): [CanvasRenderingContext2D, number, number] {
  const dpr = devicePixelRatio || 1,
    w = cv.clientWidth,
    W = Math.max(1, Math.round(w * dpr)),
    H = Math.max(1, Math.round(h * dpr));
  if (cv.style.height !== `${h}px`) cv.style.height = `${h}px`;
  if (cv.width !== W || cv.height !== H) {
    cv.width = W;
    cv.height = H;
  }
  const g = cv.getContext('2d') as CanvasRenderingContext2D;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return [g, w, h];
}

/** 裏の canvas（同じ鍵なら描き直さない） */
class Layer {
  readonly cv = document.createElement('canvas');
  private key = '';
  /** 鍵が変わったときだけ draw を呼ぶ。w・h は CSS の px */
  get(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
    const dpr = devicePixelRatio || 1,
      k = `${key}|${w}|${h}|${dpr}`;
    if (k !== this.key) {
      this.key = k;
      this.cv.width = Math.max(1, Math.round(w * dpr));
      this.cv.height = Math.max(1, Math.round(h * dpr));
      const g = this.cv.getContext('2d') as CanvasRenderingContext2D;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(g);
    }
    return this.cv;
  }
}

/* ---------- 断面 ---------- */

/** 断面の座標の窓: x は落雷点から [m]、z は高さ [m] */
export interface View {
  x0: number;
  x1: number;
  z1: number;
  w: number;
  h: number;
  sx(x: number): number;
  sz(z: number): number;
  /** 画面の x [px] から距離 [m] */
  ix(px: number): number;
  kx: number;
  kz: number;
}
const PADL = 34,
  PADR = 14,
  GROUND = 20,
  TOP = 8;
/** 窓の右端: 聞き手（と山）が入り、地面をドラッグして少し先まで動かせる幅 */
export function sectionView(w: number, h: number, d: number, back: number, xmin: number, xmax: number): View {
  const x0 = Math.min(-1500, xmin - 300),
    x1 = Math.max(3500, xmax + 300, (d + back + 300) * 1.25),
    z1 = 4000,
    kx = (w - PADL - PADR) / (x1 - x0),
    kz = (h - GROUND - TOP) / z1;
  return {
    x0,
    x1,
    z1,
    w,
    h,
    kx,
    kz,
    sx: (x) => PADL + (x - x0) * kx,
    sz: (z) => h - GROUND - z * kz,
    ix: (px) => x0 + (px - PADL) / kx,
  };
}

/** 放電路の点を、届く時刻の順に並べたもの（光らせている間に今届く所を探す） */
export interface Pts {
  n: number;
  t: Float64Array;
  x: Float32Array;
  z: Float32Array;
  t0: number;
  t1: number;
}
export function directPts(r: Reply): Pts {
  const idx: number[] = [];
  for (let i = 0; i < r.ev.length; i++) if (r.ev[i] === 0) idx.push(i);
  idx.sort((a, b) => r.et[a] - r.et[b]);
  const n = idx.length,
    t = new Float64Array(n),
    x = new Float32Array(n),
    z = new Float32Array(n);
  idx.forEach((i, k) => {
    t[k] = r.et[i];
    x[k] = r.exz[2 * i];
    z[k] = r.exz[2 * i + 1];
  });
  return { n, t, x, z, t0: n ? t[0] : 0, t1: n ? t[n - 1] : 0 };
}
/** 時刻 t より前に届く点の数 */
const lower = (a: Float64Array, t: number): number => {
  let lo = 0,
    hi = a.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (a[m] < t) lo = m + 1;
    else hi = m;
  }
  return lo;
};

/** 届く時刻の色の段数 */
const NC = 24;
/** 今届いている所とみなす幅 [s] */
export const NOW = 0.06;

export interface Section {
  r: Reply;
  pts: Pts;
  view: View;
  base: number;
  dist: number;
  hill: { x: number; h: number } | null;
  pal: Pal;
  /** 波面の音速 [m/s] */
  c: number;
}
export interface Live {
  /** 光ってからの時間 [s]（null は止まっている） */
  tau: number | null;
  drag: boolean;
}

const sectionLayer = new Layer();
export function drawSection(cv: HTMLCanvasElement, s: Section, lv: Live, key: string): void {
  const [g, w, h] = sizeCanvas(cv, s.view.h),
    v = s.view,
    p = s.pal;
  const bg = sectionLayer.get(key, w, h, (b) => {
    b.fillStyle = p.sky;
    b.fillRect(0, 0, w, h);
    b.fillStyle = p.cloud;
    b.fillRect(0, 0, w, v.sz(s.base));
    /* 高さの目盛り */
    b.strokeStyle = p.grid;
    b.lineWidth = 1;
    b.font = `11px ${p.mono}`;
    b.fillStyle = p.ink3;
    for (let k = 1; k * 1000 <= v.z1; k++) {
      const y = Math.round(v.sz(k * 1000)) + 0.5;
      b.beginPath();
      b.moveTo(PADL, y);
      b.lineTo(w, y);
      b.stroke();
      b.fillText(`${k} km`, 2, y + 4);
    }
    /* 放電路: 届く時刻で塗る（黄が早く、青が遅い） */
    const span = Math.max(s.pts.t1 - s.pts.t0, 1e-3),
      cols = Array.from({ length: NC }, (_, k) => mix(p.ch1, p.ch2, k / (NC - 1))),
      bins: number[][] = cols.map(() => []);
    for (let i = 0; i < s.pts.n; i++) bins[Math.min(NC - 1, Math.floor(((s.pts.t[i] - s.pts.t0) / span) * NC))].push(i);
    bins.forEach((L, k) => {
      b.fillStyle = cols[k];
      for (const i of L) b.fillRect(v.sx(s.pts.x[i]) - 0.9, v.sz(s.pts.z[i]) - 0.9, 1.8, 1.8);
    });
  });
  g.drawImage(bg, 0, 0, w, h);
  /* 波面: 放電路の頂点から半径 c·τ（縦横の縮尺が違うので楕円） */
  if (lv.tau != null && lv.tau > 0) {
    const r = s.c * lv.tau;
    g.strokeStyle = p.ch2;
    g.globalAlpha = 0.08;
    g.lineWidth = 1;
    for (const br of s.r.branches)
      for (let i = 0; i < br.p.length; i += 3 * 12) {
        g.beginPath();
        g.ellipse(v.sx(br.p[i]), v.sz(br.p[i + 2]), r * v.kx, r * v.kz, 0, 0, 2 * Math.PI);
        g.stroke();
      }
    g.globalAlpha = 1;
    /* 今届いている所 */
    const a = lower(s.pts.t, lv.tau - NOW),
      e = lower(s.pts.t, lv.tau + NOW);
    g.fillStyle = p.accent;
    for (let i = a; i < e; i++) g.fillRect(v.sx(s.pts.x[i]) - 1.8, v.sz(s.pts.z[i]) - 1.8, 3.6, 3.6);
  }
  /* 地面と山 */
  const gy = v.sz(0);
  g.fillStyle = p.earth;
  g.fillRect(0, gy, w, h - gy);
  if (s.hill) {
    const hx = v.sx(s.hill.x),
      top = v.sz(s.hill.h);
    g.fillStyle = p.hill;
    g.beginPath();
    g.moveTo(hx, gy);
    g.lineTo(hx, top);
    g.lineTo(hx + Math.max(10, (gy - top) * 1.5), gy);
    g.closePath();
    g.fill();
  }
  /* 距離の目盛り（地面の中） */
  g.font = `10px ${p.mono}`;
  g.fillStyle = p.ink3;
  const stp = niceStep(v.x1 - v.x0);
  for (let x = 0; x <= v.x1 && v.sx(x) < w - 36; x += stp) g.fillText(`${x / 1000}`, v.sx(x) - 3, h - 5);
  g.fillText('km', w - 22, h - 5);
  /* 落雷点 */
  g.fillStyle = p.ink;
  g.fillRect(v.sx(0) - 1, gy, 2, 5);
  /* 光った瞬間 */
  if (lv.tau != null && lv.tau < 0.25) {
    g.fillStyle = p.flash;
    g.globalAlpha = 0.85 * (1 - lv.tau / 0.25);
    g.fillRect(0, 0, w, h);
    g.globalAlpha = 1;
  }
  /* 聞き手 */
  const lx = v.sx(s.dist);
  g.fillStyle = p.accent;
  g.beginPath();
  g.arc(lx, gy - 5, lv.drag ? 7 : 5, 0, 2 * Math.PI);
  g.fill();
  g.strokeStyle = p.accent;
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(lx - 14, gy - 5);
  g.lineTo(lx - 9, gy - 5);
  g.moveTo(lx + 9, gy - 5);
  g.lineTo(lx + 14, gy - 5);
  g.stroke();
  g.font = `600 11.5px ${p.mono}`;
  g.fillStyle = p.ink;
  const lab = `${fmtKm(s.dist)} km`,
    tw = g.measureText(lab).width;
  g.fillText(lab, Math.min(lx + 16, w - tw - 4), gy - 12);
}
const niceStep = (span: number): number => {
  const raw = span / 6,
    e = 10 ** Math.floor(Math.log10(raw)),
    m = raw / e;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * e;
};
export const fmtKm = (m: number): string =>
  m < 1000 ? (m / 1000).toFixed(2) : m < 10000 ? (m / 1000).toFixed(1) : (m / 1000).toFixed(0);

/* ---------- 届く量と波形（時間の軸は光った時刻から） ---------- */

export interface Track {
  r: Reply;
  pal: Pal;
  /** 横軸の右端 [s] */
  t1: number;
}
const tx = (t: number, t1: number, w: number) => (t / t1) * w;

const histLayer = new Layer();
export function drawHist(cv: HTMLCanvasElement, h: number, s: Track, tau: number | null, key: string): void {
  const [g, w] = sizeCanvas(cv, h),
    p = s.pal,
    r = s.r;
  const bg = histLayer.get(key, w, h, (b) => {
    b.fillStyle = p.screen;
    b.fillRect(0, 0, w, h);
    const H = r.hist,
      n = H[0].length;
    let mx = 1e-30;
    for (let k = 0; k < n; k++) mx = Math.max(mx, H[0][k] + H[1][k] + H[2][k] + H[3][k]);
    const bw = Math.max(tx(r.dt, s.t1, w), 0.7),
      top = 14,
      hh = h - top - 2;
    for (let k = 0; k < n; k++) {
      const a = H[0][k] / mx,
        q = (H[1][k] + H[2][k] + H[3][k]) / mx,
        x = tx(r.h0 + k * r.dt, s.t1, w);
      b.fillStyle = p.ch2;
      b.fillRect(x, h - 2 - a * hh, bw, a * hh);
      b.fillStyle = p.grid2;
      b.fillRect(x, h - 2 - (a + q) * hh, bw, q * hh);
    }
  });
  g.drawImage(bg, 0, 0, w, h);
  cursor(g, tau, s.t1, w, h, p);
}

const waveLayer = new Layer();
export function drawWave(cv: HTMLCanvasElement, h: number, s: Track, tau: number | null, key: string): void {
  const [g, w] = sizeCanvas(cv, h),
    p = s.pal,
    r = s.r;
  const bg = waveLayer.get(key, w, h, (b) => {
    const y = r.y,
      pk = r.peak || 1,
      mid = (h - 14) / 2,
      amp = mid - 3,
      first = tx(r.first, s.t1, w);
    b.fillStyle = p.screen;
    b.fillRect(0, 0, w, h);
    /* 光ってから最初の音まで */
    b.fillStyle = p.grid;
    b.fillRect(0, 0, first, h - 14);
    b.strokeStyle = p.grid2;
    b.lineWidth = 1;
    b.beginPath();
    b.moveTo(0, Math.round(mid) + 0.5);
    b.lineTo(w, Math.round(mid) + 0.5);
    b.stroke();
    b.strokeStyle = p.ch1;
    b.beginPath();
    for (let px = 0; px < w; px++) {
      const a = Math.floor(((px / w) * s.t1 - r.t0) * r.fs),
        e = Math.floor((((px + 1) / w) * s.t1 - r.t0) * r.fs);
      if (e < 0 || a >= y.length) continue;
      let lo = 0,
        hi = 0;
      for (let i = Math.max(0, a); i < Math.min(y.length, e + 1); i++) {
        if (y[i] < lo) lo = y[i];
        if (y[i] > hi) hi = y[i];
      }
      b.moveTo(px + 0.5, mid - (hi / pk) * amp);
      b.lineTo(px + 0.5, mid - (lo / pk) * amp + 0.5);
    }
    b.stroke();
    /* 時間の目盛り */
    b.font = `10px ${p.mono}`;
    b.fillStyle = p.ink3;
    const stp = s.t1 > 60 ? 10 : s.t1 > 24 ? 5 : s.t1 > 10 ? 2 : 1;
    for (let t = 0; t <= s.t1; t += stp) {
      const x = tx(t, s.t1, w);
      b.fillRect(x, h - 14, 1, 3);
      if (x < w - 30) b.fillText(`${t}`, x + 2, h - 3);
    }
    b.fillText('s', w - 10, h - 3);
    if (first > 90) {
      b.font = `11px ${p.mono}`;
      b.fillStyle = p.ink3;
      b.fillText(`光ってから ${r.first.toFixed(1)} s`, 6, 14);
    }
  });
  g.drawImage(bg, 0, 0, w, h);
  cursor(g, tau, s.t1, w, h - 14, p);
}
function cursor(g: CanvasRenderingContext2D, tau: number | null, t1: number, w: number, h: number, p: Pal): void {
  if (tau == null) return;
  const x = tx(tau, t1, w);
  g.fillStyle = p.accent;
  g.globalAlpha = 0.18;
  g.fillRect(tx(tau - NOW, t1, w), 0, tx(2 * NOW, t1, w), h);
  g.globalAlpha = 1;
  g.fillRect(x - 0.75, 0, 1.5, h);
}

/* ---------- スペクトル ---------- */

/** 横軸の範囲 [Hz]（対数） */
const F0 = 5,
  F1 = 2000;
export function drawSpectrum(cv: HTMLCanvasElement, h: number, r: Reply, pal: Pal, peakHz: number): void {
  const [g, w] = sizeCanvas(cv, h),
    L = 30,
    B = 16,
    fx = (f: number) => L + (Math.log(f / F0) / Math.log(F1 / F0)) * (w - L - 6),
    top = 6,
    span = 60,
    hh = h - B - top;
  g.fillStyle = pal.screen;
  g.fillRect(0, 0, w, h);
  let mx = Number.NEGATIVE_INFINITY;
  for (let k = 1; k < r.sf.length && r.sf[k] <= F1; k++) if (r.sf[k] >= F0) mx = Math.max(mx, r.sdb[k]);
  const fy = (db: number) => top + (Math.min(0, Math.max(-span, db - mx)) / -span) * hh;
  /* 目盛り */
  g.strokeStyle = pal.grid;
  g.lineWidth = 1;
  g.font = `10px ${pal.mono}`;
  g.fillStyle = pal.ink3;
  for (const f of [10, 20, 50, 100, 200, 500, 1000, 2000]) {
    const x = Math.round(fx(f)) + 0.5;
    g.beginPath();
    g.moveTo(x, top);
    g.lineTo(x, top + hh);
    g.stroke();
    g.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x - 6, h - 4);
  }
  for (let d = 0; d <= span; d += 20) {
    const y = Math.round(fy(mx - d)) + 0.5;
    g.beginPath();
    g.moveTo(L, y);
    g.lineTo(w - 6, y);
    g.stroke();
    g.fillText(d ? `−${d}` : '0', 2, y + 4);
  }
  /* 帯ごとに平らにならす（1/12 オクターブの平均） */
  g.strokeStyle = pal.ch1;
  g.lineWidth = 1.6;
  g.beginPath();
  let first = true;
  for (let f = F0; f <= F1; f *= 2 ** (1 / 24)) {
    const a = f * 2 ** (-1 / 24),
      b = f * 2 ** (1 / 24);
    let s = 0,
      c = 0;
    for (let k = 1; k < r.sf.length; k++) {
      if (r.sf[k] < a) continue;
      if (r.sf[k] > b) break;
      s += 10 ** (r.sdb[k] / 10);
      c++;
    }
    if (!c) continue;
    const x = fx(f),
      y = fy(10 * Math.log10(s / c));
    if (first) g.moveTo(x, y);
    else g.lineTo(x, y);
    first = false;
  }
  g.stroke();
  if (peakHz > 0) {
    const x = fx(peakHz);
    g.fillStyle = pal.accent;
    g.fillRect(x - 0.75, top, 1.5, hh);
  }
}

/** スペクトルのいちばん高い所 [Hz]（1/6 オクターブでならす） */
export function spectrumPeak(r: Reply): number {
  let best = 0,
    bf = 0;
  for (let f = 8; f <= 1000; f *= 2 ** (1 / 24)) {
    const a = f * 2 ** (-1 / 12),
      b = f * 2 ** (1 / 12);
    let s = 0,
      c = 0;
    for (let k = 1; k < r.sf.length; k++) {
      if (r.sf[k] < a) continue;
      if (r.sf[k] > b) break;
      s += 10 ** (r.sdb[k] / 10);
      c++;
    }
    if (c && s / c > best) {
      best = s / c;
      bf = f;
    }
  }
  return bf;
}
