/**
 * ラプラス変換のページ。6 章が 1 つの点 s を共有する。
 * 1〜3 章は s が表す波 e^{st}、4〜6 章は s と s̄ を極に持つ系の |H(s)| の曲面・虚軸の断面・収束域。
 * 図はすべて canvas。見えている章だけ描き、時間で動く図は動きを減らす設定では描き終えた絵にする
 */
import { initToolPage } from '../../lib/tool-page';
import { areaAll, areaCum, C, type Cx, H, h, RANGE, reWave, snap } from './math';
import { initChapterNav } from './nav';

initToolPage();
initChapterNav();

type G = CanvasRenderingContext2D;
const root = document.getElementById('lap') as HTMLElement;
const TAU = 2 * Math.PI;
const MINUS = '−';
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- 数の書式 ---------- */
function fmt(v: number, d = 2): string {
  if (!Number.isFinite(v)) return '∞';
  const s = Math.abs(v).toFixed(d);
  if (+s === 0) return (0).toFixed(d);
  return (v < 0 ? MINUS : '') + s;
}
/** 共役の対は「−0.30 ± 6.28j」、実数なら「−0.30」 */
const fmtPair = (p: Cx, d = 2): string =>
  Math.abs(p[1]) < 1e-9 ? fmt(p[0], d) : `${fmt(p[0], d)} ± ${Math.abs(p[1]).toFixed(d)}j`;
const fmtC = (p: Cx, d = 2): string =>
  Math.abs(p[1]) < 1e-9 ? fmt(p[0], d) : `${fmt(p[0], d)} ${p[1] < 0 ? MINUS : '+'} ${Math.abs(p[1]).toFixed(d)}j`;
/** 目盛り: 整数なら小数なし、0.1 刻みなら 1 桁 */
const fmtT = (y: number): string =>
  fmt(y, Math.abs(y - Math.round(y)) < 1e-9 ? 0 : Math.abs(y * 10 - Math.round(y * 10)) < 1e-9 ? 1 : 2);
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
/** 1・1.5・2・3・4・5・6・8 の刻みへ切り上げる */
function nice2(v: number): number {
  const e = 10 ** Math.floor(Math.log10(v)),
    f = v / e;
  return ([1, 1.5, 2, 3, 4, 5, 6, 8, 10].find((x) => f <= x + 1e-9) ?? 10) * e;
}
/** 1・2・5 の刻みへ切り上げる */
function nice(v: number): number {
  const e = 10 ** Math.floor(Math.log10(v)),
    f = v / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e;
}

