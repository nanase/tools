/**
 * Deflate のハフマン符号: 出現回数から長さ制限つきの符号長を作る（T.81 K.2 の手順）、
 * 符号長から正準ハフマン符号を作る（RFC 1951 3.2.2）、復号用の表を作る（puff.c の construct）
 */

/** 符号長の上限（RFC 1951 3.2.7） */
export const MAX_BITS = 15;

/**
 * 出現回数 freq から、長さ maxLen 以下の符号長を作る。木は回数の少ない 2 つを順に束ねて作り（K.2、図 K.1）、
 * 長すぎる符号は葉を浅い所へ移して詰める（図 K.3）。使う記号が 2 つ未満なら記号 0・1 を足して長さ 1 の符号を 2 つにする
 * （zlib の build_tree と同じく、復号器が不完全な符号を嫌っても通るように）
 */
export function codeLengths(freq: ArrayLike<number>, maxLen: number): Uint8Array {
  const n = freq.length,
    lens = new Uint8Array(n),
    used: number[] = [];
  for (let i = 0; i < n; i++) if (freq[i] > 0) used.push(i);
  if (used.length < 2) {
    for (const s of used) lens[s] = 1;
    for (let s = 0, k = used.length; k < 2 && s < n; s++)
      if (!lens[s]) {
        lens[s] = 1;
        k++;
      }
    return lens;
  }
  const f = new Float64Array(n),
    size = new Int32Array(n),
    others = new Int32Array(n).fill(-1);
  for (const s of used) f[s] = freq[s];
  for (;;) {
    /* 回数が最も少ない記号 c1 と次に少ない c2（同じなら番号の大きいほう） */
    let c1 = -1,
      v = Infinity;
    for (const i of used)
      if (f[i] > 0 && f[i] <= v) {
        v = f[i];
        c1 = i;
      }
    let c2 = -1;
    v = Infinity;
    for (const i of used)
      if (f[i] > 0 && f[i] <= v && i !== c1) {
        v = f[i];
        c2 = i;
      }
    if (c2 < 0) break;
    f[c1] += f[c2];
    f[c2] = 0;
    size[c1]++;
    while (others[c1] >= 0) {
      c1 = others[c1];
      size[c1]++;
    }
    others[c1] = c2;
    size[c2]++;
    while (others[c2] >= 0) {
      c2 = others[c2];
      size[c2]++;
    }
  }
  let deep = 0;
  for (const s of used) deep = Math.max(deep, size[s]);
  const bits = new Int32Array(Math.max(deep, maxLen) + 1);
  for (const s of used) bits[size[s]]++;
  /* maxLen を超える長さを詰める。深い 2 つの葉の 1 つを親の位置へ、もう 1 つを浅い葉の下へ移す（図 K.3） */
  for (let i = deep; i > maxLen; i--)
    while (bits[i] > 0) {
      let j = i - 2;
      while (bits[j] === 0) j--;
      bits[i] -= 2;
      bits[i - 1]++;
      bits[j + 1] += 2;
      bits[j]--;
    }
  /* 元の長さの短い順（同じなら回数の多い順、番号順）に、詰めた後の長さを短い順に割り当てる */
  const order = used.slice().sort((a, b) => size[a] - size[b] || freq[b] - freq[a] || a - b);
  let k = 0;
  for (let l = 1; l <= maxLen; l++) for (let c = 0; c < bits[l]; c++) lens[order[k++]] = l;
  return lens;
}

/** 符号長から正準ハフマン符号を作る（RFC 1951 3.2.2）。値は上位ビットが先頭のビット。長さ 0 の記号は 0 */
export function canonicalCodes(lens: ArrayLike<number>): Uint16Array {
  const count = new Uint16Array(MAX_BITS + 1),
    next = new Uint16Array(MAX_BITS + 2),
    codes = new Uint16Array(lens.length);
  for (let i = 0; i < lens.length; i++) if (lens[i]) count[lens[i]]++;
  let c = 0;
  for (let l = 1; l <= MAX_BITS; l++) {
    c = (c + count[l - 1]) << 1;
    next[l] = c;
  }
  for (let i = 0; i < lens.length; i++) if (lens[i]) codes[i] = next[lens[i]]++;
  return codes;
}

/** v の下位 n ビットを逆順にする（ハフマン符号は上位ビットから書くので、下位から詰める書き手に渡す前に反転する。3.1.1） */
export function reverseBits(v: number, n: number): number {
  let r = 0;
  for (let i = 0; i < n; i++) {
    r = (r << 1) | (v & 1);
    v >>= 1;
  }
  return r;
}

/** 復号用の表（puff.c）: 長さごとの符号の数と、符号の順に並べた記号 */
export interface HuffDecoder {
  count: Uint16Array;
  symbol: Uint16Array;
  /**
   * 残り。0 なら完全な符号、正なら足りない（使われない符号がある）、負なら多すぎる（符号にならない）
   */
  left: number;
}

/** 符号長から復号用の表を作る（puff.c の construct） */
export function buildDecoder(lens: ArrayLike<number>): HuffDecoder {
  const n = lens.length,
    count = new Uint16Array(MAX_BITS + 1),
    symbol = new Uint16Array(n);
  for (let s = 0; s < n; s++) count[lens[s]]++;
  if (count[0] === n) return { count, symbol, left: 0 };
  let left = 1;
  for (let l = 1; l <= MAX_BITS; l++) {
    left <<= 1;
    left -= count[l];
    if (left < 0) return { count, symbol, left };
  }
  const offs = new Uint16Array(MAX_BITS + 1);
  for (let l = 1; l < MAX_BITS; l++) offs[l + 1] = offs[l] + count[l];
  for (let s = 0; s < n; s++) if (lens[s]) symbol[offs[lens[s]]++] = s;
  return { count, symbol, left };
}
