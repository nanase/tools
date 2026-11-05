/** 分布ベースの手法: 混合ガウス分布（EM）と変分ベイズ混合ガウス分布 */
import {
  argmaxSoft,
  assignAll,
  type Data,
  type Draft,
  type Ell,
  finish,
  initCenters,
  type Params,
  type Run,
  rng,
} from './core';

/* ---------- 混合ガウス分布（Dempster ほか 1977 の EM） ---------- */
export function gmm(d: Data, p: Params): Run {
  const n = d.n,
    k = p.k,
    cov = p.cov,
    r = rng(p.seed * 43 + 3),
    run: Draft = { frames: [], iters: 0, dist: 0 },
    [mx, my] = initCenters(d, k, true, r),
    w = new Array<number>(k).fill(1 / k);
  let s: [number, number, number][] = Array.from({ length: k }, () => [0.04, 0, 0.04]),
    ll = -Infinity;
  const ells = (): Ell[] => mx.map((x, c) => ({ x, y: my[c], s: [...s[c]] as [number, number, number], c })),
    sigmaTags = () => [
      { x: mx[0], y: my[0], s: '1σ', dx: 4, dy: -8, ry: -Math.sqrt(s[0][2]) },
      { x: mx[0], y: my[0], s: '2σ', dx: 4, dy: -8, ry: -2 * Math.sqrt(s[0][2]) },
    ];
  run.frames.push({
    st: 0,
    say: `楕円 ${k} 個を配置`,
    ms: 900,
    ell: ells(),
    tag: sigmaTags(),
  });
  let R = new Float32Array(n * k);
  for (let it = 1; it <= 80; it++) {
    const nr = new Float32Array(n * k);
    let nl = 0;
    for (let i = 0; i < n; i++) {
      let t = 0;
      for (let c = 0; c < k; c++) {
        const a = d.x[i] - mx[c],
          b = d.y[i] - my[c],
          [sxx, sxy, syy] = s[c],
          det = Math.max(1e-10, sxx * syy - sxy * sxy),
          q = (syy * a * a - 2 * sxy * a * b + sxx * b * b) / det,
          v = (w[c] * Math.exp(-0.5 * q)) / (2 * Math.PI * Math.sqrt(det));
        nr[i * k + c] = v;
        t += v;
      }
      t = Math.max(t, 1e-300);
      nl += Math.log(t);
      for (let c = 0; c < k; c++) nr[i * k + c] /= t;
    }
    run.dist += n * k;
    run.iters = it;
    R = nr;
    const prev = ll;
    ll = nl / n;
    run.ll = ll;
    run.frames.push({
      st: 1,
      say: `${it} 回目の所属確率`,
      ms: it < 12 ? 240 : 70,
      soft: { r: R, k },
      ell: ells(),
      tag: sigmaTags(),
    });
    if (Math.abs(ll - prev) < 2e-4 && it > 3) break;
    for (let c = 0; c < k; c++) {
      let sw = 1e-9,
        sx = 0,
        sy = 0;
      for (let i = 0; i < n; i++) {
        const v = R[i * k + c];
        sw += v;
        sx += v * d.x[i];
        sy += v * d.y[i];
      }
      mx[c] = sx / sw;
      my[c] = sy / sw;
      let a = 0,
        b = 0,
        e = 0;
      for (let i = 0; i < n; i++) {
        const v = R[i * k + c],
          u = d.x[i] - mx[c],
          t = d.y[i] - my[c];
        a += v * u * u;
        b += v * u * t;
        e += v * t * t;
      }
      a = a / sw + 2e-4;
      b /= sw;
      e = e / sw + 2e-4;
      if (cov === 1) b = 0;
      if (cov === 2) {
        a = (a + e) / 2;
        e = a;
        b = 0;
      }
      s = s.map((v, q) => (q === c ? [a, b, e] : v));
      w[c] = sw / n;
    }
    run.frames.push({
      st: 2,
      say: `${it} 回目の楕円の更新`,
      ms: it < 12 ? 240 : 70,
      soft: { r: R, k },
      ell: ells(),
      tag: sigmaTags(),
    });
  }
  run.frames.push({ st: 3, say: `${run.iters} 回で完了`, ms: 1000, soft: { r: R, k }, ell: ells() });
  return finish(run, d, argmaxSoft(R, n, k));
}

