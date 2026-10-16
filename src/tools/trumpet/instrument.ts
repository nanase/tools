/**
 * トランペット 1 本（DOM に依存しない）: 唇（lips.ts）→ 管（guide.ts、弁と抜差し）→ ベルからの放射。
 * 放射は、ベルの開口の体積流量を単極子として 1 m 先の音圧にし、開口の放射抵抗で決まる放射のパワーに合わせて
 * 高い音を抑え（全方向の平均）、ベルの軸の方向に聴くときは指向係数を掛ける（RAD_SIDE・RAD_FRONT）。
 * 奏者が直す音程: 1+2 は第 1 抜差し、2+3・1+3・1+2+3 は第 3 抜差しを出す（弁の組み合わせが高くなる分）。
 * 温度を変えるときは作り直さず、作った温度の楽器の時間の刻みを音速の比で伸び縮みさせ、出力を 3 次の補間で
 * 元の標本の時刻に戻す（setTemp。どの共鳴も音速の比で動く。密度と損失の変化は省く）
 */
import { type Air, air, type BoreSpec, profile, SPEC } from './bore';
import { Bore } from './guide';
import { LIPS, type LipParams, Lips } from './lips';

/** 弁の押し具合を変える速さ: 押し切るまで [s] */
export const VALVE_TIME = 0.012;
/** 抜差しを出す長さ [m]（1+2 の第 1 抜差し、2+3・1+3・1+2+3 の第 3 抜差し。+9・+14・+27・+47 セントを直す） */
const SLIDE = { s12: 0.016, s23: 0.015, s13: 0.031, s123: 0.056 };

/** 2 次の IIR（直接形 I） */
class Biquad2 {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  constructor(
    public b0: number,
    public b1: number,
    public b2: number,
    public a1: number,
    public a2: number,
  ) {}
  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
  reset() {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
}

/** s 領域の 2 次の伝達関数 (n0 + n1 s + n2 s²)/(d0 + d1 s + d2 s²) を双一次変換する */
function bilinear(n: readonly number[], d: readonly number[], fs: number): Biquad2 {
  const K = 2 * fs,
    K2 = K * K,
    a0 = d[0] + d[1] * K + d[2] * K2;
  return new Biquad2(
    (n[0] + n[1] * K + n[2] * K2) / a0,
    (2 * n[0] - 2 * n[2] * K2) / a0,
    (n[0] - n[1] * K + n[2] * K2) / a0,
    (2 * d[0] - 2 * d[2] * K2) / a0,
    (d[0] - d[1] * K + d[2] * K2) / a0,
  );
}

/**
 * 単極子の音圧に掛ける放射のフィルタ（x = ka、τ = a/c）。
 * 全方向の平均: 単極子の式は高い周波数で放射のパワーを過大に見積もるので、開口の放射抵抗（guide.ts の sM‖R）で
 * 実際に出ていくパワーに合わせる: |H|² = Re Z_r / (Z_c x²/4) = 1.203 / (1 + 0.2406 x²)。
 * ベルの軸の上: それにバッフル付きピストンの指向係数（低い周波数で 1 にした値 x² / (2(1 − J₁(2x)/x))）を掛けた大きさを、
 * 2 次の有理関数で近似する（x = 0.05〜15 で誤差 0.15 dB）
 */
export const RAD_SIDE = { n: [1.097, 0, 0], d: [1, 0.4905, 0] } as const;
export const RAD_FRONT = { n: [1.097, 1.0213, 0.3351], d: [1, 0.9119, 0.2067] } as const;
function radFilter(h: { n: readonly number[]; d: readonly number[] }, a: number, c: number, fs: number): Biquad2 {
  const t = a / c,
    sc = (v: readonly number[]) => [v[0], v[1] * t, v[2] * t * t];
  return bilinear(sc(h.n), sc(h.d), fs);
}

export interface TrumpetOpts {
  /** 管の中の温度 [°C] */
  temp?: number;
  /** 非線形の伝搬の強さ（0 で線形、1 で物理の値） */
  brass?: number;
  /** ベルの軸の上で聴く（false なら全方向の平均） */
  onAxis?: boolean;
  /** 管の形と唇の値（省けば既定） */
  bore?: Partial<BoreSpec>;
  lips?: Partial<LipParams>;
}

/** 唇の値（Harrison-Harsley の 2 倍の質量。Velut・Mattéoli の値に近い。Q はこのツールで決めた） */
export const LIPS_T: LipParams = { ...LIPS, mu: 1.074e-4, q: 50 };
/** 管を既定の形より長くする分 [m]（1 自由度の唇は共鳴より高く鳴るので、唇で合わせる余地を作る） */
export const CYL_EXTRA = 0.05;

export class Trumpet {
  readonly fs: number;
  readonly air: Air;
  readonly bore: Bore;
  readonly lips: Lips;
  private front: Biquad2;
  private side: Biquad2;
  private onAxisOn: boolean;
  private prevU = 0;
  /** 弁の押し具合の目標（0〜1） */
  readonly target = [0, 0, 0];
  /** 直近の出力（1 m 先の音圧 [Pa]） */
  out = 0;
  /** 時間の刻みの倍率（音速の比）、次の出力までの端数、楽器の直近 4 標本の出力（古い順） */
  private rate = 1;
  private ph = 0;
  private readonly hist = [0, 0, 0, 0];

