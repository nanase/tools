/**
 * 分岐図のページの計算: 1 次元の写像（ロジスティク・正弦・テント）の軌道、リアプノフ指数、周期の判定、
 * 分岐図の 1 列の濃さ、超安定な周期 2ⁿ の値と Feigenbaum 定数、周期倍分岐・接線分岐の位置
 */

export type MapId = 'logistic' | 'sine' | 'tent';

export interface MapDef {
  id: MapId;
  /** パラメータの範囲（写像が [0, 1] を [0, 1] へ写す範囲） */
  lo: number;
  hi: number;
  /** 分岐図の既定の表示範囲 */
  view: readonly [number, number];
  /** 極大の位置 */
  c: number;
  /** 極大が滑らか（2 次）か。テント写像は折れ目なので超安定な周期がない */
  smooth: boolean;
  f(x: number, r: number): number;
  /** ∂f/∂x */
  dx(x: number, r: number): number;
  /** ∂f/∂r */
  dr(x: number, r: number): number;
  /** 周期 1・2 の超安定な値の初めの見積り（Newton 法の出発点） */
  seed?: readonly [number, number];
}

/**
 * テント写像の傾き 2 は、2 進の浮動小数点では 1 回ごとに下の桁が 1 つずつ消え、約 55 回で 0 に落ちる。
 * 2 にごく近い傾きに置き換え、掛け算の丸めで桁を補う（このツールで決めたこと）
 */
const TENT_MAX = 2 - 1e-12;

export const MAPS: Record<MapId, MapDef> = {
  logistic: {
    id: 'logistic',
    lo: 0,
    hi: 4,
    view: [2.8, 4],
    c: 0.5,
    smooth: true,
    f: (x, r) => r * x * (1 - x),
    dx: (x, r) => r * (1 - 2 * x),
    dr: (x) => x * (1 - x),
    seed: [2, 1 + Math.sqrt(5)],
  },
  sine: {
    id: 'sine',
    lo: 0,
    hi: 1,
    view: [0.7, 1],
    c: 0.5,
    smooth: true,
    f: (x, r) => r * Math.sin(Math.PI * x),
    dx: (x, r) => r * Math.PI * Math.cos(Math.PI * x),
    dr: (x) => Math.sin(Math.PI * x),
    seed: [0.5, 0.78],
  },
  tent: {
    id: 'tent',
    lo: 0,
    hi: 2,
    view: [1, 2],
    c: 0.5,
    smooth: false,
    f: (x, r) => Math.min(r, TENT_MAX) * (x < 0.5 ? x : 1 - x),
    dx: (x, r) => (x < 0.5 ? r : -r),
    dr: (x) => (x < 0.5 ? x : 1 - x),
  },
};

/** 値を [0, 1] に収める（丸めで外へ出た値と NaN を戻す） */
const clamp01 = (x: number): number => (x > 0 ? (x < 1 ? x : 1) : 0);

/** x から n 回写した値 */
export function iterate(m: MapDef, r: number, x: number, n: number): number {
  for (let i = 0; i < n; i++) x = clamp01(m.f(x, r));
  return x;
}

/** x0 から始めた軌道 x0, x1, …, x(n−1) */
export function orbit(m: MapDef, r: number, x0: number, n: number): Float64Array {
  const o = new Float64Array(n);
  let x = x0;
  for (let i = 0; i < n; i++) {
    o[i] = x;
    x = clamp01(m.f(x, r));
  }
  return o;
}

/**
 * リアプノフ指数 λ = (1/n) Σ ln |f′(xₖ)|（skip 回の過渡を捨てた n 回の平均）。
 * 超安定な周期で極大に乗ると f′ = 0 になるので、|f′| の下限を 1e-300 にする（λ は大きな負の値）
 */
export function lyapunov(m: MapDef, r: number, x0: number, skip: number, n: number): number {
  let x = iterate(m, r, x0, skip),
    s = 0;
  for (let i = 0; i < n; i++) {
    s += Math.log(Math.max(Math.abs(m.dx(x, r)), 1e-300));
    x = clamp01(m.f(x, r));
  }
  return s / n;
}

