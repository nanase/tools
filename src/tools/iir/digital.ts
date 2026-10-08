/**
 * アナログからデジタルへの写像（双一次変換・インパルス不変法）、双2次の縦続（SOS）、
 * 周波数特性（振幅・位相・群遅延）と時間応答の計算
 */
import type { ZPK } from './analog';
import { abs, add, type C, canon, cx, div, exp, mul, prodDiff, scale, sub } from './complex';
import { evalZ, evalZd, fromRoots, roots } from './poly';

/* ---------- 双一次変換 ---------- */
/** プリワーピング: デジタルの周波数 f [Hz] で一致させるアナログの角周波数 Ω = 2fs·tan(πf/fs) */
export const prewarp = (f: number, fs: number): number => 2 * fs * Math.tan((Math.PI * f) / fs);
/** 双一次変換で Ω [rad/s] が写る周波数 [Hz] */
export const unwarp = (w: number, fs: number): number => (fs / Math.PI) * Math.atan(w / (2 * fs));

/** z = (2fs + s)/(2fs − s)。無限遠の零点は z = −1 へ */
export function bilinear(f: ZPK, fs: number): ZPK {
  const c = cx(2 * fs),
    map = (s: C) => div(add(c, s), sub(c, s));
  const z = f.z.map(map),
    p = f.p.map(map);
  for (let i = f.z.length; i < f.p.length; i++) z.push(cx(-1));
  const g = div(prodDiff(c, f.z), prodDiff(c, f.p)).re;
  return { z: canon(z), p: canon(p), k: f.k * g };
}

/* ---------- インパルス不変法 ---------- */
/** 部分分数 H(z) = Σ cᵢ/(1 − qᵢz⁻¹) + d */
export interface PF {
  c: C[];
  q: C[];
  d: number;
}

/**
 * h[n] = T·hₐ(nT) にする（極は単純とする）。分子と分母の次数が等しいときの定数 d は、
 * そのまま δ[n] の係数にする
 */
export function impinv(f: ZPK, fs: number): PF {
  const T = 1 / fs,
    c: C[] = [],
    q: C[] = [];
  f.p.forEach((p, i) => {
    let den = cx(1);
    f.p.forEach((x, j) => {
      if (j !== i) den = mul(den, sub(p, x));
    });
    const r = scale(div(prodDiff(p, f.z), den), f.k);
    c.push(scale(r, T));
    q.push(exp(scale(p, T)));
  });
  return { c, q, d: f.z.length === f.p.length ? f.k : 0 };
}

/** 部分分数を z⁻¹ の有理式 b/a にする */
export function pfToBA(pf: PF): { b: number[]; a: number[] } {
  const n = pf.q.length,
    a = fromRoots(pf.q);
  const bRe = a.map((x) => x * pf.d),
    bIm = new Array<number>(n + 1).fill(0);
  pf.q.forEach((_, i) => {
    /* cᵢ Π_{j≠i} (1 − qⱼz⁻¹)（複素の係数のまま足す） */
    let re = [pf.c[i].re],
      im = [pf.c[i].im];
    pf.q.forEach((r, j) => {
      if (j === i) return;
      const nr = [...re, 0],
        ni = [...im, 0];
      for (let m = 1; m < nr.length; m++) {
        nr[m] -= r.re * re[m - 1] - r.im * im[m - 1];
        ni[m] -= r.re * im[m - 1] + r.im * re[m - 1];
      }
      re = nr;
      im = ni;
    });
    re.forEach((x, m) => {
      bRe[m] += x;
      bIm[m] += im[m];
    });
  });
  return { b: bRe, a };
}

/* ---------- 双2次の縦続 ---------- */
export interface Section {
  /** b₀ b₁ b₂（段のゲインを含む）、a₀ = 1 a₁ a₂ */
  b: [number, number, number];
  a: [number, number, number];
  /** 段の零点・極（1 次の段は 1 つ） */
  z: C[];
  p: C[];
  /** この段の出力までの振幅の最大 [dB] */
  peak: number;
}

