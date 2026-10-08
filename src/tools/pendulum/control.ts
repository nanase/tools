/**
 * 倒立振子の制御とシミュレーション（DOM に依存しない）: 制御器の設計（PID・極配置・LQR）、
 * エネルギー法の振り上げ、離散時間の制御（制御周期・エンコーダの量子化・雑音・速度の推定・入力の飽和）、
 * 整定時間などの測定
 */
import { acker, type C, eig, lqr, type Mat } from './linalg';
import { type Drive, driveOf, forceOf, G, impulse, linearize, type Plant, pendEnergy, railStop, rk4 } from './model';

export type Kind = 'pid' | 'place' | 'lqr';
export interface Ctrl {
  kind: Kind;
  /** 振り上げる（倒れたらまた振り上げる） */
  swing: boolean;
  /** LQR の重み Q = diag(qx, qθ, qẋ, qθ̇) と R */
  q: [number, number, number, number];
  r: number;
  /** 極配置: 2 組の固有角周波数 [rad/s] と減衰比 */
  w1: number;
  z1: number;
  w2: number;
  z2: number;
  /** PID: 角度のループ（入力/rad）と位置のループ（rad/m） */
  kpa: number;
  kia: number;
  kda: number;
  kpx: number;
  kix: number;
  kdx: number;
  /** 振り上げ: エネルギーのゲイン（無次元）、台車の加速度の上限 [m/s²]、安定化へ切り替える角度 [rad] */
  ke: number;
  amax: number;
  thsw: number;
  /** 振り上げないときの初めの傾き [rad] */
  th0: number;
}
export interface Sense {
  /** 制御周期 [s] */
  ts: number;
  /** 角度のエンコーダの 1 回転のカウント数 */
  cpr: number;
  /** 位置の分解能 [m/count] */
  xres: number;
  /** 速度を推定するフィルタの遮断周波数 [Hz] */
  fv: number;
  /** 雑音の標準偏差: 角度 [rad]、位置 [m] */
  nth: number;
  nx: number;
}

/** 位置のループが出す目標角度の上限 [rad] */
export const THREF_MAX = (10 * Math.PI) / 180;
/** 速度の推定のフィルタの減衰比（Quanser の SIP の設定と同じ 0.9） */
export const ZETA_F = 0.9;
/**
 * 振り上げ（このツールで選んだ値）: 目標のエネルギー（直立より mgl の 5 % 上）、加速度を弱める |s| の下限、
 * 台車を中央へ寄せる強さ（固有角周波数 [rad/s]）、クーロン摩擦を補う速さの幅 [m/s]
 */
export const SWING_E0 = 0.05,
  SWING_S0 = 0.2,
  CENTER_W = 1.5,
  FC_V = 0.05;

/* ---------- 設計 ---------- */
/** 固有角周波数 ω と減衰比 ζ の 2 つの極（ζ ≥ 1 なら実数の 2 つ） */
export function pairOf(w: number, z: number): C[] {
  if (z < 1) {
    const im = w * Math.sqrt(1 - z * z);
    return [
      { re: -z * w, im },
      { re: -z * w, im: -im },
    ];
  }
  const d = Math.sqrt(z * z - 1);
  return [
    { re: -w * (z - d), im: 0 },
    { re: -w * (z + d), im: 0 },
  ];
}

export interface Design {
  /** 状態フィードバック u = −K[x θ ẋ θ̇]（PID は積分を除いた等価なゲイン）。求まらなければ null */
  K: number[] | null;
  /** PID の積分のゲイン（u = −Kz·[∫e_x, ∫e_θ]。使わない積分は 0） */
  Kz: [number, number];
  /** 閉ループの極（連続時間の線形模型）と開ループの極 */
  cl: C[];
  ol: C[];
  /** 求まらない理由 */
  err: string;
}

/** 制御器を設計し、線形模型の閉ループの極を求める */
export function design(p: Plant, c: Ctrl): Design {
  const { A, B } = linearize(p),
    ol = eig(A) ?? [];
  const o: Design = { K: null, Kz: [0, 0], cl: [], ol, err: '' };
  if (c.kind === 'lqr') {
    const r = lqr(A, B, c.q, c.r);
    if (!r) {
      o.err = 'リカッチ方程式の解が求まりません';
      return o;
    }
    o.K = r.K;
  } else if (c.kind === 'place') {
    const K = acker(A, B, [...pairOf(c.w1, c.z1), ...pairOf(c.w2, c.z2)]);
    if (!K) {
      o.err = '可制御でないため極を置けません';
      return o;
    }
    o.K = K;
  } else {
    const { kpa, kia, kda, kpx, kix, kdx } = c;
    o.K = [-kpa * kpx, -kpa, -kpa * kdx, -kda];
    o.Kz = [kpa * kix, -kia];
    o.cl = pidPoles(A, B, c);
    return o;
  }
  const K = o.K;
  o.cl = eig(A.map((row, i) => row.map((v, j) => v - B[i] * K[j]))) ?? [];
  return o;
}