/* ---------- 色と書体（テーマを替えたら読み直す） ---------- */
const K = {
  scr: '',
  inset: '',
  line2: '',
  ink: '',
  ink2: '',
  ink3: '',
  ch2: '',
  warn: '',
  grid: '',
  on: '',
  ons: '',
  tl: '',
  tr: '',
  hatch: '',
  b: [] as number[][],
  sans: 'sans-serif',
  mono: 'monospace',
  math: 'serif',
};
const rgb = (hx: string): number[] => {
  const n = Number.parseInt(hx.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
function readCols(): void {
  const cs = getComputedStyle(root),
    v = (k: string) => cs.getPropertyValue(k).trim();
  Object.assign(K, {
    scr: v('--screen'),
    inset: v('--inset'),
    line2: v('--line-2'),
    ink: v('--ink'),
    ink2: v('--ink-2'),
    ink3: v('--ink-3'),
    ch2: v('--ch2'),
    warn: v('--warn'),
    grid: v('--grid'),
    on: v('--lap-on'),
    ons: v('--lap-ons'),
    tl: v('--lap-tl'),
    tr: v('--lap-tr'),
    hatch: v('--lap-hatch'),
    b: [0, 1, 2, 3, 4, 5, 6].map((i) => rgb(v(`--lap-b${i}`))),
    sans: v('--sans') || 'sans-serif',
    mono: v('--mono') || 'monospace',
    math: v('--math') || 'serif',
  });
}
const fM = (px: number): string => `italic ${px}px ${K.math}`;
const fN = (px: number, wt = 600): string => `${wt} ${px}px ${K.mono}`;
const fS = (px: number, wt = 500): string => `${wt} ${px}px ${K.sans}`;

/* ---------- 描く道具 ---------- */
function ln(c: G, x0: number, y0: number, x1: number, y1: number, col: string, w = 1, dash: number[] = []): void {
  c.beginPath();
  c.moveTo(x0, y0);
  c.lineTo(x1, y1);
  c.strokeStyle = col;
  c.lineWidth = w;
  c.setLineDash(dash);
  c.stroke();
  c.setLineDash([]);
}
function head(c: G, x: number, y: number, a: number, col: string, hs = 8): void {
  c.beginPath();
  c.moveTo(x, y);
  c.lineTo(x - hs * Math.cos(a - 0.42), y - hs * Math.sin(a - 0.42));
  c.lineTo(x - hs * Math.cos(a + 0.42), y - hs * Math.sin(a + 0.42));
  c.closePath();
  c.fillStyle = col;
  c.fill();
}
function arrow(c: G, x0: number, y0: number, x1: number, y1: number, col: string, w = 2, hs = 9): void {
  const L = Math.hypot(x1 - x0, y1 - y0);
  if (L < 0.5) return;
  const a = Math.atan2(y1 - y0, x1 - x0),
    k = Math.min(hs, L * 0.6);
  ln(c, x0, y0, x1 - Math.cos(a) * k * 0.7, y1 - Math.sin(a) * k * 0.7, col, w);
  head(c, x1, y1, a, col, k);
}
interface TxOpt {
  font?: string;
  col?: string;
  al?: CanvasTextAlign;
  halo?: boolean;
}
function tx(c: G, s: string, x: number, y: number, o: TxOpt = {}): void {
  c.font = o.font ?? fS(13);
  c.textAlign = o.al ?? 'left';
  c.textBaseline = 'alphabetic';
  if (o.halo !== false) {
    c.lineWidth = 4;
    c.strokeStyle = K.scr;
    c.lineJoin = 'round';
    c.strokeText(s, x, y);
  }
  c.fillStyle = o.col ?? K.ink2;
  c.fillText(s, x, y);
}
function cross(c: G, x: number, y: number, col: string, r = 7, w = 2.6): void {
  ln(c, x - r, y - r, x + r, y + r, col, w);
  ln(c, x - r, y + r, x + r, y - r, col, w);
}
function dot(c: G, x: number, y: number, col: string, r = 6.5): void {
  c.beginPath();
  c.arc(x, y, r + 2.5, 0, TAU);
  c.fillStyle = K.scr;
  c.fill();
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fillStyle = col;
  c.fill();
}
function hatch(c: G, x0: number, y0: number, x1: number, y1: number, col: string, gap = 8): void {
  c.save();
  c.beginPath();
  c.rect(x0, y0, x1 - x0, y1 - y0);
  c.clip();
  c.strokeStyle = col;
  c.lineWidth = 1;
  c.beginPath();
  for (let k = -(y1 - y0); k < x1 - x0; k += gap) {
    c.moveTo(x0 + k, y1);
    c.lineTo(x0 + k + (y1 - y0), y0);
  }
  c.stroke();
  c.restore();
}
const tick12 = (c: G, s: string, x: number, y: number, al: CanvasTextAlign = 'center'): void =>
  tx(c, s, x, y, { font: fN(12, 500), col: K.ink3, al, halo: false });

/** 平面: 値 ⇔ 画素 */
class Plane {
  L = 0;
  R = 0;
  T = 0;
  B = 0;
  constructor(
    readonly x0: number,
    readonly x1: number,
    readonly y0: number,
    readonly y1: number,
    readonly pad = { l: 34, r: 16, t: 16, b: 26 },
  ) {}
  set(w: number, hh: number): this {
    this.L = this.pad.l;
    this.R = w - this.pad.r;
    this.T = this.pad.t;
    this.B = hh - this.pad.b;
    return this;
  }
  X(x: number): number {
    return this.L + ((x - this.x0) / (this.x1 - this.x0)) * (this.R - this.L);
  }
  Y(y: number): number {
    return this.B - ((y - this.y0) / (this.y1 - this.y0)) * (this.B - this.T);
  }
  ix(px: number): number {
    return this.x0 + ((px - this.L) / (this.R - this.L)) * (this.x1 - this.x0);
  }
  iy(py: number): number {
    return this.y0 + ((this.B - py) / (this.B - this.T)) * (this.y1 - this.y0);
  }
}

/** s 平面の地: 目盛り・矢じり付きの軸・軸の名前 */
function axes(c: G, pl: Plane): void {
  c.save();
  c.beginPath();
  c.rect(pl.L, pl.T, pl.R - pl.L, pl.B - pl.T);
  c.clip();
  for (let x = -2; x <= 2 + 1e-9; x += 0.5) ln(c, pl.X(x), pl.T, pl.X(x), pl.B, K.grid);
  for (let y = -10; y <= 10; y += 2) ln(c, pl.L, pl.Y(y), pl.R, pl.Y(y), K.grid);
  c.restore();
  const X0 = pl.X(0),
    Y0 = pl.Y(0);
  arrow(c, pl.L, Y0, pl.R + 8, Y0, K.ink3, 1.4, 8);
  arrow(c, X0, pl.B, X0, pl.T - 8, K.ink3, 1.4, 8);
  tx(c, 'σ', pl.R + 4, Y0 - 8, { font: fM(16), col: K.ink, al: 'right' });
  tx(c, 'jω', X0 + 8, pl.T + 6, { font: fM(16), col: K.ink });
  for (const x of [-2, -1, 1, 2]) tick12(c, x.toFixed(1).replace('-', MINUS), pl.X(x), pl.B + 16);
  for (const y of [-8, -4, 0, 4, 8]) tick12(c, fmt(y, 0), pl.L - 5, pl.Y(y) + 4, 'right');
}

/* ---------- 図と章 ---------- */
class Fig {
  readonly g: G;
  w = 0;
  hh = 0;
  dirty = true;
  constructor(
    readonly cv: HTMLCanvasElement,
    readonly hf: (w: number) => number,
    readonly paint: (c: G, w: number, hh: number) => void,
  ) {
    this.g = cv.getContext('2d') as G;
    new ResizeObserver(() => this.resize()).observe(cv.parentElement as HTMLElement);
  }
  resize(): void {
    const w = Math.round((this.cv.parentElement as HTMLElement).clientWidth);
    if (!w) return;
    const hh = Math.round(this.hf(w)),
      d = Math.min(2, devicePixelRatio || 1);
    if (w === this.w && hh === this.hh) return;
    this.w = w;
    this.hh = hh;
    this.cv.style.height = `${hh}px`;
    this.cv.width = Math.round(w * d);
    this.cv.height = Math.round(hh * d);
    this.g.setTransform(d, 0, 0, d, 0, 0);
    this.dirty = true;
  }
  draw(): void {
    if (!this.w) return;
    this.dirty = false;
    const c = this.g;
    c.clearRect(0, 0, this.w, this.hh);
    c.fillStyle = K.scr;
    c.fillRect(0, 0, this.w, this.hh);
    c.save();
    this.paint(c, this.w, this.hh);
    c.restore();
  }
}
interface Ch {
  el: HTMLElement;
  hl: string | null;
  figs: Fig[];
  vis: boolean;
  dyn: HTMLElement;
  tick?: (dt: number) => void;
}
const CHS: Ch[] = [];
function chapter(n: number): Ch {
  const el = root.querySelector(`[data-ch="${n}"]`) as HTMLElement;
  const ch: Ch = { el, hl: null, figs: [], vis: true, dyn: el.querySelector('.lap-dyn') as HTMLElement };
  const eq = el.querySelector('.eqs');
  if (eq) {
    const set = (k: string | null) => {
      ch.hl = k;
      for (const m of eq.querySelectorAll<HTMLElement>('[data-hl]')) m.classList.toggle('hl', m.dataset.hl === k);
      redraw(ch);
    };
    eq.addEventListener('pointerover', (e) =>
      set((e.target as Element).closest<HTMLElement>('[data-hl]')?.dataset.hl ?? null),
    );
    eq.addEventListener('pointerleave', () => set(null));
    eq.addEventListener('click', (e) => {
      const k = (e.target as Element).closest<HTMLElement>('[data-hl]')?.dataset.hl ?? null;
      set(k && ch.hl !== k ? k : null);
    });
  }
  new IntersectionObserver(
    (es) => {
      ch.vis = es[0].isIntersecting;
    },
    { rootMargin: '120px' },
  ).observe(el);
  CHS.push(ch);
  return ch;
}
const redraw = (ch: Ch): void => {
  for (const f of ch.figs) f.dirty = true;
};
function fig(ch: Ch, i: number, hf: (w: number) => number, paint: (c: G, w: number, hh: number) => void): Fig {
  const cv = ch.el.querySelectorAll('canvas')[i] as HTMLCanvasElement;
  const f = new Fig(cv, hf, paint);
  ch.figs.push(f);
  return f;
}

/* ---------- 状態 ---------- */
const S = { s: [-0.3, TAU] as Cx, phi: [0.5, 0.42] };
const pole = (): Cx => [S.s[0], Math.abs(S.s[1])];

/* ---------- s 平面（点か、極 ×） ---------- */
interface SOpt {
  conj?: boolean;
  pz?: boolean;
  cut?: boolean;
  roc?: boolean;
}
/** 数値の札を左に置くか。虚軸をまたがず、枠からはみ出さない側を選ぶ */
function labelLeft(pl: Plane, a: number, wd: number): boolean {
  const px = pl.X(a),
    ax = pl.X(0);
  const leftOk = px - wd > pl.L - 30 && !(px > ax && px - wd < ax);
  const rightOk = px + wd < pl.R + 10 && !(px < ax && px + wd > ax);
  if (leftOk !== rightOk) return leftOk;
  return px > (pl.L + pl.R) / 2;
}
function sPlane(ch: Ch, i: number, o: SOpt = {}): Fig {
  const pl = new Plane(...RANGE);
  const f = fig(
    ch,
    i,
    (w) => clamp(w * 0.86, 230, 340),
    (c, w, hh) => {
      pl.set(w, hh);
      const s = S.s;
      if (o.roc) {
        const xb = pl.X(s[0]);
        c.fillStyle = K.tl;
        c.fillRect(xb, pl.T, pl.R - xb, pl.B - pl.T);
        hatch(c, pl.L, pl.T, xb, pl.B, K.hatch);
      } else {
        c.fillStyle = K.tl;
        c.fillRect(pl.L, pl.T, pl.X(0) - pl.L, pl.B - pl.T);
        c.fillStyle = K.tr;
        c.fillRect(pl.X(0), pl.T, pl.R - pl.X(0), pl.B - pl.T);
      }
      axes(c, pl);
      if (o.roc) {
        const xb = pl.X(s[0]),
          inAx = s[0] < 0;
        ln(c, pl.X(0), pl.T, pl.X(0), pl.B, inAx ? K.on : K.warn, 2.6, inAx ? [] : [5, 4]);
        ln(c, xb, pl.T, xb, pl.B, ch.hl === 'roc' ? K.ch2 : K.ink, 2, [6, 4]);
        const right = xb < pl.R - 60;
        tx(c, '収束域', right ? xb + 8 : xb - 8, pl.B - 10, {
          font: fS(13, 700),
          col: K.ch2,
          al: right ? 'left' : 'right',
        });
      } else if (o.cut) {
        ln(c, pl.X(0), pl.T, pl.X(0), pl.B, K.on, 2.6);
        tx(c, '切る所', pl.X(0) + 6, pl.B - 8, { font: fS(12, 700), col: K.on });
      } else {
        tx(c, '減衰', pl.L + 8, pl.B - 8, { font: fS(13, 600), col: K.ch2 });
        tx(c, '増大', pl.R - 8, pl.B - 8, { font: fS(13, 600), col: K.on, al: 'right' });
        tx(c, '振幅一定', pl.X(0), pl.B - 8, { font: fS(12, 600), col: K.ink2, al: 'center' });
      }
      if (o.pz) {
        const hp = ch.hl === 'den';
        for (const sg of [1, -1]) cross(c, pl.X(s[0]), pl.Y(sg * s[1]), hp ? K.ch2 : K.ink, 7, hp ? 3.2 : 2.6);
        const lx = labelLeft(pl, s[0], 150) ? -12 : 12;
        tx(c, fmtPair(pole()), pl.X(s[0]) + lx, pl.Y(Math.abs(s[1])) - 12, {
          font: fN(15),
          col: K.ink,
          al: lx < 0 ? 'right' : 'left',
        });
      } else {
        if (o.conj) {
          ln(c, pl.X(s[0]), pl.Y(s[1]), pl.X(s[0]), pl.Y(-s[1]), K.ink3, 1, [3, 3]);
          dot(c, pl.X(s[0]), pl.Y(-s[1]), K.ch2, 6);
          tx(c, 's̄', pl.X(s[0]) + 10, pl.Y(-s[1]) + 5, { font: fM(17), col: K.ch2 });
        }
        dot(c, pl.X(s[0]), pl.Y(s[1]), K.on, 6.5);
        const lx = labelLeft(pl, s[0], 170) ? -10 : 10;
        tx(c, `s = ${fmtC(s)}`, pl.X(s[0]) + lx, pl.Y(s[1]) - 11, {
          font: fN(15),
          col: K.on,
          al: lx < 0 ? 'right' : 'left',
        });
      }
    },
  );
  const cv = f.cv,
    two = !!(o.conj || o.pz);
  const pos = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = cv.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  /** 点の近くか。近ければ持つ点（0: s、1: s̄） */
  const near = (x: number, y: number): number | null => {
    const d0 = Math.hypot(x - pl.X(S.s[0]), y - pl.Y(S.s[1])),
      d1 = two ? Math.hypot(x - pl.X(S.s[0]), y - pl.Y(-S.s[1])) : 1e9;
    const d = Math.min(d0, d1);
    return d < 30 ? (d1 < d0 && S.s[1] !== 0 ? 1 : 0) : null;
  };
  const moveTo = (k: number, x: number, y: number) => {
    const b = pl.iy(y);
    setS(snap(pl.ix(x), k === 1 ? -b : b));
  };
  let act: number | null = null,
    tap: [number, number] | null = null;
  // 点の上で始めたタッチはスクロールさせずに動かす。それ以外はスクロールに任せ、軽く触れただけなら点をそこへ移す
  cv.addEventListener(
    'touchstart',
    (e) => {
      const t = e.touches[0];
      if (t && near(...pos(t)) != null) e.preventDefault();
    },
    { passive: false },
  );
  cv.addEventListener('pointerdown', (e) => {
    const [x, y] = pos(e),
      k = near(x, y);
    if (k == null && e.pointerType !== 'mouse') {
      tap = [x, y];
      return;
    }
    act = k ?? (two && pl.iy(y) < 0 && S.s[1] !== 0 ? 1 : 0);
    try {
      cv.setPointerCapture(e.pointerId);
    } catch {
      /* 合成のイベント */
    }
    moveTo(act, x, y);
    e.preventDefault();
  });
  cv.addEventListener('pointermove', (e) => {
    const [x, y] = pos(e);
    if (act != null) moveTo(act, x, y);
    else if (tap && Math.hypot(x - tap[0], y - tap[1]) > 8) tap = null;
    else if (e.pointerType === 'mouse') cv.style.cursor = near(x, y) != null ? 'grab' : 'crosshair';
  });
  cv.addEventListener('pointerup', (e) => {
    if (tap) {
      const [x, y] = pos(e);
      moveTo(two && y > pl.Y(0) && S.s[1] !== 0 ? 1 : 0, x, y);
    }
    act = null;
    tap = null;
  });
  cv.addEventListener('pointercancel', () => {
    act = null;
    tap = null;
  });
  cv.addEventListener('keydown', (e) => {
    const d: Record<string, [number, number]> = {
      ArrowLeft: [-0.05, 0],
      ArrowRight: [0.05, 0],
      ArrowUp: [0, 0.25],
      ArrowDown: [0, -0.25],
    };
    const m = d[e.key];
    if (!m) return;
    e.preventDefault();
    setS(snap(S.s[0] + m[0], S.s[1] + m[1]));
  });
  return f;
}

/* ---------- |H(s)| の曲面。cut なら σ > 0 を切り落として断面を塗る ---------- */
const shade = (c: number[], f: number): string => `rgb(${c.map((v) => Math.round(clamp(v * f, 0, 255))).join(',')})`;
const dB = (x: Cx): number => 20 * Math.log10(C.abs(H(S.s, x)) + 1e-12);
function surface(c: G, w: number, hh: number, cut: boolean, phi: number, hl: string | null): void {
  const [S0, S1, W0, W1] = RANGE;
  const s1 = cut ? 0 : S1,
    nx = cut ? 24 : 44,
    ny = 110;
  const Xof = (sg: number) => (sg / 4) * 1.25,
    Yof = (om: number) => om / 10;
  // 高さは対数。下端は全面の値の低い方から 3 % の所、上端は極から 0.06 離れた所の高さ
  const all: number[] = [];
  for (let i = 0; i <= 40; i++) for (let j = 0; j <= 100; j++) all.push(dB([S0 + (4 * i) / 40, W0 + (20 * j) / 100]));
  all.sort((a, b) => a - b);
  const [pa, pb] = pole();
  const lo = all[Math.floor(all.length * 0.03)],
    hi = Math.max(lo + 20, dB([pa + 0.06, pb]));
  const Z: number[][] = [];
  for (let i = 0; i <= nx; i++) {
    const row: number[] = [];
    const sg = S0 + ((s1 - S0) * i) / nx;
    for (let j = 0; j <= ny; j++) {
      const v = dB([sg, W0 + ((W1 - W0) * j) / ny]);
      row.push((clamp(Number.isFinite(v) ? v : hi, lo, hi) - lo) / (hi - lo));
    }
    Z.push(row);
  }
  const cp = Math.cos(phi),
    sp = Math.sin(phi),
    sE = 0.5,
    cE = 0.866,
    hz = 0.85;
  const pr = (X: number, Y: number, Zz: number): [number, number, number] => [
    Y * cp + X * sp,
    (X * cp - Y * sp) * sE - Zz * cE * hz,
    X * cp - Y * sp,
  ];
  let x0 = 1e9,
    x1 = -1e9,
    y0 = 1e9,
    y1 = -1e9;
  for (const X of [Xof(S0), Xof(S1)])
    for (const Y of [-1, 1])
      for (const Zz of [0, 1]) {
        const [a, b] = pr(X, Y, Zz);
        x0 = Math.min(x0, a);
        x1 = Math.max(x1, a);
        y0 = Math.min(y0, b);
        y1 = Math.max(y1, b);
      }
  const sc = Math.min((w - 70) / (x1 - x0), (hh - 50) / (y1 - y0)),
    ox = (w - (x1 + x0) * sc) / 2,
    oy = 18 + (hh - 50 - (y1 - y0) * sc) / 2 - y0 * sc;
  const P2 = (X: number, Y: number, Zz: number): [number, number] => {
    const [a, b] = pr(X, Y, Zz);
    return [ox + a * sc, oy + b * sc];
  };
  const poly = (pts: [number, number][]) => {
    c.beginPath();
    for (const p of pts) c.lineTo(...p);
    c.closePath();
  };
  // 床（切り落とした側も床は残す）
  poly(
    (
      [
        [S0, -1],
        [S0, 1],
        [S1, 1],
        [S1, -1],
      ] as const
    ).map(([sg, Y]) => P2(Xof(sg), Y, 0)),
  );
  c.fillStyle = K.inset;
  c.fill();
  c.strokeStyle = K.line2;
  c.lineWidth = 1;
  c.stroke();
  // 面は奥から塗る
  const L = [0.45, -0.35, 0.82];
  const q: { d: number; pts: [number, number][]; col: number[]; f: number }[] = [];
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      const sa = S0 + ((s1 - S0) * i) / nx,
        sb = S0 + ((s1 - S0) * (i + 1)) / nx,
        oa = W0 + ((W1 - W0) * j) / ny,
        ob = W0 + ((W1 - W0) * (j + 1)) / ny;
      const Xa = Xof(sa),
        Xb = Xof(sb),
        Ya = Yof(oa),
        Yb = Yof(ob);
      const z = [Z[i][j], Z[i + 1][j], Z[i + 1][j + 1], Z[i][j + 1]];
      const ux = Xb - Xa,
        vy = Yb - Ya,
        dzx = ((z[1] + z[2] - (z[0] + z[3])) / 2) * hz,
        dzy = ((z[3] + z[2] - (z[0] + z[1])) / 2) * hz;
      const n = [-dzx * vy, -dzy * ux, ux * vy],
        nl = Math.hypot(n[0], n[1], n[2]),
        lit = Math.max(0, (n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / nl);
      const band = clamp(Math.floor(((z[0] + z[1] + z[2] + z[3]) / 4) * 7), 0, 6);
      q.push({
        d: pr((Xa + Xb) / 2, (Ya + Yb) / 2, 0)[2],
        pts: [P2(Xa, Ya, z[0]), P2(Xb, Ya, z[1]), P2(Xb, Yb, z[2]), P2(Xa, Yb, z[3])],
        col: K.b[band],
        f: 0.7 + 0.38 * lit,
      });
    }
  q.sort((a, b) => a.d - b.d);
  for (const o of q) {
    poly(o.pts);
    c.fillStyle = shade(o.col, o.f);
    c.fill();
    c.strokeStyle = shade(o.col, o.f * 0.82);
    c.lineWidth = 0.7;
    c.stroke();
  }
  if (cut) {
    const top = (j: number) => P2(Xof(0), Yof(W0 + ((W1 - W0) * j) / ny), Z[nx][j]);
    c.beginPath();
    for (let j = 0; j <= ny; j++) c.lineTo(...top(j));
    c.lineTo(...P2(Xof(0), 1, 0));
    c.lineTo(...P2(Xof(0), -1, 0));
    c.closePath();
    c.fillStyle = K.ons;
    c.fill();
    c.beginPath();
    for (let j = 0; j <= ny; j++) c.lineTo(...top(j));
    c.strokeStyle = K.on;
    c.lineWidth = hl === 'jw' ? 4.2 : 3;
    c.stroke();
    const lb = P2(Xof(0), 0.62, 0);
    tx(c, '断面', lb[0], lb[1] - 8, { font: fS(13, 700), col: K.on, al: 'center' });
  }
  // 軸
  const a0 = P2(Xof(S1), -1, 0),
    a1 = P2(Xof(S1), 1, 0),
    ea: [number, number] = [a1[0] + (a1[0] - a0[0]) * 0.06, a1[1] + (a1[1] - a0[1]) * 0.06];
  arrow(c, a0[0], a0[1], ea[0], ea[1], K.ink2, 1.4, 8);
  tx(c, 'jω', ea[0] + 4, ea[1] + 16, { font: fM(16), col: K.ink });
  for (const om of [-8, -4, 0, 4, 8]) {
    const p = P2(Xof(S1), Yof(om), 0);
    tick12(c, fmt(om, 0), p[0], p[1] + 16);
  }
  const b0 = P2(Xof(S0), -1, 0),
    b1 = P2(Xof(S1), -1, 0),
    eb: [number, number] = [b1[0] + (b1[0] - b0[0]) * 0.1, b1[1] + (b1[1] - b0[1]) * 0.1];
  arrow(c, b0[0], b0[1], eb[0], eb[1], K.ink2, 1.4, 8);
  tx(c, 'σ', eb[0] - 8, eb[1] + 6, { font: fM(16), col: K.ink, al: 'right' });
  for (const sg of [-2, -1, 0, 1]) {
    const p = P2(Xof(sg), -1, 0);
    tick12(c, fmt(sg, 0), p[0] - 8, p[1] + 4, 'right');
  }
  // 極は曲面の上端に ×
  if (!cut || pa <= 0)
    for (const sg of [1, -1]) {
      if (pb === 0 && sg < 0) continue;
      const t = P2(Xof(pa), Yof(sg * pb), 1);
      cross(c, t[0], t[1], hl === 'den' ? K.ch2 : K.ink, 6, hl === 'den' ? 3 : 2.2);
    }
}
function surfFig(ch: Ch, i: number, cut: boolean, k: number): Fig {
  const f = fig(
    ch,
    i,
    (w) => clamp(w * 0.62, 250, 360),
    (c, w, hh) => {
      surface(c, w, hh, cut, S.phi[k], ch.hl);
      tx(c, '横にドラッグで回転', w - 8, hh - 8, { font: fS(11.5), col: K.ink3, al: 'right', halo: false });
    },
  );
  // 横に動かすと回る。縦はページのスクロールに任せる（touch-action: pan-y）
  let x0: number | null = null,
    p0 = 0;
  f.cv.addEventListener('pointerdown', (e) => {
    x0 = e.clientX;
    p0 = S.phi[k];
    try {
      f.cv.setPointerCapture(e.pointerId);
    } catch {
      /* 合成のイベント */
    }
  });
  f.cv.addEventListener('pointermove', (e) => {
    if (x0 == null) return;
    S.phi[k] = clamp(p0 + (e.clientX - x0) * 0.008, cut ? -1 : -1.3, cut ? 1 : 1.3);
    f.dirty = true;
  });
  const up = () => {
    x0 = null;
  };
  f.cv.addEventListener('pointerup', up);
  f.cv.addEventListener('pointercancel', up);
  f.cv.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    S.phi[k] = clamp(S.phi[k] + (e.key === 'ArrowRight' ? 0.1 : -0.1), cut ? -1 : -1.3, cut ? 1 : 1.3);
    f.dirty = true;
  });
  return f;
}

