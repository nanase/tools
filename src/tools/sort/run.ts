/** 記録したアルゴリズムの再生。途中の状態を要所で残し、どの回数の時点へも移れる */
import type { Alg } from './algorithms';
import { type Counts, FIRST_MARK, type Mark, Rec, STOP, T } from './recorder';

/** 操作の回数の上限（単独・一覧と組み合わせの表） */
export const LIM_PLAY = 3000000;
/** 操作の回数の上限（比較は同時に 9 個を持つ） */
export const LIM_CMP = 1000000;

/** 音の種類: 比較・読み取り・書き込み（交換を含む） */
export type ToneKind = 'c' | 'r' | 'w';
/** 触った要素の種類: 0 読み取り・比較、1 書き込み・交換、2・3 は補助配列での同じ操作 */
export type TouchKind = 0 | 1 | 2 | 3;

export interface Result {
  c: Counts;
  total: number;
  trunc: boolean;
}

/** 回数だけを数える（組み合わせの表） */
export function countOps(alg: Alg, src: ArrayLike<number>, limit = LIM_PLAY): Result {
  const r = new Rec(src, Math.min(limit, alg.lim ?? limit), false);
  let trunc = false;
  try {
    alg.fn(r);
  } catch (e) {
    if (e !== STOP) throw e;
    trunc = true;
  }
  return { c: r.c, total: r.real, trunc };
}

/** 回数の少ない順の順位。同じ回数は同着にし、次の順位はその数だけ飛ばす（1, 1, 3） */
export function ranks(totals: readonly number[]): number[] {
  return totals.map((t) => 1 + totals.filter((o) => o < t).length);
}

interface Snap {
  rp: number;
  pos: number;
  a: Int32Array;
  x: Int32Array | null;
  fixd: Uint8Array;
  p1: number;
  p2: number;
  pv: number;
  rlo: number;
  rhi: number;
  inf: number;
  c: Counts;
}

const zero = (): Counts => ({ cmp: 0, swap: 0, read: 0, write: 0 });

export class Run {
  readonly n: number;
  readonly init: Int32Array;
  readonly trunc: boolean;
  readonly total: number;
  readonly final: Counts;
  readonly used: Partial<Record<Mark, 1>>;
  readonly vm: number;
  readonly auxN: number;
  /** 比較の枠の名前 */
  label: string;
  private readonly buf: Uint32Array;
  private readonly len: number;
  private readonly kf: Snap[] = [];

  a!: Int32Array;
  x: Int32Array | null = null;
  fixd!: Uint8Array;
  /** ピボットの位置 */
  p1 = -1;
  p2 = -1;
  /** 手元に持っているピボットの値 */
  pv = -1;
  rlo = -1;
  rhi = -1;
  /** ギャップなどの値 */
  inf = -1;
  private rp = 0;
  pos = 0;
  c: Counts = zero();
  /** 最後に触った要素 */
  ti: number[] = [];
  tk: TouchKind[] = [];
  /** 最後の確かめの位置（−1 は確かめていない） */
  sweep = -1;
  /** 確かめ終わった */
  ok = false;

  constructor(
    readonly alg: Alg,
    src: ArrayLike<number>,
    limit = LIM_PLAY,
  ) {
    this.n = src.length;
    this.label = alg.s;
    this.init = Int32Array.from(src as ArrayLike<number>);
    const r = new Rec(src, Math.min(limit, alg.lim ?? limit), true);
    let trunc = false;
    try {
      alg.fn(r);
      r.fix(0, r.n - 1);
    } catch (e) {
      if (e !== STOP) throw e;
      trunc = true;
    }
    this.trunc = trunc;
    this.buf = r.buf;
    this.len = r.len;
    this.total = r.real;
    this.final = r.c;
    this.used = r.used;
    this.vm = r.vm;
    this.auxN = r.x.length;
    /* 全体の約 200 か所で状態を残す */
    const step = Math.max(512, Math.ceil(this.total / 200));
    this.reset();
    let next = 0;
    while (this.rp < this.len) {
      if (this.pos >= next) {
        this.kf.push(this.snap());
        next = this.pos + step;
      }
      this.step(null, false);
    }
    this.reset();
  }

  reset(): void {
    this.a = this.init.slice();
    this.x = this.auxN ? new Int32Array(this.auxN) : null;
    this.fixd = new Uint8Array(this.n);
    this.p1 = this.p2 = this.pv = this.rlo = this.rhi = this.inf = -1;
    this.rp = 0;
    this.pos = 0;
    this.c = zero();
    this.ti = [];
    this.tk = [];
    this.sweep = -1;
    this.ok = false;
    this.marks();
  }

