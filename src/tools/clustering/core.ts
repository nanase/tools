/**
 * クラスタリングの計算と図の間で使う型と共通の処理。計算は手順をコマ（Frame）として記録し、再生で 1 コマずつ図にする。
 * Worker から構造化複製で受け取るので、Run に関数を持たせない
 */

/** 色の番号。0〜7 はクラスタの色、8 以上と INK は画面の線の色、ACC はアクセント色 */
export const INK = -1;
export const ACC = -9;

export interface Data {
  id: string;
  n: number;
  x: Float64Array;
  y: Float64Array;
  /** 正解のラベル。外れ値は −1 */
  t: Int16Array;
  /** 正解のクラスタ数 */
  k: number;
  /** 正解がない（一様分布） */
  none: boolean;
}

export interface Seg {
  /** x0, y0, x1, y1, … */
  d: number[];
  c: number;
  w: number;
  /** 不透明度 */
  a?: number;
  /** 大きい図にだけ描く */
  big?: boolean;
}
export interface Circ {
  x: number;
  y: number;
  r: number;
  c: number;
  thin?: boolean;
}
export interface Ell {
  x: number;
  y: number;
  /** 共分散 sxx, sxy, syy */
  s: [number, number, number];
  c: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  c: number;
  /** 塗りの不透明度。ないときは枠線だけ */
  a?: number;
}
export interface Cen {
  x: number;
  y: number;
  c: number;
  t?: 'ring' | 'small';
}
/** 図の中の札（大きい図だけ）。dx・dy は点からのずれ [px]。ry があれば箱の座標でもずらす */
export interface Tag {
  x: number;
  y: number;
  s: string;
  c?: number;
  dx?: number;
  dy?: number;
  /** 箱の座標でのずれ（円や楕円の上に出す札） */
  ry?: number;
}
/** 点の種類: 1 大きい、2 小さい、3 ノイズ（×） */
export const BIG = 1;
export const SMALL = 2;
export const NOISE = 3;

export interface Frame {
  /** しくみの段階の番号 */
  st: number;
  say: string;
  ms: number;
  l?: Int16Array;
  kind?: Int8Array;
  /** 所属の確率。r[i * k + c] */
  soft?: { r: Float32Array; k: number };
  /** 点の位置を動かす手法の位置 */
  x?: Float32Array;
  y?: Float32Array;
  cen?: Cen[];
  seg?: Seg[];
  circ?: Circ[];
  ell?: Ell[];
  rect?: Rect[];
  tag?: Tag[];
  /** cen の重心の領域を塗る */
  reg?: boolean;
  /** 固有ベクトルの軸の札の濃さ */
  ax?: number;
  /** 階層: ここまでの結合の回数 */
  m?: number;
  /** 階層: 樹形図を切断した後 */
  done?: boolean;
  /** OPTICS: 処理した点の数 */
  pos?: number;
  /** Density Peaks: 中心を選んだ後 */
  pick?: boolean;
  /** 抽出した点だけで計算したとき、残りの点も含めて描く最後のコマ */
  all?: boolean;
}

export interface Merge {
  a: number;
  b: number;
  h: number;
  pa: number;
  pb: number;
}
export type Side =
  | { type: 'dendro'; merges: Merge[]; px: Float64Array; hMax: number; k: number; nl: Int16Array; joinAt: Int32Array }
  | { type: 'reach'; order: number[]; reach: number[]; cut: number }
  | { type: 'decision'; rho: Float64Array; delta: Float64Array; centers: number[]; cc: number[] };

export interface Run {
  frames: Frame[];
  labels: Int16Array;
  /** ノイズを除くクラスタの数 */
  nc: number;
  noise: number;
  /** 調整ランド指数。正解がなければ null */
  ari: number | null;
  iters: number;
  dist: number;
  /** 各コマの終わりの時刻 [ms] */
  t: number[];
  T: number;
  d: Data;
  sse?: number;
  ll?: number;
  side?: Side;
  /** soft の列の色の番号 */
  softC?: number[];
  /** 点を抽出して計算したときの全部の点。d は抽出した点、labels は全部の点のラベル */
  full?: Data;
  /** 抽出した点のラベル */
  subL?: Int16Array;
}

/** 計算の途中の Run。finish で仕上げる */
export type Draft = Pick<Run, 'frames' | 'iters' | 'dist'> & Partial<Pick<Run, 'sse' | 'll' | 'side'>>;

/** 数値だけのパラメータ。選択肢も番号で持つ */
export type Params = Record<string, number>;

