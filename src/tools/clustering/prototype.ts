/** 代表点ベースの手法: k-means とその仲間 */
import {
  ACC,
  assignAll,
  BIG,
  type Cen,
  type Circ,
  cens,
  type Data,
  type Draft,
  d2,
  finish,
  INK,
  initCenters,
  nearestC,
  newLabels,
  type Params,
  type Run,
  range,
  rng,
  type Seg,
  SMALL,
  shuffle,
  trails,
} from './core';

/* ---------- k-means（Lloyd） ---------- */
export function kmeans(d: Data, p: Params): Run {
  const k = p.k,
    r = rng((p.seed + 6) * 31 + 7),
    run: Draft = { frames: [], iters: 0, dist: 0 };
  let [cx, cy] = initCenters(d, k, p.init === 1, r);
  let l = newLabels(d.n);
  const hist: [number, number][][] = cx.map((x, c) => [[x, cy[c]]]);
  const tagged = (): { x: number; y: number; s: string; dx: number; dy: number }[] => [
    { x: cx[0], y: cy[0], s: '重心', dx: 13, dy: -10 },
  ];
  run.frames.push({ st: 0, say: `重心 ${k} 個を配置`, ms: 900, l, cen: cens(cx, cy), tag: tagged() });
  for (let it = 1; it <= 40; it++) {
    const nl = new Int16Array(d.n);
    let moved = 0,
      sse = 0;
    for (let i = 0; i < d.n; i++) {
      const b = nearestC(d, i, cx, cy);
      nl[i] = b;
      sse += (d.x[i] - cx[b]) ** 2 + (d.y[i] - cy[b]) ** 2;
      if (l[i] !== b) moved++;
    }
    run.dist += d.n * k;
    run.iters = it;
    run.sse = sse;
    l = nl;
    if (!moved) break;
    /* 割り当て: 点から重心への線 */
    const lines: Seg[] = cx.map((x, c) => {
      const s: number[] = [];
      for (let i = 0; i < d.n; i++) if (l[i] === c) s.push(d.x[i], d.y[i], x, cy[c]);
      return { d: s, c, w: 0.6, a: 0.45, big: true };
    });
    run.frames.push({
      st: 1,
      say: `${it} 回目の割り当て　${moved} 点が移動`,
      ms: 620,
      l,
      cen: cens(cx, cy),
      seg: [...lines, ...trails(hist)],
      reg: true,
      tag: tagged(),
    });
    const sx = new Float64Array(k),
      sy = new Float64Array(k),
      sn = new Float64Array(k);
    for (let i = 0; i < d.n; i++) {
      sx[l[i]] += d.x[i];
      sy[l[i]] += d.y[i];
      sn[l[i]]++;
    }
    const ax = cx.slice(),
      ay = cy.slice(),
      bx = ax.map((v, c) => (sn[c] ? sx[c] / sn[c] : v)),
      by = ay.map((v, c) => (sn[c] ? sy[c] / sn[c] : v));
    for (let s = 1; s <= 6; s++) {
      const u = s / 6,
        e = u * u * (3 - 2 * u);
      cx = ax.map((v, c) => v + (bx[c] - v) * e);
      cy = ay.map((v, c) => v + (by[c] - v) * e);
      const now = hist.map((h, c) => [...h, [cx[c], cy[c]] as [number, number]]);
      run.frames.push({
        st: 2,
        say: `${it} 回目の重心の移動`,
        ms: s === 6 ? 460 : 50,
        l,
        cen: cens(cx, cy),
        seg: trails(now),
        reg: true,
        tag: tagged(),
      });
    }
    cx.forEach((x, c) => {
      hist[c].push([x, cy[c]]);
    });
  }
  run.frames.push({
    st: 3,
    say: `${run.iters} 回で完了`,
    ms: 1000,
    l,
    cen: cens(cx, cy),
    seg: trails(hist),
    reg: true,
    tag: tagged(),
  });
  return finish(run, d, l);
}

