/**
 * 図: 上に箱の木、下にディスクのページの列を置く。ノードの枠の数だけ箱を仕切り、空きも見せる。
 * キーは時間をかけて動かす。読み書きしたノードはページの列でも光る。
 * 比較の枠は枠ごとのキャンバスに、小さな木とページの列を描く
 */
import type { Frame, Node, Trace } from './model';

/** 図の 1 行 */
export interface Cell {
  trace: Trace;
  /** 枠の見出し（比較） */
  name: string;
  /** 比較の枠のキャンバス */
  cv?: HTMLCanvasElement;
  /** キーと箱の今の位置（アニメーション） */
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
}

const C = {
  ink: '',
  ink2: '',
  grid: '',
  grid2: '',
  bad: '',
  accent: '',
  sans: '',
  cmp: '',
  mov: '',
  done: '',
  bar: '',
  wait: '',
  node: '',
  line: '',
  screen: '',
  onMov: '',
  onCmp: '',
  onDone: '',
};
export function readColors(): void {
  const s = getComputedStyle(document.documentElement),
    v = (k: string) => s.getPropertyValue(k).trim();
  C.ink = v('--ink');
  C.ink2 = v('--ink-2');
  C.grid = v('--grid');
  C.grid2 = v('--grid-2');
  C.bad = v('--warn');
  C.accent = v('--accent');
  C.sans = v('--sans');
  C.cmp = v('--bt-cmp');
  C.mov = v('--bt-mov');
  C.done = v('--bt-done');
  C.bar = v('--bt-bar');
  C.wait = v('--bt-wait');
  C.node = v('--bt-node');
  C.line = v('--bt-line');
  C.screen = v('--screen');
  C.onMov = v('--bt-on-mov');
  C.onCmp = v('--bt-on-cmp');
  C.onDone = v('--bt-on-done');
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
/** 描く段数の上限（二分探索木は伸びるので、この先は段の間を詰める） */
const MAX_ROWS = 8;
function oneHeight(W: number, t: Trace): number {
  const D = Math.max(3, Math.min(MAX_ROWS, t.maxDepth));
  return Math.max(narrowOf(W) ? 400 : 480, 58 + D * 78 + 150);
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

/* ---------- 木の配置 ---------- */
interface Place {
  x: number;
  y: number;
  /** 枠の数 */
  slots: number;
  l: number;
}
interface Layout {
  pos: Map<number, Place>;
  cw: number;
  ch: number;
}
const isBst = (t: Trace): boolean => t.def.kind === 'bst';
const slotsOf = (t: Trace, f: Frame, id: number): number => (id === f.root ? t.rootK : t.maxK);
const nodeOf = (f: Frame, id: number): Node => f.N[id] as Node;
/** 箱の木を置く。幅は葉の数で割り振り、段の高さは記録の中の最大の段数で決める */
function layout(t: Trace, f: Frame, Z: Rect, mini: boolean): Layout {
  const pos = new Map<number, Place>(),
    D = Math.max(3, t.maxDepth),
    gy = Math.min(mini ? 56 : 78, Z.h / D),
    cwMax = mini ? 18 : 30;
  if (isBst(t)) {
    let rank = 0;
    const seq = new Map<number, { r: number; l: number }>();
    const walk = (id: number, l: number): void => {
      if (id < 0) return;
      const v = nodeOf(f, id);
      walk(v.c[0], l + 1);
      seq.set(id, { r: rank++, l });
      walk(v.c[1], l + 1);
    };
    if (f.root >= 0) walk(f.root, 0);
    const sp = Z.w / Math.max(seq.size, 8),
      cw = Math.min(cwMax, Math.max(5, sp * 0.92)),
      ch = Math.min(mini ? 20 : 30, Math.max(3, gy * 0.62));
    for (const [id, q] of seq) pos.set(id, { x: Z.x + (q.r + 0.5) * sp, y: Z.y + q.l * gy + 4, slots: 1, l: q.l });
    return { pos, cw, ch };
  }
  const leaves: number[] = [],
    walk = (id: number): void => {
      const v = nodeOf(f, id);
      if (!v.c.length) leaves.push(id);
      else v.c.forEach(walk);
    };
  if (f.root >= 0) walk(f.root);
  const L = Math.max(leaves.length, 1),
    gapX = mini ? 4 : narrowOf(Z.w) ? 4 : 8,
    cw = Math.max(2, Math.min(cwMax, (Z.w - gapX * (L - 1)) / (L * t.maxK))),
    lw = t.maxK * cw,
    total = L * lw + (L - 1) * gapX,
    x0 = Z.x + Math.max(0, (Z.w - total) / 2),
    ch = Math.min(mini ? 20 : 30, Math.max(8, gy * 0.56)),
    bufUp = t.def.kind === 'be' ? ch * 0.55 : 0;
  let i = 0;
  const place = (id: number, l: number): number => {
    const v = nodeOf(f, id);
    let x: number;
    if (!v.c.length) {
      x = x0 + i * (lw + gapX) + lw / 2;
      i++;
    } else {
      const xs = v.c.map((c) => place(c, l + 1));
      x = (xs[0] + xs[xs.length - 1]) / 2;
    }
    pos.set(id, { x, y: Z.y + l * gy + 4 + bufUp, slots: slotsOf(t, f, id), l });
    return x;
  };
  if (f.root >= 0) place(f.root, 0);
  return { pos, cw, ch };
}
/** 数字が詰まって読めない幅では出さない */
const fontFor = (cw: number): number => (cw >= 21 ? 15 : cw >= 17 ? 13 : 0);

/* ---------- なぞる ---------- */
interface Hit {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  id: number;
}
let hits: Hit[] = [];
/** (x, y) にあるノード */
export function hitAt(x: number, y: number): number | null {
  return hits.find((q) => x >= q.x0 && x <= q.x1 && y >= q.y0 && y <= q.y1)?.id ?? null;
}
/** なぞっているノードとの関係: 本人・親か子 */
function kin(f: Frame, hover: number | null, id: number): '' | 'self' | 'kin' {
  if (hover == null || !f.N[hover]) return '';
  if (id === hover) return 'self';
  return nodeOf(f, hover).c.includes(id) || nodeOf(f, id).c.includes(hover) ? 'kin' : '';
}

/* ---------- 木 ---------- */
function drawTree(g: CanvasRenderingContext2D, c: Cell, f: Frame, Z: Rect, mini: boolean, hover: number | null): void {
  const t = c.trace,
    L = layout(t, f, Z, mini),
    size = fontFor(L.cw),
    bst = isBst(t),
    boxes = new Map<number, { x: number; y: number; w: number }>();
  for (const [id, p] of L.pos) {
    const w = p.slots * L.cw,
      q = anim(c, `n${id}`, p.x - w / 2, p.y);
    boxes.set(id, { x: q.x, y: q.y, w });
  }
  /* 枝。根元はキーの間 */
  for (const [id] of L.pos) {
    const v = nodeOf(f, id),
      a = boxes.get(id) as { x: number; y: number; w: number };
    v.c.forEach((k, i) => {
      if (k < 0) return;
      const b = boxes.get(k);
      if (!b) return;
      const hot = f.edge?.[0] === id && f.edge[1] === i,
        sx = bst ? a.x + (i ? a.w : 0) : a.x + i * L.cw;
      g.strokeStyle = hot ? C.cmp : C.grid2;
      g.lineWidth = hot ? 3 : 1.3;
      g.beginPath();
      g.moveTo(sx, a.y + L.ch);
      g.lineTo(b.x + b.w / 2, b.y);
      g.stroke();
    });
  }
  /* B+木の葉をつなぐ線 */
  if (t.def.kind === 'bp')
    for (const [id] of L.pos) {
      const v = nodeOf(f, id),
        b = v.next >= 0 ? boxes.get(v.next) : undefined;
      if (!v.leaf || !b) continue;
      const a = boxes.get(id) as { x: number; y: number; w: number },
        y = a.y + L.ch + 5;
      g.strokeStyle = C.line;
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(a.x + a.w - 3, a.y + L.ch);
      g.lineTo(a.x + a.w - 3, y);
      g.lineTo(b.x + 3, y);
      g.lineTo(b.x + 3, b.y + L.ch);
      g.stroke();
    }
  /* 箱 */
  interface Sprite {
    v: number;
    id: number;
    i: number;
    x: number;
    y: number;
    leaf: boolean;
  }
  const keys: Sprite[] = [];
  for (const [id] of L.pos) {
    const v = nodeOf(f, id),
      q = boxes.get(id) as { x: number; y: number; w: number },
      used = Math.max(q.w / L.cw, v.k.length),
      W = used * L.cw,
      isR = f.r.includes(id),
      isW = f.w.includes(id),
      isB = f.bad === id,
      fam = kin(f, hover, id);
    g.fillStyle = C.screen;
    g.fillRect(q.x, q.y, W, L.ch);
    g.strokeStyle = C.grid2;
    g.lineWidth = 1;
    if (L.cw >= 8)
      for (let i = 1; i < used; i++) {
        g.beginPath();
        g.moveTo(q.x + i * L.cw, q.y + 3);
        g.lineTo(q.x + i * L.cw, q.y + L.ch - 3);
        g.stroke();
      }
    if (isB) g.setLineDash([5, 4]);
    g.strokeStyle = isB ? C.bad : isW ? C.mov : isR ? C.cmp : C.line;
    g.lineWidth = isB || isW || isR ? 3 : 1.3;
    g.strokeRect(q.x, q.y, W, L.ch);
    g.setLineDash([]);
    if (fam) {
      g.strokeStyle = fam === 'self' ? C.accent : C.ink;
      g.lineWidth = 2;
      g.strokeRect(q.x - 3, q.y - 3, W + 6, L.ch + 6);
    }
    v.k.forEach((k, i) => {
      keys.push({ v: k, id, i, x: q.x + i * L.cw, y: q.y, leaf: v.leaf });
    });
    /* Bε木のバッファは箱の上に並べる */
    if (v.buf.length) {
      const bw = Math.min(L.cw * 0.8, W / Math.max(v.buf.length, t.bufCap + 1)),
        bh = L.ch * 0.5;
      v.buf.forEach((b, i) => {
        const hot = f.hot.includes(b.k),
          P = anim(c, `b${b.k}`, q.x + i * bw, q.y - bh - 2, [`q${b.k}`, `k${b.k}`]);
        g.fillStyle = hot ? C.mov : C.screen;
        g.strokeStyle = b.del ? C.bad : C.mov;
        g.lineWidth = 1.2;
        g.fillRect(P.x, P.y, bw - 1, bh);
        g.strokeRect(P.x, P.y, bw - 1, bh);
        if (bw >= 15) text(g, String(b.k), P.x + bw / 2, P.y + bh / 2 + 0.5, hot ? C.onMov : C.ink, 11);
      });
    }
    if (!mini) {
      if (id === f.root) text(g, '根', q.x + W + 8, q.y + L.ch / 2 + 0.5, C.ink2, 13, 700, 'left');
      else if (v.leaf && !bst && !nodeOf(f, f.root).leaf) {
        const first = [...L.pos.keys()].find((x) => nodeOf(f, x).leaf);
        if (first === id && q.x > Z.x + 22) text(g, '葉', q.x - 8, q.y + L.ch / 2 + 0.5, C.ink2, 13, 700, 'right');
      }
    }
    hits.push({ x0: q.x, x1: q.x + W, y0: q.y, y1: q.y + L.ch, id });
  }
  /* キー。動かしたキーを最後に描く */
  keys.sort((a, b) => Number(f.hot.includes(a.v)) - Number(f.hot.includes(b.v)));
  for (const s of keys) {
    const leafKey = s.leaf || !t.leafCopy,
      P = anim(c, `${leafKey ? 'k' : 's'}${s.v}`, s.x, s.y, leafKey ? [`b${s.v}`, `q${s.v}`] : [`k${s.v}`]),
      hot = f.hot.includes(s.v),
      cmp = f.cell?.[0] === s.id && f.cell[1] === s.i,
      out = f.out.includes(s.v) || f.got.includes(s.v);
    /* 数字を出さない幅では、箱の埋まり具合が見える色と太さにする */
    g.fillStyle = hot ? C.mov : cmp ? C.cmp : out ? C.done : size ? C.node : C.bar;
    if (size) g.fillRect(P.x + 1.5, P.y + 1.5, L.cw - 3, L.ch - 3);
    else g.fillRect(P.x + 0.5, P.y + 2, Math.max(1, L.cw - 1), L.ch - 4);
    if (size)
      text(
        g,
        String(s.v),
        P.x + L.cw / 2,
        P.y + L.ch / 2 + 0.5,
        hot ? C.onMov : cmp ? C.onCmp : out ? C.onDone : C.ink,
        size,
      );
  }
  /* 札は今のノードの上に置く。追加は塗りの札で、検索・削除・範囲は枠だけの札に「?」を添える */
  if (f.cur) {
    const cur = f.cur,
      label = cur.hi == null ? String(cur.k) : `${cur.k}〜${cur.hi}`,
      fs = mini ? 12 : 15;
    g.font = `700 ${fs}px ${C.sans}`;
    const at = cur.at >= 0 ? boxes.get(cur.at) : undefined,
      bw = Math.max(L.cw, mini ? 18 : 26, g.measureText(label).width + (mini ? 6 : 10)),
      mark = cur.q ? (mini ? 11 : 16) : 0,
      bh = Math.min(L.ch, 26),
      mid = at ? at.x + at.w / 2 : Z.x + Z.w / 2,
      tx = Math.max(Z.x, Math.min(Z.x + Z.w - bw - mark, mid - (bw + mark) / 2)),
      ty = at ? Math.max(Z.y - 24, at.y - bh - (t.def.kind === 'be' ? L.ch * 0.6 : 4)) : Z.y - 24,
      P = anim(c, `q${cur.q ? '' : cur.k}`, tx, ty);
    if (cur.q) {
      g.fillStyle = C.screen;
      g.strokeStyle = C.cmp;
      g.lineWidth = 2;
      g.fillRect(P.x, P.y, bw, bh);
      g.strokeRect(P.x, P.y, bw, bh);
      text(g, label, P.x + bw / 2, P.y + bh / 2 + 0.5, C.ink, fs);
      text(g, '?', P.x + bw + mark / 2 + 1, P.y + bh / 2 + 0.5, C.cmp, fs + 2);
    } else {
      g.fillStyle = C.mov;
      g.fillRect(P.x, P.y, bw, bh);
      text(g, label, P.x + bw / 2, P.y + bh / 2 + 0.5, C.onMov, fs);
    }
  }
}

/* ---------- ディスクのページ ---------- */
function drawPages(g: CanvasRenderingContext2D, c: Cell, f: Frame, Z: Rect, mini: boolean, hover: number | null): void {
  const t = c.trace,
    nodes = f.N.filter((v): v is Node => !!v && (v.id === f.root || v.k.length >= 0)),
    items: { pg: number; v?: Node }[] = [...nodes.map((v) => ({ pg: v.pg, v })), ...f.stale.map((pg) => ({ pg }))].sort(
      (a, b) => a.pg - b.pg,
    ),
    head = mini ? 0 : 20,
    H = Z.h - head,
    aim = Math.ceil(Math.sqrt((items.length * Z.w) / Math.max(H, 1) / 2.4)) || 1,
    cols = Math.max(mini ? 12 : 4, Math.min(aim, items.length)),
    tw = Math.min(mini ? 26 : 58, Z.w / cols),
    rows = Math.ceil(items.length / cols),
    th = Math.min(mini ? 12 : 26, H / Math.max(rows, 1));
  if (!mini) text(g, 'ディスクのページ', Z.x, Z.y + 8, C.ink2, 13, 700, 'left');
  items.forEach((it, i) => {
    const x = Z.x + (i % cols) * tw,
      y = Z.y + head + Math.floor(i / cols) * th,
      w = tw - 4,
      h = th - (mini ? 2 : 4),
      v = it.v;
    if (!v) {
      g.strokeStyle = C.grid2;
      g.setLineDash([3, 3]);
      g.lineWidth = 1;
      g.strokeRect(x, y, w, h);
      g.setLineDash([]);
      return;
    }
    const R = f.r.includes(v.id),
      W = f.w.includes(v.id),
      B = f.bad === v.id,
      u = Math.min(1, v.k.length / Math.max(1, slotsOf(t, f, v.id))),
      bh = h >= 16 ? 5 : h,
      fam = kin(f, hover, v.id);
    g.fillStyle = C.grid;
    g.fillRect(x, y + h - bh, w, bh);
    g.fillStyle = W ? C.mov : R ? C.cmp : B ? C.bad : C.bar;
    g.fillRect(x, y + h - bh, w * u, bh);
    g.strokeStyle = fam === 'self' ? C.accent : fam ? C.ink : B ? C.bad : W ? C.mov : R ? C.cmp : C.grid2;
    g.lineWidth = fam || R || W || B ? 2.4 : 1;
    g.strokeRect(x, y, w, h);
    if (h >= 16 && w >= 22)
      text(g, String(v.pg), x + w / 2, y + (h - bh) / 2 + 0.5, R || W ? C.ink : C.ink2, 12, R || W ? 700 : 500);
    if (!mini) hits.push({ x0: x, x1: x + w, y0: y, y1: y + h, id: v.id });
  });
}

/* ---------- 全体 ---------- */
/** 右上の待機中のキー */
function drawWaiting(g: CanvasRenderingContext2D, t: Trace, f: Frame, W: number): void {
  if (f.s !== 0) return;
  const rest = t.keys.slice(f.next);
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
  const pageH = Math.max(96, Math.min(150, H * 0.26));
  if (o.say) text(g, o.say, 14, 21, C.ink, 17, 700, 'left');
  drawWaiting(g, c.trace, f, W);
  drawTree(g, c, f, { x: 12, y: 60, w: W - 24, h: H - 68 - pageH }, false, o.hover);
  g.strokeStyle = C.grid;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(10, H - pageH - 2);
  g.lineTo(W - 10, H - pageH - 2);
  g.stroke();
  drawPages(g, c, f, { x: 14, y: H - pageH + 4, w: W - 28, h: pageH - 10 }, false, o.hover);
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
  drawTree(g, c, f, { x: 8, y: 34, w: W - 16, h: CMP_H - 34 - 48 }, true, null);
  drawPages(g, c, f, { x: 10, y: CMP_H - 40, w: W - 20, h: 36 }, true, null);
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
/** 図を描く。キーがまだ動いている間は true を返す */
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