/** PID（位置のループの出力を角度のループの目標にする）の閉ループの極。使う積分だけを状態に足す */
function pidPoles(A: Mat, B: number[], c: Ctrl): C[] {
  const { kpa, kia, kda, kpx, kix, kdx } = c,
    useX = kix !== 0,
    useT = kia !== 0,
    n = 4 + (useX ? 1 : 0) + (useT ? 1 : 0),
    iX = 4,
    iT = useX ? 5 : 4;
  /* u = kpa·kpx·x + kpa·θ + kpa·kdx·ẋ + kda·θ̇ − kpa·kix·z_x + kia·z_θ */
  const g = new Array<number>(n).fill(0);
  g[0] = kpa * kpx;
  g[1] = kpa;
  g[2] = kpa * kdx;
  g[3] = kda;
  if (useX) g[iX] = -kpa * kix;
  if (useT) g[iT] = kia;
  const M: Mat = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < 4; i++) for (let j = 0; j < n; j++) M[i][j] = (j < 4 ? A[i][j] : 0) + B[i] * g[j];
  /* ż_x = e_x = −x、ż_θ = θ − θref = θ + kpx·x + kdx·ẋ − kix·z_x */
  if (useX) M[iX][0] = -1;
  if (useT) {
    M[iT][0] = kpx;
    M[iT][1] = 1;
    M[iT][2] = kdx;
    if (useX) M[iT][iX] = -kix;
  }
  return eig(M) ?? [];
}

/* ---------- 乱数 ---------- */
/** 再現できる乱数（mulberry32）と正規分布 */
export function rng(seed: number): { u: () => number; n: () => number } {
  let a = seed >>> 0;
  const u = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    u,
    n: () => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u()),
  };
}

/* ---------- 速度の推定 ---------- */
/**
 * 計測値を微分して 2 次の低域通過フィルタに通す H(s) = ω²s / (s² + 2ζωs + ω²) を、
 * 双一次変換で離散化したもの（一定の速さを正しく読むよう、周波数を合わせる補正はしない）
 */
