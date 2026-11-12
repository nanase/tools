/**
 * 配線の発熱の図。基板の温度と電流密度、線を横から見た図、周りの空気、経路、温度のグラフ、断面と熱の行き先
 */
import { BD } from './board';
import { PATH_H } from './params';
import { airField, type LinePlume, linePlume, type Outline, type Src } from './plume';
import { type Bal, pathPlumes, type WireSim } from './sim';
import { acFactor, type Path, PVC, rhoAt, roundJ, skinDepth } from './wire';

/* ---------- 色と道具 ---------- */
export const COL = {
  ch1: '',
  ch2: '',
  ink: '',
  ink2: '',
  ink3: '',
  screen: '',
  grid: '',
  grid2: '',
  sink: '',
  warn: '',
  mono: 'monospace',
  sans: 'sans-serif',
};
export function readCols(root: Element): void {
  const c = getComputedStyle(root),
    v = (k: string) => c.getPropertyValue(k).trim();
  Object.assign(COL, {
    ch1: v('--ch1'),
    ch2: v('--ch2'),
    ink: v('--ink'),
    ink2: v('--ink-2'),
    ink3: v('--ink-3'),
    screen: v('--screen'),
    grid: v('--grid'),
    grid2: v('--grid-2'),
    sink: v('--screen-ink'),
    warn: v('--warn'),
    mono: v('--mono') || 'monospace',
    sans: v('--sans') || 'sans-serif',
  });
}
type G = CanvasRenderingContext2D;
/** 温度の色（熱画像の配色）。0 = 気温、1 = 目盛りの上限 */
const HEAT: [number, number[]][] = [
  [0, [40, 48, 110]],
  [0.22, [96, 40, 150]],
  [0.45, [190, 40, 90]],
  [0.68, [235, 100, 30]],
  [0.86, [250, 190, 40]],
  [1, [255, 246, 190]],
];
export function heatRGB(u: number): number[] {
  const x = Math.max(0, Math.min(1, u));
  for (let k = 1; k < HEAT.length; k++)
    if (x <= HEAT[k][0]) {
      const [a, A] = HEAT[k - 1],
        [b, B] = HEAT[k],
        f = (x - a) / (b - a);
      return A.map((v, i) => Math.round(v + (B[i] - v) * f));
    }
  return HEAT[HEAT.length - 1][1];
}
export const heat = (u: number): string => `rgb(${heatRGB(u).join(',')})`;
const rgbOf = (h: string): number[] => {
  const m = h.match(/\d+/g);
  if (h.startsWith('rgb') && m) return m.slice(0, 3).map(Number);
  const x = h.replace('#', '');
  return x.length === 3
    ? [...x].map((c) => Number.parseInt(c + c, 16))
    : [0, 2, 4].map((i) => Number.parseInt(x.slice(i, i + 2), 16));
};
export const mix = (a: string, b: string, u: number): string => {
  const A = rgbOf(a),
    B = rgbOf(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * u)).join(',')})`;
};
const font = (g: G, px: number, w = 500, mono = false) => {
  g.font = `${w} ${px}px ${mono ? COL.mono : COL.sans}`;
};
export function sizeCv(cv: HTMLCanvasElement): { g: G; w: number; h: number } {
  const r = devicePixelRatio || 1,
    w = cv.clientWidth,
    h = cv.clientHeight;
  if (cv.width !== Math.round(w * r) || cv.height !== Math.round(h * r)) {
    cv.width = Math.round(w * r);
    cv.height = Math.round(h * r);
  }
  const g = cv.getContext('2d') as G;
  g.setTransform(r, 0, 0, r, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h };
}
function arrow(g: G, x0: number, y0: number, x1: number, y1: number, s = 6): void {
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
  const l = Math.hypot(x1 - x0, y1 - y0) || 1,
    ux = (x1 - x0) / l,
    uy = (y1 - y0) / l;
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x1 - ux * s - uy * s * 0.6, y1 - uy * s + ux * s * 0.6);
  g.lineTo(x1 - ux * s + uy * s * 0.6, y1 - uy * s - ux * s * 0.6);
  g.closePath();
  g.fill();
}
/** 縁取りした文字（色の上でも読めるように） */
function label(g: G, s: string, x: number, y: number): void {
  g.strokeStyle = COL.screen;
  g.lineWidth = 4;
  g.lineJoin = 'round';
  g.strokeText(s, x, y);
  g.fillText(s, x, y);
}
/** 温度は 0.1 °C 刻み */
export const fmtC = (T: number): string => `${T.toFixed(1)} °C`;
/** 温度の色の目盛り（右端に縦） */
function colorbar(g: G, x: number, y: number, h: number, lo: number, hi: number): void {
  for (let k = 0; k < h; k++) {
    g.fillStyle = heat(1 - k / h);
    g.fillRect(x, y + k, 10, 1.2);
  }
  g.strokeStyle = COL.grid2;
  g.lineWidth = 1;
  g.strokeRect(x + 0.5, y + 0.5, 10, h);
  font(g, 13, 500, true);
  g.fillStyle = COL.sink;
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  label(g, fmtC(hi), x - 4, y + 6);
  label(g, fmtC(lo), x - 4, y + h - 6);
}
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
const ticks = (a: number, b: number, n: number): number[] => {
  const st = 10 ** Math.floor(Math.log10((b - a) / n)),
    m = ([1, 2, 5, 10].find((q) => (b - a) / (q * st) <= n) ?? 10) * st,
    r: number[] = [];
  for (let v = Math.ceil(a / m) * m; v <= b + 1e-9; v += m) r.push(Number(v.toPrecision(6)));
  return r;
};
/** グラフの枠と目盛り。X・Y は値から画面への変換 */
function axes(
  g: G,
  box: Box,
  xa: number,
  xb: number,
  ya: number,
  yb: number,
  xf: (v: number) => string,
  xu: string,
  yu: string,
  xt?: [number, string][],
) {
  const X = (v: number) => box.x + ((v - xa) / (xb - xa)) * box.w,
    Y = (v: number) => box.y + box.h - ((v - ya) / (yb - ya)) * box.h;
  g.strokeStyle = COL.grid;
  g.lineWidth = 1;
  font(g, 13, 500, true);
  g.fillStyle = COL.sink;
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  for (const v of ticks(ya, yb, 4)) {
    g.beginPath();
    g.moveTo(box.x, Y(v));
    g.lineTo(box.x + box.w, Y(v));
    g.stroke();
    g.fillText(String(Math.round(v)), box.x - 5, Y(v));
  }
  g.textAlign = 'center';
  g.textBaseline = 'top';
  for (const [v, s] of xt ??
    ticks(xa, xb, Math.max(2, Math.floor(box.w / 80))).map((v) => [v, xf(v)] as [number, string])) {
    g.beginPath();
    g.moveTo(X(v), box.y);
    g.lineTo(X(v), box.y + box.h);
    g.stroke();
    /* 右端の目盛りは枠からはみ出さないよう右に寄せる */
    g.textAlign = X(v) > box.x + box.w - 18 ? 'right' : 'center';
    if (s) g.fillText(s, Math.min(X(v), box.x + box.w), box.y + box.h + 4);
  }
  font(g, 12, 500);
  g.fillStyle = COL.ink3;
  g.textAlign = 'right';
  g.textBaseline = 'bottom';
  g.fillText(xu, box.x + box.w, box.y + box.h + 34);
  g.textAlign = 'left';
  g.textBaseline = 'top';
  g.fillText(yu, box.x + 4, box.y + 2);
  return { X, Y };
}
function dashLine(g: G, x0: number, x1: number, y: number, col: string): void {
  g.strokeStyle = col;
  g.setLineDash([5, 4]);
  g.lineWidth = 1.4;
  g.beginPath();
  g.moveTo(x0, y);
  g.lineTo(x1, y);
  g.stroke();
  g.setLineDash([]);
}

/* ---------- 時間軸 ---------- */
/**
 * 時間軸。速い溶断（ミリ秒）と遅い冷却（数十分）を 1 本に収めるため、対数に近い目盛りにする。
 * u = ln(1 + t/t0) / ln(1 + te/t0)。t0 より短い所はほぼ等間隔、長い所は対数
 */
export interface TMap {
  t0: number;
  te: number;
  /** 線形（等間隔）の目盛り */
  lin?: boolean;
}
export const uOf = (m: TMap, t: number): number =>
  m.lin ? Math.max(0, t) / m.te : Math.log1p(Math.max(0, t) / m.t0) / Math.log1p(m.te / m.t0);
export const tOf = (m: TMap, u: number): number => {
  const v = Math.max(0, Math.min(1, u));
  return m.lin ? v * m.te : m.t0 * Math.expm1(v * Math.log1p(m.te / m.t0));
};
/** 時刻の短い表記 */
export const fmtTime = (t: number): string =>
  t === 0
    ? '0'
    : t < 1
      ? `${Number((t * 1e3).toPrecision(2))} ms`
      : t < 60
        ? `${Number(t.toPrecision(2))} s`
        : `${Number((t / 60).toPrecision(2))} 分`;
/** 時間軸の目盛り。0 と、1・2・5 の刻みから重ならないものを選ぶ */
function timeTicks(m: TMap, wpx: number): [number, string][] {
  if (m.lin) {
    /* 等間隔: 1・2・5 の刻みで 80 px 以上あける。60 秒より長ければ分の刻み */
    const n = Math.max(2, Math.floor(wpx / 80)),
      unit = m.te >= 120 ? 60 : 1,
      raw = m.te / unit / n,
      st = 10 ** Math.floor(Math.log10(raw)),
      step = ([1, 2, 5, 10].find((q) => q * st >= raw) ?? 10) * st * unit,
      r: [number, string][] = [];
    for (let t = 0; t <= m.te * 1.0001; t += step) r.push([t / m.te, fmtTime(Number(t.toPrecision(6)))]);
    return r;
  }
  const out: [number, string][] = [[0, '0']];
  let lastU = 0;
  for (let e = -4; e <= 4; e++)
    for (const k of [1, 2, 5]) {
      const t = k * 10 ** e,
        u = uOf(m, t);
      if (t > m.te * 1.0001) return out;
      if ((u - lastU) * wpx < 46) continue;
      out.push([u, fmtTime(t)]);
      lastU = u;
    }
  for (const t of [600, 1200, 1800, 3600]) {
    const u = uOf(m, t);
    if (t <= m.te * 1.0001 && (u - lastU) * wpx >= 46) {
      out.push([u, fmtTime(t)]);
      lastU = u;
    }
  }
  return out;
}

/* ---------- 画面の状態 ---------- */
/** 基板の計算の記録（ワーカーから届いた分） */
export interface BoardRec {
  times: number[];
  frames: Float32Array[];
  R: number[];
  /** 流れている電流 [A]（各時刻） */
  Ion: number[];
  maxT: number[];
  bal: Bal[];
  /** 初めの銅箔と、その升の番号。cutAt は升が溶けた時刻（溶けていなければ Infinity） */
  cu: Uint8Array;
  idx: Int32Array;
  cutAt: Float64Array;
  /** パッドの間が切れた時刻と、電流を止めた時刻 */
  tOpen: number | null;
  tOff: number | null;
  V: Float64Array;
  sq: Float64Array;
  tEff: number;
  dl: number;
  t: number;
  done: boolean;
}
export interface Ctx {
  Ta: number;
  /** 色の目盛りの上限 [°C]（「今の最高」では今の時刻の最高）と、記録全体の最高 */
  top: number;
  topAll: number;
  /** 再生位置 [s]、再生の時間軸、グラフの時間軸 */
  pt: number;
  tm: TMap;
  gm: TMap;
  T: Float32Array;
  /** 今の時刻に近い記録の番号 */
  i: number;
  /** 融点・耐熱など、グラフに引く線 [°C, 名前] */
  limits: [number, string][];
  /** 経過の割合を考えた空気の粒の進み [s]（実時間） */
  dt: number;
}
export interface WireOpt {
  shape: 'round' | 'rect';
  d: number;
  t: number;
  surf: string;
  ends: 'sink' | 'free';
  /** 今の電流 [A]（パルスの後は 0）と周波数 */
  I: number;
  f: number;
  wind: number;
}

/* ---------- 空気の粒 ---------- */
/** 粒の動きは実際の 1/10 */
const SLOW = 0.1;
export interface Particle {
  x: number;
  y: number;
  a: number;
}
const fieldCv = typeof document === 'undefined' ? null : document.createElement('canvas');
/** 温度上昇の場を、濃さの変わる熱の色で塗る。fn(列, 行) → 温度上昇 */
function paintField(g: G, box: Box, nx: number, ny: number, fn: (i: number, j: number) => number, span: number): void {
  if (!fieldCv) return;
  fieldCv.width = nx;
  fieldCv.height = ny;
  const c = fieldCv.getContext('2d') as G,
    im = c.createImageData(nx, ny);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const u = fn(i, j) / Math.max(1e-9, span),
        k = (j * nx + i) * 4,
        rgb = heatRGB(u);
      im.data[k] = rgb[0];
      im.data[k + 1] = rgb[1];
      im.data[k + 2] = rgb[2];
      im.data[k + 3] = Math.round(255 * Math.min(1, u * 2.4));
    }
  c.putImageData(im, 0, 0);
  g.imageSmoothingEnabled = true;
  g.drawImage(fieldCv, box.x, box.y, box.w, box.h);
}
/** 粒を動かして描く。vel(x, y) → [vx, vy]（m/s、y は上向き）。alive が偽なら生まれ直す */
function particles(
  g: G,
  list: Particle[],
  n: number,
  spawn: () => { x: number; y: number },
  vel: (x: number, y: number) => [number, number],
  toPx: (x: number, y: number) => [number, number],
  alive: (p: Particle) => boolean,
  dt: number,
): void {
  while (list.length < n) list.push({ ...spawn(), a: Math.random() * 2 });
  g.fillStyle = COL.ch2;
  for (let k = list.length - 1; k >= 0; k--) {
    const p = list[k],
      [vx, vy] = vel(p.x, p.y);
    p.x += vx * dt * SLOW;
    p.y += vy * dt * SLOW;
    p.a += dt;
    if (!alive(p) || p.a > 8) {
      list[k] = { ...spawn(), a: 0 };
      continue;
    }
    const [X, Y] = toPx(p.x, p.y);
    g.globalAlpha = Math.min(1, p.a * 2);
    g.beginPath();
    g.arc(X, Y, 1.6, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

/* ---------- 線を横から ---------- */
export function drawWire(cv: HTMLCanvasElement, s: WireSim, c: Ctx, o: WireOpt, parts: Particle[]): void {
  const { g, w, h } = sizeCv(cv),
    T = c.T,
    N = s.N,
    x0 = 46,
    x1 = w - 62,
    y = h * 0.66,
    span = c.top - c.Ta;
  const th = Math.max(14, Math.min(30, (o.shape === 'round' ? o.d : o.t * 4) * 9 + (o.surf === 'pvc' ? 6 : 0)));
  /* 線の上の空気。区間 2 つごとに、その位置の線のプルームの中心の温度で塗る（高さ 5 cm まで） */
  const H = 0.05,
    yTop = y - th / 2,
    hp = yTop - 14,
    pl: LinePlume[] = [];
  for (let i = 0; i < N; i += 2) pl.push(linePlume(s.L.qc(T[i]), s.L.ts(T[i]) - c.Ta, c.Ta, 0, outerOf(s)));
  paintField(
    g,
    { x: x0, y: 14, w: x1 - x0, h: hp },
    pl.length,
    40,
    (i, j) => pl[i].at(0, H * (1 - (j + 0.5) / 40))[0],
    span,
  );
  const plAt = (x: number) => pl[Math.max(0, Math.min(pl.length - 1, Math.floor((x / s.len) * pl.length)))];
  particles(
    g,
    parts,
    70,
    () => ({ x: Math.random() * s.len, y: Math.random() * 0.004 }),
    (x, yy) => [0, Math.max(0.01, plAt(x).at(0, yy)[1])],
    (x, yy) => [x0 + (x / s.len) * (x1 - x0), yTop - (yy / H) * hp],
    (p) => p.y < H,
    c.dt,
  );
  font(g, 13, 500, true);
  g.fillStyle = COL.sink;
  g.textAlign = 'left';
  g.textBaseline = 'top';
  g.fillText('5 cm 上まで', x0 + 4, 16);
  /* 端子 */
  g.strokeStyle = COL.sink;
  g.lineWidth = 1.4;
  for (const x of [x0 - 30, x1]) {
    if (o.ends === 'sink') {
      g.fillStyle = COL.sink;
      g.fillRect(x, y - 26, 30, 52);
    } else {
      g.setLineDash([4, 3]);
      g.strokeRect(x + 0.5, y - 26, 29, 52);
      g.setLineDash([]);
    }
  }
  /* 線（区間ごとの温度の色） */
  const cw = (x1 - x0) / N;
  for (let i = 0; i < N; i++) {
    g.fillStyle = heat((T[i] - c.Ta) / span);
    g.fillRect(x0 + i * cw - 0.3, y - th / 2, cw + 0.6, th);
  }
  if (o.surf === 'pvc') {
    g.strokeStyle = COL.ink3;
    g.lineWidth = 3;
    g.strokeRect(x0, y - th / 2 - 1.5, x1 - x0, th + 3);
  }
  g.strokeStyle = COL.grid2;
  g.lineWidth = 1;
  g.strokeRect(x0 + 0.5, y - th / 2 + 0.5, x1 - x0 - 1, th - 1);
  /* 溶けて切れた所 */
  const broken = s.cut !== null && s.tMelt !== null && c.pt >= s.tMelt;
  if (broken && s.cut !== null) {
    const xc = x0 + (s.cut + 1) * cw;
    g.fillStyle = COL.screen;
    g.fillRect(xc - 4, y - th / 2 - 2, 8, th + 4);
    g.strokeStyle = COL.warn;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(xc - 4, y - th / 2 - 2);
    g.lineTo(xc - 4, y + th / 2 + 2);
    g.moveTo(xc + 4, y - th / 2 - 2);
    g.lineTo(xc + 4, y + th / 2 + 2);
    g.stroke();
  }
  /* 放射（局所の放射の大きさで長さを変える） */
  let qmax = 1e-12;
  for (let i = 0; i < N; i++) qmax = Math.max(qmax, s.L.q(T[i]));
  const nA = Math.max(5, Math.min(12, Math.floor((x1 - x0) / 60)));
  g.strokeStyle = COL.ch1;
  g.fillStyle = COL.ch1;
  g.lineWidth = 1.6;
  for (let k = 0; k < nA; k++) {
    const u = (k + 0.5) / nA,
      i = Math.min(N - 1, Math.floor(u * N)),
      x = x0 + u * (x1 - x0),
      qr = s.L.qr(T[i]) / qmax;
    if (qr <= 0.02) continue;
    const len = 8 + 46 * qr;
    arrow(g, x + 8, y + th / 2 + 4, x + 8 + len * 0.3, y + th / 2 + 4 + len, 5);
  }
  /* 端子への伝導 */
  if (o.ends === 'sink') {
    const Gb = ((s.m.k * s.g.A) / s.dx) * 2,
      qt = [Gb * (T[0] - c.Ta), Gb * (T[N - 1] - c.Ta)];
    g.strokeStyle = COL.ink;
    g.fillStyle = COL.ink;
    g.lineWidth = 2;
    const l = 10 + 26 * Math.min(1, Math.max(...qt, 1e-9) / Math.max(((qmax * s.len) / N) * 6, 1e-12));
    if (qt[0] > 1e-6) arrow(g, x0 + l + 6, y + th / 2 + 14, x0 + 4, y + th / 2 + 14, 6);
    if (qt[1] > 1e-6) arrow(g, x1 - l - 6, y + th / 2 + 14, x1 - 4, y + th / 2 + 14, 6);
  }
  /* 最高の値 */
  let im = 0;
  for (let i = 1; i < N; i++) if (T[i] > T[im]) im = i;
  const xm = x0 + (im + 0.5) * cw;
  font(g, 15, 700, true);
  g.fillStyle = COL.ink;
  g.textAlign = 'center';
  g.textBaseline = 'bottom';
  label(g, fmtC(T[im]), Math.max(x0 + 30, Math.min(x1 - 30, xm)), yTop - 8);
  font(g, 13, 500, true);
  g.fillStyle = COL.sink;
  g.textAlign = 'left';
  g.textBaseline = 'top';
  const fs = o.f >= 1e6 ? `${o.f / 1e6} MHz` : o.f >= 1e3 ? `${o.f / 1e3} kHz` : `${o.f} Hz`;
  g.fillText(`${Number(o.I.toPrecision(3))} A${o.f && o.I ? ` ${fs}` : ''}・${lenText(s.len)}`, x0, h - 22);
  if (broken && s.cut !== null) {
    g.fillStyle = COL.warn;
    font(g, 15, 700);
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.fillText('溶断', x0 + (s.cut + 1) * cw, y + th / 2 + 22);
  }
  colorbar(g, w - 18, 16, h - 50, c.Ta, c.top);
}
export const lenText = (m: number): string =>
  m < 1e-3
    ? `${Number((m * 1e6).toPrecision(3))} µm`
    : m < 0.01
      ? `${Number((m * 1e3).toPrecision(3))} mm`
      : m < 1
        ? `${Number((m * 100).toPrecision(3))} cm`
        : `${Number(m.toPrecision(3))} m`;

/* ---------- 線の断面のまわりの空気 ---------- */
/** 被覆を含めた線の外形（丸線は半径、角線は幅と高さ） */
const outerOf = (s: WireSim): Outline =>
  s.g.shape === 'round' ? s.g.d / 2 + s.g.ins : { w: s.g.w + 2 * s.g.ins, h: s.g.t + 2 * s.g.ins };
export function drawAir(cv: HTMLCanvasElement, s: WireSim, c: Ctx, o: WireOpt, parts: Particle[]): void {
  const { g, w, h } = sizeCv(cv),
    T = c.T;
  let im = 0;
  for (let i = 1; i < T.length; i++) if (T[i] > T[im]) im = i;
  const out = outerOf(s),
    pl = linePlume(s.L.qc(T[im]), s.L.ts(T[im]) - c.Ta, c.Ta, o.wind, out),
    top = c.Ta + Math.max(5, pl.at(0, 0.004)[0]);
  const W = 0.04,
    yLo = -0.008,
    yHi = 0.05,
    narrow = w < 520,
    sc = Math.min((w - (narrow ? 60 : 190)) / W, (h - 20) / (yHi - yLo)),
    bw = W * sc,
    bh = (yHi - yLo) * sc,
    bx = narrow ? 8 : Math.max(8, (w - 160 - bw) / 2),
    by = (h - bh) / 2;
  const toPx = (x: number, y: number): [number, number] => [bx + (x + W / 2) * sc, by + (yHi - y) * sc];
  paintField(
    g,
    { x: bx, y: by, w: bw, h: bh },
    120,
    150,
    (i, j) => pl.at(-W / 2 + ((i + 0.5) / 120) * W, yHi - ((j + 0.5) / 150) * (yHi - yLo))[0],
    top - c.Ta,
  );
  g.strokeStyle = COL.grid2;
  g.lineWidth = 1;
  g.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
  /* 周りから吸い込まれて昇る粒 */
  const vel = (x: number, y: number): [number, number] => {
    const [, u, v] = pl.at(x, y),
      uc0 = pl.at(0, Math.max(y, 0.002))[1];
    return [v - Math.sign(x) * 0.18 * uc0 * Math.exp(-Math.abs(x) / 0.012), u + 0.004];
  };
  particles(
    g,
    parts,
    90,
    () =>
      Math.random() < 0.5
        ? { x: (Math.random() - 0.5) * 0.006, y: (Math.random() - 0.3) * 0.004 }
        : { x: (Math.random() - 0.5) * W, y: yLo + Math.random() * 0.02 },
    vel,
    toPx,
    (p) => p.y < yHi && Math.abs(p.x) < W / 2,
    c.dt,
  );
  /* 線の断面。丸線は円、角線は長方形（小さすぎるときは見える大きさまで広げる）。被覆は灰の縁 */
  const [cx, cy] = toPx(0, 0),
    gm = s.g,
    ins = gm.ins * sc;
  let rp: number;
  g.fillStyle = heat(1);
  g.strokeStyle = COL.ink;
  g.lineWidth = 1;
  if (gm.shape === 'round') {
    rp = Math.max(2.5, (gm.d / 2) * sc);
    if (ins > 0) {
      g.fillStyle = COL.ink3;
      g.beginPath();
      g.arc(cx, cy, rp + Math.max(1.5, ins), 0, Math.PI * 2);
      g.fill();
      g.fillStyle = heat(1);
    }
    g.beginPath();
    g.arc(cx, cy, rp, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = COL.screen;
    g.lineWidth = 2;
    g.stroke();
  } else {
    const ww = Math.max(3, gm.w * sc),
      hh = Math.max(2, gm.t * sc);
    if (ins > 0) {
      const e = Math.max(1.5, ins);
      g.fillStyle = COL.ink3;
      g.fillRect(cx - ww / 2 - e, cy - hh / 2 - e, ww + 2 * e, hh + 2 * e);
      g.fillStyle = heat(1);
    }
    /* 周りの空気と同じ淡い色になるので、地の色で縁取って形を見せる */
    g.strokeStyle = COL.screen;
    g.lineWidth = 2;
    g.strokeRect(cx - ww / 2 - 1, cy - hh / 2 - 1, ww + 2, hh + 2);
    g.fillRect(cx - ww / 2, cy - hh / 2, ww, hh);
    rp = ww / 2;
  }
  /* 高さごとの値 */
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  for (const yy of [0.01, 0.03]) {
    const [, py] = toPx(0, yy),
      [d, u] = pl.at(0, yy),
      tx = narrow ? bx + bw * 0.55 : bx + bw + 12;
    if (!narrow) {
      g.strokeStyle = COL.sink;
      g.setLineDash([2, 3]);
      g.beginPath();
      g.moveTo(cx, py);
      g.lineTo(tx - 4, py);
      g.stroke();
      g.setLineDash([]);
    }
    font(g, 15, 700, true);
    g.fillStyle = COL.ink;
    label(g, fmtC(c.Ta + d), tx, py - 9);
    font(g, 13, 500, true);
    g.fillStyle = COL.sink;
    label(g, `${Math.round(yy * 100)} cm 上・${Number(u.toPrecision(2))} m/s`, tx, py + 9);
  }
  font(g, 13, 500, true);
  g.fillStyle = COL.sink;
  g.textBaseline = 'top';
  g.fillText('幅 4 cm', bx + 4, by + 4);
  font(g, 15, 700, true);
  g.fillStyle = COL.ink;
  g.textBaseline = 'middle';
  label(g, `線 ${fmtC(T[im])}`, cx + rp + 8, cy);
  colorbar(g, w - 18, 16, h - 32, c.Ta, top);
}

/* ---------- グラフ ---------- */
function limits(g: G, box: Box, Y: (v: number) => number, c: Ctx): void {
  font(g, 12, 500);
  g.textAlign = 'right';
  g.textBaseline = 'bottom';
  for (const [v, n] of c.limits)
    if (v <= c.top * 1.08) {
      const y = Y(v);
      dashLine(g, box.x, box.x + box.w, y, COL.warn);
      g.fillStyle = COL.warn;
      g.fillText(n, box.x + box.w - 2, y - 2);
    }
}
/** 線に沿った温度。xs は位置（cm か m）、xu はその単位 */
export function drawProf(cv: HTMLCanvasElement, c: Ctx, xs: number[], xu: string): void {
  const { g, w, h } = sizeCv(cv),
    box = { x: 44, y: 10, w: w - 56, h: h - 48 },
    len = xs[xs.length - 1];
  const { X, Y } = axes(
    g,
    box,
    0,
    len,
    c.Ta,
    c.top + (c.top - c.Ta) * 0.08,
    (v) => String(Number(v.toPrecision(3))),
    xu,
    '°C',
  );
  limits(g, box, Y, c);
  g.strokeStyle = COL.ch1;
  g.lineWidth = 2.2;
  g.beginPath();
  c.T.forEach((v, i) => {
    if (i) g.lineTo(X(xs[i]), Y(v));
    else g.moveTo(X(xs[i]), Y(v));
  });
  g.stroke();
}
/** 時間の変化。最高（ch1）と平均（灰）。pulse があればその間を塗る */
export function drawTime(
  cv: HTMLCanvasElement,
  c: Ctx,
  times: number[],
  frames: Float32Array[],
  idx: Int32Array | null,
  on: number | null,
  melt: number | null,
): void {
  const { g, w, h } = sizeCv(cv),
    box = { x: 44, y: 10, w: w - 56, h: h - 48 };
  const { X: XU, Y } = axes(
    g,
    box,
    0,
    1,
    c.Ta,
    c.topAll + (c.topAll - c.Ta) * 0.08,
    () => '',
    '通電からの時間',
    '°C',
    timeTicks(c.gm, box.w),
  );
  const X = (t: number) => XU(uOf(c.gm, t));
  limits(g, box, Y, { ...c, top: c.topAll });
  /* 電流が流れている間を塗る */
  const tOn = Math.min(on ?? Number.POSITIVE_INFINITY, c.gm.te);
  g.fillStyle = mix(COL.screen, COL.ch1, 0.12);
  g.fillRect(X(0), box.y, X(tOn) - X(0), box.h);
  if (melt !== null && melt <= c.gm.te) {
    const xm = X(melt);
    g.strokeStyle = COL.warn;
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(xm, box.y);
    g.lineTo(xm, box.y + box.h);
    g.stroke();
    font(g, 12, 700);
    g.fillStyle = COL.warn;
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.fillText('溶断', xm + 3, box.y + 16);
  }
  const stat = (f: Float32Array, max: boolean) => {
    let m = max ? Number.NEGATIVE_INFINITY : 0;
    if (idx) {
      for (const k of idx) m = max ? Math.max(m, f[k]) : m + f[k];
      return max ? m : m / idx.length;
    }
    for (const v of f) m = max ? Math.max(m, v) : m + v;
    return max ? m : m / f.length;
  };
  for (const [max, col, lw] of [
    [false, COL.ink2, 1.6],
    [true, COL.ch1, 2.2],
  ] as const) {
    g.strokeStyle = col;
    g.lineWidth = lw;
    g.beginPath();
    frames.forEach((f, i) => {
      const x = X(times[i]),
        y = Y(stat(f, max));
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    });
    g.stroke();
  }
  const x = X(Math.min(c.pt, c.gm.te));
  g.strokeStyle = COL.ink;
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(x, box.y);
  g.lineTo(x, box.y + box.h);
  g.stroke();
}
/** グラフの x [px] から時刻 */
export const timeAt = (cv: HTMLCanvasElement, clientX: number, tm: TMap): number => {
  const r = cv.getBoundingClientRect();
  return tOf(tm, (clientX - r.left - 44) / (r.width - 56));
};

/* ---------- 断面と熱の行き先 ---------- */
export function drawXs(cv: HTMLCanvasElement, s: WireSim, c: Ctx, o: WireOpt): void {
  const { g, w, h } = sizeCv(cv);
  let mx = Number.NEGATIVE_INFINITY;
  for (const v of c.T) mx = Math.max(mx, v);
  const rho = rhoAt(s.m, mx),
    dl = skinDepth(rho, o.f),
    cx = w / 2,
    cy = h / 2 - 8,
    R = Math.min(w, h) * 0.36;
  const jcol = (u: number) => mix(COL.screen, COL.ch2, 0.12 + 0.88 * Math.max(0, Math.min(1, u)));
  if (s.g.shape === 'round') {
    const a = s.g.d / 2,
      n = 60;
    for (let k = n; k >= 1; k--) {
      g.fillStyle = jcol(roundJ(a, dl, (k / n) * a));
      g.beginPath();
      g.arc(cx, cy, (k / n) * R, 0, Math.PI * 2);
      g.fill();
    }
    if (o.surf === 'pvc') {
      g.strokeStyle = COL.ink3;
      g.lineWidth = 6;
      g.beginPath();
      g.arc(cx, cy, R + 5, 0, Math.PI * 2);
      g.stroke();
    }
    if (Number.isFinite(dl) && dl < a) {
      g.strokeStyle = COL.ink;
      g.setLineDash([4, 3]);
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(cx, cy, R * (1 - dl / a), 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }
  } else {
    const ww = s.g.w,
      tt = s.g.t,
      ar = ww / tt,
      W = ar >= 1 ? R * 2 : (R * 2) / Math.min(8, 1 / ar),
      H = ar >= 1 ? Math.max(6, (R * 2) / Math.min(ar, 40)) : R * 2,
      x0 = cx - W / 2,
      y0 = cy - H / 2,
      nx = 80,
      ny = Math.max(4, Math.round(nx / Math.min(Math.max(ar, 1), 20)));
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const px = ((i + 0.5) / nx) * ww,
          py = ((j + 0.5) / ny) * tt,
          dd = Math.min(px, ww - px, py, tt - py);
        g.fillStyle = jcol(Number.isFinite(dl) ? Math.exp(-dd / dl) : 1);
        g.fillRect(x0 + (i / nx) * W, y0 + (j / ny) * H, W / nx + 0.5, H / ny + 0.5);
      }
    if (o.surf === 'pvc') {
      g.strokeStyle = COL.ink3;
      g.lineWidth = 5;
      g.strokeRect(x0 - 4, y0 - 4, W + 8, H + 8);
    }
  }
  font(g, 13, 500, true);
  g.fillStyle = COL.sink;
  g.textAlign = 'center';
  g.textBaseline = 'bottom';
  const k = acFactor(s.g, rho, o.f);
  g.fillText(o.f ? `表皮の深さ ${lenText(dl)}・抵抗 ×${k.toFixed(2)}` : '直流 一様', cx, h - 4);
}
export function drawBal(cv: HTMLCanvasElement, b: Bal): void {
  const { g, w } = sizeCv(cv),
    gen = b.gen,
    out = b.conv + b.rad + b.term,
    store = gen - out;
  const x0 = 12,
    W = w - 24,
    ref = Math.max(gen, out, 1e-12),
    stc = mix(COL.screen, heat(0.75), 0.35);
  const rows: [string, [number, string][]][] = [
    ['発熱', [[gen, heat(0.75)]]],
    [
      '行き先',
      [
        [b.conv, COL.ch2],
        [b.rad, COL.ch1],
        [b.term, COL.ink3],
        [Math.max(0, store), stc],
      ],
    ],
  ];
  font(g, 13, 700);
  g.textBaseline = 'middle';
  rows.forEach(([name, parts], r) => {
    const y = 26 + r * 56;
    g.fillStyle = COL.ink;
    g.textAlign = 'left';
    g.fillText(name, x0, y - 16);
    let x = x0;
    for (const [v, col] of parts) {
      const ww = (v / ref) * W;
      g.fillStyle = col;
      g.fillRect(x, y - 6, Math.max(0, ww), 20);
      x += ww;
    }
    g.strokeStyle = COL.grid2;
    g.lineWidth = 1;
    g.strokeRect(x0 + 0.5, y - 6.5, W - 1, 21);
  });
  font(g, 13, 500, true);
  g.textAlign = 'left';
  /* 発熱があれば発熱に対する割合、電流が止まった後は W */
  const pct = (v: number) =>
    gen > 0
      ? `${Math.round((v / gen) * 100)} %`
      : v < 1
        ? `${Number((v * 1e3).toPrecision(2))} mW`
        : `${Number(v.toPrecision(2))} W`;
  const items: [string, number, string][] = [
    ['対流', b.conv, COL.ch2],
    ['放射', b.rad, COL.ch1],
    ['端子', b.term, COL.ink3],
    [store >= 0 ? '温度上昇' : '冷却', Math.abs(store), stc],
  ];
  items.forEach(([n, v, col], k) => {
    const x = x0 + (k % 2) * (W / 2),
      y = 128 + Math.floor(k / 2) * 22;
    g.fillStyle = col;
    g.fillRect(x, y - 5, 10, 10);
    g.fillStyle = COL.sink;
    g.fillText(`${n} ${pct(v)}`, x + 15, y);
  });
  g.textAlign = 'right';
  g.fillText(gen < 1 ? `${Number((gen * 1e3).toPrecision(3))} mW` : `${Number(gen.toPrecision(3))} W`, x0 + W, 10);
}

/* ---------- 経路 ---------- */
export const pathBox = (w: number, h: number): { x0: number; y0: number; s: number } => {
  const s = Math.min(w - 40, (h - 28) / PATH_H);
  return { x0: Math.max(8, (w - 30 - s) / 2), y0: 10, s };
};
/** 経路の空気の場。同じ時刻・同じ記録の間は使い回す */
let airCache: { key: string; grid: Float32Array; pl: Src[] } = { key: '', grid: new Float32Array(0), pl: [] };
export function drawPath(
  cv: HTMLCanvasElement,
  s: WireSim | null,
  c: Ctx | null,
  o: { d: number; ends: 'sink' | 'free'; scale: number; air: boolean },
  ctrl: [number, number][],
  drag: { k: number; path: Path } | null,
  parts: Particle[],
): void {
  const { g, w, h } = sizeCv(cv),
    B = pathBox(w, h),
    P = (x: number, y: number): [number, number] => [B.x0 + x * B.s, B.y0 + y * B.s],
    sc = o.scale;
  g.strokeStyle = COL.grid;
  g.lineWidth = 1;
  g.strokeRect(B.x0 + 0.5, B.y0 + 0.5, B.s - 1, PATH_H * B.s - 1);
  const lw = Math.max(5, Math.min(16, o.d * 12));
  const live = !drag && s && c && s.path;
  if (live && o.air && s.path) {
    const key = `${s.times.length}:${c.i}:${s.len}:${sc}`,
      nx = 90,
      ny = 50;
    if (airCache.key !== key) {
      const pl = pathPlumes(s.path, s.L, s.dx, c.Ta, c.T),
        grid = new Float32Array(nx * ny);
      for (let j = 0; j < ny; j++)
        for (let k = 0; k < nx; k++)
          grid[j * nx + k] = airField(pl, ((k + 0.5) / nx) * sc, ((j + 0.5) / ny) * PATH_H * sc)[0];
      airCache = { key, grid, pl };
    }
    const A = airCache,
      path = s.path;
    paintField(g, { x: B.x0, y: B.y0, w: B.s, h: PATH_H * B.s }, nx, ny, (k, j) => A.grid[j * nx + k], c.top - c.Ta);
    particles(
      g,
      parts,
      110,
      () => {
        const p = path.pts[Math.floor(Math.random() * path.pts.length)];
        return { x: p[0] + (Math.random() - 0.5) * 0.002, y: -p[1] };
      },
      (x, y) => [0, Math.max(0.01, airField(A.pl, x, -y)[1])],
      (x, y) => P(x / sc, -y / sc),
      (p) => -p.y > 0 && p.x > 0 && p.x < sc,
      c.dt,
    );
  }
  const pts = drag
    ? drag.path.pts.map(([x, y]) => P(x, y))
    : s?.path
      ? s.path.pts.map(([x, y]) => P(x / sc, y / sc))
      : [];
  g.lineCap = 'round';
  const cutI = !drag && s && c && s.cut !== null && s.tMelt !== null && c.pt >= s.tMelt ? s.cut : -1;
  for (let i = 0; i < pts.length - 1; i++) {
    if (i === cutI) continue;
    g.strokeStyle = live && c ? heat((c.T[i] - c.Ta) / (c.top - c.Ta)) : COL.sink;
    g.lineWidth = lw;
    g.beginPath();
    g.moveTo(...pts[i]);
    g.lineTo(...pts[i + 1]);
    g.stroke();
  }
  g.lineCap = 'butt';
  if (cutI >= 0) {
    const [ax, ay] = pts[cutI],
      [bx, by] = pts[cutI + 1];
    font(g, 15, 700);
    g.fillStyle = COL.warn;
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    label(g, '溶断', (ax + bx) / 2, Math.min(ay, by) - lw);
  }
  g.fillStyle = o.ends === 'sink' ? COL.sink : COL.screen;
  g.strokeStyle = COL.sink;
  g.lineWidth = 1.4;
  for (const [x, y] of [P(...ctrl[0]), P(...ctrl[ctrl.length - 1])]) {
    g.fillRect(x - 8, y - 8, 16, 16);
    g.strokeRect(x - 8, y - 8, 16, 16);
  }
  ctrl.forEach((p, k) => {
    if (k === 0 || k === ctrl.length - 1) return;
    const [x, y] = P(...p);
    g.fillStyle = COL.screen;
    g.strokeStyle = drag?.k === k ? COL.ink : COL.ink3;
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(x, y, 5, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  });
  if (live && c && s) {
    let im = 0;
    for (let i = 1; i < c.T.length; i++) if (c.T[i] > c.T[im]) im = i;
    const [x, y] = pts[im];
    g.strokeStyle = COL.ink;
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(x, y, lw / 2 + 4, 0, Math.PI * 2);
    g.stroke();
    font(g, 15, 700, true);
    g.fillStyle = COL.ink;
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    label(g, fmtC(c.T[im]), x, y - lw / 2 - 8);
    font(g, 13, 500, true);
    g.fillStyle = COL.sink;
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.fillText(`幅 ${lenText(sc)}・長さ ${lenText(s.len)}`, B.x0 + 4, B.y0 + PATH_H * B.s + 4);
    colorbar(g, w - 18, 16, h - 50, c.Ta, c.top);
  }
}
/** 経路の図の画面座標 → 制御点の座標（図の幅を 1） */
export function pathCoord(cv: HTMLCanvasElement, clientX: number, clientY: number): [number, number] {
  const r = cv.getBoundingClientRect(),
    B = pathBox(r.width, r.height);
  return [(clientX - r.left - B.x0) / B.s, (clientY - r.top - B.y0) / B.s];
}

/* ---------- 基板 ---------- */
const boardCv = typeof document === 'undefined' ? null : document.createElement('canvas');
let boardGeom = { x0: 0, y0: 0, s: 1 };
/** 升 k の電流密度 [A/m²] */
export function jAt(b: BoardRec, k: number, I: number): number {
  const { NX } = BD,
    i = k % NX,
    V = b.V,
    s = I * b.R[b.R.length - 1];
  /** 最後まで残っている銅箔の升（V は最後の電位なので、それに合わせる） */
  const ok = (kk: number) => kk >= 0 && kk < b.cu.length && !!b.cu[kk] && !Number.isFinite(b.cutAt[kk]);
  const side = (d: number, on: boolean): [number, number] => (on ? [1, d] : [0, 0]);
  const [nl, l] = side(V[k - 1] - V[k], i > 0 && ok(k - 1)),
    [nr, r] = side(V[k] - V[k + 1], i < NX - 1 && ok(k + 1)),
    [nu, u] = side(V[k - NX] - V[k], ok(k - NX)),
    [nd, dn] = side(V[k] - V[k + NX], ok(k + NX));
  const gx = (l + r) / Math.max(1, nl + nr),
    gy = (u + dn) / Math.max(1, nu + nd);
  return ((Math.hypot(gx, gy) * s) / BD.dx) * (b.sq[k] / b.tEff);
}
export function jMax(b: BoardRec, I: number): number {
  let m = 0;
  for (const k of b.idx) if (!Number.isFinite(b.cutAt[k])) m = Math.max(m, jAt(b, k, I));
  return m;
}
export function drawBoard(
  cv: HTMLCanvasElement,
  b: BoardRec,
  c: Ctx,
  I: number,
  view: 'T' | 'J',
  hover: [number, number] | null,
): void {
  const { g, w, h } = sizeCv(cv),
    { NX, NY } = BD,
    s = Math.min((w - 48) / NX, (h - 16) / NY),
    x0 = 8,
    y0 = (h - NY * s) / 2,
    T = c.T;
  boardGeom = { x0, y0, s };
  if (!boardCv) return;
  boardCv.width = NX;
  boardCv.height = NY;
  const ig = boardCv.getContext('2d') as G,
    img = ig.createImageData(NX, NY),
    span = c.top - c.Ta,
    bg = rgbOf(COL.screen),
    jc = rgbOf(COL.ch2),
    jm = view === 'J' && I > 0 ? jMax(b, I) : 1,
    /** 時刻 pt に残っている銅箔 */
    live = (k: number) => !!b.cu[k] && b.cutAt[k] > c.pt;
  for (let k = 0; k < NX * NY; k++) {
    let col: number[];
    if (view === 'T') col = heatRGB((T[k] - c.Ta) / span);
    else if (live(k) && I > 0) {
      const u = 0.15 + 0.85 * Math.min(1, jAt(b, k, I) / jm);
      col = bg.map((v, i) => Math.round(v + (jc[i] - v) * u));
    } else if (live(k)) col = bg.map((v, i) => Math.round(v + (jc[i] - v) * 0.15));
    else col = bg;
    img.data[k * 4] = col[0];
    img.data[k * 4 + 1] = col[1];
    img.data[k * 4 + 2] = col[2];
    img.data[k * 4 + 3] = 255;
  }
  ig.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = view === 'T';
  g.drawImage(boardCv, x0, y0, NX * s, NY * s);
  /* 銅箔の縁 */
  g.strokeStyle = view === 'T' ? 'rgba(255,255,255,.55)' : COL.sink;
  g.lineWidth = 1;
  g.beginPath();
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NX; i++) {
      const k = j * NX + i;
      if (!live(k)) continue;
      const X = x0 + i * s,
        Y = y0 + j * s;
      if (i === 0 || !live(k - 1)) {
        g.moveTo(X, Y);
        g.lineTo(X, Y + s);
      }
      if (i === NX - 1 || !live(k + 1)) {
        g.moveTo(X + s, Y);
        g.lineTo(X + s, Y + s);
      }
      if (j === 0 || !live(k - NX)) {
        g.moveTo(X, Y);
        g.lineTo(X + s, Y);
      }
      if (j === NY - 1 || !live(k + NX)) {
        g.moveTo(X, Y + s);
        g.lineTo(X + s, Y + s);
      }
    }
  g.stroke();
  g.strokeStyle = COL.grid2;
  g.strokeRect(x0 + 0.5, y0 + 0.5, NX * s - 1, NY * s - 1);
  /* 溶けた升（赤の枠）と「溶断」の札 */
  let mx0 = -1,
    my0 = -1;
  g.strokeStyle = COL.warn;
  g.lineWidth = 1.5;
  for (const k of b.idx)
    if (b.cutAt[k] <= c.pt) {
      const X = x0 + (k % NX) * s,
        Y = y0 + ((k / NX) | 0) * s;
      g.strokeRect(X + 0.75, Y + 0.75, s - 1.5, s - 1.5);
      mx0 = X + s / 2;
      my0 = Y + s;
    }
  if (mx0 >= 0) {
    font(g, 15, 700);
    g.fillStyle = COL.warn;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    label(g, '溶断', mx0, my0 + 8);
  }
  /* 最高の位置 */
  let km = b.idx[0];
  for (const k of b.idx) if (T[k] > T[km]) km = k;
  if (view === 'T') {
    const mx = x0 + ((km % NX) + 0.5) * s,
      my = y0 + (((km / NX) | 0) + 0.5) * s;
    g.strokeStyle = COL.ink;
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(mx, my, 7, 0, Math.PI * 2);
    g.stroke();
    font(g, 15, 700, true);
    g.fillStyle = COL.ink;
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    label(g, fmtC(T[km]), Math.min(x0 + NX * s - 30, Math.max(x0 + 30, mx)), my - 10);
  }
  if (hover) {
    const [i, j] = hover;
    if (i >= 0 && i < NX && j >= 0 && j < NY) {
      const k = j * NX + i;
      font(g, 13, 500, true);
      g.fillStyle = COL.ink;
      g.textAlign = 'left';
      g.textBaseline = 'top';
      label(
        g,
        view === 'T' ? fmtC(T[k]) : b.cu[k] ? `${Number((jAt(b, k, I) * 1e-6).toPrecision(3))} A/mm²` : '基材',
        x0 + 6,
        y0 + 6,
      );
    }
  }
  font(g, 13, 500, true);
  g.fillStyle = COL.ink;
  g.textAlign = 'left';
  g.textBaseline = 'bottom';
  label(g, '30 × 18 mm', x0 + 6, y0 + NY * s - 4);
  if (view === 'T') colorbar(g, w - 18, 16, h - 32, c.Ta, c.top);
}
/** 基板の図の画面座標 → 升の番号 [i, j] */
export function boardCell(cv: HTMLCanvasElement, clientX: number, clientY: number): [number, number] {
  const r = cv.getBoundingClientRect();
  return [
    Math.floor((clientX - r.left - boardGeom.x0) / boardGeom.s),
    Math.floor((clientY - r.top - boardGeom.y0) / boardGeom.s),
  ];
}
/** 配線に沿った温度。パッドの間の銅箔の升を電位の順に 60 に分け、それぞれの最高を結ぶ */
export function drawBprof(cv: HTMLCanvasElement, b: BoardRec, c: Ctx): void {
  const { g, w, h } = sizeCv(cv),
    nb = 60,
    cnt = new Float64Array(nb),
    mx = new Float64Array(nb).fill(Number.NEGATIVE_INFINITY);
  for (const k of b.idx) {
    const u = Math.max(0, Math.min(nb - 1, Math.floor((1 - b.V[k]) * nb)));
    cnt[u]++;
    mx[u] = Math.max(mx[u], c.T[k]);
  }
  const box = { x: 44, y: 10, w: w - 56, h: h - 48 };
  const { X, Y } = axes(
    g,
    box,
    0,
    100,
    c.Ta,
    c.top + (c.top - c.Ta) * 0.08,
    (v) => (v === 0 ? '左' : v === 100 ? '右' : ''),
    '左のパッド → 右のパッド',
    '°C',
  );
  limits(g, box, Y, c);
  g.strokeStyle = COL.ch1;
  g.lineWidth = 2.2;
  g.beginPath();
  let first = true;
  for (let u = 0; u < nb; u++)
    if (cnt[u]) {
      const x = X(((u + 0.5) / nb) * 100),
        y = Y(mx[u]);
      if (first) g.moveTo(x, y);
      else g.lineTo(x, y);
      first = false;
    }
  g.stroke();
}
/** 被覆の耐熱 */
export const PVC_LIM = PVC.lim;
