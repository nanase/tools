/**
 * 4 ストローク単気筒エンジンの模型（DOM に依存しない）。標本ごとに次を進める。
 * - シリンダ: 0 次元（一様な気体）の質量とエネルギーの式。燃焼は Wiebe 関数の熱発生、壁への熱は Woschni の式
 * - 吸気: 大気 → スロットル（絞り）→ 吸気管（導波管）→ 吸気弁（絞り）→ シリンダ
 * - 排気: シリンダ → 排気弁（絞り）→ 排気管・触媒・マフラー・テールパイプ（導波管）→ 大気へ放射
 * - クランク: ガスの力と往復運動の慣性・摩擦・負荷から回転を進める。台上で回転数を保つこともできる
 * - 音: テールパイプの出口から出る体積流量の時間微分（単極子の放射）と、スロットルの入口の放射、エンジン本体の
 *   機械音（弁の打音と燃焼の圧力の立ち上がりを、本体の固有振動で鳴らす）
 * サイクルの角度 φ は 0 が吸気の上死点（弁が重なるところ）、2π が燃焼の上死点、4π で 1 サイクル
 */
import { Duct } from './duct';
import { type EndState, gammaOf, Orifice, P_ATM, R_GAS, RHO_ATM, solveEnd, T_ATM } from './gas';
import type { EngineSpec, ValveSpec } from './spec';

const TAU = 2 * Math.PI;

/** 低い棚の双 2 次（RBJ、傾き 1）: 角の周波数 f [Hz]、低い側の増幅 g [dB] → [b0, b1, b2, a1, a2] */
function lowShelf(f: number, g: number, fs: number): number[] {
  const A = 10 ** (g / 40),
    w = (TAU * f) / fs,
    c = Math.cos(w),
    s = Math.sqrt(A) * Math.sin(w) * Math.SQRT2,
    a0 = A + 1 + (A - 1) * c + s;
  return [
    (A * (A + 1 - (A - 1) * c + s)) / a0,
    (2 * A * (A - 1 - (A + 1) * c)) / a0,
    (A * (A + 1 - (A - 1) * c - s)) / a0,
    (-2 * (A - 1 + (A + 1) * c)) / a0,
    (A + 1 + (A - 1) * c - s) / a0,
  ];
}
const DEG = Math.PI / 180;
/** ガソリンの低位発熱量 [J/kg] と理論空燃比 */
const LHV = 43.4e6;
const AFR = 14.6;
/** 壁の温度 [K]（空冷のシリンダとヘッドの平均の目安） */
const T_WALL = 450;
/** 弁の流量係数（カーテン面積とポートの喉の面積の小さいほうに掛ける） */
const CD_VALVE = 0.62;
/**
 * 走行の模型の値: タイヤ（80/90-17）の動的な半径 [m]・転がり抵抗係数・空気抵抗（Cd × 前面投影面積、乗る人を含む）[m²]・
 * 伝達の効率・ブレーキの最大の減速（重力に対する比）・回る部品の分の質量の上乗せ（比）。いずれも目安
 */
const R_WHEEL = 0.284;
const CRR = 0.015;
const CDA = 0.55;
const ETA_DRIVE = 0.9;
const BRAKE_MAX = 0.7;
const M_ROT = 0.04;
const G = 9.81;
/**
 * 遠心クラッチ: 1,800 rpm でつながり始め、3,000 rpm で伝えられるトルクが最大（クランク軸で 120 N·m。単気筒の 1 回の爆発のトルクの山より大きく、滑らない）になる。
 * 滑りの速さ 4 rad/s でほぼ最大の摩擦になる（tanh）。変速の間（0.3 s）はクラッチを切る（チェンジペダルで切れる仕組み）
 */
const CLUTCH_IN = 1800;
const CLUTCH_SPAN = 1200;
const CLUTCH_MAX = 120;
const CLUTCH_SLIP = 4;
/**
 * ワンウェイクラッチ: 車輪の側がエンジンより速いときは、遠心クラッチがつながっていなくても車輪がエンジンを回す
 * （カブの自動遠心クラッチの仕組み。エンジンブレーキが効き、押しがけができる）。伝えられるトルク [N·m]
 */
const ONEWAY_MAX = 120;
/**
 * 変速の時間 [s]（チェンジペダルでクラッチが切れている間）。乗る人の操作も入れる: シフトアップの間はスロットルを戻し、
 * シフトダウンの間は、変わった先のギアの回転数に合わせてスロットルを少し開ける（ブリッピング）
 */
