/**
 * ページに見せる値のまとめ（Worker で作って渡す）と、行・バイト・画素の対応。
 * 符号化した PNG（enc）と、利用者の PNG ファイルをそのまま読んだもの（file）を同じ形にする
 */
import { adam7PassOf, passToImage } from './adam7';
import { type FilterMode, type FilterType, filterImage } from './filter';
import { type ChunkInfo, type ColorType, decodePng, encodePng, type Layout, type PassLayout } from './png';
import type { DeflateTrace } from './trace';
import { zlibCompress } from './zlib';

export interface EncOpts {
  colorType: ColorType;
  filter: FilterMode;
  level: number;
  interlace: boolean;
}

export interface Model {
  mode: 'enc' | 'file';
  layout: Layout;
  /** PNG ファイル */
  bytes: Uint8Array;
  chunks: ChunkInfo[];
  palette: Uint8Array | null;
  trns: Uint8Array | null;
  /** 復号した画素（RGBA） */
  rgba: Uint8ClampedArray;
  /** フィルタ前・後の行の並び（ストリームの順） */
  raw: Uint8Array;
  filtered: Uint8Array;
  /** 各行のフィルタの種類と、5 種それぞれの和（行 r の種類 t は sums[r·5 + t]） */
  types: Uint8Array;
  sums: Uint32Array;
  /** IDAT をつないだ zlib のストリームと、その中の Deflate の記録（ビット位置は頭の 2 バイトの後から） */
  zlib: Uint8Array;
  trace: DeflateTrace;
  adlerOk: boolean;
  crcOk: boolean;
  /** 圧縮レベル（file は分からないので −1） */
  level: number;
  /** 復号すると入力と変わる画素の数（enc だけ） */
  loss: { color: number; alpha: number } | null;
  /** 読んだときの問題（file だけ） */
  issues: string[];
}

/** 失敗の理由 */
export type Fail = 'too-many-colors' | 'not-png' | 'too-large';

/** 1 回の符号化 */
export function encodeModel(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  o: EncOpts,
): Model | { fail: Fail; colors?: number } {
  const enc = (bitDepth: 1 | 2 | 4 | 8) =>
    encodePng(rgba, w, h, {
      colorType: o.colorType,
      bitDepth,
      filter: o.filter,
      level: o.level,
      interlace: o.interlace,
    });
  /* パレットは色の数が入る最も小さい深度にする */
  let e = enc(o.colorType === 3 ? 1 : 8);
  if (!e.ok && e.reason === 'depth-too-small') e = enc(e.colors <= 4 ? 2 : e.colors <= 16 ? 4 : 8);
  if (!e.ok) return { fail: 'too-many-colors', colors: e.colors };
  const trace = e.zlib.deflate.trace;
  if (!trace) throw new Error('記録がない');
  const d = decodePng(e.bytes, { trace: false });
  return {
    mode: 'enc',
    layout: e.layout,
    bytes: e.bytes,
    chunks: e.chunks,
    palette: e.palette,
    trns: e.trns,
    rgba: d.rgba,
    raw: e.raw,
    filtered: e.filtered,
    types: e.filterTypes,
    sums: e.filterSums,
    zlib: e.zlib.bytes,
    trace,
    adlerOk: true,
    crcOk: true,
    level: o.level,
    loss: e.loss,
    issues: [],
  };
}

/** 読み込む PNG ファイルの画素の数の上限（記録が大きくなりすぎないように） */
export const FILE_MAX_PIXELS = 1024 * 1024;

/** PNG ファイルをそのまま読む。読めなければ失敗の理由 */
export function fileModel(bytes: Uint8Array): Model | { fail: Fail } {
  let d: ReturnType<typeof decodePng>;
  try {
    d = decodePng(bytes, { tolerant: true, trace: true, ignoreCrc: true, maxPixels: FILE_MAX_PIXELS });
  } catch {
    return { fail: 'not-png' };
  }
  if (d.issues.some((i) => i.reason === 'too-large')) return { fail: 'too-large' };
  if (!d.layout || !d.zlib?.inflate.trace) return { fail: 'not-png' };
  const L = d.layout,
    /* 途中で切れたファイルは、足りない行を 0 で埋める */
    pad = (a: Uint8Array, n: number): Uint8Array => {
      if (a.length >= n) return a;
      const b = new Uint8Array(n);
      b.set(a);
      return b;
    },
    raw = pad(d.raw, L.rawSize);
  return {
    mode: 'file',
    layout: L,
    bytes,
    chunks: d.chunks,
    palette: d.palette,
    trns: d.trns,
    rgba: d.rgba,
    raw,
    filtered: pad(d.filtered, L.filteredSize),
    types: d.filterTypes,
    sums: filterAll(L, raw, 'adaptive').sums,
    zlib: d.idat,
    trace: d.zlib.inflate.trace,
    adlerOk: d.zlib.adlerOk,
    crcOk: d.chunks.every((c) => c.crcOk),
    level: -1,
    loss: null,
    issues: d.issues.map((i) => i.message),
  };
}

