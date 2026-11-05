/** グラフベースの手法 */
import {
  ACC,
  compLabels,
  type Data,
  type Draft,
  d2,
  edgesSeg,
  finish,
  flat,
  gauss,
  INK,
  knnGraph,
  newLabels,
  type Params,
  type Run,
  range,
  rng,
  shuffle,
} from './core';

/* ---------- スペクトラル（Ng, Jordan & Weiss 2001） ---------- */
/** 実対称行列の固有値分解（Householder の三重対角化と QL 法。JAMA と同じ手順） */
export function eigh(A: Float64Array, n: number): { val: Float64Array; vec: Float64Array } {
  const V = Float64Array.from(A),
    dd = new Float64Array(n),
    e = new Float64Array(n);
  for (let j = 0; j < n; j++) dd[j] = V[(n - 1) * n + j];
  for (let i = n - 1; i > 0; i--) {
    let scale = 0,
      h = 0;
    for (let k = 0; k < i; k++) scale += Math.abs(dd[k]);
    if (scale === 0) {
      e[i] = dd[i - 1];
      for (let j = 0; j < i; j++) {
        dd[j] = V[(i - 1) * n + j];
        V[i * n + j] = 0;
        V[j * n + i] = 0;
      }
    } else {
      for (let k = 0; k < i; k++) {
        dd[k] /= scale;
        h += dd[k] * dd[k];
      }
      let f = dd[i - 1],
        g = Math.sqrt(h);
      if (f > 0) g = -g;
      e[i] = scale * g;
      h -= f * g;
      dd[i - 1] = f - g;
      for (let j = 0; j < i; j++) e[j] = 0;
      for (let j = 0; j < i; j++) {
        f = dd[j];
        V[j * n + i] = f;
        g = e[j] + V[j * n + j] * f;
        for (let k = j + 1; k <= i - 1; k++) {
          g += V[k * n + j] * dd[k];
          e[k] += V[k * n + j] * f;
        }
        e[j] = g;
      }
      f = 0;
      for (let j = 0; j < i; j++) {
        e[j] /= h;
        f += e[j] * dd[j];
      }
      const hh = f / (h + h);
      for (let j = 0; j < i; j++) e[j] -= hh * dd[j];
      for (let j = 0; j < i; j++) {
        f = dd[j];
        g = e[j];
        for (let k = j; k <= i - 1; k++) V[k * n + j] -= f * e[k] + g * dd[k];
        dd[j] = V[(i - 1) * n + j];
        V[i * n + j] = 0;
      }
    }
    dd[i] = h;
  }
  for (let i = 0; i < n - 1; i++) {
    V[(n - 1) * n + i] = V[i * n + i];
    V[i * n + i] = 1;
    const h = dd[i + 1];
    if (h !== 0) {
      for (let k = 0; k <= i; k++) dd[k] = V[k * n + i + 1] / h;
      for (let j = 0; j <= i; j++) {
        let g = 0;
        for (let k = 0; k <= i; k++) g += V[k * n + i + 1] * V[k * n + j];
        for (let k = 0; k <= i; k++) V[k * n + j] -= g * dd[k];
      }
    }
    for (let k = 0; k <= i; k++) V[k * n + i + 1] = 0;
  }
  for (let j = 0; j < n; j++) {
    dd[j] = V[(n - 1) * n + j];
    V[(n - 1) * n + j] = 0;
  }
  V[(n - 1) * n + n - 1] = 1;
  e[0] = 0;
  for (let i = 1; i < n; i++) e[i - 1] = e[i];
  e[n - 1] = 0;
  let f = 0,
    tst1 = 0;
  const eps = 2 ** -52;
  for (let l = 0; l < n; l++) {
    tst1 = Math.max(tst1, Math.abs(dd[l]) + Math.abs(e[l]));
    let m = l;
    while (m < n) {
      if (Math.abs(e[m]) <= eps * tst1) break;
      m++;
    }
    if (m > l) {
      let iter = 0;
      do {
        iter++;
        let g = dd[l],
          p = (dd[l + 1] - g) / (2 * e[l]),
          r = Math.hypot(p, 1);
        if (p < 0) r = -r;
        dd[l] = e[l] / (p + r);
        dd[l + 1] = e[l] * (p + r);
        const dl1 = dd[l + 1];
        let h = g - dd[l];
        for (let i = l + 2; i < n; i++) dd[i] -= h;
        f += h;
        p = dd[m];
        let c = 1,
          c2 = c,
          c3 = c;
        const el1 = e[l + 1];
        let s = 0,
          s2 = 0;
        for (let i = m - 1; i >= l; i--) {
          c3 = c2;
          c2 = c;
          s2 = s;
          g = c * e[i];
          h = c * p;
          r = Math.hypot(p, e[i]);
          e[i + 1] = s * r;
          s = e[i] / r;
          c = p / r;
          p = c * dd[i] - s * g;
          dd[i + 1] = h + s * (c * g + s * dd[i]);
          for (let k = 0; k < n; k++) {
            h = V[k * n + i + 1];
            V[k * n + i + 1] = s * V[k * n + i] + c * h;
            V[k * n + i] = c * V[k * n + i] - s * h;
          }
        }
        p = (-s * s2 * c3 * el1 * e[l]) / dl1;
        e[l] = s * p;
        dd[l] = c * p;
      } while (Math.abs(e[l]) > eps * tst1 && iter < 60);
    }
    dd[l] += f;
    e[l] = 0;
  }
  return { val: dd, vec: V };
}