const SHIFT_TIME = 0.15;
/**
 * シフトアップの前に、クラッチがつながったままスロットルを戻している時間 [s]。吸い込み済みの混合気が燃える分を
 * 車輪が受け止めるので、クラッチが切れたあとに回転が跳ね上がらない
 */
const SHIFT_LEAD = 0.06;
/** 音圧を求める距離 [m]: 排気の出口から・スロットルの入口から・エンジン本体から */
const R_EX = 0.5;
const R_IN = 1;
const R_MECH = 1;
/**
 * 機械音の大きさの倍率: 録音（排気口の近く）に合わせた大きさから、聞いた印象で 4 dB 上げる
 * （乗っている人はエンジンの近くにいるため。2026-10-10 の試聴で「4 dB くらいが丁度いい」）
 */
const MECH_GAIN = 10 ** (4 / 20);

/** 1 サイクルの集計 */
export interface CycleStat {
  rpm: number;
  /** 図示平均有効圧 [Pa]・正味トルク [N·m]（サイクルの平均） */
  imep: number;
  torque: number;
  /** 体積効率（スロットルを通った質量 ÷ 大気の密度 × 排気量） */
  ve: number;
  /** 最高圧力 [Pa] とその角度 [deg、燃焼の上死点から] */
  pmax: number;
  aPmax: number;
  /** 排気弁から出たガスの平均温度 [K] */
  tExh: number;
  /** 残留ガスの割合・燃料を噴いたか */
  xr: number;
  fuel: boolean;
  /** 吸気弁が閉じたときの吸気管の圧力 [Pa] */
  map: number;
  /** サイクルの音圧の実効値 [Pa]（出力の音圧。排気・吸気・機械音の和） */
  prms: number;
  /** 回転の上限の制御の効き（0 なし〜1 最大） */
  limit: number;
  /** このサイクルで噴いた燃料 [kg] */
  mFuel: number;
}

/** 2 次の共振器（エンジン本体の固有振動） */
interface Mode {
  a1: number;
  a2: number;
  g: number;
  y1: number;
  y2: number;
}

/**
 * 本体の固有振動（周波数 [Hz]・Q・重み）。空冷のフィンとシリンダ・ヘッドの曲げを想定した目安。録音（排気口の近く）の
 * 1〜6 kHz がなだらかなので、Q を低くして山を広げている
 */
const BODY_MODES: [number, number, number][] = [
  [480, 4, 0.12],
  [700, 5, 0.15],
  [950, 7, 0.3],
  [1600, 8, 0.8],
  [2500, 9, 0.8],
  [3300, 10, 0.6],
  [5000, 11, 0.6],
  [6500, 12, 0.4],
];

