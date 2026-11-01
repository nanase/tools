/**
 * 同じ画像を 3 形式に符号化し、壊れたバイト列を止まらない自前の復号器で戻す。
 * 読めなかった画素は透明（α 0）にする
 */
import { deinterlace, encodeGif, parseGif } from '../gif/gif';
import { decodeLzw, type LzwStop } from '../gif/lzw';
import { quantize } from '../gif/quant';
import { decode as decodeJpeg, type JpegReason } from '../jpeg/decoder';
import { encode as encodeJpeg } from '../jpeg/encoder';
import type { FilterMode } from '../png/filter';
import { decodePng, encodePng, type PngReason } from '../png/png';

export type Fmt = 'png' | 'jpeg' | 'gif';
export const FMTS: readonly Fmt[] = ['png', 'jpeg', 'gif'];

/** 自前の復号器が開ける画素の数の上限（壊れた大きさの値でタブが固まらないように） */
export const MAX_PIXELS = 4194304;

export interface Source {
  w: number;
  h: number;
  rgba: Uint8ClampedArray;
}

export interface EncodeOpts {
  /** PNG のフィルタ */
  filter: FilterMode;
  /** PNG の圧縮レベル（0 は圧縮なし） */
  level: number;
  /** JPEG の品質 */
  q: number;
  /** JPEG のリスタートの間隔 [MCU]（0 はなし） */
  dri: number;
  /** GIF のインターレース */
  interlace: boolean;
}
export const ENCODE_DEFAULTS: EncodeOpts = { filter: 'adaptive', level: 6, q: 75, dri: 0, interlace: false };

/** ファイルの中の 1 区画 */
export interface Part {
  name: string;
  start: number;
  end: number;
  /** 画素のデータの区画か */
  data: boolean;
}

export interface Encoded {
  fmt: Fmt;
  bytes: Uint8Array;
  parts: Part[];
}

/** PNG の区画（チャンクごと） */
export function pngParts(bytes: Uint8Array): Part[] {
  const d = decodePng(bytes, { tolerant: true, ignoreCrc: true, trace: false, maxPixels: MAX_PIXELS }),
    parts: Part[] = [{ name: '署名', start: 0, end: 8, data: false }];
  for (const c of d.chunks) {
    const last = parts[parts.length - 1],
      end = c.offset + 12 + c.length;
    /* IDAT は 1 つにまとめる */
    if (c.type === 'IDAT' && last.name === 'IDAT') last.end = end;
    else parts.push({ name: c.type, start: c.offset, end, data: c.type === 'IDAT' });
  }
  return parts;
}

/** JPEG の区画（マーカーごと） */
export function jpegParts(segs: readonly { name: string; off: number; len: number }[]): Part[] {
  return segs.map((s) => ({ name: s.name, start: s.off, end: s.off + s.len, data: s.name === 'ECS' }));
}

/** GIF の区画（parseGif の区画を画面の名前に） */
export function gifParts(bytes: Uint8Array): Part[] {
  const g = parseGif(bytes, { lenient: true }),
    names: Record<string, string> = {
      header: 'ヘッダ',
      lsd: '画面',
      gct: '色表',
      gce: '制御',
      app: '拡張',
      comment: '拡張',
      text: '拡張',
      ext: '拡張',
      desc: '画像',
      lct: '色表',
      mincode: '符号長',
      data: 'LZW',
      trailer: '終端',
      junk: '不明',
    };
  return (g?.blocks ?? []).map((b) => ({
    name: names[b.kind] ?? b.kind,
    start: b.start,
    end: b.end,
    data: b.kind === 'data',
  }));
}

/** 同じ画像を符号化する。GIF は 256 色に減色する */
export function encodeAs(fmt: Fmt, s: Source, o: EncodeOpts = ENCODE_DEFAULTS): Encoded {
  if (fmt === 'png') {
    const e = encodePng(s.rgba, s.w, s.h, { colorType: 2, filter: o.filter, level: o.level, trace: false });
    if (!e.ok) throw new Error('PNG に符号化できません');
    return { fmt, bytes: e.bytes, parts: pngParts(e.bytes) };
  }
  if (fmt === 'jpeg') {
    const e = encodeJpeg(s.rgba, s.w, s.h, { q: o.q, sub: '420', qt: 'k', huff: 'std', dri: o.dri });
    return { fmt, bytes: e.bytes, parts: jpegParts(e.segs) };
  }
  const q = quantize(s.rgba, s.w, s.h, { colors: 256, dither: false }),
    e = encodeGif({
      w: s.w,
      h: s.h,
      gct: q.pal,
      bg: 0,
      loop: null,
      frames: [
        {
          x: 0,
          y: 0,
          w: s.w,
          h: s.h,
          idx: q.idx,
          disposal: 0,
          delay: 0,
          transparent: q.transparent,
          interlace: o.interlace,
        },
      ],
    });
  return { fmt, bytes: e.bytes, parts: gifParts(e.bytes) };
}

