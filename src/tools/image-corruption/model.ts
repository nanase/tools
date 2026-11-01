/**
 * 「壊す」枠の設定から、形式ごとの壊す操作を作る。3 形式で同じ役割の場所を同じ割合の位置で壊す
 */
import {
  type Decoded,
  damage,
  decodeLax,
  type Encoded,
  type EncodeOpts,
  encodeAs,
  type Fmt,
  type Part,
  type Source,
} from './codec';
import { applyOps, type Op, rng } from './corrupt';

/** 壊す場所。width・height は値を直接書き、ほかはバイトの範囲の中を壊す */
export type Place = 'data' | 'width' | 'height' | 'color' | 'table';
export type OpKind = 'flip' | 'set' | 'del' | 'ins' | 'cut';

export interface Plan {
  place: Place;
  op: OpKind;
  /** 壊す数 */
  n: number;
  /** 種。「選び直す」で変える */
  seed: number;
  /** 範囲の中の位置（0〜1） */
  pos: number;
  /** 書き込む幅・高さ [画素] */
  width: number;
  height: number;
}

/** 2 か所目より後を散らす幅（データの長さに対する割合） */
export const SPREAD = 0.05;

const dataOf = (e: Encoded): Part => e.parts.find((p) => p.data) as Part;
const partOf = (e: Encoded, name: string): Part => e.parts.find((p) => p.name === name) as Part;

/** Deflate の先頭から見る長さ（動的ハフマンの符号長の表が入る） */
const DEFLATE_HEAD = 64;

/** 場所のバイトの範囲 [start, end)。width・height では値を書く区画 */
export function locate(fmt: Fmt, e: Encoded, place: Place): { start: number; end: number } {
  if (place === 'data') return dataOf(e);
  if (place === 'width' || place === 'height') {
    const hi = place === 'height';
    if (fmt === 'png') return { start: hi ? 20 : 16, end: hi ? 24 : 20 };
    if (fmt === 'jpeg') {
      const s = partOf(e, 'SOF0').start + (hi ? 5 : 7);
      return { start: s, end: s + 2 };
    }
    const s = partOf(e, '画像').start + (hi ? 7 : 5);
    return { start: s, end: s + 2 };
  }
  if (place === 'color') {
    /* PNG は色の型、JPEG は量子化テーブル、GIF は色表 */
    if (fmt === 'png') return { start: 25, end: 26 };
    if (fmt === 'jpeg') {
      const p = partOf(e, 'DQT');
      return { start: p.start + 4, end: p.end };
    }
    return partOf(e, '色表');
  }
  /* 符号の表: PNG は Deflate の先頭（チャンクの頭 8 バイトと zlib の頭 2 バイトの後）、JPEG は DHT、GIF は最小符号長 */
  if (fmt === 'png') {
    const s = dataOf(e).start + 10;
    return { start: s, end: Math.min(s + DEFLATE_HEAD, dataOf(e).end) };
  }
  if (fmt === 'jpeg') {
    const p = partOf(e, 'DHT');
    return { start: p.start + 4, end: p.end };
  }
  return partOf(e, '符号長');
}

function dimOps(fmt: Fmt, e: Encoded, place: 'width' | 'height', v: number): Op[] {
  const set = (pos: number, value: number): Op => ({ kind: 'set', pos, value: value & 255 }),
    { start } = locate(fmt, e, place);
  if (fmt === 'png')
    return [set(start, v >>> 24), set(start + 1, v >>> 16), set(start + 2, v >>> 8), set(start + 3, v)];
  if (fmt === 'jpeg') return [set(start, v >> 8), set(start + 1, v)];
  /* GIF は画面の大きさ（6・8 バイト目）も画像の区画と一緒に書く */
  const lsd = place === 'width' ? 6 : 8;
  return [set(lsd, v), set(lsd + 1, v >> 8), set(start, v), set(start + 1, v >> 8)];
}

/** 壊す操作の列 */
export function planOps(fmt: Fmt, e: Encoded, p: Plan): Op[] {
  if (p.place === 'width') return dimOps(fmt, e, 'width', p.width);
  if (p.place === 'height') return dimOps(fmt, e, 'height', p.height);
  const { start, end } = locate(fmt, e, p.place),
    span = end - start,
    first = start + Math.min(span - 1, Math.floor(p.pos * span));
  if (p.op === 'cut') return [{ kind: 'cut', pos: first }];
  /* データは位置の後ろに散らし、ヘッダは範囲の中に散らす。短い範囲に何か所も当てると値が読めなくなるだけなので、8 バイトに 1 か所まで */
  const near = p.place === 'data',
    n = near ? p.n : Math.min(p.n, Math.max(1, span >> 3)),
    /* PNG の色の型は下位 3 ビットだけが読める値（0・2・3・4・6）の間を動く */
    bits = fmt === 'png' && p.place === 'color' ? 3 : 8,
    r = rng(p.seed * 7919 + 1),
    ops: Op[] = [];
  for (let i = 0; i < n; i++) {
    const a = r(),
      b = r(),
      pos =
        i === 0
          ? first
          : near
            ? Math.min(end - 1, first + Math.floor(a * span * SPREAD))
            : start + Math.floor(a * span);
    if (p.op === 'flip') ops.push({ kind: 'flip', pos, bit: Math.floor(b * bits) });
    else if (p.op === 'set') ops.push({ kind: 'set', pos, value: Math.floor(b * 256) });
    else if (p.op === 'del') ops.push({ kind: 'del', pos });
    else ops.push({ kind: 'ins', pos, value: Math.floor(b * 256) });
  }
  return ops;
}

/** 符号化と元の復号を持っておくもの */
export interface Base {
  e: Encoded;
  clean: Decoded;
}
export function makeBase(fmt: Fmt, s: Source, o: EncodeOpts): Base {
  const e = encodeAs(fmt, s, o);
  return { e, clean: decodeLax(fmt, e.bytes) };
}

/** 1 形式の結果 */
export interface Outcome {
  fmt: Fmt;
  /** 壊す前の大きさ・データの区画（帯に使う） */
  size: number;
  dataStart: number;
  dataEnd: number;
  /** 最初に壊した位置とその区画の名前 */
  hit: number;
  part: string;
  d: Decoded;
  /** 崩れた画素の割合（0〜1） */
  ratio: number;
  /** 壊したあとのバイト列（ブラウザで開くときだけ） */
  bytes: Uint8Array | null;
}

export function outcome(fmt: Fmt, b: Base, p: Plan, wantBytes: boolean): Outcome {
  const ops = planOps(fmt, b.e, p),
    by = applyOps(b.e.bytes, ops),
    d = decodeLax(fmt, by),
    hit = ops[0]?.pos ?? 0,
    dp = dataOf(b.e);
  return {
    fmt,
    size: b.e.bytes.length,
    dataStart: dp.start,
    dataEnd: dp.end,
    hit,
    part: b.e.parts.find((q) => hit >= q.start && hit < q.end)?.name ?? '',
    d,
    ratio: damage(b.clean, d).ratio,
    bytes: wantBytes ? by : null,
  };
}