export class EngineSim {
  readonly fs: number;
  readonly spec: EngineSpec;
  private readonly dt: number;
  /* 形 */
  private readonly a: number;
  private readonly l: number;
  private readonly Ap: number;
  readonly Vd: number;
  private readonly Vc: number;
  /* 状態 */
  /** サイクルの角度 [rad]（0〜4π）と角速度 [rad/s] */
  phi = 0;
  omega: number;
  /** シリンダの質量 [kg]・温度 [K]・新気（混合気）の質量 [kg] */
  m: number;
  T: number;
  mf: number;
  /** 吸気管に押し戻された燃焼ガスの質量 [kg]（次の吸気で先に戻る） */
  private rb = 0;
  /* 燃焼 */
  private qTot = 0;
  private phiS = 0;
  private dPhi = 1;
  private mfIvc = 0;
  private pIvc = P_ATM;
  private vIvc = 1;
  private tIvc = T_ATM;
  private burning = false;
  private xb = 0;
  private fuelOn = true;
  /* 管 */
  readonly ex: Duct;
  readonly inn: Duct;
  private readonly exEnd: EndState = { pe: P_ATM, m: 0 };
  private readonly thEnd: EndState = { pe: P_ATM, m: 0 };
  private readonly ivEnd: EndState = { pe: P_ATM, m: 0 };
  private readonly oEx = new Orifice(1.33);
  private readonly oIn = new Orifice(1.38);
  private readonly oTh = new Orifice(1.4);
  /* 操作と制御 */
  /** スロットルの開き（0〜1） */
  throttle = 0;
  /**
   * 'free' はクランクの運動を解く（負荷なし）、'hold' は回転数を保つ（台上の動力計）、
   * 'drive' はクラッチと変速機を通して車体を走らせる（ギアが N なら負荷なしと同じ）
   */
  mode: 'free' | 'hold' | 'drive' = 'free';
  /** 走行: 車速 [m/s]・走行距離 [m]・ギア（0 が N、1〜4）・勾配 [%]・ブレーキ（0〜1）・総質量（車体と乗る人）[kg] */
  v = 0;
  dist = 0;
  gear = 0;
  slope = 0;
  brake = 0;
  mass = 118 + 65;
  /** 変速の残り時間 [s] と、変わった先のギア */
  private shiftT = 0;
  private nextGear = 0;
  private shiftDir = 0;
  /** クラッチがクランク軸から受けるトルク [N·m]（車体を進める向きが正） */
  clutchT = 0;
  /** 'free' のときの負荷のトルク [N·m] */
  load = 0;
  /**
   * アイドリングの空気の通り道（ECU が回転数で開け閉めする）の面積 [m²]: 基本の開き・積分の項・いまの値。
   * 点火時期もアイドリングでは回転数で動かす（idleAdv [deg]）
   */
  private readonly idleA0 = 1.3e-6;
  private idleI = 0;
  private idleA = 1.3e-6;
  private idleAdv = 0;
  private dfco = false;
  /** サイクルの経過時間 [s]（サイクルの平均の回転数を求める） */
  private cycT = 0;
  /** 回転の上限の制御の効き（0〜1） */
  limit = 0;
  /* 集計 */
  private acc = { w: 0, mTh: 0, pmax: 0, aPmax: 0, hEx: 0, mEx: 0, xr: 0, map: P_ATM, p2: 0, n: 0, fuel: 0 };
  /** 使った燃料 [kg]（吸気弁が閉じたときに、閉じ込めた新気から空燃比で求めた燃料を足していく） */
  fuelUsed = 0;
  /** アイドリングの回転数・燃料を切る回転数 [rpm]（諸元の値から変えられる） */
  idleRpm: number;
  cutRpm: number;
  /** 直前の標本の筒内の圧力 [Pa] */
  pCyl = P_ATM;
  /** 直前のサイクルの集計 */
  last: CycleStat | null = null;
  /** 排気の温度の滑らかな値 [K]（管の温度を決める） */
  tExh = 600;
  /** 管の中のガスの温度の割合（排気弁を出たガスが管で冷える分。区間ごとの heat に掛ける） */
  tGas = 1;
  private tick = 0;
  /* 音 */
  private qPrev = 0;
  private inLp1 = 0;
  private inLp2 = 0;
  private qInPrev = 0;
  private pPrev = P_ATM;
  private readonly modes: Mode[];
  private seed = 0x2545f491;
  /** 直前の標本の、排気・吸気・機械音の音圧 [Pa] */
  pEx = 0;
  pIn = 0;
  pMech = 0;
  /** 音の重み（排気・吸気・機械音） */
  mix = { ex: 1, in: 1, mech: 1 };
  /**
   * 機械音の励振の大きさ: 弁の打音（角速度 1 rad/s あたり）・燃焼の圧力の 2 階差分（1 Pa あたり）。
   * 燃焼の圧力が本体を通って音になるときは低い周波数ほど弱まる（構造の減衰）ので、2 階差分で高域を強める。
   * 打音はアイドリングの録音（トコトコという音）に合わせ、回転が上がったときは角速度に比例させず平方根で強める
   * （比例させると高い回転で打音が続けて鳴り、サーという雑音のように目立つ。聞いた印象での目安）
   */
  kValve = 1.1;
  kComb = 0.005;
  private dpPrev = 0;
  /** 弁の打音の雑音の振幅（指数で減衰） */
  private tick0 = 0;
  /**
   * 乱流の音: 排気弁のすき間の噴流が管へ入れる圧力の乱れ（動圧に対する比）と、出口の噴流の音（Lighthill の
   * u⁸ 則 W = K ρ u⁸ D² / c⁵ の係数 K）。定常の亜音速の噴流の実測は、出口の面積で書いて K = 3〜6×10⁻⁵
   * （von Glahn 1972）。脈動する高温の噴流にはそのまま当てはまらないので、録音の高域に合わせて小さくしている
   */
  kTurb = 0.005;
  kJet = 1e-6;
  /** 音色の補正（低い棚）の係数 [b0, b1, b2, a1, a2] と状態、掛ける割合（0〜1） */
  private readonly tone: number[] | null;
  private tx1 = 0;
  private tx2 = 0;
  private ty1 = 0;
  private ty2 = 0;
  private toneW = 0;
  /** 出口の噴流の音の帯域（400 Hz の 1 次の高域通過と 3 kHz の 1 次の低域通過）の状態 */
  private jx = 0;
  private jh = 0;
  private jl = 0;