export type SosOrder = 'up' | 'down';
export type SosGain = 'linf' | 'first';

/** 根の組（共役の組は 1 つの要素） */
interface Item {
  r: C;
  real: boolean;
}
const items = (rs: readonly C[]): Item[] =>
  rs.filter((r) => r.im >= 0).map((r) => ({ r: r.im === 0 ? cx(r.re) : r, real: r.im === 0 }));
const pair = (it: Item): C[] => (it.real ? [it.r] : [it.r, { re: it.r.re, im: -it.r.im }]);

function take<T>(L: T[], i: number): T {
  return L.splice(i, 1)[0];
}
function nearest(L: Item[], x: C, realOnly = false): number {
  let bi = -1,
    bd = Infinity;
  L.forEach((it, i) => {
    if (realOnly && !it.real) return;
    const d = abs(sub(it.r, x));
    if (d < bd) {
      bd = d;
      bi = i;
    }
  });
  return bi;
}

/** z⁻¹ の 2 次式の係数 [1, c₁, c₂]（根 1〜2 個） */
function quad(rs: readonly C[]): [number, number, number] {
  const c = fromRoots(rs);
  return [c[0], c[1] ?? 0, c[2] ?? 0];
}

/**
 * 極と零点を双2次の段に組む（Jackson の方法、scipy の zpk2sos と同じ考え方）:
 * 単位円に最も近い極（共役の組）から順に取り、それに最も近い零点と組む。
 * order が up なら、単位円に近い極の段を後ろに置く（down は前）。
 * gain が linf なら、各段の出力の振幅の最大が 1（0 dB）になるように段のゲインを配り、
 * 残りを最後の段に、first なら全体のゲインを先頭の段に置く
 */
export function toSOS(d: ZPK, order: SosOrder = 'up', gain: SosGain = 'linf'): Section[] {
  const P = items(d.p),
    Z = items(d.z),
    nReal = (L: Item[]) => L.filter((x) => x.real).length;
  const out: { z: C[]; p: C[] }[] = [];
  while (P.length) {
    let bi = 0;
    P.forEach((x, i) => {
      if (abs(x.r) > abs(P[bi].r)) bi = i;
    });
    const p1 = take(P, bi);
    let ps = pair(p1);
    if (p1.real) {
      const j = nearest(P, p1.r, true);
      if (j >= 0) ps = [p1.r, take(P, j).r];
    }
    /* 極と同じ数の零点を、極に近いものから取る。実数の零点が 1 つしか残っていなければ共役の組を取る
       （実数の極と零点の数の偶奇はそろっているので、最後に 1 次の段が 1 つだけ残る） */
    let zs: C[] = [];
    if (Z.length) {
      let i = nearest(Z, p1.r);
      if (ps.length === 2 && Z[i].real && nReal(Z) < 2) i = Z.findIndex((x) => !x.real);
      const z1 = take(Z, i);
      zs = pair(z1);
      if (z1.real && ps.length === 2) {
        const j = nearest(Z, ps[ps.length - 1], true);
        if (j >= 0) zs = [z1.r, take(Z, j).r];
      }
    }
    out.push({ z: zs, p: ps });
  }
  if (order === 'up') out.reverse();
  /* ゲインの配分 */
  const secs = out.map((s) => ({ b: quad(s.z), a: quad(s.p), z: s.z, p: s.p }));
  const grid = peakGrid(d.p),
    cum = new Float64Array(grid.length).fill(0);
  let G = 1;
  const res: Section[] = [];
  secs.forEach((s, i) => {
    let mx = -Infinity;
    grid.forEach((w, m) => {
      cum[m] += 20 * Math.log10(abs(evalZ(s.b, w)) / abs(evalZ(s.a, w)));
      if (cum[m] > mx) mx = cum[m];
    });
    /* 段のゲイン g: ここまでの積 G·g を、linf なら 1/（単位ゲインでの最大）、最後の段は全体のゲインにする */
    let g: number;
    if (gain === 'first') g = i === 0 ? d.k : 1;
    else if (i === secs.length - 1) g = d.k / G;
    else g = 10 ** (-mx / 20) / G;
    G *= g;
    res.push({
      b: [s.b[0] * g, s.b[1] * g, s.b[2] * g],
      a: s.a,
      z: s.z,
      p: s.p,
      peak: mx + 20 * Math.log10(Math.abs(G)),
    });
  });
  return res;
}

