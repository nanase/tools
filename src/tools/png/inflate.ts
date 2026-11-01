/**
 * Deflate の復号（RFC 1951）。検査は puff.c（Mark Adler）と同じ水準で、ブロックの種類・LEN と NLEN・符号の数・
 * 符号長の符号の完全さ・繰り返しの前の長さ・終わりの記号の有無・符号の過不足・使えない記号・遠すぎる距離を見る。
 * 寛容モードでは壊れた所で止まり、そこまでの出力と止まったビット位置・理由を返す
 */
import { BitReader } from './bits';
import { buildDecoder, type HuffDecoder, MAX_BITS } from './huffman';
import { CL_ORDER, DIST_BASE, DIST_EXTRA, FIXED_DIST_LENS, FIXED_LIT_LENS, LEN_BASE, LEN_EXTRA } from './tables';
import { type BlockInfo, type DeflateTrace, TK_END, TK_LIT, TK_MATCH, TK_STORED, TokenLog } from './trace';

/** 止まった理由 */
export type InflateReason =
  /** 入力が途中で尽きた */
  | 'eof'
  /** BTYPE が 3 */
  | 'block-type'
  /** stored の NLEN が LEN の 1 の補数でない */
  | 'stored-len'
  /** HLIT が 286 を、HDIST が 30 を超える */
  | 'counts'
  /** 符号長の符号が完全でない */
  | 'cl-code'
  /** 最初の符号長が 16（繰り返す前の長さがない） */
  | 'cl-repeat'
  /** 符号長の繰り返しが送る数を超える */
  | 'cl-overflow'
  /** 終わりの記号 256 の符号がない */
  | 'no-eob'
  /** 文字・長さの符号が多すぎるか足りない */
  | 'lit-code'
  /** 距離の符号が多すぎるか足りない */
  | 'dist-code'
  /** どの符号にも当たらないビット列 */
  | 'bad-code'
  /** 長さの記号 286・287（固定ハフマンだけで出うる） */
  | 'bad-length'
  /** 距離の記号 30・31 */
  | 'bad-dist'
  /** 距離が出力の先頭より前を指す */
  | 'dist-too-far'
  /** 出力が上限 maxOut に達した */
  | 'out-limit'
  /** zlib の頭の誤り（方式が 8 でない・窓が 32 KiB を超える・FCHECK・辞書つき） */
  | 'zlib-method'
  | 'zlib-window'
  | 'zlib-check'
  | 'zlib-dict';

const MESSAGES: Record<InflateReason, string> = {
  eof: '入力が途中で尽きた',
  'block-type': 'ブロックの種類が 3（使えない値）',
  'stored-len': 'stored の LEN と NLEN が合わない',
  counts: '符号の数が多すぎる',
  'cl-code': '符号長の符号が完全でない',
  'cl-repeat': '繰り返す前の符号長がない',
  'cl-overflow': '符号長の繰り返しが多すぎる',
  'no-eob': '終わりの記号の符号がない',
  'lit-code': '文字・長さの符号が多すぎるか足りない',
  'dist-code': '距離の符号が多すぎるか足りない',
  'bad-code': 'どの符号にも当たらない',
  'bad-length': '使えない長さの記号',
  'bad-dist': '使えない距離の記号',
  'dist-too-far': '距離が出力の先頭より前を指す',
  'out-limit': '出力が上限に達した',
  'zlib-method': 'zlib の圧縮方式が 8 でない',
  'zlib-window': 'zlib の窓が 32 KiB を超える',
  'zlib-check': 'zlib の FCHECK が合わない',
  'zlib-dict': 'zlib の辞書つきには対応しない',
};

/** 復号の誤り。bit は誤りのあった要素（記号・ヘッダの欄）の先頭のビット位置 */
export class InflateError extends Error {
  constructor(
    readonly reason: InflateReason,
    readonly bit: number,
  ) {
    super(`${MESSAGES[reason]}（${bit} ビット目）`);
    this.name = 'InflateError';
  }
}

export interface InflateOptions {
  /** 壊れた所で throw せず、そこまでの結果を返す（既定 false） */
  tolerant?: boolean;
  /** 記録を取るか（既定 true） */
  trace?: boolean;
  /** 出力の上限 [バイト]。超える所で 'out-limit' で止まる */
  maxOut?: number;
  /** 読み始めるビット位置（既定 0） */
  startBit?: number;
}

