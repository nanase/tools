/**
 * 星の像を作る手順（DOM に依存しない）。Worker でもメインスレッドでも呼べるよう、波長の帯を区切って
 * 部分の和を返す形にする。瞳の透過率はマスクを変えたときだけ描き直す
 */
import { bin, seeing } from './camera';
import { starBands } from './color';
import type { Mask, Scope } from './mask';
import { type Aberr, alphaFor, type Img, type Pupil, psf, pupil } from './optics';

/** 1 枚の像の条件 */
export interface Scene {
  /** 口径・焦点距離（mm）、ピントのずれ（µm） */
  D: number;
  f: number;
  dz: number;
  sc: Scope;
  m: Mask;
  ab?: Aberr;
  /** 星の色温度（K）と、400〜700 nm を分ける帯の数 */
  T: number;
  nb: number;
  /** FFT の大きさ（2 の累乗）。像の範囲は N/2 の画素 */
  N: number;
}

/** 帯 i0, i0 + di, i0 + 2di, … を計算する依頼 */
export interface Part {
  s: Scene;
  i0: number;
  di: number;
}

const NM0 = 400,
  NM1 = 700;

/** 焦点面の画素の角度。最短の波長でも瞳が格子に収まる */
export const pixelOf = (s: Scene): number => alphaFor(s.D, NM0);

let cache: { key: string; P: Pupil } | null = null;
function pupilOf(s: Scene): Pupil {
  const key = JSON.stringify([s.D, s.N, s.sc, s.m, s.ab ?? null]);
  if (cache?.key !== key)
    cache = { key, P: pupil(s.sc, s.m, { N: s.N, M: s.N / 2, alpha: pixelOf(s) }, s.D, NM0, s.ab) };
  return cache.P;
}

/** 帯 i0, i0 + di, … の点像の和 */
export function part({ s, i0, di }: Part): Img {
  const bands = starBands(s.T, s.nb, NM0, NM1),
    step = s.nb > 1 ? (NM1 - NM0) / (s.nb - 1) : 0;
  return psf(
    { D: s.D, f: s.f, dz: s.dz },
    pupilOf(s),
    bands.filter((_, i) => i >= i0 && (i - i0) % di === 0),
    { N: s.N, M: s.N / 2, alpha: pixelOf(s) },
    4,
    step,
  );
}

/** 部分の和を足し合わせる（a に足す） */
export function addInto(a: Img, b: Img): Img {
  for (let i = 0; i < a.r.length; i++) {
    a.r[i] += b.r[i];
    a.g[i] += b.g[i];
    a.b[i] += b.b[i];
  }
  return a;
}

/** カメラの条件: 画素の大きさ（µm）、1 辺の画素数、シーイングの半値幅（″） */
export interface Cam {
  pitch: number;
  n: number;
  see: number;
}

/** 点像をカメラの画素に積分し、シーイングで広げる */
export function expose(p: Img, f: number, c: Cam): Img {
  return seeing(bin(p, (c.pitch * 1e-6) / (f * 1e-3), c.n), c.see / 206264.806);
}
