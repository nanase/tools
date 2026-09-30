/**
 * 多層のうずまきコイル（DOM に依存しない）: 基板の構成、層どうしの結合、直列・並列の合成、層の間の容量と自己共振。
 * どの層にも同じうずまきを重ね、直列では電流が同じ向きに回るようビアでつなぐとする
 */
import { ac, type Coil, calc, type Dims, MU0, type Shape } from './coil';

/** 真空の誘電率 [F/m] */
export const EPS0 = 8.8541878128e-12;
/** FR-4 の比誘電率（1 MHz 付近の代表値） */
export const ER_FR4 = 4.4;

export type Conn = 'ser' | 'par';

export interface Stack {
  v: string;
  /** 層数 */
  n: number;
  /** 表示名（チップ） */
  ab: string;
  /** 隣り合う銅箔の間の誘電体の厚さ [mm]（上の層から順に。n − 1 個） */
  gaps: readonly number[];
}

/** 層数の選択肢 */
export const LAYERS = [1, 2, 4, 6] as const;

/** 基板の構成の例（板厚は銅箔を含む。誘電体の厚さは一般的な構成の概数） */
export const STACKS: readonly Stack[] = [
  { v: '1', n: 1, ab: '片面', gaps: [] },
  { v: '2-08', n: 2, ab: '0.8 mm 厚', gaps: [0.73] },
  { v: '2-10', n: 2, ab: '1.0 mm 厚', gaps: [0.93] },
  { v: '2-16', n: 2, ab: '1.6 mm 厚', gaps: [1.53] },
  { v: '4-10', n: 4, ab: '1.0 mm 厚', gaps: [0.2, 0.46, 0.2] },
  { v: '4-16', n: 4, ab: '1.6 mm 厚', gaps: [0.21, 1.07, 0.21] },
  { v: '6-16', n: 6, ab: '1.6 mm 厚', gaps: [0.2, 0.4, 0.2, 0.4, 0.2] },
];
export const stackOf = (v: string): Stack => STACKS.find((s) => s.v === v) ?? STACKS[0];
/** 層数ごとの既定の構成（1.6 mm 厚があればそれ） */
export const stackFor = (n: number): Stack =>
  STACKS.find((s) => s.n === n && s.ab.startsWith('1.6')) ?? STACKS.find((s) => s.n === n) ?? STACKS[0];
/** 誘電体の厚さの表記（0.21・1.07・0.21 mm） */
export const gapsText = (st: Stack): string => `${st.gaps.join('・')} mm`;

/* ---------- 同軸の円形ループの相互インダクタンス ---------- */
/** 第 1 種・第 2 種の完全楕円積分 K(k)・E(k)（算術幾何平均） */
export function ellipKE(k: number): [number, number] {
  let a = 1,
    b = Math.sqrt(1 - k * k),
    c = k,
    s = (c * c) / 2,
    p = 0.5;
  for (let i = 0; i < 40 && Math.abs(c) > 1e-16; i++) {
    const an = (a + b) / 2;
    c = (a - b) / 2;
    b = Math.sqrt(a * b);
    a = an;
    p *= 2;
    s += p * c * c;
  }
  const K = Math.PI / (2 * a);
  return [K, K * (1 - s)];
}

/** 半径 a・b [m]、軸方向の距離 h [m] の同軸の円形ループの相互インダクタンス（Maxwell の式） */
export function loopM(a: number, b: number, h: number): number {
  const k2 = (4 * a * b) / ((a + b) ** 2 + h * h),
    k = Math.sqrt(k2),
    [K, E] = ellipKE(k);
  return MU0 * Math.sqrt(a * b) * ((2 / k - k) * K - (2 / k) * E);
}

/** 幅 w・厚さ t [m] の平たい導体で作った半径 r [m] の円形ループの自己インダクタンス（幾何平均距離 0.2235(w + t)） */
export const loopL = (r: number, w: number, t: number): number =>
  MU0 * r * (Math.log((8 * r) / (0.2235 * (w + t))) - 2);

/**
 * 各巻きを同じ面積の円に置き換えた半径 [m]。k は辺の数（円は 0）、a は巻きの中心線までの距離（多角形は辺まで）
 */
export const eqR = (k: number, a: number): number => (k ? a * Math.sqrt((k * Math.tan(Math.PI / k)) / Math.PI) : a);

/** 1 層ぶんの巻きの半径 [m]（外側から） */
export function turnRadii(k: number, n: number, d: number, w: number, s: number): number[] {
  return Array.from({ length: n }, (_, i) => eqR(k, d / 2 - w / 2 - i * (w + s)));
}

/**
 * 距離 h [m] 離れた 2 つの層の結合係数。どちらの層も巻きの半径 R の円形ループの直列とみなし、
 * 層の間の相互インダクタンスを、同じループで求めた 1 層の自己インダクタンスで割る
 */
export function coupling(R: readonly number[], w: number, t: number, h: number): number {
  let self = 0,
    m = 0;
  for (let i = 0; i < R.length; i++)
    for (let j = 0; j < R.length; j++) {
      self += i === j ? loopL(R[i], w, t) : loopM(R[i], R[j], 0);
      m += loopM(R[i], R[j], h);
    }
  return Math.min(1, m / self);
}

/** 層 i と j の中心の距離 [m]（誘電体の厚さと、間の銅箔の厚さ t [m]） */
export function layerDist(st: Stack, i: number, j: number, t: number): number {
  let h = 0;
  for (let x = Math.min(i, j); x < Math.max(i, j); x++) h += st.gaps[x] * 1e-3 + t;
  return h;
}