/** 復号の結果 */
export interface Decoded {
  w: number;
  h: number;
  /** 読めなかった画素は α 0 */
  rgba: Uint8ClampedArray;
  /** 読めた画素の割合（0〜1） */
  coverage: number;
  /** 検査値（PNG の CRC・Adler-32）が合わない */
  sumBad: boolean;
  /** 読みながら見つけた問題の短い名前（重なりなし） */
  issues: string[];
}

const PNG_NAMES: Partial<Record<PngReason, string>> = {
  signature: '署名の不一致',
  truncated: 'チャンクの途切れ',
  'chunk-length': 'チャンクの長さの不正',
  'chunk-type': 'チャンクの種類の不正',
  crc: 'CRC の不一致',
  'no-ihdr': 'IHDR なし',
  ihdr: 'IHDR の値の不正',
  'too-large': '大きさの上限超え',
  plte: 'PLTE の不正',
  'no-plte': 'PLTE なし',
  'no-idat': 'IDAT なし',
  zlib: 'Deflate の破損',
  adler: 'Adler-32 の不一致',
  'short-data': 'データ不足',
  filter: 'フィルタ番号の不正',
  'palette-index': '色番号の範囲外',
  'no-iend': 'IEND なし',
};
const JPEG_NAMES: Record<JpegReason, string> = {
  soi: 'SOI なし',
  'too-large': '大きさの上限超え',
  sof: 'SOF の値の不正',
  'no-sof': 'SOF なし',
  'no-sos': 'SOS なし',
  'not-baseline': 'SOF の種類の違い',
  'sos-comp': 'SOS の成分の不一致',
  'no-dqt': 'DQT なし',
  'no-dht': 'DHT なし',
  'bad-code': '読めない符号',
  'bad-run': '範囲外の係数',
  'stray-marker': '余分なマーカー',
  'rst-order': 'RST の番号飛び',
  'short-scan': 'データ不足',
};
const GIF_STOPS: Partial<Record<LzwStop, string>> = {
  end: 'データ不足',
  'bad-min': '最小符号長の不正',
};

const uniq = (a: string[]): string[] => [...new Set(a)];

function decodePngLax(b: Uint8Array): Decoded {
  const d = decodePng(b, { tolerant: true, ignoreCrc: true, trace: false, maxPixels: MAX_PIXELS, keepGoing: true }),
    n = d.width * d.height;
  let seen = 0;
  for (let i = 3; i < d.rgba.length; i += 4) if (d.rgba[i]) seen++;
  return {
    w: d.rgba.length ? d.width : 0,
    h: d.rgba.length ? d.height : 0,
    rgba: d.rgba,
    coverage: n && d.rgba.length ? seen / n : 0,
    sumBad: d.issues.some((i) => i.reason === 'crc' || i.reason === 'adler'),
    issues: uniq(d.issues.flatMap((i) => PNG_NAMES[i.reason] ?? [])),
  };
}

function decodeJpegLax(b: Uint8Array): Decoded {
  const d = decodeJpeg(b, 'lin', { tolerant: true, maxPixels: MAX_PIXELS });
  return {
    w: d.rgba.length ? d.w : 0,
    h: d.rgba.length ? d.h : 0,
    rgba: d.rgba,
    coverage: d.coverage,
    sumBad: false,
    issues: uniq(d.issues.map((i) => JPEG_NAMES[i.reason])),
  };
}

/** 色表がないときの代わり（番号をそのまま灰色に） */
const GRAY = Uint8Array.from({ length: 768 }, (_, i) => Math.floor(i / 3));

