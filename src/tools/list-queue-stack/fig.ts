/**
 * 図: どのデータ構造も「入力 → 入れ物 → 出力」の 1 行で描き、入れ物だけが shape で変わる。
 * 新しいデータ構造の形は targets（バーの置き場所）と drawBox（入れ物）に足す
 */
import { type Frame, outSlot, type Trace, VM } from './model';

/** 図の 1 行 */
export interface Cell {
  trace: Trace;
  /** バーの今の位置（アニメーション） */
  pos: Map<number, Bar>;
}
interface Bar {
  x: number;
  y: number;
  w: number;
  h: number;
  a: number;
}
interface Target extends Bar {
  hl: '' | 'w' | 'r';
}
interface Geo {
  one: boolean;
  narrow: boolean;
  top: number;
  h: number;
  pad: number;
  ix: number;
  iw: number;
  cx: number;
  cw: number;
  ox: number;
  ow: number;
  y0: number;
  y1: number;
  H: number;
}

const C = { ink: '', ink2: '', ch1: '', ch2: '', accent: '', grid: '', grid2: '', scr: '', sans: '' };
export function readColors(): void {
  const s = getComputedStyle(document.documentElement),
    v = (k: string) => s.getPropertyValue(k).trim();
  C.ink = v('--ink');
  C.ink2 = v('--ink-2');
  C.ch1 = v('--ch1');
  C.ch2 = v('--ch2');
  C.accent = v('--accent');
  C.grid = v('--grid');
  C.grid2 = v('--grid-2');
  C.scr = v('--screen-ink');
  C.sans = v('--sans');
}

function arrow(g: CanvasRenderingContext2D, x: number, y: number, dx: number, dy = 0, s = 5): void {
  g.beginPath();
  g.moveTo(x + dx * s, y + dy * s);
  g.lineTo(x - dx * s - dy * s, y - dy * s + dx * s);
  g.lineTo(x - dx * s + dy * s, y - dy * s - dx * s);
  g.closePath();
  g.fill();
}
function note(g: CanvasRenderingContext2D, t: string, x: number, y: number, al: CanvasTextAlign = 'center'): void {
  g.font = `500 11px ${C.sans}`;
  g.textAlign = al;
  g.fillStyle = C.ink2;
  g.fillText(t, x, y);
}

function geoOf(i: number, count: number, W: number, cmp: boolean): Geo {
  const narrow = W < 620,
    pad = 12,
    h = !cmp ? (narrow ? 190 : 300) : narrow ? 124 : Math.max(96, Math.min(140, 420 / count)),
    gap = cmp ? 8 : 0,
    top = 6 + i * (h + gap),
    labH = cmp && narrow ? 16 : 0,
    lab = cmp && !narrow ? 92 : 0,
    x = pad + lab,
    w = W - pad * 2 - lab,
    zone = w * 0.27,
    zg = narrow ? 18 : 34,
    zc = w - zone * 2 - zg * 2,
    y0 = top + labH + 16,
    y1 = top + h - 12;
  return {
    one: !cmp,
    narrow,
    top,
    h,
    pad,
    ix: x,
    iw: zone,
    cx: x + zone + zg,
    cw: zc,
    ox: x + zone + zg * 2 + zc,
    ow: zone,
    y0,
    y1,
    H: y1 - y0,
  };
}
/** 図全体の高さ */
export const figHeight = (count: number, W: number, cmp: boolean): number => {
  const g = geoOf(count - 1, count, W, cmp);
  return g.top + g.h + 8;
};
/** y にある行の番号（比較で音を聞く行を選ぶ） */
export function rowAt(y: number, count: number, W: number, cmp: boolean): number {
  for (let i = 0; i < count; i++) {
    const g = geoOf(i, count, W, cmp);
    if (y >= g.top && y < g.top + g.h) return i;
  }
  return -1;
}

const pileW = (G: Geo): number => Math.min(G.cw * 0.7, G.H * 1.5);
const ringOf = (G: Geo) => {
  const R = Math.min(G.cw / 2, G.H / 2 + 8);
  return { R, cx: G.cx + G.cw / 2, cy: G.y0 + G.H / 2, r0: R * 0.42 };
};
const slotsOf = (t: Trace): number => (t.def.shape === 'slots' ? t.slots : t.cap);