export function spectral(d: Data, p: Params): Run {
  const n = d.n,
    k = p.k,
    nn = p.nn,
    r = rng(p.seed * 53 + 11),
    run: Draft = { frames: [], iters: 0, dist: n * n },
    W = new Float64Array(n * n).fill(1e-6),
    edges: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const o: [number, number][] = [];
    for (let j = 0; j < n; j++) if (j !== i) o.push([d2(d, i, j), j]);
    o.sort((a, b) => a[0] - b[0]);
    for (let q = 0; q < Math.min(nn, o.length); q++) {
      const j = o[q][1];
      if (W[i * n + j] < 1) {
        W[i * n + j] = 1;
        W[j * n + i] = 1;
        edges.push([i, j, o[q][0]]);
      }
    }
  }
  /* 全体の 1 割に満たない破片は最も近い点へつなぐ。破片が本物のクラスタに見えてしまうため */
  for (;;) {
    const comp = new Int32Array(n).fill(-1),
      sizes: number[] = [];
    for (let i = 0; i < n; i++) {
      if (comp[i] >= 0) continue;
      const c = sizes.length,
        st = [i];
      comp[i] = c;
      let sz = 0;
      while (st.length) {
        const v = st.pop() as number;
        sz++;
        for (let j = 0; j < n; j++)
          if (comp[j] < 0 && W[v * n + j] === 1) {
            comp[j] = c;
            st.push(j);
          }
      }
      sizes.push(sz);
    }
    const tiny = sizes.findIndex((v) => v < n * 0.1);
    if (tiny < 0 || sizes.length < 2) break;
    let bi = -1,
      bj = -1,
      bv = Infinity;
    for (let i = 0; i < n; i++)
      if (comp[i] === tiny)
        for (let j = 0; j < n; j++)
          if (comp[j] !== tiny) {
            const v = d2(d, i, j);
            if (v < bv) {
              bv = v;
              bi = i;
              bj = j;
            }
          }
    W[bi * n + bj] = 1;
    W[bj * n + bi] = 1;
    edges.push([bi, bj, bv]);
  }
  edges.sort((a, b) => a[2] - b[2]);
  const De = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    W[i * n + i] = 0;
    for (let j = 0; j < n; j++) De[i] += W[i * n + j];
  }
  const A = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) A[i * n + j] = W[i * n + j] / Math.sqrt(De[i] * De[j]);
  const { val, vec } = eigh(A, n),
    idx = range(n).sort((a, b) => val[b] - val[a]),
    /* 固有ベクトルを行ごとに正規化した k 次元の座標で k-means */
    Z = new Float64Array(n * k);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < k; c++) {
      const v = vec[i * n + idx[c]];
      Z[i * k + c] = v;
      s += v * v;
    }
    s = Math.sqrt(s) || 1;
    for (let c = 0; c < k; c++) Z[i * k + c] /= s;
  }
  let best: { lb: Int16Array; hist: Int16Array[] } | null = null,
    bs = Infinity;
  for (let tr = 0; tr < 6; tr++) {
    const C = new Float64Array(k * k),
      pick = [Math.floor(r() * n)];
    while (pick.length < k) {
      let far = 0,
        fv = -1;
      for (let i = 0; i < n; i++) {
        let m = Infinity;
        for (const q of pick) {
          let v = 0;
          for (let c = 0; c < k; c++) v += (Z[i * k + c] - Z[q * k + c]) ** 2;
          m = Math.min(m, v);
        }
        m *= 0.6 + r() * 0.4;
        if (m > fv) {
          fv = m;
          far = i;
        }
      }
      pick.push(far);
    }
    pick.forEach((q, a) => {
      for (let c = 0; c < k; c++) C[a * k + c] = Z[q * k + c];
    });
    const lb = new Int16Array(n),
      hist: Int16Array[] = [];
    let sse = 0;
    for (let it = 0; it < 30; it++) {
      let ch = 0;
      sse = 0;
      for (let i = 0; i < n; i++) {
        let b = 0,
          m = Infinity;
        for (let a = 0; a < k; a++) {
          let v = 0;
          for (let c = 0; c < k; c++) v += (Z[i * k + c] - C[a * k + c]) ** 2;
          if (v < m) {
            m = v;
            b = a;
          }
        }
        if (lb[i] !== b || it === 0) ch++;
        lb[i] = b;
        sse += m;
      }
      run.dist += n * k;
      hist.push(lb.slice());
      if (!ch) break;
      C.fill(0);
      const cnt = new Float64Array(k);
      for (let i = 0; i < n; i++) {
        cnt[lb[i]]++;
        for (let c = 0; c < k; c++) C[lb[i] * k + c] += Z[i * k + c];
      }
      for (let a = 0; a < k; a++) if (cnt[a]) for (let c = 0; c < k; c++) C[a * k + c] /= cnt[a];
    }
    if (sse < bs) {
      bs = sse;
      best = { lb, hist };
    }
  }
  const b = best as NonNullable<typeof best>,
    /* 図に出す 2 次元の座標: 第 2・第 3 固有ベクトル（D^-1/2 u） */
    ex = new Float64Array(n),
    ey = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const q = Math.sqrt(De[i]);
    ex[i] = vec[i * n + idx[1]] / q;
    ey[i] = n > 2 ? vec[i * n + idx[2]] / q : 0;
  }
  const stretch = (a: Float64Array, lo: number, hi: number): Float32Array => {
    const s = Array.from(a).sort((u, v) => u - v),
      mn = s[Math.floor(n * 0.005)],
      mx = s[Math.floor(n * 0.995)],
      w = mx - mn || 1;
    return Float32Array.from(a, (v) => lo + (hi - lo) * Math.min(1, Math.max(0, (v - mn) / w)));
  };
  const X = stretch(ex, 0.14, 1.46),
    Y = stretch(ey, 0.1, 0.9);
  /* 1 点に重なると点が消えて見えるので、図の座標にだけ小さな揺らぎを足す */
  for (let i = 0; i < n; i++) {
    X[i] += gauss(r) * 0.016;
    Y[i] += gauss(r) * 0.016;
  }
  const ox = Float32Array.from(d.x),
    oy = Float32Array.from(d.y),
    lerp = (e: number): [Float32Array, Float32Array] => [
      Float32Array.from(ox, (v, i) => v + (X[i] - v) * e),
      Float32Array.from(oy, (v, i) => v + (Y[i] - v) * e),
    ],
    G = 14,
    segOf = (m: number, a = 0.55) => [{ d: flat(d, edges.slice(0, m)), c: INK, w: 0.8, a }];
  run.frames.push({ st: 0, say: '近傍の接続前', ms: 500, x: ox, y: oy });
  for (let s = 1; s <= G; s++) {
    const m = Math.round((edges.length * s) / G);
    run.frames.push({
      st: 0,
      say: `近傍 ${nn} 個を接続　線 ${m} 本`,
      ms: s === G ? 700 : 70,
      x: ox,
      y: oy,
      seg: segOf(m),
    });
  }
  for (let s = 1; s <= 20; s++) {
    const u = s / 20,
      [a, c] = lerp(u * u * (3 - 2 * u));
    /* 移動中の線は点と一緒に動かす */
    const moved: number[] = [];
    if (u < 0.7) for (const [i, j] of edges) moved.push(a[i], c[i], a[j], c[j]);
    run.frames.push({
      st: 1,
      say: '固有ベクトルの座標へ移動',
      ms: s === 20 ? 800 : 55,
      x: a,
      y: c,
      seg: moved.length ? [{ d: moved, c: INK, w: 0.8, a: 0.55 * (1 - u) }] : undefined,
      ax: u,
    });
  }
  b.hist.forEach((lb, it) => {
    run.frames.push({ st: 2, say: `新しい座標で k-means　${it + 1} 回目`, ms: 480, x: X, y: Y, l: lb, ax: 1 });
  });
  for (let s = 1; s <= 20; s++) {
    const u = s / 20,
      [a, c] = lerp(1 - u * u * (3 - 2 * u));
    run.frames.push({
      st: 3,
      say: s === 20 ? `完了　クラスタ ${k} 個` : '元の位置へ',
      ms: s === 20 ? 1000 : 55,
      x: a,
      y: c,
      l: b.lb,
      ax: 1 - u,
    });
  }
  run.iters = b.hist.length;
  return finish(run, d, b.lb);
}

