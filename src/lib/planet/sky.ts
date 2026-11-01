/**
 * 観測地の空（DOM に依存しない）: 太陽の高度、昼と薄明の境、惑星の高度
 */
import { eclToEqu, nutation } from '../astro/frame';
import { altAz, type Obs, site } from '../astro/observer';
import { sunEcl } from '../astro/sun';
import { deltaT } from '../astro/time';
import { sub, unit } from '../astro/vec';
import type { Ephem } from './ephem';

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

/** 探索用の惑星の高度（大気差あり）[°]: ゆっくり変わる部分を補間したもの（Ephem） */
export function altFast(e: Ephem, jd: number, o: Obs): number {
  const s = e.slow(jd);
  const st = site(jd, s.n, o);
  return altAz(unit(sub(s.P, st.obs)), st.zenith).alt;
}
