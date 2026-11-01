/**
 * GIF89a の組み立てと読み取り。読み取りは壊れたファイルでも例外を投げず、読めた所まで返す。
 * 仕様は https://www.w3.org/Graphics/GIF/spec-gif89a.txt
 */
import { decodeLzw, encodeLzw, type LzwDecoded, type LzwEncoded } from './lzw';

/** インターレースのパス [始めの行, 間隔] */
export const PASSES: readonly (readonly [number, number])[] = [
  [0, 8],
  [4, 8],
  [2, 4],
  [1, 2],
];

/** 送る順の行番号 */
export function interlaceRows(h: number): number[] {
  const r: number[] = [];
  for (const [s, d] of PASSES) for (let y = s; y < h; y += d) r.push(y);
  return r;
}

/** 行の上から順の画素を、送る順に並べ替える */
export function interlace(idx: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(idx.length);
  interlaceRows(h).forEach((y, i) => {
    out.set(idx.subarray(y * w, (y + 1) * w), i * w);
  });
  return out;
}

/** 送る順の画素を、行の上から順に戻す */
export function deinterlace(idx: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(idx.length);
  interlaceRows(h).forEach((y, i) => {
    out.set(idx.subarray(i * w, (i + 1) * w), y * w);
  });
  return out;
}

/** 組み立てる 1 フレーム */
export interface FrameSpec {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 行の上から順の画素の値 */
  idx: Uint8Array;
  /** ローカルカラーテーブル（RGB を並べたもの） */
  lct?: Uint8Array;
  /** 0 指定なし・1 残す・2 背景に戻す・3 前の状態に戻す */
  disposal: number;
  /** 表示の時間 [1/100 秒] */
  delay: number;
  /** 透過色の番号（なければ −1） */
  transparent: number;
  interlace: boolean;
}

export interface GifSpec {
  w: number;
  h: number;
  /** グローバルカラーテーブル（RGB を並べたもの） */
  gct: Uint8Array | null;
  bg: number;
  /** 繰り返し（0 は無限、null は NETSCAPE の拡張なし） */
  loop: number | null;
  comment?: string;
  frames: readonly FrameSpec[];
}

const log2ceil = (n: number): number => {
  let k = 0;
  while (1 << k < n) k++;
  return k;
};
/** 色数からカラーテーブルの大きさの値（実際の色数は 2^(k+1)） */
const tableBits = (colors: number): number => Math.max(1, log2ceil(colors)) - 1;

class Out {
  private b = new Uint8Array(4096);
  n = 0;
  private room(k: number): void {
    if (this.n + k <= this.b.length) return;
    const c = new Uint8Array(Math.max(this.b.length * 2, this.n + k));
    c.set(this.b.subarray(0, this.n));
    this.b = c;
  }
  u8(...v: number[]): void {
    this.room(v.length);
    for (const x of v) this.b[this.n++] = x;
  }
  u16(v: number): void {
    this.u8(v & 255, (v >> 8) & 255);
  }
  bytes(v: Uint8Array): void {
    this.room(v.length);
    this.b.set(v, this.n);
    this.n += v.length;
  }
  ascii(s: string): void {
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i) & 255);
  }
  /** カラーテーブルは 2 のべき乗の色数に 0 で埋める */
  table(p: Uint8Array): void {
    const n = 1 << (tableBits(p.length / 3) + 1);
    this.bytes(p);
    this.bytes(new Uint8Array(n * 3 - p.length));
  }
  /** 255 バイトずつのサブブロック（最後に長さ 0） */
  blocks(d: Uint8Array): void {
    for (let i = 0; i < d.length; i += 255) {
      const k = Math.min(255, d.length - i);
      this.u8(k);
      this.bytes(d.subarray(i, i + k));
    }
    this.u8(0);
  }
  done(): Uint8Array {
    return this.b.slice(0, this.n);
  }
}

export interface Encoded {
  bytes: Uint8Array;
  /** フレームごとの LZW の結果 */
  lzw: LzwEncoded[];
  /** フレームごとの最小符号サイズ */
  minCode: number[];
  /** LZW に渡した順の画素（インターレースなら並べ替えたあと） */
  order: Uint8Array[];
}