/* ---------- Affinity Propagation（Frey & Dueck 2007） ---------- */
export function affinity(d: Data, p: Params): Run {
  const n = d.n,
    S = new Float64Array(n * n),
    vals: number[] = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      if (i !== j) {
        S[i * n + j] = -d2(d, i, j);
        vals.push(S[i * n + j]);
      }
  vals.sort((a, b) => a - b);
  const pref = vals[vals.length >> 1] * p.pref;
  for (let i = 0; i < n; i++) S[i * n + i] = pref;
  const R = new Float64Array(n * n),
    A = new Float64Array(n * n),
    damp = 0.75,
    run: Draft = { frames: [], iters: 0, dist: n * n },
    labelNow = (): { ex: number[]; l: Int16Array } => {
      const ex: number[] = [];
      for (let i = 0; i < n; i++) if (R[i * n + i] + A[i * n + i] > 0) ex.push(i);
      if (!ex.length) return { ex, l: newLabels(n) };
      const l = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        let b = 0,
          v = -Infinity;
        ex.forEach((e, q) => {
          if (S[i * n + e] > v) {
            v = S[i * n + e];
            b = q;
          }
        });
        l[i] = b;
      }
      ex.forEach((e, q) => {
        l[e] = q;
      });
      return { ex, l };
    };
  run.frames.push({ st: 0, say: '全点が代表点の候補', ms: 800 });
  let prev = '',
    stable = 0,
    now = labelNow();
  for (let it = 1; it <= p.aiter; it++) {
    for (let i = 0; i < n; i++) {
      let m1 = -Infinity,
        m2 = -Infinity,
        bk = 0;
      for (let k = 0; k < n; k++) {
        const v = A[i * n + k] + S[i * n + k];
        if (v > m1) {
          m2 = m1;
          m1 = v;
          bk = k;
        } else if (v > m2) m2 = v;
      }
      for (let k = 0; k < n; k++)
        R[i * n + k] = damp * R[i * n + k] + (1 - damp) * (S[i * n + k] - (k === bk ? m2 : m1));
    }
    for (let k = 0; k < n; k++) {
      let s = 0;
      for (let i = 0; i < n; i++) if (i !== k) s += Math.max(0, R[i * n + k]);
      const rkk = R[k * n + k];
      for (let i = 0; i < n; i++) {
        const v = i === k ? s : Math.min(0, rkk + s - Math.max(0, R[i * n + k]));
        A[i * n + k] = damp * A[i * n + k] + (1 - damp) * v;
      }
    }
    run.iters = it;
    now = labelNow();
    const key = now.ex.join();
    stable = key === prev && now.ex.length ? stable + 1 : 0;
    prev = key;
    if (it <= 40 ? it % 2 === 0 : it % 5 === 0) {
      const { ex, l } = now,
        s: number[] = [];
      if (ex.length) for (let i = 0; i < n; i++) s.push(d.x[i], d.y[i], d.x[ex[l[i]]], d.y[ex[l[i]]]);
      run.frames.push({
        st: 1,
        say: `${it} 回目のメッセージ交換　代表点 ${ex.length} 個`,
        ms: 90,
        l,
        seg: s.length ? [{ d: s, c: INK, w: 0.5 }] : undefined,
        cen: ex.map((e, q) => ({ x: d.x[e], y: d.y[e], c: q, t: 'ring' as const })),
      });
    }
    if (stable >= 15) break;
  }
  let { ex, l } = now;
  if (!ex.length) {
    /* 収束しなかったときは最も良い 1 点へ */
    let b = 0,
      v = -Infinity;
    for (let i = 0; i < n; i++)
      if (R[i * n + i] + A[i * n + i] > v) {
        v = R[i * n + i] + A[i * n + i];
        b = i;
      }
    ex = [b];
    l = new Int16Array(n);
  }
  const s: number[] = [];
  for (let i = 0; i < n; i++) s.push(d.x[i], d.y[i], d.x[ex[l[i]]], d.y[ex[l[i]]]);
  run.frames.push({
    st: 2,
    say: `代表点 ${ex.length} 個で完了`,
    ms: 1000,
    l,
    seg: [{ d: s, c: INK, w: 0.5 }],
    cen: ex.map((e, q) => ({ x: d.x[e], y: d.y[e], c: q, t: 'ring' as const })),
  });
  return finish(run, d, l);
}

