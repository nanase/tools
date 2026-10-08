/**
 * バイト列とビット列の読み書き。符号化したデータの中の 0xFF の後には 0x00 を挟む（T.81 F.1.2.3 のバイトスタッフィング）
 */

/** 伸びるバイト列 */
export class ByteWriter {
  private buf = new Uint8Array(1 << 16);
  n = 0;

  private room(k: number): void {
    if (this.n + k <= this.buf.length) return;
    let m = this.buf.length * 2;
    while (m < this.n + k) m *= 2;
    const b = new Uint8Array(m);
    b.set(this.buf.subarray(0, this.n));
    this.buf = b;
  }
  byte(v: number): void {
    this.room(1);
    this.buf[this.n++] = v & 0xff;
  }
  word(v: number): void {
    this.byte(v >> 8);
    this.byte(v);
  }
  bytes(a: ArrayLike<number>): void {
    this.room(a.length);
    for (let i = 0; i < a.length; i++) this.buf[this.n++] = a[i] & 0xff;
  }
  /** 書いた分のコピー */
  out(): Uint8Array {
    return this.buf.slice(0, this.n);
  }
}

/** 符号化したデータのビット列（上位ビットから詰める） */
export class BitWriter {
  private acc = 0;
  private nb = 0;
  /** 挟んだ 0x00 の数 */
  stuffed = 0;
  /** 書いたビット数（挟んだ 0x00 と最後の埋めを除く） */
  bits = 0;

  constructor(private readonly w: ByteWriter) {}

  put(v: number, n: number): void {
    if (!n) return;
    this.bits += n;
    for (let i = n - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | ((v >> i) & 1);
      if (++this.nb === 8) this.flushByte();
    }
  }
  private flushByte(): void {
    const b = this.acc & 0xff;
    this.w.byte(b);
    if (b === 0xff) {
      this.w.byte(0);
      this.stuffed++;
    }
    this.acc = 0;
    this.nb = 0;
  }
  /** 最後のバイトの残りを 1 で埋める。埋めたビット数を返す */
  finish(): number {
    const pad = this.nb ? 8 - this.nb : 0;
    for (let i = 0; i < pad; i++) {
      this.acc = (this.acc << 1) | 1;
      this.nb++;
    }
    if (pad) this.flushByte();
    return pad;
  }
}

/** 符号化したデータを 1 ビットずつ読む。0xFF 0x00 は 0xFF として読み、マーカーに当たったら 1 を返し続ける */
export class BitReader {
  private acc = 0;
  private nb = 0;
  /** マーカー（0xFF の後が 0x00 でないもの）に当たった */
  marker = -1;

  constructor(
    private readonly d: Uint8Array,
    public p: number,
  ) {}

  private fill(): void {
    let b = 0xff;
    if (this.marker < 0 && this.p < this.d.length) {
      b = this.d[this.p];
      if (b !== 0xff) this.p++;
      else if (this.d[this.p + 1] === 0) this.p += 2;
      else this.marker = this.d[this.p + 1];
    }
    this.acc = b;
    this.nb = 8;
  }
  bit(): number {
    if (!this.nb) this.fill();
    this.nb--;
    return (this.acc >> this.nb) & 1;
  }
  read(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | this.bit();
    return v;
  }
  /** バイトの境目まで読み捨てる（リスタートマーカーの前） */
  align(): void {
    this.nb = 0;
  }
}