/** GIF ファイルを組み立てる */
export function encodeGif(s: GifSpec): Encoded {
  const o = new Out();
  o.ascii('GIF89a');
  o.u16(s.w);
  o.u16(s.h);
  o.u8(s.gct ? 0x80 | 0x70 | tableBits(s.gct.length / 3) : 0x70, s.bg, 0);
  if (s.gct) o.table(s.gct);
  if (s.comment) {
    o.u8(0x21, 0xfe);
    o.blocks(new TextEncoder().encode(s.comment));
  }
  if (s.loop !== null && s.frames.length > 1) {
    o.u8(0x21, 0xff, 11);
    o.ascii('NETSCAPE2.0');
    o.u8(3, 1);
    o.u16(s.loop);
    o.u8(0);
  }
  const lzw: LzwEncoded[] = [],
    minCode: number[] = [],
    order: Uint8Array[] = [];
  for (const f of s.frames) {
    o.u8(0x21, 0xf9, 4, ((f.disposal & 7) << 2) | (f.transparent >= 0 ? 1 : 0));
    o.u16(f.delay);
    o.u8(f.transparent >= 0 ? f.transparent : 0, 0);
    o.u8(0x2c);
    o.u16(f.x);
    o.u16(f.y);
    o.u16(f.w);
    o.u16(f.h);
    o.u8((f.lct ? 0x80 | tableBits(f.lct.length / 3) : 0) | (f.interlace ? 0x40 : 0));
    if (f.lct) o.table(f.lct);
    const colors = (f.lct ?? s.gct ?? new Uint8Array(6)).length / 3,
      m = Math.max(2, log2ceil(colors)),
      px = f.interlace ? interlace(f.idx, f.w, f.h) : f.idx,
      e = encodeLzw(px, m);
    o.u8(m);
    o.blocks(e.data);
    lzw.push(e);
    minCode.push(m);
    order.push(px);
  }
  o.u8(0x3b);
  return { bytes: o.done(), lzw, minCode, order };
}

/** ファイルの中の 1 区画 */
export interface Block {
  kind:
    | 'header'
    | 'lsd'
    | 'gct'
    | 'gce'
    | 'app'
    | 'comment'
    | 'text'
    | 'ext'
    | 'desc'
    | 'lct'
    | 'mincode'
    | 'data'
    | 'trailer'
    | 'junk';
  start: number;
  end: number;
  /** どのフレームのものか（なければ −1） */
  frame: number;
}

/** 読み取った 1 フレーム */
export interface GifFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  interlace: boolean;
  lct: Uint8Array | null;
  disposal: number;
  delay: number;
  transparent: number;
  minCode: number;
  /** サブブロックをつないだ LZW のデータ */
  data: Uint8Array;
  /** ファイルの中の、データのサブブロックの範囲 */
  dataStart: number;
  dataEnd: number;
}

export interface GifFile {
  version: string;
  w: number;
  h: number;
  gct: Uint8Array | null;
  bg: number;
  loop: number | null;
  comment: string;
  frames: GifFrame[];
  blocks: Block[];
  /** 読めずに止まった位置（最後まで読めたら −1） */
  brokenAt: number;
}

