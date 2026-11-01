/**
 * Deflate の符号化（RFC 1951）。一致探しは zlib と同じハッシュチェーンの LZ77（窓 32 KiB、一致 3〜258、3 バイトのハッシュ）で、
 * 圧縮レベルは zlib の configuration_table を写す。level 1〜3 は deflate_fast（遅延一致なし）、4〜9 は deflate_slow（遅延一致あり）、
 * 0 は stored だけ。記号を blockSymbols 個ためるごとにブロックを閉じ、stored・固定・動的のうち最も短いものを選ぶ
 */
import { BitWriter } from './bits';
import { canonicalCodes, codeLengths, reverseBits } from './huffman';
import {
  CL_ORDER,
  DIST_BASE,
  DIST_EXTRA,
  DIST_SYM,
  FIXED_DIST_LENS,
  FIXED_LIT_LENS,
  LEN_BASE,
  LEN_EXTRA,
  LEN_SYM,
} from './tables';
import {
  type BlockInfo,
  type BlockSizes,
  type BlockType,
  type DeflateTrace,
  TK_END,
  TK_LIT,
  TK_MATCH,
  TK_STORED,
  TokenLog,
} from './trace';

/** zlib の configuration_table の 1 行 */
export interface LevelConfig {
  /** 前の一致がこの長さ以上なら探す鎖を 1/4 にする */
  good: number;
  /** slow: この長さ以上の一致があれば次の位置で探さない。fast: この長さ以下の一致の中の位置だけハッシュに入れる */
  lazy: number;
  /** この長さの一致が見つかれば探すのをやめる */
  nice: number;
  /** たどる鎖の長さの上限 */
  chain: number;
  /** 遅延一致を使うか（deflate_slow） */
  slow: boolean;
}

/** zlib の deflate.c の configuration_table（level 0〜9） */
export const LEVELS: readonly LevelConfig[] = [
  { good: 0, lazy: 0, nice: 0, chain: 0, slow: false },
  { good: 4, lazy: 4, nice: 8, chain: 4, slow: false },
  { good: 4, lazy: 5, nice: 16, chain: 8, slow: false },
  { good: 4, lazy: 6, nice: 32, chain: 32, slow: false },
  { good: 4, lazy: 4, nice: 16, chain: 16, slow: true },
  { good: 8, lazy: 16, nice: 32, chain: 32, slow: true },
  { good: 8, lazy: 16, nice: 128, chain: 128, slow: true },
  { good: 8, lazy: 32, nice: 128, chain: 256, slow: true },
  { good: 32, lazy: 128, nice: 258, chain: 1024, slow: true },
  { good: 32, lazy: 258, nice: 258, chain: 4096, slow: true },
];

export interface DeflateOptions {
  /** 圧縮レベル 0〜9（既定 6） */
  level?: number;
  /** 記録を取るか（既定 true） */
  trace?: boolean;
  /** 1 ブロックにためる記号の数（既定 16384。zlib の lit_bufsize と同じ） */
  blockSymbols?: number;
}

export interface DeflateResult {
  data: Uint8Array;
  /** 最後のバイトの埋めを除いたビット数 */
  bits: number;
  trace: DeflateTrace | null;
}

const WSIZE = 32768,
  WMASK = WSIZE - 1,
  HASH_BITS = 15,
  HASH_MASK = (1 << HASH_BITS) - 1,
  MIN_MATCH = 3,
  MAX_MATCH = 258,
  /** 長さ 3 の一致はこれより遠ければ捨てる（zlib の TOO_FAR） */
  TOO_FAR = 4096,
  /** 1 つの stored ブロックの中身の上限 */
  STORED_MAX = 65535;

/** 3 バイトのハッシュ。zlib の UPDATE_HASH（5 ビットずつずらす）を 3 回したものと同じ */
const hash3 = (d: Uint8Array, p: number): number => ((d[p] << 10) ^ (d[p + 1] << 5) ^ d[p + 2]) & HASH_MASK;

