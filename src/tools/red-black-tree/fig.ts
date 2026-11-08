/**
 * 図: 赤と黒の丸の木を描く。x は中順の順位、y は深さで、回転ではノードが時間をかけて入れ替わる。
 * 入れるキーと探しているキーは札にして、今比べているノードの上に出す。
 * 比較の枠は枠ごとのキャンバスに小さな木を描く
 */
import { type Frame, inspect, type Shape, type Trace } from './model';

/** 図の 1 行 */
export interface Cell {
  trace: Trace;
  /** 枠の見出し（比較） */
  name: string;
  /** 比較の枠のキャンバス */
  cv?: HTMLCanvasElement;
  /** ノードと札の今の位置（アニメーション） */
  pos: Map<string, Anim>;
}
interface Anim {
  x: number;
  y: number;
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  t0: number;
  seen: number;
}
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface DrawOpt {
  cmp: boolean;
  frameOf: (c: Cell) => Frame;
  /** 描く時刻 [ms] */
  now: number;
  /** 速さ [回/秒] */
  rate: number;
  snap: boolean;
  /** なぞっているノード */
  hover: number | null;
  /** 図の左上に出す文（単独） */
  say: string;
  /** NIL の葉を描く */
  nil: boolean;
}

const C = {
  ink: '',
  ink2: '',
  grid: '',
  bad: '',
  accent: '',
  sans: '',
  cmp: '',
  mov: '',
  done: '',
  wait: '',
  node: '',
  line: '',
  screen: '',
  onMov: '',
  onDone: '',
  red: '',
  blk: '',
  blkLine: '',
  onRed: '',
  onBlk: '',
};
export function readColors(): void {
  const s = getComputedStyle(document.documentElement),
    v = (k: string) => s.getPropertyValue(k).trim();
  C.ink = v('--ink');
  C.ink2 = v('--ink-2');
  C.grid = v('--grid');
  C.bad = v('--warn');
  C.accent = v('--accent');
  C.sans = v('--sans');
  C.cmp = v('--rb-cmp');
  C.mov = v('--rb-mov');
  C.done = v('--rb-done');
  C.wait = v('--rb-wait');
  C.node = v('--rb-node');
  C.line = v('--rb-line');
  C.screen = v('--screen');
  C.onMov = v('--rb-on-mov');
  C.onDone = v('--rb-on-done');
  C.red = v('--rb-red');
  C.blk = v('--rb-blk');
  C.blkLine = v('--rb-blk-line');
  C.onRed = v('--rb-on-red');
  C.onBlk = v('--rb-on-blk');
}
function text(
  g: CanvasRenderingContext2D,
  t: string,
  x: number,
  y: number,
  color: string,
  size = 13,
  weight = 700,
  al: CanvasTextAlign = 'center',
): void {
  g.font = `${weight} ${size}px ${C.sans}`;
  g.textAlign = al;
  g.fillStyle = color;
  g.fillText(t, x, y);
}

/* ---------- 大きさ ---------- */
const narrowOf = (W: number): boolean => W < 620;
/** 比較の枠の図の高さ */
const CMP_H = 236;
/** 段の間を詰めずに描く段数の上限（二分探索木は伸びるので、この先は段の間を詰める） */
const MAX_ROWS = 9;
const TOP = 76;
const BOTTOM = 40;
function oneHeight(W: number, t: Trace): number {
  const rows = Math.max(3, Math.min(MAX_ROWS, t.maxH));
  return Math.max(narrowOf(W) ? 360 : 420, TOP + (rows - 1) * (narrowOf(W) ? 52 : 60) + BOTTOM + 24);
}