/* ---------- 1 章: s の 1 点はどんな波か ---------- */
const c1 = chapter(1);
sPlane(c1, 0);
const T1 = 5;
let t1 = still ? T1 : 0;
const wv = fig(
  c1,
  1,
  (w) => clamp(w * 0.62, 230, 340),
  (c, w, hh) => {
    const [a, b] = S.s,
      em = Math.max(1, Math.exp(a * T1)),
      ym = nice(em) * (em > 1.6 ? 1.05 : 1.2);
    const pl = new Plane(0, T1, -ym, ym, { l: 40, r: 22, t: 14, b: 26 }).set(w, hh);
    for (let t = 0; t <= T1; t++) ln(c, pl.X(t), pl.T, pl.X(t), pl.B, K.grid);
    for (const y of [-ym, -ym / 2, ym / 2, ym]) ln(c, pl.L, pl.Y(y), pl.R, pl.Y(y), K.grid);
    arrow(c, pl.L, pl.Y(0), pl.R + 14, pl.Y(0), K.ink3, 1.4, 8);
    tx(c, 't', pl.R + 10, pl.Y(0) - 8, { font: fM(16), col: K.ink, al: 'right' });
    for (let t = 1; t <= T1; t++) tick12(c, String(t), pl.X(t), pl.B + 16);
    for (const y of [ym, ym / 2, -ym / 2, -ym]) tick12(c, fmtT(y), pl.L - 5, pl.Y(y) + 4, 'right');
    c.save();
    c.beginPath();
    c.rect(pl.L, pl.T - 2, pl.R - pl.L, pl.B - pl.T + 4);
    c.clip();
    const env = c1.hl === 'env';
    for (const sg of [1, -1]) {
      c.beginPath();
      for (let i = 0; i <= 200; i++) {
        const t = (T1 * i) / 200;
        c.lineTo(pl.X(t), pl.Y(sg * Math.exp(a * t)));
      }
      c.strokeStyle = env ? K.ch2 : K.ink3;
      c.lineWidth = env ? 2.6 : 1.4;
      c.setLineDash([5, 4]);
      c.stroke();
      c.setLineDash([]);
    }
    if (c1.hl === 'rot' && Math.abs(b) > 0.1) {
      const Pd = TAU / Math.abs(b);
      for (let k = 0; k * Pd <= T1; k++) ln(c, pl.X(k * Pd), pl.Y(0) - 7, pl.X(k * Pd), pl.Y(0) + 7, K.ch2, 2.4);
      if (Pd < T1) tx(c, `1 周 = ${fmt(Pd)} s`, pl.X(Pd / 2), pl.Y(0) + 22, { font: fN(13), col: K.ch2, al: 'center' });
    }
    const te = Math.min(t1, T1);
    c.beginPath();
    for (let i = 0; i <= (600 * te) / T1; i++) {
      const t = (T1 * i) / 600;
      c.lineTo(pl.X(t), pl.Y(reWave(S.s, t)));
    }
    c.strokeStyle = K.on;
    c.lineWidth = c1.hl === 's' ? 3.6 : 2.4;
    c.stroke();
    c.restore();
    const yv = reWave(S.s, te);
    if (Math.abs(yv) <= ym * 1.02) dot(c, pl.X(te), pl.Y(yv), K.on, 4.5);
  },
);
if (!still)
  c1.tick = (dt) => {
    t1 += dt;
    if (t1 > T1 + 1) t1 = 0;
    wv.dirty = true;
  };
