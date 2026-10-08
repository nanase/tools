/**
 * 小さな密行列の計算（DOM に依存しない）: 積・逆行列・固有値（ヘッセンベルク化と QR 法）、
 * アッカーマンの式による極配置、行列の符号関数による連続時間の代数リカッチ方程式の解
 */
export type Mat = number[][];
/** 複素数（極） */
export interface C {
  re: number;
  im: number;
}

export const zeros = (n: number, m = n): Mat => Array.from({ length: n }, () => new Array<number>(m).fill(0));
export const eye = (n: number): Mat => zeros(n).map((r, i) => r.map((_, j) => (i === j ? 1 : 0)));
export const copy = (A: Mat): Mat => A.map((r) => r.slice());
export const tr = (A: Mat): Mat => A[0].map((_, j) => A.map((r) => r[j]));
export const add = (A: Mat, B: Mat, s = 1): Mat => A.map((r, i) => r.map((v, j) => v + s * B[i][j]));
export const scale = (A: Mat, s: number): Mat => A.map((r) => r.map((v) => v * s));

export function mul(A: Mat, B: Mat): Mat {
  const n = A.length,
    m = B[0].length,
    k = B.length,
    R = zeros(n, m);
  for (let i = 0; i < n; i++)
    for (let p = 0; p < k; p++) {
      const a = A[i][p];
      if (a) for (let j = 0; j < m; j++) R[i][j] += a * B[p][j];
    }
  return R;
}
/** 行列とベクトルの積 */
export const mulv = (A: Mat, x: readonly number[]): number[] => A.map((r) => r.reduce((s, v, j) => s + v * x[j], 0));
/** 1 ノルム（列の絶対値の和の最大） */
export const norm1 = (A: Mat): number => Math.max(...A[0].map((_, j) => A.reduce((s, r) => s + Math.abs(r[j]), 0)));

/** 部分ピボット選択の LU 分解で逆行列と行列式を求める。特異なら null */
export function invDet(A: Mat): { inv: Mat; det: number } | null {
  const n = A.length,
    M = copy(A),
    I = eye(n);
  let det = 1;
  const big = norm1(A) || 1;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (!(Math.abs(M[p][c]) > big * 1e-15)) return null;
    if (p !== c) {
      [M[p], M[c]] = [M[c], M[p]];
      [I[p], I[c]] = [I[c], I[p]];
      det = -det;
    }
    const d = M[c][c];
    det *= d;
    for (let j = 0; j < n; j++) {
      M[c][j] /= d;
      I[c][j] /= d;
    }
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (!f) continue;
      for (let j = 0; j < n; j++) {
        M[r][j] -= f * M[c][j];
        I[r][j] -= f * I[c][j];
      }
    }
  }
  return { inv: I, det };
}
export const inv = (A: Mat): Mat | null => invDet(A)?.inv ?? null;

/* ---------- 固有値 ---------- */
/** 行と列を 2 の累乗で釣り合わせる（固有値は変わらない。丸めの誤差を減らす） */
function balance(a: Mat): void {
  const n = a.length;
  let done = false;
  while (!done) {
    done = true;
    for (let i = 0; i < n; i++) {
      let r = 0,
        c = 0;
      for (let j = 0; j < n; j++)
        if (j !== i) {
          c += Math.abs(a[j][i]);
          r += Math.abs(a[i][j]);
        }
      if (!c || !r) continue;
      let g = r / 2,
        f = 1;
      const s = c + r;
      while (c < g) {
        f *= 2;
        c *= 4;
      }
      g = r * 2;
      while (c > g) {
        f /= 2;
        c /= 4;
      }
      if ((c + r) / f < 0.95 * s) {
        done = false;
        for (let j = 0; j < n; j++) a[i][j] /= f;
        for (let j = 0; j < n; j++) a[j][i] *= f;
      }
    }
  }
}

