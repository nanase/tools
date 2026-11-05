/**
 * 図: 左に木、右に配列の 1 行リストを置き、同じ要素を両方で同時に動かす。狭い幅では上下に並べる。
 * 木の要素は丸の中に数字で描く。要素は時間をかけて動かし、交換する 2 つは弧を描いてすれ違う。
 * 比較の枠は枠ごとのキャンバスに木だけを描く。配列（参考）は配列だけを描く
 */
import { type Frame, isPointer, levelOf, levelsOf, parentOf, type Trace, VM } from './model';

/** 図の 1 行 */
export interface Cell {
  trace: Trace;
  /** 枠の見出し（比較） */
  name: string;
  /** 比較の枠のキャンバス */
  cv?: HTMLCanvasElement;
  /** 要素の今の位置（アニメーション）。木は t、配列は a を id の前に付ける */
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
  arc: number;
}
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface DrawOpt {
  cmp: boolean;
  step: number;
  snap: boolean;
  /** 描く時刻 [ms] */
  now: number;
  /** 速さ [回/秒] */
  rate: number;
  /** なぞっている添字 */
  hover: number | null;
  /** 図の左上に出す文（単独） */
  say: string;
}

const C = {
  ink: '',
  ink2: '',
  ch1: '',
  ch2: '',
  bad: '',
  grid: '',
  grid2: '',
  scr: '',
  sans: '',
  mono: '',
  done: '',
  node: '',
  line: '',
  onMov: '',
  onCmp: '',
  onDone: '',
  movText: '',
  wait: '',
  accent: '',
};
export function readColors(): void {
  const s = getComputedStyle(document.documentElement),
    v = (k: string) => s.getPropertyValue(k).trim();
  C.ink = v('--ink');
  C.ink2 = v('--ink-2');
  C.ch1 = v('--hp-mov');
  C.ch2 = v('--hp-cmp');
  C.movText = v('--hp-mov-t');
  C.bad = v('--warn');
  C.grid = v('--grid');
  C.grid2 = v('--grid-2');
  C.scr = v('--hp-bar');
  C.wait = v('--hp-wait');
  C.sans = v('--sans');
  C.mono = v('--mono');
  C.done = v('--hp-done');
  C.node = v('--hp-node');
  C.line = v('--hp-line');
  C.onMov = v('--hp-on-mov');
  C.onCmp = v('--hp-on-cmp');
  C.onDone = v('--hp-on-done');
  C.accent = v('--accent');
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
  font = C.sans,
): void {
  g.font = `${weight} ${size}px ${font}`;
  g.textAlign = al;
  g.fillStyle = color;
  g.fillText(t, x, y);
}
/** 両方向に矢じりがある矢印 */
function bothWays(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 2) return;
  const ux = (x1 - x0) / len,
    uy = (y1 - y0) / len,
    s = Math.min(10, len / 2.6);
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 2.6;
  g.beginPath();
  g.moveTo(x0 + ux * s * 0.6, y0 + uy * s * 0.6);
  g.lineTo(x1 - ux * s * 0.6, y1 - uy * s * 0.6);
  g.stroke();
  const head = (x: number, y: number, dx: number, dy: number): void => {
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x - dx * s - dy * s * 0.55, y - dy * s + dx * s * 0.55);
    g.lineTo(x - dx * s + dy * s * 0.55, y - dy * s - dx * s * 0.55);
    g.closePath();
    g.fill();
  };
  head(x0, y0, -ux, -uy);
  head(x1, y1, ux, uy);
}