/** data を Deflate で符号化する */
export function deflate(data: Uint8Array, opts: DeflateOptions = {}): DeflateResult {
  const level = Math.max(0, Math.min(9, Math.round(opts.level ?? 6))),
    cfg = LEVELS[level],
    doTrace = opts.trace ?? true,
    maxSyms = Math.max(1, opts.blockSymbols ?? 16384),
    n = data.length,
    w = new BitWriter(),
    log = doTrace ? new TokenLog(Math.min(1 << 16, (n >> 1) + 16)) : null,
    blocks: BlockInfo[] = [];

  /* ためた記号: lit は文字の値か一致の長さ、dist は 0（文字）か距離、pos は元データの位置 */
  const bLit = new Uint16Array(maxSyms),
    bDist = new Uint16Array(maxSyms),
    bPos = new Int32Array(maxSyms);
  let nSym = 0,
    srcStart = 0,
    srcEnd = 0;

  const writeStored = (from: number, to: number, final: boolean, sizes: BlockSizes | null): void => {
    /* 空でも 1 つは書く */
    let p = from;
    do {
      const e = Math.min(to, p + STORED_MAX),
        last = final && e === to,
        start = w.bits;
      w.put(last ? 1 : 0, 1);
      w.put(0, 2);
      w.align();
      w.put(e - p, 16);
      w.put(~(e - p) & 0xffff, 16);
      const head = w.bits - start;
      let t0 = 0;
      if (log) {
        t0 = log.count;
        log.push(TK_STORED, p, w.bits, 0, 0, 0);
        log.setLen(e - p, 0, 0);
        log.setBits((e - p) * 8);
      }
      w.bytes(data, p, e);
      blocks.push(blockInfo('stored', last, start, w.bits, head, p, e, t0, log ? log.count : 0, sizes));
      if (log) log.block++;
      p = e;
    } while (p < to);
  };

  const flush = (final: boolean): void => {
    const f = freqs(bLit, bDist, nSym),
      dyn = dynamicHeader(f),
      sizes = blockCosts(f, dyn, srcEnd - srcStart, w.bits);
    const best: BlockType =
      sizes.fixed <= sizes.dynamic && sizes.fixed <= sizes.stored
        ? 'fixed'
        : sizes.dynamic <= sizes.stored
          ? 'dynamic'
          : 'stored';
    if (best === 'stored') writeStored(srcStart, srcEnd, final, sizes);
    else writeHuff(best, final, sizes, dyn);
    nSym = 0;
    srcStart = srcEnd;
  };

  const writeHuff = (type: 'fixed' | 'dynamic', final: boolean, sizes: BlockSizes, h: DynHeader): void => {
    const start = w.bits;
    w.put(final ? 1 : 0, 1);
    w.put(type === 'fixed' ? 1 : 2, 2);
    let litLens: Uint8Array, distLens: Uint8Array;
    const dyn = type === 'dynamic' ? h : null;
    if (!dyn) {
      litLens = FIXED_LIT_LENS;
      distLens = FIXED_DIST_LENS;
    } else {
      litLens = dyn.litLens;
      distLens = dyn.distLens;
      writeDynHeader(w, dyn);
    }
    const head = w.bits - start,
      lc = canonicalCodes(litLens),
      dc = canonicalCodes(distLens),
      lr = revCodes(lc, litLens),
      dr = revCodes(dc, distLens),
      t0 = log ? log.count : 0;
    for (let i = 0; i < nSym; i++) {
      const v = bLit[i],
        d = bDist[i];
      if (d === 0) {
        if (log) log.push(TK_LIT, bPos[i], w.bits, v, lc[v], litLens[v]);
        w.put(lr[v], litLens[v]);
        continue;
      }
      const lk = LEN_SYM[v],
        ls = 257 + lk,
        le = LEN_EXTRA[lk],
        lx = v - LEN_BASE[lk],
        dk = DIST_SYM[d],
        de = DIST_EXTRA[dk],
        dx = d - DIST_BASE[dk];
      if (log) {
        log.push(TK_MATCH, bPos[i], w.bits, ls, lc[ls], litLens[ls]);
        log.setLen(v, lx, le);
        log.setDist(dk, dc[dk], distLens[dk], d, dx, de);
      }
      w.put(lr[ls], litLens[ls]);
      w.put(lx, le);
      w.put(dr[dk], distLens[dk]);
      w.put(dx, de);
    }
    if (log) log.push(TK_END, srcEnd, w.bits, 256, lc[256], litLens[256]);
    w.put(lr[256], litLens[256]);
    const info = blockInfo(type, final, start, w.bits, head, srcStart, srcEnd, t0, log ? log.count : 0, sizes);
    if (dyn) {
      info.hlit = dyn.litLens.length - 257;
      info.hdist = dyn.distLens.length - 1;
      info.hclen = dyn.ncl - 4;
      info.clLens = dyn.clLens;
      info.clSyms = dyn.clSyms;
      info.clExtra = dyn.clExtra;
    }
    info.litLens = litLens.slice();
    info.distLens = distLens.slice();
    blocks.push(info);
    if (log) log.block++;
  };

  const lit = (p: number): void => {
    bLit[nSym] = data[p];
    bDist[nSym] = 0;
    bPos[nSym++] = p;
    srcEnd = p + 1;
    if (nSym === maxSyms) flush(srcEnd === n);
  };
  const match = (p: number, len: number, dist: number): void => {
    bLit[nSym] = len;
    bDist[nSym] = dist;
    bPos[nSym++] = p;
    srcEnd = p + len;
    if (nSym === maxSyms) flush(srcEnd === n);
  };

  if (level === 0) writeStored(0, n, true, null);
  else {
    lz77(data, cfg, lit, match);
    /* 最後のブロックがちょうど満ちて閉じた後でなければ、残りを最後のブロックにする（空の入力も 1 つ書く） */
    if (nSym > 0 || blocks.length === 0 || !blocks[blocks.length - 1].final) flush(true);
  }
  const bits = w.bits;
  return {
    data: w.out(),
    bits,
    trace: log ? { blocks, tokens: log.finish() } : null,
  };
}

