/**
 * 接点の回路（展開接続図）の組み立てと、電流の通り道の計算。
 * 回路は左の線（電池の +）と右の線（−）のあいだに、横の段を並べたもの。段は接点の直列・並列・c 接点の組み合わせと、右端の負荷（ランプかコイル）
 */
import type { ContactState } from './relay';

/** 接点の網。c は a か b の接点 1 個、S は直列、P は並列 */
export type Net =
  | { k: 'c'; r: string; t: 'a' | 'b' }
  | { k: 'S'; c: Net[] }
  | { k: 'P'; c: Net[] }
  /** c 接点の列（2 本の線を入れ替える）。out が 1 なら奇数の線、0 なら偶数の線 */
  | { k: 'chain'; refs: string[]; out: 0 | 1 }
  /** マルチプレクサ: s の c 接点で d0 と d1 を選ぶ */
  | { k: 'mux'; d0: string; d1: string; s: string }
  /** デコーダ: a と b の c 接点の木で 4 本に分ける */
  | { k: 'deco'; a: string; b: string }
  /** 3 路スイッチ 2 個: それぞれ c 接点 1 個で、間を渡り線 2 本でつなぐ */
  | { k: 'way3'; a: string; b: string };

export const S = (...c: Net[]): Net => ({ k: 'S', c });
export const P = (...c: Net[]): Net => ({ k: 'P', c });
export const ca = (r: string): Net => ({ k: 'c', r, t: 'a' });
export const cb = (r: string): Net => ({ k: 'c', r, t: 'b' });
export const CH = (refs: string[], out: 0 | 1): Net => ({ k: 'chain', refs, out });
export const MUX = (d0: string, d1: string, s: string): Net => ({ k: 'mux', d0, d1, s });
export const DECO = (a: string, b: string): Net => ({ k: 'deco', a, b });
export const WAY3 = (a: string, b: string): Net => ({ k: 'way3', a, b });

/** 負荷: ランプ、コイル（リレーの id）、並列にコンデンサの付いたコイル */
export type Load = { kind: 'lamp'; lb: string } | { kind: 'coil' | 'coilC'; id: string };
export interface Rung {
  net: Net;
  loads: Load[];
}

/** 点の名前 */
export type Pt = readonly [number, number];
const N = (x: number, y: number): string => `${Math.round(x)},${Math.round(y)}`;

/** 電流の計算に使う辺。w は線、c は接点（r の t 側が閉じていれば通る）、load は左から右へだけ通る負荷 */
export type Edge =
  | { k: 'w'; u: string; v: string }
  | { k: 'c'; u: string; v: string; r: string; t: 'a' | 'b' }
  | { k: 'load'; u: string; v: string; ld: Load };

/** 図の部品。e は対応する辺の添字 */
export type Draw =
  | { k: 'w'; pts: Pt[]; e: number }
  | { k: 'c'; x: number; y: number; r: string; t: 'a' | 'b'; e: number }
  /** c 接点: com と、復帰のときの st（b）と動作のときの cr（a）。eb と ea が辺 */
  | { k: 'cc'; com: Pt; st: Pt; cr: Pt; r: string; eb: number; ea: number; below?: boolean }
  | { k: 'load'; x: number; y: number; ld: Load; e: number }
  | { k: 'end'; x: number; y: number }
  | { k: 'txt'; x: number; y: number; t: string };

export interface Circuit {
  E: Edge[];
  D: Draw[];
  /** 電池の + と − */
  src: string;
  sink: string;
  bat: Pt;
  /** 入力の行の列の数 */
  cols: number;
  W: number;
  H: number;
  /** 回路の上端（入力の行の下） */
  top: number;
  adj: Map<string, { m: string; i: number; f: boolean }[]>;
}

/** 段の間隔 */
const ROW = 60;
/** 接点 1 個の幅、負荷の幅 */
const CWD = 56,
  LDW = 56;

