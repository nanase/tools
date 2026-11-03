/** MP3 のハフマン符号（DOM に依存しない）: 表の準備、領域の分け方と表の選び方、ビットの書き込み */
import { HUFF } from './tables';

export interface HuffTable {
  c: Uint32Array;
  l: Uint8Array;
}
const TAB: HuffTable[] = [];
for (const [k, e] of Object.entries(HUFF)) {
  const t: HuffTable = { c: new Uint32Array(256), l: new Uint8Array(256) };
  for (let i = 0; i < e.length; i += 3) {
    t.c[e[i]] = e[i + 1];
    t.l[e[i]] = e[i + 2];
  }
  TAB[Number(k)] = t;
}
/** 表の番号ごとの linbits（ISO/IEC 11172-3） */
export const LIN: Readonly<Record<number, number>> = {
  16: 1,
  17: 2,
  18: 3,
  19: 4,
  20: 6,
  21: 8,
  22: 10,
  23: 13,
  24: 4,
  25: 5,
  26: 6,
  27: 7,
  28: 8,
  29: 9,
  30: 11,
  31: 13,
};
/** 16〜23 は表 16、24〜31 は表 24 を共有する */
export const tabOf = (t: number): HuffTable => (t >= 32 ? TAB[t] : t >= 24 ? TAB[24] : t >= 16 ? TAB[16] : TAB[t]);
/** ハフマン符号で表せる最大の値 */
export const MAX_IX = 8206;

/** [a, b) を表 t で書いたときのビット数 */
function regionBits(ix: Int32Array, a: number, b: number, t: number): number {
  if (t === 0) return 0;
  const T = tabOf(t),
    lin = LIN[t] || 0;
  let n = 0;
  for (let i = a; i < b; i += 2) {
    let x = ix[i],
      y = ix[i + 1];
    if (lin) {
      if (x > 14) {
        n += lin;
        x = 15;
      }
      if (y > 14) {
        n += lin;
        y = 15;
      }
    }
    n += T.l[(x << 4) | y];
    if (x) n++;
    if (y) n++;
  }
  return n;
}
const CANDS: readonly (readonly [number, readonly number[]])[] = [
  [1, [1]],
  [2, [2, 3]],
  [3, [5, 6]],
  [5, [7, 8, 9]],
  [7, [10, 11, 12]],
  [15, [13, 15]],
];
const LIN_A = [16, 17, 18, 19, 20, 21, 22, 23],
  LIN_B = [24, 25, 26, 27, 28, 29, 30, 31];
/** [a, b) に最も少ないビットで済む表を選ぶ */
function chooseTable(ix: Int32Array, a: number, b: number): { t: number; bits: number } {
  let mx = 0;
  for (let i = a; i < b; i++) if (ix[i] > mx) mx = ix[i];
  if (mx === 0) return { t: 0, bits: 0 };
  let cands: readonly number[] | undefined = CANDS.find(([m]) => mx <= m)?.[1];
  if (!cands) {
    const need = mx - 15,
      ok = (t: number) => 2 ** LIN[t] - 1 >= need;
    cands = [LIN_A.find(ok), LIN_B.find(ok)].filter((t): t is number => t !== undefined);
  }
  let best = { t: -1, bits: Number.POSITIVE_INFINITY };
  for (const t of cands) {
    const bits = regionBits(ix, a, b, t);
    if (bits < best.bits) best = { t, bits };
  }
  return best;
}

export interface HuffInfo {
  /** big_values */
  bv: number;
  /** 2 個ずつの領域の終わり */
  c1: number;
  /** 0 でない値の終わり */
  end: number;
  /** count1 の表（0: 表 32、1: 表 33） */
  c1t: number;
  tables: [number, number, number];
  r0: number;
  r1: number;
  e0: number;
  e1: number;
  bits: number;
}

