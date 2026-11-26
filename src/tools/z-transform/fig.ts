/* z 変換のページの図（SVG）と音の部品 */
import { $$ } from '../../lib/dom';

/** 複素数 [実部, 虚部] */
export type C = [number, number];
/** 図の上の点 [x, y]（画素） */
export type Pt = [number, number];
export type Timer = ReturnType<typeof setTimeout>;

export const NS = 'http://www.w3.org/2000/svg';
export const PI = Math.PI;
export const TAU = PI * 2;
export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
export const num = (v: number, d = 2): string => {
  const s = Math.abs(v).toFixed(d);
  return (v < 0 && Number(s) !== 0 ? '−' : '') + s;
};
export const degOf = (t: number): number => {
  let d = Math.round((t * 180) / PI);
  d = ((((d + 180) % 360) + 360) % 360) - 180;
  return d === -180 ? 180 : d;
};
export const dstr = (t: number): string => `${num(degOf(t), 0)}°`;
export const pstr = (r: number, t: number): string => `${num(r)}∠${dstr(t)}`;
export const SUPM: Record<string, string> = {
  0: '⁰',
  1: '¹',
  2: '²',
  3: '³',
  4: '⁴',
  5: '⁵',
  6: '⁶',
  7: '⁷',
  8: '⁸',
  9: '⁹',
  '-': '⁻',
  '−': '⁻',
  n: 'ⁿ',
};
export const sup = (s: string | number): string => String(s).replace(/./g, (c) => SUPM[c] ?? c);
export const SUBM: Record<string, string> = {
  0: '₀',
  1: '₁',
  2: '₂',
  3: '₃',
  4: '₄',
  5: '₅',
  6: '₆',
  7: '₇',
  8: '₈',
  9: '₉',
};
export const sub = (s: string | number): string => String(s).replace(/./g, (c) => SUBM[c] ?? c);
export const cmul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
export const cdiv = (a: C, b: C): C => {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};
export const cabs = (a: C): number => Math.hypot(a[0], a[1]);
export const carg = (a: C): number => Math.atan2(a[1], a[0]);
export const cpol = (r: number, t: number): C => [r * Math.cos(t), r * Math.sin(t)];

// ===== 実行中のタイマー・図・音の後片付け =====
export const RUN: { timers: Timer[]; figs: Fig[]; stops: (() => void)[] } = { timers: [], figs: [], stops: [] };
export function every(ms: number, fn: () => void): Timer {
  const id = setInterval(fn, ms);
  RUN.timers.push(id);
  return id;
}
export function later(ms: number, fn: () => void): Timer {
  const id = setTimeout(fn, ms);
  RUN.timers.push(id);
  return id;
}
export function cleanup(): void {
  for (const t of RUN.timers) {
    clearInterval(t);
    clearTimeout(t);
  }
  for (const f of RUN.figs) f.ro.disconnect();
  for (const f of RUN.stops) f();
  RUN.timers = [];
  RUN.figs = [];
  RUN.stops = [];
  AU.stop(0.02);
}

// ===== SVG の部品 =====
export const r1 = (v: number): number => Math.round(v * 10) / 10;
export const L = (x1: number, y1: number, x2: number, y2: number, c = ''): string =>
  `<line class="${c}" x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}"/>`;
export const PL = (pts: Pt[], c = ''): string =>
  `<polyline class="${c}" points="${pts.map((p) => `${r1(p[0])},${r1(p[1])}`).join(' ')}"/>`;
export const CI = (x: number, y: number, r: number, c = ''): string =>
  `<circle class="${c}" cx="${r1(x)}" cy="${r1(y)}" r="${r1(r)}"/>`;
export const TX = (x: number, y: number, s: string | number, c = '', a = ''): string =>
  `<text class="${c}" x="${r1(x)}" y="${r1(y)}"${a ? ` text-anchor="${a}"` : ''}>${s}</text>`;