function sz(n: Net): { w: number; h: number } {
  switch (n.k) {
    case 'c':
      return { w: CWD, h: 1 };
    case 'S': {
      let w = 0,
        h = 1;
      n.c.forEach((m, i) => {
        const s = sz(m);
        w += s.w + (i ? 16 : 0);
        h = Math.max(h, s.h);
      });
      return { w, h };
    }
    case 'P': {
      let w = 0,
        h = 0;
      for (const m of n.c) {
        const s = sz(m);
        w = Math.max(w, s.w);
        h += s.h;
      }
      return { w: w + 32, h };
    }
    case 'chain':
      return { w: 114 * n.refs.length + 2, h: 2 };
    case 'mux':
      return { w: 140, h: 2 };
    case 'deco':
      return { w: 160, h: 4 };
    case 'way3':
      return { w: 220, h: 2 };
  }
}

class Builder {
  E: Edge[] = [];
  D: Draw[] = [];
  W(pts: Pt[]): void {
    const q = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
    if (q.length < 2) return;
    const i = this.E.length;
    this.E.push({ k: 'w', u: N(...q[0]), v: N(...q[q.length - 1]) });
    this.D.push({ k: 'w', pts: q, e: i });
  }
  C2(x: number, y: number, r: string, t: 'a' | 'b'): void {
    const i = this.E.length;
    this.E.push({ k: 'c', u: N(x, y), v: N(x + CWD, y), r, t });
    this.D.push({ k: 'c', x, y, r, t, e: i });
  }
  CC(com: Pt, st: Pt, cr: Pt, r: string, below?: boolean): void {
    const eb = this.E.length;
    this.E.push({ k: 'c', u: N(...com), v: N(...st), r, t: 'b' });
    this.E.push({ k: 'c', u: N(...com), v: N(...cr), r, t: 'a' });
    this.D.push({ k: 'cc', com, st, cr, r, eb, ea: eb + 1, below });
  }
  /** n を (x, y) から置き、出口の点を返す */
  place(n: Net, x: number, y: number): Pt[] {
    switch (n.k) {
      case 'c':
        this.C2(x, y, n.r, n.t);
        return [[x + CWD, y]];
      case 'S': {
        let cx = x;
        n.c.forEach((m, i) => {
          if (i) {
            this.W([
              [cx, y],
              [cx + 16, y],
            ]);
            cx += 16;
          }
          this.place(m, cx, y);
          cx += sz(m).w;
        });
        return [[cx, y]];
      }
      case 'P': {
        const s = sz(n),
          xj = x + s.w;
        let yy = y,
          py = y;
        for (const m of n.c) {
          const cs = sz(m);
          if (yy > y) {
            this.W([
              [x, py],
              [x, yy],
            ]);
            this.W([
              [xj, yy],
              [xj, py],
            ]);
          }
          this.W([
            [x, yy],
            [x + 16, yy],
          ]);
          this.place(m, x + 16, yy);
          this.W([
            [x + 16 + cs.w, yy],
            [xj, yy],
          ]);
          py = yy;
          yy += cs.h * ROW;
        }
        return [[xj, y]];
      }
      case 'chain': {
        const k = n.refs.length,
          y1 = y + ROW;
        this.CC([x, y], [x + 44, y], [x + 44, y + 18], n.refs[0]);
        this.W([
          [x + 44, y],
          [x + 100, y],
        ]);
        this.W([
          [x + 44, y + 18],
          [x + 56, y + 18],
          [x + 56, y1],
          [x + 100, y1],
        ]);
        let J = x + 100;
        for (let s = 1; s < k; s++) {
          const cx = J + 14,
            r = n.refs[s];
          this.W([
            [J, y],
            [cx, y],
          ]);
          this.W([
            [J, y1],
            [cx, y1],
          ]);
          this.CC([cx, y], [cx + 44, y], [cx + 44, y + 18], r);
          this.CC([cx, y1], [cx + 44, y1], [cx + 44, y1 - 18], r, true);
          this.W([
            [cx + 44, y],
            [cx + 100, y],
          ]);
          this.W([
            [cx + 44, y1],
            [cx + 100, y1],
          ]);
          this.W([
            [cx + 44, y + 18],
            [cx + 56, y + 18],
            [cx + 84, y1 - 18],
            [cx + 100, y1 - 18],
            [cx + 100, y1],
          ]);
          this.W([
            [cx + 44, y1 - 18],
            [cx + 56, y1 - 18],
            [cx + 84, y + 18],
            [cx + 100, y + 18],
            [cx + 100, y],
          ]);
          J = cx + 100;
        }
        const xo = J + 16;
        if (n.out) {
          this.W([
            [J, y1],
            [xo, y1],
            [xo, y],
          ]);
          this.D.push({ k: 'end', x: J, y });
        } else {
          this.W([
            [J, y],
            [xo, y],
          ]);
          this.D.push({ k: 'end', x: J, y: y1 });
        }
        return [[xo, y]];
      }
      case 'mux': {
        const y1 = y + ROW;
        this.W([
          [x, y],
          [x, y1],
        ]);
        this.W([
          [x, y],
          [x + 16, y],
        ]);
        this.C2(x + 16, y, n.d0, 'a');
        this.W([
          [x, y1],
          [x + 16, y1],
        ]);
        this.C2(x + 16, y1, n.d1, 'a');
        this.W([
          [x + 72, y],
          [x + 96, y],
        ]);
        this.W([
          [x + 72, y1],
          [x + 84, y1],
          [x + 84, y + 18],
          [x + 96, y + 18],
        ]);
        this.CC([x + 140, y], [x + 96, y], [x + 96, y + 18], n.s);
        return [[x + 140, y]];
      }
      case 'way3': {
        const x2 = x + 176,
          yl = y + 36;
        this.CC([x, y], [x + 44, y], [x + 44, yl], n.a);
        this.W([
          [x + 44, y],
          [x2, y],
        ]);
        this.W([
          [x + 44, yl],
          [x2, yl],
        ]);
        this.CC([x2 + 44, y], [x2, yl], [x2, y], n.b);
        this.D.push({ k: 'txt', x: (x + 44 + x2) / 2, y: yl + 20, t: '渡り線' });
        return [[x2 + 44, y]];
      }
      case 'deco': {
        const R = ROW;
        this.CC([x, y], [x + 44, y], [x + 44, y + 18], n.a);
        this.W([
          [x + 44, y],
          [x + 100, y],
        ]);
        this.W([
          [x + 44, y + 18],
          [x + 60, y + 18],
          [x + 60, y + 2 * R],
          [x + 100, y + 2 * R],
        ]);
        for (const k of [0, 2]) {
          const yy = y + k * R;
          this.CC([x + 100, yy], [x + 144, yy], [x + 144, yy + 18], n.b);
          this.W([
            [x + 144, yy],
            [x + 160, yy],
          ]);
          this.W([
            [x + 144, yy + 18],
            [x + 152, yy + 18],
            [x + 152, yy + R],
            [x + 160, yy + R],
          ]);
        }
        return [0, 1, 2, 3].map((k) => [x + 160, y + k * R] as Pt);
      }
    }
  }
}

