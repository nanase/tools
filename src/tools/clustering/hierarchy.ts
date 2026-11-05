/** 階層の手法: 凝集型の 4 結合法・DIANA・BIRCH・CURE */
import {
  ACC,
  aligner,
  type Circ,
  type Data,
  type Draft,
  d2,
  finish,
  INK,
  type Merge,
  newLabels,
  type Params,
  type Run,
  range,
  rng,
  shuffle,
  wardWeighted,
} from './core';

export type Link = 'ward' | 'single' | 'complete' | 'average';

/* ---------- 凝集型（Lance-Williams の更新式） ---------- */
export function agglomerative(d: Data, p: Params, link: Link): Run {
  const n = d.n,
    k = Math.min(p.k, n),
    D = new Float64Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const v = d2(d, i, j),
        s = link === 'ward' ? v : Math.sqrt(v);
      D[i * n + j] = s;
      D[j * n + i] = s;
    }
  const size = new Int32Array(n).fill(1),
    alive = range(n),
    mem: (number[] | null)[] = range(n).map((i) => [i]),
    node = range(n),
    merges: Merge[] = [];
  for (let m = 0; m < n - 1; m++) {
    let bi = -1,
      bj = -1,
      bv = Infinity;
    for (let a = 0; a < alive.length; a++) {
      const i = alive[a];
      for (let b = a + 1; b < alive.length; b++) {
        const j = alive[b],
          v = D[i * n + j];
        if (v < bv) {
          bv = v;
          bi = i;
          bj = j;
        }
      }
    }
    /* 結合の線: 2 つのクラスタの間で最も近い 2 点 */
    const mi = mem[bi] as number[],
      mj = mem[bj] as number[];
    let pa = 0,
      pb = 0,
      pv = Infinity;
    for (const u of mi)
      for (const w of mj) {
        const v = d2(d, u, w);
        if (v < pv) {
          pv = v;
          pa = u;
          pb = w;
        }
      }
    const ni = size[bi],
      nj = size[bj];
    for (const q of alive) {
      if (q === bi || q === bj) continue;
      const nk = size[q],
        a = D[bi * n + q],
        b = D[bj * n + q],
        v =
          link === 'single'
            ? Math.min(a, b)
            : link === 'complete'
              ? Math.max(a, b)
              : link === 'average'
                ? (ni * a + nj * b) / (ni + nj)
                : ((ni + nk) * a + (nj + nk) * b - nk * bv) / (ni + nj + nk);
      D[bi * n + q] = v;
      D[q * n + bi] = v;
    }
    merges.push({ a: node[bi], b: node[bj], h: link === 'ward' ? Math.sqrt(Math.max(0, bv)) : bv, pa, pb });
    node[bi] = n + m;
    size[bi] = ni + nj;
    mi.push(...mj);
    mem[bj] = null;
    alive.splice(alive.indexOf(bj), 1);
  }
  /* 葉の順と節の位置 */
  const px = new Float64Array(2 * n - 1);
  let c = 0;
  const stack = [2 * n - 2];
  while (stack.length) {
    const v = stack.pop() as number;
    if (v < n) px[v] = c++;
    else stack.push(merges[v - n].b, merges[v - n].a);
  }
  for (let m = 0; m < n - 1; m++) px[n + m] = (px[merges[m].a] + px[merges[m].b]) / 2;
  /* k 個に切断したラベル */
  const uf = range(2 * n - 1),
    f = (x: number): number => {
      let v = x;
      while (uf[v] !== v) {
        uf[v] = uf[uf[v]];
        v = uf[v];
      }
      return v;
    };
  for (let m = 0; m < n - k; m++) {
    uf[merges[m].a] = n + m;
    uf[merges[m].b] = n + m;
  }
  const id = new Map<number, number>(),
    raw = Int16Array.from({ length: n }, (_, i) => {
      const r = f(i);
      if (!id.has(r)) id.set(r, id.size);
      return id.get(r) as number;
    });
  const run: Draft = { frames: [], iters: n - 1, dist: (n * (n - 1)) / 2 },
    step = Math.max(1, Math.floor(n / 200));
  for (let m = 0; ; m = Math.min(n - 1, m + step)) {
    const left = n - m;
    run.frames.push({
      st: m === 0 ? 0 : left > k ? 1 : 2,
      say: m === 0 ? `${n.toLocaleString('en-US')} 点がそれぞれ 1 つのクラスタ` : `${m} 回目の結合　残り ${left} 個`,
      ms: m === 0 ? 800 : left > k ? 26 : 16,
      m,
    });
    if (m === n - 1) break;
  }
  run.frames.push({ st: 3, say: `樹形図を切断　${k} 個のクラスタ`, ms: 1200, m: n - 1, done: true });
  const fa = aligner(d, raw),
    labels = Int16Array.from(raw, fa),
    /* 節のラベル: 切断より下の節は葉のラベル、上の節は −1 */
    nl = new Int16Array(2 * n - 1).fill(-1),
    joinAt = new Int32Array(n).fill(n);
  for (let i = 0; i < n; i++) nl[i] = labels[i];
  for (let m = 0; m < n - k; m++) nl[n + m] = nl[merges[m].a];
  merges.forEach((q, m) => {
    if (q.a < n) joinAt[q.a] = m;
    if (q.b < n) joinAt[q.b] = m;
  });
  run.side = { type: 'dendro', merges, px, hMax: merges[n - 2]?.h || 1, k, nl, joinAt };
  return finish(run, d, raw);
}