export function AR(x1: number, y1: number, x2: number, y2: number, c = '', s = 8): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 2) return '';
  const ux = dx / len;
  const uy = dy / len;
  const s2 = Math.min(s, len * 0.7);
  const bx = x2 - ux * s2;
  const by = y2 - uy * s2;
  const w = s2 * 0.5;
  return (
    L(x1, y1, bx, by, `ln ${c}`) +
    `<path class="ah ${c.replace(/\b(ln|th|bd|ds|dt)\b/g, '')}" d="M${r1(x2)},${r1(y2)}L${r1(bx - uy * w)},${r1(by + ux * w)}L${r1(bx + uy * w)},${r1(by - ux * w)}Z"/>`
  );
}
// 円弧（中心 cx,cy・半径 r・角 t0→t1、数学の向き）。終点に矢じり
export function ARC(cx: number, cy: number, r: number, t0: number, t1: number, c = '', head = true, s = 8): string {
  const n = Math.max(2, Math.ceil(Math.abs(t1 - t0) / 0.05));
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    pts.push([cx + r * Math.cos(t), cy - r * Math.sin(t)]);
  }
  if (!head || Math.abs(t1 - t0) * r < 10) return PL(pts, `ln ${c}`);
  const dir = Math.sign(t1 - t0);
  const tb = t1 - (dir * s) / r;
  const body = pts.filter((_, i) => dir * (t0 + ((t1 - t0) * i) / n - tb) <= 0);
  const bx = cx + r * Math.cos(tb);
  const by = cy - r * Math.sin(tb);
  body.push([bx, by]);
  return (
    PL(body, `ln ${c}`) + AR(bx, by, cx + r * Math.cos(t1), cy - r * Math.sin(t1), c, s).replace(/<line[^>]*\/>/, '')
  );
}
export const POLE = (x: number, y: number, c = '', s = 7): string =>
  L(x - s, y - s, x + s, y + s, `pole ${c}`) + L(x - s, y + s, x + s, y - s, `pole ${c}`);
export const ZERO = (x: number, y: number, c = ''): string => CI(x, y, 7, `zero ${c}`);
export const HND = (x: number, y: number, c = 'c1', extra = ''): string =>
  CI(x, y, 9, `hnd ${c} ${extra}`) + CI(x, y, 3.5, `dot ${c}`);

// ===== 図（SVG の座標と画面の画素を 1 対 1 にする） =====
export interface FigOpts {
  /** 横軸の範囲 [左, 右] */
  x: [number, number];
  /** 縦軸の範囲 [下, 上] */
  y: [number, number];
  /** 縦横の縮尺をそろえる */
  eq?: boolean;
  /** 余白 [上, 右, 下, 左] */
  m?: [number, number, number, number];
  /** 高さ。関数なら幅から決める。ないときは幅 × ratio */
  h?: number | ((w: number) => number);
  ratio?: number;
  minH?: number;
  maxH?: number;
}
type FigConf = Required<Omit<FigOpts, 'h'>> & Pick<FigOpts, 'h'>;
interface Handle {
  name: string;
  x: number;
  y: number;
}
/** 図の操作。x, y は図の座標、p は画素 */
export interface FigInteract {
  move?: (name: string, x: number, y: number, p: Pt) => void;
  end?: (name: string) => void;
  tap?: (x: number, y: number, p: Pt) => void;
}

export class Fig {
  readonly host: HTMLElement;
  readonly o: FigConf;
  readonly svg: SVGSVGElement;
  readonly ro: ResizeObserver;
  handles: Handle[] = [];
  draw: (() => void) | null = null;
  W = 0;
  H = 0;
  kx = 1;
  ky = 1;
  ox = 0;
  oy = 0;
  /** 余白の内側の左・右・上・下（画素） */
  l = 0;
  r = 0;
  t = 0;
  b = 0;