/** パスごとにフィルタをかけてつなぐ（行の和もつなぐ） */
export function filterAll(
  L: Layout,
  raw: Uint8Array,
  mode: FilterMode,
): { data: Uint8Array; types: Uint8Array; sums: Uint32Array } {
  const data = new Uint8Array(L.filteredSize),
    types = new Uint8Array(L.rows),
    sums = new Uint32Array(L.rows * 5);
  for (const p of L.passes) {
    const f = filterImage(raw.subarray(p.rawOffset, p.rawOffset + p.h * p.rowBytes), p.rowBytes, p.h, L.bpp, mode);
    data.set(f.data, p.filteredOffset);
    types.set(f.types, p.rowStart);
    sums.set(f.sums, p.rowStart * 5);
  }
  return { data, types, sums };
}

/** フィルタの比較: 5 種と適応のフィルタ後の並びと、それを zlib にした大きさ */
export interface Compare {
  data: Uint8Array[];
  types: Uint8Array[];
  sizes: number[];
}
export const CMP_MODES: readonly FilterMode[] = [0, 1, 2, 3, 4, 'adaptive'];
export function compare(L: Layout, raw: Uint8Array, level: number): Compare {
  const data: Uint8Array[] = [],
    types: Uint8Array[] = [],
    sizes: number[] = [];
  for (const m of CMP_MODES) {
    const f = filterAll(L, raw, m);
    data.push(f.data);
    types.push(f.types);
    sizes.push(zlibCompress(f.data, { level, trace: false }).bytes.length);
  }
  return { data, types, sizes };
}

/* ---------- 行・バイト・画素の対応 ---------- */

/** ストリームの行 r のパスと、パスの中の行番号 */
export function rowPass(L: Layout, r: number): [PassLayout, number] {
  let p = L.passes[0];
  for (const q of L.passes) if (q.rowStart <= r) p = q;
  return [p, r - p.rowStart];
}

/** 行 r の先頭（種類のバイト）の、フィルタ後の並びでの位置 */
export const rowStartPos = (L: Layout, r: number): number => {
  const [p, py] = rowPass(L, r);
  return p.filteredOffset + py * (p.rowBytes + 1);
};

/** 行 r の、フィルタ前の並びでの位置 */
export const rawRowPos = (L: Layout, r: number): number => {
  const [p, py] = rowPass(L, r);
  return p.rawOffset + py * p.rowBytes;
};

/** フィルタ後の並びの位置 pos が、どの行の何バイト目か（種類のバイトは j = −1） */
export function posRow(L: Layout, pos: number): [number, number] {
  let p = L.passes[0];
  for (const q of L.passes) if (q.filteredOffset <= pos) p = q;
  const k = pos - p.filteredOffset,
    py = Math.floor(k / (p.rowBytes + 1));
  return [p.rowStart + py, (k % (p.rowBytes + 1)) - 1];
}

/** 画像の画素 (x, y) を送る行と、行の中の画素の番号 */
export function pixelRow(L: Layout, x: number, y: number): [number, number] {
  for (const p of L.passes)
    if (x >= p.x0 && y >= p.y0 && (x - p.x0) % p.dx === 0 && (y - p.y0) % p.dy === 0)
      return [p.rowStart + (y - p.y0) / p.dy, (x - p.x0) / p.dx];
  return [0, 0];
}

/** 行 r の j バイト目が持つ画素の範囲 [first, last]（行の中の画素の番号） */
export function bytePixels(L: Layout, r: number, j: number): [number, number] {
  const [p] = rowPass(L, r),
    b = L.bitsPerPixel;
  return [Math.min(p.w - 1, Math.floor((j * 8) / b)), Math.min(p.w - 1, Math.floor((j * 8 + 7) / b))];
}

