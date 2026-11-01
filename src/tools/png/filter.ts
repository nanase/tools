/**
 * 行ごとのフィルタ（PNG 仕様 9 章）。a は左の画素の同じバイト（bpp バイト前）、b は上の行の同じバイト、c は左上。
 * 行の外と最初の行の上は 0 とみなす。適応の選び方は残差を符号付きバイトとみなした絶対値の和が最小のもの（12.7）
 */

export type FilterType = 0 | 1 | 2 | 3 | 4;
export const FILTER_NAMES = ['None', 'Sub', 'Up', 'Average', 'Paeth'] as const;
/** 全行同じ種類か、行ごとに 5 種を試す「適応」 */
export type FilterMode = FilterType | 'adaptive';

/** Paeth の予測（9.4）: a + b − c に最も近いものを a・b・c の順に選ぶ */
export function paeth(a: number, b: number, c: number): number {
  const p = a + b - c,
    pa = Math.abs(p - a),
    pb = Math.abs(p - b),
    pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * 1 行にフィルタをかけ、out[o .. o+n) に書く。cur[c .. c+n) が今の行、prev[p .. p+n) が上の行（null なら 0）。
 * 残差を符号付きバイトとみなした絶対値の和を返す
 */
export function filterRow(
  type: FilterType,
  cur: Uint8Array,
  c: number,
  prev: Uint8Array | null,
  p: number,
  n: number,
  bpp: number,
  out: Uint8Array,
  o: number,
): number {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const x = cur[c + i],
      a = i >= bpp ? cur[c + i - bpp] : 0,
      b = prev ? prev[p + i] : 0,
      cc = prev && i >= bpp ? prev[p + i - bpp] : 0;
    let v: number;
    if (type === 0) v = x;
    else if (type === 1) v = x - a;
    else if (type === 2) v = x - b;
    else if (type === 3) v = x - ((a + b) >> 1);
    else v = x - paeth(a, b, cc);
    v &= 0xff;
    out[o + i] = v;
    sum += v < 128 ? v : 256 - v;
  }
  return sum;
}

/** フィルタを外す（その場で書き換える）。buf[s .. s+n) が今の行、prev[p .. p+n) が戻した上の行（null なら 0） */
export function unfilterRow(
  type: FilterType,
  buf: Uint8Array,
  s: number,
  prev: Uint8Array | null,
  p: number,
  n: number,
  bpp: number,
): void {
  if (type === 0) return;
  for (let i = 0; i < n; i++) {
    const a = i >= bpp ? buf[s + i - bpp] : 0,
      b = prev ? prev[p + i] : 0,
      c = prev && i >= bpp ? prev[p + i - bpp] : 0;
    let q: number;
    if (type === 1) q = a;
    else if (type === 2) q = b;
    else if (type === 3) q = (a + b) >> 1;
    else q = paeth(a, b, c);
    buf[s + i] = (buf[s + i] + q) & 0xff;
  }
}

export interface Filtered {
  /** 各行の先頭にフィルタの種類のバイトを付けた列（rows·(1 + rowBytes) バイト） */
  data: Uint8Array;
  /** 各行で選んだ種類 */
  types: Uint8Array;
  /** 各行の 5 種それぞれの和（行 y の種類 t は sums[y·5 + t]） */
  sums: Uint32Array;
}

/**
 * 行の並び raw（rows 行 × rowBytes バイト、隙間なし）にフィルタをかける。bpp は 1 画素のバイト数（1 未満は 1）。
 * 適応では和が最小の種類を選び、同じなら番号の小さいほうにする
 */
export function filterImage(raw: Uint8Array, rowBytes: number, rows: number, bpp: number, mode: FilterMode): Filtered {
  const data = new Uint8Array(rows * (1 + rowBytes)),
    types = new Uint8Array(rows),
    sums = new Uint32Array(rows * 5),
    tmp = new Uint8Array(rowBytes * 5),
    k = Math.max(1, bpp);
  for (let y = 0; y < rows; y++) {
    const c = y * rowBytes,
      prev = y > 0 ? raw : null,
      p = c - rowBytes;
    let best = 0;
    for (let t = 0; t < 5; t++) {
      sums[y * 5 + t] = filterRow(t as FilterType, raw, c, prev, p, rowBytes, k, tmp, t * rowBytes);
      if (sums[y * 5 + t] < sums[y * 5 + best]) best = t;
    }
    const pick = mode === 'adaptive' ? best : mode,
      o = y * (1 + rowBytes);
    types[y] = pick;
    data[o] = pick;
    data.set(tmp.subarray(pick * rowBytes, (pick + 1) * rowBytes), o + 1);
  }
  return { data, types, sums };
}

export interface Unfiltered {
  /** フィルタを外した行の並び（rows·rowBytes バイト）。戻せなかった所は 0 */
  raw: Uint8Array;
  /** 各行の種類（読めなかった行は 255） */
  types: Uint8Array;
  /** 最後まで戻せた行の数 */
  rows: number;
  /** 途中まで読めた次の行のバイト数（フィルタの種類のバイトを除く） */
  partial: number;
  /** 種類が 5 以上の行（なければ -1） */
  badRow: number;
}

/**
 * filterImage の逆。data が足りなければ読めた所まで戻す（途中までの行もフィルタは左と上しか見ないので戻せる）。
 * 種類が 5 以上の行で止まる
 */
export function unfilterImage(data: Uint8Array, rowBytes: number, rows: number, bpp: number): Unfiltered {
  const raw = new Uint8Array(rows * rowBytes),
    types = new Uint8Array(rows).fill(255),
    k = Math.max(1, bpp);
  let done = 0,
    partial = 0,
    badRow = -1;
  for (let y = 0; y < rows; y++) {
    const o = y * (1 + rowBytes);
    if (o >= data.length) break;
    const t = data[o];
    if (t > 4) {
      badRow = y;
      break;
    }
    types[y] = t;
    const n = Math.min(rowBytes, data.length - o - 1),
      c = y * rowBytes;
    raw.set(data.subarray(o + 1, o + 1 + n), c);
    unfilterRow(t as FilterType, raw, c, y > 0 ? raw : null, c - rowBytes, n, k);
    if (n < rowBytes) {
      partial = n;
      break;
    }
    done++;
  }
  return { raw, types, rows: done, partial, badRow };
}
