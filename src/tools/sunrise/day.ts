/**
 * 地点の 1 日の太陽（DOM に依存しない）: 5 分おきの高度・方位と、日の出・南中・日の入り・昼の長さ。
 * 1 日は現地の 0 時 d0 から翌日の 0 時 d1 まで（夏時間の日は 23・25 時間）。時刻は UTC の Unix ミリ秒
 */
import { bisect } from '../../lib/astro/solve';
import { geoAltAz, sunEq, THR } from './sun';

/** 刻み [ms] */
export const STEP = 3e5;

export interface Day {
  d0: number;
  d1: number;
  /** 区間の数。点は d0 + i × STEP（i = 0〜N）で、最後の点は d1 以上 */
  N: number;
  /** 大気差なしの高度・方位（北から東）[°] */
  hs: Float32Array;
  azs: Float32Array;
  rise: number | null;
  set: number | null;
  transit: number;
  /** 南中の高度（大気差なし）[°] */
  maxH: number;
  /** 昼の長さ（中心の高度 −0.833° より上の時間）[ms] */
  len: number;
  /** 日の出・日の入りがない日: 沈まない（白夜）か昇らない（極夜） */
  polar: 'day' | 'night' | null;
  riseAz: number | null;
  setAz: number | null;
}

export function dayOf(lat: number, lon: number, d0: number, d1: number): Day {
  const N = Math.ceil((d1 - d0) / STEP);
  const hs = new Float32Array(N + 1);
  const azs = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const a = geoAltAz(sunEq(d0 + i * STEP), lat, lon);
    hs[i] = a.h;
    azs[i] = a.az;
  }
  const h0 = THR[0];
  const alt = (t: number): number => geoAltAz(sunEq(t), lat, lon).h - h0;
  const az = (t: number): number => geoAltAz(sunEq(t), lat, lon).az;
  /* 1 日の中で最初に地平線を上へ（下へ）越える時刻を、5 分の区間の中で 1 秒まで詰める */
  const cross = (up: boolean): number | null => {
    for (let i = 0; i < N; i++) {
      const a = hs[i] - h0;
      const b = hs[i + 1] - h0;
      if (up ? a < 0 && b >= 0 : a >= 0 && b < 0) {
        const t = bisect(alt, d0 + i * STEP, d0 + (i + 1) * STEP, 12);
        return t < d1 ? t : null;
      }
    }
    return null;
  };
  let im = 0;
  for (let i = 1; i <= N; i++) if (hs[i] > hs[im]) im = i;
  let transit = d0 + im * STEP;
  let maxH = hs[im];
  if (im > 0 && im < N) {
    const y0 = hs[im - 1];
    const y1 = hs[im];
    const y2 = hs[im + 1];
    const den = y0 - 2 * y1 + y2;
    if (den < 0) {
      const k = (y0 - y2) / (2 * den);
      transit = d0 + (im + k) * STEP;
      maxH = y1 - ((y0 - y2) * k) / 4;
    }
  }
  /* 昼の長さ: 区間ごとに −0.833° より上の割合を直線で足す（最後の区間は d1 で切る） */
  let len = 0;
  for (let i = 0; i < N; i++) {
    const w = Math.min(STEP, d1 - (d0 + i * STEP));
    const a = hs[i] - h0;
    const b = hs[i + 1] - h0;
    if (a >= 0 && b >= 0) len += w;
    else if (a >= 0 || b >= 0) len += (w * Math.max(a, b)) / Math.abs(a - b);
  }
  const rise = cross(true);
  const set = cross(false);
  let polar: Day['polar'] = null;
  if (rise === null && set === null) polar = hs[0] >= h0 ? 'day' : 'night';
  if (polar) len = polar === 'day' ? d1 - d0 : 0;
  return {
    d0,
    d1,
    N,
    hs,
    azs,
    rise,
    set,
    transit,
    maxH,
    len: Math.round(len),
    polar,
    riseAz: rise === null ? null : az(rise),
    setAz: set === null ? null : az(set),
  };
}
