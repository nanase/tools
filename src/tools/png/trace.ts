/**
 * Deflate の記録（符号化・復号で同じ形）。ビット位置は Deflate のデータの先頭からのビット数で、
 * zlib に包んだときは 2 バイトの頭の後から数える。記号は数が多いので欄ごとの型付き配列に詰める。
 * どれも素のオブジェクトと型付き配列だけなので、Worker から postMessage でそのまま渡せる
 */

export type BlockType = 'stored' | 'fixed' | 'dynamic';

/** 候補ごとのブロックの大きさ [ビット]（符号化側だけ。ヘッダと終わりの記号を含む） */
export interface BlockSizes {
  stored: number;
  fixed: number;
  dynamic: number;
}

/** 1 つのブロック（RFC 1951 3.2.3） */
export interface BlockInfo {
  type: BlockType;
  final: boolean;
  /** ブロックの先頭（BFINAL のビット）と末尾（次のブロックの先頭）のビット位置 */
  start: number;
  end: number;
  /** ヘッダのビット数。stored は BFINAL・BTYPE・埋め・LEN・NLEN、dynamic は符号長の表の終わりまで */
  headerBits: number;
  /** 元データの範囲 [srcStart, srcEnd) */
  srcStart: number;
  srcEnd: number;
  /** このブロックの記号の範囲 [tokenStart, tokenEnd) */
  tokenStart: number;
  tokenEnd: number;
  /**
   * dynamic のヘッダの値（3.2.7）。HLIT は 文字・長さの符号の数 − 257、HDIST は 距離の符号の数 − 1、
   * HCLEN は 符号長の符号の数 − 4。dynamic でなければ -1
   */
  hlit: number;
  hdist: number;
  hclen: number;
  /** 符号長の符号 0〜18 の長さ（記号の順、19 個）。dynamic だけ */
  clLens: Uint8Array | null;
  /** 文字・長さと距離の符号長。dynamic は送った数だけ、fixed は決まった表（288 個・32 個）、stored は null */
  litLens: Uint8Array | null;
  distLens: Uint8Array | null;
  /** 符号長の並びを符号長の符号で書いた記号（0〜18）と、16・17・18 の付加ビットの値。dynamic だけ */
  clSyms: Uint8Array | null;
  clExtra: Uint8Array | null;
  /** 候補ごとの大きさ。符号化側だけ。stored が 65535 バイトを超えて分かれたときは、分けたどれにも同じものを付ける */
  sizes: BlockSizes | null;
}

/** 記号の種類 */
export const TK_LIT = 0;
export const TK_MATCH = 1;
/** ブロックの終わり（記号 256） */
export const TK_END = 2;
/** stored ブロックの中身（len バイトをそのまま） */
export const TK_STORED = 3;

/**
 * 記号の表。i 番目の記号は各配列の i 番目
 * - kind: TK_LIT・TK_MATCH・TK_END・TK_STORED
 * - pos: 元データの中の位置（終わりの記号は次のバイトの位置）
 * - bit: 圧縮データの中のビット位置。nbits はハフマン符号と付加ビットを合わせたビット数
 * - sym: 文字・長さの記号 0〜285（文字はその値、終わりは 256）。code・codeLen はそのハフマン符号（上位ビットが先頭）
 * - len: 一致の長さ（stored は LEN）。lenExtra・lenExtraBits は長さの付加ビットの値と数
 * - dsym: 距離符号の番号 0〜29。dcode・dcodeLen はそのハフマン符号。dist は距離、distExtra・distExtraBits は付加ビット
 * - block: ブロックの番号
 */
export interface Tokens {
  count: number;
  kind: Uint8Array;
  pos: Int32Array;
  bit: Int32Array;
  nbits: Int32Array;
  sym: Uint16Array;
  code: Uint16Array;
  codeLen: Uint8Array;
  len: Uint16Array;
  lenExtra: Uint16Array;
  lenExtraBits: Uint8Array;
  dsym: Uint8Array;
  dcode: Uint16Array;
  dcodeLen: Uint8Array;
  dist: Uint16Array;
  distExtra: Uint16Array;
  distExtraBits: Uint8Array;
  block: Int32Array;
}

export interface DeflateTrace {
  blocks: BlockInfo[];
  tokens: Tokens;
}

/** 1 つの記号を取り出した形 */
export interface Token {
  kind: 'lit' | 'match' | 'end' | 'stored';
  pos: number;
  bit: number;
  nbits: number;
  block: number;
  sym: number;
  code: number;
  codeLen: number;
  len: number;
  lenExtra: number;
  lenExtraBits: number;
  dsym: number;
  dcode: number;
  dcodeLen: number;
  dist: number;
  distExtra: number;
  distExtraBits: number;
}

const KINDS = ['lit', 'match', 'end', 'stored'] as const;

/** i 番目の記号 */
export function tokenAt(t: Tokens, i: number): Token {
  return {
    kind: KINDS[t.kind[i]],
    pos: t.pos[i],
    bit: t.bit[i],
    nbits: t.nbits[i],
    block: t.block[i],
    sym: t.sym[i],
    code: t.code[i],
    codeLen: t.codeLen[i],
    len: t.len[i],
    lenExtra: t.lenExtra[i],
    lenExtraBits: t.lenExtraBits[i],
    dsym: t.dsym[i],
    dcode: t.dcode[i],
    dcodeLen: t.dcodeLen[i],
    dist: t.dist[i],
    distExtra: t.distExtra[i],
    distExtraBits: t.distExtraBits[i],
  };
}

