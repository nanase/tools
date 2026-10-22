/**
 * QR コードの符号化: 文字列 → モードと文字数・データのビット列 → 終端と埋め草 → 符号語 → ブロックごとのリード・ソロモン符号
 * → 交互に並べる → ジグザグに置く → 8 つのマスクの失点を比べる → 形式情報・型番情報。
 * 文字列は 1 つのモードでまとめて符号化する（モードを途中で切り替える最適化はしない）
 */
import { rsEncode } from './rs';
import {
  type Blocks,
  blocks,
  ECCS,
  type Ecc,
  type Frame,
  formatBits,
  formatCells,
  frame,
  MASKS,
  Role,
  size,
  versionBits,
  versionCells,
} from './spec';

export type Mode = 'num' | 'alnum' | 'byte' | 'kanji';
export const MODES: readonly Mode[] = ['num', 'alnum', 'byte', 'kanji'];
export const MODE_IND: Record<Mode, number> = { num: 0b0001, alnum: 0b0010, byte: 0b0100, kanji: 0b1000 };
export const MODE_NAME: Record<Mode, string> = { num: '数字', alnum: '英数字', byte: '8 ビットバイト', kanji: '漢字' };
const CC: Record<Mode, [number, number, number]> = {
  num: [10, 12, 14],
  alnum: [9, 11, 13],
  byte: [8, 16, 16],
  kanji: [8, 10, 12],
};
/** 文字数の欄のビット数 */
export const ccBits = (m: Mode, ver: number): number => CC[m][ver <= 9 ? 0 : ver <= 26 ? 1 : 2];
export const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
/** 埋め草の 2 バイト（交互に使う） */
export const PAD = [0xec, 0x11];

/* ---------- Shift_JIS（漢字モード） ---------- */
let sjis: Map<string, number> | null | undefined;
/**
 * 文字 → Shift_JIS の 2 バイトの符号（漢字モードで使える 0x8140〜0x9FFC・0xE040〜0xEBBF だけ）。
 * ブラウザの TextDecoder で Shift_JIS の 2 バイトを 1 つずつ文字に戻して作る。使えない環境では null
 */
export function sjisMap(): Map<string, number> | null {
  if (sjis !== undefined) return sjis;
  try {
    const dec = new TextDecoder('shift_jis'),
      m = new Map<string, number>(),
      buf = new Uint8Array(2);
    for (const [lo, hi] of [
      [0x81, 0x9f],
      [0xe0, 0xeb],
    ])
      for (let a = lo; a <= hi; a++)
        for (let b = 0x40; b <= 0xfc; b++) {
          if (b === 0x7f || (a === 0xeb && b > 0xbf)) continue;
          buf[0] = a;
          buf[1] = b;
          const s = dec.decode(buf);
          if (s.length === 1 && s !== '�' && !m.has(s)) m.set(s, (a << 8) | b);
        }
    sjis = m.size > 1000 ? m : null;
  } catch {
    sjis = null;
  }
  return sjis;
}
/** Shift_JIS の符号 → 文字（読むときに使う） */
export function sjisChar(code: number): string {
  try {
    return new TextDecoder('shift_jis').decode(new Uint8Array([code >> 8, code & 0xff]));
  } catch {
    return '�';
  }
}

/* ---------- 文字列をモードの単位に分ける ---------- */
/** 符号化の単位: 数字は 3 文字、英数字は 2 文字、バイトは 1 バイト、漢字は 1 文字 */
export interface Unit {
  /** 値と、そのビット数 */
  v: number;
  bits: number;
  /** 文字の範囲（コードポイントの番号。c0 ≤ i < c1） */
  c0: number;
  c1: number;
}

/** モードで符号化できるか。できなければ使えない最初の文字の番号 */
export function badChar(chars: readonly string[], m: Mode): number {
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (m === 'num' && !(c >= '0' && c <= '9')) return i;
    if (m === 'alnum' && !ALNUM.includes(c)) return i;
    if (m === 'kanji' && !sjisMap()?.has(c)) return i;
  }
  return -1;
}