/** 過渡を捨てたあとの周期（maxP 以下で、tol 以内で戻れば周期とみなす）。見つからなければ 0 */
export function period(m: MapDef, r: number, x0: number, skip = 4000, maxP = 128, tol = 1e-7): number {
  const x = iterate(m, r, x0, skip);
  let y = x;
  for (let p = 1; p <= maxP; p++) {
    y = clamp01(m.f(y, r));
    if (Math.abs(y - x) < tol) return p;
  }
  return 0;
}

/**
 * 分岐図の 1 列: 過渡 skip 回のあと keep 回の値を、縦 [y0, y1] を H 個に分けた升へ数える。
 * out[i] は下から i 番目の升の回数（out は呼ぶ側が 0 にする）
 */
export function column(
  m: MapDef,
  r: number,
  x0: number,
  skip: number,
  keep: number,
  y0: number,
  y1: number,
  out: Float32Array | Uint32Array,
): void {
  const H = out.length,
    k = H / (y1 - y0);
  let x = iterate(m, r, x0, skip);
  for (let i = 0; i < keep; i++) {
    x = clamp01(m.f(x, r));
    const j = Math.floor((x - y0) * k);
    if (j >= 0 && j < H) out[j]++;
  }
}

/** fᴺ(x) と r による微分（xₖ₊₁ = f(xₖ)、dxₖ₊₁/dr = f′(xₖ)·dxₖ/dr + ∂f/∂r(xₖ)） */
function iterDr(m: MapDef, r: number, x: number, N: number): [number, number] {
  let d = 0;
  for (let i = 0; i < N; i++) {
    d = m.dx(x, r) * d + m.dr(x, r);
    x = m.f(x, r);
  }
  return [x, d];
}

/**
 * 極大 c を通る周期 N の軌道（超安定な周期、乗数 0）を持つ r。fᴺ(c) = c を r について Newton 法で解く。
 * 収束しなければ NaN
 */
export function superstable(m: MapDef, N: number, guess: number): number {
  let r = guess;
  for (let i = 0; i < 60; i++) {
    const [x, d] = iterDr(m, r, m.c, N),
      g = x - m.c;
    if (!Number.isFinite(g) || d === 0) return Number.NaN;
    const step = g / d;
    r -= step;
    if (Math.abs(step) < 1e-15 * Math.max(1, Math.abs(r))) return r;
  }
  return Number.NaN;
}

export interface Cascade {
  /** R[k]: 周期 2ᵏ の超安定な値 */
  R: number[];
  /** delta[k] = (R[k] − R[k−1]) / (R[k+1] − R[k])（k = 1 から。delta[0] は NaN） */
  delta: number[];
  /** alpha[k] = −d[k] / d[k+1]。d[k] は周期 2ᵏ の軌道で c から半周期先の値と c の差 */
  alpha: number[];
  /** 集積点の見積り R[n] + (R[n] − R[n−1]) / (δ − 1) */
  rInf: number;
}

/** Feigenbaum の値 δ（パラメータの間隔の比）= 4.669201609102990671853… と α（枝の幅の比）= 2.502907875095892822283…（倍精度に丸めた値） */
export const DELTA = 4.66920160910299;
export const ALPHA = 2.502907875095893;
/** ロジスティク写像の集積点（Myrberg 点）= 3.569945671870944901842…（OEIS A098587、倍精度に丸めた値） */
export const R_INF_LOGISTIC = 3.569945671870945;

/**
 * 超安定な周期 1, 2, 4, …, 2ⁿ の r と、そこから見積る δ・α・集積点。滑らかな写像だけ。
 * 倍精度では間隔が 1e-9 ほどになる k = 11 前後で Newton 法が収まらなくなるので、そこで打ち切る
 */
