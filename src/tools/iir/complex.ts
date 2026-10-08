/** 複素数の計算（IIR フィルタの設計で使う最小限） */
export interface C {
  re: number;
  im: number;
}

export const cx = (re: number, im = 0): C => ({ re, im });
export const add = (a: C, b: C): C => ({ re: a.re + b.re, im: a.im + b.im });
export const sub = (a: C, b: C): C => ({ re: a.re - b.re, im: a.im - b.im });
export const mul = (a: C, b: C): C => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
export const scale = (a: C, s: number): C => ({ re: a.re * s, im: a.im * s });
export const conj = (a: C): C => ({ re: a.re, im: -a.im });
export const neg = (a: C): C => ({ re: -a.re, im: -a.im });
export const abs = (a: C): number => Math.hypot(a.re, a.im);
export const arg = (a: C): number => Math.atan2(a.im, a.re);

export function div(a: C, b: C): C {
  /* Smith の方法（大きさの違う値でも桁あふれしにくい） */
  if (Math.abs(b.re) >= Math.abs(b.im)) {
    const r = b.im / b.re,
      d = b.re + b.im * r;
    return { re: (a.re + a.im * r) / d, im: (a.im - a.re * r) / d };
  }
  const r = b.re / b.im,
    d = b.re * r + b.im;
  return { re: (a.re * r + a.im) / d, im: (a.im * r - a.re) / d };
}

export const inv = (a: C): C => div({ re: 1, im: 0 }, a);

/** 主値の平方根（実部 ≥ 0） */
export function sqrt(a: C): C {
  const m = abs(a);
  if (m === 0) return { re: 0, im: 0 };
  const r = Math.sqrt((m + Math.abs(a.re)) / 2);
  if (a.re >= 0) return { re: r, im: a.im / (2 * r) };
  return { re: Math.abs(a.im) / (2 * r), im: a.im < 0 ? -r : r };
}

export const exp = (a: C): C => {
  const e = Math.exp(a.re);
  return { re: e * Math.cos(a.im), im: e * Math.sin(a.im) };
};
export const cos = (a: C): C => ({ re: Math.cos(a.re) * Math.cosh(a.im), im: -Math.sin(a.re) * Math.sinh(a.im) });
export const sin = (a: C): C => ({ re: Math.sin(a.re) * Math.cosh(a.im), im: Math.cos(a.re) * Math.sinh(a.im) });

/** 根の積 Π (x − r)（x は実数でも複素数でもよい） */
export function prodDiff(x: C, rs: readonly C[]): C {
  let p: C = { re: 1, im: 0 };
  for (const r of rs) p = mul(p, sub(x, r));
  return p;
}

/**
 * 実係数の多項式の根を、実数の根と共役の組に整える。虚部が小さいものは実数にし、
 * 複素数の根は虚部が正のものだけを残して、その共役を隣に置く（順は [実数…, a, ā, b, b̄…]）
 */
export function canon(rs: readonly C[], tol = 1e-9): C[] {
  const re: C[] = [],
    up: C[] = [],
    lo: C[] = [];
  for (const r of rs) {
    if (Math.abs(r.im) <= tol * Math.max(1, abs(r))) re.push({ re: r.re, im: 0 });
    else (r.im > 0 ? up : lo).push(r);
  }
  /* 組になる共役（下半面の最も近い根）と平均して、丸めの誤差を両方からならす */
  for (let i = 0; i < up.length; i++) {
    let bj = -1,
      bd = Infinity;
    lo.forEach((x, j) => {
      const d = Math.hypot(x.re - up[i].re, x.im + up[i].im);
      if (d < bd) {
        bd = d;
        bj = j;
      }
    });
    if (bj < 0 || bd > 1e-6 * Math.max(1, abs(up[i]))) continue;
    const x = lo.splice(bj, 1)[0];
    up[i] = { re: (up[i].re + x.re) / 2, im: (up[i].im - x.im) / 2 };
  }
  re.sort((a, b) => a.re - b.re);
  up.sort((a, b) => a.im - b.im || a.re - b.re);
  return [...re, ...up.flatMap((r) => [r, conj(r)])];
}