/* ---------- 乱数 ---------- */
/** mulberry32 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const gauss = (r: () => number): number => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
export function shuffle<T>(a: T[], r: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/* ---------- 距離 ---------- */
export const d2 = (d: Data, i: number, j: number): number => (d.x[i] - d.x[j]) ** 2 + (d.y[i] - d.y[j]) ** 2;
export function nearestC(d: Data, i: number, cx: readonly number[], cy: readonly number[]): number {
  let b = 0,
    v = Infinity;
  for (let c = 0; c < cx.length; c++) {
    const q = (d.x[i] - cx[c]) ** 2 + (d.y[i] - cy[c]) ** 2;
    if (q < v) {
      v = q;
      b = c;
    }
  }
  return b;
}
export const assignAll = (d: Data, cx: readonly number[], cy: readonly number[]): Int16Array =>
  Int16Array.from({ length: d.n }, (_, i) => nearestC(d, i, cx, cy));
export const newLabels = (n: number): Int16Array => new Int16Array(n).fill(-1);
export const cens = (cx: readonly number[], cy: readonly number[], t?: Cen['t']): Cen[] =>
  cx.map((x, c) => ({ x, y: cy[c], c, t }));
export const flat = (d: Data, edges: readonly (readonly number[])[]): number[] => {
  const s: number[] = [];
  for (const [a, b] of edges) s.push(d.x[a], d.y[a], d.x[b], d.y[b]);
  return s;
};
/** 重心の軌跡 */
export const trails = (hist: readonly (readonly (readonly [number, number])[])[]): Seg[] =>
  hist.map((h) => {
    const s: number[] = [];
    for (let i = 1; i < h.length; i++) s.push(h[i - 1][0], h[i - 1][1], h[i][0], h[i][1]);
    return { d: s, c: INK, w: 1.4, big: true };
  });

/** k-means++ の重み付きの選び方で重心を選ぶ。pp が false なら点からランダムに選ぶ */
export function initCenters(d: Data, k: number, pp: boolean, r: () => number): [number[], number[]] {
  const cx: number[] = [],
    cy: number[] = [];
  if (!pp) {
    const ix = new Set<number>();
    while (ix.size < Math.min(k, d.n)) ix.add(Math.floor(r() * d.n));
    for (const i of ix) {
      cx.push(d.x[i]);
      cy.push(d.y[i]);
    }
    return [cx, cy];
  }
  const f = Math.floor(r() * d.n);
  cx.push(d.x[f]);
  cy.push(d.y[f]);
  while (cx.length < k) {
    let s = 0;
    const w = new Float64Array(d.n);
    for (let i = 0; i < d.n; i++) {
      let m = Infinity;
      for (let c = 0; c < cx.length; c++) m = Math.min(m, (d.x[i] - cx[c]) ** 2 + (d.y[i] - cy[c]) ** 2);
      w[i] = m;
      s += m;
    }
    let u = r() * s,
      j = 0;
    for (; j < d.n - 1; j++) {
      u -= w[j];
      if (u <= 0) break;
    }
    cx.push(d.x[j]);
    cy.push(d.y[j]);
  }
  return [cx, cy];
}

/** 無向の k 近傍グラフ */
export function knnGraph(d: Data, k: number): Set<number>[] {
  const n = d.n,
    adj = Array.from({ length: n }, () => new Set<number>()),
    K = Math.min(k, n - 1),
    bd = new Float64Array(K),
    bi = new Int32Array(K);
  for (let i = 0; i < n; i++) {
    /* 全部を並べ替えず、近い順の K 個だけ保つ */
    let c = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const v = d2(d, i, j);
      if (c === K && v >= bd[K - 1]) continue;
      let q = c < K ? c++ : K - 1;
      while (q > 0 && bd[q - 1] > v) {
        bd[q] = bd[q - 1];
        bi[q] = bi[q - 1];
        q--;
      }
      bd[q] = v;
      bi[q] = j;
    }
    for (let q = 0; q < c; q++) {
      adj[i].add(bi[q]);
      adj[bi[q]].add(i);
    }
  }
  return adj;
}
export function edgesSeg(d: Data, adj: readonly Set<number>[]): Seg {
  const s: number[] = [];
  adj.forEach((set, i) => {
    for (const j of set) if (i < j) s.push(d.x[i], d.y[i], d.x[j], d.y[j]);
  });
  return { d: s, c: INK, w: 0.7 };
}
/** 連結成分ごとのラベル */
export function compLabels(n: number, edges: readonly (readonly number[])[]): Int16Array {
  const uf = range(n),
    f = (x: number): number => {
      let v = x;
      while (uf[v] !== v) {
        uf[v] = uf[uf[v]];
        v = uf[v];
      }
      return v;
    };
  for (const [a, b] of edges) uf[f(a)] = f(b);
  const id = new Map<number, number>();
  return Int16Array.from({ length: n }, (_, i) => {
    const r = f(i);
    if (!id.has(r)) id.set(r, id.size);
    return id.get(r) as number;
  });
}
/** 重みつきの点をウォード法で k 個にまとめる（BIRCH・自己組織化マップ・Neural Gas の最後の段階） */
export function wardWeighted(
  xs: readonly number[],
  ys: readonly number[],
  ws: readonly number[],
  k: number,
): Int16Array {
  const cl = xs.map((x, i) => ({ x, y: ys[i], w: Math.max(ws[i], 1e-6), m: [i] }));
  while (cl.length > Math.max(1, k)) {
    let a = 0,
      b = 1,
      v = Infinity;
    for (let i = 0; i < cl.length; i++)
      for (let j = i + 1; j < cl.length; j++) {
        const A = cl[i],
          B = cl[j],
          q = ((A.w * B.w) / (A.w + B.w)) * ((A.x - B.x) ** 2 + (A.y - B.y) ** 2);
        if (q < v) {
          v = q;
          a = i;
          b = j;
        }
      }
    const A = cl[a],
      B = cl[b],
      w = A.w + B.w;
    cl[a] = { x: (A.x * A.w + B.x * B.w) / w, y: (A.y * A.w + B.y * B.w) / w, w, m: A.m.concat(B.m) };
    cl.splice(b, 1);
  }
  const lab = new Int16Array(xs.length);
  cl.forEach((c, i) => {
    for (const v of c.m) lab[v] = i;
  });
  return lab;
}
export function argmaxSoft(r: Float32Array, n: number, k: number): Int16Array {
  const l = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    let b = 0,
      v = -1;
    for (let c = 0; c < k; c++)
      if (r[i * k + c] > v) {
        v = r[i * k + c];
        b = c;
      }
    l[i] = b;
  }
  return l;
}

