/** SPI のページの図（canvas）: 配線図・波形・解読の帯。色はサイトとページの変数から読む */
import { surface } from '../pcm/fig';
import {
  type Bit,
  type Change,
  DEVS,
  hex,
  LEDS,
  type Level,
  type Mode,
  type Sim,
  type Snap,
  sampledSince,
  sampleRising,
  stateAt,
  valAt,
} from './bus';
import { drawIcon, type IconId } from './icons';

const COL = {
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
  m: '',
  s: '',
  onm: '',
  ons: '',
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
    m: v('--sp-m'),
    s: v('--sp-s'),
    onm: v('--sp-on-m'),
    ons: v('--sp-on-s'),
    mono: v('--mono') || 'monospace',
    sans: v('--sans') || 'sans-serif',
  });
}
type G = CanvasRenderingContext2D;
const font = (g: G, px: number, w = 500, mono = false) => {
  g.font = `${w} ${px}px ${mono ? COL.mono : COL.sans}`;
};
/** 語りの色: m マスタ、s スレーブ、x 失敗 */
export const sayColor = (w: 'm' | 's' | 'x' | null): string =>
  w === 'm' ? COL.m : w === 's' ? COL.s : w === 'x' ? COL.warn : '';
/** a と b を u で混ぜる（#rrggbb） */
function mix(a: string, b: string, u: number): string {
  const p = (h: string) => {
    const x = h.replace('#', '');
    return x.length === 3
      ? [...x].map((ch) => Number.parseInt(ch + ch, 16))
      : [0, 2, 4].map((i) => Number.parseInt(x.slice(i, i + 2), 16));
  };
  const A = p(a),
    B = p(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * u)).join(',')})`;
}
const lineCol = () => ({ cs: COL.ch2, sck: COL.ch1, mosi: COL.m, miso: COL.s });
const ease = (u: number) => {
  const x = Math.max(0, Math.min(1, u));
  return x * x * (3 - 2 * x);
};
/** ビットが線を進む時間と、レジスタが 1 升ずれる時間（どちらも半周期に対する割合） */
const TRAVEL = 0.85,
  SLIDE = 0.7;

/* ---------- ビットの升 ---------- */
const bad = (b: Bit) => !!b.why || !!b.wrong;
const srcCol = (b: Bit) => (b.src < 0 ? COL.grid2 : b.src === 0 ? COL.m : COL.s);
const onCol = (b: Bit) => (b.src < 0 ? COL.ink : b.src === 0 ? COL.onm : COL.ons);
/** 升。大きければ値の数字、小さければ 1 を塗り 0 を枠で示す。不定は「?」 */
function cell(g: G, x: number, y: number, s: number, b: Bit): void {
  const big = s >= 11,
    ng = bad(b),
    col = ng ? COL.warn : srcCol(b);
  if (big || b.v === 1 || ng) {
    g.fillStyle = ng ? mix(COL.warn, COL.screen, big ? 0.55 : 0.2) : col;
    g.fillRect(x, y, s, s);
  } else {
    g.fillStyle = COL.screen;
    g.fillRect(x, y, s, s);
  }
  g.strokeStyle = ng ? COL.warn : big ? COL.grid2 : col;
  g.lineWidth = ng || !big ? 1.4 : 1;
  g.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
  if (big) {
    font(g, Math.min(15, Math.round(s * 0.66)), 700, true);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = ng ? COL.ink : onCol(b);
    g.fillText(b.why ? '?' : String(b.v), x + s / 2, y + s / 2 + 1);
  }
}
function arrowHead(g: G, x: number, y: number, dx: number, dy: number, s = 5): void {
  const l = Math.hypot(dx, dy),
    ux = dx / l,
    uy = dy / l;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x - ux * s - uy * s * 0.6, y - uy * s + ux * s * 0.6);
  g.lineTo(x - ux * s + uy * s * 0.6, y - uy * s - ux * s * 0.6);
  g.closePath();
  g.fill();
}
const dot = (g: G, x: number, y: number) => {
  g.fillStyle = COL.sink;
  g.beginPath();
  g.arc(x, y, 2.4, 0, 7);
  g.fill();
};

/* ---------- 波形 ---------- */
const ROWS = [
  ['cs', 'CS'],
  ['sck', 'SCK'],
  ['mosi', 'MOSI'],
  ['miso', 'MISO'],
] as const;
interface WaveOpt {
  pt: number;
  grid?: boolean;
  /** 読み取りの位置の点と値 */
  dots?: boolean;
  /** 解読の帯 */
  band?: boolean;
  win?: { tA: number; tB: number };
}
const LEFT = 52,
  BAND = 34;
function wave(g: G, s: Sim, w: number, h: number, tA: number, tB: number, o: WaveOpt): void {
  const bx = LEFT,
    bw = w - LEFT - 8,
    X = (t: number) => bx + ((t - tA) / (tB - tA)) * bw,
    LC = lineCol();
  const top = 6,
    rh = (h - BAND - 8 - top) / ROWS.length;
  if (o.grid) {
    g.strokeStyle = COL.grid;
    g.lineWidth = 1;
    g.beginPath();
    for (const e of s.edges) {
      if (e.t < tA || e.t > tB) continue;
      const x = Math.round(X(e.t)) + 0.5;
      g.moveTo(x, top);
      g.lineTo(x, top + rh * ROWS.length);
    }
    g.stroke();
  }
  const dest = s.chain ? 0 : s.sel[0],
    listen = s.chain ? 1 : s.sel[0] + 1;
  ROWS.forEach(([k, name], i) => {
    const y0 = top + i * rh + 3,
      y1 = top + (i + 1) * rh - 5,
      arr: Change[] = k === 'cs' ? s.lines.cs[dest] : s.lines[k];
    font(g, 12, 700, true);
    g.fillStyle = LC[k];
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(name, 8, (y0 + y1) / 2);
    const Y = (v: Level) => (v === 1 ? y0 : v === 0 ? y1 : (y0 + y1) / 2);
    g.save();
    g.beginPath();
    g.rect(bx, 0, bw, h);
    g.clip();
    const pts: [number, Level][] = [[tA, valAt(arr, tA).v]];
    for (const e of arr) if (e.t > tA && e.t < tB) pts.push([e.t, e.v]);
    for (let j = 0; j < pts.length; j++) {
      const [t0, v] = pts[j],
        t1 = j + 1 < pts.length ? pts[j + 1][0] : tB,
        x0 = X(t0),
        x1 = X(t1);
      g.globalAlpha = t0 < o.pt ? 1 : 0.32;
      g.setLineDash(v === 'z' ? [3, 3] : []);
      g.strokeStyle = v === 'z' ? COL.ink3 : v === 'x' ? COL.warn : LC[k];
      if (v === 'x') {
        g.fillStyle = mix(COL.warn, COL.screen, 0.6);
        g.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
      g.lineWidth = 1.8;
      g.beginPath();
      g.moveTo(x0, j ? Y(pts[j - 1][1]) : Y(v));
      g.lineTo(x0, Y(v));
      g.lineTo(x1, Y(v));
      if (v === 'x') {
        g.moveTo(x0, y1);
        g.lineTo(x1, y1);
      }
      g.stroke();
      g.setLineDash([]);
    }
    g.globalAlpha = 1;
    /* 読み取りの位置: MOSI は宛先が、MISO はマスタが読む */
    if (o.dots && (k === 'mosi' || k === 'miso')) {
      for (const sm of s.samples) {
        if (k === 'miso' ? sm.i !== 0 : sm.i !== listen) continue;
        if (sm.t < tA || sm.t > tB) continue;
        const x = X(sm.t),
          past = sm.t <= o.pt;
        g.globalAlpha = past ? 1 : 0.3;
        g.fillStyle = bad(sm.b) ? COL.warn : COL.ink;
        g.beginPath();
        g.arc(x, Y(sm.b.v), 3.6, 0, 7);
        g.fill();
        if (past) {
          font(g, 13, 700, true);
          g.textAlign = 'left';
          g.textBaseline = 'middle';
          g.fillText(sm.b.why ? '?' : String(sm.b.v), x + 6, (y0 + y1) / 2);
        }
        g.globalAlpha = 1;
      }
    }
    g.restore();
  });
  /* 解読の帯: バイトごとに MOSI（上）と MISO（下） */
  if (o.band) {
    const hb = 15,
      yb0 = h - BAND - 2;
    s.edges
      .filter((e) => e.j % 16 === 0)
      .forEach((e, n) => {
        const xa = X(e.t - s.h * 0.3),
          xb = X(e.t + 15.3 * s.h),
          x0 = Math.max(bx, xa),
          x1 = Math.min(bx + bw, xb);
        if (x1 <= x0 + 2) return;
        const got = s.devs[0].got[n],
          ok = got === undefined || got === s.want.get(0)?.[n];
        g.globalAlpha = e.t < o.pt ? 1 : 0.35;
        const rows: [string, string, boolean][] = [
          [COL.m, `→ ${hex(s.c.data[n])}`, true],
          [COL.s, `← ${got === undefined ? '–' : hex(got)}`, ok],
        ];
        rows.forEach(([col, t, good], r) => {
          const y = yb0 + r * (hb + 2);
          g.strokeStyle = good ? col : COL.warn;
          g.lineWidth = 1.3;
          g.strokeRect(x0 + 0.5, y + 0.5, x1 - x0 - 1, hb - 1);
          font(g, 12, 700, true);
          g.fillStyle = good ? col : COL.warn;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          const tw = g.measureText(t).width;
          if (x1 - x0 > tw + 8)
            g.fillText(t, Math.max(x0 + tw / 2 + 4, Math.min(x1 - tw / 2 - 4, (xa + xb) / 2)), y + hb / 2 + 1);
        });
        g.globalAlpha = 1;
      });
  }
  if (o.win) {
    g.setLineDash([4, 3]);
    g.strokeStyle = COL.ink2;
    g.lineWidth = 1.2;
    const x0 = X(o.win.tA),
      x1 = X(o.win.tB);
    g.strokeRect(x0, 1, x1 - x0, h - 2);
    g.setLineDash([]);
  }
  const xp = X(o.pt);
  if (xp >= bx && xp <= bx + bw) {
    g.strokeStyle = COL.ink;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(xp, 0);
    g.lineTo(xp, h);
    g.stroke();
  }
}
/** 拡大の範囲。幅 110 px に 1 クロックを目安に 4〜9 クロック、今の位置は左から 55 % */
export function zoomWin(s: Sim, pt: number, w: number): { tA: number; tB: number } {
  const span = Math.max(4, Math.min(9, Math.round(w / 110))) * s.T,
    tA = pt - span * 0.55;
  return { tA, tB: tA + span };
}
/** 通信全体の波形と解読。拡大している範囲を破線の枠で示す */
export function drawWhole(c: HTMLCanvasElement, s: Sim, pt: number, zoomW: number): void {
  const sf = surface(c);
  if (!sf) return;
  sf.g.clearRect(0, 0, sf.w, sf.h);
  wave(sf.g, s, sf.w, sf.h, 0, s.dur, { pt, band: true, win: zoomWin(s, pt, zoomW) });
}
/** 全体の図で押した位置の時刻 */
export const wholeAt = (c: HTMLCanvasElement, s: Sim, clientX: number): number => {
  const r = c.getBoundingClientRect();
  return Math.max(0, Math.min(1, (clientX - r.left - LEFT) / (r.width - LEFT - 8))) * s.dur;
};
/** 今の位置の前後の拡大。読み取りの位置と値つき */
export function drawZoom(c: HTMLCanvasElement, s: Sim, pt: number): void {
  const sf = surface(c);
  if (!sf) return;
  sf.g.clearRect(0, 0, sf.w, sf.h);
  const { tA, tB } = zoomWin(s, pt, sf.w);
  wave(sf.g, s, sf.w, sf.h, tA, tB, { pt, grid: true, dots: true, band: true });
}

/* ---------- 配線図 ---------- */
/** レジスタの寸法: 8 個の升と、右隣の入口の 1 升 */
interface Reg {
  x: number;
  y: number;
  cs: number;
  gx: number;
  p: number;
  mid: number;
  /** 出口（0 番の升）の中心 */
  out: number;
  /** 入口の升の中心 */
  slot: number;
  w: number;
}
const regGeo = (x: number, y: number, cs: number): Reg => {
  const gx = Math.max(1, cs * 0.12),
    p = cs + gx;
  return { x, y, cs, gx, p, mid: y + cs / 2, out: x + cs / 2, slot: x + 8 * p + cs / 2, w: 8 * p - gx };
};
/** 送り出した 0 番の升は、線の上を進んでいる間は点線の空き */
const isSent = (st: Snap) => !!st.o && st.o === st.reg[0] && st.kind !== 'sample';
/** 8 個の升。読み取りの直後は 1 升右からゆっくり寄せる（入口の升が 7 番へ入る） */
function regDraw(g: G, st: Snap, R: Reg, pt: number, s: Sim, sent: boolean): void {
  g.strokeStyle = COL.grid2;
  g.lineWidth = 1;
  g.setLineDash([2, 2]);
  g.strokeRect(R.slot - R.cs / 2 + 0.5, R.y + 0.5, R.cs - 1, R.cs - 1);
  g.setLineDash([]);
  const u = st.kind === 'sample' ? ease((pt - st.t) / (SLIDE * s.h)) : 1,
    off = (1 - u) * R.p;
  for (let k = 0; k < 8; k++) cell(g, R.x + k * R.p + off, R.y, R.cs, st.reg[k]);
  if (sent) {
    g.fillStyle = COL.screen;
    g.fillRect(R.x, R.y, R.cs, R.cs);
    g.setLineDash([2, 2]);
    g.strokeStyle = COL.ink3;
    g.strokeRect(R.x + 0.5, R.y + 0.5, R.cs - 1, R.cs - 1);
    g.setLineDash([]);
  }
}
/** 折れ線 pts の上で u（0〜1）の位置 */
function along(pts: [number, number][], u: number): [number, number] {
  const seg: number[] = [];
  let L = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    seg.push(l);
    L += l;
  }
  let q = Math.max(0, Math.min(1, u)) * L;
  for (let i = 0; i < seg.length; i++) {
    if (q <= seg[i] || i === seg.length - 1) {
      const f = seg[i] ? Math.min(1, q / seg[i]) : 0;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f];
    }
    q -= seg[i];
  }
  return pts[pts.length - 1];
}
/** 送り手 src の出口から受け手 dst の入口へ進むビット。入口で待ち、受け手が読むとレジスタの中へ入る */
function flowPip(g: G, s: Sim, pt: number, src: number, dst: number, pts: [number, number][], size: number): void {
  const e = valAt(s.out[src], pt);
  if (!e.b || e.v === 'z' || e.b.idle || e.t < s.tCs) return;
  if (sampledSince(s.devs[dst], e.t, pt)) return;
  const [x, y] = along(pts, ease((pt - e.t) / (TRAVEL * s.h)));
  cell(g, x - size / 2, y - size / 2, size, e.b);
}
type Pt = [number, number];
/** 線の色と太さ（High は明るく、Low は暗く、Z は破線、衝突は赤） */
function laneStroke(g: G, v: Level, col: string): void {
  g.setLineDash(v === 'z' ? [3, 3] : []);
  g.strokeStyle = v === 'z' ? COL.ink3 : v === 'x' ? COL.warn : v === 1 ? col : mix(col, COL.screen, 0.55);
  g.lineWidth = v === 'x' ? 3 : v === 1 ? 2.4 : v === 'z' ? 1.4 : 2;
}
/** 交わるだけの線の所で空ける幅の半分 [px] */
const CUT = 2.5;
/**
 * 縦か横の線分を引く。cuts（線分に沿った座標）の前後は空けて、交わるだけの線と区別する。
 * 端の点は空けない（つながる線の上で終わるため）
 */
function cutSeg(g: G, a: Pt, b: Pt, cuts: readonly number[]): void {
  const vert = Math.abs(a[0] - b[0]) < 0.01,
    p = vert ? 1 : 0,
    lo = Math.min(a[p], b[p]),
    hi = Math.max(a[p], b[p]),
    cs = cuts.filter((c) => c > lo + 0.5 && c < hi - 0.5).sort((x, y) => x - y),
    to = (u: number): Pt => (vert ? [a[0], u] : [u, a[1]]);
  g.beginPath();
  let s0 = lo;
  for (const c of [...cs, hi + CUT]) {
    const e = Math.min(hi, c - CUT);
    if (e > s0) {
      g.moveTo(...to(s0));
      g.lineTo(...to(e));
    }
    s0 = c + CUT;
  }
  g.stroke();
}
/** 折れ線の配線。縦の線分は cutsV（y）、横の線分は cutsH（x）の所を空ける。head なら終点に矢じり */
function route(
  g: G,
  pts: Pt[],
  col: string,
  cutsV: readonly number[],
  cutsH: readonly number[],
  head: boolean,
  lw = 1.8,
): void {
  g.strokeStyle = col;
  g.lineWidth = lw;
  for (let i = 1; i < pts.length; i++) {
    const vert = Math.abs(pts[i - 1][0] - pts[i][0]) < 0.01;
    cutSeg(g, pts[i - 1], pts[i], vert ? cutsV : cutsH);
  }
  if (head) {
    const a = pts[pts.length - 2],
      b = pts[pts.length - 1];
    g.fillStyle = col;
    arrowHead(g, b[0], b[1], b[0] - a[0], b[1] - a[1], 5);
  }
}
interface BoxOpt {
  on: boolean;
  col: string;
  icon: IconId;
  name: string;
  tag?: string;
  tagBad?: boolean;
  /** 図柄と名前の上端（箱の上からの距離） */
  ty: number;
}
function devBox(g: G, x: number, y: number, w: number, h: number, o: BoxOpt): void {
  g.fillStyle = o.on ? mix(o.col, COL.screen, 0.86) : COL.screen;
  g.fillRect(x, y, w, h);
  g.strokeStyle = o.on ? o.col : COL.grid2;
  g.lineWidth = o.on ? 2 : 1;
  g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  const narrow = w < 100;
  drawIcon(g, o.icon, x + 7, y + o.ty + 4, 17, o.on ? o.col : COL.sink);
  if (!narrow) {
    font(g, 13, 700);
    g.fillStyle = o.on ? COL.ink : COL.sink;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    let name = o.name;
    while (g.measureText(name).width > w - 36 && name.length > 2) name = name.slice(0, -1);
    g.fillText(name === o.name ? name : `${name}…`, x + 29, y + o.ty + 13);
  }
  if (o.tag) {
    font(g, 12, 600, true);
    g.fillStyle = o.tagBad ? COL.warn : COL.ink3;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    if (narrow) g.fillText(o.tag, x + 28, y + o.ty + 13);
    else g.fillText(o.tag, x + 8, y + o.ty + 32);
  }
}
const modeTag = (m: Mode, narrow: boolean) => (narrow ? `M${m}` : `モード ${m}`);
/** 通信に使っていない線と機器の濃さ */
const DIM = 0.28;
/** on でなければ薄く描く */
function faint(g: G, on: boolean, f: () => void): void {
  if (on) {
    f();
    return;
  }
  g.save();
  g.globalAlpha = DIM;
  f();
  g.restore();
}

/* ---------- 配線図の組み立て（横に並べる形と縦に積む形で共通） ---------- */
/** 線（バス）の 1 本 */
interface Lane {
  name: string;
  col: string;
  v: Level;
}
/**
 * 機器の端子。lane へつながる。at は線に沿った座標、on は通信に使っているか。
 * kind: stub は SCK・CS（箱の縁まで）、in は線から入口へ、out は出口から線へ、cut は線から切り離された出口
 */
interface Pin {
  lane: number;
  at: number;
  on: boolean;
  kind: 'stub' | 'in' | 'out' | 'cut';
  dev: number;
}
/** 線を描く。始点から最後の端子までは薄く、使っている端子の間だけ濃く */
function drawLanes(g: G, lanes: Lane[], pins: Pin[], pos: (k: number) => number, start: number, horiz: boolean): void {
  lanes.forEach((L, k) => {
    const js = pins.filter((p) => p.lane === k),
      on = js.filter((p) => p.on).map((p) => p.at),
      end = Math.max(...js.map((p) => p.at)),
      seg = (a: number, b: number) => {
        g.beginPath();
        if (horiz) {
          g.moveTo(a, pos(k));
          g.lineTo(b, pos(k));
        } else {
          g.moveTo(pos(k), a);
          g.lineTo(pos(k), b);
        }
        g.stroke();
      };
    laneStroke(g, L.v, L.col);
    faint(g, false, () => seg(start, end));
    if (on.length >= 2) seg(Math.min(...on), Math.max(...on));
    g.setLineDash([]);
  });
}
/** 線が通信に使われているか（使っている端子が 2 つ以上） */
const laneUsed = (pins: Pin[], k: number) => pins.filter((p) => p.lane === k && p.on).length >= 2;
/** つながる点の印 */
function drawJoints(g: G, pins: Pin[], at: (p: Pin) => Pt): void {
  for (const p of pins) if (p.kind !== 'cut') faint(g, p.on, () => dot(g, ...at(p)));
}

/* ---------- 横に並べる形: 上に線、下にマスタと 3 台の箱 ---------- */
function rowGeo(w: number, h: number, nLane: number) {
  const narrow = w < 560,
    ly = (k: number) => 14 + k * 14,
    x0 = narrow ? 34 : 40,
    lx = x0 + 6,
    sg = narrow ? 8 : 14;
  const bw = (w - 6 - lx - 3 * sg) / 4,
    by = ly(nLane - 1) + 16,
    bh = h - by - 6;
  const cs = Math.max(5, Math.min(17, (bw - 16) / 9.3)),
    gx = Math.max(1, cs * 0.12);
  /* レジスタは箱の上の縁から下げ、SCK・CS の端子が升に当たらないようにする */
  const boxes = [0, 1, 2, 3].map((k) => {
    const bx = lx + k * (bw + sg);
    return { bx, R: regGeo(bx + (bw - 9 * (cs + gx)) / 2 + 3, by + 22, cs) };
  });
  return { narrow, ly, x0, bw, by, bh, boxes };
}
type Geo = ReturnType<typeof rowGeo>;
function rowLabels(g: G, Gm: Geo, lanes: Lane[], pins: Pin[]): void {
  font(g, 11, 700, true);
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  lanes.forEach((L, k) => {
    g.globalAlpha = laneUsed(pins, k) ? 1 : DIM;
    g.fillStyle = L.col;
    g.fillText(L.name, 4, Gm.ly(k));
  });
  g.globalAlpha = 1;
}
/** 端子の配線（横に並べる形）。縦の線分は、交わるだけの線の所を空ける */
function rowTaps(g: G, Gm: Geo, lanes: Lane[], pins: Pin[]): void {
  const ys = lanes.map((_, k) => Gm.ly(k));
  for (const p of pins) {
    const { R } = Gm.boxes[p.dev],
      L = lanes[p.lane],
      y = Gm.ly(p.lane);
    faint(g, p.on, () => {
      if (p.kind === 'stub')
        route(
          g,
          [
            [p.at, y],
            [p.at, Gm.by],
          ],
          mix(L.col, COL.screen, 0.4),
          ys,
          [],
          false,
          1.4,
        );
      else if (p.kind === 'in')
        route(
          g,
          [
            [p.at, y],
            [p.at, R.y - 2],
          ],
          L.col,
          ys,
          [],
          true,
        );
      else if (p.kind === 'out')
        route(
          g,
          [
            [p.at, R.y],
            [p.at, y + 2],
          ],
          L.col,
          ys,
          [],
          true,
        );
      else {
        /* 切り離された出口: 線の手前で開いたスイッチ */
        route(
          g,
          [
            [p.at, R.y],
            [p.at, Gm.by - 6],
          ],
          mix(L.col, COL.screen, 0.5),
          ys,
          [],
          false,
          1.6,
        );
        g.strokeStyle = COL.ink3;
        g.lineWidth = 1.4;
        g.beginPath();
        g.moveTo(p.at, Gm.by - 6);
        g.lineTo(p.at + 6, y + 12);
        g.moveTo(p.at, y);
        g.lineTo(p.at, y + 6);
        g.stroke();
      }
    });
  }
}
function masterInfo(g: G, s: Sim, pt: number, x: number, y: number): void {
  const st = stateAt(s.devs[0], pt);
  font(g, 12, 500);
  g.fillStyle = COL.ink3;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText('受信', x, y);
  font(g, 14, 700, true);
  s.devs[0].got.slice(0, Math.floor(st.cnt / 8)).forEach((v, n) => {
    g.fillStyle = v === s.want.get(0)?.[n] ? COL.s : COL.warn;
    g.fillText(hex(v), x + 32 + n * 46, y);
  });
}
/** マスタの端子: 出口から MOSI、SCK と CS、MISO から入口 */
function masterPins(
  s: Sim,
  csLanes: number[],
  mosiAt: number,
  misoAt: number,
  stubAt: (j: number, n: number) => number,
): Pin[] {
  const taps = [0, ...csLanes];
  return [
    { lane: 1, at: mosiAt, on: true, kind: 'out', dev: 0 },
    ...taps.map(
      (l, j): Pin => ({
        lane: l,
        at: stubAt(j, taps.length),
        on: l === 0 || s.chain || s.sel.includes(l - 3),
        kind: 'stub',
        dev: 0,
      }),
    ),
    { lane: 2, at: misoAt, on: true, kind: 'in', dev: 0 },
  ];
}
function lanesOf(s: Sim, pt: number): Lane[] {
  const LC = lineCol(),
    base: Lane[] = [
      { name: 'SCK', col: LC.sck, v: valAt(s.lines.sck, pt).v },
      { name: 'MOSI', col: LC.mosi, v: valAt(s.lines.mosi, pt).v },
      { name: 'MISO', col: LC.miso, v: valAt(s.lines.miso, pt).v },
    ];
  return s.chain
    ? [...base, { name: 'CS', col: LC.cs, v: valAt(s.lines.cs[0], pt).v }]
    : [...base, ...[0, 1, 2].map((k): Lane => ({ name: `CS${k + 1}`, col: LC.cs, v: valAt(s.lines.cs[k], pt).v }))];
}
/** 選ばれた機器の出口が線につながっているか（CS が Low の間） */
const driving = (s: Sim, pt: number, i: number) => !!stateAt(s.devs[i], pt).o;

/** 個別の CS: マスタと 3 台を横に並べ、上の 6 本の線でつなぐ */
function busCS(g: G, s: Sim, pt: number, w: number, h: number): void {
  const Gm = rowGeo(w, h, 6),
    lanes = lanesOf(s, pt),
    MR = Gm.boxes[0].R;
  const pins: Pin[] = masterPins(s, [3, 4, 5], MR.out, MR.slot, (j, n) => MR.x + MR.w * ((j + 1) / (n + 1)));
  DEVS.forEach((_, k) => {
    const R = Gm.boxes[k + 1].R,
      on = s.sel.includes(k);
    pins.push(
      { lane: 2, at: R.out, on, kind: on && driving(s, pt, k + 1) ? 'out' : 'cut', dev: k + 1 },
      { lane: 0, at: R.x + R.w * 0.33, on, kind: 'stub', dev: k + 1 },
      { lane: 3 + k, at: R.x + R.w * 0.67, on, kind: 'stub', dev: k + 1 },
      { lane: 1, at: R.slot, on, kind: 'in', dev: k + 1 },
    );
  });
  /* 箱 → 線 → 端子の配線 → レジスタ → つながる点 → 進むビット */
  devBox(g, Gm.boxes[0].bx, Gm.by, Gm.bw, Gm.bh, {
    on: true,
    col: COL.m,
    icon: 'm',
    name: 'マスタ',
    tag: modeTag(s.c.mode, Gm.narrow),
    ty: MR.cs + 26,
  });
  DEVS.forEach((d, k) => {
    faint(g, s.sel.includes(k), () =>
      devBox(g, Gm.boxes[k + 1].bx, Gm.by, Gm.bw, Gm.bh, {
        on: s.sel.includes(k),
        col: COL.s,
        icon: d.k,
        name: d.name,
        tag: modeTag(d.mode, Gm.narrow),
        tagBad: sampleRising(d.mode) !== sampleRising(s.c.mode),
        ty: MR.cs + 26,
      }),
    );
  });
  drawLanes(g, lanes, pins, Gm.ly, Gm.x0, true);
  rowLabels(g, Gm, lanes, pins);
  rowTaps(g, Gm, lanes, pins);
  const stM = stateAt(s.devs[0], pt);
  regDraw(g, stM, MR, pt, s, isSent(stM));
  DEVS.forEach((_, k) => {
    const on = s.sel.includes(k),
      st = stateAt(s.devs[k + 1], pt);
    faint(g, on, () => regDraw(g, st, Gm.boxes[k + 1].R, pt, s, on && isSent(st)));
  });
  drawJoints(g, pins, (p) => [p.at, Gm.ly(p.lane)]);
  if (!Gm.narrow && Gm.bh > 100) masterInfo(g, s, pt, Gm.boxes[0].bx + 8, Gm.by + MR.cs + 26 + 52);
  const ly = Gm.ly,
    SR = Gm.boxes[s.sel[0] + 1].R;
  flowPip(
    g,
    s,
    pt,
    0,
    s.sel[0] + 1,
    [
      [MR.out, MR.mid],
      [MR.out, ly(1)],
      [SR.slot, ly(1)],
      [SR.slot, SR.mid],
    ],
    MR.cs,
  );
  flowPip(
    g,
    s,
    pt,
    s.sel[0] + 1,
    0,
    [
      [SR.out, SR.mid],
      [SR.out, ly(2)],
      [MR.slot, ly(2)],
      [MR.slot, MR.mid],
    ],
    MR.cs,
  );
}

/** デイジーチェーン: マスタ・LED 3・2・1 と並べ、右の LED 1 から左へ押し出す */
function busChain(g: G, s: Sim, pt: number, w: number, h: number): void {
  const Gm = rowGeo(w, h, 4),
    lanes = lanesOf(s, pt),
    MR = Gm.boxes[0].R,
    at = (i: number) => Gm.boxes[4 - i];
  const pins: Pin[] = masterPins(s, [3], MR.out, MR.slot, (j, n) => MR.x + MR.w * ((j + 1) / (n + 1)));
  for (const i of [1, 2, 3]) {
    const R = at(i).R,
      dev = 4 - i;
    pins.push(
      { lane: 0, at: R.x + R.w * 0.33, on: true, kind: 'stub', dev },
      { lane: 3, at: R.x + R.w * 0.67, on: true, kind: 'stub', dev },
    );
    if (i === 1) pins.push({ lane: 1, at: R.slot, on: true, kind: 'in', dev });
    if (i === 3) pins.push({ lane: 2, at: R.out, on: true, kind: 'out', dev });
  }
  devBox(g, Gm.boxes[0].bx, Gm.by, Gm.bw, Gm.bh, {
    on: true,
    col: COL.m,
    icon: 'm',
    name: 'マスタ',
    tag: modeTag(s.c.mode, Gm.narrow),
    ty: MR.cs + 26,
  });
  for (const i of [1, 2, 3])
    devBox(g, at(i).bx, Gm.by, Gm.bw, Gm.bh, {
      on: true,
      col: COL.s,
      icon: 'led',
      name: LEDS[i - 1].name,
      ty: MR.cs + 36,
    });
  drawLanes(g, lanes, pins, Gm.ly, Gm.x0, true);
  rowLabels(g, Gm, lanes, pins);
  rowTaps(g, Gm, lanes, pins);
  /* LED どうしのつなぎ: 前の出口から次の入口へ、箱のすぐ上を通る */
  for (const i of [2, 3]) {
    const P = at(i - 1).R,
      R = at(i).R;
    route(
      g,
      [
        [P.out, P.y],
        [P.out, Gm.by - 7],
        [R.slot, Gm.by - 7],
        [R.slot, R.y - 2],
      ],
      lineCol().miso,
      [],
      [],
      true,
    );
  }
  const stM = stateAt(s.devs[0], pt);
  regDraw(g, stM, MR, pt, s, isSent(stM));
  for (const i of [1, 2, 3]) {
    const R = at(i).R,
      dv = s.devs[i],
      st = stateAt(dv, pt);
    regDraw(g, st, R, pt, s, isSent(st));
    /* 8 個の LED。CS が上がると受け取った値で光る */
    const lit = pt >= s.tUp ? (dv.got.at(-1) ?? 0) : 0,
      r = Math.max(2, Math.min(4.5, R.p * 0.3));
    for (let j = 0; j < 8; j++) {
      const on = (lit >> (7 - j)) & 1;
      g.beginPath();
      g.arc(R.x + j * R.p + R.cs / 2, R.y + R.cs + 9, r, 0, 7);
      g.fillStyle = on ? COL.ch1 : COL.screen;
      g.fill();
      g.strokeStyle = on ? COL.ch1 : COL.grid2;
      g.lineWidth = 1;
      g.stroke();
    }
  }
  drawJoints(g, pins, (p) => [p.at, Gm.ly(p.lane)]);
  if (!Gm.narrow && Gm.bh > 100) masterInfo(g, s, pt, Gm.boxes[0].bx + 8, Gm.by + MR.cs + 26 + 52);
  const ly = Gm.ly,
    R1 = at(1).R,
    R2 = at(2).R,
    R3 = at(3).R,
    sz = MR.cs,
    yl = Gm.by - 7;
  flowPip(
    g,
    s,
    pt,
    0,
    1,
    [
      [MR.out, MR.mid],
      [MR.out, ly(1)],
      [R1.slot, ly(1)],
      [R1.slot, R1.mid],
    ],
    sz,
  );
  flowPip(
    g,
    s,
    pt,
    1,
    2,
    [
      [R1.out, R1.mid],
      [R1.out, yl],
      [R2.slot, yl],
      [R2.slot, R2.mid],
    ],
    sz,
  );
  flowPip(
    g,
    s,
    pt,
    2,
    3,
    [
      [R2.out, R2.mid],
      [R2.out, yl],
      [R3.slot, yl],
      [R3.slot, R3.mid],
    ],
    sz,
  );
  flowPip(
    g,
    s,
    pt,
    3,
    0,
    [
      [R3.out, R3.mid],
      [R3.out, ly(2)],
      [MR.slot, ly(2)],
      [MR.slot, MR.mid],
    ],
    sz,
  );
}

/* ---------- 狭い画面: 線を左に縦に並べ、箱を上から積む（升を大きく保つ） ---------- */
/** 縦に積む配線図にする幅 */
export const COL_W = 520;
const COL_TOP = 38,
  COL_MH = 82,
  COL_GAP = 8;
const colBoxH = (chain: boolean) => (chain ? 72 : 64);
/** 縦に積んだときの高さ */
export const colHeight = (chain: boolean): number => COL_TOP + COL_MH + 3 * (colBoxH(chain) + COL_GAP) + 4;
function colGeo(w: number, nLane: number, chain: boolean) {
  const lxL = (k: number) => 12 + k * 13,
    lx = lxL(nLane - 1) + 16,
    bw = w - 6 - lx;
  const cs = Math.max(8, Math.min(20, (bw - 24) / 9.3));
  let y = COL_TOP;
  const boxes = [0, 1, 2, 3].map((k) => {
    const bh = k ? colBoxH(chain) : COL_MH,
      b = { by: y, bh, R: regGeo(lx + 12, y + 18, cs) };
    y += bh + COL_GAP;
    return b;
  });
  return { lxL, lx, bw, boxes };
}
type ColGeo = ReturnType<typeof colGeo>;
/** 縦の線の名前（上に縦書き） */
function colLabels(g: G, Q: ColGeo, lanes: Lane[], pins: Pin[]): void {
  font(g, 11, 700, true);
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  lanes.forEach((L, i) => {
    g.save();
    g.globalAlpha = laneUsed(pins, i) ? 1 : DIM;
    g.translate(Q.lxL(i), COL_TOP - 4);
    g.rotate(-Math.PI / 2);
    g.fillStyle = L.col;
    g.fillText(L.name, 0, 0);
    g.restore();
  });
}
/** 箱と、図柄・名前・モードの 1 行（レジスタの下） */
function colBox(g: G, Q: ColGeo, k: number, o: Omit<BoxOpt, 'ty'>): void {
  const { by, bh, R } = Q.boxes[k],
    x = Q.lx,
    w = Q.bw,
    y = R.y + R.cs + (o.icon === 'led' ? 18 : 6);
  g.fillStyle = o.on ? mix(o.col, COL.screen, 0.86) : COL.screen;
  g.fillRect(x, by, w, bh);
  g.strokeStyle = o.on ? o.col : COL.grid2;
  g.lineWidth = o.on ? 2 : 1;
  g.strokeRect(x + 0.5, by + 0.5, w - 1, bh - 1);
  drawIcon(g, o.icon, x + 8, y + 1, 16, o.on ? o.col : COL.sink);
  font(g, 13, 700);
  g.fillStyle = o.on ? COL.ink : COL.sink;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText(o.name, x + 30, y + 9);
  if (o.tag) {
    font(g, 12, 600, true);
    g.fillStyle = o.tagBad ? COL.warn : COL.ink3;
    g.textAlign = 'right';
    g.fillText(o.tag, x + w - 8, y + 9);
  }
}
/** 端子の配線（縦に積む形）。横の線分は、交わるだけの線の所を空ける */
function colTaps(g: G, Q: ColGeo, lanes: Lane[], pins: Pin[]): void {
  const xs = lanes.map((_, k) => Q.lxL(k));
  for (const p of pins) {
    const { R } = Q.boxes[p.dev],
      L = lanes[p.lane],
      x = Q.lxL(p.lane);
    faint(g, p.on, () => {
      if (p.kind === 'stub')
        route(
          g,
          [
            [x, p.at],
            [Q.lx, p.at],
          ],
          mix(L.col, COL.screen, 0.4),
          [],
          xs,
          false,
          1.4,
        );
      else if (p.kind === 'in')
        route(
          g,
          [
            [x, p.at],
            [R.slot, p.at],
            [R.slot, R.y - 2],
          ],
          L.col,
          [],
          xs,
          true,
        );
      else if (p.kind === 'out')
        route(
          g,
          [
            [R.out, R.y],
            [R.out, p.at],
            [x + 2, p.at],
          ],
          L.col,
          [],
          xs,
          true,
        );
      else {
        route(
          g,
          [
            [R.out, R.y],
            [R.out, p.at],
            [Q.lx - 4, p.at],
          ],
          mix(L.col, COL.screen, 0.5),
          [],
          xs,
          false,
          1.6,
        );
        g.strokeStyle = COL.ink3;
        g.lineWidth = 1.4;
        g.beginPath();
        g.moveTo(Q.lx - 4, p.at);
        g.lineTo(x + 12, p.at - 6);
        g.moveTo(x, p.at);
        g.lineTo(x + 6, p.at);
        g.stroke();
      }
    });
  }
}
function busCSCol(g: G, s: Sim, pt: number, w: number, _h: number): void {
  const Q = colGeo(w, 6, false),
    lanes = lanesOf(s, pt),
    MB = Q.boxes[0],
    MR = MB.R;
  const pins: Pin[] = masterPins(s, [3, 4, 5], MB.by + 11, MB.by + 5, (j, n) => MB.by + MB.bh - 8 - (n - 1 - j) * 7);
  DEVS.forEach((_, k) => {
    const B = Q.boxes[k + 1],
      on = s.sel.includes(k);
    pins.push(
      { lane: 2, at: B.by + 11, on, kind: on && driving(s, pt, k + 1) ? 'out' : 'cut', dev: k + 1 },
      { lane: 0, at: B.by + B.bh - 15, on, kind: 'stub', dev: k + 1 },
      { lane: 3 + k, at: B.by + B.bh - 8, on, kind: 'stub', dev: k + 1 },
      { lane: 1, at: B.by + 5, on, kind: 'in', dev: k + 1 },
    );
  });
  colBox(g, Q, 0, { on: true, col: COL.m, icon: 'm', name: 'マスタ', tag: `モード ${s.c.mode}` });
  DEVS.forEach((d, k) => {
    faint(g, s.sel.includes(k), () =>
      colBox(g, Q, k + 1, {
        on: s.sel.includes(k),
        col: COL.s,
        icon: d.k,
        name: d.name,
        tag: `モード ${d.mode}`,
        tagBad: sampleRising(d.mode) !== sampleRising(s.c.mode),
      }),
    );
  });
  drawLanes(g, lanes, pins, Q.lxL, COL_TOP, false);
  colLabels(g, Q, lanes, pins);
  colTaps(g, Q, lanes, pins);
  const stM = stateAt(s.devs[0], pt);
  regDraw(g, stM, MR, pt, s, isSent(stM));
  DEVS.forEach((_, k) => {
    const on = s.sel.includes(k),
      st = stateAt(s.devs[k + 1], pt);
    faint(g, on, () => regDraw(g, st, Q.boxes[k + 1].R, pt, s, on && isSent(st)));
  });
  drawJoints(g, pins, (p) => [Q.lxL(p.lane), p.at]);
  masterInfo(g, s, pt, Q.lx + 30, MB.by + MB.bh - 12);
  const SB = Q.boxes[s.sel[0] + 1],
    SR = SB.R;
  flowPip(
    g,
    s,
    pt,
    0,
    s.sel[0] + 1,
    [
      [MR.out, MR.mid],
      [MR.out, MB.by + 11],
      [Q.lxL(1), MB.by + 11],
      [Q.lxL(1), SB.by + 5],
      [SR.slot, SB.by + 5],
      [SR.slot, SR.mid],
    ],
    MR.cs,
  );
  flowPip(
    g,
    s,
    pt,
    s.sel[0] + 1,
    0,
    [
      [SR.out, SR.mid],
      [SR.out, SB.by + 11],
      [Q.lxL(2), SB.by + 11],
      [Q.lxL(2), MB.by + 5],
      [MR.slot, MB.by + 5],
      [MR.slot, MR.mid],
    ],
    MR.cs,
  );
}
function busChainCol(g: G, s: Sim, pt: number, w: number, _h: number): void {
  const Q = colGeo(w, 4, true),
    lanes = lanesOf(s, pt),
    B = Q.boxes,
    MR = B[0].R,
    ch = Q.lx - 6;
  const pins: Pin[] = masterPins(s, [3], B[0].by + 11, B[0].by + 5, (j, n) => B[0].by + B[0].bh - 8 - (n - 1 - j) * 7);
  for (const i of [1, 2, 3]) {
    pins.push(
      { lane: 0, at: B[i].by + B[i].bh - 15, on: true, kind: 'stub', dev: i },
      { lane: 3, at: B[i].by + B[i].bh - 8, on: true, kind: 'stub', dev: i },
    );
    if (i === 1) pins.push({ lane: 1, at: B[i].by + 5, on: true, kind: 'in', dev: i });
    if (i === 3) pins.push({ lane: 2, at: B[i].by + 11, on: true, kind: 'out', dev: i });
  }
  colBox(g, Q, 0, { on: true, col: COL.m, icon: 'm', name: 'マスタ', tag: `モード ${s.c.mode}` });
  for (const i of [1, 2, 3]) colBox(g, Q, i, { on: true, col: COL.s, icon: 'led', name: LEDS[i - 1].name });
  drawLanes(g, lanes, pins, Q.lxL, COL_TOP, false);
  colLabels(g, Q, lanes, pins);
  colTaps(g, Q, lanes, pins);
  /* LED どうしのつなぎ: 前の出口の上から箱の左を通って次の入口へ */
  for (const i of [2, 3]) {
    const P = B[i - 1].R,
      R = B[i].R;
    route(
      g,
      [
        [P.out, P.y],
        [P.out, B[i - 1].by + 11],
        [ch, B[i - 1].by + 11],
        [ch, B[i].by + 5],
        [R.slot, B[i].by + 5],
        [R.slot, R.y - 2],
      ],
      lineCol().miso,
      [],
      [],
      true,
    );
  }
  const stM = stateAt(s.devs[0], pt);
  regDraw(g, stM, MR, pt, s, isSent(stM));
  for (const i of [1, 2, 3]) {
    const R = B[i].R,
      dv = s.devs[i],
      st = stateAt(dv, pt);
    regDraw(g, st, R, pt, s, isSent(st));
    const lit = pt >= s.tUp ? (dv.got.at(-1) ?? 0) : 0;
    for (let j = 0; j < 8; j++) {
      const on = (lit >> (7 - j)) & 1;
      g.beginPath();
      g.arc(R.x + j * R.p + R.cs / 2, R.y + R.cs + 8, 4, 0, 7);
      g.fillStyle = on ? COL.ch1 : COL.screen;
      g.fill();
      g.strokeStyle = on ? COL.ch1 : COL.grid2;
      g.lineWidth = 1;
      g.stroke();
    }
  }
  drawJoints(g, pins, (p) => [Q.lxL(p.lane), p.at]);
  masterInfo(g, s, pt, Q.lx + 30, B[0].by + B[0].bh - 12);
  const R1 = B[1].R,
    R2 = B[2].R,
    R3 = B[3].R,
    sz = MR.cs;
  flowPip(
    g,
    s,
    pt,
    0,
    1,
    [
      [MR.out, MR.mid],
      [MR.out, B[0].by + 11],
      [Q.lxL(1), B[0].by + 11],
      [Q.lxL(1), B[1].by + 5],
      [R1.slot, B[1].by + 5],
      [R1.slot, R1.mid],
    ],
    sz,
  );
  flowPip(
    g,
    s,
    pt,
    1,
    2,
    [
      [R1.out, R1.mid],
      [R1.out, B[1].by + 11],
      [ch, B[1].by + 11],
      [ch, B[2].by + 5],
      [R2.slot, B[2].by + 5],
      [R2.slot, R2.mid],
    ],
    sz,
  );
  flowPip(
    g,
    s,
    pt,
    2,
    3,
    [
      [R2.out, R2.mid],
      [R2.out, B[2].by + 11],
      [ch, B[2].by + 11],
      [ch, B[3].by + 5],
      [R3.slot, B[3].by + 5],
      [R3.slot, R3.mid],
    ],
    sz,
  );
  flowPip(
    g,
    s,
    pt,
    3,
    0,
    [
      [R3.out, R3.mid],
      [R3.out, B[3].by + 11],
      [Q.lxL(2), B[3].by + 11],
      [Q.lxL(2), B[0].by + 5],
      [MR.slot, B[0].by + 5],
      [MR.slot, MR.mid],
    ],
    sz,
  );
}

export function drawBus(c: HTMLCanvasElement, s: Sim, pt: number): void {
  const sf = surface(c);
  if (!sf) return;
  sf.g.clearRect(0, 0, sf.w, sf.h);
  if (sf.w < COL_W) (s.chain ? busChainCol : busCSCol)(sf.g, s, pt, sf.w, sf.h);
  else (s.chain ? busChain : busCS)(sf.g, s, pt, sf.w, sf.h);
}
