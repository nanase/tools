/**
 * 図: 表を番号の付いた箱の列で描く（デザイン案 A）。キーは上の札から番号の箱へ入り、探した順に箱の上を弧でたどる。
 * チェイン法は箱の下に列を伸ばし、カッコウ・ハッシュ法は表を 2 つ、入れた順を保つ辞書は番号の表と項目の列を描く。
 * 図の高さは記録の中の最大の表で決め、拡張で表が 2 倍になっても枠の高さは変えない
 */
import { type Addr, type Frame, inspect, meaningOf, type Shape, TOMB, type Trace } from './model';

/** 図の 1 行 */
export interface Cell {
  trace: Trace;
  /** 枠の見出し（比較） */
  name: string;
  /** 比較の枠のキャンバス */
  cv?: HTMLCanvasElement;
  /** 札の今の位置（アニメーション） */
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
export interface DrawOpt {
  cmp: boolean;
  frameOf: (c: Cell) => Frame;
  /** 描く時刻 [ms] */
  now: number;
  /** 速さ [回/秒] */
  rate: number;
  snap: boolean;
  /** なぞっているキー */
  hover: string | null;
  /** 図の左上に出す文（単独） */
  say: string;
}

const C = {
  ink: '',
  ink2: '',
  ink3: '',
  bad: '',
  sans: '',
  mono: '',
  cmp: '',
  mov: '',
  done: '',
  wait: '',
  bar: '',
  line: '',
  screen: '',
  onBar: '',
  onCmp: '',
  onMov: '',
  onDone: '',
};
export function readColors(): void {
  const s = getComputedStyle(document.documentElement),
    v = (k: string) => s.getPropertyValue(k).trim();
  C.ink = v('--ink');
  C.ink2 = v('--ink-2');
  C.ink3 = v('--ink-3');
  C.bad = v('--warn');
  C.sans = v('--sans');
  C.mono = v('--mono');
  C.cmp = v('--dc-cmp');
  C.mov = v('--dc-mov');
  C.done = v('--dc-done');
  C.wait = v('--dc-wait');
  C.bar = v('--dc-bar');
  C.line = v('--dc-line');
  C.screen = v('--screen');
  C.onBar = v('--dc-on-bar');
  C.onCmp = v('--dc-on-cmp');
  C.onMov = v('--dc-on-mov');
  C.onDone = v('--dc-on-done');
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
function rrect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r = 3): void {
  g.beginPath();
  g.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}

/* ---------- 大きさ ---------- */
const narrowOf = (W: number): boolean => W < 620;
const hex = (h: number): string => `0x${h.toString(16).padStart(8, '0')}`;

/* ---------- 動き ---------- */
const ease = (u: number): number => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
let now = 0;
let moveMs = 400;
let snapNow = false;
let baseSnap = false;
let moving = false;
let tickNo = 0;
/** 目標へ時間をかけて動かす */
function anim(c: Cell, key: string, tx: number, ty: number): { x: number; y: number } {
  let p = c.pos.get(key);
  if (!p || snapNow) {
    p = { x: tx, y: ty, fx: tx, fy: ty, tx, ty, t0: -1e9, seen: tickNo };
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
export function shapeOf(f: Frame, t: Trace): Shape {
  let v = shapes.get(f);
  if (!v) {
    v = inspect(f, t.def, t.opt.hash);
    shapes.set(f, v);
  }
  return v;
}

/* ---------- 状態 ---------- */
const same = (a: Addr, b: Addr): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
const has = (L: readonly Addr[], a: Addr): boolean => L.some((b) => same(a, b));
type St = 'got' | 'put' | 'look' | 'path' | null;
function stateOf(f: Frame, a: Addr): St {
  if (has(f.got, a)) return 'got';
  if (has(f.put, a)) return 'put';
  if (has(f.look, a)) return 'look';
  if (has(f.path, a)) return 'path';
  return null;
}
const fillOf = (st: St): [string, string] =>
  st === 'got'
    ? [C.done, C.onDone]
    : st === 'put'
      ? [C.mov, C.onMov]
      : st === 'look'
        ? [C.cmp, C.onCmp]
        : [C.bar, C.onBar];

/* ---------- なぞる ---------- */
let hits: { x: number; y: number; w: number; h: number; k: string }[] = [];
/** (x, y) にあるキー */
export function hitAt(x: number, y: number): string | null {
  for (const q of hits) if (x >= q.x - 2 && x <= q.x + q.w + 2 && y >= q.y - 2 && y <= q.y + q.h + 2) return q.k;
  return null;
}

/* ---------- 箱の並び ---------- */
interface Slot {
  a: Addr;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 番号 */
  n: number;
  /** 項目の列の箱か */
  e: boolean;
}
interface Item {
  k: string;
  a: Addr;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Layout {
  slots: Slot[];
  items: Item[];
  capts: [string, number][];
  H: number;
  cw: number;
}
/** 場所の箱と札の位置。行の数は記録の中の最大の表で決める */
function layout(f: Frame, t: Trace, W: number, y0: number, mini: boolean): Layout {
  const kind = t.def.kind,
    cols = mini || narrowOf(W) ? 8 : 16,
    gx = mini ? 3 : 4,
    cw = (W - 28 - gx * (cols - 1)) / cols,
    th = mini ? 20 : 30,
    lab = mini ? 13 : 17,
    depth = kind === 'chain' ? t.maxChain : 1,
    ch = th * 0.8 + 4,
    slots: Slot[] = [],
    items: Item[] = [],
    capts: [string, number][] = [];
  let y = y0;
  const tables = kind === 'list' ? [] : f.T,
    sizeMax = kind === 'cuckoo' ? t.maxM / 2 : t.maxM;
  tables.forEach((T, ti) => {
    const name = kind === 'cuckoo' ? `表 ${ti + 1}` : kind === 'compact' ? '番号の表' : '';
    if (name) {
      capts.push([name, y]);
      y += mini ? 16 : 20;
    }
    const rh = lab + th + (depth - 1) * ch + (mini ? 6 : 10);
    T.forEach((c, s) => {
      const x = 14 + (s % cols) * (cw + gx),
        yy = y + Math.floor(s / cols) * rh + lab;
      slots.push({ a: [ti, s], x, y: yy, w: cw, h: th, n: s, e: false });
      if (kind === 'chain')
        (c as string[]).forEach((k, j) => {
          items.push({ k, a: [ti, s, j], x, y: yy + (j ? th + 4 + (j - 1) * ch : 0), w: cw, h: j ? th * 0.8 : th });
        });
      else if (kind !== 'compact' && typeof c === 'string' && c !== TOMB)
        items.push({ k: c, a: [ti, s], x, y: yy, w: cw, h: th });
    });
    y += Math.ceil(sizeMax / cols) * rh;
  });
  if (kind === 'compact' || kind === 'list') {
    capts.push([kind === 'compact' ? '項目（入れた順）' : '配列', y]);
    y += mini ? 16 : 20;
    const rh = lab + th + (mini ? 6 : 10);
    f.E.forEach((k, i) => {
      const x = 14 + (i % cols) * (cw + gx),
        yy = y + Math.floor(i / cols) * rh + lab;
      slots.push({ a: ['E', i], x, y: yy, w: cw, h: th, n: i, e: true });
      if (k !== null) items.push({ k, a: ['E', i], x, y: yy, w: cw, h: th });
    });
    y += Math.ceil(Math.max(t.maxE, 1) / cols) * rh;
  }
  return { slots, items, capts, H: y, cw };
}

/* ---------- 描く ---------- */
function tomb(g: CanvasRenderingContext2D, s: Slot): void {
  rrect(g, s.x + 1.5, s.y + 1.5, s.w - 3, s.h - 3);
  g.setLineDash([3, 3]);
  g.strokeStyle = C.ink3;
  g.lineWidth = 1.2;
  g.stroke();
  g.setLineDash([]);
  text(g, '×', s.x + s.w / 2, s.y + s.h / 2 + 0.5, C.ink3, Math.min(15, s.h * 0.7));
}
/** 矢じり。先端 (x, y)、向き ang [rad]、長さ len */
function arrowHead(g: CanvasRenderingContext2D, x: number, y: number, ang: number, len: number, color: string): void {
  const wid = len * 0.55;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x - len * Math.cos(ang) + wid * Math.sin(ang), y - len * Math.sin(ang) - wid * Math.cos(ang));
  g.lineTo(x - len * Math.cos(ang) - wid * Math.sin(ang), y - len * Math.sin(ang) + wid * Math.cos(ang));
  g.closePath();
  g.fillStyle = color;
  g.fill();
}
function ring(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string, lw = 3): void {
  rrect(g, x - 2.5, y - 2.5, w + 5, h + 5, 5);
  g.strokeStyle = col;
  g.lineWidth = lw;
  g.stroke();
}
function drawTable(
  g: CanvasRenderingContext2D,
  c: Cell,
  f: Frame,
  L: Layout,
  mini: boolean,
  hover: string | null,
): Slot[] {
  const kind = c.trace.def.kind,
    fs = mini ? 11 : L.cw >= 48 ? 14 : 12,
    every = L.cw >= 26 ? 1 : 4;
  for (const [s, y] of L.capts) text(g, s, 14, y + 12, C.ink2, mini ? 12 : 13, 700, 'left');
  for (const sl of L.slots) {
    if (sl.n % every === 0) text(g, String(sl.n), sl.x + 2, sl.y - 4, C.ink3, mini ? 11 : 13, 600, 'left', C.mono);
    rrect(g, sl.x, sl.y, sl.w, sl.h);
    g.strokeStyle = C.line;
    g.lineWidth = 1;
    g.stroke();
    const v = sl.e ? f.E[sl.n] : f.T[sl.a[0] as number][sl.n];
    if (v === TOMB || (sl.e && v === null) || (kind === 'compact' && !sl.e && v === -2)) tomb(g, sl);
    /* 番号の表は項目の番号を書く */
    if (kind === 'compact' && !sl.e && typeof v === 'number' && v >= 0) {
      const st = stateOf(f, sl.a),
        [bg, fg] = st ? fillOf(st) : ['', C.ink];
      if (bg) {
        rrect(g, sl.x, sl.y, sl.w, sl.h);
        g.fillStyle = bg;
        g.fill();
      }
      text(g, String(v), sl.x + sl.w / 2, sl.y + sl.h / 2 + 0.5, fg, mini ? 12 : 15, 700, 'center', C.mono);
    }
  }
  /* 札 */
  for (const it of L.items) {
    const p = anim(c, it.k, it.x, it.y),
      st = stateOf(f, it.a),
      [bg, fg] = fillOf(st);
    rrect(g, p.x, p.y, it.w, it.h);
    g.fillStyle = bg;
    g.fill();
    if (st === 'path') {
      g.strokeStyle = C.cmp;
      g.lineWidth = 2;
      g.stroke();
    }
    if (hover === it.k) ring(g, p.x, p.y, it.w, it.h, C.ink, 2);
    if (it.w >= 22) {
      g.save();
      g.beginPath();
      g.rect(p.x, p.y, it.w, it.h);
      g.clip();
      text(g, it.k, p.x + it.w / 2, p.y + it.h / 2 + 0.5, fg, it.h < 26 && !mini ? Math.min(fs, 12) : fs);
      g.restore();
    }
    if (!mini) hits.push({ x: it.x, y: it.y, w: it.w, h: it.h, k: it.k });
  }
  /* 調べている場所の枠 */
  for (const sl of L.slots) {
    const st = stateOf(f, sl.a);
    if (st === 'look') ring(g, sl.x, sl.y, sl.w, sl.h, f.miss ? C.bad : C.cmp);
    else if (st === 'path') ring(g, sl.x, sl.y, sl.w, sl.h, C.cmp, 1.2);
  }
  if (kind === 'chain') for (const it of L.items) if (has(f.look, it.a)) ring(g, it.x, it.y, it.w, it.h, C.cmp);
  /* 探した順の弧。次に調べる場所の上に矢じり */
  const seq = [...f.path, ...f.look].filter((a) => a[0] !== 'E' && a.length === 2),
    pos = (a: Addr) => L.slots.find((s) => same(s.a, a)),
    head = mini ? 5 : 7;
  g.strokeStyle = C.cmp;
  g.lineWidth = mini ? 1.4 : 1.8;
  for (let i = 1; i < seq.length; i++) {
    const A = pos(seq[i - 1]),
      B = pos(seq[i]);
    if (!A || !B || same(A.a, B.a)) continue;
    const ax = A.x + A.w / 2,
      bx = B.x + B.w / 2,
      ay = A.y - (mini ? 2 : 4),
      by = B.y - (mini ? 2 : 4),
      up = Math.min(mini ? 14 : 26, 8 + Math.abs(bx - ax) * 0.15 + Math.abs(by - ay) * 0.3);
    g.beginPath();
    g.moveTo(ax, ay);
    g.bezierCurveTo(ax, ay - up, bx, by - up, bx, by - head + 1);
    g.stroke();
    arrowHead(g, bx, by, Math.PI / 2, head, C.cmp);
  }
  return L.slots;
}
/** 入れる・探すキーの札。追加は塗り、検索と削除は枠だけに「?」 */
function drawCur(
  g: CanvasRenderingContext2D,
  c: Cell,
  f: Frame,
  x: number,
  y: number,
  mini: boolean,
  slots: Slot[],
): number {
  if (!f.cur) return x;
  const t = c.trace,
    inT = shapeOf(f, t).at.has(f.cur),
    fs = mini ? 12 : 15,
    h = mini ? 20 : 28;
  g.font = `700 ${fs}px ${C.sans}`;
  const w = Math.max(mini ? 34 : 46, g.measureText(f.cur).width + 16),
    mark = f.q ? 16 : 0;
  /* 追加のキーは表へ入ると札が消え、箱の札へ動く */
  if (f.q || !inT || f.kick) {
    const key = f.q ? 'q' : f.cur,
      p = anim(c, key, x, y);
    if (f.q) {
      rrect(g, p.x, p.y, w, h);
      g.fillStyle = C.screen;
      g.fill();
      g.strokeStyle = f.miss ? C.bad : C.cmp;
      g.lineWidth = 2;
      g.stroke();
      text(g, f.cur, p.x + w / 2, p.y + h / 2 + 0.5, C.ink, fs);
      text(g, '?', p.x + w + mark / 2 + 1, p.y + h / 2 + 0.5, f.miss ? C.bad : C.cmp, fs + 2);
    } else {
      rrect(g, p.x, p.y, w, h);
      g.fillStyle = C.mov;
      g.fill();
      text(g, f.cur, p.x + w / 2, p.y + h / 2 + 0.5, C.onMov, fs);
    }
    /* 最初の 1 手は番号の箱へ破線の矢印 */
    if (f.calc && f.look.length && !f.path.length && !f.kick) {
      g.setLineDash([3, 3]);
      g.strokeStyle = C.ink3;
      g.lineWidth = 1.2;
      const head = mini ? 6 : 9;
      for (const a of f.look) {
        const B = slots.find((s) => same(s.a, a));
        if (!B) continue;
        const x0 = x + w / 2,
          y0 = y + h + 2,
          x1 = B.x + B.w / 2,
          y1 = B.y - 3,
          ang = Math.atan2(y1 - y0, x1 - x0);
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1 - (head - 1) * Math.cos(ang), y1 - (head - 1) * Math.sin(ang));
        g.stroke();
        g.setLineDash([]);
        arrowHead(g, x1, y1, ang, head, C.ink3);
        g.setLineDash([3, 3]);
      }
      g.setLineDash([]);
    }
  }
  return x + w + mark + 12;
}
function calcText(t: Trace, f: Frame): string {
  const c = f.calc;
  if (!c) return '';
  if (t.def.kind === 'cuckoo') return `表 1 → ${c.s[0]} 番・表 2 → ${c.s[1]} 番`;
  return `${t.opt.hash === 'sum' ? `和 ${c.h}` : hex(c.h)} → 下位 ${c.bits} ビット → ${c.s[0]} 番`;
}
/** 右上の待機中のキー */
function drawWaiting(g: CanvasRenderingContext2D, t: Trace, f: Frame, W: number): void {
  if (f.s !== 0) return;
  const rest = t.keys.slice(f.next + (f.cur && !f.q ? 1 : 0));
  if (!rest.length) return;
  let x = W - 14;
  if (!narrowOf(W))
    for (let i = Math.min(5, rest.length) - 1; i >= 0; i--) {
      g.font = `500 13px ${C.sans}`;
      const w = g.measureText(rest[i]).width + 12;
      x -= w + 3;
      g.strokeStyle = C.wait;
      g.lineWidth = 1.2;
      g.strokeRect(x, 8, w, 24);
      text(g, rest[i], x + w / 2, 20.5, C.ink2, 13, 500);
    }
  text(g, `待機中 ${rest.length}`, x - (narrowOf(W) ? 0 : 8), 20.5, C.ink2, 13, 500, 'right');
}
function topOf(W: number, mini: boolean): number {
  return mini ? 58 : narrowOf(W) ? 112 : 92;
}
function drawOne(g: CanvasRenderingContext2D, c: Cell, f: Frame, W: number, H: number, L: Layout, o: DrawOpt): void {
  const t = c.trace,
    nr = narrowOf(W);
  if (o.say) text(g, o.say, 14, 21, C.ink, 17, 700, 'left');
  drawWaiting(g, t, f, W);
  const slots = drawTable(g, c, f, L, false, o.hover),
    x = drawCur(g, c, f, 14, nr ? 36 : 38, false, slots),
    ct = calcText(t, f);
  if (ct && f.cur) text(g, ct, nr ? 14 : x, nr ? 82 : 53, C.ink2, 13, 600, 'left', C.mono);
  const s = shapeOf(f, t),
    foot =
      t.def.kind === 'list'
        ? `キー ${s.n}`
        : `負荷率 ${s.load.toFixed(2)}・場所 ${f.M}・キー ${s.n}${s.tomb ? `・削除済み ${s.tomb}` : ''}`;
  text(g, foot, 14, H - 14, C.ink2, 13, 600, 'left');
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
/** 比較の枠を 1 つ描く */
function drawCell(c: Cell, o: DrawOpt): void {
  const cv = c.cv;
  if (!cv) return;
  const W = (cv.parentElement as HTMLElement).clientWidth || 300,
    f = o.frameOf(c),
    L = layout(f, c.trace, W, topOf(W, true), true),
    H = L.H + 22,
    g = sizeCanvas(cv, W, H);
  if (!g) return;
  if (f.say) text(g, f.say, 10, 14, C.ink2, 12.5, 700, 'left');
  const slots = drawTable(g, c, f, L, true, null);
  drawCur(g, c, f, 14, 26, true, slots);
  const s = shapeOf(f, c.trace);
  text(
    g,
    c.trace.def.kind === 'list' ? `キー ${s.n}` : `負荷率 ${s.load.toFixed(2)}・場所 ${f.M}`,
    10,
    H - 10,
    C.ink2,
    12.5,
    600,
    'left',
  );
  sweep(c);
}
/** 図を描く。札がまだ動いている間は true を返す */
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
    f = o.frameOf(c),
    L = layout(f, c.trace, W, topOf(W, false), false),
    H = L.H + 34,
    g = sizeCanvas(cv, W, H);
  if (g) drawOne(g, c, f, W, H, L, o);
  sweep(c);
  return moving;
}
/** なぞったキーの説明 */
export function describe(t: Trace, f: Frame, k: string): string {
  const s = shapeOf(f, t),
    a = s.at.get(k),
    v = t.vals.get(k) ?? meaningOf(k);
  if (!a) return '';
  const where =
    a[0] === 'E' ? `項目 ${a[1]}` : t.def.kind === 'cuckoo' ? `表 ${(a[0] as number) + 1} の ${a[1]} 番` : `${a[1]} 番`;
  return `${k}${v ? ` → ${v}` : ''}　${where}　調べる回数 ${s.cost.get(k)}`;
}