const chips1 = [...c1.el.querySelectorAll<HTMLButtonElement>('[data-p]')];
for (const b of chips1)
  b.addEventListener('click', () => {
    const [x, y] = (b.dataset.p as string).split(',').map(Number);
    if (!still) t1 = 0;
    setS([x, y]);
  });

/* ---------- 2 章: なぜ複素数か ---------- */
const c2 = chapter(2);
sPlane(c2, 0);
const T2 = 4;
let t2 = still ? T2 : 0;
const ar = fig(
  c2,
  1,
  (w) => clamp(w * 0.5, 170, 230) + 250,
  (c, w, hh) => {
    const [a, b] = S.s,
      em = Math.max(1, Math.exp(a * T2));
    const R = Math.min(w * 0.3, 92),
      cx = w / 2,
      cy = R + 22,
      k = R / em;
    const tTop = cy + R + 16,
      tBot = hh - 18,
      ty = (t: number) => tTop + (t / T2) * (tBot - tTop);
    for (let t = 0; t <= T2; t++) {
      ln(c, cx - R - 6, ty(t), cx + R + 6, ty(t), K.grid);
      tick12(c, `${t} s`, cx - R - 10, ty(t) + 4, 'right');
    }
    arrow(c, cx, tTop, cx, tBot + 10, K.ink3, 1.2, 8);
    tx(c, 't', cx + 8, tBot + 6, { font: fM(16), col: K.ink });
    c.fillStyle = K.scr;
    c.fillRect(cx - R - 14, cy - R - 14, 2 * R + 28, 2 * R + 28);
    ln(c, cx - R - 12, cy, cx + R + 12, cy, K.ink3, 1.3);
    head(c, cx + R + 14, cy, 0, K.ink3, 8);
    ln(c, cx, cy + R + 12, cx, cy - R - 12, K.ink3, 1.3);
    head(c, cx, cy - R - 14, -Math.PI / 2, K.ink3, 8);
    tx(c, 'Re', cx + R + 14, cy + 16, { font: fS(12, 600), col: K.ink3, al: 'right' });
    tx(c, 'Im', cx + 6, cy - R - 6, { font: fS(12, 600), col: K.ink3 });
    c.beginPath();
    c.arc(cx, cy, k, 0, TAU);
    c.strokeStyle = K.line2;
    c.lineWidth = 1;
    c.setLineDash([3, 3]);
    c.stroke();
    c.setLineDash([]);
    tx(c, '1', cx + k * 0.72 + 3, cy - k * 0.72 - 3, { font: fN(12, 500), col: K.ink3 });
    const te = Math.min(t2, T2),
      N = Math.ceil((400 * te) / T2);
    const at = (t: number): [number, number] => {
      const m = Math.exp(a * t) * k;
      return [cx + m * Math.cos(b * t), cy - m * Math.sin(b * t)];
    };
    // 先の通った跡（螺旋）と回る向きの矢じり
    c.beginPath();
    for (let i = 0; i <= N; i++) c.lineTo(...at((te * i) / Math.max(N, 1)));
    c.strokeStyle = K.ink3;
    c.lineWidth = 1.3;
    c.stroke();
    if (Math.abs(b) > 0.2)
      for (let t = 0.35; t < te - 0.1; t += Math.max(0.5, 2.2 / Math.abs(b))) {
        const [x, y] = at(t);
        const dx = a * Math.cos(b * t) - b * Math.sin(b * t),
          dy = -(a * Math.sin(b * t) + b * Math.cos(b * t));
        head(c, x, y, Math.atan2(dy, dx), K.ink3, 7);
      }
    // 実部の波（下へ）
    c.beginPath();
    for (let i = 0; i <= N; i++) {
      const t = (te * i) / Math.max(N, 1);
      c.lineTo(at(t)[0], ty(t));
    }
    c.strokeStyle = K.ch2;
    c.lineWidth = c2.hl === 're' ? 3.4 : 2.2;
    c.stroke();
    const [px, py] = at(te);
    ln(c, px, py, px, ty(te), c2.hl === 're' ? K.ch2 : K.ink3, c2.hl === 're' ? 2 : 1, [3, 3]);
    dot(c, px, ty(te), K.ch2, 4);
    if (c2.hl === 'rot') {
      const ang = b * te,
        r0 = Math.min(26, R * 0.35);
      c.beginPath();
      c.arc(cx, cy, r0, 0, -ang % TAU, ang > 0);
      c.strokeStyle = K.ch2;
      c.lineWidth = 2.4;
      c.stroke();
      tx(c, `角度 ${Math.round((((ang * 180) / Math.PI) % 360) + 360) % 360}°`, cx + 8, cy + 18, {
        font: fN(13),
        col: K.ch2,
      });
    }
    arrow(c, cx, cy, px, py, c2.hl === 'env' ? K.ch2 : K.on, c2.hl === 'env' ? 4 : 3, 11);
    if (c2.hl === 'env')
      tx(c, `長さ ${fmt(Math.exp(a * te))}`, (cx + px) / 2 + 8, (cy + py) / 2 - 8, { font: fN(13), col: K.ch2 });
    tx(c, `t = ${te.toFixed(2)} s`, w - 8, 16, { font: fN(13), col: K.ink2, al: 'right' });
  },
);
if (!still)
  c2.tick = (dt) => {
    t2 += dt;
    if (t2 > T2 + 1) t2 = 0;
    ar.dirty = true;
  };

