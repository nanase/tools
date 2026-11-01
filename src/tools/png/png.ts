/**
 * PNG の符号化と復号（PNG 仕様 第 3 版、ISO/IEC 15948）。符号化は RGBA 8 ビットから色の型 0・2・3・4・6
 * （深度は 8、グレーとパレットは 1・2・4 も）、復号は色の型と深度の正しい組み合わせすべてと Adam7。
 * 途中の値（フィルタの前後の行、各行のフィルタ、Deflate の記録）も返す
 */
import { crc32, crc32Update } from '../../lib/imgfmt/crc32';
import { adam7Passes, type Pass, singlePass } from './adam7';
import { type FilterMode, filterImage, unfilterImage } from './filter';
import type { InflateError, InflateOptions } from './inflate';
import { type ZlibDecoded, type ZlibEncoded, zlibCompress, zlibDecompress } from './zlib';

/** 署名（5.2） */
export const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

/** 色の型（11.2.2）: 0 グレー、2 RGB、3 パレット、4 グレー＋α、6 RGBA */
export type ColorType = 0 | 2 | 3 | 4 | 6;
export const CHANNELS: Record<ColorType, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
/** 色の型ごとに使えるビット深度（表 11.1） */
export const DEPTHS: Record<ColorType, readonly number[]> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};

/** 1 つのパスの行の置き場所 */
export interface PassLayout extends Pass {
  /** 1 行のバイト数（フィルタの種類のバイトを除く） */
  rowBytes: number;
  /** このパスの最初の行の、全体（ストリームの順）での行番号 */
  rowStart: number;
  /** フィルタ前の行の並び（raw）とフィルタ後の並び（filtered、種類のバイトつき）でのこのパスの先頭 */
  rawOffset: number;
  filteredOffset: number;
}

export interface Layout {
  width: number;
  height: number;
  colorType: ColorType;
  bitDepth: number;
  interlace: boolean;
  channels: number;
  bitsPerPixel: number;
  /** フィルタで使う 1 画素のバイト数（1 未満は 1） */
  bpp: number;
  /** 送るパス（空のパスは除く。インターレースなしは pass 0 の 1 つ） */
  passes: PassLayout[];
  /** 行の総数（全パスの合計） */
  rows: number;
  rawSize: number;
  filteredSize: number;
}

/** 行の並べ方（PNG 仕様 7 章・8 章） */
export function pngLayout(
  width: number,
  height: number,
  colorType: ColorType,
  bitDepth: number,
  interlace: boolean,
): Layout {
  const channels = CHANNELS[colorType],
    bitsPerPixel = channels * bitDepth,
    passes: PassLayout[] = [];
  let rows = 0,
    raw = 0,
    filtered = 0;
  for (const p of interlace ? adam7Passes(width, height) : [singlePass(width, height)]) {
    if (!p.w || !p.h) continue;
    const rowBytes = Math.ceil((p.w * bitsPerPixel) / 8);
    passes.push({ ...p, rowBytes, rowStart: rows, rawOffset: raw, filteredOffset: filtered });
    rows += p.h;
    raw += p.h * rowBytes;
    filtered += p.h * (rowBytes + 1);
  }
  return {
    width,
    height,
    colorType,
    bitDepth,
    interlace,
    channels,
    bitsPerPixel,
    bpp: Math.max(1, bitsPerPixel >> 3),
    passes,
    rows,
    rawSize: raw,
    filteredSize: filtered,
  };
}

/** チャンクの一覧の 1 行（5.3） */
export interface ChunkInfo {
  type: string;
  /** 長さの欄の位置（チャンクの先頭） */
  offset: number;
  /** データの長さ */
  length: number;
  /** 書かれた CRC と、種類とデータから計算した CRC */
  crc: number;
  crcCalc: number;
  crcOk: boolean;
  /** 種類の 1 文字目が大文字（必須） */
  critical: boolean;
  /** この実装が名前を知っているか */
  known: boolean;
}

const KNOWN = new Set([
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
  'tRNS',
  'cHRM',
  'gAMA',
  'iCCP',
  'sBIT',
  'sRGB',
  'cICP',
  'mDCV',
  'cLLI',
  'tEXt',
  'zTXt',
  'iTXt',
  'bKGD',
  'hIST',
  'pHYs',
  'sPLT',
  'eXIf',
  'tIME',
  'acTL',
  'fcTL',
  'fdAT',
]);