  constructor(host: HTMLElement, o: FigOpts) {
    this.host = host;
    this.o = { eq: false, m: [8, 8, 8, 8], ratio: 1, minH: 120, maxH: 9999, ...o };
    this.svg = document.createElementNS(NS, 'svg');
    host.appendChild(this.svg);
    // 描き直すと高さが変わり、同じフレームで通知が重なる。次のフレームへ回して ResizeObserver の警告を避ける
    let raf = 0;
    this.ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const w = Math.floor(host.clientWidth);
        if (w && w !== this.W) {
          this.layout(w);
          this.draw?.();
        }
      });
    });
    this.ro.observe(host);
    RUN.figs.push(this);
    this.layout(Math.floor(host.clientWidth) || 320);
  }
  /** 幅 w に合わせて高さと縮尺を決め直す */
  layout(w: number): void {
    const o = this.o;
    this.W = w;
    const H = typeof o.h === 'function' ? o.h(w) : (o.h ?? w * o.ratio);
    this.H = Math.round(clamp(H, o.minH, o.maxH));
    const [mt, mr, mb, ml] = o.m;
    const iw = w - ml - mr;
    const ih = this.H - mt - mb;
    const [x0, x1] = o.x;
    const [y0, y1] = o.y;
    let kx = iw / (x1 - x0);
    let ky = ih / (y1 - y0);
    if (o.eq) {
      const k = Math.min(kx, ky);
      kx = k;
      ky = k;
    }
    this.kx = kx;
    this.ky = ky;
    this.ox = ml + (iw - kx * (x1 - x0)) / 2 - kx * x0;
    this.oy = mt + (ih - ky * (y1 - y0)) / 2 + ky * y1;
    this.l = ml;
    this.r = w - mr;
    this.t = mt;
    this.b = this.H - mb;
  }
  range(x: [number, number], y: [number, number]): void {
    this.o.x = x;
    this.o.y = y;
    this.layout(this.W);
  }
  X(x: number): number {
    return this.ox + this.kx * x;
  }
  Y(y: number): number {
    return this.oy - this.ky * y;
  }
  ix(px: number): number {
    return (px - this.ox) / this.kx;
  }
  iy(py: number): number {
    return (this.oy - py) / this.ky;
  }
  set(s: string): void {
    const v = this.svg;
    v.setAttribute('viewBox', `0 0 ${this.W} ${this.H}`);
    v.setAttribute('width', String(this.W));
    v.setAttribute('height', String(this.H));
    v.innerHTML = s;
  }
  hnd(name: string, x: number, y: number): void {
    this.handles.push({ name, x: this.X(x), y: this.Y(y) });
  }
  interact(cb: FigInteract): void {
    const v = this.svg;
    let drag: string | null = null;
    let start: Pt | null = null;
    const pt = (e: { clientX: number; clientY: number }): Pt => {
      const r = v.getBoundingClientRect();
      return [((e.clientX - r.left) * this.W) / r.width, ((e.clientY - r.top) * this.H) / r.height];
    };
    const pick = (p: Pt, rad: number): string | null => {
      let best: string | null = null;
      let bd = rad;
      for (const h of this.handles) {
        const d = Math.hypot(h.x - p[0], h.y - p[1]);
        if (d < bd) {
          bd = d;
          best = h.name;
        }
      }
      return best;
    };
    v.addEventListener('pointerdown', (e) => {
      const p = pt(e);
      const n = pick(p, e.pointerType === 'mouse' ? 22 : 30);
      if (n) {
        drag = n;
        v.setPointerCapture(e.pointerId);
        v.classList.add('drag');
        e.preventDefault();
        cb.move?.(n, this.ix(p[0]), this.iy(p[1]), p);
      } else start = p;
    });
    v.addEventListener('pointermove', (e) => {
      const p = pt(e);
      if (drag) cb.move?.(drag, this.ix(p[0]), this.iy(p[1]), p);
      else if (e.pointerType === 'mouse') v.style.cursor = pick(p, 22) ? 'grab' : cb.tap ? 'crosshair' : '';
    });
    v.addEventListener('pointerup', (e) => {
      if (drag) {
        const n = drag;
        drag = null;
        v.classList.remove('drag');
        cb.end?.(n);
      } else if (start) {
        const p = pt(e);
        if (Math.hypot(p[0] - start[0], p[1] - start[1]) < 8 && cb.tap) cb.tap(this.ix(p[0]), this.iy(p[1]), p);
        start = null;
      }
    });
    v.addEventListener('pointercancel', () => {
      drag = null;
      start = null;
      v.classList.remove('drag');
    });
    v.addEventListener(
      'touchstart',
      (e) => {
        const t = e.touches[0];
        if (t && pick(pt(t), 30)) e.preventDefault();
      },
      { passive: false },
    );
  }
}

