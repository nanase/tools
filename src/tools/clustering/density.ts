/** 密度ベースの手法 */
import {
  ACC,
  BIG,
  type Cen,
  type Data,
  type Draft,
  d2,
  finish,
  flat,
  INK,
  NOISE,
  newLabels,
  type Params,
  type Run,
  range,
  rng,
  SMALL,
  shuffle,
} from './core';
import { prim } from './graph';

const noiseKind = (l: Int16Array): Int8Array => Int8Array.from(l, (v) => (v < 0 ? NOISE : 0));

/* ---------- DBSCAN（Ester ほか 1996） ---------- */
export function dbscan(d: Data, p: Params): Run {
  const n = d.n,
    eps2 = p.eps * p.eps,
    minPts = p.minPts,
    run: Draft = { frames: [], iters: 0, dist: n * (n - 1) },
    nb: number[][] = Array.from({ length: n }, () => []),
    r = rng(p.seed * 17 + 5);
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      if (d2(d, i, j) <= eps2) {
        nb[i].push(j);
        nb[j].push(i);
      }
  const l = newLabels(n),
    kind = new Int8Array(n),
    seen = new Uint8Array(n);
  let nc = 0;
  const snap = (st: number, cur: number, say: string, ms: number) => {
    run.frames.push({
      st,
      say,
      ms,
      l: l.slice(),
      kind: kind.slice(),
      circ: cur >= 0 ? [{ x: d.x[cur], y: d.y[cur], r: p.eps, c: ACC }] : undefined,
      seg:
        cur >= 0
          ? [{ d: nb[cur].flatMap((j) => [d.x[cur], d.y[cur], d.x[j], d.y[j]]), c: ACC, w: 0.8, big: true }]
          : undefined,
      tag: cur >= 0 ? [{ x: d.x[cur], y: d.y[cur], s: '半径 ε', c: ACC, ry: -p.eps, dy: -10 }] : undefined,
    });
  };
  snap(0, -1, '未確認の点から順に確認', 700);
  for (const s of shuffle(range(n), r)) {
    if (seen[s]) continue;
    seen[s] = 1;
    run.iters++;
    if (nb[s].length + 1 < minPts) {
      kind[s] = NOISE;
      snap(3, s, `近傍 ${nb[s].length + 1} 点　${minPts} 点未満でノイズ候補`, 40);
      continue;
    }
    const c = nc++;
    kind[s] = BIG;
    l[s] = c;
    snap(1, s, `近傍 ${nb[s].length + 1} 点　クラスタ ${c + 1} を開始`, 300);
    const q = nb[s].slice(),
      inQ = new Set(q);
    for (let h = 0; h < q.length; h++) {
      const v = q[h];
      if (l[v] < 0) {
        l[v] = c;
        if (kind[v] === NOISE || !kind[v]) kind[v] = SMALL;
      }
      if (seen[v]) continue;
      seen[v] = 1;
      run.iters++;
      if (nb[v].length + 1 >= minPts) {
        kind[v] = BIG;
        for (const w of nb[v])
          if (!seen[w] && !inQ.has(w)) {
            q.push(w);
            inQ.add(w);
          }
        snap(2, v, `クラスタ ${c + 1} を拡大　${q.length - h - 1} 点が待機中`, 22);
      } else {
        kind[v] = SMALL;
        snap(2, v, `境界点　クラスタ ${c + 1}`, 22);
      }
    }
  }
  let nz = 0;
  for (const v of l) if (v < 0) nz++;
  snap(4, -1, `クラスタ ${nc} 個　ノイズ ${nz} 点`, 1000);
  return finish(run, d, l);
}