/* ---------- 評価 ---------- */
/** 調整ランド指数（Hubert & Arabie 1985）。正解の外れ値は除き、ノイズの点は 1 点ずつ別のクラスタとして数える */
export function ari(t: ArrayLike<number>, l: ArrayLike<number>): number {
  let n = 0;
  const tm = new Map<number, number>(),
    lm = new Map<string, number>(),
    cm = new Map<string, number>(),
    c2 = (x: number) => (x * (x - 1)) / 2;
  for (let i = 0; i < t.length; i++) {
    if (t[i] < 0) continue;
    n++;
    const b = l[i] < 0 ? `n${i}` : String(l[i]),
      c = `${t[i]}|${b}`;
    tm.set(t[i], (tm.get(t[i]) ?? 0) + 1);
    lm.set(b, (lm.get(b) ?? 0) + 1);
    cm.set(c, (cm.get(c) ?? 0) + 1);
  }
  let s = 0,
    a = 0,
    b = 0;
  for (const v of cm.values()) s += c2(v);
  for (const v of tm.values()) a += c2(v);
  for (const v of lm.values()) b += c2(v);
  const e = (a * b) / c2(n),
    mx = (a + b) / 2;
  return mx === e ? 1 : (s - e) / (mx - e);
}

/**
 * クラスタの番号を色の番号へ移す表。大きいクラスタから順に、最も重なる正解の番号を取る。
 * 手法とデータをまたいで同じまとまりが同じ色になるので、並べて比べやすい
 */
export function aligner(d: Data, l: ArrayLike<number>): (c: number) => number {
  const size = new Map<number, number>();
  for (let i = 0; i < d.n; i++) if (l[i] >= 0) size.set(l[i], (size.get(l[i]) ?? 0) + 1);
  const order = [...size.keys()].sort((a, b) => (size.get(b) as number) - (size.get(a) as number)),
    used = new Set<number>(),
    map = new Map<number, number>();
  for (const c of order) {
    const v = new Map<number, number>();
    for (let i = 0; i < d.n; i++) if (l[i] === c && d.t[i] >= 0) v.set(d.t[i], (v.get(d.t[i]) ?? 0) + 1);
    let best = -1,
      bv = 0;
    for (const [t, m] of v)
      if (!used.has(t) && m > bv) {
        best = t;
        bv = m;
      }
    if (best >= 0) {
      map.set(c, best);
      used.add(best);
    }
  }
  let next = 0;
  for (const c of order) {
    if (map.has(c)) continue;
    while (used.has(next)) next++;
    map.set(c, next);
    used.add(next);
  }
  /* 途中で消えたクラスタは色なし（8 以上は画面の線の色） */
  return (c) => (c < 0 ? c : (map.get(c) ?? 99));
}