// z 平面の下地（軸・単位円・目盛り）
export function zBase(f: Fig, o: { fillIn?: boolean; ucLabel?: boolean; ucAt?: number } = {}): string {
  const [x0, x1] = [f.ix(0), f.ix(f.W)];
  const [y0, y1] = [f.iy(f.H), f.iy(0)];
  let s = '';
  if (o.fillIn) s += CI(f.X(0), f.Y(0), f.kx, 'ucf');
  s += L(f.X(x0), f.Y(0), f.X(x1), f.Y(0), 'ax') + L(f.X(0), f.Y(y0), f.X(0), f.Y(y1), 'ax');
  s += CI(f.X(0), f.Y(0), f.kx, 'uc');
  s += TX(f.X(1) + 4, f.Y(0) + 16, '1') + TX(f.X(-1) - 4, f.Y(0) + 16, '−1', '', 'end');
  s += TX(f.X(x1) - 4, f.Y(0) - 7, 'Re', 'lb', 'end') + TX(f.X(0) + 6, f.Y(y1) + 15, 'Im', 'lb');
  if (o.ucLabel !== false) {
    const t = o.ucAt ?? -0.75;
    s += TX(f.X(Math.cos(t) * 1.04) + 4, f.Y(Math.sin(t) * 1.04) + 12, '単位円', 'lb h');
  }
  return s;
}

// 棒グラフ（標本）の下地。yt: 横線を引く値、xl: 横軸の名前、xs: 目盛りの間隔
export function stemBase(f: Fig, o: { yt?: number[]; xl?: string; xs?: number } = {}): string {
  const [n0, n1] = f.o.x;
  let s = '';
  const yt = o.yt ?? [];
  for (const v of yt) {
    s +=
      L(f.l, f.Y(v), f.r, f.Y(v), 'gr') + TX(f.l - 6, f.Y(v) + 4, num(v, Math.abs(v) < 10 && v % 1 ? 1 : 0), '', 'end');
  }
  s += AR(f.l, f.Y(0), f.r + 2, f.Y(0), 'c3 th', 7);
  s += TX(f.r - 2, f.Y(0) - 7, o.xl ?? 'n', 'm', 'end');
  const step = o.xs ?? 5;
  for (let n = Math.ceil(n0 / step) * step; n <= n1 - 0.5; n += step)
    s += L(f.X(n), f.Y(0), f.X(n), f.Y(0) + 4, 'ax') + TX(f.X(n), f.b + 14, n, '', 'middle');
  return s;
}
export function stem(f: Fig, n: number, v: number, c = 'c1', ymax = Infinity, big = false): string {
  const vv = clamp(v, -ymax, ymax);
  const x = f.X(n);
  const y0 = f.Y(0);
  const y = f.Y(vv);
  let s = L(x, y0, x, y, `stem ${c}`) + CI(x, y, big ? 6 : 3.6, `dot ${c}`);
  if (Math.abs(v) > ymax) s += AR(x, y, x, y + (v > 0 ? -10 : 10), c, 7);
  return s;
}
export function niceMax(m: number): number {
  if (m <= 1.05) return 1;
  const p = 10 ** Math.floor(Math.log10(m));
  for (const k of [1, 1.5, 2, 3, 5, 10]) if (k * p >= m) return k * p;
  return 10 * p;
}

