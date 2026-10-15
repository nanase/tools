/**
 * 唇（DOM に依存しない）。1 自由度の外開きの弁（Harrison-Harsley 2018 の式）:
 *   ÿ + σ ẏ + ω0² y = (Sr/μ) Δp、Δp = pm − p、開口 h = y + H0
 *   流量 U = w [h]+ sign(Δp) √(2|Δp|/ρ) + Sr ẏ（Bernoulli 流と唇が掃き出す流れ）
 * 口の圧力と管の入口の帰りの波から、Δp を |Δp|^½ の 2 次方程式の閉形式で毎標本求める。
 * 唇が閉じている間は、剛性を 4 倍・Q を 0.5 にする（Adachi・Sato 1996）
 */

export interface LipParams {
  /** 実効質量 [kg]、実効面積 [m²]、開口の幅 [m]、静止時の開き [m] */
  mu: number;
  sr: number;
  w: number;
  h0: number;
  /** 唇の共振の Q */
  q: number;
}

/** Harrison-Harsley 2018 の表 6.1 の値。Q はこのツールで決めた */
export const LIPS: LipParams = { mu: 5.37e-5, sr: 1.46e-5, w: 1e-2, h0: 2.9e-4, q: 3 };

export class Lips {
  /** 変位 [m]（いまと 1 標本前） */
  y = 0;
  private yp = 0;
  /** 直近の Δp [Pa]、体積流量 [m³/s]、マウスピースの圧力 [Pa] */
  dp = 0;
  u = 0;
  p = 0;
  private T: number;
  constructor(
    public prm: LipParams,
    readonly fs: number,
    readonly rho: number,
  ) {
    this.T = 1 / fs;
  }

  /**
   * 1 標本: 口の圧力 pm [Pa]、唇の共振周波数 f [Hz]、入口に着いた帰りの波 pm1、入口の特性インピーダンス zc。
   * 管へ入る往きの波 p⁺ を返す
   */
  step(pm: number, f: number, pm1: number, zc: number): number {
    const P = this.prm,
      T = this.T,
      y = this.y,
      h = y + P.h0,
      ho = h > 0 ? h : 0,
      ur = (P.sr * (y - this.yp)) / T;
    /* Δp + B sign(Δp) √|Δp| = A */
    const A = pm - 2 * pm1 - zc * ur,
      B = zc * P.w * ho * Math.sqrt(2 / this.rho),
      x = (-B + Math.sqrt(B * B + 4 * Math.abs(A))) / 2,
      dp = A >= 0 ? x * x : -x * x,
      ub = P.w * ho * (dp >= 0 ? 1 : -1) * Math.sqrt((2 * Math.abs(dp)) / this.rho);
    this.dp = dp;
    this.u = ub + ur;
    this.p = pm - dp;
    /* 唇を進める（中心差分） */
    const w0 = 2 * Math.PI * f;
    let k = w0 * w0,
      sg = w0 / P.q,
      fc = 0;
    if (h < 0) {
      /* 閉じている: 押し込んだ分に 3k の反発、Q 0.5 の減衰（閉じたときの共振 2ω0 に対して） */
      fc = -3 * k * h;
      sg = (2 * w0) / 0.5;
    }
    k = w0 * w0;
    const a = (sg * T) / 2,
      yn = (2 * y - (1 - a) * this.yp + T * T * ((P.sr / P.mu) * dp - k * y + fc)) / (1 + a);
    this.yp = y;
    this.y = yn;
    return this.p - pm1;
  }

  reset() {
    this.y = this.yp = this.dp = this.u = this.p = 0;
  }
}
