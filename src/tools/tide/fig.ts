/**
 * 潮の満ち引きの図: 月と太陽の引力（北極の上から見た地球と海と港）・港の潮位のグラフ・今日の月の形。
 * 色はページの CSS 変数から読む（readCols）。キャンバスの大きさは CSS に合わせる
 */
import type { Shio } from './model';
import { type Ring, ringEta } from './model';

const COL = {
  grid: '',
  ink: '',
  ink2: '',
  ink3: '',
  inset: '',
  on: '',
  hi: '',
  lo: '',
  sea: '',
  land: '',
  landInk: '',
  space: '',
  moon: '',
  moonDark: '',
  sun: '',
  mono: '',
  sans: '',
};
export function readCols(root: Element): void {
  const c = getComputedStyle(root),
    v = (k: string) => c.getPropertyValue(k).trim();
  COL.grid = v('--grid');
  COL.ink = v('--ink');
  COL.ink2 = v('--ink-2');
  COL.ink3 = v('--ink-3');
  COL.inset = v('--inset');
  COL.on = v('--accent');
  COL.hi = v('--td-hi');
  COL.lo = v('--td-lo');
  COL.sea = v('--td-sea');
  COL.land = v('--td-land');
  COL.landInk = v('--td-land-ink');
  COL.space = v('--td-space');
  COL.moon = v('--td-moon');
  COL.moonDark = v('--td-moon-dark');
  COL.sun = v('--td-sun');
  COL.mono = v('--mono');
  COL.sans = v('--sans');
}

/* ---------- 写真（地球: NASA Blue Marble、月: NASA SVS の CGI Moon Kit） ---------- */
interface Tex {
  w: number;
  h: number;
  d: Uint8ClampedArray;
}
const TEX: { earth: Tex | null; moon: Tex | null } = { earth: null, moon: null };
const PORT_LON_RAD = (135 * Math.PI) / 180;
const dpr = (): number => Math.min(2, devicePixelRatio || 1);
/** 正距円筒の写真を読み込む。読めなければ写真なし（1 色の円）のまま */
export function loadTex(key: 'earth' | 'moon', src: string, done: () => void): void {
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return;
    g.drawImage(img, 0, 0);
    TEX[key] = { w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data };
    done();
  };
  img.src = src;
}
const polars = new Map<string, HTMLCanvasElement>();
/**
 * 北極の上から見た半球（正射図法）を直径 N 画素で作る。北極が中心、赤道が縁。
 * 経度 0 を右（数学の角 0）に置き、東を反時計回りにする
 */
function polarOf(key: string, t: Tex, N: number): HTMLCanvasElement | null {
  if (N < 2) return null;
  const k = `${key}${N}`,
    hit = polars.get(k);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  if (!g) return null;
  const im = g.createImageData(N, N),
    R = N / 2;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = x + 0.5 - R,
        dy = y + 0.5 - R,
        r = Math.hypot(dx, dy) / R;
      if (r > 1) continue;
      const lat = Math.acos(r),
        lon = Math.atan2(-dy, dx),
        u = Math.min(t.w - 1, Math.floor(((lon / Math.PI + 1) / 2) * t.w)),
        v = Math.min(t.h - 1, Math.floor((0.5 - lat / Math.PI) * t.h)),
        i = (v * t.w + u) * 4,
        o = (y * N + x) * 4;
      im.data[o] = t.d[i];
      im.data[o + 1] = t.d[i + 1];
      im.data[o + 2] = t.d[i + 2];
      im.data[o + 3] = Math.round(255 * Math.min(1, (1 - r) * R + 0.5));
    }
  g.putImageData(im, 0, 0);
  if (polars.size > 8) polars.clear();
  polars.set(k, c);
  return c;
}

/** 宇宙の地の上の文字の色（テーマによらない） */
const ON_SPACE = '#e6e8e4',
  ON_SPACE2 = '#a9b3bd',
  HI_SPACE = '#ffb27a',
  LO_SPACE = '#9fd0ff';