/* ---------- 動き ---------- */
const ease = (u: number): number => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
let now = 0;
let moveMs = 400;
let snapNow = false;
let baseSnap = false;
let moving = false;
let tickNo = 0;
/** 目標へ時間をかけて動かす。初めて出るものは from の位置から動き出す */
function anim(c: Cell, key: string, tx: number, ty: number, from: readonly string[] = []): { x: number; y: number } {
  let p = c.pos.get(key);
  if (!p || snapNow) {
    const o = snapNow ? undefined : from.map((k) => c.pos.get(k)).find(Boolean);
    p = o
      ? { x: o.x, y: o.y, fx: o.x, fy: o.y, tx, ty, t0: now, seen: tickNo }
      : { x: tx, y: ty, fx: tx, fy: ty, tx, ty, t0: -1e9, seen: tickNo };
    c.pos.set(key, p);
  }
  if (p.tx !== tx || p.ty !== ty) {
    p.fx = p.x;
    p.fy = p.y;
    p.tx = tx;
    p.ty = ty;
    p.t0 = now;
  }
  const u = Math.min(1, (now - p.t0) / moveMs);
  if (u < 1) {
    const e = ease(u);
    p.x = p.fx + (p.tx - p.fx) * e;
    p.y = p.fy + (p.ty - p.fy) * e;
    moving = true;
  } else {
    p.x = p.tx;
    p.y = p.ty;
  }
  p.seen = tickNo;
  return p;
}
function sweep(c: Cell): void {
  for (const [k, p] of c.pos) if (p.seen !== tickNo) c.pos.delete(k);
}

/* ---------- 形 ---------- */
const shapes = new WeakMap<Frame, Shape>();
export function shapeOf(f: Frame): Shape {
  let v = shapes.get(f);
  if (!v) {
    v = inspect(f);
    shapes.set(f, v);
  }
  return v;
}

/* ---------- なぞる ---------- */
let hits: { x: number; y: number; r: number; k: number }[] = [];
/** (x, y) にあるノード */
export function hitAt(x: number, y: number): number | null {
  let best: number | null = null,
    bd = Infinity;
  for (const q of hits) {
    const d = Math.hypot(x - q.x, y - q.y);
    if (d <= Math.max(q.r + 4, 12) && d < bd) {
      bd = d;
      best = q.k;
    }
  }
  return best;
}