/** 記号が作るバイト数（文字は 1、一致と stored は len、終わりは 0） */
export const tokenBytes = (t: Tokens, i: number): number =>
  t.kind[i] === TK_LIT ? 1 : t.kind[i] === TK_END ? 0 : t.len[i];

/** ビット位置 bit を含む記号の番号（二分探索。ヘッダなど記号の外なら -1） */
export function tokenAtBit(t: Tokens, bit: number): number {
  let lo = 0,
    hi = t.count - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (t.bit[m] <= bit) lo = m + 1;
    else hi = m - 1;
  }
  return hi >= 0 && bit < t.bit[hi] + t.nbits[hi] ? hi : -1;
}

/** 元データの位置 pos を作った記号の番号（二分探索。なければ -1） */
export function tokenAtPos(t: Tokens, pos: number): number {
  let lo = 0,
    hi = t.count - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (t.pos[m] <= pos) lo = m + 1;
    else hi = m - 1;
  }
  /* 同じ位置に中身のない終わりの記号が続くので、中身のある記号まで戻る */
  while (hi >= 0 && tokenBytes(t, hi) === 0) hi--;
  return hi >= 0 && pos < t.pos[hi] + tokenBytes(t, hi) ? hi : -1;
}

const FIELDS = [
  'kind',
  'pos',
  'bit',
  'nbits',
  'sym',
  'code',
  'codeLen',
  'len',
  'lenExtra',
  'lenExtraBits',
  'dsym',
  'dcode',
  'dcodeLen',
  'dist',
  'distExtra',
  'distExtraBits',
  'block',
] as const satisfies readonly (keyof Tokens)[];

function alloc(n: number): Tokens {
  return {
    count: 0,
    kind: new Uint8Array(n),
    pos: new Int32Array(n),
    bit: new Int32Array(n),
    nbits: new Int32Array(n),
    sym: new Uint16Array(n),
    code: new Uint16Array(n),
    codeLen: new Uint8Array(n),
    len: new Uint16Array(n),
    lenExtra: new Uint16Array(n),
    lenExtraBits: new Uint8Array(n),
    dsym: new Uint8Array(n),
    dcode: new Uint16Array(n),
    dcodeLen: new Uint8Array(n),
    dist: new Uint16Array(n),
    distExtra: new Uint16Array(n),
    distExtraBits: new Uint8Array(n),
    block: new Int32Array(n),
  };
}

/** 記録を取らないときの空の表 */
export const emptyTokens = (): Tokens => alloc(0);

/** 記号を書き足していく入れ物。新しい欄は 0 から始まる */
export class TokenLog {
  private t: Tokens;
  /** 今のブロックの番号 */
  block = 0;

  constructor(cap = 4096) {
    this.t = alloc(Math.max(16, cap));
  }
  get count(): number {
    return this.t.count;
  }
  private grow(): void {
    const o = this.t,
      n = alloc(o.kind.length * 2);
    for (const k of FIELDS) (n[k] as Uint8Array).set(o[k] as Uint8Array);
    n.count = o.count;
    this.t = n;
  }
  /** 記号を 1 つ足し、その番号を返す。長さ・距離は setLen・setDist で入れる */
  push(kind: number, pos: number, bit: number, sym: number, code: number, codeLen: number): number {
    if (this.t.count === this.t.kind.length) this.grow();
    const t = this.t,
      i = t.count++;
    t.kind[i] = kind;
    t.pos[i] = pos;
    t.bit[i] = bit;
    t.nbits[i] = codeLen;
    t.sym[i] = sym;
    t.code[i] = code;
    t.codeLen[i] = codeLen;
    t.block[i] = this.block;
    return i;
  }
  /** 直前の記号に一致の長さ（stored は LEN）と付加ビットを入れる */
  setLen(len: number, extra: number, extraBits: number): void {
    const t = this.t,
      i = t.count - 1;
    t.len[i] = len;
    t.lenExtra[i] = extra;
    t.lenExtraBits[i] = extraBits;
    t.nbits[i] += extraBits;
  }
  /** 直前の記号に距離を入れる */
  setDist(dsym: number, dcode: number, dcodeLen: number, dist: number, extra: number, extraBits: number): void {
    const t = this.t,
      i = t.count - 1;
    t.dsym[i] = dsym;
    t.dcode[i] = dcode;
    t.dcodeLen[i] = dcodeLen;
    t.dist[i] = dist;
    t.distExtra[i] = extra;
    t.distExtraBits[i] = extraBits;
    t.nbits[i] += dcodeLen + extraBits;
  }
  /** 直前の記号のビット数を入れ直す */
  setBits(nbits: number): void {
    this.t.nbits[this.t.count - 1] = nbits;
  }
  /** 書いた分だけに切り詰めた表 */
  finish(): Tokens {
    const o = this.t,
      n = alloc(0);
    for (const k of FIELDS) (n as unknown as Record<string, Uint8Array>)[k] = (o[k] as Uint8Array).slice(0, o.count);
    n.count = o.count;
    return n;
  }
}
