/**
 * カルマンフィルタのページの計算: 本当の台車と距離計（World）、位置と速度のカルマンフィルタ（KF）、
 * 1 次元の正規分布の積、定常の共分散、整合性の検査（NIS）の範囲
 */

/** 2 × 2 の対称行列 [[a, b], [b, c]] を [a, b, c] で持つ */
export type Sym = [number, number, number];
export interface State {
  /** [位置 m, 速度 m/s] */
  x: [number, number];
  P: Sym;
}

/** 2 自由度のカイ 2 乗の 95 % 点（−2 ln 0.05 = 5.991）の平方根。95 % の楕円の大きさ */
export const K95 = Math.sqrt(-2 * Math.log(0.05));

/* ---------- 乱数（種から決まる。同じ種なら同じ動きと観測） ---------- */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** 標準正規分布（ボックス＝ミュラー法） */
export function normal(r: () => number): number {
  let u = 0;
  while (u === 0) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

/**
 * 1 次元の正規分布の積 N(m1, s1²)·N(m2, s2²) ∝ N(m, s²)。
 * K = s1² / (s1² + s2²)、m = m1 + K (m2 − m1)、s² = (1 − K) s1²
 */
export function product(m1: number, s1: number, m2: number, s2: number): { m: number; s: number; K: number } {
  const v1 = s1 * s1,
    v2 = s2 * s2,
    K = v1 / (v1 + v2);
  return { m: m1 + K * (m2 - m1), s: Math.sqrt((1 - K) * v1), K };
}

/** 加速度が 1 刻みの間一定の白色雑音（分散 q）のときの過程雑音の共分散 q·[[T⁴/4, T³/2], [T³/2, T²]] */
export function qDwna(T: number, q: number): Sym {
  const T2 = T * T;
  return [(q * T2 * T2) / 4, (q * T2 * T) / 2, q * T2];
}

/** 本当の台車と距離計。加速度は 1 刻みごとに独立な正規分布で、その間は一定 */
export class World {
  p = 0;
  v = 0;
  t = 0;
  k = 0;
  private ra = mulberry(1);
  private rz = mulberry(2);

  constructor(readonly seed: number) {}

  /** 初めの位置 p0・速さ v0 から始め直す */
  reset(p0: number, v0: number): void {
    this.ra = mulberry(this.seed);
    this.rz = mulberry(this.seed * 7919 + 13);
    this.p = p0;
    this.v = v0;
    this.t = 0;
    this.k = 0;
  }

  /** T だけ進め、距離計の値を返す。sa: 加速度の標準偏差、sz: 観測の雑音の標準偏差 */
  step(T: number, sa: number, sz: number): number {
    const a = sa * normal(this.ra);
    this.p += this.v * T + (a * T * T) / 2;
    this.v += a * T;
    this.t += T;
    this.k++;
    return this.p + sz * normal(this.rz);
  }
}

/** 位置と速度のカルマンフィルタ（等速の模型、位置だけを観測する H = [1 0]） */
export class KF {
  x: [number, number] = [0, 0];
  P: Sym = [1, 0, 1];
  /** 直前の予測（観測する前） */
  pri: State = { x: [0, 0], P: [1, 0, 1] };
  /** 直前の更新のカルマンゲイン [位置, 速度]、イノベーション y = z − p̂⁻ とその分散 S、NIS = y²/S */
  K: [number, number] = [0, 0];
  y = 0;
  S = 0;
  nis = Number.NaN;

  reset(p0: number, v0: number, sp: number, sv: number): void {
    this.x = [p0, v0];
    this.P = [sp * sp, 0, sv * sv];
    this.pri = { x: [p0, v0], P: [...this.P] };
    this.K = [0, 0];
    this.y = 0;
    this.S = 0;
    this.nis = Number.NaN;
  }

  /** 予測: x ← F x、P ← F P Fᵀ + Q（F = [[1, T], [0, 1]]、q は加速度の分散の見積り） */
  predict(T: number, q: number): void {
    const [p, v] = this.x,
      [a, b, c] = this.P,
      Q = qDwna(T, q);
    this.x = [p + v * T, v];
    this.P = [a + 2 * T * b + T * T * c + Q[0], b + T * c + Q[1], c + Q[2]];
    this.pri = { x: [...this.x], P: [...this.P] };
  }

  /** 更新: 位置の観測 z（分散の見積り R）で、K = P Hᵀ / (H P Hᵀ + R) だけ寄せる */
  update(z: number, R: number): void {
    const [a, b, c] = this.P,
      S = a + R,
      k0 = a / S,
      k1 = b / S,
      y = z - this.x[0];
    this.x = [this.x[0] + k0 * y, this.x[1] + k1 * y];
    /* (I − KH) P。対称のまま */
    this.P = [(1 - k0) * a, (1 - k0) * b, c - k1 * b];
    this.K = [k0, k1];
    this.y = y;
    this.S = S;
    this.nis = (y * y) / S;
  }
}

/** 予測と更新を n 回くり返したあとの [予測の P, 更新後の P, K]（定常の値の見積り） */
export function steady(
  T: number,
  q: number,
  R: number,
  sp: number,
  sv: number,
  n = 400,
): { pri: Sym; post: Sym; K: [number, number] } {
  const f = new KF();
  f.reset(0, 0, sp, sv);
  for (let i = 0; i < n; i++) {
    f.predict(T, q);
    f.update(0, R);
  }
  return { pri: f.pri.P, post: f.P, K: f.K };
}

/**
 * N 回の NIS の平均の両側 95 % の範囲。フィルタが合っていれば N·平均は自由度 N のカイ 2 乗に従う。
 * 分位点は Wilson–Hilferty の近似 N (1 − 2/(9N) ± 1.96 √(2/(9N)))³ / N
 */
export function nisBand(N: number): [number, number] {
  const w = 2 / (9 * N),
    q = (z: number) => (1 - w + z * Math.sqrt(w)) ** 3;
  return [q(-1.959964), q(1.959964)];
}

/** 平均 m・共分散 P の k 倍の楕円の点（コレスキー分解 P = L Lᵀ で単位円を写す） */
export function ellipse(m: readonly [number, number], P: Sym, k: number, n = 72): [number, number][] {
  const [a, b, c] = P,
    l1 = Math.sqrt(Math.max(a, 0)),
    l2 = l1 > 0 ? b / l1 : 0,
    l3 = Math.sqrt(Math.max(c - l2 * l2, 0)),
    pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * 2 * Math.PI,
      u = Math.cos(t) * k,
      w = Math.sin(t) * k;
    pts.push([m[0] + l1 * u, m[1] + l2 * u + l3 * w]);
  }
  return pts;
}
