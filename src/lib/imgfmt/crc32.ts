/**
 * CRC-32（ISO 3309・ITU-T V.42。PNG 仕様の付録 D と同じ）。生成多項式は反転した 0xEDB88320 で、
 * 初期値と最後の反転は 0xFFFFFFFF。1 バイトずつ表を引く
 */

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/**
 * 前の値 crc（反転を済ませた値。初めは 0）に bytes[start .. end) を続けた CRC を返す。
 * crc32Update(crc32(a), b) は a と b をつないだ列の CRC と同じになる
 */
export function crc32Update(crc: number, bytes: ArrayLike<number>, start = 0, end = bytes.length): number {
  let c = ~crc >>> 0;
  for (let i = start; i < end; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

/** bytes[start .. end) の CRC-32 */
export const crc32 = (bytes: ArrayLike<number>, start = 0, end = bytes.length): number =>
  crc32Update(0, bytes, start, end);