/* ---------- ミニバッチ k-means（Sculley 2010） ---------- */
export function minibatch(d: Data, p: Params): Run {
  const n = d.n,
    k = p.k,
    r = rng(p.seed * 37 + 1),
    run: Draft = { frames: [], iters: 0, dist: 0 },
    b = Math.max(k * 2, Math.round(n * p.batch)),
    [cx, cy] = initCenters(d, k, true, r),
    cnt = new Float64Array(k),
    hist: [number, number][][] = cx.map((x, c) => [[x, cy[c]]]);
  run.frames.push({ st: 0, say: `重心 ${k} 個を配置`, ms: 800, cen: cens(cx, cy) });
  for (let it = 1; it <= p.miter; it++) {
    const idx = shuffle(range(n), r).slice(0, b),
      l = newLabels(n),
      kind = new Int8Array(n).fill(SMALL);
    for (const i of idx) {
      l[i] = nearestC(d, i, cx, cy);
      kind[i] = BIG;
    }
    run.dist += b * k;
    run.iters = it;
    run.frames.push({
      st: 1,
      say: `${it} 回目のミニバッチ　${b} 点`,
      ms: 200,
      l,
      kind,
      cen: cens(cx, cy),
      seg: trails(hist),
    });
    for (const i of idx) {
      const c = l[i];
      cnt[c]++;
      const e = 1 / cnt[c];
      cx[c] += (d.x[i] - cx[c]) * e;
      cy[c] += (d.y[i] - cy[c]) * e;
    }
    cx.forEach((x, c) => {
      hist[c].push([x, cy[c]]);
    });
    run.frames.push({ st: 2, say: `${it} 回目の重心の移動`, ms: 160, l, kind, cen: cens(cx, cy), seg: trails(hist) });
  }
  const l = assignAll(d, cx, cy);
  run.dist += n * k;
  run.frames.push({ st: 3, say: '全点を割り当てて完了', ms: 1000, l, cen: cens(cx, cy), seg: trails(hist) });
  return finish(run, d, l);
}

/* ---------- k-medoids（PAM。Kaufman & Rousseeuw 1990 の BUILD と SWAP） ---------- */
export function kmedoids(d: Data, p: Params): Run {
  const n = d.n,
    k = Math.min(p.k, n),
    run: Draft = { frames: [], iters: 0, dist: (n * (n - 1)) / 2 },
    D = new Float64Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const v = Math.sqrt(d2(d, i, j));
      D[i * n + j] = v;
      D[j * n + i] = v;
    }
  const med: number[] = [],
    near = new Float64Array(n).fill(Infinity),
    ring = (): Cen[] => med.map((m, c) => ({ x: d.x[m], y: d.y[m], c, t: 'ring' }));
  /* BUILD: 総距離を最も減らす点を順に選ぶ */
  while (med.length < k) {
    let best = -1,
      bg = -Infinity;
    for (let h = 0; h < n; h++) {
      if (med.includes(h)) continue;
      let g = 0;
      for (let i = 0; i < n; i++)
        g += Math.min(near[i], D[i * n + h]) === Infinity ? -D[i * n + h] : near[i] - Math.min(near[i], D[i * n + h]);
      if (g > bg) {
        bg = g;
        best = h;
      }
    }
    med.push(best);
    for (let i = 0; i < n; i++) near[i] = Math.min(near[i], D[i * n + best]);
    run.frames.push({ st: 0, say: `代表点 ${med.length} 個目を選択`, ms: 420, cen: ring() });
  }
  const labelsNow = (): Int16Array =>
    Int16Array.from({ length: n }, (_, i) => {
      let b = 0,
        v = Infinity;
      med.forEach((m, c) => {
        if (D[i * n + m] < v) {
          v = D[i * n + m];
          b = c;
        }
      });
      return b;
    });
  let l = labelsNow();
  run.frames.push({ st: 1, say: '各点を最も近い代表点へ割り当て', ms: 700, l, cen: ring() });
  /* SWAP: 総距離を最も減らす交換をくり返す */
  for (let it = 1; it <= 30; it++) {
    const d1 = new Float64Array(n),
      d2nd = new Float64Array(n),
      own = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      let a = Infinity,
        b = Infinity,
        o = 0;
      med.forEach((m, c) => {
        const v = D[i * n + m];
        if (v < a) {
          b = a;
          a = v;
          o = c;
        } else if (v < b) b = v;
      });
      d1[i] = a;
      d2nd[i] = b;
      own[i] = o;
    }
    let bc = 0,
      bm = -1,
      bh = -1;
    for (let c = 0; c < k; c++)
      for (let h = 0; h < n; h++) {
        if (med.includes(h)) continue;
        let g = 0;
        for (let i = 0; i < n; i++) {
          const v = D[i * n + h];
          g += own[i] === c ? Math.min(v, d2nd[i]) - d1[i] : Math.min(0, v - d1[i]);
        }
        if (g < bc - 1e-9) {
          bc = g;
          bm = c;
          bh = h;
        }
      }
    if (bm < 0) break;
    const from = med[bm];
    med[bm] = bh;
    l = labelsNow();
    run.iters = it;
    run.frames.push({
      st: 2,
      say: `${it} 回目の交換　総距離 ${(-bc).toFixed(3)} 減`,
      ms: 620,
      l,
      cen: ring(),
      seg: [{ d: [d.x[from], d.y[from], d.x[bh], d.y[bh]], c: ACC, w: 2.2, big: true }],
    });
  }
  run.frames.push({ st: 3, say: `${run.iters} 回の交換で完了`, ms: 1000, l, cen: ring() });
  return finish(run, d, l);
}

