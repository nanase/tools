/**
 * ハフマン符号: 表の定義（BITS・HUFFVAL）から符号を作る（T.81 Annex C）、出現回数から最適な表を作る
 * （T.81 K.2 の手順。libjpeg 6b の jpeg_gen_optimal_table と同じ）、記号の大きさの区分（SSSS）と付加ビット
 */
import type { HuffSpec } from './tables';

/** 記号ごとの符号（ない記号は len 0） */
export interface HuffCode {
  code: Uint16Array;
  len: Uint8Array;
}

/** BITS・HUFFVAL から符号を作る（短い符号から順に 1 ずつ増やし、長さが変わると左へずらす） */
export function buildCodes(s: HuffSpec): HuffCode {
  const code = new Uint16Array(256),
    len = new Uint8Array(256);
  let c = 0,
    k = 0;
  for (let l = 1; l <= 16; l++) {
    for (let i = 0; i < s.bits[l - 1]; i++) {
      const v = s.vals[k++];
      code[v] = c;
      len[v] = l;
      c++;
    }
    c <<= 1;
  }
  return { code, len };
}

/**
 * 出現回数（freq[0..255]）から、長さ 16 以下の最適な表を作る。すべて 1 の符号を避けるため、
 * 回数 1 の仮の記号 256 を足して木を作り、最後にその符号を取り除く（T.81 K.2、図 K.1〜K.4）
 */
export function optimalSpec(freq: ArrayLike<number>): HuffSpec {
  const f = new Float64Array(257),
    size = new Int32Array(257),
    others = new Int32Array(257).fill(-1);
  for (let i = 0; i < 256; i++) f[i] = freq[i] ?? 0;
  f[256] = 1;
  for (;;) {
    /* 回数が最も少ない記号 c1 と、次に少ない c2（同じなら番号の大きいほう） */
    let c1 = -1,
      v = Infinity;
    for (let i = 0; i <= 256; i++)
      if (f[i] > 0 && f[i] <= v) {
        v = f[i];
        c1 = i;
      }
    let c2 = -1;
    v = Infinity;
    for (let i = 0; i <= 256; i++)
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
  const bits = new Int32Array(33);
  for (let i = 0; i <= 256; i++) if (size[i]) bits[size[i]]++;
  /* 16 を超える長さを詰める（図 K.3） */
  for (let i = 32; i > 16; i--)
    while (bits[i] > 0) {
      let j = i - 2;
      while (bits[j] === 0) j--;
      bits[i] -= 2;
      bits[i - 1]++;
      bits[j + 1] += 2;
      bits[j]--;
    }
  /* 仮の記号の符号（最も長いもの）を除く */
  let i = 16;
  while (bits[i] === 0) i--;
  bits[i]--;
  const vals: number[] = [];
  for (let l = 1; l <= 32; l++) for (let j = 0; j < 256; j++) if (size[j] === l) vals.push(j);
  return { bits: Array.from(bits.slice(1, 17)), vals };
}

/** 値の大きさの区分 SSSS（|x| を表すのに要るビット数。0 は 0） */
export function category(x: number): number {
  let a = Math.abs(x),
    n = 0;
  while (a) {
    n++;
    a >>= 1;
  }
  return n;
}

/** 付加ビット: 正はそのまま、負は x − 1 の下位 SSSS ビット（1 の補数） */
export const extraBits = (x: number, s: number): number => (x < 0 ? x - 1 + (1 << s) : x) & ((1 << s) - 1);

/** 付加ビットから値に戻す（T.81 F.2.2.1 の EXTEND） */
export const extend = (v: number, s: number): number => (s === 0 ? 0 : v < 1 << (s - 1) ? v - (1 << s) + 1 : v);

/** 符号を 0 と 1 の文字列に */
export const bitStr = (v: number, n: number): string => (n ? v.toString(2).padStart(n, '0') : '');