function blockInfo(
  type: BlockType,
  final: boolean,
  start: number,
  end: number,
  headerBits: number,
  srcStart: number,
  srcEnd: number,
  tokenStart: number,
  tokenEnd: number,
  sizes: BlockSizes | null,
): BlockInfo {
  return {
    type,
    final,
    start,
    end,
    headerBits,
    srcStart,
    srcEnd,
    tokenStart,
    tokenEnd,
    hlit: -1,
    hdist: -1,
    hclen: -1,
    clLens: null,
    litLens: null,
    distLens: null,
    clSyms: null,
    clExtra: null,
    sizes,
  };
}

/** 書き手に渡すための反転した符号 */
function revCodes(codes: Uint16Array, lens: Uint8Array): Uint16Array {
  const r = new Uint16Array(codes.length);
  for (let i = 0; i < codes.length; i++) r[i] = reverseBits(codes[i], lens[i]);
  return r;
}

/**
 * LZ77 で文字と一致に分ける（zlib の deflate_fast・deflate_slow と longest_match）。
 * 入力は全部手元にあるので窓は滑らせず、位置をそのまま使う。prev は位置の下位 15 ビットで引く
 */
function lz77(
  d: Uint8Array,
  cfg: LevelConfig,
  lit: (p: number) => void,
  match: (p: number, len: number, dist: number) => void,
): void {
  const n = d.length,
    head = new Int32Array(1 << HASH_BITS).fill(-1),
    prev = new Int32Array(WSIZE);
  let matchStart = 0;

  const insert = (p: number): number => {
    const h = hash3(d, p),
      old = head[h];
    prev[p & WMASK] = old;
    head[h] = p;
    return old;
  };

  /* cur から始まり、prevLen より長い最長の一致を探す。見つからなければ prevLen を返す（matchStart は変えない） */
  const longest = (cur: number, cand: number, prevLen: number): number => {
    const lookahead = n - cur,
      maxLen = Math.min(MAX_MATCH, lookahead),
      limit = cur >= WSIZE ? cur - WSIZE : -1;
    let chain = cfg.chain,
      best = prevLen,
      nice = Math.min(cfg.nice, lookahead);
    if (best >= maxLen) return maxLen;
    if (prevLen >= cfg.good) chain >>= 2;
    if (nice < MIN_MATCH) nice = MIN_MATCH;
    for (;;) {
      /* 今の最良より長くなりうるものだけを比べる（末尾の 2 バイトと先頭の 2 バイト） */
      if (d[cand + best] === d[cur + best] && d[cand + best - 1] === d[cur + best - 1] && d[cand] === d[cur]) {
        let l = 1;
        while (l < maxLen && d[cand + l] === d[cur + l]) l++;
        if (l > best) {
          matchStart = cand;
          best = l;
          if (l >= nice) break;
        }
      }
      /* 距離 32768 ちょうどの候補の鎖は今の位置で上書きされているのでたどらない。-1 は鎖の終わり */
      if (cand <= limit) break;
      cand = prev[cand & WMASK];
      if (cand <= limit || --chain === 0) break;
    }
    return best;
  };

  let s = 0;
  if (!cfg.slow) {
    /* deflate_fast */
    while (s < n) {
      const look = n - s;
      let hh = -1,
        ml = 0;
      if (look >= MIN_MATCH) hh = insert(s);
      if (hh >= 0 && s - hh <= WSIZE) ml = longest(s, hh, MIN_MATCH - 1);
      if (ml >= MIN_MATCH) {
        match(s, ml, s - matchStart);
        if (ml <= cfg.lazy && look - ml >= MIN_MATCH) {
          for (let k = 1; k < ml; k++) insert(s + k);
        }
        s += ml;
      } else {
        lit(s);
        s++;
      }
    }
    return;
  }
  /* deflate_slow */
  let ml = MIN_MATCH - 1,
    avail = false;
  while (s < n) {
    const look = n - s;
    let hh = -1;
    if (look >= MIN_MATCH) hh = insert(s);
    const pl = ml,
      pm = matchStart;
    ml = MIN_MATCH - 1;
    if (hh >= 0 && pl < cfg.lazy && s - hh <= WSIZE) {
      ml = longest(s, hh, pl);
      if (ml === MIN_MATCH && s - matchStart > TOO_FAR) ml = MIN_MATCH - 1;
    }
    if (pl >= MIN_MATCH && ml <= pl) {
      /* 前の位置の一致のほうが長いか同じなので、それを出す */
      const maxIns = n - MIN_MATCH;
      match(s - 1, pl, s - 1 - pm);
      for (let k = 1; k <= pl - 2; k++) if (s + k <= maxIns) insert(s + k);
      s += pl - 1;
      avail = false;
      ml = MIN_MATCH - 1;
    } else if (avail) {
      lit(s - 1);
      s++;
    } else {
      avail = true;
      s++;
    }
  }
  if (avail) lit(s - 1);
}