/* ---------- 最小全域木（Prim） ---------- */
export function prim(n: number, w: (a: number, b: number) => number): [number, number, number][] {
  const inT = new Uint8Array(n),
    best = new Float64Array(n).fill(Infinity),
    par = new Int32Array(n).fill(-1),
    edges: [number, number, number][] = [];
  best[0] = 0;
  for (let s = 0; s < n; s++) {
    let u = -1,
      v = Infinity;
    for (let i = 0; i < n; i++)
      if (!inT[i] && best[i] < v) {
        v = best[i];
        u = i;
      }
    inT[u] = 1;
    if (par[u] >= 0) edges.push([par[u], u, v]);
    for (let i = 0; i < n; i++) {
      if (inT[i]) continue;
      const q = w(u, i);
      if (q < best[i]) {
        best[i] = q;
        par[i] = u;
      }
    }
  }
  return edges;
}
/* Zahn 1971 の、長い辺を切って分ける考え方 */
export function mstCut(d: Data, p: Params): Run {
  const n = d.n,
    run: Draft = { frames: [], iters: p.k - 1, dist: (n * (n - 1)) / 2 },
    edges = prim(n, (a, b) => Math.sqrt(d2(d, a, b))),
    step = Math.max(1, Math.floor(n / 100));
  run.frames.push({ st: 0, say: '1 点から開始', ms: 500 });
  for (let e = step; e <= edges.length; e += step)
    run.frames.push({ st: 1, say: `辺 ${e} 本`, ms: 26, seg: [{ d: flat(d, edges.slice(0, e)), c: INK, w: 1.2 }] });
  const sorted = edges.slice().sort((a, b) => b[2] - a[2]),
    kept = new Set(edges);
  for (let q = 0; q < p.k - 1 && q < sorted.length; q++) {
    const e = sorted[q];
    kept.delete(e);
    run.frames.push({
      st: 2,
      say: `${q + 1} 本目の切断　長さ ${e[2].toFixed(3)}`,
      ms: 700,
      l: compLabels(n, [...kept]),
      seg: [
        { d: flat(d, [...kept]), c: INK, w: 1.2 },
        { d: flat(d, [e]), c: ACC, w: 2.6 },
      ],
    });
  }
  const l = compLabels(n, [...kept]);
  run.frames.push({
    st: 3,
    say: `クラスタ ${p.k} 個で完了`,
    ms: 1000,
    l,
    seg: [{ d: flat(d, [...kept]), c: INK, w: 1.2 }],
  });
  return finish(run, d, l);
}

