/**
 * 画面が使う計算結果。画像は減色して符号化し、GIF ファイルはそのまま読む。
 * どちらも 1 度 GIF のバイト列にしてから parseGif で読むので、以降の表示は同じ道を通る
 */
import type { HexRange } from '../../lib/imgfmt/hexdump';
import { deinterlace, encodeGif, type GifFile, type GifFrame, interlace, interlaceRows, parseGif } from './gif';
import { type DictEntry, decodeLzw, encodeLzw, encView, type LzwDecoded, type LzwStop, type LzwTrace } from './lzw';
import { quantize } from './quant';

/** 開ける画面の大きさの上限 [画素] */
export const MAX_PIXELS = 4194304;

export interface Model {
  file: GifFile;
  bytes: Uint8Array;
  name: string;
  /** GIF ファイルをそのまま読んだ */
  asIs: boolean;
  /** 減色せずに元の色のまま入った */
  exact: boolean;
  /** 使う色数（画像から作ったとき。ファイルはカラーテーブルの大きさ） */
  used: number | null;
  /** 読むフレームの数 */
  n: number;
  views: Map<number, FrameView>;
}

/** 1 フレームを復号した結果 */
export interface FrameView {
  i: number;
  f: GifFrame;
  pal: Uint8Array;
  colors: number;
  m: number;
  /** 符号の順の画素 */
  order: Uint8Array;
  /** 行の上から順の画素 */
  idx: Uint8Array;
  /** 符号の順の行 → 画像の行 */
  rows: number[];
  dec: LzwDecoded;
  /** 符号化から見た記録 */
  enc: LzwTrace;
  /** 復号から見た記録 */
  tr: LzwTrace;
  /** インターレースの比較（初めて使うときに作る） */
  pair?: { plain: Uint8Array; il: Uint8Array };
}

export type Fail = 'not-gif' | 'too-big' | 'no-frame';

function usableFrames(g: GifFile): number {
  let n = 0;
  for (const f of g.frames) {
    const a = f.w * f.h;
    if (!a || a > MAX_PIXELS) break;
    n++;
  }
  return n;
}

/** 画像を減色して GIF にする */
export function fromImage(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  o: { colors: number; dither: boolean },
  name: string,
): Model {
  const q = quantize(rgba, w, h, o),
    e = encodeGif({
      w,
      h,
      gct: q.pal,
      bg: 0,
      loop: null,
      frames: [{ x: 0, y: 0, w, h, idx: q.idx, disposal: 0, delay: 0, transparent: q.transparent, interlace: false }],
    }),
    file = parseGif(e.bytes) as GifFile;
  return {
    file,
    bytes: e.bytes,
    name,
    asIs: false,
    exact: q.exact,
    used: q.colors,
    n: 1,
    views: new Map(),
  };
}

/** GIF のバイト列をそのまま読む */
export function fromBytes(bytes: Uint8Array, name: string): Model | Fail {
  const file = parseGif(bytes);
  if (!file) return 'not-gif';
  if (file.w * file.h > MAX_PIXELS) return 'too-big';
  const n = usableFrames(file);
  if (!n) return file.frames.length ? 'too-big' : 'no-frame';
  return { file, bytes, name, asIs: true, exact: true, used: null, n, views: new Map() };
}

const NO_PAL = new Uint8Array(6);
/** 記録つきの復号結果を持っておく数 */
const VIEW_KEEP = 8;

/** フレームを復号する（結果は持っておく） */
export function frameView(M: Model, i: number): FrameView {
  const c = M.views.get(i);
  if (c) return c;
  const f = M.file.frames[i],
    dec = decodeLzw(f.data, f.minCode, f.w * f.h, { trace: true }),
    tr = dec.trace as LzwTrace,
    pal = f.lct ?? M.file.gct ?? NO_PAL,
    v: FrameView = {
      i,
      f,
      pal,
      colors: M.used ?? pal.length / 3,
      m: f.minCode,
      order: dec.out,
      idx: f.interlace ? deinterlace(dec.out, f.w, f.h) : dec.out,
      rows: f.interlace ? interlaceRows(f.h) : Array.from({ length: f.h }, (_, y) => y),
      dec,
      enc: encView(tr, 1 << f.minCode),
      tr,
    };
  if (M.views.size >= VIEW_KEEP) M.views.delete(M.views.keys().next().value as number);
  M.views.set(i, v);
  return v;
}