/* ---------- 3 章: 実数の波はなぜ 2 点か ---------- */
const c3 = chapter(3);
sPlane(c3, 0, { conj: true });
const T3 = 4;
let t3 = still ? 1.3 : 0;
const pr = fig(
  c3,
  1,
  (w) => clamp(w * 0.75, 240, 320),
  (c, w, hh) => {
    const [a, b] = S.s,
      em = Math.max(1, Math.exp(a * T3));
    const R = Math.min(w, hh) / 2 - 22,
      cx = w / 2,
      cy = hh / 2,
      k = R / em;
    ln(c, 10, cy, w - 14, cy, K.ink3, 1.3);
    head(c, w - 8, cy, 0, K.ink3, 8);
    ln(c, cx, hh - 8, cx, 14, K.ink3, 1.3);
    head(c, cx, 8, -Math.PI / 2, K.ink3, 8);
    tx(c, 'Re', w - 10, cy + 17, { font: fS(12, 600), col: K.ink3, al: 'right' });
    tx(c, 'Im', cx + 6, 18, { font: fS(12, 600), col: K.ink3 });
    c.beginPath();
    c.arc(cx, cy, k, 0, TAU);
    c.strokeStyle = K.line2;
    c.lineWidth = 1;
    c.setLineDash([3, 3]);
    c.stroke();
    c.setLineDash([]);
    const te = Math.min(t3, T3);
    // 和の跡は実軸の上を往復する
    c.beginPath();
    for (let i = 0; i <= 300; i++) c.lineTo(cx + reWave(S.s, (te * i) / 300) * k, cy);
    c.strokeStyle = K.ink3;
    c.lineWidth = 3;
    c.stroke();
    const m = (Math.exp(a * te) * k) / 2,
      ang = b * te;
    const p1: [number, number] = [cx + m * Math.cos(ang), cy - m * Math.sin(ang)];
    const p2: [number, number] = [p1[0] + m * Math.cos(-ang), p1[1] - m * Math.sin(-ang)];
    // 回る向きの小さな弧
    if (Math.abs(b) >= 0.1)
      for (const [sg, col] of [
        [1, K.on],
        [-1, K.ch2],
      ] as const) {
        const r0 = 18 + (sg > 0 ? 0 : 8),
          a0 = -sg * Math.sign(b) * 0.3,
          ae = a0 - sg * Math.sign(b) * 1.1;
        c.beginPath();
        c.arc(cx, cy, r0, a0, ae, sg * Math.sign(b) > 0);
        c.strokeStyle = col;
        c.lineWidth = 1.6;
        c.stroke();
        head(c, cx + r0 * Math.cos(ae), cy + r0 * Math.sin(ae), ae - (sg * Math.sign(b) * Math.PI) / 2, col, 7);
      }
    arrow(c, cx, cy, p1[0], p1[1], K.on, c3.hl === 'a' ? 4.4 : 3, 11);
    arrow(c, p1[0], p1[1], p2[0], p2[1], K.ch2, c3.hl === 'b' ? 4.4 : 3, 11);
    dot(c, p2[0], cy, K.ink, 5);
    tx(c, `和 ${fmt(reWave(S.s, te))}`, p2[0], cy + 22, { font: fN(15), col: K.ink, al: 'center' });
  },
);
if (!still)
  c3.tick = (dt) => {
    t3 += dt;
    if (t3 > T3 + 1) t3 = 0;
    pr.dirty = true;
  };

