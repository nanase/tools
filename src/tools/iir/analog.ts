/**
 * アナログの原型（正規化した LPF）と周波数変換。零点・極・ゲイン（ZPK）で扱う。
 * 原型は「基準の端」を Ω = 1 rad/s に置く:
 * バターワース・ベッセルは減衰 A [dB] の点、チェビシェフ I・楕円は通過域端、チェビシェフ II は阻止域端
 */
import { abs, add, type C, canon, conj, cx, div, inv, mul, neg, prodDiff, scale, sqrt, sub } from './complex';
import { asneR, cde, cdeR, comp, ellipdeg, ellipK, ellipKp } from './elliptic';
import { roots } from './poly';

export interface ZPK {
  z: C[];
  p: C[];
  k: number;
}

export type Kind = 'butter' | 'cheby1' | 'cheby2' | 'ellip' | 'bessel';
export type Resp = 'lp' | 'hp' | 'bp' | 'bs';

/** 減衰 A [dB] に対する ε = √(10^{A/10} − 1) */
export const epsOf = (A: number): number => Math.sqrt(10 ** (A / 10) - 1);
/** 半分の電力（−3.0103 dB） */
export const A3 = 10 * Math.log10(2);
/** 次数の上限（原型の LPF） */
export const NMAX = 20;

const J = (x: C): C => ({ re: -x.im, im: x.re });
const realProd = (a: readonly C[]): number => a.reduce((p, x) => mul(p, neg(x)), cx(1)).re;

/** バターワース: Ω = 1 で減衰 A */
export function butter(N: number, A = A3): ZPK {
  const w0 = epsOf(A) ** (-1 / N),
    p: C[] = [];
  for (let m = 0; m < N; m++) {
    const t = (Math.PI * (2 * m + N + 1)) / (2 * N);
    p.push({ re: w0 * Math.cos(t), im: w0 * Math.sin(t) });
  }
  const pc = canon(p);
  return { z: [], p: pc, k: realProd(pc) };
}

/** チェビシェフ I の極（ε で決まる楕円の上） */
function chebPoles(N: number, e: number): C[] {
  const mu = Math.asinh(1 / e) / N,
    p: C[] = [];
  for (let m = 1; m <= N; m++) {
    const t = (Math.PI * (2 * m - 1)) / (2 * N);
    p.push({ re: -Math.sinh(mu) * Math.sin(t), im: Math.cosh(mu) * Math.cos(t) });
  }
  return canon(p);
}

/** チェビシェフ I: 通過域 0 ≤ Ω ≤ 1 にリップル Ap */
export function cheby1(N: number, Ap: number): ZPK {
  const e = epsOf(Ap),
    p = chebPoles(N, e);
  return { z: [], p, k: realProd(p) * (N % 2 ? 1 : 1 / Math.sqrt(1 + e * e)) };
}

/** チェビシェフ II: 阻止域 Ω ≥ 1 で減衰 As 以上（阻止域に等リップル） */
export function cheby2(N: number, As: number): ZPK {
  const e = 1 / epsOf(As),
    p = chebPoles(N, e).map(inv),
    z: C[] = [];
  for (let m = 1; m <= N; m++) {
    if (2 * m - 1 === N) continue;
    z.push({ re: 0, im: 1 / Math.cos((Math.PI * (2 * m - 1)) / (2 * N)) });
  }
  const zc = canon(z),
    pc = canon(p);
  return { z: zc, p: pc, k: realProd(pc) / realProd(zc) };
}

/** チェビシェフ II の通過域端（減衰 Ap の点）。阻止域端を 1 とした周波数 */
export const cheby2Pass = (N: number, Ap: number, As: number): number =>
  1 / Math.cosh(Math.acosh(epsOf(As) / epsOf(Ap)) / N);

/**
 * 楕円（Orfanidis の ellipap2）:通過域 0 ≤ Ω ≤ 1 にリップル Ap、阻止域 Ω ≥ 1/k に減衰 As。
 * k（選択度）は次数の式から決まる。戻り値の ks は k
 */
