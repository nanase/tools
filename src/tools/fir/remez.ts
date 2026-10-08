/**
 * 等リップル近似: Parks–McClellan 法（Remez の交換法）。直線位相・対称（タイプ I・II）の FIR フィルタを求める。
 * T. W. Parks, J. H. McClellan, "Chebyshev Approximation for Nonrecursive Digital Filters with Linear Phase",
 * IEEE Trans. Circuit Theory, CT-19(2), 1972 と、J. H. McClellan, T. W. Parks, L. R. Rabiner,
 * "A Computer Program for Designing Optimum FIR Linear Phase Digital Filters", IEEE Trans. Audio Electroacoust.,
 * AU-21(6), 1973 の手順を元に、ラグランジュ補間の重みを対数で求めて長いフィルタでも桁あふれしないようにした
 */
import { leastSquares } from './ls';

export interface WBand {
  /** 帯域の端（fs で割った周波数 0 … 0.5） */
  lo: number;
  hi: number;
  /** 望む振幅 */
  d: number;
  /** 重み */
  w: number;
}

export interface RemezResult {
  h: Float64Array;
  /** 重み付き誤差の最大値 δ（帯域ごとの誤差は δ/w） */
  delta: number;
  /** 反復の回数 */
  iter: number;
  converged: boolean;
  /** 交換が進まず、最小二乗法の係数を返した */
  fallback?: boolean;
  /** 最後の極値の周波数（fs で割った値） */
  ext: Float64Array;
}

/** 極値の候補: 周波数・帯域・重み付き誤差・帯域の端か */
interface Ext {
  f: number;
  b: number;
  e: number;
  edge: boolean;
}

/**
 * 交互の符号の極値が r + 1 個より多いとき、絶対値の小さいものから除く（交互の並びを保つ）。
 * 端なら 1 つ、途中なら隣の小さい方と 2 つずつ除く
 */
export function trimExt<T extends { e: number }>(L: T[], want: number): T[] {
  const a = L.slice();
  while (a.length > want) {
    let k = 0;
    for (let i = 1; i < a.length; i++) if (Math.abs(a[i].e) < Math.abs(a[k].e)) k = i;
    if (a.length - want === 1 || k === 0 || k === a.length - 1) {
      if (k !== 0 && k !== a.length - 1)
        /* 1 つだけ除くときは、端の小さい方 */
        k = Math.abs(a[0].e) < Math.abs(a[a.length - 1].e) ? 0 : a.length - 1;
      a.splice(k, 1);
    } else {
      const j = Math.abs(a[k - 1].e) < Math.abs(a[k + 1].e) ? k - 1 : k + 1;
      a.splice(Math.min(j, k), 2);
    }
  }
  return a;
}

/** Σ α_k T_k(x_j) = c_j（T_k は第 1 種チェビシェフ多項式、cos kω = T_k(cos ω)）を解く */
export function solveCos(x: Float64Array, c: Float64Array): Float64Array {
  const r = x.length,
    A = new Float64Array(r * (r + 1));
  for (let j = 0; j < r; j++) {
    /* T_0 = 1、T_1 = x、T_{k+1} = 2x T_k − T_{k−1} */
    let t0 = 1,
      t1 = x[j];
    for (let k = 0; k < r; k++) {
      A[j * (r + 1) + k] = t0;
      [t0, t1] = [t1, 2 * x[j] * t1 - t0];
    }
    A[j * (r + 1) + r] = c[j];
  }
  const w = r + 1;
  for (let k = 0; k < r; k++) {
    let p = k;
    for (let i = k + 1; i < r; i++) if (Math.abs(A[i * w + k]) > Math.abs(A[p * w + k])) p = i;
    if (p !== k)
      for (let l = k; l <= r; l++) {
        const t = A[k * w + l];
        A[k * w + l] = A[p * w + l];
        A[p * w + l] = t;
      }
    const d = A[k * w + k] || 1e-300;
    for (let i = k + 1; i < r; i++) {
      const f = A[i * w + k] / d;
      if (!f) continue;
      for (let l = k; l <= r; l++) A[i * w + l] -= f * A[k * w + l];
    }
  }
  const a = new Float64Array(r);
  for (let k = r - 1; k >= 0; k--) {
    let s = A[k * w + r];
    for (let l = k + 1; l < r; l++) s -= A[k * w + l] * a[l];
    a[k] = s / (A[k * w + k] || 1e-300);
  }
  return a;
}