/* ---------- OPTICS（Ankerst ほか 1999）。クラスタは論文の ExtractDBSCAN と同じく閾値で切り出す ---------- */
export function optics(d: Data, p: Params): Run {
  const n = d.n,
    mp = p.minPts,
    run: Draft = { frames: [], iters: n, dist: n * n },
    dd = range(n).map((i) => Float64Array.from({ length: n }, (_, j) => Math.sqrt(d2(d, i, j)))),
    core = dd.map((a) => a.slice().sort()[Math.min(mp, n - 1)]),
    reach = new Float64Array(n).fill(Infinity),
    done = new Uint8Array(n),
    order: number[] = [],
    from = new Int32Array(n).fill(-1);
  for (let s = 0; s < n; s++) {
    let i = -1,
      v = Infinity;
    for (let j = 0; j < n; j++)
      if (!done[j] && reach[j] < v) {
        v = reach[j];
        i = j;
      }
    if (i < 0) i = done.indexOf(0);
    done[i] = 1;
    order.push(i);
    for (let j = 0; j < n; j++) {
      if (done[j]) continue;
      const q = Math.max(core[i], dd[i][j]);
      if (q < reach[j]) {
        reach[j] = q;
        from[j] = i;
      }
    }
  }
  const l = newLabels(n);
  let c = -1;
  for (const i of order) {
    if (reach[i] > p.cut) {
      if (core[i] <= p.cut) l[i] = ++c;
    } else if (c >= 0) l[i] = c;
  }
  const rs = order.map((i) => (Number.isFinite(reach[i]) ? reach[i] : 0)),
    step = Math.max(1, Math.floor(n / 150));
  run.side = { type: 'reach', order, reach: rs, cut: p.cut };
  run.frames.push({ st: 0, say: '各点のコア距離を計算', ms: 700, pos: 0, l: newLabels(n) });
  for (let q = step; q <= n; q += step) {
    const seen = new Uint8Array(n);
    for (let e = 0; e < q; e++) seen[order[e]] = 1;
    const cur = order[q - 1];
    run.frames.push({
      st: 1,
      say: `${q} / ${n} 点を処理　到達可能距離 ${rs[q - 1].toFixed(3)}`,
      ms: 40,
      pos: q,
      l: Int16Array.from(l, (v, i) => (seen[i] ? v : -1)),
      seg:
        from[cur] >= 0
          ? [{ d: [d.x[cur], d.y[cur], d.x[from[cur]], d.y[from[cur]]], c: ACC, w: 2.4, big: true }]
          : undefined,
    });
  }
  run.frames.push({
    st: 2,
    say: `閾値 ${p.cut.toFixed(3)} で切断　クラスタ ${c + 1} 個`,
    ms: 1200,
    pos: n,
    l,
    kind: noiseKind(l),
  });
  return finish(run, d, l);
}

/* ---------- HDBSCAN（Campello ほか 2013） ---------- */
export function hdbscan(d: Data, p: Params): Run {
  const n = d.n,
    mp = p.minPts,
    mcs = p.mcs,
    run: Draft = { frames: [], iters: n - 1, dist: n * n },
    core = range(n).map((i) => {
      const a = Float64Array.from({ length: n }, (_, j) => d2(d, i, j)).sort();
      return Math.sqrt(a[Math.min(mp, n - 1)]);
    }),
    edges = prim(n, (a, b) => Math.max(core[a], core[b], Math.sqrt(d2(d, a, b)))),
    sorted = edges.slice().sort((a, b) => a[2] - b[2]);
  /* 単連結の木 */
  const uf = range(2 * n),
    f = (x: number): number => {
      let v = x;
      while (uf[v] !== v) {
        uf[v] = uf[uf[v]];
        v = uf[v];
      }
      return v;
    },
    tree: { a: number; b: number; h: number }[] = [],
    sizes = new Int32Array(2 * n).fill(1);
  let nid = n;
  for (const [a, b, h] of sorted) {
    const A = f(a),
      B = f(b);
    tree[nid] = { a: A, b: B, h };
    sizes[nid] = sizes[A] + sizes[B];
    uf[A] = nid;
    uf[B] = nid;
    nid++;
  }
  const leaves = (v: number): number[] => {
    const out: number[] = [],
      st = [v];
    while (st.length) {
      const q = st.pop() as number;
      if (q < n) out.push(q);
      else st.push(tree[q].a, tree[q].b);
    }
    return out;
  };
  const lam = (h: number): number => 1 / Math.max(h, 1e-9);
  /* 木の凝縮: 小さすぎる枝は落ちた点として数える */
  interface Cond {
    birth: number;
    stab: number;
    kids: Cond[];
    pts: number[];
  }
  const addCluster = (root: number, birth: number): Cond => {
    const c: Cond = { birth, stab: 0, kids: [], pts: [] },
      st = [root];
    while (st.length) {
      const v = st.pop() as number;
      if (v < n) {
        c.pts.push(v);
        continue;
      }
      const { a, b, h } = tree[v],
        L = lam(h),
        sa = sizes[a],
        sb = sizes[b];
      if (sa >= mcs && sb >= mcs) {
        c.stab += (sa + sb) * (L - birth);
        c.kids.push(addCluster(a, L), addCluster(b, L));
      } else {
        for (const [x, s] of [
          [a, sa],
          [b, sb],
        ]) {
          if (s < mcs) {
            c.stab += s * (L - birth);
            c.pts.push(...leaves(x));
          } else st.push(x);
        }
      }
    }
    return c;
  };
  const root = addCluster(nid - 1, 0);
  /* 過剰質量で選ぶ（根は選ばない） */
  const pick = (c: Cond): { s: number; sel: Cond[] } => {
    if (!c.kids.length) return { s: c.stab, sel: [c] };
    let s = 0,
      sel: Cond[] = [];
    for (const k of c.kids) {
      const r = pick(k);
      s += r.s;
      sel = sel.concat(r.sel);
    }
    if (c !== root && c.stab >= s) return { s: c.stab, sel: [c] };
    return { s, sel };
  };
  const chosen = pick(root).sel,
    all = (c: Cond): number[] => c.pts.concat(...c.kids.map(all)),
    l = newLabels(n);
  chosen.forEach((c, q) => {
    for (const i of all(c)) l[i] = q;
  });
  /* コア距離の円はいくつかだけ描く */
  const r = rng(p.seed * 67 + 37),
    idx = shuffle(range(n), r).slice(0, 14);
  run.frames.push({
    st: 0,
    say: `${mp} 番目の近傍までをコア距離に`,
    ms: 1200,
    circ: idx.map((i) => ({ x: d.x[i], y: d.y[i], r: core[i], c: ACC, thin: true })),
  });
  const step = Math.max(1, Math.floor(n / 70));
  for (let e = step; e <= edges.length; e += step)
    run.frames.push({
      st: 1,
      say: `相互到達距離の最小全域木　辺 ${e} 本`,
      ms: 34,
      seg: [{ d: flat(d, edges.slice(0, e)), c: INK, w: 1.2 }],
    });
  const dsc = sorted.slice().reverse();
  for (let q = step; q <= Math.min(dsc.length, n * 0.8); q += step)
    run.frames.push({
      st: 2,
      say: `長い辺から切断　${q} 本`,
      ms: 34,
      seg: [
        { d: flat(d, dsc.slice(q)), c: INK, w: 1.2 },
        { d: flat(d, dsc.slice(Math.max(0, q - step), q)), c: ACC, w: 2.2 },
      ],
    });
  run.frames.push({ st: 3, say: `安定なクラスタ ${chosen.length} 個を選択`, ms: 1200, l, kind: noiseKind(l) });
  return finish(run, d, l);
}