/** バーの行き先。x・y はバーの根元の中央、a は傾き */
function targets(t: Trace, f: Frame, G: Geo, n: number): Map<number, Target> {
  const m = new Map<number, Target>(),
    vH = G.H - 2,
    hOf = (id: number) => (t.vals[id] / VM) * vH,
    lit = (id: number): Target['hl'] => (f.w.includes(id) ? 'w' : f.r.includes(id) ? 'r' : ''),
    bo = G.ow / n,
    bc = G.cw / slotsOf(t),
    put = (id: number, x: number, y = G.y1, w = bc * 0.82, h = hOf(id), a = 0) =>
      m.set(id, { x, y, w: Math.min(w, 28), h, a, hl: lit(id) });
  for (let r = Math.max(0, f.outN - n); r < f.outN; r++) {
    const id = t.outs[r];
    m.set(id, {
      x: G.ox + G.ow - (outSlot(r, f.outN, n) + 0.5) * bo,
      y: G.y1,
      w: Math.min(bo * 0.84, 22),
      h: hOf(id),
      a: 0,
      hl: lit(id),
    });
  }
  const it = f.items,
    shape = t.def.shape;
  if (shape === 'pile') {
    const pw = pileW(G),
      ph = Math.min(11, (G.H - 12) / t.cap),
      cx = G.cx + G.cw / 2;
    it.forEach((id, i) => {
      if (id != null)
        m.set(id, { x: cx, y: G.y1 - 2 - i * ph, w: (t.vals[id] / VM) * (pw - 10), h: ph * 0.8, a: 0, hl: lit(id) });
    });
  } else if (shape === 'tube') {
    it.forEach((id, i) => {
      if (id != null) put(id, G.cx + G.cw - 6 - (it.length - i - 0.5) * bc);
    });
  } else if (shape === 'tube2') {
    const st = G.cx + G.cw / 2 - (it.length * bc) / 2;
    it.forEach((id, i) => {
      if (id != null) put(id, st + (i + 0.5) * bc);
    });
  } else if (shape === 'slots') {
    it.forEach((id, i) => {
      if (id != null) put(id, G.cx + (i + 0.5) * bc);
    });
  } else if (shape === 'chain' || shape === 'chain2') {
    it.forEach((id, i) => {
      if (id != null) put(id, G.cx + (i + 0.5) * bc, G.y1 - 8, bc * 0.72, (t.vals[id] / VM) * (vH - 8));
    });
  } else {
    const { R, cx, cy, r0 } = ringOf(G);
    it.forEach((id, i) => {
      if (id == null) return;
      const th = (2 * Math.PI * ((f.hd + i) % t.cap)) / t.cap - Math.PI / 2;
      put(
        id,
        cx + r0 * Math.cos(th),
        cy + r0 * Math.sin(th),
        Math.min(((2 * Math.PI * r0) / t.cap) * 0.8, 14),
        (t.vals[id] / VM) * (R - r0 - 2),
        th + Math.PI / 2,
      );
    });
  }
  return m;
}

