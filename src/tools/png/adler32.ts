/** Adler-32（RFC 1950 2.2・8.2）。s1 は 1 から始めるバイトの和、s2 は s1 の和で、どちらも 65521 で割った余り */

const BASE = 65521;
/** 剰余を取らずに足せるバイト数の上限（zlib の NMAX） */
const NMAX = 5552;

/** 前の値 adler（初めは 1）に bytes[start .. end) を続けた Adler-32 を返す */
export function adler32Update(adler: number, bytes: ArrayLike<number>, start = 0, end = bytes.length): number {
  let s1 = adler & 0xffff,
    s2 = adler >>> 16,
    i = start;
  while (i < end) {
    const e = Math.min(end, i + NMAX);
    for (; i < e; i++) {
      s1 += bytes[i];
      s2 += s1;
    }
    s1 %= BASE;
    s2 %= BASE;
  }
  return ((s2 << 16) | s1) >>> 0;
}

/** bytes[start .. end) の Adler-32 */
export const adler32 = (bytes: ArrayLike<number>, start = 0, end = bytes.length): number =>
  adler32Update(1, bytes, start, end);