// ===== 音（1 秒 8000 標本の列を窓付き sinc で補間して鳴らす） =====
export const FS = 8000;
export function upsample(x: Float32Array, fsIn: number, fsOut: number, periodic: boolean): Float32Array<ArrayBuffer> {
  const N = x.length;
  const M = Math.floor((N * fsOut) / fsIn);
  const y = new Float32Array(M);
  const A = 8;
  const r = fsIn / fsOut;
  for (let m = 0; m < M; m++) {
    const t = m * r;
    const n0 = Math.floor(t);
    let s = 0;
    for (let n = n0 - A + 1; n <= n0 + A; n++) {
      let xi: number;
      if (periodic) xi = x[((n % N) + N) % N];
      else {
        if (n < 0 || n >= N) continue;
        xi = x[n];
      }
      const d = t - n;
      s += xi * (d === 0 ? 1 : (Math.sin(PI * d) / (PI * d)) * (Math.sin((PI * d) / A) / ((PI * d) / A)));
    }
    y[m] = s;
  }
  return y;
}
export function fade<T extends Float32Array>(x: T, a = 0.01, b = 0.03): T {
  const na = Math.floor(a * FS);
  const nb = Math.floor(b * FS);
  const N = x.length;
  for (let i = 0; i < na && i < N; i++) x[i] *= i / na;
  for (let i = 0; i < nb && i < N; i++) x[N - 1 - i] *= i / nb;
  return x;
}
export function peakNorm<T extends Float32Array>(x: T, p = 0.6): T {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] *= p / m;
  return x;
}
export function rmsNorm<T extends Float32Array>(x: T, r = 0.16, cap = 0.9): T {
  let s = 0;
  for (const v of x) s += v * v;
  s = Math.sqrt(s / x.length);
  if (s > 0) for (let i = 0; i < x.length; i++) x[i] = clamp((x[i] * r) / s, -cap, cap);
  return x;
}
export function noise(n: number, seed = 7): Float32Array<ArrayBuffer> {
  const x = new Float32Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    x[i] = s / 0x3fffffff - 1;
  }
  return x;
}

export interface PlayOpts {
  /** 周期的に補間する（ループ用） */
  periodic?: boolean;
  loop?: boolean;
  gain?: number;
  onstop?: (() => void) | null;
}

/** 音は 1 つずつ鳴らす。新しく鳴らすと前の音は止まる */
class Player {
  ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  src: AudioBufferSourceNode | OscillatorNode | null = null;
  private g: GainNode | null = null;
  onstop: (() => void) | null = null;
  private t0 = 0;
  dur = 0;

  get(): { c: AudioContext; out: GainNode } {
    let c = this.ctx;
    let out = this.out;
    if (!c || !out) {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      c = new Ctor();
      out = c.createGain();
      out.gain.value = 0.8;
      out.connect(c.destination);
      this.ctx = c;
      this.out = out;
    }
    if (c.state === 'suspended') c.resume();
    return { c, out };
  }
  stop(fd = 0.03): void {
    if (this.src && this.g && this.ctx) {
      const s = this.src;
      const g = this.g;
      const t = this.ctx.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + fd);
      try {
        s.stop(t + fd + 0.02);
      } catch {
        /* 止まっている */
      }
      this.src = null;
      this.g = null;
    }
    const f = this.onstop;
    this.onstop = null;
    f?.();
  }
  // x: 8000 標本/秒の列
  play(x: Float32Array, o: PlayOpts = {}): AudioBufferSourceNode {
    const { c, out } = this.get();
    this.stop(0.02);
    const y = upsample(x, FS, c.sampleRate, !!o.periodic);
    const b = c.createBuffer(1, y.length, c.sampleRate);
    b.copyToChannel(y, 0);
    const s = c.createBufferSource();
    s.buffer = b;
    s.loop = !!o.loop;
    const g = c.createGain();
    const t = c.currentTime + 0.01;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(o.gain ?? 1, t + 0.02);
    s.connect(g);
    g.connect(out);
    s.start(t);
    this.src = s;
    this.g = g;
    this.t0 = t;
    this.dur = y.length / c.sampleRate;
    this.onstop = o.onstop || null;
    s.onended = () => {
      if (this.src === s) {
        this.src = null;
        const f = this.onstop;
        this.onstop = null;
        f?.();
      }
    };
    return s;
  }
  osc(freq: number, o: PlayOpts = {}): OscillatorNode {
    const { c, out } = this.get();
    this.stop(0.02);
    const s = c.createOscillator();
    s.frequency.value = freq;
    const g = c.createGain();
    const t = c.currentTime + 0.01;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(o.gain ?? 0.35, t + 0.03);
    s.connect(g);
    g.connect(out);
    s.start(t);
    this.src = s;
    this.g = g;
    this.onstop = o.onstop || null;
    return s;
  }
  elapsed(): number {
    return this.ctx && this.src ? this.ctx.currentTime - this.t0 : -1;
  }
}
export const AU = new Player();

