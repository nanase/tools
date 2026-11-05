/** ニューラルネットワークの手法とグリッドベースの手法 */
import {
  ACC,
  BIG,
  type Cen,
  compLabels,
  type Data,
  type Draft,
  finish,
  initCenters,
  NOISE,
  nearestC,
  type Params,
  type Rect,
  type Run,
  range,
  rng,
  type Seg,
  wardWeighted,
} from './core';
import { BOX } from './data';

const ownerAndHits = (d: Data, x: readonly number[], y: readonly number[]): [Int32Array, number[]] => {
  const own = Int32Array.from({ length: d.n }, (_, i) => nearestC(d, i, x, y)),
    hits = new Array<number>(x.length).fill(0);
  for (const a of own) hits[a]++;
  return [own, hits];
};

/* ---------- 自己組織化マップ（Kohonen 1982） ---------- */
export function som(d: Data, p: Params): Run {
  const n = d.n,
    gx = p.gx,
    gy = Math.max(2, Math.round(gx * 0.65)),
    M = gx * gy,
    r = rng(p.seed * 83 + 53),
    run: Draft = { frames: [], iters: 0, dist: 0 },
    x = new Array<number>(M).fill(0),
    y = new Array<number>(M).fill(0);
  for (let v = 0; v < gy; v++)
    for (let u = 0; u < gx; u++) {
      x[v * gx + u] = 0.55 + (u / (gx - 1)) * 0.5;
      y[v * gx + u] = 0.33 + (v / (gy - 1)) * 0.34;
    }
  const seg = (): Seg[] => {
      const s: number[] = [];
      for (let v = 0; v < gy; v++)
        for (let u = 0; u < gx; u++) {
          const a = v * gx + u;
          if (u + 1 < gx) s.push(x[a], y[a], x[a + 1], y[a + 1]);
          if (v + 1 < gy) s.push(x[a], y[a], x[a + gx], y[a + gx]);
        }
      return [{ d: s, c: ACC, w: 1.3 }];
    },
    nodes = (lab?: Int16Array): Cen[] => x.map((u, a) => ({ x: u, y: y[a], c: lab ? lab[a] : ACC, t: 'small' }));
  run.frames.push({ st: 0, say: `${gx} × ${gy} の格子を配置`, ms: 800, seg: seg(), cen: nodes() });
  const T = n * p.ep,
    sg0 = Math.max(gx, gy) / 2;
  for (let t = 0; t < T; t++) {
    const i = Math.floor(r() * n),
      u = t / T,
      sg = sg0 * (0.5 / sg0) ** u,
      lr = 0.5 * 0.04 ** u,
      b = nearestC(d, i, x, y),
      bu = b % gx,
      bv = Math.floor(b / gx);
    run.dist += M;
    for (let a = 0; a < M; a++) {
      const g = Math.exp(-(((a % gx) - bu) ** 2 + (Math.floor(a / gx) - bv) ** 2) / (2 * sg * sg)) * lr;
      x[a] += (d.x[i] - x[a]) * g;
      y[a] += (d.y[i] - y[a]) * g;
    }
    if (t % Math.ceil(T / 70) === 0)
      run.frames.push({
        st: 1,
        say: `学習 ${t + 1} / ${T} 回　近傍の幅 ${sg.toFixed(1)}`,
        ms: 60,
        seg: seg(),
        cen: nodes(),
      });
  }
  run.iters = T;
  const [own, hits] = ownerAndHits(d, x, y),
    lab = wardWeighted(x, y, hits, p.k),
    l = Int16Array.from(own, (a) => lab[a]);
  run.frames.push({ st: 2, say: `格子点を ${p.k} 個に統合`, ms: 1200, l, seg: seg(), cen: nodes(lab) });
  run.frames.push({ st: 3, say: `クラスタ ${p.k} 個で完了`, ms: 1000, l });
  return finish(run, d, l);
}

/* ---------- Neural Gas（Martinetz & Schulten 1991） ---------- */
export function neuralGas(d: Data, p: Params): Run {
  const n = d.n,
    M = Math.min(p.m, n),
    r = rng(p.seed * 89 + 59),
    run: Draft = { frames: [], iters: 0, dist: 0 },
    [x, y] = initCenters(d, M, false, r),
    T = n * p.ep,
    fr = Math.ceil(T / 70),
    nodes = (c?: Int16Array): Cen[] => x.map((u, a) => ({ x: u, y: y[a], c: c ? c[a] : ACC, t: 'small' }));
  run.frames.push({ st: 0, say: `ノード ${M} 個を配置`, ms: 800, cen: nodes() });
  for (let t = 0; t < T; t++) {
    const i = Math.floor(r() * n),
      u = t / T,
      lam = (M / 2) * (0.01 / (M / 2)) ** u,
      e = 0.5 * 0.02 ** u,
      ord = range(M).sort(
        (a, b) => (x[a] - d.x[i]) ** 2 + (y[a] - d.y[i]) ** 2 - ((x[b] - d.x[i]) ** 2 + (y[b] - d.y[i]) ** 2),
      );
    run.dist += M;
    ord.forEach((a, k) => {
      const g = e * Math.exp(-k / lam);
      x[a] += (d.x[i] - x[a]) * g;
      y[a] += (d.y[i] - y[a]) * g;
    });
    if (t % fr === 0) run.frames.push({ st: 1, say: `学習 ${t + 1} / ${T} 回　近さの順で移動`, ms: 60, cen: nodes() });
  }
  run.iters = T;
  const [own, hits] = ownerAndHits(d, x, y),
    lab = wardWeighted(x, y, hits, p.k),
    l = Int16Array.from(own, (a) => lab[a]);
  run.frames.push({ st: 2, say: `ノードを ${p.k} 個に統合`, ms: 1200, l, cen: nodes(lab) });
  run.frames.push({ st: 3, say: `クラスタ ${p.k} 個で完了`, ms: 1000, l });
  return finish(run, d, l);
}