/**
 * 長さ N の対称な FIR フィルタを、重み付きチェビシェフ近似で求める。
 * density は極値 1 つあたりの格子点の数
 */
export function remez(N: number, bands: readonly WBand[], density = 16, maxIter = 60): RemezResult {
  if (N < 3) throw new RangeError('タップ数は 3 以上');
  const odd = N % 2 === 1,
    r = odd ? (N + 1) / 2 : N / 2;

  /* ---------- 格子 ---------- */
  let gf: number[] = [],
    gb: number[] = [],
    delf = 0;
  /** 帯域の上端（タイプ II は fs/2 を除く） */
  const bhi = bands.map((b) => b.hi);
  for (let dens = density; ; dens *= 2) {
    delf = 0.5 / (dens * r);
    gf = [];
    gb = [];
    bands.forEach((b, j) => {
      let hi = b.hi;
      /* タイプ II は fs/2 で振幅が 0 になるので、その点を除く */
      if (!odd && hi > 0.5 - delf) hi = 0.5 - delf;
      bhi[j] = hi;
      if (hi < b.lo) return;
      const n = Math.max(1, Math.ceil((hi - b.lo) / delf - 1e-9));
      for (let k = 0; k <= n; k++) {
        gf.push(k === n ? hi : b.lo + k * delf);
        gb.push(j);
      }
    });
    if (gf.length >= 4 * (r + 1) || dens > 4096) break;
  }
  const G = gf.length;
  if (G < r + 1) throw new RangeError('帯域が狭すぎる');
  /** 帯域 b の周波数 f での、Q で割った望む振幅 D′ と Q を掛けた重み W′ */
  const dOf = (f: number, b: number) => bands[b].d / (odd ? 1 : Math.cos(Math.PI * f)),
    wOf = (f: number, b: number) => bands[b].w * (odd ? 1 : Math.cos(Math.PI * f));
  const X = new Float64Array(G),
    D = new Float64Array(G),
    W = new Float64Array(G);
  for (let i = 0; i < G; i++) {
    X[i] = Math.cos(2 * Math.PI * gf[i]);
    D[i] = dOf(gf[i], gb[i]);
    W[i] = wOf(gf[i], gb[i]);
  }

  /* ---------- 交換の反復 ---------- */
  /*
   * 極値は格子の上で探し、格子の間の本当の極値の位置へ詰めてから使う（格子が粗くても等リップルになる）。
   * 今の極値の組も候補に入れる（その点では誤差が ±δ を交互にとるので、交互の候補が必ず r + 1 個そろう）
   */
  const ef = Float64Array.from({ length: r + 1 }, (_, j) => gf[Math.round((j * (G - 1)) / r)]),
    eb = Int32Array.from({ length: r + 1 }, (_, j) => gb[Math.round((j * (G - 1)) / r)]),
    x = new Float64Array(r + 1),
    ed = new Float64Array(r + 1),
    ew = new Float64Array(r + 1),
    a = new Float64Array(r + 1),
    bw = new Float64Array(r),
    C = new Float64Array(r),
    E = new Float64Array(G);
  let delta = 0,
    iter = 0,
    excess = Infinity;

  /** 極値の点で δ と補間の値・重みを求める */
  const solve = () => {
    for (let j = 0; j <= r; j++) {
      x[j] = Math.cos(2 * Math.PI * ef[j]);
      ed[j] = dOf(ef[j], eb[j]);
      ew[j] = wOf(ef[j], eb[j]);
    }
    /* ラグランジュの重み 1/Π(x_j − x_i) を対数で求め、最大を 1 にそろえる */
    const lg = new Float64Array(r + 1),
      sg = new Int8Array(r + 1);
    let mn = Infinity;
    for (let j = 0; j <= r; j++) {
      let l = 0,
        s = 1;
      for (let i = 0; i <= r; i++) {
        if (i === j) continue;
        const d = x[j] - x[i];
        if (d < 0) s = -s;
        l += Math.log(Math.abs(d) || 1e-300);
      }
      lg[j] = l;
      sg[j] = s;
      if (l < mn) mn = l;
    }
    for (let j = 0; j <= r; j++) a[j] = sg[j] * Math.exp(mn - lg[j]);
    let nu = 0,
      de = 0;
    for (let j = 0; j <= r; j++) {
      nu += a[j] * ed[j];
      de += ((j % 2 ? -1 : 1) * a[j]) / ew[j];
    }
    delta = nu / de;
    for (let j = 0; j < r; j++) {
      C[j] = ed[j] - ((j % 2 ? -1 : 1) * delta) / ew[j];
      bw[j] = a[j] * (x[j] - x[r]);
    }
  };
  /** 補間した振幅（重心形のラグランジュ補間） */
  const P = (xx: number): number => {
    let nu = 0,
      de = 0;
    for (let j = 0; j < r; j++) {
      const d = xx - x[j];
      if (d === 0) return C[j];
      const t = bw[j] / d;
      nu += t * C[j];
      de += t;
    }
    return nu / de;
  };
  /** 帯域 b の周波数 f での重み付き誤差 */
  const err = (f: number, b: number) => wOf(f, b) * (dOf(f, b) - P(Math.cos(2 * Math.PI * f)));
  /** [lo, hi] で s·E が最大になる周波数と、そこでの誤差（黄金分割探索） */
  const refine = (lo: number, hi: number, b: number, s: number): [number, number] => {
    const g = (Math.sqrt(5) - 1) / 2;
    let c = hi - g * (hi - lo),
      d = lo + g * (hi - lo),
      ec = s * err(c, b),
      edd = s * err(d, b);
    for (let k = 0; k < 18; k++) {
      if (ec > edd) {
        hi = d;
        d = c;
        edd = ec;
        c = hi - g * (hi - lo);
        ec = s * err(c, b);
      } else {
        lo = c;
        c = d;
        ec = edd;
        d = lo + g * (hi - lo);
        edd = s * err(d, b);
      }
    }
    return ec > edd ? [c, s * ec] : [d, s * edd];
  };
  const isEdge = (f: number, b: number) => f <= bands[b].lo || f >= bhi[b];

  /** 格子の上の誤差 E の、帯域ごとの極値（帯域の端も候補）と extra を、交互の符号に並べる */
  const alternate = (extra: Ext[], floor: number): Ext[] => {
    let cand: Ext[] = [];
    for (let i = 0; i < G; i++) {
      const e = E[i],
        pv = i > 0 && gb[i - 1] === gb[i] ? E[i - 1] : null,
        nx = i < G - 1 && gb[i + 1] === gb[i] ? E[i + 1] : null;
      if (e > 0 ? (pv == null || e >= pv) && (nx == null || e > nx) : (pv == null || e <= pv) && (nx == null || e < nx))
        cand.push({ f: gf[i], b: gb[i], e, edge: pv == null || nx == null });
    }
    cand.push(...extra);
    cand.sort((p, q) => p.f - q.f);
    /* 十分小さい極値は使わない（足りなくなるときは残す） */
    const big = cand.filter((c) => Math.abs(c.e) >= floor);
    if (big.length >= r + 1) cand = big;
    /* 同じ符号が続くところは絶対値の大きい方を残す */
    const alt: Ext[] = [];
    for (const c of cand) {
      const l = alt[alt.length - 1];
      if (l && Math.sign(l.e) === Math.sign(c.e)) {
        if (Math.abs(c.e) > Math.abs(l.e)) alt[alt.length - 1] = c;
      } else alt.push(c);
    }
    return alt;
  };

  /** 交換を繰り返す。交互の極値が r + 1 個そろわなくなったら（誤差が丸め誤差に埋もれたら）false */
  const iterate = (): boolean => {
    while (iter < maxIter) {
      iter++;
      solve();
      for (let i = 0; i < G; i++) E[i] = W[i] * (D[i] - P(X[i]));
      const now = Array.from({ length: r + 1 }, (_, j) => ({
        f: ef[j],
        b: eb[j],
        e: err(ef[j], eb[j]),
        edge: isEdge(ef[j], eb[j]),
      }));
      const alt = alternate(now, Math.abs(delta) * 0.9);
      if (alt.length < r + 1) return false;
      /* 格子の間の極値へ詰める（帯域の端はそのまま） */
      let mx = 0;
      trimExt(alt, r + 1).forEach((c, j) => {
        eb[j] = c.b;
        if (c.edge) {
          ef[j] = c.f;
          mx = Math.max(mx, Math.abs(c.e));
        } else {
          const [f, e] = refine(
            Math.max(bands[c.b].lo, c.f - delf),
            Math.min(bhi[c.b], c.f + delf),
            c.b,
            Math.sign(c.e) || 1,
          );
          ef[j] = f;
          mx = Math.max(mx, Math.abs(e));
        }
      });
      excess = (mx - Math.abs(delta)) / Math.abs(delta);
      if (excess <= 1e-7) return true;
    }
    return true;
  };

  let h0: Float64Array | null = null;
  /** 係数 h の重み付き誤差を格子の上で E に入れ、最大の絶対値を返す */
  const errOf = (h: Float64Array): number => {
    const M = (N - 1) / 2;
    let mx = 0;
    for (let i = 0; i < G; i++) {
      let A = 0;
      for (let n = 0; n < N; n++) A += h[n] * Math.cos(2 * Math.PI * gf[i] * (n - M));
      const b = bands[gb[i]];
      E[i] = b.w * (b.d - A);
      mx = Math.max(mx, Math.abs(E[i]));
    }
    return mx;
  };
  /**
   * 最小二乗法の解の誤差の極値を、最初の極値の組にする。等間隔の初期値では δ が丸め誤差より小さくなって
   * 交換が進まない（長いフィルタで遷移帯域が狭いとき）ときに使う
   */
  const fromLs = (): boolean => {
    h0 = leastSquares(N, bands);
    errOf(h0);
    let alt = alternate([], 0);
    if (alt.length > r + 1) alt = trimExt(alt, r + 1);
    else if (alt.length < r + 1) {
      /* 足りない分は帯域の端で補う（最初の組は交互でなくてよい） */
      for (const [b, bd] of bands.entries())
        for (const f of [bd.lo, bhi[b]])
          if (alt.length < r + 1 && f <= bhi[b] && !alt.some((c) => Math.abs(c.f - f) < delf / 2))
            alt.push({ f, b, e: 0, edge: true });
      if (alt.length < r + 1) return false;
      alt.sort((p, q) => p.f - q.f);
    }
    alt.forEach((c, j) => {
      ef[j] = c.f;
      eb[j] = c.b;
    });
    return true;
  };

  let ok = iterate();
  if (!ok && fromLs()) {
    excess = Infinity;
    ok = iterate();
  }
  /* どちらの初期値でも交換が進まないときは、最小二乗法の係数を返す */
  if (!ok && h0) return { h: h0, delta: errOf(h0), iter, converged: false, fallback: true, ext: ef };
  const converged = excess <= 1e-4;
  solve();

  /* ---------- 係数 ---------- */
  /*
   * P(ω) = Σ α_k cos kω が極値の点で C_j をとるように、連立方程式を部分ピボット選択のガウスの消去法で解く。
   * 等間隔の標本から求める方法（逆 DFT）は遷移帯域の中で補間した値を使うため、長いフィルタでは丸め誤差が
   * 増えて帯域の中へ広がる。直接解けば、帯域の中の振幅は丸め誤差の程度に合う
   */
  const al = solveCos(
    Float64Array.from({ length: r }, (_, j) => x[j]),
    C,
  );
  const h = new Float64Array(N);
  if (odd) {
    const M = r - 1;
    h[M] = al[0];
    for (let k = 1; k < r; k++) h[M - k] = h[M + k] = al[k] / 2;
  } else {
    /* cos(ω/2) Σ α_k cos kω = Σ b_k cos((k − 1/2)ω) */
    const H = N / 2;
    for (let k = 1; k <= r; k++) {
      const b = k === 1 ? al[0] + (r > 1 ? al[1] / 2 : 0) : (al[k - 1] + (k < r ? al[k] : 0)) / 2;
      h[H - k] = h[H - 1 + k] = b / 2;
    }
  }
  return { h, delta: Math.abs(delta), iter, converged, ext: ef };
}
