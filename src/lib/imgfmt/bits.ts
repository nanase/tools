/**
 * ビット列の表示。符号を 0 と 1 の文字列にし、バイトの中のどのビットに入ったかを示す。
 * JPEG は上位ビット（MSB）から、Deflate・GIF の LZW は下位ビット（LSB）からバイトに詰める
 */

/** 値 v の下位 n ビットを、上位から 0 と 1 の文字列に */
export const bitStr = (v: number, n: number): string => (n ? (v >>> 0).toString(2).padStart(n, '0').slice(-n) : '');

/** 値 v の下位 n ビットを、ビットの番号の小さい方から並べた文字列（LSB から詰める順） */
export const bitStrLsb = (v: number, n: number): string => bitStr(v, n).split('').reverse().join('');

/** バイト列の中のビット位置 p（先頭から数える）の 1 ビット */
export function bitAt(b: Uint8Array, p: number, order: 'msb' | 'lsb'): number {
  const x = b[p >> 3] ?? 0,
    k = p & 7;
  return order === 'lsb' ? (x >> k) & 1 : (x >> (7 - k)) & 1;
}

/** 1 バイトの 8 ビットを、どのビットがどの範囲に属すかの印とともに並べる */
export interface BitCell {
  /** ビット位置（データの先頭から） */
  p: number;
  /** 値 */
  v: number;
  /** バイトの中の番号（0 が LSB） */
  k: number;
}

/**
 * ビット位置 [s, e) を含むバイトの 8 ビットずつの並び。表示の左から右へ、バイトの上位ビットから並べる
 * （16 進で読んだときと同じ向き）。LSB から詰める符号では、符号の先頭のビットがバイトの右端に来る
 */
export function byteCells(b: Uint8Array, s: number, e: number, order: 'msb' | 'lsb'): BitCell[][] {
  const out: BitCell[][] = [];
  for (let by = s >> 3; by <= (e - 1) >> 3 && by < b.length; by++) {
    const row: BitCell[] = [];
    for (let k = 7; k >= 0; k--) {
      const p = order === 'lsb' ? by * 8 + k : by * 8 + (7 - k);
      row.push({ p, v: (b[by] >> k) & 1, k });
    }
    out.push(row);
  }
  return out;
}