/* ---------- 4 章: 曲面 ---------- */
const c4 = chapter(4);
sPlane(c4, 0, { pz: true });
surfFig(c4, 1, false, 0);

/* ---------- 5 章: 虚軸の断面 ---------- */
const c5 = chapter(5);
sPlane(c5, 0, { pz: true, cut: true });
surfFig(c5, 1, true, 1);
fig(
  c5,
  2,
  (w) => clamp(w * 0.75, 220, 300),
  (c, w, hh) => {
    const [a, b] = pole(),
      N = 800;
    // 縦の目盛り: 極が虚軸に近すぎるときは、0.08 離れた所の山の高さで打ち切る
    let mx = 0;
    for (let i = 0; i <= N; i++) {
      const v = C.abs(H(S.s, [0, -10 + (20 * i) / N], -Math.max(Math.abs(a), 0.08)));
      if (Number.isFinite(v)) mx = Math.max(mx, v);
    }
    const ym = nice2(mx * 1.08);
    const pl = new Plane(-10, 10, 0, ym, { l: 40, r: 22, t: 14, b: 26 }).set(w, hh);
    for (let x = -8; x <= 8; x += 4) ln(c, pl.X(x), pl.T, pl.X(x), pl.B, K.grid);
    for (const y of [ym / 2, ym]) {
      ln(c, pl.L, pl.Y(y), pl.R, pl.Y(y), K.grid);
      tick12(c, fmtT(y), pl.L - 5, pl.Y(y) + 4, 'right');
    }
    c.save();
    c.beginPath();
    c.rect(pl.L, pl.T - 2, pl.R - pl.L, pl.B - pl.T + 2);
    c.clip();
    const ys: number[] = [];
    for (let i = 0; i <= N; i++) {
      const v = C.abs(H(S.s, [0, -10 + (20 * i) / N]));
      ys.push(pl.Y(Math.min(Number.isFinite(v) ? v : ym * 2, ym * 2)));
    }
    const ok = a < 0,
      xAt = (i: number) => pl.X(-10 + (20 * i) / N);
    c.beginPath();
    c.moveTo(pl.X(-10), pl.Y(0));
    for (const [i, y] of ys.entries()) c.lineTo(xAt(i), y);
    c.lineTo(pl.X(10), pl.Y(0));
    c.closePath();
    c.fillStyle = ok ? K.ons : K.inset;
    c.fill();
    c.beginPath();
    for (const [i, y] of ys.entries()) c.lineTo(xAt(i), y);
    c.strokeStyle = ok ? K.on : K.ink3;
    c.lineWidth = c5.hl === 'jw' ? 4 : 2.6;
    c.setLineDash(ok ? [] : [6, 4]);
    c.stroke();
    c.setLineDash([]);
    c.restore();
    arrow(c, pl.L, pl.Y(0), pl.R + 14, pl.Y(0), K.ink3, 1.4, 8);
    tx(c, 'ω', pl.R + 12, pl.Y(0) - 8, { font: fM(16), col: K.ink, al: 'right' });
    ln(c, pl.X(0), pl.T, pl.X(0), pl.B, K.ink3);
    for (let x = -8; x <= 8; x += 4) tick12(c, fmt(x, 0), pl.X(x), pl.B + 16);
    // 山の幅（高さが 1/√2 になる幅 ≒ 2|σ|）
    if (ok && b > 0.3) {
      const yh = C.abs(H(S.s, [0, b])) / Math.SQRT2,
        x0 = pl.X(b + a),
        x1 = pl.X(b - a),
        yy = pl.Y(yh);
      if (yy > pl.T + 4 && x1 - x0 > 6) {
        ln(c, x0, yy, x1, yy, K.ch2, 2);
        tx(c, `幅 ${fmt(-2 * a)}`, x1 + 4, yy + 4, { font: fN(13), col: K.ch2 });
      }
    }
    if (!ok) tx(c, '虚軸が収束域の外', (pl.L + pl.R) / 2, pl.T + 16, { font: fS(13, 700), col: K.warn, al: 'center' });
  },
);