export function ellip(N: number, Ap: number, As: number): ZPK & { ks: number } {
  const ep = epsOf(Ap),
    es = epsOf(As),
    k1 = ep / es,
    k1p = comp(k1);
  const [k, kp] = ellipdeg(N, k1, k1p);
  const L = Math.floor(N / 2),
    r = N % 2;
  const z: C[] = [];
  for (let i = 1; i <= L; i++) z.push({ re: 0, im: 1 / (k * cdeR((2 * i - 1) / N, k, kp)) });
  /* v0 = −j·asne(j/εp, k1)/N。虚数の変換 sn(ju, k) = j·sc(u, k′) で実数の asne にする */
  const v0 = (asneR(1 / Math.sqrt(1 + ep * ep), k1p, k1) * ellipKp(k1, k1p)) / ellipK(k1, k1p) / N;
  const p: C[] = [];
  for (let i = 1; i <= L + r; i++) {
    const u = (2 * i - 1) / N,
      w = J(cde({ re: u, im: -v0 }, k, kp));
    p.push(i > L ? { re: w.re, im: 0 } : w);
  }
  const zc = canon(z),
    pc = canon(p.flatMap((x) => (x.im === 0 ? [x] : [x, conj(x)])));
  const h0 = r ? 1 : 1 / Math.sqrt(1 + ep * ep);
  return { z: zc, p: pc, k: (h0 * realProd(pc)) / realProd(zc), ks: k };
}

/** 逆 Bessel 多項式 θ_N(s) の係数（昇べき）。aₖ = (2N − k)! / (2^{N−k} k! (N − k)!) */
export function besselPoly(N: number): number[] {
  const a = new Array<number>(N + 1);
  a[N] = 1;
  for (let k = N; k >= 1; k--) a[k - 1] = (a[k] * (2 * N - k + 1) * k) / (2 * (N - k + 1));
  return a;
}

/** Ω での減衰 [dB]（0 dB からの量） */
export function attenAt(f: ZPK, w: number): number {
  const s = cx(0, w);
  return -20 * Math.log10((Math.abs(f.k) * abs(prodDiff(s, f.z))) / abs(prodDiff(s, f.p)));
}

/** 根を 1/w 倍の周波数へ（Ω = w の点を Ω = 1 に移す） */
export function rescale(f: ZPK, w: number): ZPK {
  const z = f.z.map((x) => scale(x, 1 / w)),
    p = f.p.map((x) => scale(x, 1 / w));
  return { z, p, k: f.k * w ** (f.z.length - f.p.length) };
}

