/** 種類を選んだときに式を滑らかに移す動きと、べき・混ぜる量の吸い付き */
import { type Formula, q1024 } from './formula';

export interface Morph {
  from: Formula;
  to: Formula;
  /** 始めた時刻 [ms] */
  t0: number;
  /** 長さ [ms] */
  dur: number;
  /** 深い所ではべきの途中（整数でない値）を描けないので、終わりで跳ぶ */
  deep: boolean;
}

export const MORPH_MS = 750;
/** べきが整数でないときの倍率の上限 */
export const REAL_P_MAX = 3e4;

const ease = (k: number): number => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function morphAt(m: Morph, now: number): { f: Formula; done: boolean } {
  const k = Math.min(1, Math.max(0, (now - m.t0) / m.dur));
  if (k >= 1) return { f: { ...m.to }, done: true };
  const e = ease(k),
    { from: a, to: b } = m;
  return {
    f: {
      pre: q1024(lerp(a.pre, b.pre, e)),
      post: q1024(lerp(a.post, b.post, e)),
      conj: e >= 0.5 ? b.conj : a.conj,
      p: m.deep ? a.p : Math.round(lerp(a.p, b.p, e) * 100) / 100,
    },
    done: false,
  };
}

/** べきを 1.5〜8 に収め、整数から 0.06 以内なら整数へ。深い所では整数にしか動かさない */
export function snapPower(p: number, deep: boolean): number {
  const v = Math.min(8, Math.max(1.5, p)),
    r = Math.round(v);
  if (deep) return Math.max(2, r);
  return Math.abs(v - r) <= 0.06 ? r : Math.round(v * 100) / 100;
}

/** 混ぜる量を 1/1024 刻みにし、端から 0.04 以内なら端へ */
export function snapMix(v: number): number {
  const q = q1024(v);
  return q < 0.04 ? 0 : q > 0.96 ? 1 : q;
}
