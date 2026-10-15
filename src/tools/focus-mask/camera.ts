/**
 * カメラの画素への積分と、大気のゆらぎ（長時間露出のシーイング）（DOM に依存しない）
 */
import { fft2d } from './fft2';
import type { Img } from './optics';

/**
 * 像を、角度 px の画素 n×n に面積で積分する。光軸は画素の角（n/2, n/2）に来る
 */
export function bin(p: Img, px: number, n: number): Img {
  const out: Img = { n, px, r: new Float64Array(n * n), g: new Float64Array(n * n), b: new Float64Array(n * n) };
  const k = p.px / px,
    M = p.n;
  /* 元の画素 i（中心が (i − M/2)·k）の幅 k の区間を、カメラの画素 [j, j + 1) に分ける */
  const spans = (i: number): [number, number][] => {
    const a = (i - M / 2 - 0.5) * k + n / 2,
      b = a + k,
      res: [number, number][] = [];
    for (let j = Math.floor(a); j < b; j++) {
      if (j < 0 || j >= n) continue;
      const w = (Math.min(b, j + 1) - Math.max(a, j)) / k;
      if (w > 0) res.push([j, w]);
    }
    return res;
  };
  const sp = Array.from({ length: M }, (_, i) => spans(i));
  for (let y = 0; y < M; y++) {
    const sy = sp[y];
    if (!sy.length) continue;
    for (let x = 0; x < M; x++) {
      const sx = sp[x],
        i = y * M + x,
        vr = p.r[i],
        vg = p.g[i],
        vb = p.b[i];
      for (const [jy, wy] of sy)
        for (const [jx, wx] of sx) {
          const o = jy * n + jx,
            w = wy * wx;
          out.r[o] += w * vr;
          out.g[o] += w * vg;
          out.b[o] += w * vb;
        }
    }
  }
  return out;
}

/** 2 の累乗に切り上げる */
const pow2 = (v: number) => 2 ** Math.ceil(Math.log2(v));

/**
 * 長時間露出のシーイングを、半値幅 fwhm（rad）のモファット分布 (1 + (r/a)²)^(−β) で畳み込む。
 * β = 4.765 でコルモゴロフの長時間露出の像に近い（Trujillo ほか 2001）。
 * 像の外は 0 として、回り込まないよう 2 倍以上の格子で畳み込む。核は実数で対称なので、その FFT も実数で、
 * r と g を 1 つの複素数の場にまとめて変換できる
 */
export function seeing(p: Img, fwhm: number, beta = 4.765): Img {
  if (fwhm <= 0) return p;
  const n = p.n,
    N = pow2(2 * n),
    a = fwhm / (2 * Math.sqrt(2 ** (1 / beta) - 1)) / p.px;
  const kr = new Float64Array(N * N),
    ki = new Float64Array(N * N);
  let s = 0;
  for (let y = 0; y < N; y++) {
    const dy = y < N / 2 ? y : y - N;
    for (let x = 0; x < N; x++) {
      const dx = x < N / 2 ? x : x - N,
        v = (1 + (dx * dx + dy * dy) / (a * a)) ** -beta;
      kr[y * N + x] = v;
      s += v;
    }
  }
  for (let i = 0; i < N * N; i++) kr[i] /= s;
  fft2d(N, kr, ki);
  const out: Img = { n, px: p.px, r: new Float64Array(n * n), g: new Float64Array(n * n), b: new Float64Array(n * n) };
  const re = new Float64Array(N * N),
    im = new Float64Array(N * N);
  const pass = (A: Float64Array, B: Float64Array | null, oa: Float64Array, ob: Float64Array | null) => {
    re.fill(0);
    im.fill(0);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        re[y * N + x] = A[y * n + x];
        if (B) im[y * N + x] = B[y * n + x];
      }
    fft2d(N, re, im);
    for (let i = 0; i < N * N; i++) {
      re[i] *= kr[i];
      im[i] *= kr[i];
    }
    fft2d(N, re, im, true);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        oa[y * n + x] = Math.max(0, re[y * N + x]);
        if (ob) ob[y * n + x] = Math.max(0, im[y * N + x]);
      }
  };
  pass(p.r, p.g, out.r, out.g);
  pass(p.b, null, out.b, null);
  return out;
}

/** 線形の値 → sRGB の 8 bit */
const enc = (c: number) =>
  c <= 0 ? 0 : c >= 1 ? 255 : Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));

/**
 * 像を表示の画素（RGBA）にする。gain を掛けた値を、lin はそのまま 1 で飽和させ（カメラの撮って出し）、
 * asinh は asinh(x/soft)/asinh(1/soft) で暗い所を持ち上げる（Lupton ほか 2004 の伸ばし方）。
 * 色はそれぞれの成分を別に丸めるので、飽和した芯は白くなる
 */
export function toRgba(p: Img, gain: number, mode: 'lin' | 'asinh' = 'lin', soft = 0.02): Uint8ClampedArray {
  const n = p.n * p.n,
    o = new Uint8ClampedArray(n * 4),
    k = 1 / Math.asinh(1 / soft),
    f = mode === 'asinh' ? (v: number) => (v <= 0 ? 0 : Math.asinh(v / soft) * k) : (v: number) => v;
  for (let i = 0; i < n; i++) {
    o[i * 4] = enc(f(p.r[i] * gain));
    o[i * 4 + 1] = enc(f(p.g[i] * gain));
    o[i * 4 + 2] = enc(f(p.b[i] * gain));
    o[i * 4 + 3] = 255;
  }
  return o;
}
