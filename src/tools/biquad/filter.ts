/**
 * 双2次フィルタの係数（Audio EQ Cookbook）と、インパルス応答の FFT による周波数特性。
 * DOM に依存しないので、ページと Worker の両方から使う
 */

export type FilterType =
  | 'lowpass'
  | 'highpass'
  | 'bandpass'
  | 'bandstop'
  | 'lowshelf'
  | 'highshelf'
  | 'peaking'
  | 'allpass';

/** [b0, b1, b2, a0, a1, a2] */
export type Coef = [number, number, number, number, number, number];

export interface FilterParams {
  t: FilterType;
  /** サンプリング周波数 [Hz] */
  fs: number;
  /** カットオフ周波数 [Hz] */
  fc: number;
  q: number;
  /** 増幅量 [dB]（LSF・HSF・PEQ だけで使う） */
  g: number;
}

export function coef(type: FilterType, fs: number, fc: number, q: number, gain: number): Coef {
  const w = (2 * Math.PI * fc) / fs,
    c = Math.cos(w),
    s = Math.sin(w),
    al = s / (2 * q);
  const A = 10 ** (gain / 40),
    be = Math.sqrt(A) / q;
  switch (type) {
    case 'lowpass':
      return [(1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al];
    case 'highpass':
      return [(1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al];
    case 'bandpass':
      return [al, 0, -al, 1 + al, -2 * c, 1 - al];
    case 'bandstop':
      return [1, -2 * c, 1, 1 + al, -2 * c, 1 - al];
    case 'lowshelf':
      return [
        A * (A + 1 - (A - 1) * c + be * s),
        2 * A * (A - 1 - (A + 1) * c),
        A * (A + 1 - (A - 1) * c - be * s),
        A + 1 + (A - 1) * c + be * s,
        -2 * (A - 1 + (A + 1) * c),
        A + 1 + (A - 1) * c - be * s,
      ];
    case 'highshelf':
      return [
        A * (A + 1 + (A - 1) * c + be * s),
        -2 * A * (A - 1 + (A + 1) * c),
        A * (A + 1 + (A - 1) * c - be * s),
        A + 1 - (A - 1) * c + be * s,
        2 * (A - 1 - (A + 1) * c),
        A + 1 - (A - 1) * c - be * s,
      ];
    case 'peaking':
      return [1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A];
    case 'allpass':
      return [1 - al, -2 * c, 1 + al, 1 + al, -2 * c, 1 - al];
  }
}

/**
 * 基数 2 の Cooley-Tukey FFT（その場で変換する。長さは 2 の累乗）。
 * Project Nayuki の Free FFT（MIT License）の transformRadix2 を元に、三角関数表を Float64Array にした
 */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length,
    h = n >> 1;
  let lv = 0;
  while (1 << lv < n) lv++;
  if (1 << lv !== n || im.length !== n) throw new RangeError('FFT の長さは 2 の累乗で、実部と虚部で同じにする');
  const ct = new Float64Array(h),
    st = new Float64Array(h);
  for (let i = 0; i < h; i++) {
    ct[i] = Math.cos((2 * Math.PI * i) / n);
    st[i] = Math.sin((2 * Math.PI * i) / n);
  }
  for (let i = 0; i < n; i++) {
    let j = 0,
      v = i;
    for (let b = 0; b < lv; b++) {
      j = (j << 1) | (v & 1);
      v >>>= 1;
    }
    if (j > i) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const hs = size / 2,
      ts = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = i, k = 0; j < i + hs; j++, k += ts) {
        const l = j + hs;
        const tr = re[l] * ct[k] + im[l] * st[k],
          ti = -re[l] * st[k] + im[l] * ct[k];
        re[l] = re[j] - tr;
        im[l] = im[j] - ti;
        re[j] += tr;
        im[j] += ti;
      }
    }
  }
}

export interface Summary {
  /** 係数 [b0, b1, b2, a0, a1, a2] */
  co: Coef;
  /** a0 で割った差分方程式の係数 [b0, b1, b2, −a1, −a2] */
  nb: [number, number, number, number, number];
  /** インパルス応答の総和 */
  sum: number;
  /** fc での振幅 [dB]（fc を挟む 2 点の平均） */
  aFc: number;
  max: number;
  maxF: number;
  min: number;
  minF: number;
}

export interface Analysis extends Summary {
  /** インパルス応答 h[0..N-1] */
  h: Float64Array;
  /** 振幅 [dB] と位相 [deg]（k = 0 … N/2 − 1、周波数は k·fs/N） */
  mag: Float64Array;
  ph: Float64Array;
}

/** 長さ N のインパルス応答を求めて FFT し、要約値と（curves なら）応答と特性の列を返す */
export function analyze(p: FilterParams, N: number, curves: true): Analysis;
export function analyze(p: FilterParams, N: number, curves: false): Summary;
export function analyze(p: FilterParams, N: number, curves: boolean): Summary | Analysis {
  const co = coef(p.t, p.fs, p.fc, p.q, p.g),
    a0 = co[3];
  const nb: Summary['nb'] = [co[0] / a0, co[1] / a0, co[2] / a0, -co[4] / a0, -co[5] / a0];
  const re = new Float64Array(N),
    im = new Float64Array(N);
  let o1 = 0,
    o2 = 0,
    i0 = 1,
    i1 = 0,
    i2 = 0,
    sum = 0;
  for (let i = 0; i < N; i++) {
    const y = nb[0] * i0 + nb[1] * i1 + nb[2] * i2 + nb[3] * o1 + nb[4] * o2;
    re[i] = y;
    sum += y;
    i2 = i1;
    i1 = i0;
    i0 = 0;
    o2 = o1;
    o1 = y;
  }
  const h = curves ? re.slice() : null;
  fft(re, im);
  const H = N >> 1,
    mag = curves ? new Float64Array(H) : null,
    ph = curves ? new Float64Array(H) : null;
  const k0 = Math.floor((p.fc / p.fs) * N);
  let mx = -Infinity,
    mn = Infinity,
    mxI = -1,
    mnI = -1,
    v0 = NaN,
    v1 = NaN;
  for (let k = 0; k < H; k++) {
    const m = Math.log10(Math.sqrt(re[k] * re[k] + im[k] * im[k])) * 20;
    if (m > mx) {
      mx = m;
      mxI = k;
    }
    if (m < mn) {
      mn = m;
      mnI = k;
    }
    if (k === k0) v0 = m;
    else if (k === k0 + 1) v1 = m;
    if (mag && ph) {
      mag[k] = m;
      ph[k] = (Math.atan2(im[k], re[k]) * 180) / Math.PI;
    }
  }
  const s: Summary = {
    co,
    nb,
    sum,
    aFc: (v0 + v1) / 2,
    max: mx,
    maxF: (p.fs / N) * mxI,
    min: mn,
    minF: (p.fs / N) * mnI,
  };
  return h && mag && ph ? { ...s, h, mag, ph } : s;
}