/* ---------- 山登り（Mean Shift と DENCLUE で共通） ---------- */
function hillClimb(
  d: Data,
  h: number,
  run: Draft,
  say: string,
  maxIt: number,
  tol: number,
): [Float32Array, Float32Array] {
  const n = d.n,
    h2 = h * h;
  let x = Float32Array.from(d.x),
    y = Float32Array.from(d.y);
  for (let it = 1; it <= maxIt; it++) {
    const nx = new Float32Array(n),
      ny = new Float32Array(n);
    let mv = 0;
    for (let i = 0; i < n; i++) {
      let sx = 0,
        sy = 0,
        sw = 0;
      for (let j = 0; j < n; j++) {
        const q = (x[i] - d.x[j]) ** 2 + (y[i] - d.y[j]) ** 2;
        if (q > 9 * h2) continue;
        const w = Math.exp(-q / (2 * h2));
        sx += w * d.x[j];
        sy += w * d.y[j];
        sw += w;
      }
      nx[i] = sw ? sx / sw : x[i];
      ny[i] = sw ? sy / sw : y[i];
      mv = Math.max(mv, Math.hypot(nx[i] - x[i], ny[i] - y[i]));
    }
    run.dist += n * n;
    x = nx;
    y = ny;
    run.iters = it;
    if (it <= 25 || it % 3 === 0) run.frames.push({ st: 1, say: `${it} 回目の${say}`, ms: 90, x, y });
    if (mv < tol) break;
  }
  return [x, y];
}
/** 元の位置へ戻す 14 コマ */
function backFrames(
  d: Data,
  run: Draft,
  x: Float32Array,
  y: Float32Array,
  l: Int16Array,
  kind: Int8Array | undefined,
  last: string,
): void {
  for (let s = 1; s <= 14; s++) {
    const u = s / 14,
      e = u * u * (3 - 2 * u);
    run.frames.push({
      st: 3,
      say: s === 14 ? last : '元の位置へ',
      ms: s === 14 ? 1000 : 50,
      x: Float32Array.from(x, (v, i) => v + (d.x[i] - v) * e),
      y: Float32Array.from(y, (v, i) => v + (d.y[i] - v) * e),
      l,
      kind,
    });
  }
}
function modes(x: Float32Array, y: Float32Array, h: number): { ax: number[]; ay: number[]; own: Int32Array } {
  const ax: number[] = [],
    ay: number[] = [],
    own = new Int32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    let f = -1;
    for (let c = 0; c < ax.length; c++)
      if (Math.hypot(x[i] - ax[c], y[i] - ay[c]) < h * 0.5) {
        f = c;
        break;
      }
    if (f < 0) {
      f = ax.length;
      ax.push(x[i]);
      ay.push(y[i]);
    }
    own[i] = f;
  }
  return { ax, ay, own };
}