/** 入力の行の 1 列の幅と 1 行の高さ */
export const IN_COL = 150,
  IN_ROW = 96;

/** 回路の定義から図と計算の形を作る。nIn は入力の数（上の行に横 1 列に並べる） */
export function buildCircuit(rungs: readonly Rung[], nIn: number): Circuit {
  const b = new Builder();
  const cols = nIn;
  const XL = 30,
    top = nIn ? 128 : 40;
  const wn = Math.max(...rungs.map((r) => sz(r.net).w));
  const XLD = XL + 20 + wn + 24,
    XR = XLD + LDW + 44;
  let y = top;
  const lys: number[] = [],
    rys: number[] = [];
  for (const rg of rungs) {
    const s = sz(rg.net);
    b.W([
      [XL, y],
      [XL + 20, y],
    ]);
    lys.push(y);
    const outs = b.place(rg.net, XL + 20, y);
    let rows = s.h;
    outs.forEach(([ox, oy], k) => {
      const ld = rg.loads[k];
      b.W([
        [ox, oy],
        [XLD, oy],
      ]);
      const i = b.E.length;
      b.E.push({ k: 'load', u: N(XLD, oy), v: N(XLD + LDW, oy), ld });
      b.D.push({ k: 'load', x: XLD, y: oy, e: i, ld });
      b.W([
        [XLD + LDW, oy],
        [XR, oy],
      ]);
      rys.push(oy);
      if (ld.kind === 'coilC') rows = Math.max(rows, 2);
    });
    y += rows * ROW + (s.h >= 2 ? 22 : 0);
  }
  const yB = y - ROW + 62;
  /* 左の線（+）は下から上へ、右の線（−）は上から下へ */
  const ly = [...new Set(lys)].sort((p, q) => q - p),
    ry = [...new Set(rys)].sort((p, q) => p - q);
  let py = yB;
  for (const v of ly) {
    b.W([
      [XL, py],
      [XL, v],
    ]);
    py = v;
  }
  py = ry[0];
  for (const v of ry.slice(1)) {
    b.W([
      [XR, py],
      [XR, v],
    ]);
    py = v;
  }
  b.W([
    [XR, py],
    [XR, yB],
  ]);
  const xb = XL + 64;
  b.W([
    [xb, yB],
    [XL, yB],
  ]);
  b.W([
    [XR, yB],
    [xb + 10, yB],
  ]);
  const adj = new Map<string, { m: string; i: number; f: boolean }[]>();
  b.E.forEach((e, i) => {
    for (const [p, q, f] of [
      [e.u, e.v, true],
      [e.v, e.u, false],
    ] as const) {
      let l = adj.get(p);
      if (!l) {
        l = [];
        adj.set(p, l);
      }
      l.push({ m: q, i, f });
    }
  });
  return {
    E: b.E,
    D: b.D,
    src: N(xb, yB),
    sink: N(xb + 10, yB),
    bat: [xb, yB],
    cols,
    W: Math.max(XR + 14, cols * IN_COL + 24),
    H: yB + 40,
    top,
    adj,
  };
}