/** 消去法で上ヘッセンベルク形にする（副対角より下は以後使わない） */
function hessenberg(a: Mat): void {
  const n = a.length;
  for (let m = 1; m < n - 1; m++) {
    let x = 0,
      i = m;
    for (let j = m; j < n; j++)
      if (Math.abs(a[j][m - 1]) > Math.abs(x)) {
        x = a[j][m - 1];
        i = j;
      }
    if (i !== m) {
      for (let j = m - 1; j < n; j++) [a[i][j], a[m][j]] = [a[m][j], a[i][j]];
      for (let j = 0; j < n; j++) [a[j][i], a[j][m]] = [a[j][m], a[j][i]];
    }
    if (x)
      for (let i2 = m + 1; i2 < n; i2++) {
        let y = a[i2][m - 1];
        if (!y) continue;
        y /= x;
        a[i2][m - 1] = y;
        for (let j = m; j < n; j++) a[i2][j] -= y * a[m][j];
        for (let j = 0; j < n; j++) a[j][m] += y * a[j][i2];
      }
  }
}

/** 上ヘッセンベルク行列の固有値（Francis の複シフト QR 法。Numerical Recipes の hqr を 1 始まりのまま移した） */
function hqr(h: Mat): C[] | null {
  const n = h.length;
  /* 1 始まりの添字で使う */
  const a: number[][] = [[], ...h.map((r) => [0, ...r])];
  const wr = new Array<number>(n + 1).fill(0),
    wi = new Array<number>(n + 1).fill(0);
  let anorm = 0;
  for (let i = 1; i <= n; i++) for (let j = Math.max(i - 1, 1); j <= n; j++) anorm += Math.abs(a[i][j]);
  let nn = n,
    t = 0;
  let p = 0,
    q = 0,
    r = 0,
    s = 0,
    w = 0,
    x = 0,
    y = 0,
    z = 0;
  while (nn >= 1) {
    let its = 0,
      l: number;
    do {
      for (l = nn; l >= 2; l--) {
        s = Math.abs(a[l - 1][l - 1]) + Math.abs(a[l][l]);
        if (s === 0) s = anorm;
        if (Math.abs(a[l][l - 1]) + s === s) {
          a[l][l - 1] = 0;
          break;
        }
      }
      x = a[nn][nn];
      if (l === nn) {
        wr[nn] = x + t;
        wi[nn--] = 0;
      } else {
        y = a[nn - 1][nn - 1];
        w = a[nn][nn - 1] * a[nn - 1][nn];
        if (l === nn - 1) {
          p = 0.5 * (y - x);
          q = p * p + w;
          z = Math.sqrt(Math.abs(q));
          x += t;
          if (q >= 0) {
            z = p + (p >= 0 ? Math.abs(z) : -Math.abs(z));
            wr[nn - 1] = wr[nn] = x + z;
            if (z) wr[nn] = x - w / z;
            wi[nn - 1] = wi[nn] = 0;
          } else {
            wr[nn - 1] = wr[nn] = x + p;
            wi[nn] = z;
            wi[nn - 1] = -z;
          }
          nn -= 2;
        } else {
          if (its === 60) return null;
          if (its === 10 || its === 20) {
            t += x;
            for (let i = 1; i <= nn; i++) a[i][i] -= x;
            s = Math.abs(a[nn][nn - 1]) + Math.abs(a[nn - 1][nn - 2]);
            y = x = 0.75 * s;
            w = -0.4375 * s * s;
          }
          ++its;
          let m: number;
          for (m = nn - 2; m >= l; m--) {
            z = a[m][m];
            r = x - z;
            s = y - z;
            p = (r * s - w) / a[m + 1][m] + a[m][m + 1];
            q = a[m + 1][m + 1] - z - r - s;
            r = a[m + 2][m + 1];
            s = Math.abs(p) + Math.abs(q) + Math.abs(r);
            p /= s;
            q /= s;
            r /= s;
            if (m === l) break;
            const u = Math.abs(a[m][m - 1]) * (Math.abs(q) + Math.abs(r)),
              v = Math.abs(p) * (Math.abs(a[m - 1][m - 1]) + Math.abs(z) + Math.abs(a[m + 1][m + 1]));
            if (u + v === v) break;
          }
          for (let i = m + 2; i <= nn; i++) {
            a[i][i - 2] = 0;
            if (i !== m + 2) a[i][i - 3] = 0;
          }
          for (let k = m; k <= nn - 1; k++) {
            if (k !== m) {
              p = a[k][k - 1];
              q = a[k + 1][k - 1];
              r = 0;
              if (k !== nn - 1) r = a[k + 2][k - 1];
              x = Math.abs(p) + Math.abs(q) + Math.abs(r);
              if (x !== 0) {
                p /= x;
                q /= x;
                r /= x;
              }
            }
            const sq = Math.sqrt(p * p + q * q + r * r);
            s = p >= 0 ? sq : -sq;
            if (s !== 0) {
              if (k === m) {
                if (l !== m) a[k][k - 1] = -a[k][k - 1];
              } else a[k][k - 1] = -s * x;
              p += s;
              x = p / s;
              y = q / s;
              z = r / s;
              q /= p;
              r /= p;
              for (let j = k; j <= nn; j++) {
                p = a[k][j] + q * a[k + 1][j];
                if (k !== nn - 1) {
                  p += r * a[k + 2][j];
                  a[k + 2][j] -= p * z;
                }
                a[k + 1][j] -= p * y;
                a[k][j] -= p * x;
              }
              const mmin = nn < k + 3 ? nn : k + 3;
              for (let i = l; i <= mmin; i++) {
                p = x * a[i][k] + y * a[i][k + 1];
                if (k !== nn - 1) {
                  p += z * a[i][k + 2];
                  a[i][k + 2] -= p * r;
                }
                a[i][k + 1] -= p * q;
                a[i][k] -= p;
              }
            }
          }
        }
      }
    } while (l < nn - 1);
  }
  const out: C[] = [];
  for (let i = 1; i <= n; i++) out.push({ re: wr[i], im: wi[i] });
  return out;
}