/** 行 r の画素 px の画像での位置 */
export function rowPixelXY(L: Layout, r: number, px: number): [number, number] {
  const [p, py] = rowPass(L, r);
  return passToImage(p, px, py);
}

/** 行 r の画素 px の最初のバイト（行の中の番号） */
export const pixelByte = (L: Layout, px: number): number => Math.floor((px * L.bitsPerPixel) / 8);

/** バイトの各チャンネルの名前（行の中の j バイト目。深度 8 未満は null） */
export function channelOf(L: Layout, j: number): string | null {
  if (L.bitDepth < 8) return null;
  const NM: Record<ColorType, string[]> = {
      0: ['Y'],
      2: ['R', 'G', 'B'],
      3: ['I'],
      4: ['Y', 'A'],
      6: ['R', 'G', 'B', 'A'],
    },
    k = L.bitDepth / 8;
  return NM[L.colorType][Math.floor(j / k) % L.channels];
}

/* ---------- 画像に描く層 ---------- */

/** 符号付きバイトとして読む */
export const sgn = (v: number): number => (v > 127 ? v - 256 : v);

/**
 * フィルタ後の並びを画像にする（残差の画像）。灰色 128 が 0、差を 2 倍して描く。None は元のバイトのまま。
 * RGB は 3 つのチャンネル、ほかは最初のチャンネル（深度 16 は上位バイト、8 未満はその画素を含むバイト）
 */
export function residualImage(L: Layout, f: Uint8Array, types: Uint8Array): Uint8ClampedArray {
  const W = L.width,
    out = new Uint8ClampedArray(W * L.height * 4),
    k = L.bitDepth >= 8 ? L.bitDepth / 8 : 0,
    rgb = L.colorType === 2 || L.colorType === 6;
  for (let r = 0; r < L.rows; r++) {
    const [p, py] = rowPass(L, r),
      s = p.filteredOffset + py * (p.rowBytes + 1) + 1,
      none = types[r] === 0;
    for (let px = 0; px < p.w; px++) {
      const [x, y] = passToImage(p, px, py),
        o = (y * W + x) * 4,
        b = s + pixelByte(L, px);
      for (let c = 0; c < 3; c++) {
        const v = f[rgb ? b + c * k : b];
        out[o + c] = none ? v : 128 + 2 * sgn(v);
      }
      out[o + 3] = 255;
    }
  }
  return out;
}

/** 画素ごとのビット数（記号のビットを、記号が作るバイトに等分して配る） */
export function bitsPerPixelMap(L: Layout, t: DeflateTrace): Float32Array {
  const W = L.width,
    m = new Float32Array(W * L.height),
    T = t.tokens,
    perByte = new Float32Array(L.filteredSize);
  for (let i = 0; i < T.count; i++) {
    const n = T.kind[i] === 0 ? 1 : T.kind[i] === 2 ? 0 : T.len[i];
    if (!n) continue;
    const b = T.nbits[i] / n;
    for (let q = T.pos[i]; q < T.pos[i] + n && q < perByte.length; q++) perByte[q] += b;
  }
  for (let r = 0; r < L.rows; r++) {
    const [p, py] = rowPass(L, r),
      s = p.filteredOffset + py * (p.rowBytes + 1);
    /* 種類のバイトの分は行の最初の画素に入れる */
    for (let j = -1; j < p.rowBytes; j++) {
      const [a, b] = j < 0 ? [0, 0] : bytePixels(L, r, j),
        v = perByte[s + 1 + j] / (b - a + 1);
      for (let px = a; px <= b; px++) {
        const [x, y] = passToImage(p, px, py);
        m[y * W + x] += v;
      }
    }
  }
  return m;
}

/** 各画素のパス（1〜7。インターレースなしでも Adam7 の分け方） */
export function passMap(W: number, H: number): Uint8Array {
  const m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m[y * W + x] = adam7PassOf(x, y);
  return m;
}

/** フィルタの種類（0〜4）を名前に */
export const filterName = (t: number): string =>
  (['None', 'Sub', 'Up', 'Average', 'Paeth'] as const)[t as FilterType] ?? '?';