/** 接点の状態を返す関数（リレーか入力の id から） */
export type Contacts = (r: string) => ContactState;

const okE = (e: Edge, cs: Contacts): boolean => e.k !== 'c' || cs(e.r)[e.t];

/** fwd: 電源から（負荷は左から右へだけ通る）。skip の辺は通らない */
function reach(G: Circuit, cs: Contacts, from: string, stop: string, fwd: boolean, skip: number): Set<string> {
  const s = new Set([from]),
    st = [from];
  while (st.length) {
    const n = st.pop() as string;
    if (n === stop) continue;
    for (const { m, i, f } of G.adj.get(n) ?? []) {
      if (i === skip || s.has(m)) continue;
      const e = G.E[i];
      if (e.k === 'load' && f !== fwd) continue;
      if (!okE(e, cs)) continue;
      s.add(m);
      st.push(m);
    }
  }
  return s;
}

/** 電流の流れる負荷の辺の添字（速い計算。コイルの入り切りと真理値表に使う） */
export function loadsOn(G: Circuit, cs: Contacts): Set<number> {
  const Sx = reach(G, cs, G.src, G.sink, true, -1),
    T = reach(G, cs, G.sink, G.src, false, -1);
  const on = new Set<number>();
  G.E.forEach((e, i) => {
    if (e.k === 'load' && Sx.has(e.u) && T.has(e.v)) on.add(i);
  });
  return on;
}

/**
 * 電流が通る辺すべて（図の色に使う）。辺を 1 本外して、電源側から一方の端へ・もう一方の端から − 側へ行けるなら通る。
 * 行き止まりの枝は通らない
 */
export function conduct(G: Circuit, cs: Contacts): Set<number> {
  const on = new Set<number>();
  if (!reach(G, cs, G.src, G.sink, true, -1).has(G.sink)) return on;
  G.E.forEach((e, i) => {
    if (!okE(e, cs)) return;
    const Sx = reach(G, cs, G.src, G.sink, true, i),
      T = reach(G, cs, G.sink, G.src, false, i);
    if ((Sx.has(e.u) && T.has(e.v)) || (e.k !== 'load' && Sx.has(e.v) && T.has(e.u))) on.add(i);
  });
  return on;
}

/** 理想の接点（入力の値だけで a・b が決まる）。真理値表に使う */
export const ideal =
  (v: Record<string, number>): Contacts =>
  (r) => {
    const on = !!v[r];
    return { a: on, b: !on, x: on ? 1 : 0 };
  };