  private snap(): Snap {
    return {
      rp: this.rp,
      pos: this.pos,
      a: this.a.slice(),
      x: this.x ? this.x.slice() : null,
      fixd: this.fixd.slice(),
      p1: this.p1,
      p2: this.p2,
      pv: this.pv,
      rlo: this.rlo,
      rhi: this.rhi,
      inf: this.inf,
      c: { ...this.c },
    };
  }

  /** 次の操作までの印を当てる */
  private marks(): void {
    while (this.rp < this.len) {
      const v = this.buf[this.rp],
        t = v >>> 28;
      if (t < FIRST_MARK) return;
      const x = ((v >>> 14) & 0x3fff) - 1,
        y = (v & 0x3fff) - 1;
      switch (t) {
        case T.PIVOT:
          this.p1 = x;
          break;
        case T.PIVOT2:
          this.p2 = x;
          break;
        case T.PVAL:
          this.pv = x;
          break;
        case T.RANGE:
          this.rlo = x;
          this.rhi = y;
          break;
        case T.FIX:
          if (x >= 0) this.fixd.fill(1, x, y + 1);
          break;
        case T.INFO:
          this.inf = x;
          break;
        case T.ACLR:
          this.x?.fill(0, x, y + 1);
          break;
        default:
          break;
      }
      this.rp++;
    }
  }

  private touch(i: number, k: TouchKind): void {
    this.ti.push(i);
    this.tk.push(k);
  }

  /** 操作を 1 回進める。tone があれば鳴らす値を渡し、touch なら触った要素を残す */
  step(tone: ((v: number, k: ToneKind) => void) | null, touch: boolean): boolean {
    if (this.rp >= this.len) return false;
    const v = this.buf[this.rp],
      t = v >>> 28,
      i = ((v >>> 14) & 0x3fff) - 1,
      j = (v & 0x3fff) - 1,
      a = this.a,
      c = this.c;
    switch (t) {
      case T.CMP:
        c.cmp++;
        if (tone) {
          tone(a[i], 'c');
          tone(a[j], 'c');
        }
        if (touch) {
          this.touch(i, 0);
          this.touch(j, 0);
        }
        break;
      case T.CMPV:
        c.cmp++;
        if (tone) {
          tone(a[i], 'c');
          tone(j, 'c');
        }
        if (touch) this.touch(i, 0);
        break;
      case T.SWAP: {
        c.swap++;
        const s = a[i];
        a[i] = a[j];
        a[j] = s;
        if (this.p1 === i) this.p1 = j;
        else if (this.p1 === j) this.p1 = i;
        if (this.p2 === i) this.p2 = j;
        else if (this.p2 === j) this.p2 = i;
        if (tone) {
          tone(a[i], 'w');
          tone(a[j], 'w');
        }
        if (touch) {
          this.touch(i, 1);
          this.touch(j, 1);
        }
        break;
      }
      case T.READ:
        c.read++;
        if (tone) tone(a[i], 'r');
        if (touch) this.touch(i, 0);
        break;
      case T.WRITE:
        c.write++;
        a[i] = j;
        if (tone) tone(j, 'w');
        if (touch) this.touch(i, 1);
        break;
      case T.AGET:
        c.read++;
        if (tone && this.x) tone(this.x[i], 'r');
        if (touch) this.touch(i, 2);
        break;
      case T.ASET:
        c.write++;
        if (this.x) this.x[i] = j;
        if (tone) tone(j, 'w');
        if (touch) this.touch(i, 3);
        break;
      default:
        break;
    }
    this.rp++;
    this.pos++;
    this.marks();
    return true;
  }

  /** p 回目の操作のあとへ移る */
  seek(p0: number): void {
    const p = Math.max(0, Math.min(this.total, Math.round(p0)));
    let s: Snap | null = null;
    for (const f of this.kf) {
      if (f.pos <= p) s = f;
      else break;
    }
    if (p < this.pos || (s && s.pos > this.pos)) {
      if (s) {
        this.a = s.a.slice();
        this.x = s.x ? s.x.slice() : null;
        this.fixd = s.fixd.slice();
        this.p1 = s.p1;
        this.p2 = s.p2;
        this.pv = s.pv;
        this.rlo = s.rlo;
        this.rhi = s.rhi;
        this.inf = s.inf;
        this.rp = s.rp;
        this.pos = s.pos;
        this.c = { ...s.c };
      } else this.reset();
    }
    this.ti = [];
    this.tk = [];
    this.sweep = -1;
    this.ok = false;
    while (this.pos < p - 1) this.step(null, false);
    if (this.pos < p) this.step(null, true);
  }

  get done(): boolean {
    return this.pos >= this.total;
  }
}