/* ---------- 大きさ ---------- */
const PAD = 14;
const narrowOf = (W: number): boolean => W < 620;
/** 比較の枠の図の高さ */
const CMP_H = 190;
/** 配列の 1 行の高さ。数字が読める高さを優先し、要素が多いときは数字を諦める */
const rowPx = (W: number, n: number): number => {
  if (narrowOf(W)) return n <= 15 ? 18 : n <= 31 ? 12 : 7;
  return n <= 15 ? 26 : n <= 31 ? 16 : 9;
};
/** 単独の図の高さ */
function oneHeight(W: number, t: Trace): number {
  const rows = rowPx(W, t.n) * Math.max(t.n, t.cap);
  if (t.def.kind === 'array') return rows + 60;
  return narrowOf(W) ? 310 + rows + 24 : Math.max(440, rows + 56);
}
/* ---------- 動き ---------- */
const ease = (u: number): number => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
let now = 0;
let moveMs = 400;
let snapNow = false;
let baseSnap = false;
let moving = false;
/** 目標へ時間をかけて動かす。arc は道すじのふくらみ [px] */
function anim(c: Cell, key: string, tx: number, ty: number, arc = 0): { x: number; y: number } {
  let p = c.pos.get(key);
  if (!p || snapNow) {
    p = { x: tx, y: ty, fx: tx, fy: ty, tx, ty, t0: -1e9, arc: 0 };
    c.pos.set(key, p);
  }
  if (p.tx !== tx || p.ty !== ty) {
    p.fx = p.x;
    p.fy = p.y;
    p.tx = tx;
    p.ty = ty;
    p.t0 = now;
    p.arc = arc;
  }
  const u = Math.min(1, (now - p.t0) / moveMs);
  if (u < 1) {
    const e = ease(u),
      dx = p.tx - p.fx,
      dy = p.ty - p.fy,
      len = Math.hypot(dx, dy) || 1,
      bow = Math.sin(Math.PI * u) * p.arc;
    p.x = p.fx + dx * e + (-dy / len) * bow;
    p.y = p.fy + dy * e + (dx / len) * bow;
    moving = true;
  } else {
    p.x = p.tx;
    p.y = p.ty;
  }
  return p;
}
function dropStale(c: Cell, prefix: string, keep: Set<string>): void {
  for (const k of c.pos.keys()) if (k[0] === prefix && !keep.has(k)) c.pos.delete(k);
}

/* ---------- 木 ---------- */
interface Node {
  x: number;
  y: number;
  id: number;
  idx: number;
  parent: number;
}
interface Tree {
  nodes: Node[];
  sp: number;
  gap: number;
}
function layoutTree(t: Trace, f: Frame, Z: Rect): Tree {
  const nodes: Node[] = [];
  if (isPointer(t.def)) {
    /* 葉の数で幅を割り振り、根の列を左から並べる。段が少ないときに丸が大きくならないよう 3 段を下限にする */
    const par = f.par ?? [],
      n = f.h.length,
      leaves = new Array<number>(n).fill(0),
      kids = Array.from({ length: n }, () => [] as number[]);
    for (let i = n - 1; i >= 0; i--) {
      leaves[i] = leaves[i] || 1;
      if (par[i] >= 0) {
        leaves[par[i]] += leaves[i];
        kids[par[i]].unshift(i);
      }
    }
    const total = par.reduce((s, p, i) => (p < 0 ? s + leaves[i] : s), 0) || 1,
      gap = Z.h / Math.max(f.depth, 3),
      sp = Z.w / total;
    const place = (i: number, x0: number, l: number): void => {
      nodes[i] = { x: x0 + (leaves[i] * sp) / 2, y: Z.y + gap * (l + 0.5), id: f.h[i], idx: i, parent: par[i] };
      let x = x0;
      for (const c of kids[i]) {
        place(c, x, l + 1);
        x += leaves[c] * sp;
      }
    };
    let x = Z.x;
    par.forEach((p, i) => {
      if (p < 0) {
        place(i, x, 0);
        x += leaves[i] * sp;
      }
    });
    return { nodes, sp, gap };
  }
  /* 配列に入れるヒープの場所は添字で決まる。全要素が入った形で固定する */
  const d = t.def.d,
    L = Math.max(1, levelsOf(t.cap, d)),
    gap = Z.h / L,
    sp = Z.w / d ** (L - 1);
  f.h.forEach((id, idx) => {
    const { l, j } = levelOf(idx, d);
    nodes.push({
      x: Z.x + ((j + 0.5) / d ** l) * Z.w,
      y: Z.y + gap * (l + 0.5),
      id,
      idx,
      parent: idx ? parentOf(idx, d) : -1,
    });
  });
  return { nodes, sp, gap };
}
/** 添字のなぞれる範囲（図の座標） */
interface Hit {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  idx: number;
}
let hits: Hit[] = [];
/** (x, y) にある要素の添字 */
export function hitAt(x: number, y: number): number | null {
  const h = hits.find((q) => x >= q.x0 && x <= q.x1 && y >= q.y0 && y <= q.y1);
  return h ? h.idx : null;
}
/** 親子の組: なぞっている添字か、その親か子か */
const familyOf =
  (d: number, hv: number | null) =>
  (idx: number | undefined): '' | 'self' | 'kin' => {
    if (hv == null || idx == null || !d) return '';
    if (idx === hv) return 'self';
    return idx === parentOf(hv, d) || (idx > 0 && parentOf(idx, d) === hv) ? 'kin' : '';
  };