function drawBox(g: CanvasRenderingContext2D, t: Trace, f: Frame, G: Geo): void {
  const shape = t.def.shape,
    x0 = G.cx,
    x1 = G.cx + G.cw,
    y0 = G.y0 - 2,
    y1 = G.y1 + 1,
    my = (y0 + y1) / 2,
    bc = G.cw / slotsOf(t),
    /* 狭い画面では 1 字に詰める */
    inL = G.narrow ? '入' : '入口',
    outL = G.narrow ? '出' : '出口';
  g.strokeStyle = C.scr;
  g.lineWidth = 1.4;
  g.fillStyle = C.scr;
  if (shape === 'pile') {
    const pw = pileW(G),
      cx = (x0 + x1) / 2,
      L = cx - pw / 2,
      R = cx + pw / 2,
      top = y0 + 2;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(L, top);
    g.lineTo(L, y1);
    g.lineTo(R, y1);
    g.lineTo(R, top);
    g.stroke();
    arrow(g, L - 14, top + 4, 0.7, 0.7);
    note(g, inL, L - (G.narrow ? 24 : 30), top + 4);
    g.fillStyle = C.scr;
    arrow(g, R + 14, top + 4, 0.7, -0.7);
    note(g, outL, R + (G.narrow ? 24 : 30), top + 4);
  } else if (shape === 'tube' || shape === 'tube2') {
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y0);
    g.moveTo(x0, y1);
    g.lineTo(x1, y1);
    g.stroke();
    if (shape === 'tube') {
      arrow(g, x0 - 7, my, 1);
      note(g, inL, x0 - (G.narrow ? 7 : 12), my - 14);
      g.fillStyle = C.scr;
      arrow(g, x1 + 7, my, 1);
      note(g, outL, x1 + (G.narrow ? 7 : 12), my - 14);
    } else {
      arrow(g, x0 - 7, my - 9, 1);
      arrow(g, x0 - 7, my + 9, -1);
      arrow(g, x1 + 7, my - 9, -1);
      arrow(g, x1 + 7, my + 9, 1);
    }
  } else if (shape === 'slots') {
    g.lineWidth = 1;
    g.strokeStyle = C.grid2;
    g.beginPath();
    g.moveTo(x0, y1 + 0.5);
    g.lineTo(x0 + f.size * bc, y1 + 0.5);
    for (let i = 0; i <= f.size; i++) {
      const x = x0 + i * bc;
      g.moveTo(x, y1);
      g.lineTo(x, y1 + 5);
    }
    g.stroke();
    if (G.one) note(g, '先頭', x0 + 2, G.y0 - 8, 'left');
  } else if (shape === 'chain' || shape === 'chain2') {
    const y = G.y1 - 3,
      it = f.items;
    for (let i = 0; i < it.length - 1; i++) {
      const a = G.cx + (i + 0.5) * bc,
        b = G.cx + (i + 1.5) * bc,
        on = f.lk.includes(it[i] as number);
      g.strokeStyle = on ? C.ch1 : C.scr;
      g.fillStyle = g.strokeStyle;
      g.lineWidth = on ? 2.4 : 1.2;
      g.beginPath();
      g.moveTo(a, y);
      g.lineTo(b - 4, y);
      g.stroke();
      arrow(g, b - 3, y, 1, 0, 3);
      if (shape === 'chain2') {
        g.beginPath();
        g.moveTo(b, y + 5);
        g.lineTo(a + 4, y + 5);
        g.stroke();
        arrow(g, a + 3, y + 5, -1, 0, 3);
      }
    }
    if (f.wk != null) {
      const i = it.indexOf(f.wk);
      if (i >= 0) {
        g.fillStyle = C.accent;
        g.beginPath();
        g.arc(G.cx + (i + 0.5) * bc, y + 9, 3.6, 0, 7);
        g.fill();
      }
    }
    if (G.one) note(g, '先頭', x0 + 2, G.y0 - 8, 'left');
  } else {
    const { cx, cy, r0 } = ringOf(G),
      cap = t.cap;
    g.lineWidth = 1.2;
    g.strokeStyle = C.grid2;
    g.beginPath();
    g.arc(cx, cy, r0, 0, 7);
    g.stroke();
    for (let i = 0; i < cap; i++) {
      const th = (2 * Math.PI * i) / cap - Math.PI / 2;
      g.beginPath();
      g.moveTo(cx + (r0 - 4) * Math.cos(th), cy + (r0 - 4) * Math.sin(th));
      g.lineTo(cx + r0 * Math.cos(th), cy + r0 * Math.sin(th));
      g.stroke();
    }
    const mark = (s: number, tx: string, lr = r0 - 24) => {
      const th = (2 * Math.PI * s) / cap - Math.PI / 2,
        p = (r: number, a: number) => [cx + r * Math.cos(th + a), cy + r * Math.sin(th + a)] as const;
      g.fillStyle = C.accent;
      g.beginPath();
      g.moveTo(...p(r0 - 6, 0));
      g.lineTo(...p(r0 - 14, -0.14));
      g.lineTo(...p(r0 - 14, 0.14));
      g.fill();
      if (G.one) note(g, tx, ...p(lr, 0));
    };
    /* 入口と出口が近いときは、字が重ならないよう入口の字を内側へずらす */
    const tail = (f.hd + f.items.length) % cap,
      gap = Math.min((tail - f.hd + cap) % cap, (f.hd - tail + cap) % cap),
      near = f.items.length > 0 && (gap * 2 * Math.PI * (r0 - 24)) / cap < 34;
    mark(tail, inL, near ? r0 - (G.narrow ? 36 : 50) : r0 - 24);
    if (f.items.length) mark(f.hd, outL);
  }
}