/** 動的ハフマンのヘッダ（3.2.7） */
interface DynHeader {
  litLens: Uint8Array;
  distLens: Uint8Array;
  clLens: Uint8Array;
  /** 送る符号長の符号の数（4〜19） */
  ncl: number;
  clSyms: Uint8Array;
  clExtra: Uint8Array;
  /** ヘッダのビット数（BFINAL・BTYPE を除く） */
  bits: number;
}

interface Freqs {
  lf: Uint32Array;
  df: Uint32Array;
  /** 長さと距離の付加ビットの合計 */
  extra: number;
}

/** ためた記号の出現回数 */
function freqs(bLit: Uint16Array, bDist: Uint16Array, nSym: number): Freqs {
  const lf = new Uint32Array(286),
    df = new Uint32Array(30);
  let extra = 0;
  for (let i = 0; i < nSym; i++) {
    const v = bLit[i],
      d = bDist[i];
    if (d === 0) lf[v]++;
    else {
      const lk = LEN_SYM[v],
        dk = DIST_SYM[d];
      lf[257 + lk]++;
      df[dk]++;
      extra += LEN_EXTRA[lk] + DIST_EXTRA[dk];
    }
  }
  lf[256] = 1;
  return { lf, df, extra };
}

/** 符号長の並びを 16（前の長さの繰り返し）・17・18（0 の繰り返し）で縮める（zlib の scan_tree・send_tree） */
function runLengths(lens: Uint8Array, syms: number[], extra: number[]): void {
  const n = lens.length;
  let prevLen = -1,
    next = lens[0],
    count = 0,
    maxCount = next === 0 ? 138 : 7,
    minCount = next === 0 ? 3 : 4;
  for (let i = 0; i < n; i++) {
    const cur = next;
    next = i + 1 < n ? lens[i + 1] : -1;
    if (++count < maxCount && cur === next) continue;
    if (count < minCount) {
      for (let k = 0; k < count; k++) {
        syms.push(cur);
        extra.push(0);
      }
    } else if (cur !== 0) {
      if (cur !== prevLen) {
        syms.push(cur);
        extra.push(0);
        count--;
      }
      syms.push(16);
      extra.push(count - 3);
    } else if (count <= 10) {
      syms.push(17);
      extra.push(count - 3);
    } else {
      syms.push(18);
      extra.push(count - 11);
    }
    count = 0;
    prevLen = cur;
    if (next === 0) {
      maxCount = 138;
      minCount = 3;
    } else if (cur === next) {
      maxCount = 6;
      minCount = 3;
    } else {
      maxCount = 7;
      minCount = 4;
    }
  }
}