/* ---------- Growing Neural Gas（Fritzke 1995） ---------- */
export function gng(d: Data, p: Params): Run {
  const n = d.n,
    r = rng(p.seed * 97 + 61),
    run: Draft = { frames: [], iters: 0, dist: 0 },
    eb = 0.05,
    en = 0.006,
    amax = 22,
    lambda = Math.max(30, Math.round(n / 3)),
    alpha = 0.5,
    beta = 0.0005,
    a0 = Math.floor(r() * n),
    b0 = Math.floor(r() * n);
  let N = [
    { x: d.x[a0], y: d.y[a0], err: 0 },
    { x: d.x[b0], y: d.y[b0], err: 0 },
  ];
  /* 辺の年齢。キーは小さい番号 × 1000 + 大きい番号 */
  let E = new Map<number, number>([[1, 0]]);
  const key = (a: number, b: number): number => (a < b ? a * 1000 + b : b * 1000 + a),
    ends = (k: number): [number, number] => [Math.floor(k / 1000), k % 1000],
    seg = (): Seg[] => {
      const s: number[] = [];
      for (const k of E.keys()) {
        const [a, b] = ends(k);
        s.push(N[a].x, N[a].y, N[b].x, N[b].y);
      }
      return [{ d: s, c: ACC, w: 1.4 }];
    },
    nodes = (): Cen[] => N.map((q) => ({ x: q.x, y: q.y, c: ACC, t: 'small' }));
  run.frames.push({ st: 0, say: 'ノード 2 個から開始', ms: 800, seg: seg(), cen: nodes() });
  const T = p.gmax * lambda * 2 + n,
    fr = Math.max(1, Math.ceil(T / 90));
  for (let t = 1; t <= T; t++) {
    const i = Math.floor(r() * n);
    let s1 = 0,
      s2 = 1,
      v1 = Infinity,
      v2 = Infinity;
    N.forEach((q, a) => {
      const u = (q.x - d.x[i]) ** 2 + (q.y - d.y[i]) ** 2;
      if (u < v1) {
        v2 = v1;
        s2 = s1;
        v1 = u;
        s1 = a;
      } else if (u < v2) {
        v2 = u;
        s2 = a;
      }
    });
    run.dist += N.length;
    N[s1].err += v1;
    N[s1].x += eb * (d.x[i] - N[s1].x);
    N[s1].y += eb * (d.y[i] - N[s1].y);
    for (const k of [...E.keys()]) {
      const [a, b] = ends(k);
      if (a === s1 || b === s1) {
        E.set(k, (E.get(k) as number) + 1);
        const o = a === s1 ? b : a;
        N[o].x += en * (d.x[i] - N[o].x);
        N[o].y += en * (d.y[i] - N[o].y);
      }
    }
    E.set(key(s1, s2), 0);
    let removed = false;
    for (const [k, age] of [...E])
      if (age > amax) {
        E.delete(k);
        removed = true;
      }
    if (removed && N.length > 2) {
      /* 辺のなくなったノードを除いて番号を詰める */
      const deg = new Int32Array(N.length);
      for (const k of E.keys()) {
        const [a, b] = ends(k);
        deg[a]++;
        deg[b]++;
      }
      if (deg.some((v) => !v)) {
        const map = new Int32Array(N.length).fill(-1),
          kept = N.flatMap((q, a) => (deg[a] ? [[q, a] as const] : []));
        if (kept.length >= 2) {
          kept.forEach(([, a], w) => {
            map[a] = w;
          });
          N = kept.map(([q]) => q);
          E = new Map([...E].map(([k, age]) => [key(map[ends(k)[0]], map[ends(k)[1]]), age]));
        }
      }
    }
    let added = false;
    if (t % lambda === 0 && N.length < p.gmax) {
      let q = 0;
      N.forEach((u, a) => {
        if (u.err > N[q].err) q = a;
      });
      let f = -1,
        fe = -1;
      for (const k of E.keys()) {
        const [a, b] = ends(k),
          o = a === q ? b : b === q ? a : -1;
        if (o >= 0 && N[o].err > fe) {
          fe = N[o].err;
          f = o;
        }
      }
      if (f >= 0) {
        const w = N.length;
        N.push({ x: (N[q].x + N[f].x) / 2, y: (N[q].y + N[f].y) / 2, err: 0 });
        E.delete(key(q, f));
        E.set(key(q, w), 0);
        E.set(key(f, w), 0);
        N[q].err *= alpha;
        N[f].err *= alpha;
        N[w].err = N[q].err;
        added = true;
      }
    }
    for (const u of N) u.err *= 1 - beta;
    if (added) run.frames.push({ st: 2, say: `ノードの追加　${N.length} 個`, ms: 120, seg: seg(), cen: nodes() });
    else if (t % fr === 0)
      run.frames.push({ st: 1, say: `学習 ${t} / ${T} 回　辺 ${E.size} 本`, ms: 40, seg: seg(), cen: nodes() });
  }
  run.iters = T;
  const edges = [...E.keys()].map(ends),
    comp = compLabels(N.length, edges),
    nx = N.map((q) => q.x),
    ny = N.map((q) => q.y),
    l = Int16Array.from({ length: n }, (_, i) => comp[nearestC(d, i, nx, ny)]);
  run.frames.push({
    st: 3,
    say: `つながりごとに分割　${new Set(l).size} 個`,
    ms: 1000,
    l,
    seg: seg(),
    cen: N.map((q, a) => ({ x: q.x, y: q.y, c: comp[a], t: 'small' })),
  });
  return finish(run, d, l);
}