export function cascade(m: MapDef, n: number): Cascade {
  if (!m.seed) throw new Error(m.id);
  const R = [superstable(m, 1, m.seed[0]), superstable(m, 2, m.seed[1])];
  for (let k = 2; k <= n; k++) {
    const g = R[k - 1] + (R[k - 1] - R[k - 2]) / (k > 2 ? (R[k - 2] - R[k - 3]) / (R[k - 1] - R[k - 2]) : DELTA),
      r = superstable(m, 2 ** k, g);
    if (!(r > R[k - 1]) || r - R[k - 1] > R[k - 1] - R[k - 2]) break;
    R.push(r);
  }
  const delta = R.map((_, k) => (k > 0 && k < R.length - 1 ? (R[k] - R[k - 1]) / (R[k + 1] - R[k]) : Number.NaN));
  const d = R.map((r, k) => (k > 0 ? iterate(m, r, m.c, 2 ** (k - 1)) - m.c : Number.NaN));
  const alpha = d.map((v, k) => (k > 0 && k < d.length - 1 ? -v / d[k + 1] : Number.NaN));
  const last = R.length - 1;
  return { R, delta, alpha, rInf: R[last] + (R[last] - R[last - 1]) / (DELTA - 1) };
}

/**
 * 周期 N の軌道の乗数が target になる (x, r)。fᴺ(x) = x と (fᴺ)′(x) = target を 2 変数の Newton 法で解く
 * （ヤコビ行列は中心差分）。target = −1 は周期倍分岐、+1 は接線分岐（窓の始まり）。収束しなければ null
 */
export function bifPoint(
  m: MapDef,
  N: number,
  target: number,
  xg: number,
  rg: number,
): { x: number; r: number } | null {
  const F = (x: number, r: number): [number, number] => {
    let y = x,
      p = 1;
    for (let i = 0; i < N; i++) {
      p *= m.dx(y, r);
      y = m.f(y, r);
    }
    return [y - x, p - target];
  };
  let x = xg,
    r = rg;
  const h = 1e-7;
  for (let i = 0; i < 80; i++) {
    const [a, b] = F(x, r),
      [ax1, bx1] = F(x + h, r),
      [ax0, bx0] = F(x - h, r),
      [ar1, br1] = F(x, r + h),
      [ar0, br0] = F(x, r - h);
    const J11 = (ax1 - ax0) / (2 * h),
      J12 = (ar1 - ar0) / (2 * h),
      J21 = (bx1 - bx0) / (2 * h),
      J22 = (br1 - br0) / (2 * h),
      det = J11 * J22 - J12 * J21;
    if (!Number.isFinite(det) || det === 0) return null;
    const dx = (a * J22 - b * J12) / det,
      dr = (b * J11 - a * J21) / det;
    x -= dx;
    r -= dr;
    if (Math.abs(dx) < 1e-14 && Math.abs(dr) < 1e-14) return { x, r };
  }
  return null;
}

/**
 * 周期 2ᵏ⁻¹ → 2ᵏ の周期倍分岐の r（k = 1 から n）。超安定な値 R[k−1] と R[k] の間にある。
 * 出発点の x は R[k−1] の軌道の点（極大 c の像）
 */
export function doublings(m: MapDef, c: Cascade): number[] {
  const out: number[] = [];
  for (let k = 1; k < c.R.length; k++) {
    const N = 2 ** (k - 1),
      rg = c.R[k - 1] + 0.6 * (c.R[k] - c.R[k - 1]),
      xg = iterate(m, rg, iterate(m, c.R[k - 1], m.c, 1), N * 64);
    const p = bifPoint(m, N, -1, xg, rg);
    out.push(p ? p.r : Number.NaN);
  }
  return out;
}

/**
 * 周期 p の窓の始まり（接線分岐）の r。rg はその少し上の値で、軌道が周期 p に落ち着いている所。
 * 出発点の x は rg での軌道の点
 */
export function windowStart(m: MapDef, p: number, rg: number): number {
  const xg = iterate(m, rg, m.c, 2000);
  const q = bifPoint(m, p, 1, xg, rg);
  return q ? q.r : Number.NaN;
}