  constructor(spec: EngineSpec, fs: number, rpm = spec.idle) {
    this.spec = spec;
    this.tone = spec.tone ? lowShelf(spec.tone.f, spec.tone.gain, fs) : null;
    this.idleRpm = spec.idle;
    this.cutRpm = spec.cut;
    this.fs = fs;
    this.dt = 1 / fs;
    this.a = spec.stroke / 2;
    this.l = spec.rod;
    this.Ap = (Math.PI / 4) * spec.bore * spec.bore;
    this.Vd = this.Ap * spec.stroke;
    this.Vc = this.Vd / (spec.cr - 1);
    this.omega = (rpm / 60) * TAU;
    this.ex = new Duct(spec.exhaust, fs, true);
    this.inn = new Duct(spec.intake, fs, false);
    this.ex.setTemp(this.tExh);
    this.T = 400;
    this.m = (P_ATM * this.vol(0)) / (R_GAS * this.T);
    this.mf = 0;
    this.modes = BODY_MODES.map(([f, q, g]) => {
      const r = Math.exp((-Math.PI * f) / (q * fs)),
        w = (TAU * f) / fs;
      return { a1: 2 * r * Math.cos(w), a2: -r * r, g, y1: 0, y2: 0 };
    });
  }

  /** 燃えている間か（点火から燃焼の半ばまで、燃料を噴いたサイクルだけ。図の火花と点火のインジケータ） */
  get firing(): boolean {
    const d = this.phi - (this.phiS - 8 * DEG);
    return this.qTot > 0 && d >= 0 && d < 8 * DEG + 0.5 * this.dPhi;
  }

  get rpm(): number {
    return (this.omega * 60) / TAU;
  }
  set rpm(v: number) {
    this.omega = (v / 60) * TAU;
  }

  /** 角度 φ での容積 [m³] */
  vol(phi: number): number {
    const { a, l } = this,
      s = Math.sin(phi);
    return this.Vc + this.Ap * (l + a - a * Math.cos(phi) - Math.sqrt(l * l - a * a * s * s));
  }

  /** 一様乱数（−1〜1） */
  private rand(): number {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return (this.seed / 4294967296) * 2 - 1;
  }
  /** 正規乱数（近似: 一様乱数 4 つの和） */
  private gauss(): number {
    return (this.rand() + this.rand() + this.rand() + this.rand()) * 0.866;
  }

  /** 弁のリフトの位置（0〜1、閉じていれば −1） */
  private valveS(v: ValveSpec, deg: number): number {
    const s = ((((deg - v.open) % 720) + 720) % 720) / v.dur;
    return s < 1 ? s : -1;
  }
  /** 弁の有効面積 [m²] */
  private valveA(v: ValveSpec, s: number): number {
    if (s <= 0) return 0;
    const L = v.lift * Math.sin(Math.PI * s) ** (v.shape ?? 1.5),
      dt = 0.85 * v.d;
    return CD_VALVE * Math.min(Math.PI * v.d * L, (Math.PI / 4) * dt * dt);
  }

  /**
   * 乗る人の操作を入れたスロットル（0〜1）: ふだんは throttle。走行の変速の間だけ、シフトアップなら 0、
   * シフトダウンなら変わった先のギアの回転数に届くまで開ける（届かない差 2,000 rpm で 1 の割合、最大 0.6）
   */
  get throttleEff(): number {
    if (this.mode !== 'drive' || this.shiftT <= 0) return this.throttle;
    if (this.shiftDir > 0 || this.nextGear === 0) return 0;
    const d = this.spec.drive,
      target = (((this.v / R_WHEEL) * d.primary * d.gears[this.nextGear - 1] * d.final) / TAU) * 60;
    return Math.max(this.throttle, Math.min(0.6, Math.max(0, (target - this.rpm) / 2000)));
  }

  /** スロットルの有効面積 [m²]（蝶弁の投影の式。全閉の角度 5°） */
  private throttleA(): number {
    const D = this.spec.throttleD,
      a0 = 5 * DEG,
      a = a0 + Math.min(1, Math.max(0, this.throttleEff)) * (Math.PI / 2 - a0);
    return 0.85 * (Math.PI / 4) * D * D * (1 - Math.cos(a) / Math.cos(a0)) + this.idleA;
  }

  /** 摩擦のトルク [N·m] */
  private friction(): number {
    const sp = (this.spec.stroke * Math.abs(this.omega)) / Math.PI,
      [f0, f1, f2] = this.spec.fmep;
    return ((f0 + f1 * sp + f2 * sp * sp) * this.Vd) / (4 * Math.PI);
  }