/* ---------------- 符号化 ---------------- */

export interface PngEncodeOptions {
  /** 色の型（既定 6） */
  colorType?: ColorType;
  /** ビット深度（既定 8。グレーとパレットは 1・2・4 も） */
  bitDepth?: 1 | 2 | 4 | 8;
  /** Adam7 にするか（既定 false） */
  interlace?: boolean;
  /** フィルタ（既定 'adaptive'） */
  filter?: FilterMode;
  /** 圧縮レベル 0〜9（既定 6） */
  level?: number;
  /**
   * 透明を tRNS で書くか（既定 true）。パレットは各色の α、グレー・RGB は α 0 の画素を 1 色の透明として書く。
   * false ならパレットも α を捨てる
   */
  trns?: boolean;
  /** 1 つの IDAT の最大のデータ長（既定 8192。libpng と同じ） */
  idatSize?: number;
  /** Deflate の記録を取るか（既定 true） */
  trace?: boolean;
}

export interface PngEncoded {
  ok: true;
  bytes: Uint8Array;
  chunks: ChunkInfo[];
  layout: Layout;
  /** PLTE の中身（RGB の 3 バイトずつ） */
  palette: Uint8Array | null;
  /** tRNS の中身 */
  trns: Uint8Array | null;
  /** フィルタ前の行の並び（パスの順） */
  raw: Uint8Array;
  /** フィルタ後の行の並び（各行の先頭に種類のバイト）。これを zlib で包んだものが IDAT になる */
  filtered: Uint8Array;
  /** 各行（ストリームの順）のフィルタの種類と、5 種それぞれの和（行 r の種類 t は filterSums[r·5 + t]） */
  filterTypes: Uint8Array;
  filterSums: Uint32Array;
  /** IDAT をつないだ zlib のストリーム（Deflate の記録は zlib.deflate.trace） */
  zlib: ZlibEncoded;
  /** 復号すると入力と変わる画素の数（色・α。どちらも α 0 なら色は比べない） */
  loss: { color: number; alpha: number };
}

/** 色が 256 を超えてパレットにできない、または深度が足りない */
export interface PngEncodeFail {
  ok: false;
  reason: 'too-many-colors' | 'depth-too-small';
  /** 数えた色の数（257 で数えるのをやめる） */
  colors: number;
}

const luma = (r: number, g: number, b: number): number => Math.round((r * 299 + g * 587 + b * 114) / 1000);

/** 画素ごとの標本（各チャンネル、指定の深度での値）とパレットを作る */
interface Samples {
  samp: Uint16Array;
  palette: Uint8Array | null;
  trns: Uint8Array | null;
}

