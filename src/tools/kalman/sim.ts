/**
 * 追跡の 1 組: 本当の台車と距離計・カルマンフィルタ・誤差の記録。
 * 1 刻みを「予測 → 観測 → 更新」の 3 段に分け、1 段ずつでも、まとめてでも進められる
 */
import { KF, mulberry, nisBand, normal, World } from './kf';

/** 直前に終えた段。upd: 更新まで終えた（次は予測）、pred: 予測した（次は観測）、obs: 観測した（次は更新） */
export type Phase = 'pred' | 'obs' | 'upd';

export interface Setup {
  /** 観測の間隔 s */
  T: number;
  /** 本当の加速度のゆらぎ（標準偏差）m/s² */
  sa: number;
  /** 本当の観測の雑音（標準偏差）m */
  sz: number;
  /** 本当の初めの速さ m/s */
  v0: number;
  /** フィルタが使う過程雑音・観測の雑音の分散の、本当の値に対する倍率 */
  fq: number;
  fr: number;
  /** フィルタの初めの位置・速度の不確かさ（標準偏差） */
  sp0: number;
  sv0: number;
}

export interface Rec {
  t: number;
  /** 位置の推定の誤差 p̂ − p、フィルタの見積った標準偏差 √P₀₀、観測の誤差 z − p、NIS */
  e: number;
  s: number;
  oz: number;
  nis: number;
}

export interface Stats {
  n: number;
  /** 推定の誤差と観測の誤差の RMS */
  rms: number;
  orms: number;
  /** NIS の平均と、合っているときの 95 % の範囲 */
  nis: number;
  band: [number, number];
}

/** 誤差の図と統計の時間の幅 s */
export const SPAN = 12;
/** 推定の跡（位置と速度の平面の点）の数 */
const TRAIL = 14;
/** 線路の図に残す観測の数 */
const ZS = 8;

export class Tracker {
  readonly w: World;
  readonly f = new KF();
  phase: Phase = 'upd';
  /** 直前の観測（pred の段ではまだ見せない） */
  z = Number.NaN;
  zs: number[] = [];
  trail: [number, number][] = [];
  hist: Rec[] = [];

  constructor(
    public u: Setup,
    readonly seed = 5,
  ) {
    this.w = new World(seed);
    this.reset();
  }

  /** フィルタが使う加速度の分散と観測の分散 */
  q(): number {
    return this.u.sa * this.u.sa * this.u.fq;
  }
  R(): number {
    return this.u.sz * this.u.sz * this.u.fr;
  }

  /**
   * 始め直す。本当の初めの位置は、フィルタの初めの不確かさに合う正規分布から選ぶ（種で決まる）。
   * フィルタは位置 0・速度 0 から始める
   */
  reset(): void {
    const u = this.u,
      p0 = u.sp0 * normal(mulberry(this.seed + 101));
    this.w.reset(p0, u.v0);
    this.f.reset(0, 0, u.sp0, u.sv0);
    this.phase = 'upd';
    this.z = Number.NaN;
    this.zs = [];
    this.trail = [];
    this.hist = [];
  }

  pred(): void {
    const u = this.u;
    this.z = this.w.step(u.T, u.sa, u.sz);
    this.f.predict(u.T, this.q());
    this.phase = 'pred';
  }
  obs(): void {
    this.zs.push(this.z);
    if (this.zs.length > ZS) this.zs.shift();
    this.phase = 'obs';
  }
  upd(): void {
    const f = this.f,
      w = this.w;
    f.update(this.z, this.R());
    this.hist.push({ t: w.t, e: f.x[0] - w.p, s: Math.sqrt(f.P[0]), oz: this.z - w.p, nis: f.nis });
    while (this.hist.length && this.hist[0].t < w.t - SPAN - 1e-9) this.hist.shift();
    this.trail.push([f.x[0], f.x[1]]);
    if (this.trail.length > TRAIL) this.trail.shift();
    this.phase = 'upd';
  }

  /** 1 段進める */
  step(): void {
    if (this.phase === 'upd') this.pred();
    else if (this.phase === 'pred') this.obs();
    else this.upd();
  }
  /** 次の更新まで進める（途中の段からなら残りの段） */
  full(): void {
    if (this.phase === 'upd') this.pred();
    if (this.phase === 'pred') this.obs();
    this.upd();
  }
  warm(n: number): void {
    for (let i = 0; i < n; i++) this.full();
  }

  /** 記録（直近 SPAN 秒）の統計 */
  stats(): Stats | null {
    const h = this.hist,
      n = h.length;
    if (!n) return null;
    let e2 = 0,
      o2 = 0,
      s = 0;
    for (const r of h) {
      e2 += r.e * r.e;
      o2 += r.oz * r.oz;
      s += r.nis;
    }
    return { n, rms: Math.sqrt(e2 / n), orms: Math.sqrt(o2 / n), nis: s / n, band: nisBand(n) };
  }
}
