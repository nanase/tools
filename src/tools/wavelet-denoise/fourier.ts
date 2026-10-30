/**
 * フーリエの側の比べる相手（DOM に依存しない）。どれも正規直交にそろえ、係数の 2 乗和が信号の 2 乗和に等しい。
 * DCT・DFT は全体を 1 回で変換し、MDCT は 2M 点の枠を M 点ずつずらす（音の符号化と同じ形）
 */
import { fft, plan } from '../spectrum/fft';

/** 長さ N（2 の累乗）の DCT-II（正規直交）。Makhoul の並べ替えで N 点の FFT 1 回 */
export function dct(x: ArrayLike<number>): Float64Array {
  const N = x.length,
    p = plan(N),
    out = new Float64Array(N);
  for (let n = 0; n < N / 2; n++) {
    p.re[n] = x[2 * n];
    p.re[N - 1 - n] = x[2 * n + 1];
  }
  p.im.fill(0);
  fft(p);
  const s0 = Math.sqrt(1 / N),
    s = Math.sqrt(2 / N);
  for (let k = 0; k < N; k++) {
    const t = (-Math.PI * k) / (2 * N);
    out[k] = (p.re[k] * Math.cos(t) - p.im[k] * Math.sin(t)) * (k ? s : s0);
  }
  return out;
}

/** dct の逆（DCT-III） */
export function idct(X: ArrayLike<number>): Float64Array {
  const N = X.length,
    p = plan(N),
    out = new Float64Array(N),
    s0 = Math.sqrt(1 / N),
    s = Math.sqrt(2 / N);
  /* V[k] = e^(iπk/2N) (X[k] − i X[N−k]) を作り、逆 FFT（共役をとって順変換）で v を求める */
  for (let k = 0; k < N; k++) {
    const a = X[k] / (k ? s : s0),
      b = k ? X[N - k] / s : 0,
      t = (Math.PI * k) / (2 * N),
      c = Math.cos(t),
      sn = Math.sin(t);
    /* (c + i sn)(a − i b) = (ca + sn b) + i(sn a − c b)。共役を入れる */
    p.re[k] = c * a + sn * b;
    p.im[k] = -(sn * a - c * b);
  }
  fft(p);
  for (let n = 0; n < N / 2; n++) {
    out[2 * n] = p.re[n] / N;
    out[2 * n + 1] = p.re[N - 1 - n] / N;
  }
  return out;
}

/**
 * 長さ N（2 の累乗）の実数の DFT を、正規直交な N 個の実数に並べる:
 * [X0, X_(N/2), √2 Re X1, −√2 Im X1, √2 Re X2, …] / √N（余弦と正弦の係数。実部と虚部を別の係数として数える）
 */
export function rdft(x: ArrayLike<number>): Float64Array {
  const N = x.length,
    p = plan(N),
    out = new Float64Array(N),
    s = 1 / Math.sqrt(N);
  for (let n = 0; n < N; n++) p.re[n] = x[n];
  p.im.fill(0);
  fft(p);
  out[0] = p.re[0] * s;
  out[1] = p.re[N / 2] * s;
  for (let k = 1; k < N / 2; k++) {
    out[2 * k] = Math.SQRT2 * p.re[k] * s;
    out[2 * k + 1] = Math.SQRT2 * p.im[k] * s;
  }
  return out;
}

/** rdft の逆 */
export function irdft(c: ArrayLike<number>): Float64Array {
  const N = c.length,
    p = plan(N),
    s = 1 / Math.sqrt(N);
  p.re[0] = c[0] / s;
  p.im[0] = 0;
  p.re[N / 2] = c[1] / s;
  p.im[N / 2] = 0;
  for (let k = 1; k < N / 2; k++) {
    const r = c[2 * k] / (Math.SQRT2 * s),
      i = c[2 * k + 1] / (Math.SQRT2 * s);
    p.re[k] = r;
    p.im[k] = i;
    p.re[N - k] = r;
    p.im[N - k] = -i;
  }
  /* 逆変換: 共役をとって順変換し、N で割る（結果は実数） */
  for (let k = 0; k < N; k++) p.im[k] = -p.im[k];
  fft(p);
  return Float64Array.from(p.re, (v) => v / N);
}

/* ---------- MDCT ---------- */