function toSamples(
  rgba: ArrayLike<number>,
  n: number,
  ct: ColorType,
  depth: number,
  useTrns: boolean,
): Samples | PngEncodeFail {
  const ch = CHANNELS[ct],
    samp = new Uint16Array(n * ch),
    maxv = (1 << depth) - 1,
    q = (v: number): number => (depth === 8 ? v : Math.round((v * maxv) / 255));
  if (ct === 3) {
    /* 色を数え、α が 255 でない色を前に置く（tRNS を短くするため。α 0 の色は 1 つにまとめる） */
    const map = new Map<number, number>(),
      keys: number[] = [],
      key = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      const a = useTrns ? rgba[i * 4 + 3] : 255,
        k = a === 0 ? 0 : ((rgba[i * 4] << 24) | (rgba[i * 4 + 1] << 16) | (rgba[i * 4 + 2] << 8) | a) >>> 0;
      key[i] = k;
      if (!map.has(k)) {
        map.set(k, keys.length);
        keys.push(k);
        if (keys.length > 256) return { ok: false, reason: 'too-many-colors', colors: 257 };
      }
    }
    if (keys.length > 1 << depth) return { ok: false, reason: 'depth-too-small', colors: keys.length };
    const order = keys
        .map((_, i) => i)
        .sort((x, y) => +((keys[x] & 255) === 255) - +((keys[y] & 255) === 255) || x - y),
      idx = new Map<number, number>(),
      palette = new Uint8Array(keys.length * 3);
    let nt = 0;
    order.forEach((ki, j) => {
      const k = keys[ki];
      idx.set(k, j);
      palette[j * 3] = k >>> 24;
      palette[j * 3 + 1] = (k >>> 16) & 255;
      palette[j * 3 + 2] = (k >>> 8) & 255;
      if ((k & 255) !== 255) nt = j + 1;
    });
    const trns = nt ? Uint8Array.from(order.slice(0, nt), (ki) => keys[ki] & 255) : null;
    for (let i = 0; i < n; i++) samp[i] = idx.get(key[i]) as number;
    return { samp, palette, trns };
  }
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4],
      g = rgba[i * 4 + 1],
      b = rgba[i * 4 + 2],
      a = rgba[i * 4 + 3],
      o = i * ch;
    if (ct === 0) samp[o] = q(luma(r, g, b));
    else if (ct === 4) {
      samp[o] = luma(r, g, b);
      samp[o + 1] = a;
    } else {
      samp[o] = r;
      samp[o + 1] = g;
      samp[o + 2] = b;
      if (ct === 6) samp[o + 3] = a;
    }
  }
  let trns: Uint8Array | null = null;
  if (useTrns && (ct === 0 || ct === 2)) {
    /* α 0 の画素を 1 色にまとめる。その色が不透明な画素に使われていれば、使われていない色を探す */
    let first = -1;
    const used = new Set<number>(),
      keyOf = (i: number): number =>
        ct === 0 ? samp[i] : (samp[i * 3] << 16) | (samp[i * 3 + 1] << 8) | samp[i * 3 + 2];
    for (let i = 0; i < n; i++) {
      if (rgba[i * 4 + 3] === 0) {
        if (first < 0) first = i;
      } else used.add(keyOf(i));
    }
    if (first >= 0) {
      let k = keyOf(first);
      const limit = ct === 0 ? maxv : 0xffffff;
      if (used.has(k)) {
        k = -1;
        for (let c = 0; c <= limit; c++)
          if (!used.has(c)) {
            k = c;
            break;
          }
      }
      if (k >= 0) {
        for (let i = 0; i < n; i++)
          if (rgba[i * 4 + 3] === 0) {
            if (ct === 0) samp[i] = k;
            else {
              samp[i * 3] = k >> 16;
              samp[i * 3 + 1] = (k >> 8) & 255;
              samp[i * 3 + 2] = k & 255;
            }
          }
        trns = ct === 0 ? Uint8Array.of(0, k) : Uint8Array.of(0, k >> 16, 0, (k >> 8) & 255, 0, k & 255);
      }
    }
  }
  return { samp, palette: null, trns };
}

/** 標本を行のバイト列に詰める（7.2。深度 8 未満は 1 バイトに上位ビットから） */
function packPass(samp: Uint16Array, width: number, p: PassLayout, ch: number, depth: number, out: Uint8Array): void {
  let o = p.rawOffset;
  for (let py = 0; py < p.h; py++) {
    const y = p.y0 + py * p.dy;
    if (depth === 8) {
      for (let px = 0; px < p.w; px++) {
        const s = (y * width + p.x0 + px * p.dx) * ch;
        for (let c = 0; c < ch; c++) out[o++] = samp[s + c];
      }
      continue;
    }
    let acc = 0,
      nb = 0;
    const e = o + p.rowBytes;
    for (let px = 0; px < p.w; px++) {
      const s = (y * width + p.x0 + px * p.dx) * ch;
      for (let c = 0; c < ch; c++) {
        acc = (acc << depth) | samp[s + c];
        nb += depth;
        if (nb === 8) {
          out[o++] = acc;
          acc = 0;
          nb = 0;
        }
      }
    }
    if (nb) out[o++] = acc << (8 - nb);
    o = e;
  }
}

function chunkBytes(type: string, data: Uint8Array): Uint8Array {
  const c = new Uint8Array(12 + data.length),
    dv = new DataView(c.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) c[4 + i] = type.charCodeAt(i);
  c.set(data, 8);
  dv.setUint32(8 + data.length, crc32(c, 4, 8 + data.length));
  return c;
}