export interface DrawOpt {
  cmp: boolean;
  /** 音を聞く行 */
  hear: number;
  /** 入力のバーの数 */
  n: number;
  /** 再生の位置 */
  step: number;
  /** バーを動かさず行き先へ置く */
  snap: boolean;
  /** バーが近づく割合（このコマの分） */
  k: number;
}

/** 図を描く。バーがまだ動いている間は true を返す */
export function drawFig(cv: HTMLCanvasElement, cells: Cell[], o: DrawOpt): boolean {
  const box = cv.parentElement as HTMLElement,
    W = box.clientWidth || 700,
    H = figHeight(cells.length, W, o.cmp),
    d = devicePixelRatio || 1;
  if (cv.width !== Math.round(W * d) || cv.height !== Math.round(H * d)) {
    cv.width = Math.round(W * d);
    cv.height = Math.round(H * d);
    cv.style.height = `${H}px`;
  }
  const g = cv.getContext('2d');
  if (!g) return false;
  g.setTransform(d, 0, 0, d, 0, 0);
  g.clearRect(0, 0, W, H);
  g.textBaseline = 'middle';
  let moving = false;
  cells.forEach((cell, ci) => {
    const G = geoOf(ci, cells.length, W, o.cmp),
      t = cell.trace,
      f = t.frames[Math.min(o.step, t.frames.length - 1)],
      vH = G.H - 2,
      bi = G.iw / o.n;
    if (o.cmp) {
      const ly = G.narrow ? G.top + 8 : (G.y0 + G.y1) / 2;
      g.fillStyle = o.hear === ci ? C.accent : C.grid2;
      g.beginPath();
      g.arc(G.pad + 3, ly, 3.2, 0, 7);
      g.fill();
      g.font = `700 12.5px ${C.sans}`;
      g.fillStyle = C.ink;
      g.textAlign = 'left';
      g.fillText(t.def.name, G.pad + 10, ly);
    }
    if (ci === 0 || G.narrow) {
      note(g, '入力', G.ix, G.y0 - 8, 'left');
      note(g, '出力', G.ox + G.ow, G.y0 - 8, 'right');
    }
    /* 入力のバー: 右端から順に入る。入ったあとは跡を薄く残す */
    for (let id = 0; id < o.n; id++) {
      const x = G.ix + (o.n - 1 - id) * bi,
        h = (t.vals[id] / VM) * vH,
        used = id < f.next;
      g.fillStyle = used ? C.grid2 : C.scr;
      g.globalAlpha = used ? 0.28 : 1;
      g.fillRect(x + bi * 0.08, G.y1 - h, bi * 0.84, h);
      g.globalAlpha = 1;
    }
    if (f.next < o.n) {
      g.fillStyle = C.accent;
      arrow(g, G.ix + (o.n - 1 - f.next) * bi + bi / 2, G.y1 + 6, 0, -1, 4);
    }
    g.strokeStyle = C.grid;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(G.ox, G.y1 + 0.5);
    g.lineTo(G.ox + G.ow, G.y1 + 0.5);
    g.stroke();
    drawBox(g, t, f, G);
    const tg = targets(t, f, G, o.n);
    for (const [id, to] of tg) {
      let p = cell.pos.get(id);
      if (o.snap) {
        p = { x: to.x, y: to.y, w: to.w, h: to.h, a: to.a };
        cell.pos.set(id, p);
      } else if (!p) {
        p = {
          x: id < o.n ? G.ix + (o.n - 1 - id) * bi + bi / 2 : G.ix + G.iw,
          y: G.y1,
          w: bi * 0.84,
          h: (t.vals[id] / VM) * vH,
          a: 0,
        };
        cell.pos.set(id, p);
        moving = true;
      }
      for (const key of ['x', 'y', 'w', 'h', 'a'] as const) {
        const de = to[key] - p[key];
        if (Math.abs(de) > 0.25) {
          p[key] += de * o.k;
          moving = true;
        } else p[key] = to[key];
      }
      g.save();
      g.translate(p.x, p.y);
      if (p.a) g.rotate(p.a);
      g.fillStyle = to.hl === 'w' ? C.ch1 : to.hl === 'r' ? C.ch2 : C.scr;
      g.fillRect(-p.w / 2, -p.h, p.w, p.h);
      g.restore();
    }
    for (const id of cell.pos.keys()) if (!tg.has(id)) cell.pos.delete(id);
  });
  return moving;
}