/** 長さ M の DCT-IV: X[k] = Σ u[n] cos(π/M (n + ½)(k + ½))。M/2 点の複素 FFT 1 回 */
export function dct4(u: ArrayLike<number>, out = new Float64Array(u.length)): Float64Array {
  const M = u.length,
    H = M / 2,
    p = plan(H);
  for (let n = 0; n < H; n++) {
    const a = u[2 * n],
      b = u[M - 1 - 2 * n],
      t = (-Math.PI * (n + 0.25)) / M,
      c = Math.cos(t),
      s = Math.sin(t);
    p.re[n] = a * c - b * s;
    p.im[n] = a * s + b * c;
  }
  fft(p);
  for (let k = 0; k < H; k++) {
    const t = (-Math.PI * k) / M,
      c = Math.cos(t),
      s = Math.sin(t),
      yr = p.re[k] * c - p.im[k] * s,
      yi = p.re[k] * s + p.im[k] * c;
    out[2 * k] = yr;
    out[M - 1 - 2 * k] = -yi;
  }
  return out;
}

const sineWins = new Map<number, Float64Array>();
/** 正弦の窓 w[n] = sin(π(n + ½)/2M)（Princen・Bradley の条件 w[n]² + w[n+M]² = 1 を満たす） */
export function sineWin(M: number): Float64Array {
  let w = sineWins.get(M);
  if (!w) {
    w = Float64Array.from({ length: 2 * M }, (_, n) => Math.sin((Math.PI * (n + 0.5)) / (2 * M)));
    sineWins.set(M, w);
  }
  return w;
}

/** 長さ len の信号を M 点ずつの MDCT にしたときの枠の数（前後に M 点ずつ 0 を足す） */
export const mdctFrames = (len: number, M: number): number => Math.ceil(len / M) + 1;

/**
 * MDCT: 2M 点の枠を M 点ずつずらし、正弦の窓を掛けて M 個の係数にする（正規直交にするため √(2/M) を掛ける）。
 * 枠 f の係数は out[f M … f M + M − 1]。x[n] は枠 f の (n − (f − 1) M) 番目
 */
export function mdct(x: ArrayLike<number>, M: number): Float64Array {
  const F = mdctFrames(x.length, M),
    w = sineWin(M),
    out = new Float64Array(F * M),
    z = new Float64Array(2 * M),
    u = new Float64Array(M),
    X = new Float64Array(M),
    g = Math.sqrt(2 / M),
    H = M / 2;
  for (let f = 0; f < F; f++) {
    const o = (f - 1) * M;
    for (let n = 0; n < 2 * M; n++) {
      const i = o + n;
      z[n] = i >= 0 && i < x.length ? x[i] * w[n] : 0;
    }
    /* 4 等分 (a, b, c, d) を (−c_r − d, a − b_r) に折りたたむ（r は逆順） */
    for (let n = 0; n < H; n++) {
      u[n] = -z[3 * H - 1 - n] - z[3 * H + n];
      u[H + n] = z[n] - z[M - 1 - n];
    }
    dct4(u, X);
    for (let k = 0; k < M; k++) out[f * M + k] = X[k] * g;
  }
  return out;
}

/** mdct の逆（窓を掛けて重ねて足す）。長さ len を返す */
export function imdct(c: ArrayLike<number>, M: number, len: number): Float64Array {
  const F = c.length / M,
    w = sineWin(M),
    y = new Float64Array(len),
    X = new Float64Array(M),
    u = new Float64Array(M),
    g = Math.sqrt(2 / M),
    H = M / 2;
  for (let f = 0; f < F; f++) {
    for (let k = 0; k < M; k++) X[k] = c[f * M + k];
    dct4(X, u);
    const o = (f - 1) * M;
    /* 折りたたみの転置: z = (u2, −u2_r, −u1_r, −u1)（u1・u2 は前半・後半） */
    for (let n = 0; n < 2 * M; n++) {
      const v = n < H ? u[H + n] : n < M ? -u[M - 1 - (n - H)] : n < 3 * H ? -u[H - 1 - (n - M)] : -u[n - 3 * H],
        i = o + n;
      if (i >= 0 && i < len) y[i] += v * w[n] * g;
    }
  }
  return y;
}