  /** 吸気弁が閉じたとき: このサイクルの燃焼を決める */
  private onIvc(): void {
    const rpm = this.rpm,
      xr = Math.max(0, 1 - this.mf / this.m),
      load = Math.min(1, this.ivEnd.pe / P_ATM);
    /* 回転の上限: 上限の 400 rpm 手前から点火を遅らせ、上限の近くでは燃料も絞る。燃料を急に切らないので、
       回転は上限のあたりで頭打ちになる（上限を 600 rpm 超えたときだけ、守りとして燃料を切る） */
    this.limit = Math.min(1, Math.max(0, (rpm - (this.cutRpm - 400)) / 400));
    const th = this.throttleEff;
    if (th < 0.01 && rpm > 2500) this.dfco = true;
    else if (th >= 0.01 || rpm < 1700) this.dfco = false;
    this.fuelOn = !this.dfco && rpm < this.cutRpm + 600;
    this.mfIvc = this.mf;
    this.pIvc = (this.m * R_GAS * this.T) / this.vol(this.phi);
    this.vIvc = this.vol(this.phi);
    this.tIvc = this.T;
    /* 点火時期（MBT の目安）: 回転が上がるほど、負荷が軽いほど進める */
    const adv =
      Math.min(40, Math.max(6, 8 + 18 * Math.min(1, (rpm - 1000) / 4000) + 12 * (1 - load))) +
      this.idleAdv -
      35 * this.limit;
    /* 燃焼のばらつき: 残留ガスが多い（アイドリング）ほど大きい */
    const sq = 0.025 + 0.25 * xr,
      sd = 0.04 + 0.3 * xr;
    const mFuel = this.fuelOn ? (this.mfIvc / (AFR + 1)) * (1 - 0.8 * Math.max(0, (this.limit - 0.6) / 0.4)) : 0;
    this.fuelUsed += mFuel;
    this.acc.fuel = mFuel;
    this.qTot = Math.max(0, mFuel * LHV * this.spec.eta * (1 + sq * this.gauss()));
    this.phiS = (360 - adv + 8 + 2 * this.gauss()) * DEG;
    this.dPhi =
      Math.max(20, this.spec.burn * (1 + 1.5 * xr) * (1 + 0.1 * (rpm / 6000)) * (1 + sd * this.gauss())) * DEG;
    this.burning = false;
    this.xb = 0;
    this.acc.xr = xr;
    this.acc.map = this.ivEnd.pe;
  }

  /** 1 サイクルが終わったとき: 集計とアイドリングの制御 */
  private onCycle(): void {
    const c = this.acc,
      tf = this.friction(),
      rpm = this.cycT > 0 ? 120 / this.cycT : this.rpm;
    this.cycT = 0;
    this.idleControl(rpm);
    this.last = {
      rpm,
      imep: c.w / this.Vd,
      torque: c.w / (4 * Math.PI) - tf,
      ve: c.mTh / (RHO_ATM * this.Vd),
      pmax: c.pmax,
      aPmax: c.aPmax,
      tExh: c.mEx > 0 ? c.hEx / c.mEx : this.tExh,
      xr: c.xr,
      fuel: this.fuelOn,
      map: c.map,
      prms: c.n ? Math.sqrt(c.p2 / c.n) : 0,
      limit: this.limit,
      mFuel: c.fuel,
    };
    c.w = c.mTh = c.pmax = c.hEx = c.mEx = c.p2 = c.n = 0;
  }

  /**
   * アイドリングの制御（サイクルごと）。スロットルを閉じているとき、サイクルの平均の回転数と目標の差 e で
   * 空気の通り道を基本の開きの (1 + 比例 + 積分) 倍にし、点火時期も比例で動かす（速い補正）。
   * 燃料を切っている間と、目標より 500 rpm 以上高いときは積分を止める（減速のあとに通り道が閉じ切って
   * エンストしないように）
   */
  private idleControl(rpm: number): void {
    const e = this.idleRpm - rpm,
      on = this.throttle < 0.02 && this.mode !== 'hold' && !this.dfco;
    if (on && e > -500) this.idleI = Math.min(1.5, Math.max(-0.6, this.idleI + 5e-5 * e));
    const k = 1 + this.idleI + (on ? Math.min(0.2, Math.max(-0.2, 3e-4 * e)) : 0);
    this.idleA = this.idleA0 * Math.max(0.2, k);
    this.idleAdv = on ? Math.min(5, Math.max(-5, 0.01 * e)) : 0;
  }

  /** 変速する（dir 1 で上、−1 で下）。N → 1 → 2 → 3 → 4 のリターン式で、止まっているときだけ 4 から上で N に戻る */
  shift(dir: 1 | -1): void {
    if (this.shiftT > 0) return;
    const top = this.spec.drive.gears.length;
    let g = this.gear + dir;
    if (this.gear === top && dir > 0 && this.v < 0.3) g = 0;
    if (g < 0 || g > top) return;
    this.nextGear = g;
    this.shiftDir = dir;
    this.shiftT = SHIFT_TIME + (dir > 0 && this.gear > 0 ? SHIFT_LEAD : 0);
  }