/** 実正方行列の固有値。実部の大きい順（同じなら虚部の大きい順）。求まらなければ null */
export function eig(A: Mat): C[] | null {
  if (!A.length) return [];
  if (!A.every((r) => r.every(Number.isFinite))) return null;
  const a = copy(A);
  balance(a);
  hessenberg(a);
  const e = hqr(a);
  return e ? e.sort((u, v) => v.re - u.re || v.im - u.im) : null;
}

/* ---------- 極配置 ---------- */
/** 根から実係数の多項式 s^n + c[n−1] s^(n−1) + … + c[0] の係数 c（低次から）。複素根は共役の組で与える */
export function polyFromRoots(roots: readonly C[]): number[] {
  let re = [1],
    im = [0];
  for (const r of roots) {
    const nr = new Array<number>(re.length + 1).fill(0),
      ni = new Array<number>(re.length + 1).fill(0);
    /* (s − r)·P(s): 係数は高次から */
    for (let i = 0; i < re.length; i++) {
      nr[i] += re[i];
      ni[i] += im[i];
      nr[i + 1] -= re[i] * r.re - im[i] * r.im;
      ni[i + 1] -= re[i] * r.im + im[i] * r.re;
    }
    re = nr;
    im = ni;
  }
  return re.slice(1).reverse();
}

/** 可制御性行列 [B AB A²B …]（入力 1 つ） */
export function ctrb(A: Mat, b: readonly number[]): Mat {
  const n = A.length,
    cols: number[][] = [b.slice()];
  for (let k = 1; k < n; k++) cols.push(mulv(A, cols[k - 1]));
  return tr(cols);
}

/**
 * アッカーマンの式: K = [0 … 0 1] C⁻¹ φ(A)。A − bK の固有値が poles になる。
 * 可制御でなければ null
 */