/** RGBA 8 ビットの画像を PNG にする。パレットにできないときは ok: false を返す。組み合わせが正しくなければ RangeError */
export function encodePng(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  opts: PngEncodeOptions = {},
): PngEncoded | PngEncodeFail {
  const ct = opts.colorType ?? 6,
    depth = opts.bitDepth ?? 8,
    interlace = opts.interlace ?? false;
  if (!(width > 0 && height > 0 && width < 2 ** 31 && height < 2 ** 31))
    throw new RangeError('画像の大きさが正しくない');
  if (rgba.length < width * height * 4) throw new RangeError('画素が足りない');
  if (!DEPTHS[ct]?.includes(depth) || (depth as number) === 16)
    throw new RangeError(`色の型 ${ct} に深度 ${depth} は使えない`);
  const n = width * height,
    s = toSamples(rgba, n, ct, depth, opts.trns ?? true);
  if ('ok' in s) return s;
  const L = pngLayout(width, height, ct, depth, interlace),
    raw = new Uint8Array(L.rawSize),
    filtered = new Uint8Array(L.filteredSize),
    filterTypes = new Uint8Array(L.rows),
    filterSums = new Uint32Array(L.rows * 5),
    mode = opts.filter ?? 'adaptive';
  for (const p of L.passes) {
    packPass(s.samp, width, p, L.channels, depth, raw);
    const f = filterImage(raw.subarray(p.rawOffset, p.rawOffset + p.h * p.rowBytes), p.rowBytes, p.h, L.bpp, mode);
    filtered.set(f.data, p.filteredOffset);
    filterTypes.set(f.types, p.rowStart);
    filterSums.set(f.sums, p.rowStart * 5);
  }
  const z = zlibCompress(filtered, { level: opts.level ?? 6, trace: opts.trace ?? true });

  const ihdr = new Uint8Array(13),
    dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = depth;
  ihdr[9] = ct;
  ihdr[12] = interlace ? 1 : 0;
  /* 必須でないのは tRNS だけ。順は IHDR・PLTE・tRNS・IDAT・IEND（5.6） */
  const parts: [string, Uint8Array][] = [['IHDR', ihdr]];
  if (s.palette) parts.push(['PLTE', s.palette]);
  if (s.trns) parts.push(['tRNS', s.trns]);
  const step = Math.max(1, opts.idatSize ?? 8192);
  for (let i = 0; i < z.bytes.length; i += step) parts.push(['IDAT', z.bytes.subarray(i, i + step)]);
  parts.push(['IEND', new Uint8Array(0)]);

  const blobs = parts.map(([t, d]) => chunkBytes(t, d)),
    bytes = new Uint8Array(8 + blobs.reduce((a, b) => a + b.length, 0)),
    chunks: ChunkInfo[] = [];
  bytes.set(PNG_SIGNATURE);
  let o = 8;
  blobs.forEach((b, i) => {
    bytes.set(b, o);
    const crc = new DataView(b.buffer).getUint32(b.length - 4),
      type = parts[i][0];
    chunks.push({
      type,
      offset: o,
      length: b.length - 12,
      crc,
      crcCalc: crc,
      crcOk: true,
      critical: type !== 'tRNS',
      known: true,
    });
    o += b.length;
  });

  return {
    ok: true,
    bytes,
    chunks,
    layout: L,
    palette: s.palette,
    trns: s.trns,
    raw,
    filtered,
    filterTypes,
    filterSums,
    zlib: z,
    loss: lossOf(rgba, n, ct, depth, s),
  };
}

/** 復号すると入力と変わる画素を数える */
function lossOf(
  rgba: ArrayLike<number>,
  n: number,
  ct: ColorType,
  depth: number,
  s: Samples,
): { color: number; alpha: number } {
  const ch = CHANNELS[ct],
    px = new Uint8ClampedArray(4);
  let color = 0,
    alpha = 0;
  const key = s.trns && (ct === 0 || ct === 2) ? (ct === 0 ? [s.trns[1]] : [s.trns[1], s.trns[3], s.trns[5]]) : null;
  for (let i = 0; i < n; i++) {
    samplesToRgba(s.samp, i * ch, ct, depth, s.palette, s.trns, key, px);
    const a0 = rgba[i * 4 + 3];
    if (px[3] !== a0) alpha++;
    if ((a0 || px[3]) && (px[0] !== rgba[i * 4] || px[1] !== rgba[i * 4 + 1] || px[2] !== rgba[i * 4 + 2])) color++;
  }
  return { color, alpha };
}