function drawTree(g: CanvasRenderingContext2D, c: Cell, f: Frame, Z: Rect, full: boolean, hover: number | null): void {
  const t = c.trace,
    tr = layoutTree(t, f, Z),
    r = Math.min(19, tr.sp * 0.42, tr.gap * 0.36),
    font = r >= 15 ? 16 : r >= 11 ? 13 : 0,
    kin = familyOf(t.def.d, hover),
    pair = f.w.length === 2 ? f.w : [],
    keep = new Set<string>(),
    P = tr.nodes.map((n) => {
      const i = pair.indexOf(n.id),
        arc = i < 0 ? 0 : (i === 0 ? 1 : -1) * Math.min(26, r * 1.3),
        key = `t${n.id}`;
      keep.add(key);
      const p = anim(c, key, n.x, n.y, arc);
      return { ...n, ax: p.x, ay: p.y };
    });
  dropStale(c, 't', keep);
  /* 枝は格納済みの親子だけを結ぶ。端は丸の縁で止める */
  const arrows: (() => void)[] = [];
  for (const n of P) {
    if (n.parent < 0) continue;
    const A = P[n.parent];
    if (!A) continue;
    const a = n.id,
      b = A.id,
      on = (l: number[]) => l.includes(a) && l.includes(b),
      dx = n.ax - A.ax,
      dy = n.ay - A.ay,
      len = Math.hypot(dx, dy) || 1,
      x0 = A.ax + (dx / len) * (r + 2),
      y0 = A.ay + (dy / len) * (r + 2),
      x1 = n.ax - (dx / len) * (r + 2),
      y1 = n.ay - (dy / len) * (r + 2),
      bad = t.max ? t.vals[a] > t.vals[b] : t.vals[a] < t.vals[b];
    if (on(f.w) || on(f.r)) {
      const color = on(f.w) ? C.ch1 : C.ch2;
      arrows.push(() => bothWays(g, x0, y0, x1, y1, color));
      continue;
    }
    g.strokeStyle = bad ? C.bad : C.grid2;
    g.lineWidth = bad ? 2.2 : 1.3;
    if (bad) g.setLineDash([5, 4]);
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    g.setLineDash([]);
  }
  /* 親子でない 2 つを比べるとき（根どうし）は、上に矢印を渡す */
  if (!arrows.length && (f.r.length === 2 || f.w.length === 2)) {
    const ids = f.r.length === 2 ? f.r : f.w,
      A = c.pos.get(`t${ids[0]}`),
      B = c.pos.get(`t${ids[1]}`);
    if (A && B) {
      const y = Math.max(Z.y + 6, Math.min(A.y, B.y) - r - 12),
        color = f.r.length === 2 ? C.ch2 : C.ch1;
      arrows.push(() => bothWays(g, A.x, y, B.x, y, color));
    }
  }
  /* 動いている要素を最後に描く */
  const rank = (id: number) => (f.w.includes(id) ? 2 : f.r.includes(id) ? 1 : 0);
  for (const n of [...P].sort((p, q) => rank(p.id) - rank(q.id))) {
    const w = f.w.includes(n.id),
      cmp = f.r.includes(n.id),
      hot = w ? C.ch1 : cmp ? C.ch2 : '',
      fam = kin(t.def.d ? n.idx : undefined);
    g.beginPath();
    g.arc(n.ax, n.ay, r, 0, 7);
    g.fillStyle = w ? C.ch1 : C.node;
    g.fill();
    g.lineWidth = hot ? 3 : 1.4;
    g.strokeStyle = hot || C.line;
    g.stroke();
    if (font) text(g, String(t.vals[n.id]), n.ax, n.ay + 0.5, w ? C.onMov : cmp ? C.ch2 : C.ink, font);
    if (fam) {
      g.beginPath();
      g.arc(n.ax, n.ay, r + 4, 0, 7);
      g.lineWidth = 2;
      g.strokeStyle = fam === 'self' ? C.accent : C.ink;
      g.stroke();
    }
    if (full && t.def.d)
      hits.push({ x0: n.ax - r - 2, x1: n.ax + r + 2, y0: n.ay - r - 2, y1: n.ay + r + 2, idx: n.idx });
  }
  for (const fn of arrows) fn();
  /* 最良の根に札を付ける */
  if (full && P.length) {
    const better = (a: number, b: number) => (t.max ? t.vals[a] > t.vals[b] : t.vals[a] < t.vals[b]);
    let top = P.find((p) => p.parent < 0) as (typeof P)[number];
    for (const p of P) if (p.parent < 0 && better(p.id, top.id)) top = p;
    text(g, '根', top.ax + r + 8, top.ay, C.ink2, 13, 700, 'left');
  }
}