/* ---------- DIANA（Kaufman & Rousseeuw 1990） ---------- */
export function diana(d: Data, p: Params): Run {
  const n = d.n,
    run: Draft = { frames: [], iters: 0, dist: (n * (n - 1)) / 2 },
    l = new Int16Array(n),
    cl: number[][] = [range(n)];
  run.frames.push({ st: 0, say: '全点が 1 つのクラスタ', ms: 800, l: l.slice() });
  while (cl.length < p.k) {
    /* 直径が最大のクラスタを選ぶ */
    let w = 0,
      dm = -1,
      pa = 0,
      pb = 0;
    cl.forEach((m, c) => {
      for (let a = 0; a < m.length; a++)
        for (let b = a + 1; b < m.length; b++) {
          const q = d2(d, m[a], m[b]);
          if (q > dm) {
            dm = q;
            w = c;
            pa = m[a];
            pb = m[b];
          }
        }
    });
    const m = cl[w];
    if (m.length < 2) break;
    run.frames.push({
      st: 1,
      say: `直径が最大のクラスタ ${w + 1} を選択`,
      ms: 500,
      l: l.slice(),
      seg: [{ d: [d.x[pa], d.y[pa], d.x[pb], d.y[pb]], c: ACC, w: 2.4 }],
    });
    const avg = (i: number, g: readonly number[]): number => {
      let s = 0,
        q = 0;
      for (const j of g)
        if (j !== i) {
          s += Math.sqrt(d2(d, i, j));
          q++;
        }
      return q ? s / q : 0;
    };
    let first = m[0],
      v = -1;
    for (const i of m) {
      const a = avg(i, m);
      if (a > v) {
        v = a;
        first = i;
      }
    }
    const sp = [first],
      nc = cl.length;
    let rest = m.filter((i) => i !== first);
    l[first] = nc;
    run.frames.push({ st: 2, say: '平均距離が最大の点を分離', ms: 300, l: l.slice() });
    for (;;) {
      let bi = -1,
        bv = 0;
      for (const i of rest) {
        const q = avg(i, rest) - avg(i, sp);
        if (q > bv) {
          bv = q;
          bi = i;
        }
      }
      if (bi < 0 || rest.length < 2) break;
      sp.push(bi);
      rest = rest.filter((i) => i !== bi);
      l[bi] = nc;
      run.frames.push({ st: 2, say: `分離した点 ${sp.length} 個`, ms: 16, l: l.slice() });
    }
    cl[w] = rest;
    cl.push(sp);
    run.iters++;
  }
  run.frames.push({ st: 3, say: `クラスタ ${cl.length} 個で完了`, ms: 1000, l: l.slice() });
  return finish(run, d, l);
}

/* ---------- BIRCH（Zhang ほか 1996） ---------- */
/** CF: 点の数・座標の和・座標の 2 乗の和 */
interface CF {
  n: number;
  x: number;
  y: number;
  ss: number;
}
interface Node {
  leaf: boolean;
  ents: CF[];
  kids: Node[];
  parent: Node | null;
}
/** CF 木の枝分かれの数と葉の項目数の上限 */
export const BRANCH = 8;
const radius = (c: CF): number => Math.sqrt(Math.max(0, c.ss / c.n - (c.x * c.x + c.y * c.y) / (c.n * c.n)));
const addTo = (c: CF, x: number, y: number, s: number): void => {
  c.n++;
  c.x += x;
  c.y += y;
  c.ss += s;
};
const sumOf = (a: readonly CF[]): CF =>
  a.reduce((o, c) => ({ n: o.n + c.n, x: o.x + c.x, y: o.y + c.y, ss: o.ss + c.ss }), { n: 0, x: 0, y: 0, ss: 0 });