/** 振幅の最大を探す周波数 [rad/サンプル]: 一様な格子に、極の角度を足したもの */
function peakGrid(p: readonly C[]): number[] {
  const g: number[] = [];
  for (let i = 0; i <= 4096; i++) g.push((Math.PI * i) / 4096);
  for (const x of p) if (x.im >= 0) g.push(Math.atan2(x.im, x.re));
  return g;
}

/** 直接形の係数 b（ゲインを含む）と a（a₀ = 1） */
export function toBA(d: ZPK): { b: number[]; a: number[] } {
  return { b: fromRoots(d.z).map((x) => x * d.k), a: fromRoots(d.p) };
}

/** 係数の丸め: f32 は単精度、数字は有効数字の桁 */
export type Quant = 'f32' | `${number}`;
export function quantize(x: number, q: Quant): number {
  if (q === 'f32') return Math.fround(x);
  return x === 0 ? 0 : Number(x.toPrecision(Number(q)));
}

/** z⁻¹ の多項式の根（分母なら極、分子なら零点）。長さを揃えて z の多項式にする */
export const zRoots = (c: readonly number[]): C[] => canon(roots(c));

/* ---------- 周波数特性 ---------- */
export interface Curve {
  /** 振幅 [dB]・位相 [deg]（−180〜180）・群遅延 [サンプル] */
  mag: Float64Array;
  ph: Float64Array;
  gd: Float64Array;
}
const newCurve = (n: number): Curve => ({
  mag: new Float64Array(n),
  ph: new Float64Array(n),
  gd: new Float64Array(n),
});
const wrap = (d: number) => {
  const x = ((((d + 180) % 360) + 360) % 360) - 180;
  return x === -180 ? 180 : x;
};
const DEG = 180 / Math.PI;

/** 根の極形式 [ρ, θ] */
const polar = (rs: readonly C[]): [number, number][] => rs.map((r) => [abs(r), Math.atan2(r.im, r.re)]);

/**
 * 1 − ρe^{jθ}e^{−jω} の大きさの 2 乗・偏角と、群遅延への寄与。d = ω − θ、s = sin²(d/2) として
 * |…|² = (1 − ρ)² + 4ρs、群遅延 = (ρ(ρ − 1) + 2ρs)/|…|²（単位円の上の根の近くでも桁落ちしない形）
 */
function factor(rho: number, th: number, w: number): [number, number, number] {
  const d = w - th,
    h = Math.sin(d / 2),
    s = h * h,
    m2 = (1 - rho) * (1 - rho) + 4 * rho * s;
  return [m2, Math.atan2(rho * Math.sin(d), 1 - rho + 2 * rho * s), (rho * (rho - 1) + 2 * rho * s) / m2];
}

/** 振幅 [dB] と群遅延 [サンプル] を 1 点ずつ求める関数（ω [rad/サンプル]。位相を求めないぶん軽い） */
export function zpkFns(d: ZPK): { mag: (w: number) => number; gd: (w: number) => number } {
  const zs = polar(d.z),
    ps = polar(d.p),
    k2 = Math.log10(Math.abs(d.k)) * 2;
  const m2 = (rho: number, th: number, w: number) => {
    const h = Math.sin((w - th) / 2);
    return (1 - rho) * (1 - rho) + 4 * rho * h * h;
  };
  return {
    mag: (w) => {
      let lm = k2;
      for (const [r, t] of zs) lm += Math.log10(m2(r, t, w));
      for (const [r, t] of ps) lm -= Math.log10(m2(r, t, w));
      return 10 * lm;
    },
    gd: (w) => {
      let g = 0;
      for (const [r, t] of zs) {
        const h = Math.sin((w - t) / 2) ** 2;
        g += (r * (r - 1) + 2 * r * h) / ((1 - r) * (1 - r) + 4 * r * h);
      }
      for (const [r, t] of ps) {
        const h = Math.sin((w - t) / 2) ** 2;
        g -= (r * (r - 1) + 2 * r * h) / ((1 - r) * (1 - r) + 4 * r * h);
      }
      return g;
    },
  };
}