/* ---------- 配列 ---------- */
interface Slot {
  id: number;
  kind: 'heap' | 'wait' | 'done';
  idx?: number;
}
/** 配列の並び: 格納済み → 待機中 → ソート済み（最初に取り出したものが末尾）。ポインタでつなぐヒープは格納済みの行を空ける */
function slotsOf(t: Trace, f: Frame): Slot[] {
  const seq: Slot[] = [];
  if (isPointer(t.def)) {
    for (let id = f.next; id < t.n; id++) seq.push({ id, kind: 'wait' });
    const gap = t.n - seq.length - f.out.length;
    for (let i = 0; i < gap; i++) seq.push({ id: -1, kind: 'heap' });
  } else {
    f.h.forEach((id, idx) => {
      seq.push({ id, kind: 'heap', idx });
    });
    for (let id = f.next; id < t.n; id++) seq.push({ id, kind: 'wait' });
  }
  for (let k = f.out.length - 1; k >= 0; k--) seq.push({ id: f.out[k], kind: 'done' });
  return seq;
}
/** 1 行ずつのリスト: 添字・バー・値 */
function drawRows(g: CanvasRenderingContext2D, c: Cell, f: Frame, Z: Rect, hover: number | null, mini = false): void {
  const t = c.trace,
    seq = slotsOf(t, f),
    rh = Z.h / Math.max(seq.length, 1),
    big = !mini && rh >= 15,
    kin = familyOf(t.def.d, hover),
    keep = new Set<string>(),
    list: { s: Slot; p: { x: number; y: number }; st: '' | 'w' | 'r' }[] = [];
  seq.forEach((s, i) => {
    if (s.id < 0) return;
    const st = f.w.includes(s.id) ? 'w' : f.r.includes(s.id) ? 'r' : '',
      arc = st === 'w' && f.w.length === 2 ? (f.w[0] === s.id ? 1 : -1) * Math.min(22, rh * 1.2) : 0,
      key = `a${s.id}`;
    keep.add(key);
    list.push({ s, st, p: anim(c, key, Z.x, Z.y + (i + 0.5) * rh, arc) });
    if (big && s.idx != null) text(g, String(s.idx), Z.x + 16, Z.y + (i + 0.5) * rh, C.ink2, 12, 500, 'right');
  });
  dropStale(c, 'a', keep);
  list.sort((p, q) => (p.st ? 1 : 0) - (q.st ? 1 : 0));
  const x0 = Z.x + (mini ? 0 : 24),
    W = Z.w - (mini ? 0 : 24 + 32);
  for (const { s, p, st } of list) {
    const w = (t.vals[s.id] / VM) * W,
      h = Math.max(1.5, rh - (big ? 5 : 1.5)),
      y = p.y - h / 2,
      x = x0 + (p.x - Z.x),
      color = st === 'w' ? C.ch1 : st === 'r' ? C.ch2 : s.kind === 'done' ? C.done : C.scr,
      fam = kin(s.idx);
    if (s.kind === 'wait' && !st) {
      g.strokeStyle = C.wait;
      g.lineWidth = 1.2;
      g.strokeRect(x, y, w, h);
    } else {
      g.fillStyle = color;
      g.fillRect(x, y, w, h);
    }
    if (big)
      text(
        g,
        String(t.vals[s.id]),
        x + w + 6,
        p.y + 0.5,
        st === 'w' ? C.movText : st ? color : C.ink2,
        13,
        st ? 700 : 500,
        'left',
      );
    if (fam) {
      g.strokeStyle = fam === 'self' ? C.accent : C.ink;
      g.lineWidth = 1.6;
      g.strokeRect(x - 2, y - 1.5, w + 4, h + 3);
    }
    if (s.idx != null && t.def.d) hits.push({ x0: Z.x, x1: Z.x + Z.w, y0: p.y - rh / 2, y1: p.y + rh / 2, idx: s.idx });
  }
}
/** 比較の行の配列: 値のマス */
function drawCells(g: CanvasRenderingContext2D, c: Cell, f: Frame, Z: Rect): void {
  const t = c.trace,
    seq = slotsOf(t, f),
    b = Z.w / Math.max(seq.length, 1),
    keep = new Set<string>(),
    list: { s: Slot; p: { x: number; y: number }; st: '' | 'w' | 'r' }[] = [];
  seq.forEach((s, i) => {
    if (s.id < 0) return;
    const st = f.w.includes(s.id) ? 'w' : f.r.includes(s.id) ? 'r' : '',
      arc = st === 'w' && f.w.length === 2 ? (f.w[0] === s.id ? 1 : -1) * 20 : 0,
      key = `a${s.id}`;
    keep.add(key);
    list.push({ s, st, p: anim(c, key, Z.x + (i + 0.5) * b, Z.y + Z.h / 2, arc) });
  });
  dropStale(c, 'a', keep);
  list.sort((p, q) => (p.st ? 1 : 0) - (q.st ? 1 : 0));
  for (const { s, p, st } of list) {
    const w = Math.max(2, b - 3),
      l = p.x - w / 2,
      y0 = p.y - Z.h / 2;
    if (s.kind === 'wait' && !st) {
      g.strokeStyle = C.line;
      g.lineWidth = 1.2;
      g.strokeRect(l, y0, w, Z.h);
    } else {
      g.fillStyle = st === 'w' ? C.ch1 : st === 'r' ? C.ch2 : s.kind === 'done' ? C.done : C.node;
      g.fillRect(l, y0, w, Z.h);
    }
    if (b >= 20) {
      text(
        g,
        String(t.vals[s.id]),
        p.x,
        p.y + 0.5,
        st === 'w' ? C.onMov : st === 'r' ? C.onCmp : s.kind === 'done' ? C.onDone : s.kind === 'wait' ? C.ink2 : C.ink,
        b >= 30 ? 14 : 12,
      );
    }
  }
}