/** 描く面を用意する（CSS の大きさに合わせる）。隠れていれば null */
function surface(c: HTMLCanvasElement): { g: CanvasRenderingContext2D; w: number; h: number } | null {
  const w = c.clientWidth,
    h = c.clientHeight,
    d = Math.min(2, devicePixelRatio || 1);
  if (!w || !h) return null;
  const W = Math.round(w * d),
    H = Math.round(h * d);
  if (c.width !== W || c.height !== H) {
    c.width = W;
    c.height = H;
  }
  const g = c.getContext('2d');
  if (!g) return null;
  g.setTransform(d, 0, 0, d, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h };
}

interface TxtOpt {
  al?: CanvasTextAlign;
  col?: string;
  size?: number;
  w?: number;
  mono?: boolean;
  halo?: string;
}
function txt(g: CanvasRenderingContext2D, s: string, x: number, y: number, o: TxtOpt = {}): void {
  g.font = `${o.w ?? 500} ${o.size ?? 13}px ${o.mono ? COL.mono : COL.sans}`;
  g.textAlign = o.al ?? 'left';
  g.textBaseline = 'alphabetic';
  if (o.halo) {
    g.lineWidth = 4;
    g.lineJoin = 'round';
    g.strokeStyle = o.halo;
    g.strokeText(s, x, y);
  }
  g.fillStyle = o.col ?? COL.ink;
  g.fillText(s, x, y);
}

function arrow(
  g: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  col: string,
  lw = 2,
  hd = 8,
): void {
  const dx = x1 - x0,
    dy = y1 - y0,
    L = Math.hypot(dx, dy);
  g.strokeStyle = col;
  g.fillStyle = col;
  g.lineWidth = lw;
  g.lineCap = 'round';
  if (L < 1.5) {
    g.beginPath();
    g.arc(x0, y0, lw, 0, 7);
    g.fill();
    return;
  }
  const h = Math.min(hd, L * 0.55),
    ux = dx / L,
    uy = dy / L;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1 - ux * h * 0.7, y1 - uy * h * 0.7);
  g.stroke();
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x1 - ux * h - uy * h * 0.5, y1 - uy * h + ux * h * 0.5);
  g.lineTo(x1 - ux * h + uy * h * 0.5, y1 - uy * h - ux * h * 0.5);
  g.closePath();
  g.fill();
}

