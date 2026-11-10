/**
 * 音の標本化と復元を流れのまま行う（ワークレットで使う）。
 * 標本の時刻は 1 つずつ「前の標本 + 1 / fs」で決め、決めた標本は動かさない。標本化周波数を変えると
 * 次の標本から間隔が変わるだけなので、復元した音は途切れない。fs は目標へ対数で滑らかに寄せる。
 * fs が目標に着いたら、標本の時刻を n / fs（入力の位相 0 から数えた格子）にそろえる。図の標本と同じ位置になり、
 * fs = 2f ちょうどの正弦波は図と同じく 0 の所で測って無音になる
 */
import { autoFs, ker, L, type Sig, source } from './signal';

export type Hear = 'orig' | 'rec';
export interface StreamSet {
  sig: Sig;
  /** 標本化周波数の目標 [Hz]（auto のときは使わない） */
  fs: number;
  /** 入力のローパス */
  aa: boolean;
  hear: Hear;
  /** 標本化周波数を自動で下げる */
  auto: boolean;
}

/** fs を目標へ寄せる時定数 [s] */
const GLIDE = 0.04;
/** 原音と復元した音を切り替える時間 [s] */
const XFADE = 0.03;
/** fs が目標に着いたとみなす比の差 */
const SNAP = 1e-4;
/** 原音の帯域 [Hz] */
const ORIG_TOP = 20000;
/** 標本の環の大きさ（2L + 2 以上の 2 の累乗） */
const RING = 64;

export class Stream {
  /** 今の時刻 [s] */
  t = 0;
  /** 今の標本化周波数 [Hz] */
  fs = 8000;
  private readonly dt: number;
  private readonly glide: number;
  private readonly tn = new Float64Array(RING);
  private readonly xn = new Float64Array(RING);
  /** 決めた標本の最後の番号と、t_cur ≤ t < t_cur+1 の番号 */
  private hi = 0;
  private cur = 0;
  /** 0 = 原音、1 = 復元した音 */
  private mix = 1;
  private set: StreamSet;
  private val: (t: number, fc: number) => number;

  constructor(
    private readonly rate: number,
    set: StreamSet,
  ) {
    this.dt = 1 / rate;
    this.glide = 1 - Math.exp(-this.dt / GLIDE);
    this.set = set;
    this.val = source(set.sig);
    this.mix = set.hear === 'rec' ? 1 : 0;
    this.reset(0);
  }

  private target(t: number): number {
    return this.set.auto ? autoFs(t) : this.set.fs;
  }

  /** 設定を変える。すでに決めた標本（先の L 個まで）は前の設定のまま */
  update(set: StreamSet): void {
    if (set.sig.src !== this.set.sig.src || set.sig.f !== this.set.sig.f) {
      this.val = source(set.sig);
    }
    this.set = set;
  }

  /** 時刻 t0 から始め直す（標本を今の fs で並べ直す） */
  reset(t0: number): void {
    this.t = t0;
    this.fs = this.target(t0);
    this.cur = 0;
    /* t0 の直前の格子の点から並べる */
    const k0 = Math.floor(t0 * this.fs + 1e-9);
    for (let n = -L; n <= L + 1; n++) this.commit(n, (k0 + n) / this.fs);
    this.hi = L + 1;
  }

  /** 前の標本 tp の次の標本の時刻。fs が目標に着いていれば格子 k / fs にそろえる（間隔は 0.5〜1.5 / fs） */
  private next(tp: number, settled: boolean): number {
    const fs = this.fs,
      t = tp + 1 / fs;
    if (!settled) return t;
    const k = Math.round(t * fs);
    return k / fs > tp + 0.5 / fs ? k / fs : (k + 1) / fs;
  }

  private commit(n: number, tt: number): void {
    const i = n & (RING - 1);
    this.tn[i] = tt;
    this.xn[i] = this.val(tt, this.set.aa ? this.fs / 2 : Number.POSITIVE_INFINITY);
  }

  /** out を埋める */
  render(out: Float32Array): void {
    const M = RING - 1,
      { tn, xn } = this,
      step = 1 / (XFADE * this.rate),
      want = this.set.hear === 'rec' ? 1 : 0;
    for (let i = 0; i < out.length; i++) {
      const t = this.t;
      /* fs を目標へ（対数で）寄せる */
      const tg = this.target(t);
      if (tg !== this.fs) {
        const r = Math.log(tg / this.fs);
        this.fs = Math.abs(r) < SNAP ? tg : this.fs * Math.exp(this.glide * r);
      }
      const settled = !this.set.auto && this.fs === tg;
      /* t を挟む標本を探し、先の L 個まで標本を決める */
      for (;;) {
        while (this.hi < this.cur + L + 1) {
          this.commit(this.hi + 1, this.next(tn[this.hi & M], settled));
          this.hi++;
        }
        if (t >= tn[(this.cur + 1) & M]) this.cur++;
        else break;
      }
      const c = this.cur,
        t0 = tn[c & M],
        p = (t - t0) / (tn[(c + 1) & M] - t0);
      if (this.mix !== want) this.mix = want ? Math.min(1, this.mix + step) : Math.max(0, this.mix - step);
      const m = this.mix;
      let rec = 0;
      if (m > 0) for (let j = -L + 1; j <= L; j++) rec += xn[(c + j) & M] * ker(p - j);
      out[i] = m === 1 ? rec : (1 - m) * this.val(t, ORIG_TOP) + m * rec;
      this.t = t + this.dt;
    }
  }
}