/* ---------- CLIQUE（Agrawal ほか 1998）。2 次元だけを扱うので、部分空間の探索はない ---------- */
export function clique(d: Data, p: Params): Run {
  const n = d.n,
    s = p.cell,
    gx = Math.ceil(BOX.w / s),
    gy = Math.ceil(BOX.h / s),
    cnt = new Int32Array(gx * gy),
    cell = new Int32Array(n),
    tau = p.ctau,
    run: Draft = { frames: [], iters: 1, dist: n };
  for (let i = 0; i < n; i++) {
    const u = Math.min(gx - 1, Math.floor(d.x[i] / s)),
      v = Math.min(gy - 1, Math.floor(d.y[i] / s));
    cell[i] = v * gx + u;
    cnt[cell[i]]++;
  }
  const rects = (f: (a: number) => Pick<Rect, 'c' | 'a'> | null): Rect[] => {
    const a: Rect[] = [];
    for (let v = 0; v < gy; v++)
      for (let u = 0; u < gx; u++) {
        const q = f(v * gx + u);
        if (q) a.push({ x: u * s, y: v * s, w: s, h: s, ...q });
      }
    return a;
  };
  const mx = Math.max(...cnt);
  run.frames.push({ st: 0, say: `一辺 ${s.toFixed(3)} の格子に分割`, ms: 900, rect: rects(() => ({ c: -1 })) });
  run.frames.push({
    st: 1,
    say: 'セルごとに点を計数',
    ms: 900,
    rect: rects((a) => (cnt[a] ? { c: -1, a: 0.08 + (0.55 * cnt[a]) / mx } : { c: -1 })),
  });
  run.frames.push({
    st: 2,
    say: `${tau} 点以上を密なセルに`,
    ms: 900,
    rect: rects((a) => (cnt[a] >= tau ? { c: ACC, a: 0.28 } : { c: -1 })),
  });
  /* 隣接する密なセルをつなぐ */
  const cl = new Int32Array(gx * gy).fill(-1),
    cc: number[] = [];
  let id = 0;
  for (let a = 0; a < gx * gy; a++) {
    if (cnt[a] < tau || cl[a] >= 0) continue;
    const st = [a],
      cur = id++;
    cl[a] = cur;
    while (st.length) {
      const q = st.pop() as number,
        u = q % gx,
        v = Math.floor(q / gx);
      cc.push(q);
      for (const [e, f] of [
        [u - 1, v],
        [u + 1, v],
        [u, v - 1],
        [u, v + 1],
      ]) {
        if (e < 0 || f < 0 || e >= gx || f >= gy) continue;
        const w = f * gx + e;
        if (cnt[w] >= tau && cl[w] < 0) {
          cl[w] = cur;
          st.push(w);
        }
      }
    }
  }
  const l = Int16Array.from(cell, (a) => cl[a]),
    shown = new Uint8Array(gx * gy),
    step = Math.max(1, Math.floor(cc.length / 40));
  cc.forEach((a, q) => {
    shown[a] = 1;
    if (q % step === 0 || q === cc.length - 1)
      run.frames.push({
        st: 3,
        say: `隣接セルの連結　${q + 1} / ${cc.length} セル`,
        ms: 50,
        l: Int16Array.from(cell, (e) => (shown[e] ? cl[e] : -1)),
        rect: rects((e) => (shown[e] ? { c: cl[e], a: 0.25 } : cnt[e] >= tau ? { c: ACC, a: 0.28 } : null)),
      });
  });
  const kind = Int8Array.from(l, (v) => (v < 0 ? NOISE : BIG));
  run.frames.push({
    st: 3,
    say: `クラスタ ${id} 個で完了`,
    ms: 1000,
    l,
    kind,
    rect: rects((e) => (cl[e] >= 0 ? { c: cl[e], a: 0.25 } : null)),
  });
  return finish(run, d, l);
}