const cd = (a: CF, b: CF): number => (a.x / a.n - b.x / b.n) ** 2 + (a.y / a.n - b.y / b.n) ** 2;

export function birch(d: Data, p: Params): Run {
  const n = d.n,
    T = p.T,
    r = rng(p.seed * 61 + 31),
    run: Draft = { frames: [], iters: 0, dist: 0 },
    own: (CF | null)[] = new Array(n).fill(null),
    order = shuffle(range(n), r);
  let root: Node = { leaf: true, ents: [], kids: [], parent: null };
  const leaves = (): CF[] => {
    const out: CF[] = [],
      st = [root];
    while (st.length) {
      const v = st.pop() as Node;
      if (v.leaf) out.push(...v.ents);
      else st.push(...v.kids);
    }
    return out;
  };
  /** 最も遠い 2 項目を種にして 2 つへ分ける */
  const split = (nd: Node): void => {
    const E = nd.ents;
    let a = 0,
      b = 1,
      v = -1;
    for (let i = 0; i < E.length; i++)
      for (let j = i + 1; j < E.length; j++) {
        const q = cd(E[i], E[j]);
        if (q > v) {
          v = q;
          a = i;
          b = j;
        }
      }
    const one: number[] = [],
      two: number[] = [];
    E.forEach((c, i) => {
      (cd(c, E[a]) <= cd(c, E[b]) ? one : two).push(i);
    });
    const make = (ix: number[]): Node => {
      const m: Node = {
        leaf: nd.leaf,
        ents: ix.map((i) => E[i]),
        kids: nd.leaf ? [] : ix.map((i) => nd.kids[i]),
        parent: nd.parent,
      };
      for (const q of m.kids) q.parent = m;
      return m;
    };
    const A = make(one),
      B = make(two);
    if (!nd.parent) {
      root = { leaf: false, ents: [sumOf(A.ents), sumOf(B.ents)], kids: [A, B], parent: null };
      A.parent = root;
      B.parent = root;
      return;
    }
    const P = nd.parent,
      at = P.kids.indexOf(nd);
    P.kids.splice(at, 1, A, B);
    P.ents.splice(at, 1, sumOf(A.ents), sumOf(B.ents));
    if (P.ents.length > BRANCH) split(P);
  };
  const insert = (i: number): void => {
    const x = d.x[i],
      y = d.y[i],
      s = x * x + y * y,
      pc: CF = { n: 1, x, y, ss: s };
    let nd = root;
    const nearest = (E: readonly CF[]): number => {
      let b = -1,
        v = Infinity;
      E.forEach((c, q) => {
        const u = cd(c, pc);
        if (u < v) {
          v = u;
          b = q;
        }
      });
      run.dist += E.length;
      return b;
    };
    while (!nd.leaf) {
      const q = nearest(nd.ents);
      addTo(nd.ents[q], x, y, s);
      nd = nd.kids[q];
    }
    const q = nearest(nd.ents);
    if (q >= 0) {
      const c = nd.ents[q];
      if (radius({ n: c.n + 1, x: c.x + x, y: c.y + y, ss: c.ss + s }) <= T) {
        addTo(c, x, y, s);
        own[i] = c;
        return;
      }
    }
    nd.ents.push(pc);
    own[i] = pc;
    if (nd.ents.length > BRANCH) split(nd);
  };
  const circOf = (): Circ[] =>
    leaves().map((c) => ({ x: c.x / c.n, y: c.y / c.n, r: Math.max(0.006, radius(c)), c: INK }));
  const step = Math.max(1, Math.floor(n / 60));
  run.frames.push({ st: 0, say: '点を 1 個ずつ読み込み', ms: 600, l: newLabels(n) });
  order.forEach((i, q) => {
    insert(i);
    if (q % step === 0 || q === n - 1)
      run.frames.push({ st: 0, say: `${q + 1} 点を要約　CF ${leaves().length} 個`, ms: 50, circ: circOf() });
  });
  const cf = leaves();
  run.iters = cf.length;
  const lab = wardWeighted(
      cf.map((c) => c.x / c.n),
      cf.map((c) => c.y / c.n),
      cf.map((c) => c.n),
      p.k,
    ),
    ids = new Map(cf.map((c, e) => [c, e])),
    l = Int16Array.from(own, (c) => lab[ids.get(c as CF) as number]);
  run.frames.push({
    st: 1,
    say: `CF ${cf.length} 個を ${p.k} 個へ統合`,
    ms: 800,
    l,
    circ: cf.map((c, e) => ({ x: c.x / c.n, y: c.y / c.n, r: Math.max(0.006, radius(c)), c: lab[e] })),
  });
  run.frames.push({ st: 2, say: `クラスタ ${p.k} 個で完了`, ms: 1000, l });
  return finish(run, d, l);
}

