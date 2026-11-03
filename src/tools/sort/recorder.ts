/**
 * アルゴリズムの操作の記録。比較・交換・読み取り・書き込みを数え、再生のために 1 操作を 32 ビットへ詰めて残す。
 * 印（ピボット・範囲など）は操作の回数に入れず、次の操作と同時に表へ出す
 */

/** 操作と印の種類。FIRST_MARK 未満が操作、以上が印。4 ビットに収める */
export const T = {
  CMP: 0,
  CMPV: 1,
  SWAP: 2,
  READ: 3,
  WRITE: 4,
  AGET: 5,
  ASET: 6,
  PIVOT: 7,
  PIVOT2: 8,
  PVAL: 9,
  RANGE: 10,
  FIX: 11,
  INFO: 12,
  AUX: 13,
  ACLR: 14,
} as const;
export const FIRST_MARK = T.PIVOT;

/** 再生の上限を超えたときに投げる値 */
export const STOP = Symbol('stop');

export interface Counts {
  cmp: number;
  swap: number;
  read: number;
  write: number;
}

/** アルゴリズムが使った印 */
export type Mark = 'pivot' | 'range' | 'fix' | 'info' | 'aux';

/** 種類 4 ビット・引数 14 ビットずつ。引数は −1 から 16382 まで */
export const pack = (t: number, x: number, y: number): number => ((t << 28) | ((x + 1) << 14) | (y + 1)) >>> 0;

export class Rec {
  readonly a: Int32Array;
  readonly n: number;
  /** バーの高さの最大 */
  readonly vm: number;
  /** 比較に使うキーの最大（keyShift を除いた値） */
  readonly km: number;
  buf: Uint32Array;
  len = 0;
  /** 操作の回数 */
  real = 0;
  readonly c: Counts = { cmp: 0, swap: 0, read: 0, write: 0 };
  readonly used: Partial<Record<Mark, 1>> = {};
  x: Int32Array = new Int32Array(0);

  /**
   * @param record false なら数えるだけ（組み合わせの表）
   * @param keyShift 値をこのビット数だけ右へずらしてキーにする（安定性の試験で、下位ビットに元の位置を入れる）
   */
  constructor(
    src: ArrayLike<number>,
    private readonly limit: number,
    private readonly record: boolean,
    private readonly keyShift = 0,
  ) {
    this.a = Int32Array.from(src as ArrayLike<number>);
    this.n = src.length;
    this.buf = new Uint32Array(record ? 8192 : 0);
    let vm = 1;
    for (let i = 0; i < src.length; i++) if (src[i] > vm) vm = src[i];
    this.vm = vm;
    this.km = vm >> keyShift;
  }

  private p(t: number, x: number, y: number): void {
    if (this.record) {
      if (this.len >= this.buf.length) {
        const b = new Uint32Array(this.buf.length * 2);
        b.set(this.buf);
        this.buf = b;
      }
      this.buf[this.len++] = pack(t, x, y);
    }
    if (t < FIRST_MARK && ++this.real >= this.limit) throw STOP;
  }

  /** 値のキー */
  key(v: number): number {
    return v >> this.keyShift;
  }
  /** a[i] と a[j] の比較 */
  cmp(i: number, j: number): number {
    this.c.cmp++;
    this.p(T.CMP, i, j);
    return (this.a[i] >> this.keyShift) - (this.a[j] >> this.keyShift);
  }
  /** a[i] と手元の値の比較 */
  cmpv(i: number, v: number): number {
    this.c.cmp++;
    this.p(T.CMPV, i, v);
    return (this.a[i] >> this.keyShift) - (v >> this.keyShift);
  }
  swap(i: number, j: number): void {
    this.c.swap++;
    this.p(T.SWAP, i, j);
    const t = this.a[i];
    this.a[i] = this.a[j];
    this.a[j] = t;
  }
  get(i: number): number {
    this.c.read++;
    this.p(T.READ, i, 0);
    return this.a[i];
  }
  set(i: number, v: number): void {
    this.c.write++;
    this.p(T.WRITE, i, v);
    this.a[i] = v;
  }
  /** 補助配列を用意する */
  auxNew(n: number): void {
    this.x = new Int32Array(n);
    this.used.aux = 1;
    this.p(T.AUX, n, 0);
  }
  aget(k: number): number {
    this.c.read++;
    this.p(T.AGET, k, 0);
    return this.x[k];
  }
  aset(k: number, v: number): void {
    this.c.write++;
    this.p(T.ASET, k, v);
    this.x[k] = v;
  }
  /** 補助配列の lo〜hi を空にする（図のため。回数に入れない） */
  aclr(lo: number, hi: number): void {
    this.p(T.ACLR, lo, hi);
    this.x.fill(0, lo, hi + 1);
  }
  /** 印: ピボットの位置（−1 で消す） */
  pivot(i: number): void {
    this.used.pivot = 1;
    this.p(T.PIVOT, i, 0);
  }
  pivot2(i: number): void {
    this.used.pivot = 1;
    this.p(T.PIVOT2, i, 0);
  }
  /** 印: 手元に持っているピボットの値（−1 で消す） */
  pval(v: number): void {
    this.used.pivot = 1;
    this.p(T.PVAL, v, 0);
  }
  /** 印: 今の範囲（−1 で消す） */
  range(lo: number, hi: number): void {
    this.used.range = 1;
    this.p(T.RANGE, lo, hi);
  }
  /** 印: 位置が確定した要素 */
  fix(lo: number, hi: number): void {
    this.used.fix = 1;
    this.p(T.FIX, lo, hi);
  }
  /** 印: ギャップや桁の値 */
  info(v: number): void {
    this.used.info = 1;
    this.p(T.INFO, v, 0);
  }
}