/** 1 画素の標本を RGBA 8 ビットにする。key は tRNS の透明な色（グレー・RGB の標本値） */
function samplesToRgba(
  v: ArrayLike<number>,
  o: number,
  ct: ColorType,
  depth: number,
  palette: Uint8Array | null,
  trns: Uint8Array | null,
  key: number[] | null,
  out: Uint8ClampedArray,
  oo = 0,
): boolean {
  if (ct === 3) {
    const k = v[o];
    if (!palette || k * 3 >= palette.length) {
      out[oo] = out[oo + 1] = out[oo + 2] = 0;
      out[oo + 3] = 255;
      return false;
    }
    out[oo] = palette[k * 3];
    out[oo + 1] = palette[k * 3 + 1];
    out[oo + 2] = palette[k * 3 + 2];
    out[oo + 3] = trns && k < trns.length ? trns[k] : 255;
    return true;
  }
  if (ct === 0 || ct === 4) {
    const g = to8(v[o], depth);
    out[oo] = out[oo + 1] = out[oo + 2] = g;
    out[oo + 3] = ct === 4 ? to8(v[o + 1], depth) : key && v[o] === key[0] ? 0 : 255;
    return true;
  }
  out[oo] = to8(v[o], depth);
  out[oo + 1] = to8(v[o + 1], depth);
  out[oo + 2] = to8(v[o + 2], depth);
  out[oo + 3] =
    ct === 6 ? to8(v[o + 3], depth) : key && v[o] === key[0] && v[o + 1] === key[1] && v[o + 2] === key[2] ? 0 : 255;
  return true;
}

/** 標本を 8 ビットにする（16 ビットは上位バイト、8 未満は 255/(2^深度 − 1) 倍で割り切れる） */
const to8 = (x: number, depth: number): number =>
  depth === 8 ? x : depth === 16 ? x >> 8 : (x * 255) / ((1 << depth) - 1);

/**
 * IDAT をつないだ列（zlib のストリーム）の位置 pos を、ファイルの中のバイト位置にする。範囲の外なら -1。
 * Deflate の記録のビット位置 bit は zlib の 2 バイトの頭の後から数えるので、pos = 2 + (bit >> 3)
 */
export function idatToFile(chunks: readonly ChunkInfo[], pos: number): number {
  let o = 0;
  for (const c of chunks) {
    if (c.type !== 'IDAT') continue;
    if (pos < o + c.length) return pos < o ? -1 : c.offset + 8 + (pos - o);
    o += c.length;
  }
  return -1;
}

/* ---------------- 復号 ---------------- */

export type PngReason =
  | 'signature'
  | 'truncated'
  | 'chunk-length'
  | 'chunk-type'
  | 'crc'
  | 'no-ihdr'
  | 'ihdr'
  | 'too-large'
  | 'order'
  | 'plte'
  | 'no-plte'
  | 'trns'
  | 'unknown-critical'
  | 'no-idat'
  | 'zlib'
  | 'adler'
  | 'short-data'
  | 'extra-data'
  | 'filter'
  | 'palette-index'
  | 'no-iend'
  | 'after-iend';

const PNG_MESSAGES: Record<PngReason, string> = {
  signature: '署名が PNG のものでない',
  truncated: 'チャンクが途中で切れている',
  'chunk-length': 'チャンクの長さが大きすぎる',
  'chunk-type': 'チャンクの種類が英字 4 文字でない',
  crc: 'CRC が合わない',
  'no-ihdr': '最初のチャンクが IHDR でない',
  ihdr: 'IHDR の値が正しくない',
  'too-large': '画素の数が上限を超えている',
  order: 'チャンクの順序が正しくない',
  plte: 'PLTE が正しくない',
  'no-plte': 'パレットの画像に PLTE がない',
  trns: 'tRNS が正しくない（読み飛ばす）',
  'unknown-critical': '知らない必須チャンク',
  'no-idat': 'IDAT がない',
  zlib: '圧縮データが壊れている',
  adler: 'Adler-32 が合わない',
  'short-data': '圧縮データを戻した長さが画像に足りない',
  'extra-data': '圧縮データが画像より長い（余りは捨てる）',
  filter: 'フィルタの種類が 5 以上',
  'palette-index': 'パレットにない番号',
  'no-iend': 'IEND がない',
  'after-iend': 'IEND の後にデータがある',
};