/* ---------- 木 ---------- */
interface TreeOpt {
  mini: boolean;
  hover: number | null;
  nil: boolean;
}
function drawTree(g: CanvasRenderingContext2D, c: Cell, f: Frame, Z: Rect, o: TreeOpt): void {
  const t = c.trace,
    s = shapeOf(f),
    N = s.order.length,
    rows = Math.max(3, t.maxH),
    sp = Math.min(o.mini ? 40 : 70, Z.w / Math.max(N, o.mini ? 6 : 8)),
    dy = Math.min(o.mini ? 40 : narrowOf(Z.w) ? 52 : 60, Z.h / Math.max(rows - 1, 1)),
    r = Math.max(2.5, Math.min(o.mini ? 9 : 15, sp * 0.44, dy * 0.42)),
    x0 = Z.x + (Z.w - N * sp) / 2,
    size = o.mini ? (r >= 9 ? 12 : 0) : r >= 13 ? 15 : r >= 10.5 ? 13 : 0,
    P = new Map<number, { x: number; y: number }>();
  s.order.forEach((k, i) => {
    P.set(k, anim(c, `n${k}`, x0 + (i + 0.5) * sp, Z.y + s.depth[k] * dy, ['q']));
  });
  const fam = (k: number): '' | 'self' | 'kin' => {
    const h = o.hover;
    if (h == null || !(h in f.N)) return '';
    if (k === h) return 'self';
    return s.parent[k] === h || s.parent[h] === k ? 'kin' : '';
  };
  /* 枝。赤が続く枝は破線 */
  g.lineCap = 'round';
  for (const k of s.order) {
    const n = f.N[k],
      a = P.get(k) as { x: number; y: number };
    for (const ch of [n.l, n.r]) {
      if (ch === null) continue;
      const b = P.get(ch) as { x: number; y: number },
        rr = n.c === 1 && f.N[ch].c === 1;
      g.setLineDash(rr ? [5, 4] : []);
      g.strokeStyle = rr ? C.bad : C.line;
      g.lineWidth = rr ? 3 : o.mini ? 1.2 : 1.6;
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
    }
  }
  g.setLineDash([]);
  /* NIL の葉。黒の高さを数えるときの終わり */
  if (o.nil && r >= 6) {
    const q = Math.max(3, r * 0.4);
    for (const k of s.order) {
      const n = f.N[k],
        a = P.get(k) as { x: number; y: number };
      for (const [ch, sd] of [
        [n.l, -1],
        [n.r, 1],
      ] as const) {
        if (ch !== null) continue;
        const x = a.x + sd * r * 0.95,
          y = a.y + r * 2.2;
        g.strokeStyle = C.line;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(a.x + sd * r * 0.5, a.y + r * 0.85);
        g.lineTo(x, y - q);
        g.stroke();
        g.fillStyle = C.blk;
        g.fillRect(x - q, y - q, 2 * q, 2 * q);
        g.strokeStyle = C.blkLine;
        g.strokeRect(x - q, y - q, 2 * q, 2 * q);
      }
    }
  }
  /* ノード */
  const ring = (x: number, y: number, rad: number, col: string, w: number, dash?: number[]) => {
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.setLineDash(dash ?? []);
    g.strokeStyle = col;
    g.lineWidth = w;
    g.stroke();
    g.setLineDash([]);
  };
  for (const k of s.order) {
    const n = f.N[k],
      a = P.get(k) as { x: number; y: number },
      got = f.got.includes(k),
      kin = fam(k);
    if (got) {
      g.beginPath();
      g.arc(a.x, a.y, r + 5, 0, Math.PI * 2);
      g.fillStyle = C.done;
      g.fill();
    }
    g.beginPath();
    g.arc(a.x, a.y, r, 0, Math.PI * 2);
    g.fillStyle = n.c === 1 ? C.red : n.c === 0 ? C.blk : C.node;
    g.fill();
    if (n.c !== 1) {
      g.strokeStyle = n.c === 0 ? C.blkLine : C.line;
      g.lineWidth = 1.2;
      g.stroke();
    }
    const w = o.mini ? 2.2 : 3;
    if (f.cmp.includes(k)) ring(a.x, a.y, r + w + 0.5, C.cmp, w);
    if (f.mov.includes(k)) ring(a.x, a.y, r + w + 0.5, C.mov, w);
    if (f.bad.includes(k)) ring(a.x, a.y, r + w + 0.5, C.bad, w * 0.85, [4, 3]);
    if (kin) ring(a.x, a.y, r + 7, kin === 'self' ? C.accent : C.ink, 2);
    if (size) text(g, String(k), a.x, a.y + 0.5, n.c === 1 ? C.onRed : n.c === 0 ? C.onBlk : C.ink, size);
    /* AVL木は左右の高さの差を添える */
    if (!o.mini && n.c === 2 && t.def.kind === 'avl' && n.i && size)
      text(g, n.i > 0 ? `+${n.i}` : `−${-n.i}`, a.x + r + 3, a.y - r + 2, C.ink2, 13, 600, 'left');
    if (!o.mini) hits.push({ x: a.x, y: a.y, r, k });
  }
  if (!o.mini && f.root !== null && size) {
    const a = P.get(f.root) as { x: number; y: number };
    text(g, '根', a.x - r - 8, a.y + 0.5, C.ink2, 13, 700, 'right');
  }
  /* 札: 入れるキーは塗り、探しているキーは枠だけに「?」 */
  if (f.cur && !o.mini) {
    const cur = f.cur,
      at = cur.at !== null ? P.get(cur.at) : undefined,
      label = String(cur.k),
      fs = 15;
    g.font = `700 ${fs}px ${C.sans}`;
    const bw = Math.max(28, g.measureText(label).width + 12),
      bh = 24,
      mark = cur.q ? 16 : 0,
      /* ノードの右上に置く。右端からはみ出すときは左上 */
      right = at ? at.x + r + 4 : Z.x + Z.w / 2 - (bw + mark) / 2,
      tx = at && right + bw + mark > Z.x + Z.w + 12 ? at.x - r - 4 - bw - mark : right,
      ty = at ? at.y - r - bh + 4 : Z.y - bh - 8,
      Q = anim(c, 'q', tx, ty);
    if (cur.q) {
      g.fillStyle = C.screen;
      g.strokeStyle = C.cmp;
      g.lineWidth = 2;
      g.fillRect(Q.x, Q.y, bw, bh);
      g.strokeRect(Q.x, Q.y, bw, bh);
      text(g, label, Q.x + bw / 2, Q.y + bh / 2 + 0.5, C.ink, fs);
      text(g, '?', Q.x + bw + mark / 2 + 1, Q.y + bh / 2 + 0.5, C.cmp, fs + 2);
    } else {
      g.fillStyle = C.mov;
      g.fillRect(Q.x, Q.y, bw, bh);
      text(g, label, Q.x + bw / 2, Q.y + bh / 2 + 0.5, C.onMov, fs);
    }
  }
}