/* ---------- ラベル伝播（Raghavan ほか 2007） ---------- */
export function labelProp(d: Data, p: Params): Run {
  const n = d.n,
    adj = knnGraph(d, p.lnn),
    r = rng(p.seed * 73 + 43),
    l = Int16Array.from(range(n)),
    run: Draft = { frames: [], iters: 0, dist: n * n },
    edge = edgesSeg(d, adj);
  run.frames.push({ st: 0, say: '近傍を接続して各点に別々のラベルを付与', ms: 800, l: l.slice(), seg: [edge] });
  for (let it = 1; it <= 30; it++) {
    let ch = 0;
    for (const i of shuffle(range(n), r)) {
      const c = new Map<number, number>();
      for (const j of adj[i]) c.set(l[j], (c.get(l[j]) ?? 0) + 1);
      let best: number[] = [],
        v = 0;
      for (const [q, m] of c) {
        if (m > v) {
          v = m;
          best = [q];
        } else if (m === v) best.push(q);
      }
      if (best.length && !best.includes(l[i])) {
        l[i] = best[Math.floor(r() * best.length)];
        ch++;
      }
    }
    run.iters = it;
    run.frames.push({ st: 1, say: `${it} 回目の更新　${ch} 点が変化`, ms: 420, l: l.slice(), seg: [edge] });
    if (!ch) break;
  }
  run.frames.push({ st: 2, say: `ラベル ${new Set(l).size} 種で完了`, ms: 1000, l: l.slice(), seg: [edge] });
  return finish(run, d, l.slice());
}

