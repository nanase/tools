/**
 * Deflate のビット列の読み書き。値は下位ビットから詰め、バイトの中でも下位ビットが先に来る（RFC 1951 3.1.1）。
 * ハフマン符号だけは上位ビットから書くので、書く前に reverseBits で反転する
 */

/** 下位ビットから詰める書き手 */
export class BitWriter {
  private buf = new Uint8Array(1 << 16);
  private n = 0;
  private acc = 0;
  private nb = 0;

  /** 書いたビット数 */
  get bits(): number {
    return this.n * 8 + this.nb;
  }

  private room(k: number): void {
    if (this.n + k <= this.buf.length) return;
    let m = this.buf.length * 2;
    while (m < this.n + k) m *= 2;
    const b = new Uint8Array(m);
    b.set(this.buf.subarray(0, this.n));
    this.buf = b;
  }
  /** v の下位 n ビット（n ≤ 24）を書く */
  put(v: number, n: number): void {
    this.acc |= (v & ((1 << n) - 1)) << this.nb;
    this.nb += n;
    if (this.nb >= 8) {
      this.room(4);
      while (this.nb >= 8) {
        this.buf[this.n++] = this.acc & 0xff;
        this.acc >>>= 8;
        this.nb -= 8;
      }
    }
  }
  /** バイトの境目まで 0 で埋める。埋めたビット数を返す */
  align(): number {
    const pad = this.nb ? 8 - this.nb : 0;
    if (pad) this.put(0, pad);
    return pad;
  }
  /** バイトの境目から a[start .. end) をそのまま書く */
  bytes(a: Uint8Array, start = 0, end = a.length): void {
    this.room(end - start);
    this.buf.set(a.subarray(start, end), this.n);
    this.n += end - start;
  }
  /** 最後のバイトの残りを 0 で埋めた全体のコピー */
  out(): Uint8Array {
    this.align();
    return this.buf.slice(0, this.n);
  }
}

/** 下位ビットから読む読み手。読み過ぎると pos が末尾を越え、over が真になる（越えた分は 0 として読む） */
export class BitReader {
  /** 読んだビット数（先頭からのビット位置） */
  pos: number;
  readonly end: number;

  constructor(
    private readonly d: Uint8Array,
    startBit = 0,
  ) {
    this.pos = startBit;
    this.end = d.length * 8;
  }
  get over(): boolean {
    return this.pos > this.end;
  }
  /** 残りのビット数 */
  get left(): number {
    return this.end - this.pos;
  }
  bit(): number {
    const p = this.pos++;
    return p < this.end ? (this.d[p >> 3] >> (p & 7)) & 1 : 0;
  }
  /** n ビットを読み、最初のビットを最下位にした値を返す */
  read(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) v |= this.bit() << i;
    return v;
  }
  /** バイトの境目まで読み捨てる */
  align(): void {
    this.pos = (this.pos + 7) & ~7;
  }
}
