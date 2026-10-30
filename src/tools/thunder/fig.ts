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
  echo: string;
  wall: string;
  roof: string;
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
    echo: v('--th-echo'),
    wall: v('--th-wall'),
    roof: v('--th-roof'),
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

/** 放電路の点を、届く時刻の順に並べたもの（光らせている間に今届く所を探す）。経路ごとに作る */
export interface Pts {
  n: number;
  t: Float64Array;
  x: Float32Array;
  z: Float32Array;
  t0: number;
  t1: number;
}
export function arrivalPts(r: Reply, vias: readonly number[]): Pts {
  const idx: number[] = [];
  for (let i = 0; i < r.ev.length; i++) if (vias.includes(r.ev[i])) idx.push(i);
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
  /** 直接届く点と、山で返って届く点 */
  pts: Pts;
  echo: Pts;
  view: View;
  base: number;
  dist: number;
  /** 地面で返すか */
  ground: boolean;
  hill: { x: number; h: number } | null;
  /** 止まっているときに道すじを描く放電路の点 [m]（雲の底） */
  src: [number, number];
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
  const gy = v.sz(0),
    lx = v.sx(s.dist),
    ly = gy - 12,
    hx = s.hill ? v.sx(s.hill.x) : w;
  const tau = lv.tau;
  if (tau != null && tau > 0) {
    /* 波面: 放電路の頂点から半径 c·τ（縦横の縮尺が違うので楕円）。地面と山で返った波面は鏡像の点から */
    const r = s.c * tau,
      fronts = (cx: (x: number) => number, cz: (z: number) => number, col: string, al: number) => {
        g.strokeStyle = col;
        g.globalAlpha = al;
        g.lineWidth = 1;
        for (const br of s.r.branches)
          for (let i = 0; i < br.p.length; i += 3 * 12) {
            g.beginPath();
            g.ellipse(cx(br.p[i]), cz(br.p[i + 2]), r * v.kx, r * v.kz, 0, 0, 2 * Math.PI);
            g.stroke();
          }
        g.globalAlpha = 1;
      };
    const clip = (x1: number, f: () => void) => {
      g.save();
      g.beginPath();
      g.rect(0, 0, x1, gy);
      g.clip();
      f();
      g.restore();
    };
    clip(w, () => {
      fronts(v.sx, v.sz, p.ch2, 0.08);
      if (s.ground) fronts(v.sx, (z) => v.sz(-z), p.echo, 0.07);
    });
    const hl = s.hill?.x;
    if (hl != null) clip(hx, () => fronts((x) => v.sx(2 * hl - x), v.sz, p.echo, 0.1));
    /* 今届いている所: 直接の音と、山で返った音 */
    const now = (q: Pts, col: string): [number, number, number] => {
      const a = lower(q.t, tau - NOW),
        e = lower(q.t, tau + NOW);
      let sx = 0,
        sz = 0;
      g.fillStyle = col;
      for (let i = a; i < e; i++) {
        g.fillRect(v.sx(q.x[i]) - 1.8, v.sz(q.z[i]) - 1.8, 3.6, 3.6);
        sx += q.x[i];
        sz += q.z[i];
      }
      return [e - a, sx / Math.max(1, e - a), sz / Math.max(1, e - a)];
    };
    now(s.pts, p.accent);
    if (s.hill) {
      const [n, ex, ez] = now(s.echo, p.echo);
      if (n) echoRay(g, s, ex, ez, p.echo, 0.9, false);
    }
  } else {
    /* 止まっているとき: 聞き手への道すじ（雲の底からの直接の音と、山で返る音） */
    const [x, z] = s.src;
    g.strokeStyle = p.ink3;
    g.globalAlpha = 0.5;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(v.sx(x), v.sz(z));
    g.lineTo(lx, ly);
    g.stroke();
    g.globalAlpha = 1;
    /* 山で返る音は、崖で返れる低い所（山で返って届く点の真ん中の時刻のもの）から */
    const m = s.echo.n >> 1;
    if (s.hill && s.echo.n) echoRay(g, s, s.echo.x[m], s.echo.z[m], p.echo, 0.8, true);
  }
  /* 地面と山 */
  g.fillStyle = p.earth;
  g.fillRect(0, gy, w, h - gy);
  if (s.hill) {
    const top = v.sz(s.hill.h);
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
  /* 落雷点の家（大きさは図の縮尺によらない絵） */
  house(g, v.sx(0), gy, p);
  /* 光った瞬間 */
  if (lv.tau != null && lv.tau < 0.25) {
    g.fillStyle = p.flash;
    g.globalAlpha = 0.85 * (1 - lv.tau / 0.25);
    g.fillRect(0, 0, w, h);
    g.globalAlpha = 1;
  }
  /* 聞き手 */
  person(g, lx, gy, lv.drag ? 1.2 : 1, p.accent);
  g.font = `600 11.5px ${p.mono}`;
  g.fillStyle = p.ink;
  const lab = `${fmtKm(s.dist)} km`,
    tw = g.measureText(lab).width;
  g.fillText(lab, Math.min(lx + 12, w - tw - 4), gy - 16);
}

/** 放電路の点 (x, z) から山の崖で返って聞き手へ届く道すじ（崖より高い所で返るなら描かない） */
function echoRay(
  g: CanvasRenderingContext2D,
  s: Section,
  x: number,
  z: number,
  col: string,
  al: number,
  dash: boolean,
): void {
  if (!s.hill) return;
  const v = s.view,
    H = s.hill.x,
    /* 崖の鏡像 (2H − x, z) と聞き手を結ぶ線が崖を横切る高さ */
    u = (H - (2 * H - x)) / (s.dist - (2 * H - x)),
    zh = z + (0 - z) * u;
  if (zh > s.hill.h || zh < 0) return;
  const hx = v.sx(H) - 1,
    hy = v.sz(zh);
  g.strokeStyle = col;
  g.globalAlpha = al;
  g.lineWidth = 1.2;
  g.setLineDash(dash ? [4, 3] : []);
  g.beginPath();
  g.moveTo(v.sx(x), v.sz(z));
  g.lineTo(hx, hy);
  g.lineTo(v.sx(s.dist), v.sz(0) - 12);
  g.stroke();
  g.setLineDash([]);
  g.globalAlpha = 1;
}

/** 家: 地面の (x, gy) に立つ、幅 24 px の切妻屋根 */
function house(g: CanvasRenderingContext2D, x: number, gy: number, p: Pal): void {
  g.fillStyle = p.wall;
  g.fillRect(x - 9, gy - 12, 18, 12);
  g.fillStyle = p.roof;
  g.beginPath();
  g.moveTo(x - 12.5, gy - 11.5);
  g.lineTo(x, gy - 22);
  g.lineTo(x + 12.5, gy - 11.5);
  g.closePath();
  g.fill();
  g.fillStyle = p.sky;
  g.fillRect(x - 6, gy - 8, 4, 4);
  g.fillRect(x + 2, gy - 8, 3.5, 8);
}

/** 棒人間: 足が地面の (x, gy)、高さ 24 px × k */
function person(g: CanvasRenderingContext2D, x: number, gy: number, k: number, col: string): void {
  g.strokeStyle = col;
  g.fillStyle = col;
  g.lineWidth = 2 * k;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(x, gy - 20.5 * k, 3.5 * k, 0, 2 * Math.PI);
  g.fill();
  g.beginPath();
  g.moveTo(x, gy - 16.5 * k);
  g.lineTo(x, gy - 8 * k);
  g.moveTo(x - 4.5 * k, gy);
  g.lineTo(x, gy - 8 * k);
  g.lineTo(x + 4.5 * k, gy);
  g.moveTo(x - 5.5 * k, gy - 10 * k);
  g.lineTo(x, gy - 14.5 * k);
  g.lineTo(x + 5.5 * k, gy - 10 * k);
  g.stroke();
  g.lineCap = 'butt';
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
      b.fillStyle = p.echo;
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
      pk = r.ypk || 1,
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