/** 星のある宇宙の地 */
function spaceBg(g: CanvasRenderingContext2D, w: number, h: number): void {
  g.fillStyle = COL.space;
  g.beginPath();
  g.roundRect(0, 0, w, h, 4);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,.55)';
  const hash = (k: number): number => {
    const v = Math.sin(k * 127.1 + 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  const n = Math.round((w * h) / 4000);
  for (let i = 0; i < n; i++) {
    const s = i % 7 ? 1 : 1.6;
    g.fillRect(hash(i) * w, hash(i + 0.5) * h, s, s);
  }
}

/** 海面の形: 角度 θ（x 軸から反時計回り。画面は y が下）の高さを f(θ) で */
function seaPath(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  base: number,
  k: number,
  f: (th: number) => number,
): void {
  g.beginPath();
  for (let i = 0; i <= 180; i++) {
    const th = (i / 180) * 2 * Math.PI,
      r = base + k * f(th),
      x = cx + r * Math.cos(th),
      y = cy - r * Math.sin(th);
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.closePath();
}

/** 北極の上から見た月（太陽の側が明るい。太陽は左） */
function moonTop(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.fillStyle = COL.moonDark;
  g.beginPath();
  g.arc(x, y, r, 0, 7);
  g.fill();
  g.fillStyle = COL.moon;
  g.beginPath();
  g.arc(x, y, r, Math.PI / 2, (3 * Math.PI) / 2);
  g.closePath();
  g.fill();
}

/** 地上から見た月の形（太陽からの離角 el [°]、0 新月・180 満月） */
export function moonPhase(g: CanvasRenderingContext2D, x: number, y: number, r: number, el: number): void {
  const e = ((el % 360) + 360) % 360 || 0.01,
    k = Math.cos((e * Math.PI) / 180),
    rx = r * Math.abs(k);
  g.fillStyle = COL.moonDark;
  g.beginPath();
  g.arc(x, y, r, 0, 7);
  g.fill();
  g.fillStyle = COL.moon;
  g.beginPath();
  if (e < 180) {
    g.arc(x, y, r, -Math.PI / 2, Math.PI / 2, false);
    g.ellipse(x, y, rx, r, 0, Math.PI / 2, -Math.PI / 2, k > 0);
  } else {
    g.arc(x, y, r, Math.PI / 2, (3 * Math.PI) / 2, false);
    if (k > 0) g.ellipse(x, y, rx, r, 0, (3 * Math.PI) / 2, Math.PI / 2, true);
    else g.ellipse(x, y, rx, r, 0, -Math.PI / 2, Math.PI / 2, false);
  }
  g.fill();
  g.strokeStyle = COL.ink3;
  g.lineWidth = 0.8;
  g.beginPath();
  g.arc(x, y, r, 0, 7);
  g.stroke();
}

/** 今日の月の形（ページ上の小さなキャンバス） */
export function drawToday(c: HTMLCanvasElement, el: number): void {
  const s = surface(c);
  if (!s) return;
  moonPhase(s.g, s.w / 2, s.h / 2, Math.min(s.w, s.h) / 2 - 2, el);
}

/* ---------- 月と太陽の引力 ---------- */
export interface SkyFig {
  sun: boolean;
  /** 矢印: 月の引力そのもの（pull）か中心との差（diff）。sE は 0→1 で切り替えの途中 */
  arrows: 'pull' | 'diff';
  sE: number;
  /** 月の向き・港の向き [rad]、月の距離（地球の半径の倍数）、太陽の潮汐力の比 */
  moonTh: number;
  portTh: number;
  moonD: number;
  sunK: number;
  ring: Ring;
  shio: Shio;
  /** 港の札（満潮・満ち潮・干潮・引き潮） */
  portTag: string;
  /** 水の粒を描く（動きを減らす設定では描かない） */
  drops: boolean;
}
export interface SkyGeo {
  cx: number;
  cy: number;
  R: number;
  w: number;
  h: number;
}
/** 太陽ありの図で月を置く距離（地球の半径の倍数）。図に収めるため縮める */
export const MOON_D_SUN = 3.3;

export function drawSky(c: HTMLCanvasElement, f: SkyFig): SkyGeo | null {
  const s = surface(c);
  if (!s) return null;
  const { g, w, h } = s;
  spaceBg(g, w, h);
  const R = w * 0.12,
    cx = w * (f.sun ? 0.56 : 0.5),
    cy = h * 0.5,
    Rs = R * 1.3,
    mR = Math.max(10, R * 0.22),
    md = (f.sun ? MOON_D_SUN : f.moonD) * R,
    ma = f.moonTh;
  /* 高さの誇張: 低い所でも海面が陸より上に残るよう、引き潮の深さに合わせて倍率を抑える */
  let lo = 0;
  for (const v of f.ring.eta) lo = Math.min(lo, v);
  const kE = Math.min(R * 1.47, (R * 0.2) / Math.max(1e-6, -lo));
  if (f.sun) {
    g.fillStyle = COL.sun;
    g.beginPath();
    g.arc(-w * 0.02, cy, w * 0.08, 0, 7);
    g.fill();
    txt(g, '太陽', w * 0.075, cy + w * 0.08 + 18, { col: ON_SPACE, size: 15, w: 700, halo: COL.space });
    g.strokeStyle = 'rgba(255,255,255,.22)';
    g.setLineDash([3, 4]);
    g.lineWidth = 1;
    g.beginPath();
    g.arc(cx, cy, md, 0, 7);
    g.stroke();
    g.setLineDash([]);
  }
  /* 海（浅水波の計算結果）と平均の海面 */
  seaPath(g, cx, cy, Rs, kE, (th) => ringEta(f.ring, th));
  g.fillStyle = COL.sea;
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,.45)';
  g.setLineDash([4, 4]);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(cx, cy, Rs, 0, 7);
  g.stroke();
  g.setLineDash([]);
  if (f.drops) {
    g.fillStyle = 'rgba(255,255,255,.8)';
    for (const p of f.ring.tr) {
      const top = Rs + kE * ringEta(f.ring, p.a),
        r = R + (top - R) * p.r;
      g.beginPath();
      g.arc(cx + r * Math.cos(p.a), cy - r * Math.sin(p.a), 1.6, 0, 7);
      g.fill();
    }
  }
  /* 地球: 写真を港の経度に合わせて回す。写真が届くまでは陸の色の円 */
  const earth = TEX.earth ? polarOf('e', TEX.earth, Math.round(2 * R * dpr())) : null;
  if (earth) {
    g.save();
    g.translate(cx, cy);
    g.rotate(-(f.portTh - PORT_LON_RAD));
    g.drawImage(earth, -R, -R, 2 * R, 2 * R);
    g.restore();
  } else {
    g.fillStyle = COL.land;
    g.beginPath();
    g.arc(cx, cy, R, 0, 7);
    g.fill();
  }
  /* 夜の側（太陽は左） */
  if (f.sun) {
    g.fillStyle = 'rgba(0,0,0,.3)';
    g.beginPath();
    g.arc(cx, cy, Rs + R * 0.5, -Math.PI / 2, Math.PI / 2);
    g.closePath();
    g.fill();
  }
  /* 自転の向き（北極の上から見て反時計回り） */
  const ra = R * 0.5;
  g.strokeStyle = 'rgba(255,255,255,.75)';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(cx, cy, ra, -2.2, -0.5);
  g.stroke();
  arrow(
    g,
    cx + ra * Math.cos(2.05),
    cy - ra * Math.sin(2.05),
    cx + ra * Math.cos(2.35),
    cy - ra * Math.sin(2.35),
    'rgba(255,255,255,.85)',
    2,
    8,
  );
  txt(g, '地球', cx, cy + R * 0.25 + 5, { al: 'center', col: ON_SPACE, w: 700, halo: 'rgba(0,0,0,.55)' });
  /* 月 */
  const mx = cx + md * Math.cos(ma),
    my = cy - md * Math.sin(ma);
  g.strokeStyle = 'rgba(255,255,255,.5)';
  g.setLineDash([2, 3]);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(mx, my, mR + 6, 0, 7);
  g.stroke();
  g.setLineDash([]);
  const moon = TEX.moon ? polarOf('m', TEX.moon, Math.round(2 * mR * dpr())) : null;
  if (moon) {
    /* 表側（月面の経度 0）を地球へ向ける。太陽ありでは太陽と反対の半分を暗くする */
    g.save();
    g.translate(mx, my);
    g.rotate(-(ma + Math.PI));
    g.drawImage(moon, -mR, -mR, 2 * mR, 2 * mR);
    g.restore();
    if (f.sun) {
      g.fillStyle = 'rgba(8,10,16,.8)';
      g.beginPath();
      g.arc(mx, my, mR + 0.5, -Math.PI / 2, Math.PI / 2);
      g.closePath();
      g.fill();
    }
  } else if (f.sun) moonTop(g, mx, my, mR);
  else {
    g.fillStyle = COL.moon;
    g.beginPath();
    g.arc(mx, my, mR, 0, 7);
    g.fill();
  }
  txt(g, '月', mx, my - mR - 10, { al: 'center', col: ON_SPACE, w: 700, size: 15, halo: COL.space });
  /* 力の矢印: 月は位置ごとの引力と中心の引力の差、太陽は遠いので潮汐の近似 k(3(p·n)n − p) */
  const gm = (x: number, y: number): [number, number] => {
    const dx = Math.cos(ma) * f.moonD - x,
      dy = Math.sin(ma) * f.moonD - y,
      r3 = Math.hypot(dx, dy) ** 3;
    return [dx / r3, dy / r3];
  };
  const gc = gm(0, 0),
    ks = f.sun ? f.sunK / f.moonD ** 3 : 0;
  const vec = ([x, y]: [number, number]): [number, number] => {
    const [gx, gy] = gm(x, y);
    if (f.arrows === 'pull') return [gx - f.sE * gc[0], gy - f.sE * gc[1]];
    return [gx - gc[0] + ks * 2 * x, gy - gc[1] - ks * y];
  };
  const pts: [number, number][] = [[0, 0]];
  for (let i = 0; i < 12; i++)
    pts.push([0.78 * Math.cos(ma + (i * Math.PI) / 6), 0.78 * Math.sin(ma + (i * Math.PI) / 6)]);
  const vmax = Math.max(...pts.map((p) => Math.hypot(...vec(p)))),
    sc = Math.min(11, 1.6 / vmax) * R;
  for (const q of pts) {
    const [vx, vy] = vec(q),
      x0 = cx + q[0] * R,
      y0 = cy - q[1] * R;
    arrow(g, x0, y0, x0 + vx * sc, y0 - vy * sc, q[0] || q[1] ? COL.on : '#fff', 2, 8);
  }
  /* 港: 地球の表面の点と、港の上の海の深さ（港から海面までの線と海面の印）、満ち引きの札 */
  const tp = f.portTh,
    ux = Math.cos(tp),
    uy = -Math.sin(tp),
    rp = Rs + kE * ringEta(f.ring, tp),
    px = cx + R * ux,
    py = cy + R * uy,
    sx = cx + rp * ux,
    sy = cy + rp * uy;
  g.strokeStyle = '#fff';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(px, py);
  g.lineTo(sx, sy);
  g.moveTo(sx - uy * 7, sy + ux * 7);
  g.lineTo(sx + uy * 7, sy - ux * 7);
  g.stroke();
  g.fillStyle = COL.hi;
  g.beginPath();
  g.arc(px, py, 6.5, 0, 7);
  g.fill();
  g.strokeStyle = '#fff';
  g.lineWidth = 2;
  g.stroke();
  const lr = rp + 30,
    lx = Math.min(w - 30, Math.max(30, cx + lr * Math.cos(tp))),
    ly = Math.min(h - 26, Math.max(20, cy - lr * Math.sin(tp)));
  txt(g, '港', lx, ly - 2, { al: 'center', col: ON_SPACE, w: 700, size: 15, halo: COL.space });
  const tagCol = f.portTag === '満潮' ? HI_SPACE : f.portTag === '干潮' ? LO_SPACE : ON_SPACE2;
  txt(g, f.portTag, lx, ly + 16, { al: 'center', col: tagCol, w: 700, size: 13, halo: COL.space });
  if (f.sun) {
    const col = f.shio === '大潮' ? HI_SPACE : f.shio === '小潮' ? LO_SPACE : ON_SPACE;
    txt(g, f.shio, 14, 32, { size: 22, w: 700, col, halo: COL.space });
  }
  txt(g, f.sun ? '月の距離と大きさは縮めて表示' : '月の距離は縮めて表示', w - 10, h - 10, {
    al: 'right',
    col: ON_SPACE2,
    size: 12,
    halo: COL.space,
  });
  if (!f.sun)
    txt(g, 'ドラッグで移動', Math.min(w - 50, Math.max(50, mx)), my + mR + 24, {
      al: 'center',
      col: ON_SPACE2,
      size: 12,
      halo: COL.space,
    });
  return { cx, cy, R, w, h };
}

/* ---------- 港の潮位 ---------- */
export type Span = 'day' | 'week' | 'month';
export interface GraphFig {
  span: Span;
  x0: number;
  x1: number;
  curve: readonly [number, number][];
  ex: readonly { ms: number; v: number; hi: boolean }[];
  marks: readonly { ms: number; q: 0 | 1 | 2 | 3 }[];
  /** 再生位置・今 [ms] と、再生位置の潮位 [cm] */
  t: number;
  now: number;
  v: number;
}
const WD = '日月火水木金土';
const jst = (ms: number): Date => new Date(ms + 9 * 3600000);
const hm = (ms: number): string => {
  const d = jst(ms);
  return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

/** 港の潮位を描き、横軸の左右の端の位置 [px] を返す（押した位置を時刻に直すのに使う） */
export function drawGraph(c: HTMLCanvasElement, f: GraphFig): { left: number; right: number } | null {
  const s = surface(c);
  if (!s) return null;
  const { g, w, h } = s,
    narrow = w < 480,
    yr = [-35, 65],
    L = 42,
    Rr = 8,
    T = 24,
    B = f.span === 'day' ? 28 : 56,
    DAY = 86400000;
  const X = (t: number) => L + ((t - f.x0) / (f.x1 - f.x0)) * (w - L - Rr),
    Y = (v: number) => T + ((yr[1] - v) / (yr[1] - yr[0])) * (h - T - B);
  g.fillStyle = COL.inset;
  g.fillRect(L, T, w - L - Rr, h - T - B);
  g.lineWidth = 1;
  for (let v = -20; v <= 60; v += 20) {
    g.strokeStyle = COL.grid;
    g.beginPath();
    g.moveTo(L, Y(v));
    g.lineTo(w - Rr, Y(v));
    g.stroke();
    txt(g, (v > 0 ? '+' : '') + v, L - 6, Y(v) + 4, { al: 'right', col: COL.ink3, mono: true });
  }
  const vline = (x: number) => {
    g.strokeStyle = COL.grid;
    g.beginPath();
    g.moveTo(x, T);
    g.lineTo(x, h - B);
    g.stroke();
  };
  if (f.span === 'day')
    for (let hh = 0; hh <= 24; hh += narrow ? 6 : 3) {
      const x = X(f.x0 + hh * 3600000);
      vline(x);
      txt(g, `${hh}時`, x, h - B + 16, {
        al: hh === 0 ? 'left' : hh === 24 ? 'right' : 'center',
        col: COL.ink3,
        size: 12,
      });
    }
  if (f.span === 'week')
    for (let d = 0; d < 7; d++) {
      const u = f.x0 + d * DAY,
        dd = jst(u);
      vline(X(u));
      txt(
        g,
        narrow ? WD[dd.getUTCDay()] : `${dd.getUTCDate()}日（${WD[dd.getUTCDay()]}）`,
        X(u + DAY / 2),
        h - B + 16,
        { al: 'center', col: COL.ink3, size: 12 },
      );
    }
  if (f.span === 'month') {
    const ds = w - L - Rr < 380 ? 10 : 5;
    for (let d = 0; d <= 30; d += ds) {
      const u = f.x0 + d * DAY,
        dd = jst(u);
      txt(g, `${dd.getUTCMonth() + 1}/${dd.getUTCDate()}`, X(u), h - B + 16, {
        al: d === 0 ? 'left' : d === 30 ? 'right' : 'center',
        col: COL.ink3,
        mono: true,
      });
    }
  }
  /* 潮位の線（再生位置より前は濃く） */
  const path = () => {
    g.beginPath();
    for (const [i, [t, v]] of f.curve.entries()) {
      if (i) g.lineTo(X(t), Y(v));
      else g.moveTo(X(t), Y(v));
    }
  };
  path();
  g.strokeStyle = COL.sea;
  g.lineWidth = f.span === 'month' ? 1.2 : 2;
  g.stroke();
  g.save();
  g.beginPath();
  g.rect(L, T, Math.max(0, X(f.t) - L), h - T - B);
  g.clip();
  path();
  g.strokeStyle = COL.ink;
  g.stroke();
  g.restore();
  for (const p of f.ex) {
    const x = X(p.ms),
      y = Y(p.v);
    g.fillStyle = p.hi ? COL.hi : COL.lo;
    g.beginPath();
    g.arc(x, y, f.span === 'day' ? 4.5 : 3, 0, 7);
    g.fill();
    if (f.span === 'day')
      txt(g, hm(p.ms), x, p.hi ? y - 9 : y + 19, {
        al: 'center',
        col: p.hi ? COL.hi : COL.lo,
        mono: true,
        w: 700,
        size: 13,
      });
  }
  /* 今の印と再生位置 */
  if (f.now >= f.x0 && f.now <= f.x1) {
    const xt = X(f.now);
    g.strokeStyle = COL.ink;
    g.lineWidth = 1.5;
    g.setLineDash([4, 3]);
    g.beginPath();
    g.moveTo(xt, T);
    g.lineTo(xt, h - B);
    g.stroke();
    g.setLineDash([]);
    txt(g, f.span === 'day' ? '今' : '今日', Math.min(w - Rr - 16, Math.max(L + 16, xt)), T - 8, {
      al: 'center',
      w: 700,
      size: 13,
    });
  }
  const xn = X(f.t);
  g.strokeStyle = COL.on;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(xn, T);
  g.lineTo(xn, h - B);
  g.stroke();
  g.fillStyle = COL.on;
  g.beginPath();
  g.arc(xn, Y(f.v), 5, 0, 7);
  g.fill();
  for (const m of f.marks) {
    const x = X(m.ms),
      spring = m.q === 0 || m.q === 2;
    moonPhase(g, x, h - B + 32, 7, m.q * 90);
    txt(g, spring ? '大潮' : '小潮', x, h - B + 53, { al: 'center', col: spring ? COL.hi : COL.lo, w: 700, size: 13 });
  }
  return { left: L, right: w - Rr };
}