/* ---------- Mean Shift（Comaniciu & Meer 2002） ---------- */
export function meanshift(d: Data, p: Params): Run {
  const n = d.n,
    h = p.h,
    run: Draft = { frames: [], iters: 0, dist: 0 };
  run.frames.push({
    st: 0,
    say: `各点の周りに半径 ${h.toFixed(2)} のウィンドウを配置`,
    ms: 900,
    x: Float32Array.from(d.x),
    y: Float32Array.from(d.y),
  });
  const [x, y] = hillClimb(d, h, run, '移動', 60, 2e-4),
    { ax, ay, own } = modes(x, y, h),
    l = Int16Array.from(own),
    cnt = new Array(ax.length).fill(0);
  for (const c of own) cnt[c]++;
  /* 最も遠くから来た点の軌跡とウィンドウを見せる */
  let far = 0,
    fv = -1;
  for (let i = 0; i < n; i++) {
    const v = Math.hypot(x[i] - d.x[i], y[i] - d.y[i]);
    if (v > fv) {
      fv = v;
      far = i;
    }
  }
  const trail: number[] = [];
  run.frames.forEach((fr) => {
    const fx = fr.x as Float32Array,
      fy = fr.y as Float32Array;
    if (trail.length) trail.push(trail[trail.length - 2], trail[trail.length - 1], fx[far], fy[far]);
    else trail.push(fx[far], fy[far], fx[far], fy[far]);
    fr.seg = [{ d: trail.slice(), c: ACC, w: 2, big: true }];
    fr.circ = [{ x: fx[far], y: fy[far], r: h, c: ACC }];
    fr.tag = [{ x: fx[far], y: fy[far], s: 'ウィンドウ', c: ACC, ry: -h, dy: -10 }];
  });
  run.frames.push({
    st: 2,
    say: `ピーク ${ax.length} 個に統合`,
    ms: 1000,
    x,
    y,
    l,
    tag: ax.flatMap((u, c) => (cnt[c] >= 4 ? [{ x: u, y: ay[c], s: `${cnt[c]} 点`, dx: 12, dy: -11 }] : [])),
  });
  backFrames(d, run, x, y, l, undefined, `完了　クラスタ ${ax.length} 個`);
  return finish(run, d, l);
}

/* ---------- DENCLUE（Hinneburg & Keim 1998）。ノイズの閾値は最も高い極大との比で決める ---------- */
export function denclue(d: Data, p: Params): Run {
  const n = d.n,
    h = p.h,
    h2 = h * h,
    run: Draft = { frames: [], iters: 0, dist: 0 };
  run.frames.push({
    st: 0,
    say: 'ガウス関数の重ね合わせで密度を定義',
    ms: 800,
    x: Float32Array.from(d.x),
    y: Float32Array.from(d.y),
  });
  const [x, y] = hillClimb(d, h, run, '山登り', 50, 3e-4),
    { ax, ay, own } = modes(x, y, h),
    dens = ax.map((u, c) => {
      let s = 0;
      for (let j = 0; j < n; j++) s += Math.exp(-((u - d.x[j]) ** 2 + (ay[c] - d.y[j]) ** 2) / (2 * h2));
      return s;
    }),
    top = Math.max(...dens),
    keep = dens.map((v) => v >= p.xi * top),
    l = Int16Array.from(own, (c) => (keep[c] ? c : -1)),
    kind = noiseKind(l),
    cen: Cen[] = ax.flatMap((u, c) => (keep[c] ? [{ x: u, y: ay[c], c, t: 'ring' as const }] : []));
  run.frames.push({ st: 2, say: `極大 ${cen.length} 個に統合　低い極大はノイズ`, ms: 1000, x, y, l, kind, cen });
  backFrames(d, run, x, y, l, kind, `完了　クラスタ ${cen.length} 個`);
  return finish(run, d, l);
}

/* ---------- 密度 ---------- */
function density(d: Data, s: number): Float64Array {
  const n = d.n,
    rho = new Float64Array(n);
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const w = Math.exp(-d2(d, i, j) / (2 * s * s));
      rho[i] += w;
      rho[j] += w;
    }
  return rho;
}