  /** 変速の途中か */
  get shifting(): boolean {
    return this.shiftT > 0;
  }

  /**
   * 走行の 1 標本: 遠心クラッチのトルクを求め、変速機・チェーンを通して車体を進める。
   * 車体は M dv/dt = 駆動力 − 坂の力 − 転がり抵抗 − 空気抵抗 − ブレーキ（後ろへは進まない）。クラッチのトルクを返す
   */
  private driveStep(dt: number): number {
    if (this.shiftT > 0) {
      this.shiftT -= dt;
      if (this.shiftT <= SHIFT_TIME / 2) this.gear = this.nextGear;
    }
    const d = this.spec.drive,
      R = this.gear > 0 ? d.primary * d.gears[this.gear - 1] * d.final : 0,
      wOut = (this.v / R_WHEEL) * R,
      e = Math.min(1, Math.max(0, (this.rpm - CLUTCH_IN) / CLUTCH_SPAN)),
      on = R > 0 && (this.shiftT <= 0 || this.shiftT > SHIFT_TIME),
      slip = this.omega - wOut,
      cap = on ? (slip < 0 ? Math.max(CLUTCH_MAX * e * e, ONEWAY_MAX) : CLUTCH_MAX * e * e) : 0,
      tc = cap * Math.tanh(slip / CLUTCH_SLIP),
      M = this.mass,
      th = Math.atan(this.slope / 100),
      fDrive = R > 0 ? (tc * R * (tc > 0 ? ETA_DRIVE : 1 / ETA_DRIVE)) / R_WHEEL : 0,
      fGrade = M * G * Math.sin(th),
      fRoll = M * G * CRR * Math.cos(th),
      fBrake = this.brake * BRAKE_MAX * M * G,
      Mt = M * (1 + M_ROT);
    let v = this.v;
    if (v <= 1e-3) {
      const f = fDrive - fGrade - fRoll - fBrake;
      v = f > 0 ? v + (f / Mt) * dt : 0;
    } else v = Math.max(0, v + ((fDrive - fGrade - fRoll - 0.5 * RHO_ATM * CDA * v * v - fBrake) / Mt) * dt);
    this.v = v;
    this.dist += v * dt;
    this.clutchT = tc;
    return tc;
  }

