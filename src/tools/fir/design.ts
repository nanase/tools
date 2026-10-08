/**
 * 仕様から係数を求める（DOM に依存しない。ページと Worker の両方から使う）。
 * タップ数・β・重みを仕様から決める（auto）か、指定の値で設計し、周波数特性・実際の値・零点まで求める
 */
import { type Freq, freqResp, type IirOrder, iirOrder, type Metrics, measure, roots, type Zeros } from './analysis';
import { leastSquares } from './ls';
import { remez, type WBand } from './remez';
import { type Band, bandsOf, dpOf, dsOf, needsOdd, type Resp } from './spec';
import { kaiserBeta, kaiserOrder, WIN_K, type Win, windowDesign } from './window';

export type Method = 'window' | 'remez' | 'ls';

/** タップ数の上限 */
export const N_MAX = 1023;
export const N_MIN = 3;

export interface Spec {
  t: Resp;
  /** サンプリング周波数 [Hz] */
  fs: number;
  /** 遷移帯域の中央 [Hz]（f2 は BPF・BSF だけ） */
  f1: number;
  f2: number;
  /** 遷移帯域幅 [Hz] */
  df: number;
  /** 通過域のリップル [dB]（ピーク間）と阻止域の減衰 [dB] */
  ap: number;
  as: number;
  method: Method;
  win: Win;
  /** タップ数・β・重みを仕様から求める */
  auto: boolean;
  /** 指定のタップ数・β・重み（auto のときは使わない） */
  n: number;
  beta: number;
  wp: number;
  ws: number;
}

export interface Design {
  h: Float64Array;
  N: number;
  /** 窓関数法の理想の応答と窓 */
  hd?: Float64Array;
  w?: Float64Array;
  /** 使った β・重み */
  beta: number;
  wp: number;
  ws: number;
  /** 等リップル: 重み付き誤差 δ・反復回数・収束したか・交換が進まず最小二乗法の係数にしたか */
  delta?: number;
  iter?: number;
  converged?: boolean;
  fallback?: boolean;
  /** タップ数を上限で打ち切った（仕様を満たす長さに届かない） */
  capped: boolean;
}

/** 仕様の帯域（fs で割った周波数） */
export const specBands = (s: Spec): Band[] => bandsOf(s.t, s.f1 / s.fs, s.f2 / s.fs, s.df / s.fs);

/** 遷移帯域幅 [rad/sample] */
const dwOf = (s: Spec): number => (2 * Math.PI * s.df) / s.fs;

/** N を種類に合う長さ（HPF・BSF は奇数）にして範囲に収める */
export function fitN(t: Resp, n: number): number {
  let N = Math.round(n);
  if (needsOdd(t) && N % 2 === 0) N++;
  N = Math.max(N_MIN, N);
  if (N > N_MAX) N = needsOdd(t) && N_MAX % 2 === 0 ? N_MAX - 1 : N_MAX;
  return N;
}

/** 窓関数法のタップ数の目安。カイザー窓は Kaiser の式、ほかは窓ごとの遷移帯域幅 Δf·N から */
export function windowTaps(s: Spec): number {
  if (s.win === 'kaiser') {
    const A = -20 * Math.log10(Math.min(dpOf(s.ap), dsOf(s.as)));
    return Math.ceil(kaiserOrder(A, dwOf(s)) - 1e-9) + 1;
  }
  return Math.ceil((WIN_K[s.win].k * s.fs) / s.df - 1e-9);
}

/** 等リップルのタップ数の目安（O&S の式 (7.117)、Kaiser による） */
export function remezTaps(s: Spec): number {
  const M = (-10 * Math.log10(dpOf(s.ap) * dsOf(s.as)) - 13) / (2.324 * dwOf(s));
  return Math.ceil(M - 1e-9) + 1;
}

/** 重み付きの帯域（通過域 1・阻止域 0） */
const wbands = (s: Spec, wp: number, ws: number): WBand[] =>
  specBands(s).map((b) => ({ lo: b.lo, hi: b.hi, d: b.pass ? 1 : 0, w: b.pass ? wp : ws }));

