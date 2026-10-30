/**
 * 分岐図の濃さ（W × H 画素）を、回を重ねて細かくする。
 * 1 回ごとに、どの列も列の中で r をずらした軌道を 1 本ずつ足す（横のアンチエイリアス）。
 * 縦は 1 画素を SS 段に分けて数え、点を幅 1 画素の箱で広げてから濃さにし、SS 段を平均する（縦のアンチエイリアス）。
 * 濃さは回数 n を 1 − exp(−n/s) にした値で、周期の点は濃く、カオスの帯は薄い。軌道ごとに濃さにしてから平均するので、
 * 周期の点の線は太らず、画素にかかる割合の濃さになる
 */
import { type MapDef, Walker } from './map';
import type { View } from './params';

/** 細かくする回数（1 回目を含む） */
export const PASSES = 16;
/** 1 画素を縦に分ける段の数 */
const SS = 4;

/** 回 k の列の中の位置 0〜1。1 回目は列の中央、以後は van der Corput 列で隙間を半分ずつ埋める */
export function offset(k: number): number {
  let v = 0,
    f = 0.5;
  for (let q = k; q; q >>= 1, f /= 2) if (q & 1) v += f;
  return (v + 0.5) % 1;
}

export class Density {
  /** 回ごとの濃さ 0〜1 の和（画素ごと、上の行から） */
  readonly ink: Float32Array;
  /** 終わった回の数 */
  passes = 0;
  /** 今の回で次に計算する列 */
  private col = 0;
  private readonly diff: Int32Array;
  private readonly lut: Float32Array;
  private readonly seeds: number[];
  constructor(
    readonly m: MapDef,
    readonly v: View,
    readonly W: number,
    readonly H: number,
    readonly skip: number,
    readonly keep: number,
  ) {
    this.ink = new Float32Array(W * H);
    this.diff = new Int32Array(H * SS + 1);
    this.seeds = m.odd ? [m.x0, -m.x0] : [m.x0];
    const s = (2 * keep) / H + 0.6,
      n = keep * this.seeds.length;
    this.lut = new Float32Array(n + 1);
    for (let i = 1; i <= n; i++) this.lut[i] = 1 - Math.exp(-i / s);
  }

  get done(): boolean {
    return this.passes >= PASSES;
  }

  /** 時刻 until [ms]（performance.now()）まで列を計算する。回が 1 つ終わったら true */
  work(until: number): boolean {
    const { W, v } = this,
      u = offset(this.passes);
    while (!this.done) {
      this.column(this.col, v.r0 + ((this.col + u) / W) * (v.r1 - v.r0));
      if (++this.col >= W) {
        this.col = 0;
        this.passes++;
        return true;
      }
      if ((this.col & 7) === 0 && performance.now() >= until) return false;
    }
    return false;
  }

  /** 列 i に r の軌道を足す */
  private column(i: number, r: number): void {
    const { m, v, W, H, diff, lut, ink } = this,
      Hf = H * SS,
      k = Hf / (v.y1 - v.y0),
      h = SS / 2;
    diff.fill(0);
    for (const s0 of this.seeds) {
      const w = new Walker(m, r, s0).run(this.skip);
      for (let n = 0; n < this.keep; n++) {
        const x = w.step();
        if (Number.isNaN(x)) break;
        let t = (v.y1 - x) * k;
        if (v.flip) t = Hf - t;
        const a = Math.round(t - h),
          b = a + SS;
        if (b <= 0 || a >= Hf) continue;
        diff[a > 0 ? a : 0]++;
        diff[b < Hf ? b : Hf]--;
      }
    }
    let n = 0;
    for (let j = 0, p = i; j < H; j++, p += W) {
      let sum = 0;
      for (let q = 0; q < SS; q++) {
        n += diff[j * SS + q];
        sum += lut[n];
      }
      ink[p] += sum / SS;
    }
  }
}