/* ---------- k-medians ---------- */
export function kmedians(d: Data, p: Params): Run {
  const k = p.k,
    n = d.n,
    r = rng(p.seed * 41 + 13),
    run: Draft = { frames: [], iters: 0, dist: 0 };
  let [cx, cy] = initCenters(d, k, true, r),
    l = newLabels(n);
  const hist: [number, number][][] = cx.map((x, c) => [[x, cy[c]]]);
  run.frames.push({ st: 0, say: `中心 ${k} 個を配置`, ms: 800, cen: cens(cx, cy) });
  for (let it = 1; it <= 40; it++) {
    const nl = new Int16Array(n);
    let moved = 0;
    for (let i = 0; i < n; i++) {
      let b = 0,
        v = Infinity;
      for (let c = 0; c < k; c++) {
        const q = Math.abs(d.x[i] - cx[c]) + Math.abs(d.y[i] - cy[c]);
        if (q < v) {
          v = q;
          b = c;
        }
      }
      nl[i] = b;
      if (b !== l[i]) moved++;
    }
    run.dist += n * k;
    run.iters = it;
    l = nl;
    if (!moved) break;
    run.frames.push({
      st: 1,
      say: `${it} 回目の割り当て　${moved} 点が移動`,
      ms: 520,
      l,
      cen: cens(cx, cy),
      seg: trails(hist),
    });
    const nx = cx.slice(),
      ny = cy.slice();
    for (let c = 0; c < k; c++) {
      const a: number[] = [],
        b: number[] = [];
      for (let i = 0; i < n; i++)
        if (l[i] === c) {
          a.push(d.x[i]);
          b.push(d.y[i]);
        }
      if (!a.length) continue;
      a.sort((u, v) => u - v);
      b.sort((u, v) => u - v);
      nx[c] = a[a.length >> 1];
      ny[c] = b[b.length >> 1];
    }
    cx = nx;
    cy = ny;
    cx.forEach((x, c) => {
      hist[c].push([x, cy[c]]);
    });
    run.frames.push({ st: 2, say: `${it} 回目の中心の更新`, ms: 520, l, cen: cens(cx, cy), seg: trails(hist) });
  }
  run.frames.push({ st: 3, say: `${run.iters} 回で完了`, ms: 1000, l, cen: cens(cx, cy), seg: trails(hist) });
  return finish(run, d, l);
}

