/**
 * 疑似乱数（DOM に依存しない）: xorshift128（Marsaglia 2003）の一様分布と、Box–Muller 法の正規分布。
 * 種が同じなら同じ並びになる
 */
export class Rng {
  private x: number;
  private y: number;
  private z: number;
  private w: number;
  /** Box–Muller の 2 つ目の値 */
  private spare = Number.NaN;

  constructor(seed: number) {
    /* 種を splitmix32 で 4 語に広げる（すべて 0 にはならない） */
    let s = seed >>> 0;
    const next = () => {
      s = (s + 0x9e3779b9) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
      t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
      return (t ^ (t >>> 15)) >>> 0;
    };
    this.x = next();
    this.y = next();
    this.z = next();
    this.w = next() | 1;
  }

  /** 32 ビットの整数（0〜2³²−1） */
  u32(): number {
    const t = this.x ^ (this.x << 11);
    this.x = this.y;
    this.y = this.z;
    this.z = this.w;
    this.w = (this.w ^ (this.w >>> 19) ^ (t ^ (t >>> 8))) >>> 0;
    return this.w;
  }

  /** [0, 1) の一様分布 */
  uni(): number {
    return this.u32() / 4294967296;
  }

  /** 標準正規分布（平均 0、分散 1） */
  gauss(): number {
    if (!Number.isNaN(this.spare)) {
      const v = this.spare;
      this.spare = Number.NaN;
      return v;
    }
    /* u1 は (0, 1)。log(0) を避ける */
    const u1 = (this.u32() + 0.5) / 4294967296,
      u2 = this.uni(),
      r = Math.sqrt(-2 * Math.log(u1)),
      th = 2 * Math.PI * u2;
    this.spare = r * Math.sin(th);
    return r * Math.cos(th);
  }
}
