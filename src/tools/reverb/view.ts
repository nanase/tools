/**
 * 残響のページの図（canvas）: 上から見た部屋（波面・反射の経路・音源と聞き手）と、インパルス応答のグラフ。
 * 色はページの色の変数から読む
 */
import { fronts, type Images, path } from './image';
import { EARLY_S } from './ir';
import { C0, type Face, materialOf, NB, OPEN, type Room } from './room';

/** 色（テーマが変わるたびに読み直す） */
interface Pal {
  ink: string;
  ink2: string;
  ink3: string;
  ch1: string;
  ch2: string;
  grid: string;
  grid2: string;
  warn: string;
  accent: string;
  screen: string;
  sans: string;
  mono: string;
}
let pal: Pal | null = null;
function colors(): Pal {
  if (pal) return pal;
  const s = getComputedStyle(document.documentElement),
    v = (k: string) => s.getPropertyValue(k).trim();
  pal = {
    ink: v('--ink'),
    ink2: v('--ink-2'),
    ink3: v('--ink-3'),
    ch1: v('--ch1'),
    ch2: v('--ch2'),
    grid: v('--grid'),
    grid2: v('--grid-2'),
    warn: v('--warn'),
    accent: v('--accent'),
    screen: v('--screen'),
    sans: v('--sans'),
    mono: v('--mono'),
  };
  return pal;
}
/** テーマの切り替えで色を読み直す */
export function watchTheme(redraw: () => void): void {
  const reset = () => {
    pal = null;
    redraw();
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', reset);
  new MutationObserver(reset).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

/** canvas の画素を表示の大きさに合わせる（高さは幅 ÷ data-ar） */
export function fitCanvas(cv: HTMLCanvasElement): number {
  const ar = Number(cv.dataset.ar),
    w = cv.clientWidth,
    dpr = Math.min(2, devicePixelRatio || 1),
    W = Math.round(w * dpr),
    H = Math.round((w / ar) * dpr);
  if (cv.style.aspectRatio !== String(ar)) cv.style.aspectRatio = String(ar);
  if (cv.width !== W || cv.height !== H) {
    cv.width = W;
    cv.height = H;
  }
  return dpr;
}

/* ---------- 上から見た部屋 ---------- */

/** 部屋の座標 [m] と canvas の画素の対応 */
export interface RoomView {
  k: number;
  X: (x: number) => number;
  Y: (y: number) => number;
  ix: (px: number) => number;
  iy: (py: number) => number;
}
export function roomView(W: number, H: number, r: Room, pad: number): RoomView {
  const [Lx, Ly] = r.dim,
    k = Math.min((W - 2 * pad) / Lx, (H - 2 * pad) / Ly),
    ox = (W - Lx * k) / 2,
    oy = (H + Ly * k) / 2;
  return { k, X: (x) => ox + x * k, Y: (y) => oy - y * k, ix: (px) => (px - ox) / k, iy: (py) => (oy - py) / k };
}

/** 壁の描き方: 500 Hz の吸音率で 硬い・中・吸う・開放 */
export type WallKind = 'hard' | 'mid' | 'soft' | 'open';
export function wallKind(m: string): WallKind {
  if (m === OPEN) return 'open';
  const a = materialOf(m).a[2];
  return a > 0.4 ? 'soft' : a > 0.12 ? 'mid' : 'hard';
}

/** 図の縦横比（部屋の縦横比に合わせ、横長 2:1〜縦長 1:1.25 に収める） */
export const roomAspect = (r: Room): number => Math.min(2, Math.max(0.8, r.dim[0] / r.dim[1]));

export interface RoomDraw {
  room: Room;
  im: Images;
  /** 音源が鳴ってからの時刻 [s] */
  t: number;
  /** 経路を光らせる時間 [s] */
  glow: number;
  /** 選んだ反射（鏡像の番号。なければ −1） */
  pick: number;
  /** つかんでいる点 */
  hot: 'src' | 'rcv' | null;
}

export function drawRoom(cv: HTMLCanvasElement, o: RoomDraw): RoomView {
  const dpr = fitCanvas(cv),
    g = cv.getContext('2d') as CanvasRenderingContext2D,
    W = cv.width,
    H = cv.height,
    p = colors(),
    { room: r, im, t } = o,
    v = roomView(W, H, r, 22 * dpr),
    [Lx, Ly] = r.dim;
  g.clearRect(0, 0, W, H);
  /* 方眼（1 m か 5 m） */
  const step = Math.max(Lx, Ly) > 25 ? 5 : 1;
  g.strokeStyle = p.grid;
  g.lineWidth = 1;
  g.beginPath();
  for (let x = 0; x <= Lx + 1e-9; x += step) {
    g.moveTo(Math.round(v.X(x)) + 0.5, v.Y(0));
    g.lineTo(Math.round(v.X(x)) + 0.5, v.Y(Ly));
  }
  for (let y = 0; y <= Ly + 1e-9; y += step) {
    g.moveTo(v.X(0), Math.round(v.Y(y)) + 0.5);
    g.lineTo(v.X(Lx), Math.round(v.Y(y)) + 0.5);
  }
  g.stroke();

  /* 波面: 鏡像の円を部屋で切る。明るさは反射で弱まった割合 */
  const R = C0 * t;
  g.save();
  g.beginPath();
  g.rect(v.X(0), v.Y(Ly), Lx * v.k, Ly * v.k);
  g.clip();
  for (const f of fronts(r, im, t)) {
    if (f.order > 4) continue;
    const b = Math.min(1, f.amp * Math.max(R, 1e-3));
    if (b < 0.05) continue;
    g.globalAlpha = Math.min(1, (0.9 * b ** 1.5) / (1 + 0.6 * f.order));
    g.strokeStyle = f.order === 0 ? p.ch1 : p.ch2;
    g.lineWidth = (f.order === 0 ? 2.2 : f.order === 1 ? 1.6 : 1) * dpr;
    g.beginPath();
    g.arc(v.X(f.x), v.Y(f.y), f.rho * v.k, 0, 2 * Math.PI);
    g.stroke();
  }
  g.restore();
  g.globalAlpha = 1;

  /* 壁 */
  const segs: Record<'w' | 'e' | 's' | 'n', [number, number, number, number]> = {
    w: [0, 0, 0, Ly],
    e: [Lx, 0, Lx, Ly],
    s: [0, 0, Lx, 0],
    n: [0, Ly, Lx, Ly],
  };
  g.lineCap = 'round';
  for (const f of ['w', 'e', 's', 'n'] as const) {
    const k = wallKind(r.mat[f]),
      [x1, y1, x2, y2] = segs[f];
    g.beginPath();
    g.moveTo(v.X(x1), v.Y(y1));
    g.lineTo(v.X(x2), v.Y(y2));
    if (k === 'open') {
      g.strokeStyle = p.grid2;
      g.lineWidth = 1 * dpr;
      g.setLineDash([2 * dpr, 5 * dpr]);
    } else {
      g.strokeStyle = k === 'hard' ? p.ink : p.ink3;
      g.lineWidth = (k === 'hard' ? 4 : k === 'mid' ? 3 : 2.4) * dpr;
      g.setLineDash(k === 'soft' ? [5 * dpr, 3 * dpr] : []);
    }
    g.stroke();
    g.setLineDash([]);
  }
  g.lineCap = 'butt';

  /* 反射の経路: 届いたばかりの反射（3 回まで）を光らせる。選んだ反射は太く */
  if (o.pick < 0) {
    const show: [number, number][] = [];
    for (let i = 1; i < im.n && im.t[i] <= t; i++) {
      const d = t - im.t[i];
      if (d < o.glow && im.order[i] <= 3) show.push([i, 1 - d / o.glow]);
    }
    show.sort((a, b) => im.amp[b[0] * NB + 2] - im.amp[a[0] * NB + 2]);
    for (const [i, f] of show.slice(0, 6)) strokePath(g, v, r, im, i, p.ch2, 0.15 + 0.6 * f, 1.4 * dpr);
  } else if (o.pick < im.n) strokePath(g, v, r, im, o.pick, p.warn, 1, 2.4 * dpr);

  /* 音源と聞き手 */
  const dot = (q: readonly number[], c: string, lbl: string, hot: boolean) => {
    const x = v.X(q[0]),
      y = v.Y(q[1]);
    if (hot) {
      g.fillStyle = c;
      g.globalAlpha = 0.18;
      g.beginPath();
      g.arc(x, y, 15 * dpr, 0, 2 * Math.PI);
      g.fill();
      g.globalAlpha = 1;
    }
    g.fillStyle = c;
    g.beginPath();
    g.arc(x, y, 6.5 * dpr, 0, 2 * Math.PI);
    g.fill();
    g.strokeStyle = p.screen;
    g.lineWidth = 2 * dpr;
    g.stroke();
    g.font = `700 ${11.5 * dpr}px ${p.sans}`;
    const w = g.measureText(lbl).width,
      lx = x + 10 * dpr + w > W - 4 * dpr ? x - 10 * dpr - w : x + 10 * dpr;
    g.fillStyle = c;
    g.fillText(lbl, lx, y - 8 * dpr);
  };
  dot(r.src, p.ch1, '音源', o.hot === 'src');
  dot(r.rcv, p.ch2, '聞き手', o.hot === 'rcv');

  /* 寸法 */
  g.fillStyle = p.ink3;
  g.font = `${10.5 * dpr}px ${p.mono}`;
  g.fillText(`${fmtM(Lx)} × ${fmtM(Ly)} m`, v.X(0), v.Y(0) + 14 * dpr);
  return v;
}
const fmtM = (x: number) => String(Number(x.toPrecision(3)));

function strokePath(
  g: CanvasRenderingContext2D,
  v: RoomView,
  r: Room,
  im: Images,
  i: number,
  col: string,
  alpha: number,
  lw: number,
): void {
  const pts = path(r, im, i);
  g.globalAlpha = alpha;
  g.strokeStyle = col;
  g.lineWidth = lw;
  g.lineJoin = 'round';
  g.beginPath();
  pts.forEach((q, k) => {
    if (k) g.lineTo(v.X(q[0]), v.Y(q[1]));
    else g.moveTo(v.X(q[0]), v.Y(q[1]));
  });
  g.stroke();
  g.fillStyle = col;
  for (const q of pts.slice(1, -1)) {
    g.beginPath();
    g.arc(v.X(q[0]), v.Y(q[1]), 2.6 * (lw / 1.4), 0, 2 * Math.PI);
    g.fill();
  }
  g.globalAlpha = 1;
}

/** i 番目の鏡像の反射が当たる面と回数（軸ごとに 手前の面 |n − p| 回・奥の面 |n| 回） */
export function hits(im: Images, i: number): [Face, number][] {
  const out: [Face, number][] = [],
    F: [Face, Face][] = [
      ['w', 'e'],
      ['s', 'n'],
      ['f', 'c'],
    ];
  for (let a = 0; a < 3; a++) {
    const pp = im.idx[i * 6 + 2 * a],
      n = im.idx[i * 6 + 2 * a + 1],
      near = Math.abs(n - pp),
      far = Math.abs(n);
    if (near) out.push([F[a][0], near]);
    if (far) out.push([F[a][1], far]);
  }
  return out;
}

/* ---------- インパルス応答 ---------- */

export interface IrData {
  h: Float32Array;
  fs: number;
  t0: number;
  /** 減衰曲線 [dB] */
  e: Float64Array;
  /** エコーの時刻（直接音から） [s] */
  echo: number[];
  /** 混合時間（直接音から） [s]。開いた空間は NaN */
  tMix: number;
}

/** グラフの時刻 [s] と画素の対応 */
export interface IrView {
  L: number;
  pw: number;
  T: number;
}

/** 応答のグラフの、時刻の線を除いた絵（応答・表示の幅・大きさ・色が同じ間は描き直さない） */
const irBase = new WeakMap<
  HTMLCanvasElement,
  { d: IrData; T: number; W: number; H: number; p: Pal; img: HTMLCanvasElement }
>();

/** 余白 [CSS px] */
const IR_PAD = { L: 30, R: 8, T: 16, B: 18 };

export function drawIR(
  cv: HTMLCanvasElement,
  d: IrData | null,
  o: { T: number; t: number; pick: number | null },
): IrView | null {
  const dpr = fitCanvas(cv),
    g = cv.getContext('2d') as CanvasRenderingContext2D,
    W = cv.width,
    H = cv.height,
    p = colors();
  g.clearRect(0, 0, W, H);
  if (!d) return null;
  const T = o.T,
    L = IR_PAD.L * dpr,
    Tp = IR_PAD.T * dpr,
    pw = W - L - IR_PAD.R * dpr,
    ph = H - Tp - IR_PAD.B * dpr,
    X = (tt: number) => L + (tt / T) * pw;
  let c = irBase.get(cv);
  if (!c || c.d !== d || c.T !== T || c.W !== W || c.H !== H || c.p !== p) {
    const img = c?.img ?? document.createElement('canvas');
    img.width = W;
    img.height = H;
    irStatic(img.getContext('2d') as CanvasRenderingContext2D, d, T, W, H, dpr, p);
    c = { d, T, W, H, p, img };
    irBase.set(cv, c);
  }
  g.drawImage(c.img, 0, 0);
  /* 選んだ反射・今の時刻 */
  if (o.pick !== null && o.pick <= T) {
    const x = X(o.pick);
    g.strokeStyle = p.warn;
    g.lineWidth = 2 * dpr;
    g.beginPath();
    g.moveTo(x, Tp);
    g.lineTo(x, Tp + ph);
    g.stroke();
  } else if (o.t >= 0 && o.t <= T) {
    const x = X(o.t);
    g.strokeStyle = p.accent;
    g.lineWidth = 1.5 * dpr;
    g.beginPath();
    g.moveTo(x, Tp);
    g.lineTo(x, Tp + ph);
    g.stroke();
  }
  return { L, pw, T };
}

function irStatic(g: CanvasRenderingContext2D, d: IrData, T: number, W: number, H: number, dpr: number, p: Pal): void {
  const { h, fs, t0 } = d,
    L = IR_PAD.L * dpr,
    Rm = IR_PAD.R * dpr,
    Tp = IR_PAD.T * dpr,
    pw = W - L - Rm,
    ph = H - Tp - IR_PAD.B * dpr,
    X = (tt: number) => L + (tt / T) * pw,
    Y = (db: number) => Tp + (-db / 60) * ph;
  g.clearRect(0, 0, W, H);
  /* 目盛り */
  g.strokeStyle = p.grid;
  g.lineWidth = 1;
  g.fillStyle = p.ink3;
  g.font = `${10 * dpr}px ${p.mono}`;
  g.textAlign = 'right';
  for (const db of [0, -20, -40, -60]) {
    g.beginPath();
    g.moveTo(L, Math.round(Y(db)) + 0.5);
    g.lineTo(W - Rm, Math.round(Y(db)) + 0.5);
    g.stroke();
    g.fillText(db ? `−${-db}` : '0', L - 4 * dpr, Y(db) + 3.5 * dpr);
  }
  g.textAlign = 'left';
  const st = T > 2 ? 0.5 : T > 1 ? 0.2 : T > 0.4 ? 0.1 : T > 0.2 ? 0.05 : 0.02;
  for (let x = 0; x <= T + 1e-9; x += st) {
    g.beginPath();
    g.moveTo(Math.round(X(x)) + 0.5, Tp);
    g.lineTo(Math.round(X(x)) + 0.5, Tp + ph);
    g.stroke();
    if (X(x) < W - 34 * dpr)
      g.fillText(T > 1 ? `${x.toFixed(1)} s` : `${Math.round(x * 1000)} ms`, X(x) + 3 * dpr, H - 5 * dpr);
  }
  /* 初期反射の帯（直接音から 80 ms） */
  const xe = X(Math.min(T, t0 + EARLY_S));
  g.fillStyle = p.ch2;
  g.globalAlpha = 0.07;
  g.fillRect(X(t0), Tp, xe - X(t0), ph);
  g.globalAlpha = 1;
  g.strokeStyle = p.ink3;
  g.setLineDash([3 * dpr, 3 * dpr]);
  g.beginPath();
  g.moveTo(xe, Tp);
  g.lineTo(xe, Tp + ph);
  g.stroke();
  g.setLineDash([]);
  /* 混合時間の印 */
  if (Number.isFinite(d.tMix) && t0 + d.tMix < T) {
    const x = X(t0 + d.tMix);
    g.fillStyle = p.ink3;
    g.beginPath();
    g.moveTo(x, Tp + ph);
    g.lineTo(x - 4 * dpr, Tp + ph + 6 * dpr);
    g.lineTo(x + 4 * dpr, Tp + ph + 6 * dpr);
    g.fill();
  }
  /* 応答（列ごとの |h| の最大を dB で） */
  let m = 0;
  for (const x of h) m = Math.max(m, Math.abs(x));
  const n = Math.min(h.length, Math.round(T * fs)),
    cols = Math.floor(pw);
  if (m > 0)
    for (let c = 0; c < cols; c++) {
      const a = Math.floor((c / cols) * n),
        b = Math.max(a + 1, Math.floor(((c + 1) / cols) * n));
      let mx = 0;
      for (let i = a; i < b; i++) mx = Math.max(mx, Math.abs(h[i]));
      if (!mx) continue;
      const db = Math.max(-60, 20 * Math.log10(mx / m)),
        tt = a / fs;
      g.strokeStyle = tt <= t0 + 0.0015 ? p.ch1 : tt - t0 <= EARLY_S ? p.ch2 : p.ink3;
      g.beginPath();
      g.moveTo(L + c + 0.5, Tp + ph);
      g.lineTo(L + c + 0.5, Y(db));
      g.stroke();
    }
  /* 減衰曲線 */
  g.strokeStyle = p.ink;
  g.lineWidth = 1.4 * dpr;
  g.beginPath();
  for (let c = 0; c < cols; c++) {
    const i = Math.min(d.e.length - 1, Math.floor((c / cols) * n)),
      db = Math.max(-60, d.e[i]);
    if (c) g.lineTo(L + c, Y(db));
    else g.moveTo(L + c, Y(db));
  }
  g.stroke();
  /* エコー */
  g.font = `700 ${10.5 * dpr}px ${p.sans}`;
  for (const dt of d.echo) {
    const x = X(t0 + dt);
    if (x > W - Rm) continue;
    g.fillStyle = p.warn;
    g.beginPath();
    g.moveTo(x, Tp);
    g.lineTo(x - 5 * dpr, Tp - 8 * dpr);
    g.lineTo(x + 5 * dpr, Tp - 8 * dpr);
    g.fill();
    g.fillText('エコー', x + 7 * dpr, Tp - 2 * dpr);
  }
}