/** ZPK のデジタルフィルタの特性（f [Hz] の列） */
export function respZ(d: ZPK, f: ArrayLike<number>, fs: number): Curve {
  const o = newCurve(f.length),
    zs = polar(d.z),
    ps = polar(d.p);
  for (let i = 0; i < f.length; i++) {
    const w = (2 * Math.PI * f[i]) / fs;
    let lm = Math.log10(Math.abs(d.k)) * 2,
      ph = d.k < 0 ? Math.PI : 0,
      gd = 0;
    for (const [r, t] of zs) {
      const [m2, a, g] = factor(r, t, w);
      lm += Math.log10(m2);
      ph += a;
      gd += g;
    }
    for (const [r, t] of ps) {
      const [m2, a, g] = factor(r, t, w);
      lm -= Math.log10(m2);
      ph -= a;
      gd -= g;
    }
    o.mag[i] = 10 * lm;
    o.ph[i] = wrap(ph * DEG);
    o.gd[i] = gd;
  }
  return o;
}

/** アナログフィルタの特性（Ω = 2πf、群遅延は秒を fs 倍してサンプルに） */
export function respS(a: ZPK, f: ArrayLike<number>, fs: number): Curve {
  const o = newCurve(f.length);
  for (let i = 0; i < f.length; i++) {
    const W = 2 * Math.PI * f[i];
    let lm = Math.log10(Math.abs(a.k)) * 2,
      ph = a.k < 0 ? Math.PI : 0,
      gd = 0;
    /* (jΩ − c) の偏角の微分は −σ/|jΩ − c|² */
    for (const z of a.z) {
      const x = -z.re,
        y = W - z.im,
        m2 = x * x + y * y;
      lm += Math.log10(m2);
      ph += Math.atan2(y, x);
      gd += z.re / m2;
    }
    for (const p of a.p) {
      const x = -p.re,
        y = W - p.im,
        m2 = x * x + y * y;
      lm -= Math.log10(m2);
      ph -= Math.atan2(y, x);
      gd -= p.re / m2;
    }
    o.mag[i] = 10 * lm;
    o.ph[i] = wrap(ph * DEG);
    o.gd[i] = gd * fs;
  }
  return o;
}

/** 部分分数のデジタルフィルタの特性（群遅延は −Im(H′/H)） */
export function respPF(pf: PF, f: ArrayLike<number>, fs: number): Curve {
  const o = newCurve(f.length);
  for (let i = 0; i < f.length; i++) {
    const w = (2 * Math.PI * f[i]) / fs,
      e = { re: Math.cos(w), im: -Math.sin(w) };
    let h = cx(pf.d),
      dh = cx(0);
    pf.q.forEach((q, m) => {
      const qe = mul(q, e),
        den = sub(cx(1), qe);
      h = add(h, div(pf.c[m], den));
      /* d/dω [c/(1 − q e^{−jω})] = −c·j·q e^{−jω}/(1 − q e^{−jω})² */
      const t = div(mul(pf.c[m], qe), mul(den, den));
      dh = add(dh, { re: t.im, im: -t.re });
    });
    o.mag[i] = 20 * Math.log10(abs(h));
    o.ph[i] = wrap(Math.atan2(h.im, h.re) * DEG);
    o.gd[i] = -div(dh, h).im;
  }
  return o;
}