export function units(chars: readonly string[], m: Mode): Unit[] {
  const out: Unit[] = [];
  if (m === 'num')
    for (let i = 0; i < chars.length; i += 3) {
      const s = chars.slice(i, i + 3).join('');
      out.push({ v: Number(s), bits: [0, 4, 7, 10][s.length], c0: i, c1: i + s.length });
    }
  else if (m === 'alnum')
    for (let i = 0; i < chars.length; i += 2) {
      const a = ALNUM.indexOf(chars[i]);
      if (i + 1 < chars.length) out.push({ v: a * 45 + ALNUM.indexOf(chars[i + 1]), bits: 11, c0: i, c1: i + 2 });
      else out.push({ v: a, bits: 6, c0: i, c1: i + 1 });
    }
  else if (m === 'kanji') {
    const map = sjisMap();
    chars.forEach((c, i) => {
      const s = map?.get(c) ?? 0,
        t = s - (s <= 0x9ffc ? 0x8140 : 0xc140);
      out.push({ v: (t >> 8) * 0xc0 + (t & 0xff), bits: 13, c0: i, c1: i + 1 });
    });
  } else {
    const enc = new TextEncoder();
    chars.forEach((c, i) => {
      for (const b of enc.encode(c)) out.push({ v: b, bits: 8, c0: i, c1: i + 1 });
    });
  }
  return out;
}

/** 文字数の欄に書く数（バイトモードはバイト数） */
export const countOf = (chars: readonly string[], m: Mode): number =>
  m === 'byte' ? units(chars, m).length : chars.length;

/** 自動で選ぶモード: 符号化できるモードのうち、ビット数がいちばん少ないもの（同じなら数字 → 英数字 → 漢字 → バイト） */
export function autoMode(chars: readonly string[]): Mode {
  let best: Mode = 'byte',
    bits = Infinity;
  for (const m of ['num', 'alnum', 'kanji', 'byte'] as const) {
    if (badChar(chars, m) >= 0) continue;
    const b = units(chars, m).reduce((s, u) => s + u.bits, 0) + ccBits(m, 1);
    if (b < bits) {
      bits = b;
      best = m;
    }
  }
  return best;
}

/* ---------- ビット列 ---------- */
export type SpanKind = 'mode' | 'count' | 'data' | 'term' | 'fill' | 'pad';
/** ビット列の区切り（from ≤ ビットの番号 < to） */
export interface Span {
  k: SpanKind;
  from: number;
  to: number;
  /** データの単位なら文字の範囲 */
  c0?: number;
  c1?: number;
  /** 書いた値 */
  v: number;
}

/** 必要なビット数（終端より前） */
export const needBits = (us: readonly Unit[], m: Mode, ver: number): number =>
  4 + ccBits(m, ver) + us.reduce((s, u) => s + u.bits, 0);

/* ---------- 失点 ---------- */
export interface Penalty {
  /** 同じ色が 5 つ以上並ぶ（3 + 5 を超えた数） */
  n1: number;
  /** 2 × 2 の同じ色の塊（3 ずつ） */
  n2: number;
  /** ファインダーに似た 1:1:3:1:1 の並び（40 ずつ） */
  n3: number;
  /** 暗いモジュールの割合の 50 % からのずれ（5 % ごとに 10） */
  n4: number;
  total: number;
  dark: number;
}

/**
 * マスクの失点。1:1:3:1:1 の並びは、両側のどちらかに 4 つ以上の明るいモジュール（記号の外の余白を含む）が
 * あるものを数える（Nayuki の実装と同じ数え方）
 */
export function penalty(m: Uint8Array, n: number): Penalty {
  let n1 = 0,
    n3 = 0,
    n2 = 0;
  const count = (h: number[]) => {
    const u = h[1],
      core = u > 0 && h[2] === u && h[3] === u * 3 && h[4] === u && h[5] === u;
    return (core && h[0] >= u * 4 && h[6] >= u ? 1 : 0) + (core && h[6] >= u * 4 && h[0] >= u ? 1 : 0);
  };
  const push = (h: number[], len: number) => {
    if (h[0] === 0) len += n;
    h.pop();
    h.unshift(len);
  };
  for (let dir = 0; dir < 2; dir++)
    for (let a = 0; a < n; a++) {
      let color = 0,
        run = 0;
      const h = [0, 0, 0, 0, 0, 0, 0];
      for (let b = 0; b < n; b++) {
        const v = dir ? m[b * n + a] : m[a * n + b];
        if (v === color) {
          run++;
          if (run === 5) n1 += 3;
          else if (run > 5) n1++;
        } else {
          push(h, run);
          if (!color) n3 += count(h) * 40;
          color = v;
          run = 1;
        }
      }
      if (color) {
        push(h, run);
        run = 0;
      }
      push(h, run + n);
      n3 += count(h) * 40;
    }
  for (let y = 0; y < n - 1; y++)
    for (let x = 0; x < n - 1; x++) {
      const c = m[y * n + x];
      if (c === m[y * n + x + 1] && c === m[(y + 1) * n + x] && c === m[(y + 1) * n + x + 1]) n2 += 3;
    }
  let dark = 0;
  for (const v of m) dark += v;
  const k = Math.ceil(Math.abs(dark * 20 - n * n * 10) / (n * n)) - 1,
    n4 = k * 10;
  return { n1, n2, n3, n4, total: n1 + n2 + n3 + n4, dark };
}