/** n 元の連立一次方程式 A x = b（部分ピボットの消去法。A は壊す） */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c];
      for (let x = c; x < n; x++) A[r][x] -= f * A[c][x];
      b[r] -= f * b[c];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let v = b[r];
    for (let c = r + 1; c < n; c++) v -= A[r][c] * x[c];
    x[r] = v / A[r][r];
  }
  return x;
}

export interface Multi {
  /** 層数 */
  nl: number;
  conn: Conn;
  /** 隣り合う層の結合係数（上から順に） */
  k: number[];
  /** 1 層に対するインダクタンスの倍率 */
  lk: number;
  /** 1 層に対する抵抗の倍率（配線の長さ ×、電流の分かれ方） */
  rk: number;
  /** 電気的な配線の長さの倍率（直列は層数、並列は 1） */
  ek: number;
  /** 層の間の容量の等価値 [F]（1 層・並列では 0） */
  cp: number;
  /** 隣り合う層の間の容量の和 [F] */
  cSum: number;
}

/**
 * 多層の合成。kh は中心の距離 h [m] の 2 層の結合係数、w・t は配線の幅と銅箔の厚さ、len は 1 層の配線の長さ [m]。
 * 層の間の容量は、重なった配線を平行平板とみなす（縁の容量は含めない）。直列では電位が配線に沿って
 * 直線的に変わるとして静電エネルギーから等価値を求める（隣り合う層の電位差は 2(1 − p)/n か 2p/n、p は外側からの位置）
 */
export function multi(
  st: Stack,
  conn: Conn,
  kh: (h: number) => number,
  w: number,
  t: number,
  len: number,
  er = ER_FR4,
): Multi {
  const n = st.n;
  if (n <= 1) return { nl: 1, conn: 'ser', k: [], lk: 1, rk: 1, ek: 1, cp: 0, cSum: 0 };
  /* 1 層の L を 1 とした行列（同じ距離の結合は使い回す） */
  const kc = new Map<number, number>(),
    kOf = (i: number, j: number) => {
      const h = layerDist(st, i, j, t),
        key = Math.round(h * 1e9);
      let v = kc.get(key);
      if (v === undefined) {
        v = kh(h);
        kc.set(key, v);
      }
      return v;
    };
  const M = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : kOf(i, j))));
  const k = Array.from({ length: n - 1 }, (_, i) => M[i][i + 1]);
  const cs = st.gaps.map((g) => (EPS0 * er * w * len) / (g * 1e-3)),
    cSum = cs.reduce((a, b) => a + b, 0);
  if (conn === 'ser') {
    let lk = 0;
    for (const r of M) for (const v of r) lk += v;
    return { nl: n, conn, k, lk, rk: n, ek: n, cp: (4 / (3 * n * n)) * cSum, cSum };
  }
  /* 並列: 各層の電圧が等しい。電流の分け方 x は M x = 1 の解に比例し、L = 1/Σx */
  const x = solve(
      M.map((r) => r.slice()),
      new Array<number>(n).fill(1),
    ),
    sx = x.reduce((a, b) => a + b, 0);
  const rk = x.reduce((a, v) => a + (v / sx) ** 2, 0);
  return { nl: n, conn, k, lk: 1 / sx, rk, ek: 1, cp: 0, cSum };
}

/** 自己共振周波数 [Hz]（容量が 0 なら Infinity） */
export const fSrf = (L: number, C: number): number => (C > 0 ? 1 / (2 * Math.PI * Math.sqrt(L * C)) : Infinity);

/** 多層の計算結果。L・Lmw・Lmn・len・rdc・交流の量は全体の値 */
export interface Stacked extends Coil {
  /** 電流 1 A あたりの磁気モーメント [m²]（各巻きを同じ面積の円とみなした面積の和。直列は全層、並列は 1 層ぶん） */
  na: number;
  /** 1 層のインダクタンス（電流シート近似） */
  L1: number;
  /** 1 層の配線の長さ */
  len1: number;
  nl: number;
  conn: Conn;
  /** 隣り合う層の結合係数 */
  k: number[];
  /** 層の間の容量の等価値と、隣り合う層の間の容量の和 [F] */
  cp: number;
  cSum: number;
  /** 層の間の容量による自己共振周波数 [Hz]（容量がなければ Infinity） */
  srf: number;
}

/** 形・寸法・周波数と基板の構成・接続から、多層のコイルを計算する（1 層なら calc と同じ値） */
export function calcStack(sh: Shape, x: Dims, f: number, st: Stack, conn: Conn): Stacked {
  const g = calc(sh, x, f),
    R = turnRadii(sh.k, g.n, g.d, g.w, g.s);
  return stacked(g, st, conn, (h) => coupling(R, g.w, g.t, h), R);
}

/** 1 層の結果 g を多層にする。kh は距離 h の結合係数、R は 1 層の巻きの半径 */
export function stacked(g: Coil, st: Stack, conn: Conn, kh: (h: number) => number, R: readonly number[]): Stacked {
  const f = g.f,
    m = multi(st, conn, kh, g.w, g.t, g.len);
  const L = g.L * m.lk,
    len = g.len * m.ek,
    rk = m.rk / m.ek;
  return {
    ...g,
    L,
    Lmw: g.Lmw * m.lk,
    Lmn: g.Lmn * m.lk,
    len,
    rdc: g.rdc * m.rk,
    rk,
    ...ac(f, L, len, g.w, g.t, rk),
    L1: g.L,
    len1: g.len,
    nl: m.nl,
    conn: m.conn,
    k: m.k,
    cp: m.cp,
    cSum: m.cSum,
    srf: fSrf(L, m.cp),
    na: R.reduce((a, r) => a + Math.PI * r * r, 0) * (m.conn === 'ser' ? m.nl : 1),
  };
}
