/**
 * リード・ソロモン符号（QR コードの形: 生成多項式の根が α⁰〜α^(n−1)、符号語の並びの先頭が最高次の係数）。
 * 符号化は割り算の余り、復号はシンドローム → Berlekamp–Massey 法 → Chien 探索 → Forney の式の順で、
 * 途中の値も返す（ページの表に出すため）
 */
import { div, evalHigh, evalLow, mul, pow } from './gf';

const cache = new Map<number, number[]>();

/** 生成多項式 g(x) = (x − α⁰)(x − α¹)…(x − α^(n−1)) の係数（高次から。先頭は 1） */
export function generator(n: number): number[] {
  const hit = cache.get(n);
  if (hit) return hit;
  let g = [1];
  for (let i = 0; i < n; i++) {
    const r = pow(i),
      h = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      h[j] ^= g[j];
      h[j + 1] ^= mul(g[j], r);
    }
    g = h;
  }
  cache.set(n, g);
  return g;
}

/** 誤り訂正語: D(x)·xⁿ を g(x) で割った余り（n 語） */
export function rsEncode(data: readonly number[], n: number): number[] {
  const g = generator(n),
    r = new Array(n).fill(0);
  for (const d of data) {
    const f = d ^ r[0];
    for (let i = 0; i < n - 1; i++) r[i] = r[i + 1] ^ mul(g[i + 1], f);
    r[n - 1] = mul(g[n], f);
  }
  return r;
}

export interface RsFix {
  /** 符号語の番号（ブロックの中で、先頭が 0） */
  i: number;
  /** 多項式の次数（i = 長さ − 1 − j） */
  j: number;
  /** 読んだ値 */
  got: number;
  /** 誤りの大きさ */
  e: number;
}

export interface RsResult {
  /** シンドローム S₀〜S_(n−1) */
  S: number[];
  /** 誤り位置多項式 Λ(x) の係数（低次から） */
  lambda: number[];
  /** 誤り評価多項式 Ω(x) = S(x)Λ(x) mod xⁿ の係数（低次から） */
  omega: number[];
  fixes: RsFix[];
  /** 直した符号語（直せなければ読んだまま） */
  out: number[];
  /** 誤りがない・直せた */
  ok: boolean;
  /** 直せなかった理由。many: Λ の次数が n/2 を超えた、roots: 根の数が次数と合わない、check: 直しても検査に通らない */
  why?: 'many' | 'roots' | 'check';
}

/** 受け取った符号語（データ＋誤り訂正語）を直す。n は誤り訂正語の数 */
export function rsDecode(recv: readonly number[], n: number): RsResult {
  const N = recv.length,
    S = Array.from({ length: n }, (_, i) => evalHigh(recv, pow(i)));
  const base = { S, lambda: [1], omega: [] as number[], fixes: [] as RsFix[], out: recv.slice() };
  if (S.every((s) => s === 0)) return { ...base, ok: true };

  /* Berlekamp–Massey 法: シンドロームの並びを生む最短の線形帰還の係数が Λ(x) */
  let C = [1],
    B = [1],
    L = 0,
    m = 1,
    b = 1;
  for (let k = 0; k < n; k++) {
    let d = S[k];
    for (let i = 1; i <= L; i++) d ^= mul(C[i] ?? 0, S[k - i]);
    if (d === 0) {
      m++;
      continue;
    }
    const T = C.slice(),
      f = div(d, b);
    while (C.length < B.length + m) C.push(0);
    for (let i = 0; i < B.length; i++) C[i + m] ^= mul(f, B[i]);
    if (2 * L <= k) {
      L = k + 1 - L;
      B = T;
      b = d;
      m = 1;
    } else m++;
  }
  C.length = L + 1;
  const omega = new Array(n).fill(0);
  for (let i = 0; i < n; i++) for (let k = 0; k <= Math.min(i, L); k++) omega[i] ^= mul(S[i - k], C[k]);
  const got = { ...base, lambda: C, omega };
  if (2 * L > n) return { ...got, ok: false, why: 'many' };

  /* Chien 探索: Λ(α^−j) = 0 となる j が誤りの位置（x^j の係数） */
  const js: number[] = [];
  for (let j = 0; j < N; j++) if (evalLow(C, pow(-j)) === 0) js.push(j);
  if (js.length !== L) return { ...got, ok: false, why: 'roots' };

  /* Forney の式（根が α⁰ から始まる形）: e = X·Ω(X⁻¹) / Λ′(X⁻¹)、X = α^j。GF(2) の微分は奇数次の項だけ残る */
  const dC = C.slice(1).map((c, i) => (i % 2 === 0 ? c : 0));
  const out = recv.slice(),
    fixes: RsFix[] = [];
  for (const j of js) {
    const xi = pow(-j),
      e = mul(pow(j), div(evalLow(omega, xi), evalLow(dC, xi))),
      i = N - 1 - j;
    fixes.push({ i, j, got: recv[i], e });
    out[i] ^= e;
  }
  fixes.sort((a, b) => a.i - b.i);
  for (let i = 0; i < n; i++) if (evalHigh(out, pow(i)) !== 0) return { ...got, fixes, ok: false, why: 'check' };
  return { ...got, fixes, out, ok: true };
}