/** インターレースなし・ありの LZW のデータ。ファイルにある方はそのまま使い、ない方は符号化して作る */
export function interlacePair(v: FrameView): { plain: Uint8Array; il: Uint8Array } {
  const { f, idx, m } = v;
  v.pair ??= f.interlace
    ? { plain: encodeLzw(idx, m).data, il: f.data }
    : { plain: f.data, il: encodeLzw(interlace(idx, f.w, f.h), m).data };
  return v.pair;
}

/**
 * インターレースのデータの先頭だけを受け取ったときの画素。届いた行を次の行まで伸ばして見せる。
 * 戻り値は行の上から順で、まだ届いていない所は −1
 */
export function progressive(data: Uint8Array, m: number, w: number, h: number): { px: Int16Array; rows: number } {
  const d = decodeLzw(data, m, w * h),
    px = new Int16Array(w * h).fill(-1),
    R = interlaceRows(h);
  let k = 0;
  for (; k < R.length; k++) {
    if (k * w >= d.n) break;
    const y = R[k],
      /* パスごとの伸ばす行数: 8・4・2・1 */
      s = y % 8 === 0 ? 8 : y % 8 === 4 ? 4 : y % 4 === 2 ? 2 : 1;
    for (let x = 0; x < w; x++) {
      const q = k * w + x;
      if (q >= d.n) break;
      for (let yy = y; yy < Math.min(h, y + s); yy++) px[yy * w + x] = d.out[q];
    }
  }
  return { px, rows: Math.floor(d.n / w) };
}

/** 止まった理由の表示。正常に終わったら空 */
export function stopLabel(s: LzwStop): string {
  switch (s) {
    case 'end':
      return 'データの途中で終わっています。';
    case 'bad-code':
      return '辞書にない符号で止まりました。';
    case 'full':
      return '画素が多すぎます。';
    case 'bad-min':
      return '最小符号サイズが正しくありません。';
    default:
      return '';
  }
}

/* ---------- 辞書の木 ---------- */
export interface TreeNode {
  code: number;
  /** この節の画素の値 */
  v: number;
  /** 親の節の番号（根は −1） */
  parent: number;
  /** 深さ（根は 0） */
  d: number;
  /** 葉の列を単位にした横の位置 */
  x: number;
}
export interface Tree {
  nodes: TreeNode[];
  leaves: number;
  depth: number;
  /** code → nodes の添字 */
  at: Map<number, number>;
}

/**
 * 辞書を木にする。根は 1 画素の符号（子を持つものと、色が少ないときは全部）。
 * 項目が cap を超えたら新しい分とその祖先だけ残す
 */
export function buildTree(ents: readonly DictEntry[], clear: number, colors: number, cap: number): Tree {
  const first = clear + 2,
    from = Math.max(0, ents.length - cap),
    keep = new Set<number>();
  for (let i = from; i < ents.length; i++) {
    let c = ents[i].code;
    while (c >= first && !keep.has(c)) {
      keep.add(c);
      const e = ents[c - first];
      if (!e) break;
      c = e.prefix;
    }
  }
  const kids = new Map<number, DictEntry[]>();
  for (const e of ents) {
    if (!keep.has(e.code)) continue;
    const a = kids.get(e.prefix);
    if (a) a.push(e);
    else kids.set(e.prefix, [e]);
  }
  const nodes: TreeNode[] = [],
    at = new Map<number, number>();
  let leaves = 0,
    depth = 0;
  /* 深い列でも呼び出しが溢れないよう、帰りがけの処理を積んで回す */
  const walk = (root: number, v0: number): void => {
    const stack: { code: number; v: number; parent: number; d: number; idx: number; kid: number }[] = [];
    const open = (code: number, v: number, parent: number, d: number): void => {
      const idx = nodes.length;
      nodes.push({ code, v, parent, d, x: 0 });
      at.set(code, idx);
      if (d > depth) depth = d;
      stack.push({ code, v, parent, d, idx, kid: 0 });
    };
    open(root, v0, -1, 0);
    while (stack.length) {
      const t = stack[stack.length - 1],
        ks = kids.get(t.code);
      if (ks && t.kid < ks.length) {
        const e = ks[t.kid++];
        open(e.code, e.suffix, t.idx, t.d + 1);
        continue;
      }
      if (!ks) nodes[t.idx].x = leaves++;
      else {
        const a = at.get(ks[0].code) as number,
          b = at.get(ks[ks.length - 1].code) as number;
        nodes[t.idx].x = (nodes[a].x + nodes[b].x) / 2;
      }
      stack.pop();
    }
  };
  for (let v = 0; v < clear; v++) if (kids.has(v) || (v < colors && colors <= 16)) walk(v, v);
  return { nodes, leaves, depth, at };
}