/* ---------- 6 章: 右半分へ出たら ---------- */
const c6 = chapter(6);
sPlane(c6, 0, { pz: true, roc: true });
const T6 = 10,
  N6 = 1000;
let t6 = still ? T6 : 0,
  area = areaCum(S.s, T6, N6);
const wf = fig(
  c6,
  1,
  (w) => clamp(w * 0.62, 230, 320),
  (c, w, hh) => {
    let mx = 1e-9;
    for (let i = 0; i <= N6; i++) mx = Math.max(mx, Math.abs(h(S.s, (T6 * i) / N6)));
    const ym = nice2(mx * 1.05);
    const pl = new Plane(0, T6, -ym, ym, { l: 44, r: 22, t: 14, b: 26 }).set(w, hh);
    for (let t = 0; t <= T6; t += 2) ln(c, pl.X(t), pl.T, pl.X(t), pl.B, K.grid);
    for (const y of [-ym, ym]) {
      ln(c, pl.L, pl.Y(y), pl.R, pl.Y(y), K.grid);
      tick12(c, fmtT(y), pl.L - 5, pl.Y(y) + 4, 'right');
    }
    const te = Math.min(t6, T6),
      ie = Math.round((N6 * te) / T6);
    // 0〜t の |h(t)| を塗る
    c.beginPath();
    c.moveTo(pl.X(0), pl.Y(0));
    for (let i = 0; i <= ie; i++) {
      const t = (T6 * i) / N6;
      c.lineTo(pl.X(t), pl.Y(h(S.s, t)));
    }
    c.lineTo(pl.X(te), pl.Y(0));
    c.closePath();
    c.fillStyle = K.ons;
    c.fill();
    arrow(c, pl.L, pl.Y(0), pl.R + 14, pl.Y(0), K.ink3, 1.4, 8);
    tx(c, 't', pl.R + 10, pl.Y(0) - 8, { font: fM(16), col: K.ink, al: 'right' });
    for (let t = 2; t <= T6; t += 2) tick12(c, String(t), pl.X(t), pl.B + 16);
    c.beginPath();
    for (let i = 0; i <= N6; i++) {
      const t = (T6 * i) / N6;
      c.lineTo(pl.X(t), pl.Y(h(S.s, t)));
    }
    c.strokeStyle = K.on;
    c.lineWidth = 2.2;
    c.stroke();
    ln(c, pl.X(te), pl.T, pl.X(te), pl.B, K.ink3, 1, [3, 3]);
    const A = area[ie] ?? 0;
    tx(c, `面積 ${fmt(A, A >= 100 ? 0 : 2)}`, clamp(pl.X(te) + 6, pl.L + 4, pl.R - 100), pl.T + 16, {
      font: fN(15),
      col: K.ch2,
    });
  },
);
if (!still)
  c6.tick = (dt) => {
    t6 += dt * 2.5;
    if (t6 > T6 + 2.5) t6 = 0;
    wf.dirty = true;
  };
