/**
 * 観測地の空（DOM に依存しない）: 太陽の高度、夜（日の入りから日の出）と薄明、惑星の出没と南中
 */
import { eclToEqu, nutation } from '../astro/frame';
import { altAz, eastward, type Obs, site } from '../astro/observer';
import { bisect } from '../astro/solve';
import { sunEcl } from '../astro/sun';
import { deltaT } from '../astro/time';
import { sub, unit } from '../astro/vec';
import { type Ephem, type PlanetModel, planetState } from './ephem';

/** 太陽の中心の高度（大気差なし）[°] */
export function sunAlt(jd: number, o: Obs): number {
  const t = (jd + deltaT(jd) / 86400 - 2451545) / 36525;
  const n = nutation(t);
  const s = eclToEqu(sunEcl(t), n);
  const st = site(jd, n, o);
  return altAz(unit(sub(s, st.obs)), st.zenith).altGeo;
}

/** 日の出・日の入りの高さ（大気差と視半径）と、空が暗い・明るくなり始める高さ（航海薄明）[°] */
export const SUN_SET = -0.8333;
export const SUN_DARK = -12;

/** [jd0, jd1] で f(t) − h の符号が変わる時刻を、刻み step で探して二分法で詰める */
export function crossings(f: (t: number) => number, h: number, jd0: number, jd1: number, step: number) {
  const out: { t: number; up: boolean }[] = [];
  let a = jd0,
    fa = f(a) - h;
  while (a < jd1) {
    const b = Math.min(jd1, a + step),
      fb = f(b) - h;
    if (fa < 0 !== fb < 0) out.push({ t: bisect((t) => f(t) - h, a, b, 22), up: fb >= 0 });
    a = b;
    fa = fb;
  }
  return out;
}

/** 惑星の高度（大気差あり）[°]。出没は 0° を横切る時刻 */
export const planetAlt = (m: PlanetModel, jd: number, o: Obs): number => planetState(m, jd, o).alt;

/** [jd0, jd1] の惑星の南中（東西の成分が + から − へ）と、そのときの高度 */
export function transits(m: PlanetModel, jd0: number, jd1: number, o: Obs): { t: number; alt: number }[] {
  const ew = (t: number) => {
    const s = planetState(m, t, o);
    return eastward(unit(s.P), s.zenith);
  };
  return crossings(ew, 0, jd0, jd1, 1 / 24)
    .filter((c) => !c.up)
    .map((c) => ({ t: c.t, alt: planetState(m, c.t, o).alt }));
}

/** 探索用の惑星の高度（大気差あり）[°]: ゆっくり変わる部分を補間したもの（Ephem） */
export function altFast(e: Ephem, jd: number, o: Obs): number {
  const s = e.slow(jd);
  const st = site(jd, s.n, o);
  return altAz(unit(sub(s.P, st.obs)), st.zenith).alt;
}