/* ---------- 変分ベイズ混合ガウス分布（Bishop 2006 の 10.2 節） ---------- */
export function digamma(v: number): number {
  let x = v,
    r = 0;
  while (x < 6) {
    r -= 1 / x;
    x += 1;
  }
  const f = 1 / (x * x);
  return r + Math.log(x) - 0.5 / x - f * (1 / 12 - f * (1 / 120 - f / 252));
}
export function vbgmm(d: Data, p: Params): Run {
  const n = d.n,
    K = p.K,
    r = rng(p.seed * 71 + 41),
    a0 = p.a0,
    b0 = 1,
    v0 = 4;
  let mx0 = 0,
    my0 = 0;
  for (let i = 0; i < n; i++) {
    mx0 += d.x[i];
    my0 += d.y[i];
  }
  mx0 /= n;
  my0 /= n;
  /* W0 の逆行列。尺度は箱の大きさに合わせて決める */
  const W0inv = 0.02 * v0,
    [ix, iy] = initCenters(d, K, true, r),
    lb = assignAll(d, ix, iy),
    R = new Float32Array(n * K);
  for (let i = 0; i < n; i++) R[i * K + lb[i]] = 1;
  const run: Draft = { frames: [], iters: 0, dist: 0 };
  interface St {
    N: number;
    al: number;
    be: number;
    nu: number;
    mx: number;
    my: number;
    W: [number, number, number];
    logW: number;
    S: [number, number, number];
  }
  const M = (): St[] => {
    const st: St[] = [];
    for (let c = 0; c < K; c++) {
      let N = 1e-9,
        sx = 0,
        sy = 0;
      for (let i = 0; i < n; i++) {
        const w = R[i * K + c];
        N += w;
        sx += w * d.x[i];
        sy += w * d.y[i];
      }
      const xb = sx / N,
        yb = sy / N;
      let a = 0,
        b = 0,
        e = 0;
      for (let i = 0; i < n; i++) {
        const w = R[i * K + c],
          u = d.x[i] - xb,
          t = d.y[i] - yb;
        a += w * u * u;
        b += w * u * t;
        e += w * t * t;
      }
      const al = a0 + N,
        be = b0 + N,
        nu = v0 + N,
        mx = (b0 * mx0 + N * xb) / be,
        my = (b0 * my0 + N * yb) / be,
        f = (b0 * N) / (b0 + N),
        ux = xb - mx0,
        uy = yb - my0,
        ia = W0inv + a + f * ux * ux,
        ib = b + f * ux * uy,
        ie = W0inv + e + f * uy * uy,
        det = Math.max(1e-12, ia * ie - ib * ib);
      st.push({
        N,
        al,
        be,
        nu,
        mx,
        my,
        W: [ie / det, -ib / det, ia / det],
        logW: -Math.log(det),
        S: [ia / (nu - 3), ib / (nu - 3), ie / (nu - 3)],
      });
    }
    return st;
  };
  const ellOf = (s: St[]): Ell[] => s.flatMap((q, c) => (q.N > 2 ? [{ x: q.mx, y: q.my, s: q.S, c }] : []));
  let cur = M();
  run.frames.push({ st: 0, say: `成分 ${K} 個を多めに配置`, ms: 900, ell: ellOf(cur) });
  for (let it = 1; it <= p.viter; it++) {
    const sumA = cur.reduce((v, q) => v + q.al, 0),
      elnPi = cur.map((q) => digamma(q.al) - digamma(sumA)),
      elnL = cur.map((q) => digamma(q.nu / 2) + digamma((q.nu - 1) / 2) + 2 * Math.LN2 + q.logW);
    let ch = 0;
    for (let i = 0; i < n; i++) {
      let mxv = -Infinity;
      const ln = cur.map((q, c) => {
        const u = d.x[i] - q.mx,
          t = d.y[i] - q.my,
          v =
            elnPi[c] +
            0.5 * elnL[c] -
            Math.log(2 * Math.PI) -
            0.5 * (2 / q.be + q.nu * (q.W[0] * u * u + 2 * q.W[1] * u * t + q.W[2] * t * t));
        if (v > mxv) mxv = v;
        return v;
      });
      let s = 0;
      const e = ln.map((v) => Math.exp(v - mxv));
      for (const v of e) s += v;
      for (let c = 0; c < K; c++) {
        const nv = e[c] / s;
        ch = Math.max(ch, Math.abs(nv - R[i * K + c]));
        R[i * K + c] = nv;
      }
    }
    run.dist += n * K;
    run.iters = it;
    const snap = R.slice();
    run.frames.push({
      st: 1,
      say: `${it} 回目の所属確率`,
      ms: it < 12 ? 180 : 50,
      soft: { r: snap, k: K },
      ell: ellOf(cur),
    });
    cur = M();
    const live = cur.filter((q) => q.N > 2).length;
    run.frames.push({
      st: 2,
      say: `${it} 回目の分布の更新　残り ${live} 成分`,
      ms: it < 12 ? 180 : 50,
      soft: { r: snap, k: K },
      ell: ellOf(cur),
    });
    if (ch < 1e-3) break;
  }
  const l = argmaxSoft(R, n, K);
  run.frames.push({
    st: 3,
    say: `${new Set(l).size} 成分で完了`,
    ms: 1000,
    soft: { r: R.slice(), k: K },
    ell: ellOf(cur),
  });
  return finish(run, d, l);
}