/* ---------- Markov Clustering（van Dongen 2000） ---------- */
export function mcl(d: Data, p: Params): Run {
  const n = d.n,
    adj = knnGraph(d, p.mnn),
    run: Draft = { frames: [], iters: 0, dist: n * n },
    norm = (c: Map<number, number>): void => {
      let s = 0;
      for (const v of c.values()) s += v;
      for (const [k, v] of c) c.set(k, v / s);
    };
  let M = range(n).map((j) => {
    const c = new Map<number, number>([[j, 1]]);
    for (const i of adj[j]) c.set(i, 1);
    norm(c);
    return c;
  });
  const flows = (): number[] => {
      const s: number[] = [];
      M.forEach((c, j) => {
        for (const [i, v] of c) if (i !== j && v > 0.08) s.push(d.x[i], d.y[i], d.x[j], d.y[j]);
      });
      return s;
    },
    lab = (): Int16Array => {
      const edges: [number, number][] = [];
      M.forEach((c, j) => {
        let b = j,
          v = -1;
        for (const [i, w] of c)
          if (w > v) {
            v = w;
            b = i;
          }
        edges.push([j, b]);
      });
      return compLabels(n, edges);
    };
  run.frames.push({ st: 0, say: '近傍の間の遷移確率を配置', ms: 800, seg: [{ d: flows(), c: INK, w: 0.7 }] });
  let l = lab();
  for (let it = 1; it <= 30; it++) {
    const X = range(n).map((j) => {
      const t = new Map<number, number>();
      for (const [k, v] of M[j]) for (const [i, w] of M[k]) t.set(i, (t.get(i) ?? 0) + w * v);
      return t;
    });
    let mx = 0;
    const E = X.map((t, j) => {
      const e = new Map<number, number>();
      for (const [i, v] of t) {
        const q = v ** p.infl;
        if (q > 2e-3) e.set(i, q);
      }
      norm(e);
      for (const [i, v] of e) mx = Math.max(mx, Math.abs(v - (M[j].get(i) ?? 0)));
      return e;
    });
    M = E;
    run.iters = it;
    l = lab();
    run.frames.push({
      st: 1,
      say: `${it} 回目の拡張とインフレーション`,
      ms: 500,
      l,
      seg: [{ d: flows(), c: INK, w: 0.7 }],
    });
    if (mx < 1e-3) break;
  }
  run.frames.push({ st: 2, say: `流れが集まる点ごとに分割　${new Set(l).size} 個`, ms: 1000, l });
  return finish(run, d, l);
}