const CL_EXTRA_BITS = [2, 3, 7];

function dynamicHeader({ lf, df }: Freqs): DynHeader {
  const ll = codeLengths(lf, 15),
    dl = codeLengths(df, 15);
  let nl = 286,
    nd = 30;
  while (nl > 257 && ll[nl - 1] === 0) nl--;
  while (nd > 1 && dl[nd - 1] === 0) nd--;
  const litLens = ll.slice(0, nl),
    distLens = dl.slice(0, nd),
    syms: number[] = [],
    extra: number[] = [];
  runLengths(litLens, syms, extra);
  runLengths(distLens, syms, extra);
  const cf = new Uint32Array(19);
  for (const s of syms) cf[s]++;
  const clLens = codeLengths(cf, 7);
  let ncl = 19;
  while (ncl > 4 && clLens[CL_ORDER[ncl - 1]] === 0) ncl--;
  let bits = 5 + 5 + 4 + 3 * ncl;
  for (const s of syms) bits += clLens[s] + (s >= 16 ? CL_EXTRA_BITS[s - 16] : 0);
  return { litLens, distLens, clLens, ncl, clSyms: Uint8Array.from(syms), clExtra: Uint8Array.from(extra), bits };
}

function writeDynHeader(w: BitWriter, h: DynHeader): void {
  w.put(h.litLens.length - 257, 5);
  w.put(h.distLens.length - 1, 5);
  w.put(h.ncl - 4, 4);
  for (let i = 0; i < h.ncl; i++) w.put(h.clLens[CL_ORDER[i]], 3);
  const cc = canonicalCodes(h.clLens);
  for (let i = 0; i < h.clSyms.length; i++) {
    const s = h.clSyms[i];
    w.put(reverseBits(cc[s], h.clLens[s]), h.clLens[s]);
    if (s >= 16) w.put(h.clExtra[i], CL_EXTRA_BITS[s - 16]);
  }
}

/** stored で len バイトを書いたときのビット数（bit から書き始め、65535 バイトごとに分ける） */
export function storedBits(len: number, bit: number): number {
  let p = bit,
    left = len;
  do {
    const k = Math.min(left, STORED_MAX);
    p += 3;
    p = (p + 7) & ~7;
    p += 32 + 8 * k;
    left -= k;
  } while (left > 0);
  return p - bit;
}

/** ためた記号を 3 通りに書いたときの大きさ */
function blockCosts({ lf, df, extra }: Freqs, h: DynHeader, srcLen: number, bit: number): BlockSizes {
  let fixed = 3 + extra;
  for (let s = 0; s < 286; s++) fixed += lf[s] * FIXED_LIT_LENS[s];
  for (let s = 0; s < 30; s++) fixed += df[s] * 5;
  let dynamic = 3 + h.bits + extra;
  for (let s = 0; s < h.litLens.length; s++) dynamic += lf[s] * h.litLens[s];
  for (let s = 0; s < h.distLens.length; s++) dynamic += df[s] * h.distLens[s];
  return { stored: storedBits(srcLen, bit), fixed, dynamic };
}
