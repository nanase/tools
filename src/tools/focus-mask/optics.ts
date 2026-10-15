/**
 * 星の像（点像）の計算（DOM に依存しない）。フラウンホーファー回折: 焦点面の光の場は、瞳の光の場
 * （透過率 × e^{i 2π W / λ}）のフーリエ変換で、強度はその絶対値の 2 乗。ピントのずれは波面収差
 * W = W₀₂₀ ρ²、W₀₂₀ = Δz / (8 N²) で表す。波長ごとに瞳の標本の幅を λ に比例させ、焦点面の画素の
 * 角度をどの波長でも同じにして、そのまま足し合わせる
 */
import { psfAdd } from './fft2';
import { type Mask, type Scope, transmit } from './mask';

export interface Optics {
  /** 口径 D（mm） */
  D: number;
  /** 焦点距離 f（mm） */
  f: number;
  /** ピントのずれ Δz（µm、像面での位置。正は焦点より後ろ） */
  dz: number;
}

/** 波長 1 つ: λ（nm）と、線形 sRGB の重み */
export interface Band {
  nm: number;
  rgb: readonly [number, number, number];
}

export interface PsfOpts {
  /** FFT の大きさ（2 の累乗） */
  N: number;
  /** 出す画像の 1 辺（N/2 以下） */
  M: number;
  /** 焦点面の画素の角度（rad） */
  alpha: number;
}

/** 像: 線形 sRGB の 3 枚（各 n×n、中央が光軸）。値は画素に入る光の割合（開口を全部開けたときの全光量を 1） */
export interface Img {
  n: number;
  /** 画素の角度（rad） */
  px: number;
  r: Float64Array;
  g: Float64Array;
  b: Float64Array;
}

/** 最短の波長でも瞳が FFT の格子からはみ出さない画素の角度（余白の比 q） */
export const alphaFor = (D: number, nmMin: number, q = 1.1): number => (nmMin * 1e-9) / (q * D * 1e-3);

/**
 * 瞳の透過率を、最も細かい標本（最短の波長）の格子に描いたもの。波長ごとの格子はこれを双一次で引く
 * （マスクを変えたときだけ作り直す）
 */
export interface Pupil {
  /** 1 辺の標本数（奇数、中央が光軸） */
  n: number;
  /** 1 標本の幅（半径を 1 とした値） */
  px: number;
  t: Float32Array;
  /** 収差の波面（µm）。ないときは省く */
  w?: Float32Array;
}

/** 収差（ゼルニケ多項式の係数、RMS の µm）。ピントのずれは Optics.dz で別に与える */
export interface Aberr {
  /** 非点収差（0°・45°） */
  a0: number;
  a45: number;
  /** コマ収差（x・y） */
  cx: number;
  cy: number;
  /** 球面収差 */
  sph: number;
}

/** 波面（µm）。ρ・φ は瞳の極座標（半径 1） */
export function wave(ab: Aberr, x: number, y: number): number {
  const r2 = x * x + y * y;
  return (
    Math.sqrt(6) * (ab.a0 * (x * x - y * y) + ab.a45 * 2 * x * y) +
    Math.sqrt(8) * (3 * r2 - 2) * (ab.cx * x + ab.cy * y) +
    Math.sqrt(5) * ab.sph * (6 * r2 * r2 - 6 * r2 + 1)
  );
}

export function pupil(sc: Scope, m: Mask, opt: PsfOpts, D: number, nmMin: number, ab?: Aberr): Pupil {
  const dx = (nmMin * 1e-9) / (opt.N * opt.alpha),
    px = dx / ((D * 1e-3) / 2),
    h = Math.ceil(1 / px) + 1,
    n = 2 * h + 1,
    t = new Float32Array(n * n),
    on = ab && (ab.a0 || ab.a45 || ab.cx || ab.cy || ab.sph),
    w = on ? new Float32Array(n * n) : undefined;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = (i - h) * px,
        y = (j - h) * px;
      t[j * n + i] = transmit(x, y, sc, m, px);
      if (w && ab) w[j * n + i] = wave(ab, x, y);
    }
  return { n, px, t, w };
}