/** 減衰が A になる周波数（単調に減る応答を二分法で） */
export function edgeOf(f: ZPK, A: number): number {
  let lo = 0,
    hi = 1;
  while (attenAt(f, hi) < A && hi < 1e12) hi *= 2;
  for (let i = 0; i < 200 && hi - lo > hi * 1e-15; i++) {
    const m = (lo + hi) / 2;
    if (attenAt(f, m) < A) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

const besselMemo = new Map<number, ZPK>();
/** 遅延を正規化したベッセル（τ(0) = 1 s）。次数ごとに 1 度だけ根を求める */
export function besselDelay(N: number): ZPK {
  let f = besselMemo.get(N);
  if (!f) {
    const p = canon(roots([...besselPoly(N)].reverse()));
    f = { z: [], p, k: realProd(p) };
    besselMemo.set(N, f);
  }
  return f;
}

/** ベッセル（遅延を正規化した θ_N の根を、Ω = 1 で減衰 A になるように縮める） */
export function bessel(N: number, A = A3): ZPK {
  const f0 = besselDelay(N);
  return rescale(f0, edgeOf(f0, A));
}

/* ---------- 最小の次数 ---------- */
export interface OrderResult {
  /** 求めた次数（上限で切ったもの） */
  N: number;
  /** 切り上げる前の値（ベッセルは null） */
  exact: number | null;
  /** 上限の次数でも仕様を満たさない */
  short: boolean;
}

/** 原型の選択度 W（阻止域端 / 通過域端 > 1）、減衰 Ap・As から最小の次数を求める */
export function minOrder(kind: Kind, W: number, Ap: number, As: number): OrderResult {
  const ep = epsOf(Ap),
    es = epsOf(As);
  let x: number;
  switch (kind) {
    case 'butter':
      x = Math.log(es / ep) / Math.log(W);
      break;
    case 'cheby1':
    case 'cheby2':
      x = Math.acosh(es / ep) / Math.acosh(W);
      break;
    case 'ellip': {
      const k = 1 / W,
        kp = Math.sqrt((W - 1) * (W + 1)) / W,
        k1 = ep / es,
        k1p = comp(k1);
      x = (ellipK(k, kp) * ellipKp(k1, k1p)) / (ellipKp(k, kp) * ellipK(k1, k1p));
      break;
    }
    case 'bessel': {
      for (let N = 1; N <= NMAX; N++) if (attenAt(bessel(N, Ap), W) >= As) return { N, exact: null, short: false };
      return { N: NMAX, exact: null, short: true };
    }
  }
  const n = Math.max(1, Math.ceil(x - 1e-9));
  return { N: Math.min(n, NMAX), exact: x, short: n > NMAX };
}

/* ---------- 周波数変換（scipy の lp2lp_zpk などと同じ式） ---------- */
const relDeg = (f: ZPK) => f.p.length - f.z.length;

export function lp2lp(f: ZPK, wo: number): ZPK {
  return {
    z: f.z.map((x) => scale(x, wo)),
    p: f.p.map((x) => scale(x, wo)),
    k: f.k * wo ** relDeg(f),
  };
}

export function lp2hp(f: ZPK, wo: number): ZPK {
  const z = f.z.map((x) => div(cx(wo), x)),
    p = f.p.map((x) => div(cx(wo), x));
  for (let i = 0; i < relDeg(f); i++) z.push(cx(0));
  const g = div(prodDiff(cx(0), f.z), prodDiff(cx(0), f.p)).re;
  return { z: canon(z), p: canon(p), k: f.k * g };
}

/** s → (s² + wo²)/(bw·s) の根の写像 */
const bpRoots = (rs: readonly C[], wo: number, bw: number): C[] =>
  rs.flatMap((r) => {
    const h = scale(r, bw / 2),
      d = sqrt(sub(mul(h, h), cx(wo * wo)));
    return [add(h, d), sub(h, d)];
  });

export function lp2bp(f: ZPK, wo: number, bw: number): ZPK {
  const z = bpRoots(f.z, wo, bw),
    p = bpRoots(f.p, wo, bw);
  for (let i = 0; i < relDeg(f); i++) z.push(cx(0));
  return { z: canon(z), p: canon(p), k: f.k * bw ** relDeg(f) };
}

export function lp2bs(f: ZPK, wo: number, bw: number): ZPK {
  const z = bpRoots(f.z.map(inv), wo, bw),
    p = bpRoots(f.p.map(inv), wo, bw);
  for (let i = 0; i < relDeg(f); i++) z.push(cx(0, wo), cx(0, -wo));
  const g = div(prodDiff(cx(0), f.z), prodDiff(cx(0), f.p)).re;
  return { z: canon(z), p: canon(p), k: f.k * g };
}

/** 原型（Ω′）の周波数を、変換後のアナログの周波数 Ω へ。BPF・BSF は下と上の 2 つ */
export function protoToAnalog(resp: Resp, W: number, wo: number, bw: number): number[] {
  switch (resp) {
    case 'lp':
      return [wo * W];
    case 'hp':
      return [wo / W];
    case 'bp': {
      const hi = (W * bw + Math.sqrt(W * W * bw * bw + 4 * wo * wo)) / 2;
      return [(wo * wo) / hi, hi];
    }
    case 'bs': {
      const hi = (bw / W + Math.sqrt((bw * bw) / (W * W) + 4 * wo * wo)) / 2;
      return [(wo * wo) / hi, hi];
    }
  }
}

/** 変換後のアナログの周波数 Ω を、原型の周波数 |Ω′| へ */
export function analogToProto(resp: Resp, w: number, wo: number, bw: number): number {
  switch (resp) {
    case 'lp':
      return w / wo;
    case 'hp':
      return wo / w;
    case 'bp':
      return Math.abs((w * w - wo * wo) / (bw * w));
    case 'bs':
      return Math.abs((bw * w) / (wo * wo - w * w));
  }
}