/* ---------- 全体 ---------- */
/** 右上の待機中のキー */
function drawWaiting(g: CanvasRenderingContext2D, t: Trace, f: Frame, W: number): void {
  if (f.s !== 0) return;
  const rest = t.keys.slice(f.next + (f.cur && !f.cur.q ? 1 : 0));
  if (!rest.length) return;
  let x = W - 14;
  if (!narrowOf(W))
    for (let i = Math.min(6, rest.length) - 1; i >= 0; i--) {
      x -= 34;
      g.strokeStyle = C.wait;
      g.lineWidth = 1.2;
      g.strokeRect(x, 8, 31, 24);
      text(g, String(rest[i]), x + 15.5, 20.5, C.ink2, 13, 500);
    }
  text(g, `待機中 ${rest.length}`, x - (narrowOf(W) ? 0 : 8), 20.5, C.ink2, 13, 500, 'right');
}
function drawOne(g: CanvasRenderingContext2D, c: Cell, f: Frame, W: number, H: number, o: DrawOpt): void {
  if (o.say) text(g, o.say, 14, 21, C.ink, 17, 700, 'left');
  drawWaiting(g, c.trace, f, W);
  drawTree(
    g,
    c,
    f,
    { x: 16, y: TOP, w: W - 32, h: H - TOP - BOTTOM - 24 },
    { mini: false, hover: o.hover, nil: o.nil },
  );
  const s = shapeOf(f);
  if (s.n) {
    const bh = c.trace.def.fam ? `　黒の高さ ${s.bh}` : '';
    text(g, `高さ ${s.h}${bh}`, 14, H - 16, C.ink2, 13, 600, 'left');
  }
}
/** 比較の枠を 1 つ描く */
function drawCell(c: Cell, o: DrawOpt): void {
  const cv = c.cv;
  if (!cv) return;
  const W = (cv.parentElement as HTMLElement).clientWidth || 300,
    g = sizeCanvas(cv, W, CMP_H),
    f = o.frameOf(c);
  if (!g) return;
  if (f.say) text(g, f.say, 10, 14, C.ink2, 12.5, 700, 'left');
  drawTree(g, c, f, { x: 8, y: 40, w: W - 16, h: CMP_H - 40 - 30 }, { mini: true, hover: null, nil: false });
  const s = shapeOf(f);
  if (s.n) text(g, `高さ ${s.h}`, 10, CMP_H - 12, C.ink2, 12.5, 600, 'left');
  sweep(c);
}
/** キャンバスの大きさを合わせて消す。大きさが変わったら動きを飛ばす */
function sizeCanvas(cv: HTMLCanvasElement, W: number, H: number): CanvasRenderingContext2D | null {
  const dpr = devicePixelRatio || 1;
  snapNow = baseSnap;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    cv.style.height = `${H}px`;
    snapNow = true;
  }
  const g = cv.getContext('2d');
  if (!g) return null;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  g.textBaseline = 'middle';
  return g;
}
/** 図を描く。ノードがまだ動いている間は true を返す */
export function drawFig(cv: HTMLCanvasElement, cells: Cell[], o: DrawOpt): boolean {
  now = o.now;
  /* 次の手順の前に動き終える長さ */
  moveMs = Math.max(50, Math.min(650, 760 / o.rate));
  baseSnap = o.snap;
  moving = false;
  tickNo++;
  hits = [];
  if (o.cmp) {
    for (const c of cells) drawCell(c, o);
    return moving;
  }
  const c = cells[0],
    W = (cv.parentElement as HTMLElement).clientWidth || 700,
    H = oneHeight(W, c.trace),
    g = sizeCanvas(cv, W, H);
  if (g) drawOne(g, c, o.frameOf(c), W, H, o);
  sweep(c);
  return moving;
}