/** 波長 1 つの瞳の光の場を re・im に書く。戻り値は 0 でない行の半幅 */
function band(o: Optics, P: Pupil, opt: PsfOpts, nm: number, re: Float64Array, im: Float64Array): number {
  const { N, alpha } = opt,
    lam = nm * 1e-9,
    /* 瞳の標本の幅（半径を 1 とした値）。dx = λ / (N α) */
    px = lam / (N * alpha) / ((o.D * 1e-3) / 2),
    h = Math.min(N / 2 - 1, Math.ceil(1 / px)),
    Nf = o.f / o.D,
    /* 縁（ρ = 1）での位相 2π W₀₂₀ / λ */
    k = (2 * Math.PI * (o.dz * 1e-6)) / (8 * Nf * Nf) / lam,
    /* e^{ik(x² + y²)} = e^{ikx²} e^{iky²} の 1 次元の表 */
    cq = new Float64Array(2 * h + 1),
    sq = new Float64Array(2 * h + 1),
    s = px / P.px,
    c0 = (P.n - 1) / 2,
    kw = (2 * Math.PI * 1e-6) / lam;
  for (let i = -h; i <= h; i++) {
    const v = k * (i * px) ** 2;
    cq[i + h] = Math.cos(v);
    sq[i + h] = Math.sin(v);
  }
  re.fill(0);
  im.fill(0);
  for (let j = -h; j <= h; j++) {
    const fy = c0 + j * s,
      y0 = Math.floor(fy),
      ty = fy - y0;
    if (y0 < 0 || y0 >= P.n - 1) continue;
    const row = ((j + N) % N) * N,
      cy = cq[j + h],
      sy = sq[j + h];
    for (let i = -h; i <= h; i++) {
      const fx = c0 + i * s,
        x0 = Math.floor(fx),
        tx = fx - x0;
      if (x0 < 0 || x0 >= P.n - 1) continue;
      const q = y0 * P.n + x0,
        t = (1 - ty) * ((1 - tx) * P.t[q] + tx * P.t[q + 1]) + ty * ((1 - tx) * P.t[q + P.n] + tx * P.t[q + P.n + 1]);
      if (t <= 0) continue;
      const cx = cq[i + h],
        sx = sq[i + h],
        c = (i + N) % N;
      let ar = t * (cx * cy - sx * sy),
        ai = t * (sx * cy + cx * sy);
      if (P.w) {
        /* 収差の位相 2π W / λ（W は最寄りの標本） */
        const ph = (kw * P.w[Math.round(fy) * P.n + Math.round(fx)]) % (2 * Math.PI),
          c1 = Math.cos(ph),
          s1 = Math.sin(ph);
        [ar, ai] = [ar * c1 - ai * s1, ar * s1 + ai * c1];
      }
      re[row + c] = ar;
      im[row + c] = ai;
    }
  }
  return h;
}

/**
 * 帯 1 つの点像 mono を、帯の幅の分だけ半径方向に引き伸ばして足す（重み rgb）。
 * 波長 λ の点像は角度が λ に比例して広がるので、帯の中の波長 λ·s の像を mono(θ/s)/s² で近似し、
 * s を k 個に分けて平均する（帯の数を増やさずに、光条の色を連続にする）
 */
function smearAdd(
  mono: Float64Array,
  M: number,
  d: number,
  k: number,
  rgb: readonly [number, number, number],
  r: Float64Array,
  g: Float64Array,
  b: Float64Array,
): void {
  const h = M / 2;
  if (k <= 1 || d <= 0) {
    /* 引き伸ばさない（単色など）: そのまま足す */
    for (let i = 0; i < M * M; i++) {
      r[i] += rgb[0] * mono[i];
      g[i] += rgb[1] * mono[i];
      b[i] += rgb[2] * mono[i];
    }
    return;
  }
  for (let q = 0; q < k; q++) {
    const s = 1 + d * ((2 * (q + 0.5)) / k - 1),
      is = 1 / s,
      w = 1 / (k * s * s),
      wr = w * rgb[0],
      wg = w * rgb[1],
      wb = w * rgb[2];
    for (let y = 0; y < M; y++) {
      const fy = (y - h) * is + h,
        y0 = Math.floor(fy),
        ty = fy - y0;
      if (y0 < 0 || y0 >= M - 1) continue;
      for (let x = 0; x < M; x++) {
        const fx = (x - h) * is + h,
          x0 = Math.floor(fx),
          tx = fx - x0;
        if (x0 < 0 || x0 >= M - 1) continue;
        const o = y0 * M + x0,
          v = (1 - ty) * ((1 - tx) * mono[o] + tx * mono[o + 1]) + ty * ((1 - tx) * mono[o + M] + tx * mono[o + M + 1]),
          i = y * M + x;
        r[i] += wr * v;
        g[i] += wg * v;
        b[i] += wb * v;
      }
    }
  }
}

/** 波長ごとの点像を足し合わせる。帯の幅 = 隣の帯との間隔（smear は帯の中の分割数、1 で引き伸ばさない） */
export function psf(o: Optics, P: Pupil, bands: readonly Band[], opt: PsfOpts, smear = 4): Img {
  const { N, M } = opt,
    re = new Float64Array(N * N),
    im = new Float64Array(N * N),
    mono = new Float64Array(M * M),
    r = new Float64Array(M * M),
    g = new Float64Array(M * M),
    b = new Float64Array(M * M);
  const step = bands.length > 1 ? Math.abs(bands[1].nm - bands[0].nm) : 0;
  for (const bd of bands) {
    mono.fill(0);
    const h = band(o, P, opt, bd.nm, re, im),
      /* 開口を全部開けたときの瞳の標本の和 π / px²（px = 半径を 1 とした標本の幅） */
      px = (bd.nm * 1e-9) / (N * opt.alpha) / ((o.D * 1e-3) / 2),
      open = Math.PI / (px * px);
    /* パーセバル: Σ|E|² = N² Σ|P|²。開口を全部開けたときの全光量で割る */
    psfAdd(N, re, im, h, M, mono, 1 / (N * N * open));
    smearAdd(mono, M, step / 2 / bd.nm, step > 0 ? smear : 1, bd.rgb, r, g, b);
  }
  return { n: M, px: opt.alpha, r, g, b };
}