const chips6 = [...c6.el.querySelectorAll<HTMLButtonElement>('[data-p6]')];
for (const b of chips6)
  b.addEventListener('click', () => {
    if (!still) t6 = 0;
    setS([Number(b.dataset.p6), S.s[1] === 0 ? TAU : Math.abs(S.s[1])]);
  });

/* ---------- 文と式の値 ---------- */
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const B = (v: string) => `<b>${v}</b>`;
function setS(s: Cx): void {
  S.s = s;
  area = areaCum(S.s, T6, N6);
  upd();
}
function upd(): void {
  const [a, b] = S.s,
    [pa, pb] = pole(),
    ps = B(fmtPair(pole()));
  c1.dyn.innerHTML =
    (a < 0
      ? `σ = ${B(fmt(a))} なので 1 秒ごとに ${B(fmt(Math.exp(a)))} 倍に縮みます。`
      : a > 0
        ? `σ = ${B(fmt(a))} なので 1 秒ごとに ${B(fmt(Math.exp(a)))} 倍に膨らみます。`
        : `σ = ${B('0')} なので大きさは変わりません。`) +
    (b === 0
      ? `ω = ${B('0')} なので回りません。振れずに指数の曲線になります。`
      : `ω = ${B(fmt(b))} rad/s なので 1 秒に ${B(fmt(Math.abs(b) / TAU))} 回まわります。`) +
    (b < 0 ? 'ω が負だと逆向きに回りますが、実部の波は ω が正のときと同じです。' : '');
  $('lap-v-sg').textContent = fmt(a);
  $('lap-v-pm').textContent = b < 0 ? MINUS : '+';
  $('lap-v-om').textContent = Math.abs(b).toFixed(2);
  c2.dyn.innerHTML =
    (b === 0
      ? '矢印は回らず、'
      : `矢印は${b > 0 ? '反時計回り' : '時計回り'}に 1 秒 ${B(fmt(Math.abs(b) / TAU))} 回まわりながら、`) +
    (a === 0 ? '長さを保ちます。' : `長さが 1 秒ごとに ${B(fmt(Math.exp(a)))} 倍になります。`) +
    '実部の波は、矢印の先を実軸に落とした位置です。';
  c3.dyn.innerHTML =
    b === 0
      ? 's が実軸の上にあると s̄ と重なり、矢印は 1 本で足ります。'
      : '2 本の矢印は同じ速さで逆向きに回ります。虚部が打ち消し合い、和はいつも実軸の上にあります。';
  c4.dyn.innerHTML =
    pb === 0
      ? `極は ${ps} に 2 つ重なります。インパルスを入れると、系は振れずに${pa < 0 ? '縮みます' : '増え続けます'}。`
      : `極は ${ps} です。インパルスを入れると、系は 1 秒に ${B(fmt(pb / TAU))} 回振れながら${
          pa === 0
            ? '同じ大きさで揺れ続けます'
            : `、1 秒ごとに ${B(fmt(Math.exp(pa)))} 倍に${pa < 0 ? '縮みます' : '膨らみます'}`
        }。`;
  c5.dyn.innerHTML =
    pa < 0
      ? (pb === 0
          ? '断面の山は ω = 0 にあります。'
          : `断面の山は ω ≈ ±${B(fmt(pb, 1))} rad/s にあり、1 章の波の回る速さと同じです。`) +
        `極は虚軸から ${B(fmt(-pa))} 離れています。` +
        (pa > -0.5 ? '近いほど山は高く細くなります。' : '離れると山は低くなだらかになります。')
      : `<span class="w">極が${pa === 0 ? '虚軸の上' : '右半分'}にあり、虚軸は収束域の外です</span>。この断面は式に jω を入れた値で、h(t) のフーリエ変換ではありません。`;
  const Aend = areaAll(S.s);
  c6.dyn.innerHTML =
    pa < 0
      ? `極の実部 ${B(fmt(pa))} &lt; 0 なので、収束域 Re s &gt; ${fmt(pa)} に虚軸が入ります。面積は約 ${B(fmt(Aend))} で止まり、フーリエ変換の積分は収束します。`
      : pa === 0
        ? '極が虚軸の上にあります。h(t) は減らずに続き、面積は時間とともに増え続けます。虚軸は収束域の境目で、収束域には入りません。'
        : `極の実部 ${B(fmt(pa))} &gt; 0 なので、<span class="w">収束域 Re s &gt; ${fmt(pa)} に虚軸が入りません</span>。h(t) は膨らみ続け、面積は限りなく増えます。`;
  $('lap-v-roc').textContent = fmt(pa);
  for (const x of chips1) {
    const v = (x.dataset.p as string).split(',').map(Number);
    x.setAttribute('aria-pressed', String(Math.abs(v[0] - a) < 0.01 && Math.abs(v[1] - b) < 0.01));
  }
  for (const x of chips6)
    x.setAttribute('aria-pressed', String(Number(x.dataset.p6) === a && Math.abs(Math.abs(b) - TAU) < 0.01));
  for (const ch of CHS) redraw(ch);
}

/* ---------- 毎フレーム ---------- */
const recolor = () => {
  readCols();
  for (const ch of CHS) redraw(ch);
};
readCols();
upd();
new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);
if (document.fonts) document.fonts.ready.then(recolor);
let last = performance.now();
function loop(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  for (const ch of CHS) {
    if (!ch.vis) continue;
    ch.tick?.(dt);
    for (const f of ch.figs) if (f.dirty) f.draw();
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