export interface InflateResult {
  data: Uint8Array;
  /** 読み終えたビット位置（最後のブロックの終わり、止まったときはそこ） */
  bits: number;
  /** 最後のブロックまで読めたか */
  done: boolean;
  /** 寛容モードで止まった理由（止まらなければ null） */
  error: InflateError | null;
  trace: DeflateTrace | null;
}

/** 伸びる出力 */
class Out {
  buf: Uint8Array;
  n = 0;
  constructor(cap: number) {
    this.buf = new Uint8Array(Math.max(1024, cap));
  }
  room(k: number): void {
    if (this.n + k <= this.buf.length) return;
    let m = this.buf.length * 2;
    while (m < this.n + k) m *= 2;
    const b = new Uint8Array(m);
    b.set(this.buf.subarray(0, this.n));
    this.buf = b;
  }
}

const FIXED_LIT = buildDecoder(FIXED_LIT_LENS),
  FIXED_DIST = buildDecoder(FIXED_DIST_LENS);

/**
 * Deflate のデータを戻す。既定では不正なら InflateError を投げる。
 * tolerant なら投げずに、そこまでの出力と error を返す
 */
export function inflate(src: Uint8Array, opts: InflateOptions = {}): InflateResult {
  const r = new BitReader(src, opts.startBit ?? 0),
    maxOut = opts.maxOut ?? Infinity,
    out = new Out(Math.min(maxOut, src.length * 4)),
    log = (opts.trace ?? true) ? new TokenLog(Math.min(1 << 16, src.length + 16)) : null,
    blocks: BlockInfo[] = [];
  let mark = r.pos,
    done = false,
    error: InflateError | null = null,
    /* 最後に読んだハフマン符号（上位ビットが先頭）と長さ */
    lastCode = 0,
    lastLen = 0;

  const fail = (reason: InflateReason, at = mark): never => {
    throw new InflateError(reason, at);
  };
  const need = (): void => {
    if (r.over) fail('eof');
  };
  const bits = (n: number): number => {
    const v = r.read(n);
    need();
    return v;
  };
  /* 1 ビットずつ読み、長さごとの最初の符号と比べる（puff.c の decode） */
  const decode = (h: HuffDecoder): number => {
    let code = 0,
      first = 0,
      index = 0;
    for (let len = 1; len <= MAX_BITS; len++) {
      code |= r.bit();
      need();
      const count = h.count[len];
      if (code - count < first) {
        lastCode = code;
        lastLen = len;
        return h.symbol[index + (code - first)];
      }
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }
    return fail('bad-code');
  };

  const stored = (b: BlockInfo): void => {
    r.align();
    mark = r.pos;
    const len = bits(16),
      nlen = bits(16);
    if (len !== (~nlen & 0xffff)) fail('stored-len');
    b.headerBits = r.pos - b.start;
    const p = r.pos >> 3,
      avail = Math.max(0, Math.min(len, src.length - p)),
      k = Math.min(avail, maxOut - out.n);
    if (log) {
      log.push(TK_STORED, out.n, r.pos, 0, 0, 0);
      log.setLen(k, 0, 0);
      log.setBits(k * 8);
    }
    out.room(k);
    out.buf.set(src.subarray(p, p + k), out.n);
    out.n += k;
    r.pos += k * 8;
    if (k < len) fail(k < avail ? 'out-limit' : 'eof', r.pos);
  };

  const codes = (lit: HuffDecoder, dist: HuffDecoder, litLens: ArrayLike<number>): void => {
    for (;;) {
      mark = r.pos;
      const sym = decode(lit);
      if (sym < 256) {
        if (out.n >= maxOut) fail('out-limit');
        if (log) log.push(TK_LIT, out.n, mark, sym, lastCode, lastLen);
        out.room(1);
        out.buf[out.n++] = sym;
        continue;
      }
      if (sym === 256) {
        if (log) log.push(TK_END, out.n, mark, 256, lastCode, litLens[256]);
        return;
      }
      const lk = sym - 257;
      if (lk >= 29) fail('bad-length');
      const lc = lastCode,
        ll = lastLen,
        le = LEN_EXTRA[lk],
        lx = bits(le),
        len = LEN_BASE[lk] + lx;
      const dm = r.pos,
        dk = decode(dist),
        dc = lastCode,
        dl = lastLen;
      if (dk >= 30) fail('bad-dist', dm);
      const de = DIST_EXTRA[dk],
        dx = bits(de),
        d = DIST_BASE[dk] + dx;
      if (d > out.n) fail('dist-too-far');
      if (log) {
        log.push(TK_MATCH, out.n, mark, sym, lc, ll);
        log.setLen(len, lx, le);
        log.setDist(dk, dc, dl, d, dx, de);
      }
      const k = Math.min(len, maxOut - out.n);
      out.room(k);
      const buf = out.buf;
      for (let i = 0; i < k; i++, out.n++) buf[out.n] = buf[out.n - d];
      if (k < len) fail('out-limit');
    }
  };

  /* 動的ハフマンのヘッダ（3.2.7。puff.c の dynamic） */
  const dynamic = (b: BlockInfo): [HuffDecoder, HuffDecoder] => {
    mark = r.pos;
    const nlen = bits(5) + 257,
      ndist = bits(5) + 1,
      ncode = bits(4) + 4;
    b.hlit = nlen - 257;
    b.hdist = ndist - 1;
    b.hclen = ncode - 4;
    if (nlen > 286 || ndist > 30) fail('counts');
    const clLens = new Uint8Array(19);
    for (let i = 0; i < ncode; i++) {
      mark = r.pos;
      clLens[CL_ORDER[i]] = bits(3);
    }
    b.clLens = clLens;
    const clCode = buildDecoder(clLens);
    /* 符号長の符号は完全でなければならない */
    if (clCode.left !== 0) fail('cl-code', b.start + 17);
    const lens = new Uint8Array(nlen + ndist),
      syms: number[] = [],
      extra: number[] = [];
    let i = 0;
    while (i < nlen + ndist) {
      mark = r.pos;
      const s = decode(clCode);
      syms.push(s);
      if (s < 16) {
        extra.push(0);
        lens[i++] = s;
        continue;
      }
      let v = 0,
        rep: number;
      if (s === 16) {
        if (i === 0) fail('cl-repeat');
        v = lens[i - 1];
        const x = bits(2);
        extra.push(x);
        rep = 3 + x;
      } else if (s === 17) {
        const x = bits(3);
        extra.push(x);
        rep = 3 + x;
      } else {
        const x = bits(7);
        extra.push(x);
        rep = 11 + x;
      }
      if (i + rep > nlen + ndist) fail('cl-overflow');
      while (rep--) lens[i++] = v;
    }
    b.clSyms = Uint8Array.from(syms);
    b.clExtra = Uint8Array.from(extra);
    const litLens = lens.slice(0, nlen),
      distLens = lens.slice(nlen);
    b.litLens = litLens;
    b.distLens = distLens;
    b.headerBits = r.pos - b.start;
    mark = r.pos;
    if (litLens[256] === 0) fail('no-eob');
    /* 不完全な符号は長さ 1 の符号が 1 つだけのときに限って認める */
    const lit = buildDecoder(litLens);
    if (lit.left < 0 || (lit.left > 0 && nlen !== lit.count[0] + lit.count[1])) fail('lit-code');
    const dist = buildDecoder(distLens);
    if (dist.left < 0 || (dist.left > 0 && ndist !== dist.count[0] + dist.count[1])) fail('dist-code');
    return [lit, dist];
  };

  try {
    while (!done) {
      const b: BlockInfo = {
        type: 'stored',
        final: false,
        start: r.pos,
        end: r.pos,
        headerBits: 3,
        srcStart: out.n,
        srcEnd: out.n,
        tokenStart: log ? log.count : 0,
        tokenEnd: log ? log.count : 0,
        hlit: -1,
        hdist: -1,
        hclen: -1,
        clLens: null,
        litLens: null,
        distLens: null,
        clSyms: null,
        clExtra: null,
        sizes: null,
      };
      blocks.push(b);
      try {
        mark = r.pos;
        const last = bits(1) === 1,
          type = bits(2);
        b.final = last;
        if (type === 0) stored(b);
        else if (type === 1) {
          b.type = 'fixed';
          b.litLens = FIXED_LIT_LENS;
          b.distLens = FIXED_DIST_LENS;
          codes(FIXED_LIT, FIXED_DIST, FIXED_LIT_LENS);
        } else if (type === 2) {
          b.type = 'dynamic';
          const [lit, dist] = dynamic(b);
          codes(lit, dist, b.litLens as Uint8Array);
        } else fail('block-type');
        done = last;
      } finally {
        b.end = Math.min(r.pos, r.end);
        b.srcEnd = out.n;
        if (log) log.block++;
        b.tokenEnd = log ? log.count : 0;
      }
    }
  } catch (e) {
    if (!(e instanceof InflateError)) throw e;
    if (!opts.tolerant) throw e;
    error = e;
  }
  return {
    data: out.buf.slice(0, out.n),
    bits: Math.min(r.pos, r.end),
    done,
    error,
    trace: log ? { blocks, tokens: log.finish() } : null,
  };
}