/* ---------- ファイルの区画 ---------- */
/** 16 進ダンプの範囲。LZW はサブブロックの長さのバイトを分ける */
export function fileRanges(M: Model): HexRange[] {
  const out: HexRange[] = [],
    b = M.bytes;
  for (const s of M.file.blocks) {
    if (s.kind !== 'data') {
      out.push({ start: s.start, end: s.end, cls: s.kind });
      continue;
    }
    let q = s.start;
    while (q < s.end) {
      const k = b[q];
      out.push({ start: q, end: q + 1, cls: 'sub' });
      if (k) out.push({ start: q + 1, end: Math.min(s.end, q + 1 + k), cls: 'data' });
      q += 1 + k;
    }
  }
  return out;
}

/** 位置 off を含む区画の番号（なければ −1） */
export function blockAt(M: Model, off: number): number {
  return M.file.blocks.findIndex((b) => off >= b.start && off < b.end);
}

/** LZW の区画の中の位置から、つないだデータの中の位置へ。サブブロックの長さのバイトなら −1 */
export function dataIndex(M: Model, f: GifFrame, off: number): number {
  let q = f.dataStart,
    acc = 0;
  while (q < f.dataEnd) {
    const k = M.bytes[q];
    if (off === q) return -1;
    if (off <= q + k) return acc + off - q - 1;
    acc += k;
    q += 1 + k;
  }
  return -1;
}

/** 区画の名前と短い表示 */
export const BLOCK_NAME: Record<string, string> = {
  header: 'Header',
  lsd: 'Logical Screen Descriptor',
  gct: 'Global Color Table',
  gce: 'Graphic Control Extension',
  app: 'Application Extension',
  comment: 'Comment Extension',
  text: 'Plain Text Extension',
  ext: 'Extension',
  desc: 'Image Descriptor',
  lct: 'Local Color Table',
  mincode: 'LZW Minimum Code Size',
  data: 'Image Data',
  trailer: 'Trailer',
  junk: '読めない所',
};
export const BLOCK_SHORT: Record<string, string> = {
  header: 'Header',
  lsd: '画面',
  gct: 'カラーテーブル',
  gce: 'GCE',
  app: 'Application',
  comment: 'Comment',
  text: 'Text',
  ext: 'Extension',
  desc: 'Image',
  lct: 'カラーテーブル',
  mincode: 'Min',
  data: 'LZW',
  trailer: 'Trailer',
  junk: '?',
};

/** 区画の中身の短い説明 */
export function blockInfo(M: Model, i: number): string {
  const b = M.file.blocks[i],
    f = b.frame >= 0 ? M.file.frames[b.frame] : null;
  switch (b.kind) {
    case 'header':
      return M.file.version;
    case 'lsd':
      return `${M.file.w}×${M.file.h}`;
    case 'gct':
    case 'lct':
      return `${(b.end - b.start) / 3} 色`;
    case 'gce':
      return f
        ? `遅延 ${f.delay} cs · disposal ${f.disposal}${f.transparent >= 0 ? ` · 透過色 ${f.transparent}` : ''}`
        : '';
    case 'app':
      return M.file.loop === null ? '' : `繰り返し ${M.file.loop === 0 ? '無限' : M.file.loop}`;
    case 'desc':
      return f ? `${f.x}, ${f.y} · ${f.w}×${f.h}${f.interlace ? ' · インターレース' : ''}` : '';
    case 'mincode':
      return f ? String(f.minCode) : '';
    default:
      return '';
  }
}
