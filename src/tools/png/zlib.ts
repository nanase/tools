/**
 * zlib の包み（RFC 1950）: 頭の 2 バイト（CMF・FLG）、Deflate のデータ、末尾の Adler-32（上位バイトから）
 */
import { adler32 } from './adler32';
import { type DeflateOptions, type DeflateResult, deflate } from './deflate';
import { InflateError, type InflateOptions, type InflateResult, inflate } from './inflate';

/** zlib の頭（2.2） */
export interface ZlibHeader {
  cmf: number;
  flg: number;
  /** 圧縮方式（8 が Deflate） */
  cm: number;
  /** 窓の大きさ log2(窓) − 8 */
  cinfo: number;
  /** 辞書つきか */
  fdict: boolean;
  /** 圧縮レベルの目安 0〜3 */
  flevel: number;
  /** (CMF·256 + FLG) が 31 で割り切れるか */
  checkOk: boolean;
}

/** 頭を読む */
export function parseZlibHeader(cmf: number, flg: number): ZlibHeader {
  return {
    cmf,
    flg,
    cm: cmf & 15,
    cinfo: cmf >> 4,
    fdict: (flg & 0x20) !== 0,
    flevel: flg >> 6,
    checkOk: (cmf * 256 + flg) % 31 === 0,
  };
}

/** zlib の deflateInit と同じ FLEVEL（level 0・1 は 0、2〜5 は 1、6 は 2、7〜9 は 3） */
export const flevelOf = (level: number): number => (level < 2 ? 0 : level < 6 ? 1 : level === 6 ? 2 : 3);

export interface ZlibEncoded {
  /** zlib のストリーム全体 */
  bytes: Uint8Array;
  header: ZlibHeader;
  adler: number;
  /** 中の Deflate（記録のビット位置は bytes の 2 バイト目の後から数える） */
  deflate: DeflateResult;
}

/** data を zlib で包んで符号化する */
export function zlibCompress(data: Uint8Array, opts: DeflateOptions = {}): ZlibEncoded {
  const d = deflate(data, opts),
    cmf = 0x78,
    fl = flevelOf(opts.level ?? 6) << 6,
    flg = fl + (31 - ((cmf * 256 + fl) % 31)),
    adler = adler32(data),
    bytes = new Uint8Array(d.data.length + 6);
  bytes[0] = cmf;
  bytes[1] = flg;
  bytes.set(d.data, 2);
  const e = d.data.length + 2;
  bytes[e] = adler >>> 24;
  bytes[e + 1] = (adler >>> 16) & 0xff;
  bytes[e + 2] = (adler >>> 8) & 0xff;
  bytes[e + 3] = adler & 0xff;
  return { bytes, header: parseZlibHeader(cmf, flg), adler, deflate: d };
}

export interface ZlibDecoded {
  data: Uint8Array;
  header: ZlibHeader | null;
  /** 末尾に書かれた Adler-32（足りなければ null）と、戻したデータの Adler-32 */
  adlerStored: number | null;
  adlerActual: number;
  /** 一致したか（書かれていなければ false） */
  adlerOk: boolean;
  /** ストリームの終わり（Adler-32 の後）のバイト位置。後ろに余りがあればその分だけ短い */
  end: number;
  /** 中の Deflate（ビット位置は 2 バイト目の後から。辞書つきなら DICTID の後から） */
  inflate: InflateResult;
  /**
   * 寛容モードで止まった理由。頭の誤りは bit を -16 とする（Deflate の先頭の 16 ビット前に頭がある）。
   * Adler-32 の不一致は誤りとしない
   */
  error: InflateError | null;
}

/** zlib のストリームを戻す。Adler-32 が合わなくても中身は返す（adlerOk で分かる） */
export function zlibDecompress(src: Uint8Array, opts: InflateOptions = {}): ZlibDecoded {
  let error: InflateError | null = null;
  const fail = (reason: InflateError['reason'], bit = -16): void => {
    const e = new InflateError(reason, bit);
    if (!opts.tolerant) throw e;
    error ??= e;
  };
  let header: ZlibHeader | null = null;
  if (src.length < 2) fail('eof');
  else {
    header = parseZlibHeader(src[0], src[1]);
    if (!header.checkOk) fail('zlib-check');
    if (header.cm !== 8) fail('zlib-method');
    else if (header.cinfo > 7) fail('zlib-window');
    if (header.fdict) fail('zlib-dict');
  }
  /* 辞書つきなら DICTID の 4 バイトを飛ばして読んでみる */
  const skip = header?.fdict ? 6 : 2,
    body = src.subarray(Math.min(src.length, skip)),
    inf = inflate(body, opts);
  error ??= inf.error;
  const p = skip + ((inf.bits + 7) >> 3),
    adlerActual = adler32(inf.data);
  let adlerStored: number | null = null;
  if (inf.done && p + 4 <= src.length) {
    adlerStored = ((src[p] << 24) | (src[p + 1] << 16) | (src[p + 2] << 8) | src[p + 3]) >>> 0;
  } else if (inf.done) fail('eof', inf.bits);
  return {
    data: inf.data,
    header,
    adlerStored,
    adlerActual,
    adlerOk: adlerStored === adlerActual,
    end: Math.min(src.length, p + 4),
    inflate: inf,
    error,
  };
}
