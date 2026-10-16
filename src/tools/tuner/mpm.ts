/**
 * 音高の検出（DOM に依存しない）。McLeod の MPM（P. McLeod, Fast, accurate pitch detection tools for
 * music analysis, Univ. of Otago, 2008）: 正規化した二乗差関数 NSDF n(τ) = 2r(τ) / m(τ) を求め、
 * 正の山ごとの最大（key maximum）のうち、いちばん高いものの k 倍を超える最初のものを周期とする。
 * r(τ) は自己相関（FFT で求める）、m(τ) は x_j² + x_{j+τ}² の和。山の位置と高さは放物線で補う
 */
import { fft, plan } from '../spectrum/fft';

export interface Pitch {
  /** 周波数 [Hz] */
  f: number;
  /** 明瞭度（選んだ山の NSDF の値。0〜1、周期がはっきりしているほど 1 に近い） */
  clarity: number;
}

export interface MpmOpts {
  /** 標本化周波数 [Hz] */
  fs: number;
  /** 探す周波数の範囲 [Hz] */
  fmin: number;
  fmax: number;
  /** いちばん高い山に対する比（既定 0.9） */
  k?: number;
}

let work = new Float64Array(0);

/**
 * 窓 x（長さ W）の NSDF を out[0..tmax] に書く（tmax < W）。
 * r(τ) は 2W 以上に 0 を詰めた FFT で |X|² を求め、もう一度 FFT して得る（|X|² は実数で偶なので、順変換が逆変換の N 倍になる）
 */
export function nsdf(x: ArrayLike<number>, tmax: number, out: Float64Array): void {
  const W = x.length,
    N = 2 ** Math.ceil(Math.log2(2 * W)),
    p = plan(N),
    { re, im } = p;
  for (let i = 0; i < N; i++) {
    re[i] = i < W ? x[i] : 0;
    im[i] = 0;
  }
  fft(p);
  for (let i = 0; i < N; i++) {
    re[i] = re[i] * re[i] + im[i] * im[i];
    im[i] = 0;
  }
  fft(p);
  let m = 0;
  for (let i = 0; i < W; i++) m += 2 * x[i] * x[i];
  for (let t = 0; t <= tmax; t++) {
    if (t > 0) m -= x[t - 1] * x[t - 1] + x[W - t] * x[W - t];
    out[t] = m > 1e-20 ? (2 * re[t]) / N / m : 0;
  }
}

/**
 * 第 h 部分音の周波数を、窓の前半と後半の位相の差で詰める（位相ボコーダと同じ考え方）。f は MPM で求めた基本周波数。
 * 前半・後半それぞれにハン窓を掛けて h·f で直交復調し、位相の進みが予想とどれだけ違うかから周波数のずれを求める。
 * 返すのは部分音の周波数 [Hz] と、その振幅（窓の後半、フルスケールの正弦波で 1）
 */
export function partial(x: ArrayLike<number>, f: number, h: number, fs: number): { f: number; a: number } {
  const W = x.length,
    L = W >> 1,
    w = (2 * Math.PI * h * f) / fs,
    /* 復調の複素正弦波とハン窓の余弦は、1 標本ずつ回して作る（三角関数を毎標本呼ばない） */
    cw = Math.cos(w),
    sw1 = Math.sin(w),
    cv = Math.cos((2 * Math.PI) / L),
    sv = Math.sin((2 * Math.PI) / L);
  let r1 = 0,
    i1 = 0,
    r2 = 0,
    i2 = 0,
    sw = 0,
    c = 1,
    s = 0,
    /* ハン窓は標本の中央（n + 0.5）で取る */
    hc = Math.cos(Math.PI / L),
    hs = Math.sin(Math.PI / L);
  for (let n = 0; n < L; n++) {
    const hw = 0.5 - 0.5 * hc,
      a = hw * x[n],
      b = hw * x[n + L];
    r1 += a * c;
    i1 -= a * s;
    r2 += b * c;
    i2 -= b * s;
    sw += hw;
    const c2 = c * cw - s * sw1;
    s = s * cw + c * sw1;
    c = c2;
    const h2 = hc * cv - hs * sv;
    hs = hs * cv + hc * sv;
    hc = h2;
  }
  /* 後半も n で復調したので、位相の差には予想の進み w·L が含まれる。差し引いて ±π に折り返す */
  let dp = Math.atan2(i2 * r1 - r2 * i1, r2 * r1 + i2 * i1) - w * L;
  dp -= 2 * Math.PI * Math.round(dp / (2 * Math.PI));
  return { f: h * f + (dp * fs) / (2 * Math.PI * L), a: (2 * Math.hypot(r2, i2)) / sw };
}

/** 窓 x の音高。周期を決められなければ null */
export function mpm(x: ArrayLike<number>, o: MpmOpts): Pitch | null {
  const W = x.length,
    k = o.k ?? 0.9,
    tmin = Math.max(2, Math.floor(o.fs / o.fmax)),
    tmax = Math.min(W - 2, Math.ceil(o.fs / o.fmin) + 1);
  if (tmax <= tmin) return null;
  if (work.length < tmax + 2) work = new Float64Array(tmax + 2);
  const n = work;
  nsdf(x, tmax + 1, n);
  /* τ = 0 の山を越え、最初に負になったところから、正の山ごとの最大を集める */
  let t = 1;
  while (t <= tmax && n[t] > 0) t++;
  const peaks: { t: number; v: number }[] = [];
  let pos = false,
    bt = 0;
  const add = (i: number) => {
    if (i < tmin) return;
    const a = n[i - 1],
      b = n[i],
      c = n[i + 1],
      d = a - 2 * b + c,
      dx = d < 0 ? (0.5 * (a - c)) / d : 0;
    peaks.push({ t: i + dx, v: b - 0.25 * (a - c) * dx });
  };
  for (; t <= tmax; t++) {
    if (n[t] > 0) {
      if (!pos || n[t] > n[bt]) bt = t;
      pos = true;
    } else if (pos) {
      add(bt);
      pos = false;
    }
  }
  /* 探す範囲の端で切れた山は、端が最大でなければ使う */
  if (pos && bt < tmax) add(bt);
  if (!peaks.length) return null;
  let top = 0;
  for (const q of peaks) top = Math.max(top, q.v);
  const q = peaks.find((p) => p.v >= k * top) ?? peaks[0];
  return { f: o.fs / q.t, clarity: Math.min(1, q.v) };
}