  /** 1 標本進めて、音圧 [Pa] を返す */
  step(): number {
    const dt = this.dt,
      phi = this.phi,
      deg = phi / DEG,
      V = this.vol(phi),
      { a, l } = this,
      s = Math.sin(phi),
      cs = Math.cos(phi),
      r = Math.sqrt(l * l - a * a * s * s),
      ds = a * s + (a * a * s * cs) / r,
      dds = a * cs + (a * a * (cs * cs - s * s)) / r + (a * a * a * a * s * s * cs * cs) / (r * r * r),
      dV = this.Ap * ds;
    let { m, T, mf } = this;
    const p = (m * R_GAS * T) / V,
      g = gammaOf(T),
      cv = R_GAS / (g - 1),
      cp = cv + R_GAS;

    /* 排気 */
    const sEx = this.valveS(this.spec.exValve, deg),
      aEx = this.valveA(this.spec.exValve, sEx),
      ex = this.ex;
    ex.prepare();
    const wEx = ex.aL[0];
    solveEnd(this.oEx, aEx, p, T, wEx, P_ATM, ex.zc[0], ex.T[0], this.exEnd);
    const mE = this.exEnd.m;
    let turb = 0;
    if (mE > 0 && aEx > 0) {
      const rho = p / (R_GAS * T),
        u = mE / (rho * aEx);
      turb = this.kTurb * 0.5 * rho * u * u * this.gauss();
    }
    ex.commit(this.exEnd.pe - P_ATM - wEx + turb, 0);

    /* 吸気 */
    const sIn = this.valveS(this.spec.inValve, deg),
      aIn = this.valveA(this.spec.inValve, sIn),
      inn = this.inn,
      k = inn.n - 1;
    inn.prepare();
    const wTh = inn.aL[0],
      wIv = inn.aR[k];
    solveEnd(this.oTh, this.throttleA(), P_ATM, T_ATM, wTh, P_ATM, inn.zc[0], inn.T[0], this.thEnd);
    solveEnd(this.oIn, aIn, p, T, wIv, P_ATM, inn.zc[k], inn.T[k], this.ivEnd);
    const mI = this.ivEnd.m,
      mTh = this.thEnd.m;
    inn.commit(this.thEnd.pe - P_ATM - wTh, this.ivEnd.pe - P_ATM - wIv);

    /* シリンダの質量とエネルギー */
    const fFresh = m > 0 ? mf / m : 0,
      cpEx = (1.33 / 0.33) * R_GAS,
      cpIn = 3.5 * R_GAS;
    let H = 0,
      dm = 0,
      dmf = 0;
    if (mE > 0) {
      H -= mE * cp * T * dt;
      dmf -= mE * fFresh * dt;
      this.acc.hEx += mE * T * dt;
      this.acc.mEx += mE * dt;
    } else H -= mE * cpEx * ex.T[0] * dt;
    dm -= mE * dt;
    if (mI > 0) {
      H -= mI * cp * T * dt;
      dmf -= mI * fFresh * dt;
      this.rb += mI * (1 - fFresh) * dt;
    } else {
      const inflow = -mI * dt,
        burnt = Math.min(this.rb, inflow);
      this.rb -= burnt;
      H += inflow * cpIn * inn.T[k];
      dmf += inflow - burnt;
    }
    dm -= mI * dt;

    /* 燃焼（Wiebe: x = 1 − exp(−5 ((φ − φs)/Δφ)³)） */
    const dphi = this.omega * dt,
      phiN = phi + dphi;
    let dQ = 0;
    if (this.qTot > 0 && phiN > this.phiS && phi < this.phiS + 1.5 * this.dPhi) {
      const u = Math.max(0, (phiN - this.phiS) / this.dPhi),
        xb = 1 - Math.exp(-5 * u * u * u);
      dQ = this.qTot * (xb - this.xb);
      dmf -= this.mfIvc * (xb - this.xb);
      this.xb = xb;
      this.burning = true;
    }

    /* 壁への熱（Woschni 1967 の相関を Heywood の単位系で書いた形。燃焼の項は IVC からのモータリングの圧力との差） */
    const sp = (this.spec.stroke * this.omega) / Math.PI,
      gasEx = sEx >= 0 || sIn >= 0;
    let wv = (gasEx ? 6.18 : 2.28) * sp;
    if (this.burning) {
      const pMot = this.pIvc * (this.vIvc / V) ** 1.33;
      wv += ((3.24e-3 * this.Vd * this.tIvc) / (this.pIvc * this.vIvc)) * Math.max(0, p - pMot);
    }
    const hc = 3.26 * this.spec.bore ** -0.2 * (p / 1000) ** 0.8 * T ** -0.55 * Math.max(0.1, wv) ** 0.8,
      Aw = 2.2 * this.Ap + (4 * V) / this.spec.bore,
      Qw = hc * Aw * (T - T_WALL) * dt;

    const W = p * dV * dphi,
      U = m * cv * T + dQ - Qw - W + H;
    m += dm;
    mf = Math.min(m, Math.max(0, mf + dmf));
    T = Math.max(250, U / (m * cv));
    this.m = m;
    this.T = T;
    this.mf = mf;
    this.pCyl = (m * R_GAS * T) / V;

    /* クランク */
    const tq = (p - P_ATM) * dV,
      tf = this.friction();
    if (this.mode !== 'hold') {
      const Je = this.spec.J + this.spec.mRec * ds * ds,
        tr = this.spec.mRec * ds * dds * this.omega * this.omega,
        tc = this.mode === 'drive' ? this.driveStep(dt) : 0;
      this.omega = Math.max(10, this.omega + ((tq - tr - tf - this.load - tc) / Je) * dt);
    }

    /* 集計 */
    const c = this.acc;
    c.w += (p - P_ATM) * dV * dphi;
    c.mTh += mTh * dt;
    if (p > c.pmax) {
      c.pmax = p;
      c.aPmax = deg - 360;
    }

    /* 角度を進めて、吸気弁が閉じるところとサイクルの終わりを見る */
    const ivc = (this.spec.inValve.open + this.spec.inValve.dur) * DEG;
    if (phi < ivc && phiN >= ivc) this.onIvc();
    if (phiN >= 2 * TAU) {
      this.phi = phiN - 2 * TAU;
      this.onCycle();
    } else this.phi = phiN;

    /* 管の温度（64 標本ごと） */
    this.cycT += dt;
    if ((this.tick++ & 63) === 0) {
      const tx = this.last ? this.last.tExh : this.tExh;
      this.tExh += (tx - this.tExh) * Math.min(1, (64 * dt) / 0.3);
      ex.setTemp(T_ATM + this.tGas * (this.tExh - T_ATM));
    }

    /* 音: 排気の出口の体積流量の時間微分（単極子） */
    const rhoJ = ex.rhoEnd(),
      q = ex.mOut / rhoJ;
    this.pEx = ((RHO_ATM / (4 * Math.PI * R_EX)) * (q - this.qPrev)) / dt;
    this.qPrev = q;
    /* 出口の噴流の音: 音圧の実効値 √(ρ₀c₀ W / 4πr²) を、帯域を絞った雑音（実効値 1 に合わせる）に掛ける */
    {
      const kt = ex.n - 1,
        cj = ex.c[kt],
        At = cj / ex.zc[kt],
        ut = Math.max(0, ex.mOut) / (rhoJ * At),
        amp =
          Math.sqrt((RHO_ATM * 343 * this.kJet * rhoJ * ((4 * At) / Math.PI)) / (4 * Math.PI * R_EX * R_EX * cj ** 5)) *
          ut ** 4,
        x0 = this.gauss(),
        ah = 1 / (1 + (TAU * 400) / this.fs),
        al = 1 - Math.exp((-TAU * 3000) / this.fs);
      this.jh = ah * (this.jh + x0 - this.jx);
      this.jx = x0;
      this.jl += al * (this.jh - this.jl);
      this.pEx += (amp * this.jl) / 0.36;
    }
    /* 音色の補正: 低い棚を通した音へ、スロットルの開きに応じて移す（0.1 s でならす） */
    if (this.tone) {
      const [b0, b1, b2, a1, a2] = this.tone,
        x = this.pEx,
        y = b0 * x + b1 * this.tx1 + b2 * this.tx2 - a1 * this.ty1 - a2 * this.ty2;
      this.tx2 = this.tx1;
      this.tx1 = x;
      this.ty2 = this.ty1;
      this.ty1 = y;
      this.toneW += (Math.min(1, this.throttleEff / 0.15) - this.toneW) * (dt / 0.1);
      this.pEx = x + this.toneW * (y - x);
    }
    /* 吸気: スロットルを通る体積流量を、エアクリーナーの箱の共鳴（2 次の低域通過、110 Hz・Q 2）に通して微分。
       箱と吸い込み口の消音の分として 0.3 倍（−10 dB）にする（目安） */
    {
      const f = 110,
        w = (TAU * f) / this.fs,
        rr = Math.exp(-w / 4),
        b = 1 - 2 * rr * Math.cos(w) + rr * rr,
        y = b * (mTh / RHO_ATM) + 2 * rr * Math.cos(w) * this.inLp1 - rr * rr * this.inLp2;
      this.inLp2 = this.inLp1;
      this.inLp1 = y;
      this.pIn = (0.3 * (RHO_ATM / (4 * Math.PI * R_IN)) * (y - this.qInPrev)) / dt;
      this.qInPrev = y;
    }
    /* 機械音: 弁の打音（開くときの隙間の詰まり・閉じるときの着座）と燃焼の圧力の立ち上がり */
    let x = 0;
    const sPrevEx = this.valveS(this.spec.exValve, (phi - dphi) / DEG),
      sPrevIn = this.valveS(this.spec.inValve, (phi - dphi) / DEG),
      hit = this.kValve * Math.sqrt(this.omega * ((this.spec.idle / 60) * TAU));
    /* 打音は 1 標本の衝撃でなく、短く減衰する雑音（時定数 1.5 ms）にする。エネルギーは衝撃と同じ */
    if (sPrevEx < 0 !== sEx < 0) this.tick0 += hit * (1 + 0.3 * this.rand());
    if (sPrevIn < 0 !== sIn < 0) this.tick0 += hit * (1 + 0.3 * this.rand());
    x += (this.tick0 * this.gauss()) / Math.sqrt((0.0015 * this.fs) / 2);
    this.tick0 *= Math.exp(-1 / (0.0015 * this.fs));
    const pN = (m * R_GAS * T) / this.vol(this.phi);
    const dp = pN - this.pPrev;
    if (this.burning) x += (dp - this.dpPrev) * this.kComb;
    this.pPrev = pN;
    this.dpPrev = dp;
    let y = 0;
    for (const md of this.modes) {
      const v = md.g * x + md.a1 * md.y1 + md.a2 * md.y2;
      md.y2 = md.y1;
      md.y1 = v;
      y += v;
    }
    this.pMech = (y * 1e-4 * MECH_GAIN) / R_MECH;
    const out = this.mix.ex * this.pEx + this.mix.in * this.pIn + this.mix.mech * this.pMech;
    this.acc.p2 += out * out;
    this.acc.n++;
    return out;
  }
}