/** 指定の N・β・重みで設計する */
function designN(s: Spec, N: number, beta: number, wp: number, ws: number): Design {
  if (s.method === 'window') {
    const r = windowDesign(s.t, N, s.f1 / s.fs, s.f2 / s.fs, s.win, s.win === 'kaiser' ? beta : 0);
    return { ...r, N, beta, wp, ws, capped: false };
  }
  const b = wbands(s, wp, ws);
  if (s.method === 'remez') {
    const r = remez(N, b);
    return {
      h: r.h,
      N,
      beta,
      wp,
      ws,
      delta: r.delta,
      iter: r.iter,
      converged: r.converged,
      fallback: r.fallback,
      capped: false,
    };
  }
  return { h: leastSquares(N, b), N, beta, wp, ws, capped: false };
}

/** 仕様を満たすか（通過域は 1 ± δp、阻止域は δs 以下） */
function meets(s: Spec, d: Design): boolean {
  const m = measure(d.h, freqResp(d.h), specBands(s), dpOf(s.ap), dsOf(s.as));
  return m.dp <= dpOf(s.ap) * (1 + 1e-6) && m.ds <= dsOf(s.as) * (1 + 1e-6);
}

/**
 * 仕様を満たす最小のタップ数を探す。目安 n0 から上下に倍々で広げて満たす長さと満たさない長さを挟み、二分探索で詰める。
 * 長さを延ばすほど誤差が減るとみなす
 */
function searchN(s: Spec, n0: number, make: (N: number) => Design): Design {
  const step = needsOdd(s.t) ? 2 : 1,
    cache = new Map<number, Design>(),
    get = (N: number) => {
      let d = cache.get(N);
      if (!d) {
        d = make(N);
        cache.set(N, d);
      }
      return d;
    },
    ok = (N: number) => meets(s, get(N)),
    /* k 番目の長さ（N_MIN 以上、N_MAX 以下の、種類に合う長さ） */
    lo0 = fitN(s.t, N_MIN),
    hi0 = fitN(s.t, N_MAX),
    clampN = (N: number) => Math.min(hi0, Math.max(lo0, fitN(s.t, N)));
  let n = clampN(n0);
  let good: number, bad: number;
  if (ok(n)) {
    good = n;
    let d = step;
    for (;;) {
      const m = clampN(good - d);
      if (m === good) {
        bad = good - step;
        break;
      }
      if (ok(m)) {
        good = m;
        d *= 2;
      } else {
        bad = m;
        break;
      }
    }
  } else {
    bad = n;
    let d = step;
    for (;;) {
      const m = clampN(bad + d);
      if (m === bad) {
        const r = get(bad);
        return { ...r, capped: true };
      }
      if (ok(m)) {
        good = m;
        break;
      }
      bad = m;
      d *= 2;
    }
  }
  while (good - bad > step) {
    n = clampN(bad + Math.floor((good - bad) / step / 2) * step);
    if (n === bad || n === good) break;
    if (ok(n)) good = n;
    else bad = n;
  }
  return get(good);
}

/** 仕様から（または指定の値で）設計する */
export function design(s: Spec): Design {
  if (!s.auto) {
    const N = fitN(s.t, s.n);
    return designN(s, N, s.beta, s.wp, s.ws);
  }
  const dp = dpOf(s.ap),
    ds = dsOf(s.as);
  if (s.method === 'window') {
    const beta = kaiserBeta(-20 * Math.log10(Math.min(dp, ds))),
      want = windowTaps(s),
      N = fitN(s.t, want);
    return { ...designN(s, N, beta, 1, 1), capped: want > N };
  }
  /* 重み: 等リップルは誤差の比が δp : δs になるように、最小二乗は二乗誤差なのでその 2 乗 */
  const k = dp / ds,
    ws = s.method === 'remez' ? k : k * k;
  return searchN(s, remezTaps(s), (N) => designN(s, N, 0, 1, ws));
}

/** 設計と解析の結果（Worker から返す） */
export interface Result {
  d: Design;
  fr: Freq;
  m: Metrics;
  iir: IirOrder;
  /** 零点 */
  z: Zeros;
}

export function run(s: Spec): Result {
  const d = design(s),
    fr = freqResp(d.h),
    m = measure(d.h, fr, specBands(s), dpOf(s.ap), dsOf(s.as)),
    iir = iirOrder(s.t, s.f1 / s.fs, s.f2 / s.fs, s.df / s.fs, s.ap, s.as);
  return { d, fr, m, iir, z: roots(d.h) };
}
