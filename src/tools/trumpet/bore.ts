/**
 * 管の形（DOM に依存しない）。B♭ トランペットの内径を、公開の製品寸法と教科書の関数形から組み立てる。
 * マウスピース（カップ・スロート・バックボア）→ リードパイプ（円錐）→ 円筒部（主管抜差しと 3 本の弁）→ ベル（Bessel ホーン）
 */

/** 空気の定数（Benade・Keefe の温度式。T [°C]） */
export interface Air {
  c: number;
  rho: number;
  eta: number;
  gamma: number;
}
export function air(T = 27): Air {
  const d = T - 26.85;
  return {
    c: 347.23 * (1 + 0.00166 * d),
    rho: 1.1769 * (1 - 0.00335 * d),
    eta: 1.846e-5 * (1 + 0.0025 * d),
    gamma: 1.4017 * (1 - 0.00002 * d),
  };
}

/** 管の形の数値 [m] */
export interface BoreSpec {
  /** カップの縁の内半径、カップの深さ、カップの形の指数（大きいほど深い椀） */
  rimR: number;
  cupDepth: number;
  cupShape: number;
  /** スロートの半径と長さ */
  throatR: number;
  throatLen: number;
  /** バックボアの終わりの半径、マウスピースの全長、広がりの指数（1 で円錐） */
  shankR: number;
  mpLen: number;
  bbExp: number;
  /** リードパイプの入口の半径、長さ、広がりの指数（1 で円錐、大きいほど入口の近くで広がる） */
  lpR: number;
  lpLen: number;
  lpExp: number;
  /** 円筒部の半径と長さ（弁を押していないとき） */
  cylR: number;
  cylLen: number;
  /** ベルの長さ、開口の半径、Bessel ホーンの指数 */
  bellLen: number;
  bellR: number;
  bellExp: number;
}

/**
 * 既定の形。円筒の内径 11.66 mm（0.459 in）、ベル 123 mm、スロート 3.66 mm（#27）、カップ 16.3 mm は
 * 製品の公表寸法。カップの深さと形、各部の長さと広がりの指数、ベルの指数はこのツールで決めた（伝達行列で
 * 第 2〜第 8 の共鳴が調和列から ±11 セントに並び、マウスピースの popping が約 820 Hz になるように探した）
 */
export const SPEC: BoreSpec = {
  rimR: 8.15e-3,
  cupDepth: 8.4e-3,
  cupShape: 1.6,
  throatR: 1.83e-3,
  throatLen: 6e-3,
  shankR: 4.3e-3,
  mpLen: 88e-3,
  bbExp: 0.6,
  lpR: 4.45e-3,
  lpLen: 0.249,
  lpExp: 1.19,
  cylR: 5.83e-3,
  cylLen: 0.4034,
  bellLen: 0.66,
  bellR: 61.5e-3,
  bellExp: 0.663,
};

/** 区間の種類: 円筒部（弁が入る）とそれ以外 */
export interface Profile {
  /** 位置 [m] と半径 [m] の折れ線（円筒部の前まで・円筒部の後から） */
  head: { x: Float64Array; r: Float64Array };
  tail: { x: Float64Array; r: Float64Array };
  cylR: number;
  cylLen: number;
  bellR: number;
}

/** 折れ線を作る。刻みは 0.5 mm（ベルの開口の近くは細かく） */
export function profile(s: BoreSpec = SPEC): Profile {
  const hx: number[] = [],
    hr: number[] = [];
  const push = (x: number, r: number) => {
    hx.push(x);
    hr.push(r);
  };
  /* カップ: r = rt + (R − rt)(1 − (x/d)^p)^(1/p) の椀 */
  const nc = 36;
  for (let i = 0; i <= nc; i++) {
    const u = i / nc,
      x = u * s.cupDepth,
      w = (1 - u ** s.cupShape) ** (1 / s.cupShape);
    push(x, s.throatR + (s.rimR - s.throatR) * w);
  }
  const x1 = s.cupDepth + s.throatLen;
  push(x1, s.throatR);
  /* バックボア: r = rt + (rs − rt) u^b */
  const nb0 = 24;
  for (let i = 1; i <= nb0; i++) {
    const u = i / nb0;
    push(x1 + u * (s.mpLen - x1), s.throatR + (s.shankR - s.throatR) * u ** s.bbExp);
  }
  /* 受け口の段差とリードパイプ: r = r0 + (rc − r0)(1 − (1 − u)^e) */
  const nl = 24;
  for (let i = 0; i <= nl; i++) {
    const u = i / nl;
    push(s.mpLen + u * s.lpLen, s.lpR + (s.cylR - s.lpR) * (1 - (1 - u) ** s.lpExp));
  }
  /* ベル: r = B / (x0 − x)^γ。始まりで cylR、開口で bellR */
  const tx: number[] = [],
    tr: number[] = [];
  const q = (s.bellR / s.cylR) ** (1 / s.bellExp),
    delta = s.bellLen / (q - 1),
    nb = 240;
  for (let i = 0; i <= nb; i++) {
    /* 開口の近くほど細かく */
    const u = 1 - (1 - i / nb) ** 2,
      x = u * s.bellLen;
    tx.push(x);
    tr.push(s.bellR * (delta / (delta + s.bellLen - x)) ** s.bellExp);
  }
  return {
    head: { x: Float64Array.from(hx), r: Float64Array.from(hr) },
    tail: { x: Float64Array.from(tx), r: Float64Array.from(tr) },
    cylR: s.cylR,
    cylLen: s.cylLen,
    bellR: s.bellR,
  };
}

/** 折れ線の長さ */
export const lenOf = (p: { x: Float64Array }) => p.x[p.x.length - 1] - p.x[0];

/** 折れ線の半径を位置 x で読む */
export function radiusAt(p: { x: Float64Array; r: Float64Array }, x: number): number {
  const { x: X, r: R } = p,
    n = X.length;
  if (x <= X[0]) return R[0];
  if (x >= X[n - 1]) return R[n - 1];
  let lo = 0,
    hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (X[m] <= x) lo = m;
    else hi = m;
  }
  const d = X[hi] - X[lo];
  return d > 0 ? R[lo] + ((R[hi] - R[lo]) * (x - X[lo])) / d : R[hi];
}

/** 区間 [a, b] の容積 [m³]（円錐台の和） */
export function volumeOf(p: { x: Float64Array; r: Float64Array }, a: number, b: number): number {
  const X = p.x;
  let v = 0;
  for (let i = 0; i + 1 < X.length; i++) {
    const x0 = Math.max(X[i], a),
      x1 = Math.min(X[i + 1], b);
    if (x1 <= x0) continue;
    const r0 = radiusAt(p, x0),
      r1 = radiusAt(p, x1);
    v += (Math.PI * (x1 - x0) * (r0 * r0 + r0 * r1 + r1 * r1)) / 3;
  }
  return v;
}

/** 弁: 押すと円筒部に加わる長さ [m]（第 1・第 2・第 3 弁）。tune.ts の計算で合わせた値 */
export const VALVE_LEN = [0.18, 0.0877, 0.277] as const;

/** 指使い（押す弁の組）と、その弁で下がる半音の数 */
export const FINGERINGS: readonly { v: readonly [boolean, boolean, boolean]; semi: number }[] = [
  { v: [false, false, false], semi: 0 },
  { v: [false, true, false], semi: 1 },
  { v: [true, false, false], semi: 2 },
  { v: [true, true, false], semi: 3 },
  { v: [false, true, true], semi: 4 },
  { v: [true, false, true], semi: 5 },
  { v: [true, true, true], semi: 6 },
];