/* ---------- Quick Shift（Vedaldi & Soatto 2008） ---------- */
export function quickshift(d: Data, p: Params): Run {
  const n = d.n,
    rho = density(d, p.qsig),
    t2 = p.tau * p.tau,
    par = new Int32Array(n).fill(-1),
    ord = range(n).sort((a, b) => rho[b] - rho[a]),
    run: Draft = { frames: [], iters: n, dist: n * n };
  for (let i = 0; i < n; i++) {
    let v = Infinity;
    for (let j = 0; j < n; j++) {
      if (rho[j] <= rho[i]) continue;
      const q = d2(d, i, j);
      if (q < v && q <= t2) {
        v = q;
        par[i] = j;
      }
    }
  }
  const l = newLabels(n);
  let c = 0;
  for (const i of ord) l[i] = par[i] < 0 ? c++ : l[par[i]];
  run.frames.push({
    st: 0,
    say: `各点の密度を計算　バンド幅 ${p.qsig.toFixed(3)}`,
    ms: 800,
    cen: [{ x: d.x[ord[0]], y: d.y[ord[0]], c: INK, t: 'ring' }],
  });
  const step = Math.max(1, Math.floor(n / 70)),
    seg: number[] = [];
  ord.forEach((i, q) => {
    if (par[i] >= 0) seg.push(d.x[i], d.y[i], d.x[par[i]], d.y[par[i]]);
    if (q % step === 0 || q === n - 1)
      run.frames.push({
        st: 1,
        say: `密度が高い順に親へ接続　${q + 1} 点`,
        ms: 40,
        l: Int16Array.from(l, (_, u) => (rho[u] >= rho[i] ? l[u] : -1)),
        seg: [{ d: seg.slice(), c: INK, w: 1.1 }],
      });
  });
  run.frames.push({ st: 2, say: `木 ${c} 本で完了`, ms: 1000, l, seg: [{ d: seg.slice(), c: INK, w: 1.1 }] });
  return finish(run, d, l);
}

/* ---------- Density Peaks（Rodriguez & Laio 2014） ---------- */
export function densityPeaks(d: Data, p: Params): Run {
  const n = d.n,
    rho = density(d, p.dc),
    dl = new Float64Array(n),
    par = new Int32Array(n).fill(-1),
    ord = range(n).sort((a, b) => rho[b] - rho[a]);
  let dmax = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) dmax = Math.max(dmax, d2(d, i, j));
  dmax = Math.sqrt(dmax);
  for (let q = 0; q < n; q++) {
    const i = ord[q];
    let v = Infinity;
    for (let e = 0; e < q; e++) {
      const u = d2(d, i, ord[e]);
      if (u < v) {
        v = u;
        par[i] = ord[e];
      }
    }
    dl[i] = q ? Math.sqrt(v) : dmax;
  }
  const centers = ord
      .slice()
      .sort((a, b) => rho[b] * dl[b] - rho[a] * dl[a])
      .slice(0, Math.min(p.k, n)),
    l = newLabels(n);
  centers.forEach((c, q) => {
    l[c] = q;
  });
  const run: Draft = { frames: [], iters: 1, dist: n * n },
    rings: Cen[] = centers.map((c, q) => ({ x: d.x[c], y: d.y[c], c: q, t: 'ring' }));
  run.frames.push({ st: 0, say: '各点の密度と高密度の点までの距離を計算', ms: 1100, l: newLabels(n) });
  run.frames.push({
    st: 1,
    say: `右上の ${centers.length} 点を中心に選択`,
    ms: 1100,
    pick: true,
    l: l.slice(),
    cen: rings,
  });
  const step = Math.max(1, Math.floor(n / 70)),
    seg: number[] = [];
  ord.forEach((i, q) => {
    if (l[i] < 0) {
      l[i] = par[i] >= 0 ? l[par[i]] : 0;
      if (par[i] >= 0) seg.push(d.x[i], d.y[i], d.x[par[i]], d.y[par[i]]);
    }
    if (q % step === 0 || q === n - 1)
      run.frames.push({
        st: 2,
        say: `密度が高い順に割り当て　${q + 1} 点`,
        ms: 34,
        pick: true,
        l: l.slice(),
        cen: rings,
        seg: [{ d: seg.slice(), c: INK, w: 0.9 }],
      });
  });
  run.frames.push({
    st: 3,
    say: `クラスタ ${centers.length} 個で完了`,
    ms: 1000,
    pick: true,
    l: l.slice(),
    cen: rings,
  });
  const res = finish(run, d, l);
  /* 決定グラフの中心の色は、ラベルの色の番号で持つ */
  res.side = { type: 'decision', rho, delta: dl, centers, cc: centers.map((c) => res.labels[c]) };
  return res;
}
