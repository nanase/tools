/**
 * VVVF の音を 1 ブロックずつ作る。3 相 2 レベルのインバータのオン・オフを標本ごとに決め、次の 2 通りで音にする。
 * - 線間電圧: U 相と V 相の差をそのまま鳴らす
 * - 磁力: 固定子の 1 点の磁束の 2 乗（マクスウェルの応力に比例）を、仮の固有振動に通して鳴らす
 * 2 つは割合を決めて同時に鳴らせる。走行音（歯車と転がり）とレールの継ぎ目の音は別に足す。ステレオでは 2 台のインバータを左右へ振り、
 * 継ぎ目の音は聞く席より前の車軸（左）から後ろの車軸（右）へ移る。切り替えの折り返しを減らすため 8 倍の標本化周波数で計算して落とす
 */
import { axleOffsets, type Car, f1Of, gateOn, pick, type Run, seatAt, WHEEL } from './cars';
import { V_TOP } from './drive';

const TAU = 2 * Math.PI;
const OS = 8;
const S3 = Math.sqrt(3) / 2;

/** 2 次の IIR フィルタ */
class Biquad {
  private z1 = 0;
  private z2 = 0;
  private constructor(
    private b0: number,
    private b1: number,
    private b2: number,
    private a1: number,
    private a2: number,
  ) {}
  static make(kind: 'lp' | 'hp' | 'bp', fc: number, fs: number, q: number): Biquad {
    const w = (TAU * fc) / fs,
      al = Math.sin(w) / (2 * q),
      c = Math.cos(w),
      a0 = 1 + al;
    if (kind === 'lp')
      return new Biquad((1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0, (-2 * c) / a0, (1 - al) / a0);
    if (kind === 'hp')
      return new Biquad((1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, (-2 * c) / a0, (1 - al) / a0);
    return new Biquad(al / a0, 0, -al / a0, (-2 * c) / a0, (1 - al) / a0);
  }
  p(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }
}

/** 三角波: x = 0 で 0 から上がり、1 周期で戻る。振幅 ±1 */
export const tri = (x: number): number => {
  const t = x - Math.floor(x);
  return t < 0.25 ? 4 * t : t < 0.75 ? 2 - 4 * t : 4 * t - 4;
};

/** インバータ 1 台。速度の違う 2 台を重ねると音が少し揺れる */
class Unit {
  private cph = 0.13;
  private pa = 0;
  private env = 0;
  private ff = 0;
  private readonly lpV: Biquad[];
  private readonly lpF: Biquad[];
  private readonly dtO: number;
  private readonly leak: number;
  constructor(
    fs: number,
    private readonly scale: number,
    private readonly cScale: number,
    private th: number,
  ) {
    const fO = fs * OS;
    /* 6 次のバターワース: 下の標本化周波数へ落とす前に高い成分を切る */
    const low = () => [0.518, Math.SQRT1_2, 1.932].map((q) => Biquad.make('lp', Math.min(16000, fs / 3), fO, q));
    this.lpV = low();
    this.lpF = low();
    this.dtO = 1 / fO;
    this.leak = 1 - TAU * 10 * this.dtO;
  }
  /** 止めていた音の計算を始める前に、線間電圧か磁力のフィルタを空にする */
  reset(force: boolean): void {
    for (const b of force ? this.lpF : this.lpV) b.reset();
  }
  /** n 標本を volt（線間電圧）と mag（磁力）に足す。null の音は計算しない */
  run(car: Car, r: Run, n: number, volt: Float32Array | null, mag: Float32Array | null, gain: number): void {
    const dtO = this.dtO,
      lpV = this.lpV,
      lpF = this.lpF,
      leak = this.leak,
      f1 = f1Of(car, r, this.scale),
      { s, m, fc } = pick(r.brake ? car.brk : car.acc, f1),
      /* 基本波の磁束: 低速は一定で、1 パルスより上は速度に反比例する */
      flux = Math.min(0.0208, 4 / Math.PI / Math.max(f1, 1)) / TAU,
      w = TAU * f1 * dtO,
      dC = (s.sync ? 0 : fc) * this.cScale * dtO,
      envT = gateOn(car, r) ? 1 : 0,
      isOne = s.sync && s.n === 1,
      nSync = s.sync ? s.n : 0,
      mEff = isOne ? 4 / Math.PI : Math.min(m, 4 / Math.PI),
      fT = (Math.min(1, Math.max(0, (f1 - 1) / 3)) * mEff) / (TAU * Math.max(f1, 1));
    let { th, cph, pa, env, ff } = this;
    for (let i = 0; i < n; i++) {
      env += (envT - env) * 0.004;
      ff += (fT - ff) * 0.01;
      let yV = 0,
        yF = 0;
      for (let o = 0; o < OS; o++) {
        th += w;
        if (th > TAU) th -= TAU;
        cph += dC;
        if (cph > 1) cph -= 1;
        const sn = Math.sin(th),
          cs = Math.cos(th),
          b = -0.5 * sn - S3 * cs,
          c = -0.5 * sn + S3 * cs;
        let U: number, V: number, W: number;
        if (isOne) {
          U = sn >= 0 ? 1 : -1;
          V = b >= 0 ? 1 : -1;
          W = c >= 0 ? 1 : -1;
        } else if (s.sync) {
          /* 同期: キャリアは基本波の角度で決まる。各相の 0 で下がる向きにすると基本波が最も大きくなる */
          const q = th / TAU;
          U = m * sn >= -tri(nSync * q) ? 1 : -1;
          V = m * b >= -tri(nSync * (q - 1 / 3)) ? 1 : -1;
          W = m * c >= -tri(nSync * (q + 1 / 3)) ? 1 : -1;
        } else {
          const k = tri(cph);
          U = m * sn >= k ? 1 : -1;
          V = m * b >= k ? 1 : -1;
          W = m * c >= k ? 1 : -1;
        }
        /* 磁束はいつも追う。止めておくと、磁力へ切り替えた瞬間に大きくずれて破裂音になる */
        pa = pa * leak + ((2 * U - V - W) / 3) * dtO;
        if (volt) yV = lpV[2].p(lpV[1].p(lpV[0].p(env * (U - V) * 0.5)));
        if (mag) {
          /* 基本波の磁束 −flux cos と、それ以外の磁束 ph の積が PWM の磁力になる */
          const ph = pa + ff * cs;
          yF = lpF[2].p(lpF[1].p(lpF[0].p(env * (-2 * flux * cs * ph + ph * ph))));
        }
      }
      if (volt) volt[i] += yV * gain;
      if (mag) mag[i] += yF * gain;
    }
    this.th = th;
    this.cph = cph;
    this.pa = pa;
    this.env = env;
    this.ff = ff;
  }
  get silent(): boolean {
    return this.env < 1e-4;
  }
}

/** 出力の飽和: 小さい音はそのままで、絶対値は 2 まで。打音の山でスイッチの音が沈まないよう余裕を取る */
const soft = (x: number): number => 2 * Math.tanh(x / 2);

/** 走行音の大きさ（速度 V_TOP での転がりの音の係数） */
const ROAD_GAIN = 2.3;
/** 走行音の低いうなりの大きさ */
const ROAD_LOW = 1.1;
/** 継ぎ目の音の大きさ（70 km/h） */
const RAIL_GAIN = 2.4;
/** 継ぎ目の音が速度の何乗で大きくなるか（仮定） */
const RAIL_POWER = 1.25;
/** 打音の大きさのばらつき [dB]: 継ぎ目ごとと 1 発ごと（録音の 1 発ごとのばらつき 2〜3 dB に合わせた） */
const JOINT_SD = 2;
const HIT_SD = 2;
/** 線間電圧の音の大きさ */
const VOLT_GAIN = 0.24;
/** トンネルで走行音が大きくなる倍率 */
const TUNNEL_ROAD = 1.35;
/** 音源の割合の変更: 止めていた音の計算を先に動かしておく時間と、割合を端から端まで動かす時間 [s] */
const SRC_WARM = 0.12,
  SRC_FADE = 0.04;
/** VVVF の直接音の大きさが変わるときの時間 [s] */
const DRY_TIME = 0.02;

/** 1 チャンネル分の音の仕上げ: 線間電圧はそのまま、磁力は仮の固有振動に通す */
class Chain {
  private readonly hpV: Biquad;
  private readonly lpV: Biquad;
  private readonly hpF: Biquad[];
  private readonly modes: { b: Biquad; g: number }[];
  private readonly body: Biquad;
  private lev = 0;
  private readonly levK: number;
  constructor(fs: number) {
    this.hpV = Biquad.make('hp', 120, fs, 0.7);
    this.lpV = Biquad.make('lp', 7000, fs, 0.7);
    this.hpF = [Biquad.make('hp', 220, fs, 0.54), Biquad.make('hp', 220, fs, 1.31)];
    this.modes = [
      [1000, 6, 1],
      [2300, 8, 0.7],
      [3700, 10, 0.45],
    ].map(([f, q, g]) => ({ b: Biquad.make('bp', f, fs, q), g }));
    this.body = Biquad.make('lp', 6000, fs, 0.7);
    this.levK = 1 - Math.exp(-1 / (0.15 * fs));
  }
  /** 止めていた音の計算を始める前に、線間電圧か磁力のフィルタを空にする */
  reset(force: boolean): void {
    if (force) {
      for (const b of this.hpF) b.reset();
      for (const m of this.modes) m.b.reset();
      this.body.reset();
      this.lev = 0;
    } else {
      this.hpV.reset();
      this.lpV.reset();
    }
  }
  voltage(x: number): number {
    return this.lpV.p(this.hpV.p(x)) * VOLT_GAIN;
  }
  force(x: number): number {
    const f = this.hpF[1].p(this.hpF[0].p(x * 230000));
    let s = f * 0.55;
    for (const m of this.modes) s += m.b.p(f) * m.g * 1.2;
    s = this.body.p(s);
    /* 低速の小さな音も聞こえるよう、ゆっくりした音量差だけ縮める */
    this.lev += (s * s - this.lev) * this.levK;
    const g = Math.min(5, (0.02 / Math.sqrt(this.lev + 1e-9)) ** 0.45);
    return Math.tanh(s * g * 2.2) * 0.75;
  }
}

/**
 * 打音の帯域。雑音を帯域に分け、速い減衰と弱い余韻で鳴らす。中心の周波数・大きさ・減衰は車内の録音の解析に合わせた。
 * 72 Hz の帯と 185 Hz の +4 dB は録音にない低音で、ユーザーの試聴で足した（体に伝わる振動の代わり）。
 * dist は 5 m より先の帯域ごとの減り [dB/m] で、遠いほど音がこもる
 */
const RAIL_BANDS = [
  { f: 72, q: 1.1, db: 0, fast: 0.09, slow: 0.26, tail: -Infinity, dist: 0 },
  { f: 185, q: 1.25, db: 4, fast: 0.08, slow: 0.26, tail: -14, dist: 0 },
  { f: 380, q: 0.9, db: 0, fast: 0.055, slow: 0.24, tail: -15, dist: 0.05 },
  { f: 700, q: 1.5, db: -6, fast: 0.045, slow: 0.2, tail: -15, dist: 0.1 },
  { f: 2700, q: 1.1, db: -20, fast: 0.042, slow: 0.2, tail: -15, dist: 0.15 },
];
/** 音速 [m/s]。遠い車軸の音は遅れて届く */
const SOUND = 340;
/** 打音の鳴り終わりまでの時間 [s]。過ぎたら計算しない */
const RAIL_RING = 2;
const dbGain = (v: number): number => 10 ** (v / 20);
/** 距離 d [m] での打音の大きさ: 近い範囲の急な減りと、遠くまで届く緩やかな減りの和。遠いほうの −9 dB はユーザーの試聴で決めた */
export const railLevel = (d: number): number => dbGain(-3 * d) + dbGain(-9 - 0.3 * d);

/** レールの継ぎ目の音: 車軸が継ぎ目を踏むたびに帯域ごとの音量の山を足す */
class Thumps {
  private readonly nb = RAIL_BANDS.length;
  private readonly bands: {
    g: number;
    dist: number;
    qf: number;
    qs: number;
    ts: number;
    fl: Biquad;
    fr: Biquad;
  }[];
  private readonly fastEnv: Float64Array;
  private readonly slowEnv: Float64Array;
  /** これから鳴る山の遅延線（標本ごとに 帯域 × 左右）。遠い音の遅れに使う */
  private readonly queue: Float32Array;
  private readonly size: number;
  private w = 0;
  private left = 0;
  private seed = 777;
  private lowL = 0;
  private lowR = 0;
  private readonly lowK: number;
  private readonly ringN: number;
  L = 0;
  Rv = 0;
  constructor(private readonly fs: number) {
    this.bands = RAIL_BANDS.map((b) => ({
      g: dbGain(b.db),
      dist: b.dist,
      qf: Math.exp(-1 / (b.fast * fs)),
      qs: Math.exp(-1 / (b.slow * fs)),
      ts: dbGain(b.tail),
      fl: Biquad.make('bp', b.f, fs, b.q),
      fr: Biquad.make('bp', b.f, fs, b.q),
    }));
    this.fastEnv = new Float64Array(this.nb * 2);
    this.slowEnv = new Float64Array(this.nb * 2);
    this.size = Math.ceil(0.5 * fs);
    this.queue = new Float32Array(this.size * this.nb * 2);
    this.lowK = 1 - Math.exp((-TAU * 800) / fs);
    this.ringN = Math.round(RAIL_RING * fs);
  }
  clear(): void {
    this.fastEnv.fill(0);
    this.slowEnv.fill(0);
    this.queue.fill(0);
    for (const b of this.bands) {
      b.fl.reset();
      b.fr.reset();
    }
    this.left = 0;
    this.lowL = 0;
    this.lowR = 0;
    this.L = 0;
    this.Rv = 0;
  }
  /** −1 より大きく 1 より小さい雑音 */
  private noise(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return (this.seed / 4294967296) * 2 - 1;
  }
  /** 平均 0・標準偏差 1 の乱数 */
  gauss(): number {
    return Math.sqrt(-2 * Math.log((this.noise() + 1) / 2 + 1e-12)) * Math.cos(Math.PI * (this.noise() + 1));
  }
  /** 距離 d [m] の車軸が大きさ a で踏む */
  hit(a: number, d: number, pL: number, pR: number): void {
    const delay = Math.min(this.size - 1, Math.round((d / SOUND) * this.fs)),
      at = ((this.w + delay) % this.size) * this.nb * 2,
      over = Math.max(0, d - 5);
    this.bands.forEach((b, k) => {
      const g = a * dbGain(-b.dist * over);
      this.queue[at + k * 2] += g * pL;
      this.queue[at + k * 2 + 1] += g * pR;
    });
    this.left = Math.max(this.left, delay + this.ringN);
  }
  /** 次の標本を L と Rv に出す */
  next(): void {
    if (this.left <= 0) {
      this.L = 0;
      this.Rv = 0;
      return;
    }
    this.left--;
    const { queue, fastEnv, slowEnv, bands, nb } = this,
      at = this.w * nb * 2;
    let l = 0,
      r = 0;
    for (let k = 0; k < nb; k++) {
      const b = bands[k],
        iL = k * 2,
        iR = iL + 1,
        tL = queue[at + iL],
        tR = queue[at + iR];
      queue[at + iL] = 0;
      queue[at + iR] = 0;
      fastEnv[iL] = fastEnv[iL] * b.qf + tL;
      fastEnv[iR] = fastEnv[iR] * b.qf + tR;
      slowEnv[iL] = slowEnv[iL] * b.qs + tL * b.ts;
      slowEnv[iR] = slowEnv[iR] * b.qs + tR * b.ts;
      l += b.fl.p(this.noise() * (fastEnv[iL] + slowEnv[iL])) * b.g;
      r += b.fr.p(this.noise() * (fastEnv[iR] + slowEnv[iR])) * b.g;
    }
    this.w = (this.w + 1) % this.size;
    this.lowL += (l - this.lowL) * this.lowK;
    this.lowR += (r - this.lowR) * this.lowK;
    this.L = this.lowL;
    this.Rv = this.lowR;
  }
}

/** 転がりの音（1 チャンネル分）: 中域のざらつきと低いうなり */
class Roll {
  private readonly bpR: Biquad;
  private readonly lpR: Biquad;
  private readonly lpLow: Biquad;
  constructor(
    fs: number,
    private seed: number,
  ) {
    this.bpR = Biquad.make('bp', 500, fs, 0.5);
    this.lpR = Biquad.make('lp', 1800, fs, 0.7);
    this.lpLow = Biquad.make('lp', 110, fs, 0.8);
  }
  next(midG: number, lowG: number): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    const noise = (this.seed / 4294967296) * 2 - 1;
    return this.lpR.p(this.bpR.p(noise)) * midG + this.lpLow.p(noise) * lowG;
  }
}

export class Inverter {
  car: Car;
  /** VVVF の直接音の倍率。残りは主スレッドの反響が受け持つ */
  motorDry = 1;
  road = true;
  /** 走行音の音量の倍率（ページの既定の −6 dB） */
  roadLevel = 10 ** (-6 / 20);
  /** 継ぎ目の間隔 [m]。0 なら音を出さない */
  rail = 25;
  /** 連結部寄りの席で聞くか（false は車両の中央） */
  seatEnd = true;
  stereo = true;
  tunnel = false;
  private readonly units: Unit[];
  private readonly bufVa = new Float32Array(1024);
  private readonly bufVb = new Float32Array(1024);
  private readonly bufFa = new Float32Array(1024);
  private readonly bufFb = new Float32Array(1024);
  /** 磁力の音の割合の目標: 0 が線間電圧だけ、1 が磁力だけ */
  private mixTo = 0;
  /** 今の磁力の音の割合 */
  private mix = 0;
  private gainV = 1;
  private gainF = 0;
  /** 割合を動かし始めるまでの残りの標本数 */
  private warm = 0;
  private runV = true;
  private runF = false;
  private dryNow = 1;
  private readonly dryK: number;
  private readonly chL: Chain;
  private readonly chR: Chain;
  private readonly rl: Roll;
  private readonly rr: Roll;
  private readonly th: Thumps;
  private gear = 0;
  /** 走った距離 [m] と、車軸ごとの踏んだ継ぎ目の番号 */
  private s = 0;
  private hit: number[] = [];
  private hitOf = '';
  private axles: number[] = [];
  constructor(
    car: Car,
    private readonly fs: number,
  ) {
    this.car = car;
    this.units = [new Unit(fs, 1, 1, 0.3), new Unit(fs, 1.004, 1.0003, 2.1)];
    this.chL = new Chain(fs);
    this.chR = new Chain(fs);
    this.rl = new Roll(fs, 12345);
    this.rr = new Roll(fs, 54321);
    this.th = new Thumps(fs);
    this.dryK = 1 - Math.exp(-1 / (DRY_TIME * fs));
  }
  /**
   * 磁力の音の割合を決める（0 が線間電圧だけ、1 が磁力だけ）。スイッチが動いている間に止めていた音を足すときは、
   * 計算を先に動かして落ち着かせてから混ぜる。磁力の音量の調整とフィルタが冷えたまま鳴らすと破裂音になる
   */
  set forceMix(q: number) {
    if (q === this.mixTo) return;
    this.mixTo = q;
    if (this.units.every((u) => u.silent)) {
      this.setMix(q);
      this.warm = 0;
    } else if ((q < 1 && !this.runV) || (q > 0 && !this.runF)) this.warm = Math.round(SRC_WARM * this.fs);
  }
  private setMix(q: number): void {
    this.mix = q;
    this.gainV = Math.cos((q * Math.PI) / 2);
    this.gainF = Math.sin((q * Math.PI) / 2);
  }
  /** 1 標本分、音源の混ざり具合を進める */
  private stepMix(): void {
    const to = this.mixTo;
    if (this.mix === to) return;
    if (this.warm > 0) {
      this.warm--;
      return;
    }
    const d = 1 / (SRC_FADE * this.fs);
    this.setMix(to > this.mix ? Math.min(to, this.mix + d) : Math.max(to, this.mix - d));
  }
  /** 1 チャンネル分の VVVF の音 */
  private motor(ch: Chain, v: number, f: number): number {
    return (this.runV ? ch.voltage(v) * this.gainV : 0) + (this.runF ? ch.force(f) * this.gainF : 0);
  }
  /** 今の音源に要る計算を決める。止めていた計算はフィルタを空にして始める */
  private planPaths(): void {
    const v = this.mix < 1 || this.mixTo < 1,
      f = this.mix > 0 || this.mixTo > 0;
    if ((v && !this.runV) || (f && !this.runF)) {
      const force = f && !this.runF;
      for (const u of this.units) u.reset(force);
      this.chL.reset(force);
      this.chR.reset(force);
    }
    this.runV = v;
    this.runF = f;
  }
  /** 音を出すものがないか（止まっていて、スイッチの音が消え切った） */
  idle(r: Run): boolean {
    return r.v <= 0 && !gateOn(this.car, r) && this.units.every((u) => u.silent);
  }
  /** 緊急停止で、鳴っている継ぎ目の音を消す */
  hush(): void {
    this.th.clear();
  }
  /** 継ぎ目 k の傷み具合: 同じ継ぎ目はどの車軸でも同じ強さで鳴る */
  private jointDb(k: number): number {
    const u = (Math.imul(k, 2654435761) >>> 0) / 4294967296,
      v = (Math.imul(k ^ 0x5bd1e995, 1597334677) >>> 0) / 4294967296;
    return JOINT_SD * Math.sqrt(-2 * Math.log(u + 1e-9)) * Math.cos(TAU * v);
  }
  /** 継ぎ目を踏んだ車軸の衝撃を左右へ入れる */
  private joints(r: Run, n: number): void {
    const L = this.rail,
      car = this.car;
    this.s += (r.v / 3.6) * (n / this.fs);
    if (L <= 0) return;
    const key = `${car.id}/${L}`;
    if (key !== this.hitOf) {
      this.hitOf = key;
      this.axles = axleOffsets(car);
      this.hit = this.axles.map((x) => Math.floor((this.s + x) / L));
      return;
    }
    const amp = (r.v / 70) ** RAIL_POWER * RAIL_GAIN,
      seat = seatAt(car, this.seatEnd);
    this.axles.forEach((x, i) => {
      const k = Math.floor((this.s + x) / L);
      if (k === this.hit[i]) return;
      this.hit[i] = k;
      if (r.v < 1) return;
      const d = Math.abs(x - seat),
        g = amp * railLevel(d) * dbGain(this.jointDb(k) + HIT_SD * this.th.gauss());
      if (g < 2e-3) return;
      /* 前（左）から後ろ（右）へ移る。遠い音ほど左右に広がらない */
      const pos = (Math.max(-1, Math.min(1, (x - seat) / 5)) * 30) / (30 + d),
        th = ((1 - pos) * Math.PI) / 4,
        pL = this.stereo ? Math.cos(th) * Math.SQRT2 : 1,
        pR = this.stereo ? Math.sin(th) * Math.SQRT2 : 1;
      this.th.hit(g, d, pL, pR);
    });
  }
  /**
   * n 標本（1024 まで）を L[off] から書く。R を渡すと右も書く（ステレオでなければ左と同じ）。
   * R がなければ左だけを書く。ML・MR を渡すと、走行音とレールの音を含まない VVVF の音だけ（motorDry を掛ける前）も書く
   */
  render(
    r: Run,
    L: Float32Array,
    off: number,
    n: number,
    R?: Float32Array,
    ML?: Float32Array,
    MR?: Float32Array,
  ): void {
    this.planPaths();
    const { bufVa: Va, bufVb: Vb, bufFa: Fa, bufFb: Fb, runV, runF } = this,
      car = this.car,
      fs = this.fs,
      st = this.stereo && !!R;
    if (runV) {
      Va.fill(0, 0, n);
      Vb.fill(0, 0, n);
    }
    if (runF) {
      Fa.fill(0, 0, n);
      Fb.fill(0, 0, n);
    }
    this.units[0].run(car, r, n, runV ? Va : null, runF ? Fa : null, 1);
    this.units[1].run(car, r, n, runV ? Vb : null, runF ? Fb : null, 0.5);
    this.joints(r, n);
    const nv = r.v / V_TOP,
      /* 車輪の回転周波数 [Hz] */
      rps = r.v / 3.6 / (Math.PI * WHEEL),
      teeth = Math.round(car.gear * 14),
      load = 0.35 + (0.65 * Math.abs(r.a)) / car.a0,
      roadG = this.road ? this.roadLevel * (this.tunnel ? TUNNEL_ROAD : 1) : 0,
      rollG = nv * nv * ROAD_GAIN,
      lowG = nv * ROAD_LOW;
    for (let i = 0; i < n; i++) {
      this.gear += (TAU * teeth * rps) / fs;
      if (this.gear > TAU) this.gear -= TAU;
      const tone = (Math.sin(this.gear) + 0.35 * Math.sin(2 * this.gear)) * nv ** 1.5 * load * 0.035 * 0.75,
        a = this.rl.next(rollG, lowG);
      this.th.next();
      this.stepMix();
      this.dryNow += (this.motorDry - this.dryNow) * this.dryK;
      const dry = this.dryNow;
      if (st && R) {
        const b = this.rr.next(rollG, lowG),
          x = this.motor(this.chL, Va[i] * 0.85 + Vb[i] * 0.5, Fa[i] * 0.85 + Fb[i] * 0.5),
          y = this.motor(this.chR, Va[i] * 0.52 + Vb[i] * 0.86, Fa[i] * 0.52 + Fb[i] * 0.86);
        L[off + i] = soft(x * dry + (a + tone) * roadG + this.th.L);
        R[off + i] = soft(y * dry + (b + tone) * roadG + this.th.Rv);
        if (ML) ML[off + i] = x;
        if (MR) MR[off + i] = y;
      } else {
        const x = this.motor(this.chL, Va[i] + Vb[i], Fa[i] + Fb[i]),
          v = soft(x * dry + (a + tone) * roadG + this.th.L);
        L[off + i] = v;
        if (R) R[off + i] = v;
        if (ML) ML[off + i] = x;
        if (MR) MR[off + i] = x;
      }
    }
  }
}