/* ---------- CURE（Guha ほか 1998） ---------- */
export function cure(d: Data, p: Params): Run {
  const n = d.n,
    k = Math.min(p.k, n),
    C = p.reps,
    a = p.alpha,
    run: Draft = { frames: [], iters: n - k, dist: 0 };
  interface Cl {
    m: number[];
    rep: [number, number][];
    id: number;
  }
  let cl: Cl[] = range(n).map((i) => ({ m: [i], rep: [[d.x[i], d.y[i]]], id: i }));
  const repsOf = (m: readonly number[]): [number, number][] => {
    let mx = 0,
      my = 0;
    for (const i of m) {
      mx += d.x[i];
      my += d.y[i];
    }
    mx /= m.length;
    my /= m.length;
    let far = m[0],
      v = -1;
    for (const i of m) {
      const q = (d.x[i] - mx) ** 2 + (d.y[i] - my) ** 2;
      if (q > v) {
        v = q;
        far = i;
      }
    }
    const pick = [far];
    while (pick.length < Math.min(C, m.length)) {
      let b = m[0],
        w = -1;
      for (const i of m) {
        let u = Infinity;
        for (const q of pick) u = Math.min(u, d2(d, i, q));
        if (u > w) {
          w = u;
          b = i;
        }
      }
      pick.push(b);
    }
    return pick.map((i) => [d.x[i] + (mx - d.x[i]) * a, d.y[i] + (my - d.y[i]) * a]);
  };
  const rd = (A: Cl, B: Cl): number => {
    let v = Infinity;
    for (const u of A.rep) for (const w of B.rep) v = Math.min(v, (u[0] - w[0]) ** 2 + (u[1] - w[1]) ** 2);
    return v;
  };
  /* 結合で変わった行だけ距離を計算し直す */
  const D = new Map<number, number>(),
    key = (x: number, y: number): number => (x < y ? x * 100000 + y : y * 100000 + x);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) D.set(key(i, j), rd(cl[i], cl[j]));
  run.dist += (n * (n - 1)) / 2;
  const merges: { ia: number[]; ib: number[]; rep: [number, number][] }[] = [];
  let nid = n;
  while (cl.length > k) {
    let A = 0,
      B = 1,
      v = Infinity;
    for (let i = 0; i < cl.length; i++)
      for (let j = i + 1; j < cl.length; j++) {
        const q = D.get(key(cl[i].id, cl[j].id)) as number;
        if (q < v) {
          v = q;
          A = i;
          B = j;
        }
      }
    const m = cl[A].m.concat(cl[B].m),
      nc: Cl = { m, rep: repsOf(m), id: nid++ };
    merges.push({ ia: cl[A].m.slice(), ib: cl[B].m.slice(), rep: nc.rep });
    const rest = cl.filter((_, i) => i !== A && i !== B);
    for (const c of rest) {
      D.set(key(nc.id, c.id), rd(nc, c));
      run.dist += nc.rep.length * c.rep.length;
    }
    rest.push(nc);
    cl = rest;
  }
  const l = new Int16Array(n);
  cl.forEach((c, i) => {
    for (const v of c.m) l[v] = i;
  });
  const seen = new Uint8Array(n),
    step = Math.max(1, Math.floor(merges.length / 80));
  run.frames.push({ st: 0, say: '1 点ずつが別々のクラスタ', ms: 700, l: newLabels(n) });
  merges.forEach((q, j) => {
    for (const v of q.ia) seen[v] = 1;
    for (const v of q.ib) seen[v] = 1;
    if (j % step === 0 || j === merges.length - 1) {
      const left = n - j - 1;
      run.frames.push({
        st: 1,
        say: `${j + 1} 回目の結合　残り ${left} 個`,
        ms: left < 12 ? 300 : 40,
        l: Int16Array.from(l, (c, i) => (seen[i] ? c : -1)),
        cen: q.rep.map(([x, y]) => ({ x, y, c: l[q.ia[0]], t: 'small' })),
      });
    }
  });
  const all = cl.flatMap((c, i) => c.rep.map(([x, y]) => ({ x, y, c: i, t: 'small' as const })));
  run.frames.push({ st: 2, say: `代表点 ${all.length} 個　クラスタ ${k} 個で完了`, ms: 1000, l, cen: all });
  return finish(run, d, l);
}