/** GIF ファイルを読む。GIF でなければ null、途中で壊れていれば読めた所まで */
export function parseGif(b: Uint8Array): GifFile | null {
  if (b.length < 13) return null;
  const sig = String.fromCharCode(...b.subarray(0, 6));
  if (!/^GIF8[79]a$/.test(sig)) return null;
  const u16 = (p: number): number => b[p] | (b[p + 1] << 8);
  const g: GifFile = {
    version: sig,
    w: u16(6),
    h: u16(8),
    gct: null,
    bg: b[11],
    loop: null,
    comment: '',
    frames: [],
    blocks: [
      { kind: 'header', start: 0, end: 6, frame: -1 },
      { kind: 'lsd', start: 6, end: 13, frame: -1 },
    ],
    brokenAt: -1,
  };
  let p = 13;
  const add = (kind: Block['kind'], start: number, end: number, frame = -1): void => {
    g.blocks.push({ kind, start, end, frame });
  };
  if (b[10] & 0x80) {
    const n = 3 << ((b[10] & 7) + 1);
    if (p + n > b.length) {
      g.brokenAt = p;
      return g;
    }
    g.gct = b.slice(p, p + n);
    add('gct', p, p + n);
    p += n;
  }
  /** サブブロックの並びの終わり（長さ 0 の次）。途中で切れていれば −1 */
  const skip = (q: number): number => {
    for (;;) {
      if (q >= b.length) return -1;
      const k = b[q];
      q += 1 + k;
      if (k === 0) return q;
    }
  };
  let gce = { disposal: 0, delay: 0, transparent: -1 };
  for (;;) {
    if (p >= b.length) {
      g.brokenAt = p;
      return g;
    }
    const t = b[p];
    if (t === 0x3b) {
      add('trailer', p, p + 1);
      return g;
    }
    if (t === 0x21) {
      const label = b[p + 1],
        end = skip(p + 2);
      if (end < 0) {
        g.brokenAt = p;
        add('junk', p, b.length);
        return g;
      }
      if (label === 0xf9 && b[p + 2] === 4) {
        gce = {
          disposal: (b[p + 3] >> 2) & 7,
          delay: u16(p + 4),
          transparent: b[p + 3] & 1 ? b[p + 6] : -1,
        };
        add('gce', p, end, g.frames.length);
      } else if (label === 0xff) {
        const id = String.fromCharCode(...b.subarray(p + 3, p + 14));
        if (id === 'NETSCAPE2.0' && b[p + 14] === 3 && b[p + 15] === 1) g.loop = u16(p + 16);
        add('app', p, end);
      } else if (label === 0xfe) {
        let q = p + 2,
          s = '';
        while (b[q]) {
          s += String.fromCharCode(...b.subarray(q + 1, q + 1 + b[q]));
          q += 1 + b[q];
        }
        g.comment += s;
        add('comment', p, end);
      } else add(label === 0x01 ? 'text' : 'ext', p, end);
      p = end;
      continue;
    }
    if (t !== 0x2c || p + 10 > b.length) {
      g.brokenAt = p;
      add('junk', p, b.length);
      return g;
    }
    const fi = g.frames.length,
      fl = b[p + 9];
    add('desc', p, p + 10, fi);
    const f: GifFrame = {
      x: u16(p + 1),
      y: u16(p + 3),
      w: u16(p + 5),
      h: u16(p + 7),
      interlace: (fl & 0x40) !== 0,
      lct: null,
      ...gce,
      minCode: 0,
      data: new Uint8Array(0),
      dataStart: 0,
      dataEnd: 0,
    };
    gce = { disposal: 0, delay: 0, transparent: -1 };
    p += 10;
    if (fl & 0x80) {
      const n = 3 << ((fl & 7) + 1);
      if (p + n > b.length) {
        g.brokenAt = p;
        add('junk', p, b.length);
        return g;
      }
      f.lct = b.slice(p, p + n);
      add('lct', p, p + n, fi);
      p += n;
    }
    if (p >= b.length) {
      g.brokenAt = p;
      return g;
    }
    f.minCode = b[p];
    add('mincode', p, p + 1, fi);
    p++;
    f.dataStart = p;
    /* サブブロックが途中で切れていても、読めた分は復号に渡す */
    const parts: Uint8Array[] = [];
    let q = p,
      broken = false;
    for (;;) {
      if (q >= b.length) {
        broken = true;
        break;
      }
      const k = b[q];
      if (k === 0) {
        q++;
        break;
      }
      parts.push(b.subarray(q + 1, Math.min(b.length, q + 1 + k)));
      q += 1 + k;
      if (q > b.length) {
        broken = true;
        q = b.length;
        break;
      }
    }
    const size = parts.reduce((a, c) => a + c.length, 0);
    f.data = new Uint8Array(size);
    let o = 0;
    for (const c of parts) {
      f.data.set(c, o);
      o += c.length;
    }
    f.dataEnd = q;
    add('data', p, q, fi);
    g.frames.push(f);
    p = q;
    if (broken) {
      g.brokenAt = q;
      return g;
    }
  }
}

/** フレームを復号する（画素は行の上から順） */
export function decodeFrame(f: GifFrame): { idx: Uint8Array; lzw: LzwDecoded } {
  const lzw = decodeLzw(f.data, f.minCode, f.w * f.h);
  return { idx: f.interlace ? deinterlace(lzw.out, f.w, f.h) : lzw.out, lzw };
}