/* ---------- Fuzzy c-means（Bezdek 1981） ---------- */
export function fcm(d: Data, p: Params): Run {
  const n = d.n,
    k = p.k,
    m = p.fz,
    e = 1 / (m - 1),
    r = rng(p.seed * 43 + 17),
    run: Draft = { frames: [], iters: 0, dist: 0 },
    [cx, cy] = initCenters(d, k, false, r);
  run.frames.push({ st: 0, say: `重心 ${k} 個を配置`, ms: 800, cen: cens(cx, cy) });
  let R = new Float32Array(n * k);
  for (let it = 1; it <= 60; it++) {
    R = new Float32Array(n * k);
    for (let i = 0; i < n; i++) {
      const ds = cx.map((x, c) => Math.max(1e-9, (d.x[i] - x) ** 2 + (d.y[i] - cy[c]) ** 2));
      for (let c = 0; c < k; c++) {
        let s = 0;
        for (let q = 0; q < k; q++) s += (ds[c] / ds[q]) ** e;
        R[i * k + c] = 1 / s;
      }
    }
    run.dist += n * k;
    run.iters = it;
    run.frames.push({
      st: 1,
      say: `${it} 回目の所属度の計算`,
      ms: it < 10 ? 240 : 60,
      soft: { r: R, k },
      cen: cens(cx, cy),
    });
    let mv = 0;
    for (let c = 0; c < k; c++) {
      let sw = 1e-9,
        sx = 0,
        sy = 0;
      for (let i = 0; i < n; i++) {
        const w = R[i * k + c] ** m;
        sw += w;
        sx += w * d.x[i];
        sy += w * d.y[i];
      }
      const nx = sx / sw,
        ny = sy / sw;
      mv = Math.max(mv, Math.hypot(nx - cx[c], ny - cy[c]));
      cx[c] = nx;
      cy[c] = ny;
    }
    run.frames.push({
      st: 2,
      say: `${it} 回目の重心の移動`,
      ms: it < 10 ? 240 : 60,
      soft: { r: R, k },
      cen: cens(cx, cy),
    });
    if (mv < 1e-3) break;
  }
  run.frames.push({ st: 3, say: `${run.iters} 回で完了`, ms: 1000, soft: { r: R, k }, cen: cens(cx, cy) });
  const l = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    let b = 0,
      v = -1;
    for (let c = 0; c < k; c++)
      if (R[i * k + c] > v) {
        v = R[i * k + c];
        b = c;
      }
    l[i] = b;
  }
  return finish(run, d, l);
}

/* 2-means を数回試して最も誤差の小さい分け方を返す */
function twoMeans(d: Data, m: readonly number[], r: () => number, tries = 4) {
  let best: { sse: number; lab: Int8Array; cx: number[]; cy: number[] } | null = null;
  for (let t = 0; t < tries; t++) {
    const a = m[Math.floor(r() * m.length)];
    let b = a;
    while (b === a && m.length > 1) b = m[Math.floor(r() * m.length)];
    let cx = [d.x[a], d.x[b]],
      cy = [d.y[a], d.y[b]],
      sse = 0;
    const lab = new Int8Array(m.length);
    for (let it = 0; it < 12; it++) {
      sse = 0;
      m.forEach((i, q) => {
        lab[q] = nearestC(d, i, cx, cy);
        sse += (d.x[i] - cx[lab[q]]) ** 2 + (d.y[i] - cy[lab[q]]) ** 2;
      });
      const sx = [0, 0],
        sy = [0, 0],
        sn = [0, 0];
      m.forEach((i, q) => {
        sx[lab[q]] += d.x[i];
        sy[lab[q]] += d.y[i];
        sn[lab[q]]++;
      });
      cx = cx.map((v, c) => (sn[c] ? sx[c] / sn[c] : v));
      cy = cy.map((v, c) => (sn[c] ? sy[c] / sn[c] : v));
    }
    if (!best || sse < best.sse) best = { sse, lab: lab.slice(), cx, cy };
  }
  return best as NonNullable<typeof best>;
}
const sseOf = (d: Data, m: readonly number[]): number => {
  let x = 0,
    y = 0;
  for (const i of m) {
    x += d.x[i];
    y += d.y[i];
  }
  x /= m.length;
  y /= m.length;
  let s = 0;
  for (const i of m) s += (d.x[i] - x) ** 2 + (d.y[i] - y) ** 2;
  return s;
};

