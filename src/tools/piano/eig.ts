/**
 * 駒で結合した弦のモード（DOM に依存しない）。同じ駒につながる弦の部分音 j（弦だけの複素角周波数 d_j）は、
 * 駒の力の振幅 F_j について (λ − d_j) F_j = i Y (T_j / L_j) Σ_i F_i を満たす（Gough 1981・Weinreich 1977。
 * e^{iλt} の表し方で、虚部が減衰率）。F_j = g_j w_j（g_j = √(T_j / L_j)）と置くと、行列は対角 + 階数 1 の
 * 複素対称 D + i v vᵀ（v_j = g_j √Y_j）になり、固有値は永年方程式 1 = i Σ v_j² / (λ − d_j) の根になる
 */

/** 複素数の配列（実部と虚部を別に持つ） */
export interface CVec {
  re: Float64Array;
  im: Float64Array;
}
export const cvec = (n: number): CVec => ({ re: new Float64Array(n), im: new Float64Array(n) });

export interface Coupled {
  /** 固有値（結合したモードの複素角周波数。実部 [rad/s]、虚部は減衰率 [1/s]） */
  lam: CVec;
  /** 固有ベクトル u_m（行 m、列 j。u_mᵀ u_m = 1 に正規化） */
  u: CVec[];
}

/** 複素数の割り算 (ar + i ai) / (br + i bi) */
const cdiv = (ar: number, ai: number, br: number, bi: number): [number, number] => {
  const d = br * br + bi * bi;
  return [(ar * br + ai * bi) / d, (ai * br - ar * bi) / d];
};
const cmul = (ar: number, ai: number, br: number, bi: number): [number, number] => [
  ar * br - ai * bi,
  ar * bi + ai * br,
];
/** 複素数の平方根（主値） */
export const csqrt = (re: number, im: number): [number, number] => {
  const r = Math.hypot(re, im),
    a = Math.sqrt((r + re) / 2),
    b = Math.sqrt(Math.max(0, (r - re) / 2));
  return [a, im < 0 ? -b : b];
};

/**
 * D + i v vᵀ の固有値と固有ベクトル（d と v は長さ n の複素数）。
 * 固有値は永年方程式の根を Aberth 法で一度に求め、固有ベクトルは u_j ∝ v_j / (λ − d_j)。
 * d が重なると固有ベクトルが求まらないので、呼ぶ側で d を少しずらしておく
 */
export function coupled(d: CVec, v: CVec): Coupled {
  const n = d.re.length;
  /* 原点を d の平均へずらし、大きさを結合の強さでそろえる */
  let or = 0,
    oi = 0;
  for (let j = 0; j < n; j++) {
    or += d.re[j] / n;
    oi += d.im[j] / n;
  }
  /* v² と、ずらした d */
  const v2r = new Float64Array(n),
    v2i = new Float64Array(n),
    dr = new Float64Array(n),
    di = new Float64Array(n);
  let scale = 0;
  for (let j = 0; j < n; j++) {
    [v2r[j], v2i[j]] = cmul(v.re[j], v.im[j], v.re[j], v.im[j]);
    dr[j] = d.re[j] - or;
    di[j] = d.im[j] - oi;
    scale = Math.max(scale, Math.hypot(dr[j], di[j]), Math.hypot(v2r[j], v2i[j]));
  }
  if (scale === 0) scale = 1;
  /*
   * f(λ) = 1 − i S(λ)、S = Σ v_j² / (λ − d_j) の根は、多項式 P(λ) = Π(λ − d_j) f(λ) の根。
   * Aberth 法に使う対数微分 P'/P = Σ 1/(λ − d_j) + f'/f（f' = i Σ v_j² / (λ − d_j)²）
   */
  const logDeriv = (zr: number, zi: number): [number, number] => {
    let sr = 0,
      si = 0,
      tr = 0,
      ti = 0,
      lr = 0,
      li = 0;
    for (let j = 0; j < n; j++) {
      const [ar, ai] = cdiv(1, 0, zr - dr[j], zi - di[j]),
        [br, bi] = cmul(v2r[j], v2i[j], ar, ai),
        [cr, ci] = cmul(br, bi, ar, ai);
      sr += br;
      si += bi;
      tr += cr;
      ti += ci;
      lr += ar;
      li += ai;
    }
    const [qr, qi] = cdiv(-ti, tr, 1 + si, -sr);
    return [lr + qr, li + qi];
  };
  /* 初期値: 各 d_j を少し動かした点 */
  const zr = new Float64Array(n),
    zi = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const [ar, ai] = cmul(0, 1, v2r[j], v2i[j]);
    zr[j] = dr[j] + ar + 1e-6 * scale * Math.cos(j + 0.3);
    zi[j] = di[j] + ai + 1e-6 * scale * Math.sin(j + 0.3);
  }
  for (let it = 0; it < 200; it++) {
    let moved = 0;
    for (let j = 0; j < n; j++) {
      const [lr, li] = logDeriv(zr[j], zi[j]);
      /* Aberth: w = (p'/p) / (1 − (p'/p)·Σ_{k≠j} 1/(z_j − z_k)) の逆数で動かす */
      let er = 0,
        ei = 0;
      for (let k = 0; k < n; k++) {
        if (k === j) continue;
        const [ar, ai] = cdiv(1, 0, zr[j] - zr[k], zi[j] - zi[k]);
        er += ar;
        ei += ai;
      }
      const [nr, ni] = cdiv(1, 0, lr - er, li - ei);
      if (!Number.isFinite(nr) || !Number.isFinite(ni)) continue;
      zr[j] -= nr;
      zi[j] -= ni;
      moved = Math.max(moved, Math.hypot(nr, ni));
    }
    if (moved < 1e-13 * scale) break;
  }
  const lam = cvec(n),
    u: CVec[] = [];
  for (let m = 0; m < n; m++) {
    lam.re[m] = zr[m] + or;
    lam.im[m] = zi[m] + oi;
    const x = cvec(n);
    let nr = 0,
      ni = 0;
    for (let j = 0; j < n; j++) {
      const [ar, ai] = cdiv(v.re[j], v.im[j], zr[m] - dr[j], zi[m] - di[j]);
      x.re[j] = ar;
      x.im[j] = ai;
      const [sr, si] = cmul(ar, ai, ar, ai);
      nr += sr;
      ni += si;
    }
    /* u_mᵀ u_m = 1（複素対称の正規化） */
    const [qr, qi] = csqrt(nr, ni),
      [ir, ii] = cdiv(1, 0, qr, qi);
    for (let j = 0; j < n; j++) [x.re[j], x.im[j]] = cmul(x.re[j], x.im[j], ir, ii);
    u.push(x);
  }
  return { lam, u };
}

/** 初期値 w0（長さ n の複素数）を固有ベクトルに分ける係数 c_m = u_mᵀ w0 */
export function project(c: Coupled, w0: CVec): CVec {
  const n = w0.re.length,
    out = cvec(n);
  for (let m = 0; m < n; m++) {
    let sr = 0,
      si = 0;
    const u = c.u[m];
    for (let j = 0; j < n; j++) {
      const [ar, ai] = cmul(u.re[j], u.im[j], w0.re[j], w0.im[j]);
      sr += ar;
      si += ai;
    }
    out.re[m] = sr;
    out.im[m] = si;
  }
  return out;
}