/* ---------- Louvain（Blondel ほか 2008） ---------- */
export function louvain(d: Data, p: Params): Run {
  const n = d.n,
    adj = knnGraph(d, p.nn),
    r = rng(p.seed * 79 + 47),
    res = p.res,
    run: Draft = { frames: [], iters: 0, dist: n * n },
    edge = edgesSeg(d, adj);
  let G = adj.map((s) => new Map<number, number>([...s].map((j) => [j, 1]))),
    own = Int16Array.from(range(n)),
    m2 = 0;
  for (const g of G) for (const w of g.values()) m2 += w;
  run.frames.push({ st: 0, say: '近傍を接続して各点を別々のコミュニティに', ms: 800, l: own.slice(), seg: [edge] });
  for (let level = 1; level <= 6; level++) {
    const N = G.length,
      com = range(N),
      /* 集約後の自己ループには両向きの重みが入っているので、そのまま足す */
      deg = G.map((g) => {
        let s = 0;
        for (const w of g.values()) s += w;
        return s;
      }),
      tot = deg.slice();
    let improved = false;
    for (let sweep = 1; sweep <= 12; sweep++) {
      let moved = 0;
      for (const i of shuffle(range(N), r)) {
        const nb = new Map<number, number>();
        for (const [j, w] of G[i]) if (j !== i) nb.set(com[j], (nb.get(com[j]) ?? 0) + w);
        const old = com[i];
        tot[old] -= deg[i];
        let best = old,
          gain = (nb.get(old) ?? 0) - (res * tot[old] * deg[i]) / m2;
        for (const [c, w] of nb) {
          const g = w - (res * tot[c] * deg[i]) / m2;
          if (g > gain + 1e-12) {
            gain = g;
            best = c;
          }
        }
        com[i] = best;
        tot[best] += deg[i];
        if (best !== old) {
          moved++;
          improved = true;
        }
      }
      run.iters++;
      run.frames.push({
        st: 1,
        say: `段階 ${level}　ノードの移動 ${moved} 個`,
        ms: 360,
        l: Int16Array.from(own, (v) => com[v]),
        seg: [edge],
      });
      if (!moved) break;
    }
    if (!improved) break;
    const id = new Map<number, number>();
    for (const c of com) if (!id.has(c)) id.set(c, id.size);
    own = Int16Array.from(own, (v) => id.get(com[v]) as number);
    const nG: Map<number, number>[] = Array.from({ length: id.size }, () => new Map());
    G.forEach((g, i) => {
      const a = id.get(com[i]) as number;
      for (const [j, w] of g) {
        const b = id.get(com[j]) as number;
        nG[a].set(b, (nG[a].get(b) ?? 0) + w);
      }
    });
    G = nG;
    run.frames.push({
      st: 2,
      say: `段階 ${level}　コミュニティ ${id.size} 個に集約`,
      ms: 700,
      l: own.slice(),
      seg: [edge],
    });
  }
  run.frames.push({ st: 3, say: `コミュニティ ${new Set(own).size} 個で完了`, ms: 1000, l: own.slice() });
  return finish(run, d, own.slice());
}