/* ---------- 二分 k-means（Steinbach ほか 2000） ---------- */
export function bisecting(d: Data, p: Params): Run {
  const n = d.n,
    r = rng(p.seed * 47 + 19),
    run: Draft = { frames: [], iters: 0, dist: 0 },
    cl: number[][] = [range(n)],
    l = new Int16Array(n);
  run.frames.push({ st: 0, say: '全点が 1 つのクラスタ', ms: 800, l: l.slice() });
  while (cl.length < p.k) {
    let w = 0,
      v = -1;
    cl.forEach((m, c) => {
      const q = m.length > 1 ? sseOf(d, m) : -1;
      if (q > v) {
        v = q;
        w = c;
      }
    });
    const m = cl[w];
    if (m.length < 2) break;
    const kind = new Int8Array(n).fill(SMALL);
    for (const i of m) kind[i] = BIG;
    run.frames.push({ st: 1, say: `誤差が最大のクラスタ ${w + 1} を選択`, ms: 500, l: l.slice(), kind });
    const b = twoMeans(d, m, r);
    run.dist += m.length * 2 * 12 * 4;
    run.iters++;
    const A: number[] = [],
      B: number[] = [],
      nc = cl.length;
    m.forEach((i, q) => {
      (b.lab[q] ? B : A).push(i);
      l[i] = b.lab[q] ? nc : w;
    });
    cl[w] = A;
    cl.push(B);
    run.frames.push({
      st: 2,
      say: `2 分割　クラスタ ${cl.length} 個`,
      ms: 700,
      l: l.slice(),
      cen: [
        { x: b.cx[0], y: b.cy[0], c: w },
        { x: b.cx[1], y: b.cy[1], c: nc },
      ],
    });
  }
  run.frames.push({ st: 3, say: `クラスタ ${cl.length} 個で完了`, ms: 1000, l: l.slice() });
  return finish(run, d, l);
}

/* ---------- X-means（Pelleg & Moore 2000） ---------- */
/** m の点を cl に分けたときの BIC。分散は 1 次元あたりの値を使う */
export function bic(d: Data, m: readonly number[], cl: readonly (readonly number[])[]): number {
  const R = m.length,
    K = cl.length;
  let sse = 0;
  for (const c of cl) sse += sseOf(d, c);
  const s2 = Math.max(1e-9, sse / Math.max(1, 2 * (R - K)));
  let L = 0;
  for (const c of cl) {
    const q = c.length;
    if (!q) continue;
    L += q * Math.log(q) - q * Math.log(R) - (q / 2) * Math.log(2 * Math.PI) - q * Math.log(s2) - (q - K) / 2;
  }
  return L - ((K - 1 + 2 * K + 1) / 2) * Math.log(R);
}
export function xmeans(d: Data, p: Params): Run {
  const n = d.n,
    r = rng(p.seed * 53 + 23),
    run: Draft = { frames: [], iters: 0, dist: 0 };
  let [cx, cy] = initCenters(d, 2, true, r),
    l = assignAll(d, cx, cy);
  const refine = () => {
    for (let t = 0; t < 12; t++) {
      l = assignAll(d, cx, cy);
      run.dist += n * cx.length;
      const sx = cx.map(() => 0),
        sy = cx.map(() => 0),
        sn = cx.map(() => 0);
      for (let i = 0; i < n; i++) {
        sx[l[i]] += d.x[i];
        sy[l[i]] += d.y[i];
        sn[l[i]]++;
      }
      cx = cx.map((v, c) => (sn[c] ? sx[c] / sn[c] : v));
      cy = cy.map((v, c) => (sn[c] ? sy[c] / sn[c] : v));
    }
    l = assignAll(d, cx, cy);
  };
  run.frames.push({ st: 0, say: '重心 2 個から開始', ms: 800, cen: cens(cx, cy) });
  for (let round = 1; round <= 8; round++) {
    refine();
    run.iters = round;
    run.frames.push({ st: 1, say: `${round} 回目の k-means　k = ${cx.length}`, ms: 700, l, cen: cens(cx, cy) });
    if (cx.length >= p.kmax) break;
    const nx: number[] = [],
      ny: number[] = [],
      circ: Circ[] = [];
    let grew = 0;
    cx.forEach((x, c) => {
      const m: number[] = [];
      for (let i = 0; i < n; i++) if (l[i] === c) m.push(i);
      if (m.length < 8 || cx.length + grew >= p.kmax) {
        nx.push(x);
        ny.push(cy[c]);
        return;
      }
      const b = twoMeans(d, m, r, 3),
        A = m.filter((_, q) => !b.lab[q]),
        B = m.filter((_, q) => b.lab[q]);
      if (A.length && B.length && bic(d, m, [A, B]) > bic(d, m, [m])) {
        nx.push(b.cx[0], b.cx[1]);
        ny.push(b.cy[0], b.cy[1]);
        grew++;
        circ.push({ x, y: cy[c], r: 0.07, c: ACC });
      } else {
        nx.push(x);
        ny.push(cy[c]);
      }
    });
    run.frames.push({
      st: 2,
      say: grew ? `BIC の判定　${grew} 個を分割` : 'BIC の判定　分割なし',
      ms: 800,
      l,
      cen: cens(cx, cy),
      circ,
    });
    if (!grew) break;
    cx = nx;
    cy = ny;
  }
  run.frames.push({ st: 3, say: `クラスタ ${cx.length} 個で完了`, ms: 1000, l, cen: cens(cx, cy) });
  return finish(run, d, l);
}

