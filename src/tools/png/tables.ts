/** Deflate の決まった表（RFC 1951 3.2.5・3.2.6・3.2.7） */

/** 長さ符号 257〜285 の基準の長さと付加ビット数（番号は 符号 − 257） */
export const LEN_BASE = Uint16Array.from([
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258,
]);
export const LEN_EXTRA = Uint8Array.from([
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
]);

/** 距離符号 0〜29 の基準の距離と付加ビット数 */
export const DIST_BASE = Uint16Array.from([
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
  8193, 12289, 16385, 24577,
]);
export const DIST_EXTRA = Uint8Array.from([
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
]);

/** 符号長の符号の長さを送る順（3.2.7） */
export const CL_ORDER = Uint8Array.from([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);

/** 一致の長さ 3〜258 から長さ符号の番号（0〜28）。258 は 284 でも書けるが 285 を使う */
export const LEN_SYM = (() => {
  const t = new Uint8Array(259);
  for (let k = 0; k < 28; k++)
    for (let l = LEN_BASE[k]; l < LEN_BASE[k] + (1 << LEN_EXTRA[k]) && l < 259; l++) t[l] = k;
  t[258] = 28;
  return t;
})();

/** 距離 1〜32768 から距離符号の番号 */
export const DIST_SYM = (() => {
  const t = new Uint8Array(32769);
  for (let k = 0; k < 30; k++) for (let d = DIST_BASE[k]; d < DIST_BASE[k] + (1 << DIST_EXTRA[k]); d++) t[d] = k;
  return t;
})();

/** 固定ハフマン符号の符号長（3.2.6）。文字・長さは 288 個、距離は 32 個（286・287・30・31 は使わない） */
export const FIXED_LIT_LENS = (() => {
  const l = new Uint8Array(288);
  l.fill(8, 0, 144);
  l.fill(9, 144, 256);
  l.fill(7, 256, 280);
  l.fill(8, 280, 288);
  return l;
})();
export const FIXED_DIST_LENS = new Uint8Array(32).fill(5);
