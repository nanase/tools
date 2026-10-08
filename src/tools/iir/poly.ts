/** 多項式: 根からの展開、根（Aberth–Ehrlich 法）、安定判別（Schur–Cohn の反射係数） */
import { abs, type C, div, mul, sub } from './complex';

/**
 * Π (1 − r·x) の係数（x の昇べき、先頭は 1）。z⁻¹ の多項式に使う。
 * 根は共役の組で与えるので、係数の虚部は丸めの誤差だけになり、実部だけを返す
 */
export function fromRoots(rs: readonly C[]): number[] {
  let re = [1],
    im = [0];
  for (const r of rs) {
    const nr = [...re, 0],
      ni = [...im, 0];
    for (let i = 1; i < nr.length; i++) {
      nr[i] -= r.re * re[i - 1] - r.im * im[i - 1];
      ni[i] -= r.re * im[i - 1] + r.im * re[i - 1];
    }
    re = nr;
    im = ni;
  }
  return re;
}

/** 実係数の多項式の積 */
export function polyMul(a: readonly number[], b: readonly number[]): number[] {
  const o = new Array<number>(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) o[i + j] += a[i] * b[j];
  return o;
}

/** Horner 法で p(z) と p′(z)、丸めの誤差の目安 Σ|dᵢ||z|ⁿ⁻ⁱ（d は降べきの係数） */
function horner(d: readonly number[], z: C): [C, C, number] {
  let p: C = { re: d[0], im: 0 },
    q: C = { re: 0, im: 0 },
    e = Math.abs(d[0]);
  const az = abs(z);
  for (let i = 1; i < d.length; i++) {
    q = { re: q.re * z.re - q.im * z.im + p.re, im: q.re * z.im + q.im * z.re + p.im };
    p = { re: p.re * z.re - p.im * z.im + d[i], im: p.re * z.im + p.im * z.re };
    e = e * az + Math.abs(d[i]);
  }
  return [p, q, e];
}

/**
 * 実係数の多項式（降べき d[0] zⁿ + … + d[n]）の根を Aberth–Ehrlich 法で求める。
 * 根の大きさの幾何平均で z を縮めてから解き、末尾の 0 の係数は z = 0 の根にする。
 * |p(z)| が Horner 法の丸めの誤差の目安を下回った根は、それ以上は動かさない
 * （近く集まった根は倍精度ではそれ以上決まらないため）
 */
export function roots(d: readonly number[]): C[] {
  let c = [...d];
  while (c.length > 1 && c[0] === 0) c.shift();
  const zero: C[] = [];
  while (c.length > 1 && c[c.length - 1] === 0) {
    c.pop();
    zero.push({ re: 0, im: 0 });
  }
  const n = c.length - 1;
  if (n < 1) return zero;
  const s = Math.abs(c[n] / c[0]) ** (1 / n) || 1;
  /* z = s·w と置いた多項式（最高次の係数を 1 にする） */
  c = c.map((x, i) => x / c[0] / s ** i);
  const w: C[] = Array.from({ length: n }, (_, k) => {
    const t = (2 * Math.PI * k) / n + 0.4;
    return { re: Math.cos(t), im: Math.sin(t) };
  });
  const done = new Array<boolean>(n).fill(false),
    tol = 4 * n * Number.EPSILON;
  for (let it = 0; it < 500; it++) {
    let mx = 0;
    for (let k = 0; k < n; k++) {
      if (done[k]) continue;
      const [p, q, e] = horner(c, w[k]);
      if (p.re === 0 && p.im === 0) {
        done[k] = true;
        continue;
      }
      /* 丸めの誤差の目安まで来たら、この更新を最後にする */
      if (abs(p) <= tol * e) done[k] = true;
      const r = div(p, q);
      let sm: C = { re: 0, im: 0 };
      for (let j = 0; j < n; j++) {
        if (j === k) continue;
        const t = div({ re: 1, im: 0 }, sub(w[k], w[j]));
        sm = { re: sm.re + t.re, im: sm.im + t.im };
      }
      const dn = sub({ re: 1, im: 0 }, mul(r, sm)),
        dw = div(r, dn);
      if (!Number.isFinite(dw.re) || !Number.isFinite(dw.im)) continue;
      w[k] = sub(w[k], dw);
      mx = Math.max(mx, abs(dw) / Math.max(abs(w[k]), 1e-300));
    }
    if (mx < 1e-15 || done.every(Boolean)) break;
  }
  return [...zero, ...w.map((z) => ({ re: z.re * s, im: z.im * s }))];
}

/* ---------- 安定判別 ---------- */
/** 固定小数点の小数部のビット数（段下げで誤差が大きく増えても判定を誤らない桁） */
const P = 1600n;
const ONE = 1n << P;

/** 倍精度の値を、そのまま（丸めずに）2^P 倍の整数にする */
function toFixed(x: number): bigint {
  if (x === 0) return 0n;
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0),
    ex = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(dv.getUint32(4)),
    e: number;
  if (ex === 0) e = -1074;
  else {
    m |= 1n << 52n;
    e = ex - 1075;
  }
  const sh = P + BigInt(e),
    v = sh >= 0n ? m << sh : m >> -sh;
  return hi >>> 31 ? -v : v;
}

/**
 * 分母 a₀ + a₁z⁻¹ + … + aₙz⁻ⁿ の極がすべて単位円の内側にあるか（Schur–Cohn の段下げ。
 * 反射係数 kₘ = cₘ/c₀ の大きさがすべて 1 未満なら安定）。
 * 高い次数では倍精度の段下げ自体が誤るので、係数の値をそのまま 1600 bit の固定小数点にして求める
 */
export function isStable(a: readonly number[]): boolean {
  let c = a.map(toFixed);
  if (c[0] === 0n) return false;
  const c0 = c[0];
  c = c.map((x) => (x << P) / c0);
  for (let m = c.length - 1; m >= 1; m--) {
    const k = c[m];
    if ((k < 0n ? -k : k) >= ONE) return false;
    const d = ONE - ((k * k) >> P),
      nc: bigint[] = [];
    for (let i = 0; i < m; i++) nc.push(((c[i] - ((k * c[m - i]) >> P)) << P) / d);
    c = nc;
  }
  return true;
}

/** Σ c[k] e^{−jωk}（z⁻¹ の多項式を単位円上で求める） */
export function evalZ(c: readonly number[], w: number): C {
  let re = 0,
    im = 0;
  const cw = Math.cos(w),
    sw = Math.sin(w);
  for (let k = c.length - 1; k >= 0; k--) {
    /* Horner: v ← v·e^{−jω} + c[k] */
    const r = re * cw + im * sw,
      i = im * cw - re * sw;
    re = r + c[k];
    im = i;
  }
  return { re, im };
}

/** Σ k·c[k] e^{−jωk}（群遅延の計算に使う） */
export function evalZd(c: readonly number[], w: number): C {
  return evalZ(
    c.map((x, k) => k * x),
    w,
  );
}