function decodeGifLax(b: Uint8Array): Decoded {
  const none: Decoded = { w: 0, h: 0, rgba: new Uint8ClampedArray(0), coverage: 0, sumBad: false, issues: [] };
  const g = parseGif(b, { lenient: true });
  if (!g) return { ...none, issues: ['長さ不足'] };
  const issues: string[] = [],
    f = g.frames[0];
  if (!/^GIF8[79]a$/.test(g.version)) issues.push('署名の不一致');
  if (g.brokenAt >= 0) issues.push('区画の並びの乱れ');
  if (!f) return { ...none, issues: uniq([...issues, '画像の区画なし']) };
  const W = Math.max(g.w, f.x + f.w),
    H = Math.max(g.h, f.y + f.h);
  if (!f.w || !f.h || !W || !H) return { ...none, issues: uniq([...issues, '大きさ 0']) };
  if (W * H > MAX_PIXELS || f.w * f.h > MAX_PIXELS) return { ...none, issues: uniq([...issues, '大きさの上限超え']) };
  const pal = f.lct ?? g.gct ?? GRAY;
  if (!f.lct && !g.gct) issues.push('色表なし');
  const lz = decodeLzw(f.data, f.minCode, f.w * f.h, { keepGoing: true }),
    idx = f.interlace ? deinterlace(lz.out, f.w, f.h) : lz.out,
    rgba = new Uint8ClampedArray(W * H * 4);
  if (lz.bad) issues.push('辞書にない符号');
  const stop = GIF_STOPS[lz.stop];
  if (stop) issues.push(stop);
  /* 読めた分だけ塗る（インターレースは読んだ順の行に戻す） */
  const seen = new Uint8Array(f.w * f.h);
  seen.fill(1, 0, lz.n);
  const vis = f.interlace ? deinterlace(seen, f.w, f.h) : seen;
  const t = f.transparent,
    nc = pal.length / 3;
  let reached = 0;
  for (let y = 0; y < f.h; y++)
    for (let x = 0; x < f.w; x++) {
      const k = y * f.w + x;
      if (!vis[k]) continue;
      reached++;
      const v = idx[k],
        o = ((y + f.y) * W + x + f.x) * 4;
      if (v === t) continue;
      const c = v < nc ? v : 0;
      rgba[o] = pal[c * 3];
      rgba[o + 1] = pal[c * 3 + 1];
      rgba[o + 2] = pal[c * 3 + 2];
      rgba[o + 3] = 255;
    }
  return { w: W, h: H, rgba, coverage: reached / (W * H), sumBad: false, issues: uniq(issues) };
}

/** 壊れていても止まらずに戻す */
export function decodeLax(fmt: Fmt, b: Uint8Array): Decoded {
  try {
    return fmt === 'png' ? decodePngLax(b) : fmt === 'jpeg' ? decodeJpegLax(b) : decodeGifLax(b);
  } catch {
    /* 想定していない壊れ方でも画面を止めない */
    return { w: 0, h: 0, rgba: new Uint8ClampedArray(0), coverage: 0, sumBad: false, issues: ['読み取り不能'] };
  }
}

/** 崩れたとみなす、元との色の差（8 ビット）。JPEG の丸めの違いを数えないため */
export const DIFF_MIN = 16;

/** 元の復号との比較。崩れた画素の割合（0〜1）と、走査の順で最初に崩れた行 */
export function damage(a: Decoded, b: Decoded): { ratio: number; firstRow: number } {
  const W = Math.max(a.w, b.w),
    H = Math.max(a.h, b.h);
  if (!W || !H) return { ratio: 1, firstRow: 0 };
  let n = 0,
    first = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const ia = x < a.w && y < a.h ? (y * a.w + x) * 4 : -1,
        ib = x < b.w && y < b.h ? (y * b.w + x) * 4 : -1;
      let bad = ia < 0 || ib < 0 || (a.rgba[ia + 3] !== 0) !== (b.rgba[ib + 3] !== 0);
      if (!bad && a.rgba[ia + 3])
        bad =
          Math.abs(a.rgba[ia] - b.rgba[ib]) >= DIFF_MIN ||
          Math.abs(a.rgba[ia + 1] - b.rgba[ib + 1]) >= DIFF_MIN ||
          Math.abs(a.rgba[ia + 2] - b.rgba[ib + 2]) >= DIFF_MIN;
      if (bad) {
        n++;
        if (first < 0) first = y;
      }
    }
  return { ratio: n / (W * H), firstRow: first };
}