export class DiffFilter {
  private b0 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  constructor(fc: number, ts: number) {
    const w = 2 * Math.PI * Math.min(fc, 0.45 / ts),
      K = 2 / ts,
      a0 = K * K + 2 * ZETA_F * w * K + w * w;
    this.b0 = (w * w * K) / a0;
    this.a1 = (2 * w * w - 2 * K * K) / a0;
    this.a2 = (K * K - 2 * ZETA_F * w * K + w * w) / a0;
  }
  /** 初めの値に合わせ、出力を 0 にする */
  reset(x: number): void {
    this.x1 = this.x2 = x;
    this.y1 = this.y2 = 0;
  }
  step(x: number): number {
    const y = this.b0 * (x - this.x2) - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/* ---------- シミュレーション ---------- */
/** 積分の刻み [s]（制御周期はこの整数倍） */
export const H = 2.5e-4;
/** 記録の間隔 [s] と長さ（10 s） */
export const REC_DT = 0.01,
  REC_N = 1000;
/** 整定とみなす範囲（角度 [rad]・位置 [m]）と、その範囲に留まる時間 [s] */
export const BAND_TH = (1 * Math.PI) / 180,
  BAND_X = 0.01,
  BAND_HOLD = 1;

export type Mode = 'swing' | 'bal' | 'fall';
export type EvKind = 'start' | 'catch' | 'push' | 'fall';

const wrap = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
const sgn = (v: number) => (v >= 0 ? 1 : -1);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 安定化をやめる角度: 切り替えの角度より 10° 大きく、30° 以上 */
export const fallAngle = (c: Ctrl): number => Math.max((30 * Math.PI) / 180, c.thsw + (10 * Math.PI) / 180);

export class Sim {
  p: Plant;
  d: Drive;
  c: Ctrl;
  se: Sense;
  ds: Design;
  /** 状態 [x, θ, ẋ, θ̇]（θ は巻き戻さない） */
  s = [0, Math.PI, 0, 0];
  /** 時刻 [s] と積分のステップ数 */
  t = 0;
  n = 0;
  mode: Mode = 'swing';
  /** 保持している入力（上限で切った値）と、切る前の指令 */
  u = 0;
  cmd = 0;
  /** 台車にかかる駆動の力 [N] */
  F = 0;
  /** 計測値と推定値（制御器が見ている値） */
  mx = 0;
  mth = 0;
  vx = 0;
  vth = 0;
  /** レールの端に当たっている */
  hit = false;
  /* 測定 */
  ev: { t: number; k: EvKind } = { t: 0, k: 'start' };
  /** 整定時間 [s]（出来事から。整定していなければ null） */
  settle: number | null = null;
  private inBand: number | null = null;
  /** 出来事からの最大の力 [N]・最大の入力・台車の最大の変位 [m] */
  fmax = 0;
  umaxSeen = 0;
  xmax = 0;
  /** 振り上げを始めた時刻と、最後の振り上げにかかった時間 [s] */
  swingFrom: number | null = 0;
  tUp: number | null = null;
  /** 記録（10 ms ごと、角度 [rad]・位置 [m]・力 [N]・入力） */
  rec = {
    th: new Float32Array(REC_N),
    x: new Float32Array(REC_N),
    f: new Float32Array(REC_N),
    u: new Float32Array(REC_N),
    /** 次に書く位置と、書いた数 */
    i: 0,
    len: 0,
  };
  private fx: DiffFilter;
  private ft: DiffFilter;
  private zx = 0;
  private zt = 0;
  private nTs = 4;
  private rnd = rng(1);
  private fresh = true;
  private carry = 0;

  constructor(p: Plant, c: Ctrl, se: Sense) {
    this.p = p;
    this.d = driveOf(p);
    this.c = c;
    this.se = se;
    this.ds = design(p, c);
    this.fx = new DiffFilter(se.fv, se.ts);
    this.ft = new DiffFilter(se.fv, se.ts);
    this.nTs = Math.max(1, Math.round(se.ts / H));
    this.reset();
  }

  /** 装置・制御・計測を変える（状態はそのまま） */
  setPlant(p: Plant): void {
    this.p = p;
    this.d = driveOf(p);
    this.ds = design(p, this.c);
  }
  setCtrl(c: Ctrl): void {
    const was = this.c;
    this.c = c;
    this.ds = design(this.p, c);
    if (was.kind !== c.kind) this.zx = this.zt = 0;
    if (!was.swing && c.swing && this.mode === 'fall') this.toSwing();
    if (was.swing && !c.swing && this.mode === 'swing') this.mode = 'fall';
  }
  setSense(se: Sense): void {
    const ch = se.ts !== this.se.ts || se.fv !== this.se.fv;
    this.se = se;
    if (ch) {
      this.nTs = Math.max(1, Math.round(se.ts / H));
      this.fx = new DiffFilter(se.fv, se.ts);
      this.ft = new DiffFilter(se.fv, se.ts);
      this.fresh = true;
    }
  }

  /** 初めの状態に戻す。振り上げるなら真下で静止、振り上げないなら初めの傾きで静止 */
  reset(): void {
    const { c } = this;
    this.s = c.swing ? [0, Math.PI, 0, 0] : [0, c.th0, 0, 0];
    this.t = 0;
    this.n = 0;
    this.u = this.cmd = this.F = 0;
    this.zx = this.zt = 0;
    this.mode = c.swing ? 'swing' : 'bal';
    this.rnd = rng(1);
    this.fresh = true;
    this.rec.i = this.rec.len = 0;
    this.tUp = null;
    this.swingFrom = c.swing ? 0 : null;
    this.hit = false;
    this.carry = 0;
    this.event('start');
  }

  private event(k: EvKind): void {
    this.ev = { t: this.t, k };
    this.settle = null;
    this.inBand = null;
    this.fmax = Math.abs(this.F);
    this.umaxSeen = Math.abs(this.u);
    this.xmax = Math.abs(this.s[0]);
  }

  private toSwing(): void {
    this.mode = 'swing';
    this.swingFrom = this.t;
    this.zx = this.zt = 0;
  }

  /** 押す。r は振子の軸から押す点までの長さ [m]（null なら台車） */
  push(P: number, r: number | null): void {
    impulse(this.p, this.d, this.s, P, r);
    this.event('push');
  }

  /** 計測と推定（制御周期ごと） */
  private measure(): void {
    const { se, s } = this,
      q = (2 * Math.PI) / se.cpr,
      th = Math.round((s[1] + Math.PI + (se.nth ? se.nth * this.rnd.n() : 0)) / q) * q - Math.PI,
      x = Math.round((s[0] + (se.nx ? se.nx * this.rnd.n() : 0)) / se.xres) * se.xres;
    if (this.fresh) {
      this.fx.reset(x);
      this.ft.reset(th);
      this.fresh = false;
    }
    this.vx = this.fx.step(x);
    this.vth = this.ft.step(th);
    this.mx = x;
    this.mth = wrap(th);
  }

  /** 制御（制御周期ごと）: 入力を決めて保持する */
  private control(): void {
    this.measure();
    const { p, c, se } = this,
      th = this.mth,
      thA = Math.abs(th);
    /* 切り替え */
    if (this.mode === 'swing' && thA <= c.thsw) {
      this.mode = 'bal';
      if (this.swingFrom !== null) this.tUp = this.t - this.swingFrom;
      this.swingFrom = null;
      this.zx = this.zt = 0;
      this.event('catch');
    } else if (this.mode === 'bal' && thA > fallAngle(c)) {
      this.event('fall');
      if (c.swing) this.toSwing();
      else this.mode = 'fall';
    }
    let u = 0;
    if (this.mode === 'bal') u = this.balance(th);
    else if (this.mode === 'swing') u = this.swingUp(th);
    this.cmd = u;
    this.u = clamp(u, -p.umax, p.umax);
    /* 積分（飽和した向きには積まない） */
    if (this.mode === 'bal' && c.kind === 'pid') {
      const sat = this.u !== u,
        ex = -this.mx,
        et = th - this.thref();
      if (!sat || Math.sign(u) !== Math.sign(c.kia * et)) this.zt += et * se.ts;
      if (!sat || Math.sign(u) !== Math.sign(-c.kpa * c.kix * ex)) this.zx += ex * se.ts;
    }
  }

  /**
   * エネルギー法の振り上げ（Åström・Furuta）。台車の加速度 a = sat(k g (E − E0) sign(s) min(max(|s|, s0), 1))、
   * s = (θ̇/ω0) cos θ。|s| が小さい間（直立の近くや止まっているとき）は加速度を弱め、台車を中央へ寄せる項を足す。
   * 加速度は、台車と回転子の質量・逆起電力・摩擦を補って入力に直す
   */
  private swingUp(th: number): number {
    const { p, c, d } = this,
      E = pendEnergy(p, th, this.vth) / (p.m * G * p.l),
      w0 = Math.sqrt((p.m * G * p.l) / (p.J + p.m * p.l * p.l)),
      s = (this.vth / w0) * Math.cos(th),
      a0 = clamp(c.ke * G * (E - SWING_E0) * sgn(s) * Math.min(1, Math.max(Math.abs(s), SWING_S0)), -c.amax, c.amax),
      a = clamp(a0 - CENTER_W * CENTER_W * this.mx - 2 * CENTER_W * this.vx, -c.amax, c.amax);
    return (d.Me * a + (d.beta + p.bc) * this.vx + p.fc * clamp(this.vx / FC_V, -1, 1)) / d.alpha;
  }

  /** 位置のループの出力（角度の目標） */
  private thref(): number {
    const { c } = this;
    return clamp(c.kpx * -this.mx + c.kix * this.zx - c.kdx * this.vx, -THREF_MAX, THREF_MAX);
  }

  private balance(th: number): number {
    const { c, ds } = this;
    if (c.kind === 'pid') return c.kpa * (th - this.thref()) + c.kia * this.zt + c.kda * this.vth;
    const K = ds.K;
    if (!K) return 0;
    return -(K[0] * this.mx + K[1] * th + K[2] * this.vx + K[3] * this.vth);
  }

  /** dt [s] だけ進める。積分の刻みに満たない端数は次へ持ち越す */
  advance(dt: number): void {
    this.carry += dt;
    const steps = Math.floor(this.carry / H + 1e-9);
    this.carry -= steps * H;
    for (let k = 0; k < steps; k++) this.step();
  }

  private step(): void {
    const { p, d, s } = this;
    if (this.n % this.nTs === 0) this.control();
    rk4(p, d, s, this.u, H);
    this.hit = railStop(p, s);
    this.n++;
    this.t = this.n * H;
    this.F = forceOf(d, this.u, s[2]);
    /* 測定 */
    const af = Math.abs(this.F);
    if (af > this.fmax) this.fmax = af;
    if (Math.abs(this.u) > this.umaxSeen) this.umaxSeen = Math.abs(this.u);
    if (Math.abs(s[0]) > this.xmax) this.xmax = Math.abs(s[0]);
    const inb = this.mode === 'bal' && Math.abs(wrap(s[1])) <= BAND_TH && Math.abs(s[0]) <= BAND_X;
    if (!inb) {
      this.inBand = null;
      this.settle = null;
    } else {
      if (this.inBand === null) this.inBand = this.t;
      if (this.settle === null && this.t - this.inBand >= BAND_HOLD) this.settle = Math.max(0, this.inBand - this.ev.t);
    }
    if (this.n % Math.round(REC_DT / H) === 0) {
      const r = this.rec;
      r.th[r.i] = wrap(s[1]);
      r.x[r.i] = s[0];
      r.f[r.i] = this.F;
      r.u[r.i] = this.u;
      r.i = (r.i + 1) % REC_N;
      if (r.len < REC_N) r.len++;
    }
  }
}