// 再生ボタン（LED 付きトグル）を AU と結ぶ
export function playBtn(btn: HTMLElement, start: () => void): (on: boolean) => void {
  const set = (on: boolean) => btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.addEventListener('click', () => {
    if (btn.getAttribute('aria-pressed') === 'true') {
      AU.stop();
      set(false);
      return;
    }
    start();
    set(true);
    const prev = AU.onstop;
    AU.onstop = () => {
      set(false);
      prev?.();
    };
  });
  return set;
}

// ===== 式の項にカーソルを載せると図の同じ記号を光らせる =====
export const HLK = [
  'r',
  'th',
  'a',
  'z',
  'q',
  'zn',
  'sig',
  'om',
  'sT',
  'zs',
  'b0',
  'b1',
  'b2',
  'd1',
  'fb',
  'num',
  'den',
  'x',
  'h',
  'col',
  'g',
  'D',
  'T',
  'f',
];
export function hlCss(): string {
  return HLK.map(
    (k) =>
      `.ch[data-hl="${k}"] .k-${k}:not(text):not(td){stroke:var(--warn)!important;stroke-width:3px}.ch[data-hl="${k}"] text.k-${k}{fill:var(--warn)!important;font-weight:700}.ch[data-hl="${k}"] .hk.k-${k}{display:inline}.ch[data-hl="${k}"] .ah.k-${k},.ch[data-hl="${k}"] .dot.k-${k}{fill:var(--warn)!important;stroke:none!important}.ch[data-hl="${k}"] td.k-${k}{background:var(--hl);color:var(--warn)}`,
  ).join('\n');
}
/** 式の項（MathML の data-k）と、それを含む章（.ch）の data-hl を結ぶ */
export function bindEq(root: ParentNode): void {
  for (const el of $$<MathMLElement>('.eq [data-k]', root)) {
    const ch = el.closest<HTMLElement>('.ch');
    if (!ch) continue;
    const on = () => {
      ch.dataset.hl = el.dataset.k;
      for (const e of $$(`.eq [data-k="${el.dataset.k}"]`, ch)) e.classList.add('on');
    };
    const off = () => {
      delete ch.dataset.hl;
      for (const e of $$('.eq [data-k].on', ch)) e.classList.remove('on');
    };
    el.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse') on();
    });
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') off();
    });
    el.addEventListener('click', () => {
      if (ch.dataset.hl === el.dataset.k) off();
      else {
        off();
        on();
      }
    });
  }
}
// 押した状態を 1 つだけにするボタン群
export function radio(btns: HTMLElement[], fn: (b: HTMLElement) => void): void {
  for (const b of btns) {
    b.addEventListener('click', () => {
      for (const x of btns) x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
      fn(b);
    });
  }
}