export function acker(A: Mat, b: readonly number[], poles: readonly C[]): number[] | null {
  const n = A.length,
    Ci = inv(ctrb(A, b));
  if (!Ci) return null;
  const c = polyFromRoots(poles);
  /* φ(A) = Aⁿ + c[n−1]Aⁿ⁻¹ + … + c[0]I をホーナー法で */
  let P = eye(n);
  for (let k = n - 1; k >= 0; k--) P = add(mul(P, A), eye(n), c[k]);
  const last = Ci[n - 1];
  return P[0].map((_, j) => last.reduce((s, v, i) => s + v * P[i][j], 0));
}

/* ---------- LQR ---------- */
/**
 * 連続時間の代数リカッチ方程式 AᵀP + PA − PBR⁻¹BᵀP + Q = 0 の安定化解。
 * ハミルトン行列の符号関数（行列式で尺度を合わせたニュートン法）から求める。求まらなければ null
 */
export function care(A: Mat, B: Mat, Q: Mat, R: Mat): Mat | null {
  const n = A.length,
    Ri = inv(R);
  if (!Ri) return null;
  const G = mul(mul(B, Ri), tr(B)),
    At = tr(A);
  let Z = zeros(2 * n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      Z[i][j] = A[i][j];
      Z[i][j + n] = -G[i][j];
      Z[i + n][j] = -Q[i][j];
      Z[i + n][j + n] = -At[i][j];
    }
  let ok = false;
  for (let it = 0; it < 100; it++) {
    const d = invDet(Z);
    if (!d || !Number.isFinite(d.det) || d.det === 0) return null;
    /* 尺度 c = |det Z|^(1/2n)（収束が遅い初めだけ効く） */
    const c = Math.abs(d.det) ** (1 / (2 * n)),
      Zn = add(scale(Z, 0.5 / c), d.inv, 0.5 * c),
      dz = norm1(add(Zn, Z, -1)) / norm1(Zn);
    Z = Zn;
    if (!(dz < Infinity)) return null;
    if (dz < 1e-13) {
      ok = true;
      break;
    }
  }
  if (!ok) return null;
  /* [W12; W22 + I] P = −[W11 + I; W21] を最小二乗で解く */
  const M = zeros(2 * n, n),
    N = zeros(2 * n, n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      M[i][j] = Z[i][j + n];
      M[i + n][j] = Z[i + n][j + n] + (i === j ? 1 : 0);
      N[i][j] = -(Z[i][j] + (i === j ? 1 : 0));
      N[i + n][j] = -Z[i + n][j];
    }
  const Mt = tr(M),
    Ni = inv(mul(Mt, M));
  if (!Ni) return null;
  const P = mul(Ni, mul(Mt, N));
  /* 対称にそろえる */
  return P.map((r, i) => r.map((v, j) => (v + P[j][i]) / 2));
}

/** リカッチ方程式の残差 AᵀP + PA − PBR⁻¹BᵀP + Q */
export function careResidual(A: Mat, B: Mat, Q: Mat, R: Mat, P: Mat): Mat {
  const Ri = inv(R) ?? zeros(R.length),
    PB = mul(P, B);
  return add(add(add(mul(tr(A), P), mul(P, A)), mul(mul(PB, Ri), tr(PB)), -1), Q);
}

/** LQR のゲイン K = R⁻¹BᵀP（入力 1 つ、u = −Kx） */
export function lqr(A: Mat, b: readonly number[], q: readonly number[], r: number): { K: number[]; P: Mat } | null {
  const n = A.length,
    B = b.map((v) => [v]),
    Q = zeros(n).map((row, i) => row.map((_, j) => (i === j ? q[i] : 0))),
    P = care(A, B, Q, [[r]]);
  if (!P?.every((row) => row.every(Number.isFinite))) return null;
  const K = tr(B)[0].map((_, j) => b.reduce((s, v, i) => s + v * P[i][j], 0) / r);
  return { K, P };
}