/** 復号で見つけた問題。fatal でないものは既定のモードでも止まらない */
export interface PngIssue {
  reason: PngReason;
  message: string;
  /** ファイルの中のバイト位置（分からなければ -1） */
  offset: number;
  /** 関わるチャンクの番号（なければ -1） */
  chunk: number;
  fatal: boolean;
  /** zlib の誤り（reason が 'zlib' のとき） */
  inflate?: InflateError;
}

export class PngError extends Error {
  constructor(readonly issue: PngIssue) {
    super(`${issue.message}${issue.offset >= 0 ? `（${issue.offset} バイト目）` : ''}`);
    this.name = 'PngError';
  }
  get reason(): PngReason {
    return this.issue.reason;
  }
}

export interface PngDecodeOptions {
  /** CRC の不一致を問題にしない（一覧の crcOk には出る） */
  ignoreCrc?: boolean;
  /** 壊れた所で throw せず、戻せた所までを返す */
  tolerant?: boolean;
  /** Deflate の記録を取るか（既定 true） */
  trace?: boolean;
  /** 画素の数の上限。超えるなら IHDR を読んだ所で止め、画素のメモリを取らない */
  maxPixels?: number;
}

export interface PngDecoded {
  width: number;
  height: number;
  bitDepth: number;
  colorType: ColorType;
  interlace: boolean;
  /** RGBA 8 ビット。戻せなかった画素は (0, 0, 0, 0) */
  rgba: Uint8ClampedArray;
  chunks: ChunkInfo[];
  palette: Uint8Array | null;
  trns: Uint8Array | null;
  layout: Layout | null;
  /** IDAT をつないだもの */
  idat: Uint8Array;
  zlib: ZlibDecoded | null;
  /** zlib を戻した列（フィルタ後の行の並び）と、フィルタを外した列 */
  filtered: Uint8Array;
  raw: Uint8Array;
  /** 各行（ストリームの順）のフィルタの種類。読めなかった行は 255 */
  filterTypes: Uint8Array;
  /** 最後まで戻せた行の数（ストリームの順。Adam7 ではパスをまたいで数える） */
  rows: number;
  /** すべての行を問題なく戻せたか */
  complete: boolean;
  issues: PngIssue[];
  /** 最初の致命的な問題（寛容モードで止まった所。なければ null） */
  error: PngIssue | null;
}

const isLetter = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);

