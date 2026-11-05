/**
 * 図: 上に字句の帯、左に木、右にスタックを置く。狭い幅ではスタックを木の下へ送る。
 * 丸の木と動きは二分ヒープのページに合わせる。字句解析の工程だけ文字と字句の 2 段を描く。
 * 比較の枠は枠ごとのキャンバスに小さく描く
 */
import { type Frame, fmt, type LexFrame, type Node, type StackItem, SYM, type Trace } from './model';

export type Stage = 'lex' | 'parse' | 'calc';
/** 図の 1 枠 */
export interface Cell {
  trace: Trace;
  name: string;
  /** 比較の枠のキャンバス */
  cv?: HTMLCanvasElement;
  /** 丸の今の位置（アニメーション）。字句の番号で持つので、木が組み変わっても同じ丸が動く */
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
  stage: Stage;
  step: number;
  /** 描く時刻 [ms] */
  now: number;
  /** 速さ [回/秒] */
  rate: number;
  snap: boolean;
}

const C = {
  ink: '',
  ink2: '',
  ink3: '',
  bad: '',
  grid: '',
  grid2: '',
  sans: '',
  mono: '',
  surface: '',
  cmp: '',
  mov: '',
  done: '',
  node: '',
  sym: '',
  line: '',
  onMov: '',
  onCmp: '',
  onDone: '',
};
export function readColors(): void {
  const s = getComputedStyle(document.documentElement),
    v = (k: string) => s.getPropertyValue(k).trim();
  C.ink = v('--ink');
  C.ink2 = v('--ink-2');
  C.ink3 = v('--ink-3');
  C.bad = v('--warn');
  C.grid = v('--grid');
  C.grid2 = v('--grid-2');
  C.sans = v('--sans');
  C.mono = v('--mono');
  C.surface = v('--surface');
  C.cmp = v('--ep-cmp');
  C.mov = v('--ep-mov');
  C.done = v('--ep-done');
  C.node = v('--ep-node');
  C.sym = v('--ep-sym');
  C.line = v('--ep-line');
  C.onMov = v('--ep-on-mov');
  C.onCmp = v('--ep-on-cmp');
  C.onDone = v('--ep-on-done');
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
/** 字句や丸の中の文字。演算子は等幅のままだと小さいので、大きめの sans で描く */
function glyph(g: CanvasRenderingContext2D, t: string, x: number, y: number, color: string, size: number): void {
  if (/^[+−×÷^]$/.test(t)) text(g, t, x, y, color, size + 4, 700, 'center', C.sans);
  else text(g, t, x, y, color, size, 700, 'center', C.mono);
}
function box(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r = 3): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/* ---------- 動き ---------- */
const ease = (u: number): number => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
let now = 0;
let moveMs = 400;
let snapNow = false;
let baseSnap = false;
let moving = false;
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

/* ---------- 字句の帯 ---------- */
interface Cols {
  cw: number;
  x: (i: number) => number;
}
function colsOf(tr: Trace, x0: number, w: number): Cols {
  const cw = w / Math.max(tr.toks.length, 1);
  return { cw, x: (i) => x0 + (i + 0.5) * cw };
}
function drawBand(
  g: CanvasRenderingContext2D,
  tr: Trace,
  f: Frame,
  y: number,
  h: number,
  cols: Cols,
  stage: Stage,
  mini = false,
): void {
  const cell = Math.min(cols.cw - (mini ? 1.5 : 3), mini ? 34 : 44),
    fs = mini ? 13 : 15;
  tr.toks.forEach((t, i) => {
    const x = cols.x(i),
      w = f.w.includes(i),
      r = f.r.includes(i),
      read = i < f.pos || stage === 'calc';
    box(g, x - cell / 2, y, cell, h);
    let fg = C.ink;
    if (f.bad === i) {
      g.fillStyle = C.bad;
      g.fill();
      fg = C.surface;
    } else if (w) {
      g.fillStyle = stage === 'calc' ? C.done : C.mov;
      g.fill();
      fg = stage === 'calc' ? C.onDone : C.onMov;
    } else if (r) {
      g.fillStyle = C.cmp;
      g.fill();
      fg = C.onCmp;
    } else if (read) {
      g.fillStyle = C.node;
      g.fill();
    } else {
      g.strokeStyle = C.line;
      g.lineWidth = 1.2;
      g.stroke();
      fg = C.ink2;
    }
    glyph(g, t.txt, x, y + h / 2 + 0.5, t.imp && !w && !r ? C.ink3 : fg, t.txt.length > 2 ? fs - 2 : fs);
  });
  if (stage === 'parse' && tr.toks.length) {
    const edge = f.pos < tr.toks.length ? cols.x(f.pos) : cols.x(tr.toks.length - 1) + cols.cw / 2 - 2;
    g.fillStyle = f.backed ? C.bad : C.ink;
    g.beginPath();
    g.moveTo(edge - 5, y - 9);
    g.lineTo(edge + 5, y - 9);
    g.lineTo(edge, y - 2);
    g.closePath();
    g.fill();
  }
}

/* ---------- 木 ---------- */
interface Place {
  id: number;
  x: number;
  y: number;
  parent: number;
  tok: number;
  q: Node;
}
/** 葉を等間隔に並べ、親は子の真ん中に置く。葉の位置は全部読んだ後と同じにして、途中で動かさない */
function placeForest(tr: Trace, f: Frame, Z: Rect): { list: Place[]; sp: number; gap: number } {
  const N = tr.nodes,
    n = Math.max(tr.leafIdx.size, 1),
    sp = Z.w / n,
    gap = Z.h / Math.max(tr.depth, 3),
    out: Place[] = [];
  const go = (id: number, d: number, parent: number): Place => {
    const q = N[id],
      kids = q.kids.map((k) => go(k, d + 1, id)),
      x =
        q.kind === 'num'
          ? Z.x + ((tr.leafIdx.get(q.tok) as number) + 0.5) * sp
          : kids.reduce((s, k) => s + k.x, 0) / kids.length,
      rec = { id, x, y: Z.y + gap * (d + 0.5), parent, tok: q.tok, q };
    out.push(rec);
    return rec;
  };
  for (const r of f.roots) go(r, 0, -1);
  return { list: out, sp, gap };
}
function drawForest(g: CanvasRenderingContext2D, c: Cell, f: Frame, stage: Stage, Z: Rect, mini = false): void {
  const tr = c.trace,
    N = tr.nodes,
    calc = stage === 'calc',
    L = placeForest(tr, f, Z),
    r = Math.max(9, Math.min(mini ? 15 : 19, L.sp * 0.44, L.gap * 0.42)),
    keep = new Set<string>(),
    P = new Map<number, Place & { ax: number; ay: number }>();
  for (const n of L.list) {
    const key = `n${n.tok}`;
    keep.add(key);
    const p = anim(c, key, n.x, n.y, f.mk === n.id ? 12 : 0);
    P.set(n.id, { ...n, ax: p.x, ay: p.y });
  }
  for (const k of c.pos.keys()) if (k[0] === 'n' && !keep.has(k)) c.pos.delete(k);
  const vals = f.vals,
    upper = (id: number) => !!vals?.has(id) && N[id].kind !== 'num',
    used = new Set<number>();
  if (vals) for (const id of tr.order) if (vals.has(id)) for (const k of N[id].kids) used.add(k);
  /* 枝 */
  for (const n of P.values()) {
    if (n.parent < 0) continue;
    const A = P.get(n.parent);
    if (!A) continue;
    const dx = n.ax - A.ax,
      dy = n.ay - A.ay,
      len = Math.hypot(dx, dy) || 1,
      hot = f.w.includes(A.tok) && (f.mk === A.id || f.hot === A.id);
    g.strokeStyle = hot ? (calc ? C.done : C.mov) : used.has(n.id) ? C.grid : C.grid2;
    g.lineWidth = hot ? 2.6 : 1.3;
    g.beginPath();
    g.moveTo(A.ax + (dx / len) * (r + 1), A.ay + (dy / len) * (r + 1));
    g.lineTo(n.ax - (dx / len) * (r + 1), n.ay - (dy / len) * (r + 1));
    g.stroke();
  }
  /* 丸。動いているものを最後に描く */
  const fs = mini ? 13 : r >= 15 ? 15 : 13,
    rank = (n: Place) => (f.w.includes(n.tok) ? 2 : f.r.includes(n.tok) ? 1 : 0);
  for (const n of [...P.values()].sort((a, b) => rank(a) - rank(b))) {
    const w = f.w.includes(n.tok),
      cmp = f.r.includes(n.tok),
      dim = used.has(n.id),
      val = vals?.get(n.id),
      up = upper(n.id);
    g.beginPath();
    g.arc(n.ax, n.ay, r, 0, 7);
    g.fillStyle = w ? (calc ? C.done : C.mov) : cmp ? C.cmp : dim ? C.surface : up ? C.done : C.node;
    g.fill();
    g.lineWidth = w || cmp ? 3 : 1.4;
    g.strokeStyle = w ? (calc ? C.done : C.mov) : cmp ? C.cmp : dim ? C.grid2 : C.line;
    g.stroke();
    const t = up ? fmt(val) : n.q.txt,
      sz = t.length > 4 ? fs - 4 : t.length > 2 ? fs - 2 : fs;
    glyph(
      g,
      t,
      n.ax,
      n.ay + 0.5,
      w ? (calc ? C.onDone : C.onMov) : cmp ? C.onCmp : dim ? C.ink3 : up ? C.onDone : C.ink,
      sz,
    );
  }
}

/* ---------- スタック ---------- */
function itemStyle(it: StackItem, f: Frame): { fill: string; fg: string; stroke: string } {
  if (it.tok != null && f.w.includes(it.tok)) return { fill: C.mov, fg: C.onMov, stroke: '' };
  if (it.tok != null && f.r.includes(it.tok)) return { fill: C.cmp, fg: C.onCmp, stroke: '' };
  if (it.k === 'call') return { fill: '', fg: C.ink, stroke: C.line };
  return { fill: C.node, fg: C.ink, stroke: '' };
}
function drawStack(g: CanvasRenderingContext2D, tr: Trace, f: Frame, Z: Rect, mini = false): void {
  text(g, mini ? 'スタック' : tr.method.stack, Z.x, Z.y + 7, C.ink2, mini ? 12 : 13, 700, 'left');
  const top = Z.y + (mini ? 18 : 24),
    bottom = Z.y + Z.h,
    rh = Math.min(mini ? 20 : 30, (bottom - top) / Math.max(tr.maxS, 1));
  g.strokeStyle = C.line;
  g.lineWidth = 1.4;
  g.beginPath();
  g.moveTo(Z.x, top);
  g.lineTo(Z.x, bottom);
  g.lineTo(Z.x + Z.w, bottom);
  g.lineTo(Z.x + Z.w, top);
  g.stroke();
  f.stk.forEach((it, i) => {
    const y = bottom - (i + 1) * rh,
      st = itemStyle(it, f);
    box(g, Z.x + 4, y + 1, Z.w - 8, Math.max(1, rh - 3));
    if (st.fill) {
      g.fillStyle = st.fill;
      g.fill();
    } else {
      g.strokeStyle = st.stroke;
      g.lineWidth = 1.2;
      g.stroke();
    }
    if (rh < 13) return;
    if (it.k === 'call') text(g, it.t, Z.x + Z.w / 2, y + rh / 2, st.fg, mini ? 11.5 : 13);
    else glyph(g, it.t, Z.x + Z.w / 2, y + rh / 2, st.fg, mini ? 13 : 15);
  });
}

/* ---------- 字句解析の図 ---------- */
function drawLex(g: CanvasRenderingContext2D, tr: Trace, f: LexFrame, W: number, mini: boolean): void {
  const s = tr.s,
    pad = mini ? 8 : 14,
    cw = Math.min((W - pad * 2) / Math.max(s.length, 1), mini ? 22 : 34),
    y0 = mini ? 30 : 74,
    h = mini ? 26 : 38,
    size = mini ? 13 : 15;
  if (!mini) text(g, '文字', pad, y0 - 12, C.ink2, 13, 700, 'left');
  [...s].forEach((ch, i) => {
    const x = pad + i * cw,
      on = i >= f.ci && i <= f.cj;
    box(g, x + 1, y0, cw - 2, h);
    if (on) {
      g.fillStyle = f.bad ? C.bad : C.cmp;
      g.fill();
    } else {
      g.strokeStyle = i < f.ci ? C.grid2 : C.line;
      g.lineWidth = 1.2;
      g.stroke();
    }
    const label = ch === ' ' ? '␣' : ((SYM as Record<string, string>)[ch] ?? ch);
    glyph(g, label, x + cw / 2, y0 + h / 2 + 0.5, on ? C.onCmp : i < f.ci ? C.ink3 : C.ink, size);
  });
  const y1 = y0 + h + (mini ? 22 : 48);
  if (!mini) {
    text(g, '字句', pad, y1 - 12, C.ink2, 13, 700, 'left');
    let lx = pad + 44;
    for (const [label, color] of [
      ['数', C.node],
      ['記号', C.sym],
    ]) {
      box(g, lx, y1 - 18, 12, 12, 2);
      g.fillStyle = color;
      g.fill();
      text(g, label, lx + 17, y1 - 12, C.ink2, 13, 700, 'left');
      lx += 17 + (label.length > 1 ? 40 : 26);
    }
  }
  let cx = pad;
  for (let i = 0; i < f.n; i++) {
    const t = tr.toks[i];
    g.font = `700 ${size}px ${C.mono}`;
    const w = Math.max(mini ? 20 : 32, g.measureText(t.txt).width + 14);
    if (cx + w > W - pad) break;
    box(g, cx, y1, w, h);
    /* 種類の色はできた瞬間から見せ、今できた字句は枠で示す。補った × は破線の枠だけにする */
    if (t.imp) {
      g.setLineDash([3, 3]);
      g.strokeStyle = C.sym;
      g.lineWidth = 1.6;
      g.stroke();
      g.setLineDash([]);
    } else {
      g.fillStyle = t.t === 'num' ? C.node : C.sym;
      g.fill();
    }
    if (i === f.hot) {
      g.strokeStyle = C.mov;
      g.lineWidth = 2.6;
      g.stroke();
    }
    glyph(g, t.txt, cx + w / 2, y1 + h / 2 + 0.5, t.imp ? C.ink2 : C.ink, size);
    cx += w + 4;
  }
}

/* ---------- 全体 ---------- */
const PAD = 14;
const narrowOf = (W: number): boolean => W < 620;
const CMP_H = 230;
const oneHeight = (W: number): number => (narrowOf(W) ? 560 : 470);
const isBad = (f: Frame | LexFrame): boolean => ('w' in f ? f.bad != null : f.bad);
function sayAt(
  g: CanvasRenderingContext2D,
  say: string,
  bad: boolean,
  x: number,
  y: number,
  size: number,
  base: string,
) {
  if (say) text(g, say, x, y, bad ? C.bad : base, size, 700, 'left');
}
function drawOne(g: CanvasRenderingContext2D, c: Cell, o: DrawOpt, W: number, H: number): void {
  const tr = c.trace;
  if (o.stage === 'lex') {
    const f = tr.lex[Math.min(o.step, tr.lex.length - 1)];
    sayAt(g, f.say, isBad(f), PAD, 18, 17, C.ink);
    drawLex(g, tr, f, W, false);
    return;
  }
  const f = frameOf(tr, o.stage, o.step);
  sayAt(g, f.say, isBad(f) || !!f.backed, PAD, 18, 17, C.ink);
  if (!tr.toks.length) return;
  const n = narrowOf(W),
    split = n ? W - PAD : Math.round(W * 0.72);
  if (o.stage === 'calc') text(g, `= ${fmt(tr.ans)}`, W - PAD, 18, C.ink, 22, 700, 'right');
  drawBand(g, tr, f, 48, 34, colsOf(tr, PAD, W - PAD * 2), o.stage);
  const Z = n ? { x: PAD, y: 94, w: W - PAD * 2, h: H - 94 - 150 } : { x: PAD, y: 96, w: split - PAD - 12, h: H - 108 };
  if (tr.nodes.length) drawForest(g, c, f, o.stage, Z);
  if (n) drawStack(g, tr, f, { x: PAD, y: H - 144, w: W - PAD * 2, h: 134 });
  else {
    g.strokeStyle = C.grid;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(split, 96);
    g.lineTo(split, H - 12);
    g.stroke();
    drawStack(g, tr, f, { x: split + 14, y: 96, w: W - split - 14 - PAD, h: H - 108 });
  }
}
function drawMini(g: CanvasRenderingContext2D, c: Cell, o: DrawOpt, W: number, H: number): void {
  const tr = c.trace;
  if (o.stage === 'lex') {
    const f = tr.lex[Math.min(o.step, tr.lex.length - 1)];
    sayAt(g, f.say, isBad(f), 8, 12, 12.5, C.ink2);
    drawLex(g, tr, f, W, true);
    return;
  }
  const f = frameOf(tr, o.stage, o.step);
  sayAt(g, f.say, isBad(f) || !!f.backed, 8, 12, 12.5, C.ink2);
  if (!tr.toks.length) return;
  const by = 30,
    top = by + 24 + 8,
    mw = Math.max(70, Math.min(120, W * 0.24));
  drawBand(g, tr, f, by, 24, colsOf(tr, 8, W - 16), o.stage, true);
  if (tr.nodes.length) drawForest(g, c, f, o.stage, { x: 8, y: top, w: W - 16 - mw - 8, h: H - top - 4 }, true);
  drawStack(g, tr, f, { x: W - 8 - mw, y: top, w: mw, h: H - top - 6 }, true);
}
/** 工程のコマ。エラーで計算できないときは、構文解析の最後のコマを見せる */
export function framesOf(tr: Trace, stage: Exclude<Stage, 'lex'>): Frame[] {
  return stage === 'calc' && tr.calc.length ? tr.calc : stage === 'calc' ? tr.parse.slice(-1) : tr.parse;
}
export const frameOf = (tr: Trace, stage: Exclude<Stage, 'lex'>, step: number): Frame => {
  const L = framesOf(tr, stage);
  return L[Math.min(step, L.length - 1)];
};
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
/** 図を描く。丸がまだ動いている間は true を返す */
export function drawFig(cv: HTMLCanvasElement, cells: Cell[], o: DrawOpt): boolean {
  now = o.now;
  /* 次の手順の前に動き終える長さ */
  moveMs = Math.max(50, Math.min(650, 760 / o.rate));
  baseSnap = o.snap;
  moving = false;
  if (o.cmp) {
    for (const c of cells) {
      if (!c.cv) continue;
      const W = (c.cv.parentElement as HTMLElement).clientWidth || 300,
        g = sizeCanvas(c.cv, W, CMP_H);
      if (g) drawMini(g, c, o, W, CMP_H);
    }
    return moving;
  }
  const W = (cv.parentElement as HTMLElement).clientWidth || 700,
    H = oneHeight(W),
    g = sizeCanvas(cv, W, H);
  if (g && cells[0]) drawOne(g, cells[0], o, W, H);
  return moving;
}
