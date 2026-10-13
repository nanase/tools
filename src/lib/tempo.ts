/** 曲の途中のテンポの変化（楽器のページで共通。DOM に依存しない） */

/**
 * テンポの比の表から、拍 b までの「標準のテンポでの拍の長さに直した時間」τ(b) = ∫ db / 比 を求める。
 * 演奏の時刻は τ に 1 拍の秒数を掛けたもの
 */
export class TempoMap {
  private readonly b: number[];
  private readonly r: number[];
  private readonly t: number[];
  constructor(pts: readonly (readonly [number, number])[]) {
    /* 拍 0 の比（表になければ 1）から始める */
    const r0 = pts.find(([b]) => b <= 0)?.[1] ?? 1,
      p = [[0, r0], ...pts.filter(([b]) => b > 0)].sort((x, y) => x[0] - y[0]);
    this.b = p.map((x) => x[0]);
    this.r = p.map((x) => x[1]);
    this.t = [0];
    for (let i = 1; i < p.length; i++) this.t.push(this.t[i - 1] + (this.b[i] - this.b[i - 1]) / this.r[i - 1]);
  }
  private seg(b: number): number {
    let i = this.b.length - 1;
    while (i > 0 && this.b[i] > b) i--;
    return i;
  }
  tau(b: number): number {
    const i = this.seg(b);
    return this.t[i] + (b - this.b[i]) / this.r[i];
  }
  /** τ から拍へ戻す */
  beat(tau: number): number {
    let i = this.t.length - 1;
    while (i > 0 && this.t[i] > tau) i--;
    return this.b[i] + (tau - this.t[i]) * this.r[i];
  }
}