/* ---------- 符号化 ---------- */
export interface Options {
  ecc: Ecc;
  /** 0 なら自動（入る最小の型番） */
  ver: number;
  /** −1 なら自動（失点の最も小さいマスク） */
  mask: number;
  /** 'auto' なら自動 */
  mode: Mode | 'auto';
  /** 同じ型番に入るなら誤り訂正のレベルを上げる */
  boost: boolean;
}

export type EncodeError =
  | { err: 'empty' }
  | { err: 'char'; mode: Mode; at: number; ch: string }
  | { err: 'long'; mode: Mode; need: number; cap: number; ver: number };

/** 置いた符号語の出どころ */
export interface Src {
  /** ブロックの番号 */
  b: number;
  /** ブロックの中の番号（データ語は 0 から、誤り訂正語はデータ語の後に続けて数える） */
  i: number;
  ec: boolean;
}

export interface Encoded {
  text: string;
  chars: string[];
  mode: Mode;
  ecc: Ecc;
  /** 選んだ誤り訂正のレベル（boost で上げる前） */
  ecc0: Ecc;
  ver: number;
  n: number;
  mask: number;
  units: Unit[];
  /** データのビット列（データの符号語の全ビット） */
  bits: Uint8Array;
  spans: Span[];
  bk: Blocks;
  /** データの符号語（ブロックに分ける前の並び） */
  data: number[];
  blocks: { data: number[]; ec: number[] }[];
  /** 置く順の符号語 */
  cw: number[];
  src: Src[];
  frame: Frame;
  /** モジュール → 置いた符号語の番号（−1 は符号語でない） */
  cwAt: Int16Array;
  /** モジュール → 符号語の中のビット（7 が最上位）。符号語でなければ −1 */
  bitAt: Int8Array;
  /** マスクをかける前（機能パターン＋符号語。形式情報・型番情報は 0） */
  base: Uint8Array;
  pens: Penalty[];
  /** 完成（マスク・形式情報・型番情報の後） */
  mods: Uint8Array;
  fmt: number;
}

/** 置く順の符号語の出どころ: データ語を 1 語ずつブロックの順に交互に並べ、その後に誤り訂正語を同じく交互に並べる */
export function srcOrder(bk: Blocks): Src[] {
  const out: Src[] = [],
    maxD = Math.max(...bk.sizes);
  for (let i = 0; i < maxD; i++)
    for (let b = 0; b < bk.sizes.length; b++) if (i < bk.sizes[b]) out.push({ b, i, ec: false });
  for (let i = 0; i < bk.ec; i++)
    for (let b = 0; b < bk.sizes.length; b++) out.push({ b, i: bk.sizes[b] + i, ec: true });
  return out;
}

/** 型番 ver・レベル ecc のデータのビット数 */
export const capBits = (ver: number, ecc: Ecc): number => blocks(ver, ecc).data * 8;