/** 手順の記録を仕上げる: クラスタの番号を色の番号へ移し、評価と時刻を入れる */
export function finish(run: Draft, d: Data, raw: ArrayLike<number>): Run {
  const f = aligner(d, raw),
    labels = Int16Array.from(raw, f),
    done = new WeakSet<object>(),
    /* 同じ部品を複数のコマで共有しているので、1 度だけ移す */
    mapC = (o: { c: number }) => {
      if (done.has(o)) return;
      done.add(o);
      o.c = f(o.c);
    };
  let softK = 0;
  for (const fr of run.frames) {
    if (fr.l && !done.has(fr.l)) {
      done.add(fr.l);
      for (let i = 0; i < fr.l.length; i++) fr.l[i] = f(fr.l[i]);
    }
    for (const list of [fr.cen, fr.seg, fr.circ, fr.ell, fr.rect, fr.tag])
      for (const o of list ?? []) if ('c' in o && o.c !== undefined) mapC(o as { c: number });
    if (fr.soft) softK = fr.soft.k;
  }
  const seen = new Set<number>();
  let noise = 0;
  for (const v of labels) {
    if (v < 0) noise++;
    else seen.add(v);
  }
  let t = 0;
  const times = run.frames.map((fr) => {
    t += fr.ms;
    return t;
  });
  return {
    ...run,
    labels,
    nc: seen.size,
    noise,
    ari: d.none ? null : ari(d.t, labels),
    t: times,
    T: t,
    d,
    softC: softK ? range(softK).map(f) : undefined,
  };
}

/** 時刻 ms のコマ */
export function frameAt(r: Pick<Run, 't'>, ms: number): number {
  let lo = 0,
    hi = r.t.length - 1;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (r.t[m] <= ms) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** コマを max 個まで間引く（一覧の小さい図用）。段階の最初と最後は残し、間引いた時間は次のコマへ足す */
export function thin(run: Run, max: number): Run {
  const F = run.frames,
    n = F.length;
  if (n <= max) return run;
  const keep = new Set<number>();
  for (let i = 0; i < n; i++)
    if (i === 0 || i === n - 1 || F[i].st !== F[i - 1].st || F[i].st !== F[i + 1]?.st) keep.add(i);
  const room = Math.max(1, max - keep.size);
  for (let i = 0; i < room; i++) keep.add(Math.round(((i + 0.5) / room) * (n - 1)));
  const out: Frame[] = [];
  let acc = 0;
  F.forEach((fr, i) => {
    acc += fr.ms;
    if (keep.has(i)) {
      out.push({ ...fr, ms: acc });
      acc = 0;
    }
  });
  let t = 0;
  return {
    ...run,
    frames: out,
    t: out.map((fr) => {
      t += fr.ms;
      return t;
    }),
    T: t,
  };
}

/** 再生の長さを maxMs までに縮める（点が多いと手順が増えて長くなるため） */
export function fitTime(run: Run, maxMs: number): Run {
  if (run.T <= maxMs) return run;
  const k = maxMs / run.T;
  let t = 0;
  const frames = run.frames.map((fr) => ({ ...fr, ms: fr.ms * k }));
  return {
    ...run,
    frames,
    t: frames.map((fr) => {
      t += fr.ms;
      return t;
    }),
    T: t,
  };
}

/** k-means の領域の境界: 2 つの重心の垂直二等分線のうち、ほかの重心より近い部分。x0, y0, x1, y1 の列 */
export function bisectors(
  cen: readonly { x: number; y: number }[],
  box: { x0: number; y0: number; x1: number; y1: number },
): number[] {
  const out: number[] = [];
  for (let i = 0; i < cen.length; i++)
    for (let j = i + 1; j < cen.length; j++) {
      const a = cen[i],
        b = cen[j],
        mx = (a.x + b.x) / 2,
        my = (a.y + b.y) / 2,
        dx = -(b.y - a.y),
        dy = b.x - a.x;
      if (!dx && !dy) continue;
      let t0 = -Infinity,
        t1 = Infinity;
      /* nx x + ny y <= c の半平面で切る */
      const cut = (nx: number, ny: number, c: number): void => {
        const f = nx * dx + ny * dy,
          g = c - (nx * mx + ny * my);
        if (Math.abs(f) < 1e-12) {
          if (g < 0) t1 = -Infinity;
        } else if (f > 0) t1 = Math.min(t1, g / f);
        else t0 = Math.max(t0, g / f);
      };
      cut(1, 0, box.x1);
      cut(-1, 0, -box.x0);
      cut(0, 1, box.y1);
      cut(0, -1, -box.y0);
      cen.forEach((q, k) => {
        if (k !== i && k !== j) cut(q.x - a.x, q.y - a.y, (q.x * q.x + q.y * q.y - a.x * a.x - a.y * a.y) / 2);
      });
      if (t0 < t1) out.push(mx + t0 * dx, my + t0 * dy, mx + t1 * dx, my + t1 * dy);
    }
  return out;
}