/* ---------- 全体 ---------- */
function drawOne(g: CanvasRenderingContext2D, c: Cell, W: number, H: number, o: DrawOpt): void {
  const t = c.trace,
    f = t.frames[Math.min(o.step, t.frames.length - 1)],
    label = isPointer(t.def) ? '待機中とソート済み' : t.def.kind === 'array' ? '配列（参考）' : '配列',
    head = (s: string, x: number, y: number) => text(g, s, x, y, C.ink2, 13, 700, 'left');
  if (o.say) text(g, o.say, PAD, 22, C.ink, 17, 700, 'left');
  if (t.def.kind === 'array') {
    head(label, PAD, 48);
    drawRows(g, c, f, { x: PAD, y: 58, w: W - PAD * 2, h: H - 66 }, null);
    return;
  }
  if (narrowOf(W)) {
    drawTree(g, c, f, { x: PAD, y: 40, w: W - PAD * 2, h: 250 }, true, o.hover);
    head(label, PAD, 302);
    drawRows(g, c, f, { x: PAD, y: 312, w: W - PAD * 2, h: H - 322 }, o.hover);
    return;
  }
  const split = Math.round(W * 0.64);
  drawTree(g, c, f, { x: PAD, y: 40, w: split - PAD - 12, h: H - 52 }, true, o.hover);
  g.strokeStyle = C.grid;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(split, 14);
  g.lineTo(split, H - 14);
  g.stroke();
  head(label, split + 14, 26);
  drawRows(g, c, f, { x: split + 14, y: 44, w: W - split - 14 - PAD, h: H - 56 }, o.hover);
}
/** 比較の枠を 1 つ描く */
function drawCell(c: Cell, o: DrawOpt): void {
  const cv = c.cv;
  if (!cv) return;
  const W = (cv.parentElement as HTMLElement).clientWidth || 300,
    g = sizeCanvas(cv, W, CMP_H),
    t = c.trace,
    f = t.frames[Math.min(o.step, t.frames.length - 1)];
  if (!g) return;
  if (f.say) text(g, f.say, 10, 14, C.ink2, 12.5, 700, 'left');
  const Z = { x: 8, y: 26, w: W - 16, h: CMP_H - 32 };
  if (t.def.kind === 'array') drawCells(g, c, f, { x: Z.x, y: Z.y + Z.h / 2 - 20, w: Z.w, h: 40 });
  else {
    /* 右下に小さく配列のリストを置く。ソートでは取り出した順に下から緑のバーが積まれる */
    const mw = Math.max(84, Math.min(170, Z.w * 0.28)),
      mh = Math.round(Z.h * 0.72);
    drawTree(g, c, f, { ...Z, w: Z.w - mw - 10 }, false, null);
    drawRows(g, c, f, { x: Z.x + Z.w - mw, y: Z.y + Z.h - mh, w: mw, h: mh }, null, true);
  }
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
/** 図を描く。要素がまだ動いている間は true を返す */
export function drawFig(cv: HTMLCanvasElement, cells: Cell[], o: DrawOpt): boolean {
  now = o.now;
  /* 次の手順の前に動き終える長さ */
  moveMs = Math.max(50, Math.min(700, 780 / o.rate));
  baseSnap = o.snap;
  moving = false;
  hits = [];
  if (o.cmp) {
    for (const c of cells) drawCell(c, o);
    return moving;
  }
  const W = (cv.parentElement as HTMLElement).clientWidth || 700,
    H = oneHeight(W, cells[0].trace),
    g = sizeCanvas(cv, W, H);
  if (g) drawOne(g, cells[0], W, H, o);
  return moving;
}