/** PNG を RGBA 8 ビットに戻す。既定では致命的な問題で PngError を投げ、tolerant なら戻せた所までを返す */
export function decodePng(src: Uint8Array, opts: PngDecodeOptions = {}): PngDecoded {
  const issues: PngIssue[] = [],
    tolerant = opts.tolerant ?? false;
  let error: PngIssue | null = null;
  const report = (reason: PngReason, fatal: boolean, offset = -1, chunk = -1, inflate?: InflateError): void => {
    const issue: PngIssue = { reason, message: PNG_MESSAGES[reason], offset, chunk, fatal };
    if (inflate) {
      issue.inflate = inflate;
      issue.message = `${issue.message}: ${inflate.message}`;
    }
    issues.push(issue);
    if (!fatal) return;
    if (!tolerant) throw new PngError(issue);
    error ??= issue;
  };
  const res: PngDecoded = {
    width: 0,
    height: 0,
    bitDepth: 0,
    colorType: 0,
    interlace: false,
    rgba: new Uint8ClampedArray(0),
    chunks: [],
    palette: null,
    trns: null,
    layout: null,
    idat: new Uint8Array(0),
    zlib: null,
    filtered: new Uint8Array(0),
    raw: new Uint8Array(0),
    filterTypes: new Uint8Array(0),
    rows: 0,
    complete: false,
    issues,
    error: null,
  };

  for (let i = 0; i < 8; i++)
    if (src[i] !== PNG_SIGNATURE[i]) {
      report('signature', true, i);
      break;
    }

  /* チャンクを読む（5.3） */
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength),
    idats: Uint8Array[] = [];
  let p = 8,
    ihdr: Uint8Array | null = null,
    plte: Uint8Array | null = null,
    trns: Uint8Array | null = null,
    seenIdat = false,
    idatEnded = false,
    iend = false;
  while (p < src.length) {
    const ci = res.chunks.length;
    if (iend) {
      report('after-iend', false, p);
      break;
    }
    if (p + 8 > src.length) {
      report('truncated', true, p, ci);
      break;
    }
    const len = dv.getUint32(p),
      tb = src.subarray(p + 4, p + 8),
      type = String.fromCharCode(...tb);
    if (len > 0x7fffffff) {
      report('chunk-length', true, p, ci);
      break;
    }
    const dEnd = Math.min(src.length, p + 8 + len),
      data = src.subarray(p + 8, dEnd),
      cut = p + 12 + len > src.length,
      crc = cut ? 0 : dv.getUint32(p + 8 + len),
      crcCalc = crc32Update(crc32(tb), data),
      info: ChunkInfo = {
        type,
        offset: p,
        length: len,
        crc,
        crcCalc,
        crcOk: !cut && crc === crcCalc,
        critical: (tb[0] & 0x20) === 0,
        known: KNOWN.has(type),
      };
    res.chunks.push(info);
    if (cut) report('truncated', true, p, ci);
    else if (!info.crcOk) report('crc', !opts.ignoreCrc, p, ci);
    p += 12 + len;
    if (!tb.every(isLetter)) {
      report('chunk-type', true, info.offset, ci);
      continue;
    }
    if (type !== 'IDAT' && seenIdat) idatEnded = true;
    if (ci === 0 && type !== 'IHDR') report('no-ihdr', true, info.offset, ci);
    switch (type) {
      case 'IHDR':
        if (ihdr) report('order', true, info.offset, ci);
        else if (len !== 13) report('ihdr', true, info.offset, ci);
        else ihdr = data;
        break;
      case 'PLTE':
        if (plte || seenIdat) report('order', true, info.offset, ci);
        else plte = data;
        break;
      case 'tRNS':
        if (seenIdat) report('order', false, info.offset, ci);
        else trns = data;
        break;
      case 'IDAT':
        if (idatEnded) report('order', true, info.offset, ci);
        seenIdat = true;
        idats.push(data);
        break;
      case 'IEND':
        iend = true;
        break;
      default:
        if (info.critical) report('unknown-critical', true, info.offset, ci);
    }
    if (cut) break;
  }
  if (!iend) report('no-iend', false);
  res.error = error;

  /* IHDR（11.2.2） */
  if (!ihdr) {
    report('no-ihdr', true);
    res.error = error;
    return res;
  }
  const hv = new DataView(ihdr.buffer, ihdr.byteOffset, 13),
    width = hv.getUint32(0),
    height = hv.getUint32(4),
    depth = ihdr[8],
    ct = ihdr[9] as ColorType,
    il = ihdr[12];
  const ihdrAt = res.chunks.find((c) => c.type === 'IHDR')?.offset ?? -1;
  if (
    !(width > 0 && height > 0 && width < 2 ** 31 && height < 2 ** 31) ||
    !DEPTHS[ct]?.includes(depth) ||
    ihdr[10] !== 0 ||
    ihdr[11] !== 0 ||
    il > 1
  ) {
    report('ihdr', true, ihdrAt);
    res.error = error;
    return res;
  }
  Object.assign(res, { width, height, bitDepth: depth, colorType: ct, interlace: il === 1 });
  if (opts.maxPixels !== undefined && width * height > opts.maxPixels) {
    report('too-large', true, ihdrAt);
    res.error = error;
    return res;
  }

  /* PLTE と tRNS（11.2.3・11.3.2.1） */
  if (plte) {
    const pAt = res.chunks.find((c) => c.type === 'PLTE')?.offset ?? -1;
    if (ct === 0 || ct === 4 || plte.length % 3 !== 0 || plte.length === 0 || plte.length / 3 > 256) {
      report('plte', true, pAt);
      plte = null;
    } else if (ct === 3 && plte.length / 3 > 1 << depth) report('plte', true, pAt);
  }
  if (ct === 3 && !plte) report('no-plte', true);
  if (trns) {
    const tAt = res.chunks.find((c) => c.type === 'tRNS')?.offset ?? -1,
      ok =
        ct === 0
          ? trns.length === 2
          : ct === 2
            ? trns.length === 6
            : ct === 3
              ? trns.length <= (plte?.length ?? 0) / 3
              : false;
    if (!ok) {
      report('trns', false, tAt);
      trns = null;
    }
  }
  res.palette = plte;
  res.trns = trns;
  if (!idats.length) {
    report('no-idat', true);
    res.error = error;
    return res;
  }

  /* IDAT をつないで zlib を戻す */
  const L = pngLayout(width, height, ct, depth, il === 1),
    total = idats.reduce((a, d) => a + d.length, 0),
    idat = new Uint8Array(total);
  let o = 0;
  for (const d of idats) {
    idat.set(d, o);
    o += d.length;
  }
  res.layout = L;
  res.idat = idat;
  const zopts: InflateOptions = { tolerant: true, trace: opts.trace ?? true, maxOut: L.filteredSize };
  const z = zlibDecompress(idat, zopts);
  res.zlib = z;
  const filtered = z.data;
  res.filtered = filtered;
  const full = filtered.length >= L.filteredSize;
  if (z.error) {
    if (z.error.reason === 'out-limit') report('extra-data', false);
    else report('zlib', !full, -1, -1, z.error);
  } else if (!z.adlerOk) report('adler', false);
  if (!full && !z.error) report('short-data', true);

  /* フィルタを外す */
  const raw = new Uint8Array(L.rawSize),
    filterTypes = new Uint8Array(L.rows).fill(255),
    rgba = new Uint8ClampedArray(width * height * 4);
  res.raw = raw;
  res.filterTypes = filterTypes;
  res.rgba = rgba;
  let rows = 0,
    badIndex = false;
  const key = trns && (ct === 0 || ct === 2) ? sampleKey(trns, ct) : null,
    v = new Uint16Array(L.channels);
  for (const ps of L.passes) {
    const part = filtered.subarray(
        ps.filteredOffset,
        Math.min(filtered.length, ps.filteredOffset + ps.h * (ps.rowBytes + 1)),
      ),
      u = unfilterImage(part, ps.rowBytes, ps.h, L.bpp);
    raw.set(u.raw, ps.rawOffset);
    filterTypes.set(u.types, ps.rowStart);
    rows += u.rows;
    /* 画素にする（途中の行は読めた画素まで） */
    const lastRow = u.rows + (u.partial ? 1 : 0);
    for (let py = 0; py < lastRow; py++) {
      const nPix = py < u.rows ? ps.w : Math.floor((u.partial * 8) / L.bitsPerPixel),
        r0 = ps.rawOffset + py * ps.rowBytes,
        y = ps.y0 + py * ps.dy;
      for (let px = 0; px < nPix; px++) {
        readPixel(raw, r0, px, L.channels, depth, v);
        if (!samplesToRgba(v, 0, ct, depth, plte, trns, key, rgba, (y * width + ps.x0 + px * ps.dx) * 4))
          badIndex = true;
      }
    }
    if (u.badRow >= 0) {
      report('filter', true, -1);
      break;
    }
    if (u.rows < ps.h) break;
  }
  if (badIndex) report('palette-index', true);
  res.rows = rows;
  res.complete = rows === L.rows && !error;
  res.error = error;
  return res;
}

/** tRNS のグレー・RGB の透明な色（16 ビットの標本値。深度が 16 未満なら下位のビットだけが意味を持つ） */
function sampleKey(trns: Uint8Array, ct: ColorType): number[] {
  const g = (i: number) => (trns[i] << 8) | trns[i + 1];
  return ct === 0 ? [g(0)] : [g(0), g(2), g(4)];
}

/** 行 r0 の px 番目の画素の標本を v に読む */
function readPixel(raw: Uint8Array, r0: number, px: number, ch: number, depth: number, v: Uint16Array): void {
  if (depth === 8) {
    for (let c = 0; c < ch; c++) v[c] = raw[r0 + px * ch + c];
    return;
  }
  if (depth === 16) {
    for (let c = 0; c < ch; c++) {
      const i = r0 + (px * ch + c) * 2;
      v[c] = (raw[i] << 8) | raw[i + 1];
    }
    return;
  }
  const m = (1 << depth) - 1;
  for (let c = 0; c < ch; c++) {
    const b = (px * ch + c) * depth;
    v[c] = (raw[r0 + (b >> 3)] >> (8 - depth - (b & 7))) & m;
  }
}