export function encode(text: string, o: Options): Encoded | EncodeError {
  const chars = [...text];
  if (!chars.length) return { err: 'empty' };
  const mode = o.mode === 'auto' ? autoMode(chars) : o.mode,
    at = badChar(chars, mode);
  if (at >= 0) return { err: 'char', mode, at, ch: chars[at] };
  const us = units(chars, mode),
    count = mode === 'byte' ? us.length : chars.length;
  let ver = o.ver;
  const fits = (v: number, e: Ecc) => count < 2 ** ccBits(mode, v) && needBits(us, mode, v) <= capBits(v, e);
  if (ver === 0) {
    ver = 1;
    while (ver <= 40 && !fits(ver, o.ecc)) ver++;
    if (ver > 40) return { err: 'long', mode, need: needBits(us, mode, 40), cap: capBits(40, o.ecc), ver: 40 };
  } else if (!fits(ver, o.ecc))
    return { err: 'long', mode, need: needBits(us, mode, ver), cap: capBits(ver, o.ecc), ver };
  let ecc = o.ecc;
  if (o.boost) for (const e of ECCS.slice(ECCS.indexOf(ecc) + 1)) if (fits(ver, e)) ecc = e;

  /* ビット列 */
  const bk = blocks(ver, ecc),
    cap = bk.data * 8,
    bits = new Uint8Array(cap),
    spans: Span[] = [];
  let p = 0;
  const put = (k: SpanKind, v: number, len: number, c0?: number, c1?: number) => {
    if (len <= 0) return;
    for (let i = len - 1; i >= 0; i--) bits[p++] = (v >>> i) & 1;
    spans.push({ k, from: p - len, to: p, v, c0, c1 });
  };
  put('mode', MODE_IND[mode], 4);
  put('count', count, ccBits(mode, ver));
  for (const u of us) put('data', u.v, u.bits, u.c0, u.c1);
  put('term', 0, Math.min(4, cap - p));
  put('fill', 0, (8 - (p % 8)) % 8);
  for (let i = 0; p < cap; i++) put('pad', PAD[i % 2], 8);
  const data: number[] = [];
  for (let i = 0; i < cap; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    data.push(v);
  }

  /* ブロックに分けて誤り訂正語を付け、交互に並べる */
  const bl: { data: number[]; ec: number[] }[] = [];
  let k = 0;
  for (const s of bk.sizes) {
    const d = data.slice(k, k + s);
    k += s;
    bl.push({ data: d, ec: rsEncode(d, bk.ec) });
  }
  const src = srcOrder(bk),
    cw = src.map((x) => (x.ec ? bl[x.b].ec[x.i - bl[x.b].data.length] : bl[x.b].data[x.i]));

  /* ジグザグに置く */
  const fr = frame(ver),
    n = fr.n,
    base = fr.fn.slice(),
    cwAt = new Int16Array(n * n).fill(-1),
    bitAt = new Int8Array(n * n).fill(-1);
  fr.order.forEach((m, i) => {
    if (i < cw.length * 8) {
      const c = i >> 3,
        b = 7 - (i & 7);
      cwAt[m] = c;
      bitAt[m] = b;
      base[m] = (cw[c] >>> b) & 1;
    }
  });

  /* マスク */
  const masked = (mk: number) => {
    const out = base.slice();
    const f = MASKS[mk];
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) if (fr.role[y * n + x] === Role.Data && f(x, y)) out[y * n + x] ^= 1;
    drawInfo(out, n, ver, ecc, mk);
    return out;
  };
  const pens = MASKS.map((_, i) => penalty(masked(i), n));
  let mask = o.mask;
  if (mask < 0) mask = pens.reduce((b, x, i) => (x.total < pens[b].total ? i : b), 0);
  const mods = masked(mask);
  return {
    text,
    chars,
    mode,
    ecc,
    ecc0: o.ecc,
    ver,
    n,
    mask,
    units: us,
    bits,
    spans,
    bk,
    data,
    blocks: bl,
    cw,
    src,
    frame: fr,
    cwAt,
    bitAt,
    base,
    pens,
    mods,
    fmt: formatBits(ecc, mask),
  };
}

/** 形式情報と型番情報を書き込む */
export function drawInfo(m: Uint8Array, n: number, ver: number, ecc: Ecc, mask: number): void {
  const f = formatBits(ecc, mask);
  for (const cells of formatCells(n))
    cells.forEach(([x, y], i) => {
      m[y * n + x] = (f >>> i) & 1;
    });
  if (ver >= 7) {
    const v = versionBits(ver);
    for (const cells of versionCells(n))
      cells.forEach(([x, y], i) => {
        m[y * n + x] = (v >>> i) & 1;
      });
  }
}

/** 型番 ver のマスクの模様（データの領域だけ 1） */
export function maskPattern(ver: number, mk: number): Uint8Array {
  const fr = frame(ver),
    n = size(ver),
    out = new Uint8Array(n * n),
    f = MASKS[mk];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) if (fr.role[y * n + x] === Role.Data && f(x, y)) out[y * n + x] = 1;
  return out;
}