/** 直接形の係数 b/a の特性 */
export function respBA(b: readonly number[], a: readonly number[], f: ArrayLike<number>, fs: number): Curve {
  const o = newCurve(f.length);
  for (let i = 0; i < f.length; i++) {
    const w = (2 * Math.PI * f[i]) / fs,
      B = evalZ(b, w),
      A = evalZ(a, w),
      h = div(B, A);
    o.mag[i] = 20 * Math.log10(abs(h));
    o.ph[i] = wrap(Math.atan2(h.im, h.re) * DEG);
    o.gd[i] = div(evalZd(b, w), B).re - div(evalZd(a, w), A).re;
  }
  return o;
}

/** 双2次の縦続の特性（段の積） */
export function respSOS(S: readonly Section[], f: ArrayLike<number>, fs: number): Curve {
  const o = newCurve(f.length);
  for (let i = 0; i < f.length; i++) {
    const w = (2 * Math.PI * f[i]) / fs;
    let h = cx(1),
      gd = 0;
    for (const s of S) {
      const B = evalZ(s.b, w),
        A = evalZ(s.a, w);
      h = mul(h, div(B, A));
      gd += div(evalZd(s.b, w), B).re - div(evalZd(s.a, w), A).re;
    }
    o.mag[i] = 20 * Math.log10(abs(h));
    o.ph[i] = wrap(Math.atan2(h.im, h.re) * DEG);
    o.gd[i] = gd;
  }
  return o;
}

/* ---------- 時間応答 ---------- */
/** 双2次の縦続（転置直接形 II）のインパルス応答 */
export function impulseSOS(S: readonly Section[], n: number): Float64Array {
  const x = new Float64Array(n);
  x[0] = 1;
  for (const s of S) {
    let s1 = 0,
      s2 = 0;
    const [b0, b1, b2] = s.b,
      [, a1, a2] = s.a;
    for (let i = 0; i < n; i++) {
      const v = x[i],
        y = b0 * v + s1;
      s1 = b1 * v - a1 * y + s2;
      s2 = b2 * v - a2 * y;
      x[i] = y;
    }
  }
  return x;
}

/** 直接形（差分方程式）のインパルス応答 */
export function impulseBA(b: readonly number[], a: readonly number[], n: number): Float64Array {
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let v = i < b.length ? b[i] : 0;
    for (let k = 1; k < a.length && k <= i; k++) v -= a[k] * y[i - k];
    y[i] = v / a[0];
  }
  return y;
}

/** 部分分数のインパルス応答 h[n] = Σ cᵢqᵢⁿ（+ d δ[n]） */
export function impulsePF(pf: PF, n: number): Float64Array {
  const y = new Float64Array(n);
  pf.q.forEach((q, m) => {
    let v = pf.c[m];
    for (let i = 0; i < n; i++) {
      y[i] += v.re;
      v = mul(v, q);
    }
  });
  if (n) y[0] += pf.d;
  return y;
}

/**
 * アナログのインパルス応答を T 倍して標本化したもの T·hₐ(nT)（δ の項は除く）と、
 * ステップ応答 sₐ(nT) = d + Σ rᵢ(e^{pᵢnT} − 1)/pᵢ
 */
export function analogTime(f: ZPK, fs: number, n: number): { h: Float64Array; s: Float64Array } {
  const pf = impinv(f, fs),
    T = 1 / fs,
    h = new Float64Array(n),
    s = new Float64Array(n).fill(pf.d);
  f.p.forEach((p, m) => {
    const r = scale(pf.c[m], fs),
      rp = div(r, p),
      q = pf.q[m];
    let e = cx(1);
    for (let i = 0; i < n; i++) {
      h[i] += mul(r, e).re * T;
      s[i] += mul(rp, sub(e, cx(1))).re;
      e = mul(e, q);
    }
  });
  return { h, s };
}

/** 累積和（インパルス応答からステップ応答） */
export function cumsum(h: Float64Array): Float64Array {
  const s = new Float64Array(h.length);
  let a = 0;
  for (let i = 0; i < h.length; i++) {
    a += h[i];
    s[i] = a;
  }
  return s;
}