/* ---------- カーネル k-means（Schölkopf ほか 1998） ---------- */
export function kernelKmeans(d: Data, p: Params): Run {
  const n = d.n,
    k = p.k,
    g = 1 / (2 * p.ksig * p.ksig),
    r = rng(p.seed * 59 + 29),
    K = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) K[i * n + j] = Math.exp(-g * d2(d, i, j));
  let best: { obj: number; hist: Int16Array[]; l: Int16Array } | null = null;
  for (let tr = 0; tr < 5; tr++) {
    /* 特徴空間で遠い点を初期の中心に選ぶ */
    const seed = [Math.floor(r() * n)];
    while (seed.length < k) {
      let far = 0,
        v = -1;
      for (let i = 0; i < n; i++) {
        let m = Infinity;
        for (const s of seed) m = Math.min(m, 2 - 2 * K[i * n + s]);
        m *= 0.7 + 0.3 * r();
        if (m > v) {
          v = m;
          far = i;
        }
      }
      seed.push(far);
    }
    let l = Int16Array.from({ length: n }, (_, i) => {
      let b = 0,
        v = -1;
      seed.forEach((s, c) => {
        if (K[i * n + s] > v) {
          v = K[i * n + s];
          b = c;
        }
      });
      return b;
    });
    const hist = [l];
    let obj = 0;
    for (let it = 0; it < 30; it++) {
      const mem: number[][] = Array.from({ length: k }, () => []);
      l.forEach((c, i) => {
        mem[c].push(i);
      });
      const self = mem.map((m) => {
        let s = 0;
        for (const a of m) for (const b of m) s += K[a * n + b];
        return m.length ? s / (m.length * m.length) : 0;
      });
      const nl = new Int16Array(n);
      let ch = 0;
      obj = 0;
      for (let i = 0; i < n; i++) {
        let b = 0,
          v = Infinity;
        for (let c = 0; c < k; c++) {
          if (!mem[c].length) continue;
          let s = 0;
          for (const j of mem[c]) s += K[i * n + j];
          const q = 1 - (2 * s) / mem[c].length + self[c];
          if (q < v) {
            v = q;
            b = c;
          }
        }
        nl[i] = b;
        obj += v;
        if (b !== l[i]) ch++;
      }
      l = nl;
      hist.push(l);
      if (!ch) break;
    }
    if (!best || obj < best.obj) best = { obj, hist, l };
  }
  const b = best as NonNullable<typeof best>,
    run: Draft = { frames: [], iters: b.hist.length, dist: n * n };
  run.frames.push({
    st: 0,
    say: 'ガウス関数で全点の組の類似度を計算',
    ms: 800,
    cen: [{ x: d.x[0], y: d.y[0], c: INK, t: 'small' }],
  });
  b.hist.forEach((l, i) => {
    run.frames.push({ st: 1, say: `${i + 1} 回目の割り当て`, ms: 420, l });
  });
  run.frames.push({ st: 2, say: `${b.hist.length} 回で完了`, ms: 1000, l: b.l });
  return finish(run, d, b.l);
}