/** 量子化した値を符号にしたときの領域と表とビット数。表せない値があれば null */
export function huffInfo(ix: Int32Array, sfbL: readonly number[], type: number): HuffInfo | null {
  let end = 576;
  while (end > 1 && ix[end - 1] === 0 && ix[end - 2] === 0) end -= 2;
  if (end === 2 && ix[0] === 0 && ix[1] === 0) end = 0;
  /* count1（すべて 1 以下の 4 個組）を後ろから取る */
  let c1 = end;
  while (c1 >= 4 && ix[c1 - 1] <= 1 && ix[c1 - 2] <= 1 && ix[c1 - 3] <= 1 && ix[c1 - 4] <= 1) c1 -= 4;
  let a = 0,
    b = 0;
  const A = TAB[32],
    B = TAB[33];
  for (let i = c1; i < end; i += 4) {
    const k = (ix[i] << 3) | (ix[i + 1] << 2) | (ix[i + 2] << 1) | ix[i + 3],
      s = ix[i] + ix[i + 1] + ix[i + 2] + ix[i + 3];
    a += A.l[k] + s;
    b += B.l[k] + s;
  }
  const c1t = a <= b ? 0 : 1;
  let bits = Math.min(a, b);
  const res: HuffInfo = { bv: c1 >> 1, c1, end, c1t, tables: [0, 0, 0], r0: 0, r1: 0, e0: 0, e1: 0, bits: 0 };
  if (type === 0) {
    /* 長いブロックは 3 領域。境界は sfb に合わせ、割合はこのツールで決めた値 */
    let n = 0;
    while (n < 21 && sfbL[n] < c1) n++;
    const r0 = Math.min(15, Math.round(n * 0.3)),
      r1 = Math.min(7, Math.round(n * 0.35)),
      e0 = Math.min(sfbL[Math.min(r0 + 1, 21)], c1),
      e1 = Math.min(sfbL[Math.min(r0 + r1 + 2, 21)], c1),
      t0 = chooseTable(ix, 0, e0),
      t1 = chooseTable(ix, e0, e1),
      t2 = chooseTable(ix, e1, c1);
    if (t0.t < 0 || t1.t < 0 || t2.t < 0) return null;
    res.tables = [t0.t, t1.t, t2.t];
    res.r0 = r0;
    res.r1 = r1;
    res.e0 = e0;
    res.e1 = e1;
    bits += t0.bits + t1.bits + t2.bits;
  } else {
    /* 窓を切り替えるブロックは 2 領域。境界は規格で決まる（短いブロックは 36 本、ほかは sfb 8） */
    const e0 = Math.min(type === 2 ? 36 : sfbL[8], c1),
      t0 = chooseTable(ix, 0, e0),
      t1 = chooseTable(ix, e0, c1);
    if (t0.t < 0 || t1.t < 0) return null;
    res.tables = [t0.t, t1.t, 0];
    res.e0 = e0;
    res.e1 = c1;
    bits += t0.bits + t1.bits;
  }
  res.bits = bits;
  return res;
}

/** ビットの書き込み先 */
export class BitWriter {
  b: Uint8Array;
  n = 0;
  constructor(cap = 4096) {
    this.b = new Uint8Array(cap);
  }
  put(v: number, len: number): void {
    if (len === 0) return;
    if (((this.n + len) >> 3) + 2 > this.b.length) {
      const c = new Uint8Array(this.b.length * 2);
      c.set(this.b);
      this.b = c;
    }
    for (let i = len - 1; i >= 0; i--) {
      if ((v / 2 ** i) & 1) this.b[this.n >> 3] |= 0x80 >> (this.n & 7);
      this.n++;
    }
  }
}

function writeRegion(w: BitWriter, ix: Int32Array, sign: Uint8Array, a: number, b: number, t: number): void {
  if (t === 0) return;
  const T = tabOf(t),
    lin = LIN[t] || 0;
  for (let i = a; i < b; i += 2) {
    const x0 = ix[i],
      y0 = ix[i + 1],
      x = lin && x0 > 14 ? 15 : x0,
      y = lin && y0 > 14 ? 15 : y0,
      k = (x << 4) | y;
    w.put(T.c[k], T.l[k]);
    if (x === 15 && lin) w.put(x0 - 15, lin);
    if (x) w.put(sign[i], 1);
    if (y === 15 && lin) w.put(y0 - 15, lin);
    if (y) w.put(sign[i + 1], 1);
  }
}

/** 量子化した値を符号にして書く */
export function writeHuffman(w: BitWriter, ix: Int32Array, sign: Uint8Array, info: HuffInfo, type: number): void {
  writeRegion(w, ix, sign, 0, info.e0, info.tables[0]);
  writeRegion(w, ix, sign, info.e0, info.e1, info.tables[1]);
  if (type === 0) writeRegion(w, ix, sign, info.e1, info.c1, info.tables[2]);
  const T = TAB[info.c1t ? 33 : 32];
  for (let i = info.c1; i < info.end; i += 4) {
    const k = (ix[i] << 3) | (ix[i + 1] << 2) | (ix[i + 2] << 1) | ix[i + 3];
    w.put(T.c[k], T.l[k]);
    for (let j = 0; j < 4; j++) if (ix[i + j]) w.put(sign[i + j], 1);
  }
}

/** 線ごとのビット（図のため）。2 個組・4 個組の符号は等分する */
export function lineBits(ix: Int32Array, info: HuffInfo, type: number): Float32Array {
  const lb = new Float32Array(576),
    add = (a: number, b: number, t: number) => {
      if (t === 0) return;
      const T = tabOf(t),
        lin = LIN[t] || 0;
      for (let i = a; i < b; i += 2) {
        const x0 = ix[i],
          y0 = ix[i + 1],
          x = lin && x0 > 14 ? 15 : x0,
          y = lin && y0 > 14 ? 15 : y0;
        let n = T.l[(x << 4) | y];
        if (x) n++;
        if (y) n++;
        if (x === 15 && lin) n += lin;
        if (y === 15 && lin) n += lin;
        lb[i] += n / 2;
        lb[i + 1] += n / 2;
      }
    };
  add(0, info.e0, info.tables[0]);
  add(info.e0, info.e1, info.tables[1]);
  if (type === 0) add(info.e1, info.c1, info.tables[2]);
  const T = TAB[info.c1t ? 33 : 32];
  for (let i = info.c1; i < info.end; i += 4) {
    const k = (ix[i] << 3) | (ix[i + 1] << 2) | (ix[i + 2] << 1) | ix[i + 3],
      n = T.l[k] + ix[i] + ix[i + 1] + ix[i + 2] + ix[i + 3];
    for (let j = 0; j < 4; j++) lb[i + j] += n / 4;
  }
  return lb;
}