  constructor(fs: number, o: TrumpetOpts = {}) {
    this.fs = fs;
    this.air = air(o.temp ?? 27);
    const spec = { ...SPEC, ...o.bore };
    spec.cylLen = (o.bore?.cylLen ?? SPEC.cylLen) + CYL_EXTRA;
    const p = profile(spec);
    this.bore = new Bore(p, this.air, fs);
    this.bore.setBrass(o.brass ?? 1);
    this.lips = new Lips({ ...LIPS_T, ...o.lips }, fs, this.air.rho);
    this.onAxisOn = o.onAxis ?? true;
    this.front = radFilter(RAD_FRONT, p.bellR, this.air.c, fs);
    this.side = radFilter(RAD_SIDE, p.bellR, this.air.c, fs);
  }

  setBrass(k: number) {
    this.bore.setBrass(k);
  }

  setOnAxis(on: boolean) {
    this.onAxisOn = on;
    this.front.reset();
    this.side.reset();
  }

  /** 抜差しで弁の組み合わせの音程を直すか */
  slides = true;
  /** 押す弁（第 1・第 2・第 3）。押し具合は VALVE_TIME で変わる */
  setValves(v: readonly boolean[]) {
    for (let i = 0; i < 3; i++) this.target[i] = v[i] ? 1 : 0;
    const [a, b, c] = v,
      on = this.slides;
    this.bore.setSlide(0, on && a && b && !c ? SLIDE.s12 : 0);
    this.bore.setSlide(2, on && c ? (a && b ? SLIDE.s123 : a ? SLIDE.s13 : b ? SLIDE.s23 : 0) : 0);
  }

  /** 弁の押し具合 */
  press(i: number): number {
    return this.bore.valves[i].press;
  }

  /** 管の中の温度 T [°C] にする（作り直さない。唇の張りは奏者が決めた Hz のまま） */
  setTemp(T: number) {
    this.rate = air(T).c / this.air.c;
  }

  /**
   * 1 標本: 口の圧力 pm [Pa]、唇の共振周波数 fl [Hz]。1 m 先の音圧 [Pa] を返す。
   * 楽器は 1 標本に rate 回（端数は持ち越す）進め、2 標本前の時刻を Catmull-Rom の 3 次で補間する
   */
  step(pm: number, fl: number): number {
    const h = this.hist;
    this.ph += this.rate;
    while (this.ph >= 1) {
      this.ph -= 1;
      h[0] = h[1];
      h[1] = h[2];
      h[2] = h[3];
      h[3] = this.tick(pm, fl / this.rate);
    }
    const t = this.ph;
    this.out =
      h[1] +
      0.5 * t * (h[2] - h[0]) +
      t * t * (h[0] - 2.5 * h[1] + 2 * h[2] - 0.5 * h[3]) +
      t * t * t * (1.5 * (h[1] - h[2]) + 0.5 * (h[3] - h[0]));
    return this.out;
  }

  /** 楽器の 1 標本 */
  private tick(pm: number, fl: number): number {
    const V = this.bore.valves,
      dv = 1 / (VALVE_TIME * this.fs);
    for (let i = 0; i < 3; i++) {
      const d = this.target[i] - V[i].press;
      if (d !== 0) V[i].press += Math.max(-dv, Math.min(dv, d));
    }
    const pp = this.lips.step(pm, fl, this.bore.incoming(), this.bore.zIn);
    this.bore.step(pp);
    const u = this.bore.uEnd,
      m = ((this.air.rho / (4 * Math.PI)) * (u - this.prevU) * this.fs) as number;
    this.prevU = u;
    return this.onAxisOn ? this.front.run(m) : this.side.run(m);
  }

  reset() {
    this.bore.clear();
    this.lips.reset();
    this.prevU = 0;
    this.out = 0;
    this.ph = 0;
    this.hist.fill(0);
    this.front.reset();
    this.side.reset();
    for (let i = 0; i < 3; i++) this.target[i] = 0;
  }
}
