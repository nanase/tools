/** 流れの中の物体を PID 制御で目標の位置へ動かすシミュレーション（DOM に依存しない） */
import { DV, nice } from '../../lib/scope';

/** 刻み幅 [s] とステップ数（100 s ぶん） */
export const DT = 0.1,
  N = 1000;
/** これを超えたら計算を打ち切る */
const LIM = 1e12;
/** これを超えたら発散とみなす */
const DIV = 1e6;

/** 位置型の PID 制御器。最初の呼び出しでは前回の誤差を 0 とする */
export class PIDController {
  private prev = 0;
  private integral = 0;

  constructor(
    readonly kp: number,
    readonly ki: number,
    readonly kd: number,
  ) {}

  calculate(setpoint: number, current: number, dt: number): number {
    const e = setpoint - current;
    this.integral += e * dt;
    const u = this.kp * e + this.ki * this.integral + (this.kd * (e - this.prev)) / dt;
    this.prev = e;
    return u;
  }
}

export interface In {
  kp: number;
  ki: number;
  kd: number;
  /** 初期位置・目標位置 [m] */
  x0: number;
  r: number;
  /** 初速・周囲の流速 [m/s] */
  v0: number;
  w: number;
  /** 加速の応答性（1 次遅れの係数） */
  al: number;
}

export interface Sim {
  /** 位置・速度（打ち切ったらそこまで） */
  X: Float64Array;
  V: Float64Array;
  n: number;
}

export function simulate({ kp, ki, kd, x0, r, v0, w, al }: In): Sim {
  const X = new Float64Array(N),
    V = new Float64Array(N),
    pid = new PIDController(kp, ki, kd);
  let x = x0,
    v = v0,
    a = 0,
    n = N;
  X[0] = x;
  V[0] = v;
  for (let i = 1; i < N; i++) {
    const u = pid.calculate(r, x, DT);
    a += (u * DT - a) * al;
    v += a;
    x += (v + w) * DT;
    if (!(Math.abs(x) < LIM && Math.abs(v) < LIM)) {
      n = i;
      break;
    }
    X[i] = x;
    V[i] = v;
  }
  return { X: X.subarray(0, n), V: V.subarray(0, n), n };
}

export interface Metrics {
  /** |x| か |v| が 10⁶ を超えたか、途中で打ち切ったか */
  div: boolean;
  /** 誤差の絶対値の積分 [m·s] */
  iae: number;
  /** 最大速度 [m/s] */
  vm: number;
  /** 終了時の偏差 [m] */
  ee: number;
  /** 立ち上がり時間（10 %→90 %）、ピーク時刻 [s]、オーバーシュート [%]、整定時間（±2 %）[s]。求まらなければ null */
  tr: number | null;
  tp: number | null;
  os: number | null;
  ts: number | null;
  /** 目標位置が初期位置と同じ（応答の指標を求めない） */
  flat: boolean;
}

export function metrics({ X, V, n }: Sim, x0: number, r: number): Metrics {
  const d = r - x0;
  let div = n < N,
    iae = 0,
    vm = 0;
  for (let i = 0; i < n; i++) {
    iae += Math.abs(r - X[i]) * DT;
    vm = Math.max(vm, Math.abs(V[i]));
    if (Math.abs(X[i]) > DIV || Math.abs(V[i]) > DIV) div = true;
  }
  const o: Metrics = {
    div,
    iae,
    vm,
    ee: r - X[n - 1],
    tr: null,
    tp: null,
    os: null,
    ts: null,
    flat: Math.abs(d) < 1e-9,
  };
  if (Math.abs(o.ee) < 1e-9) o.ee = 0;
  if (o.flat) return o;
  /* 変化幅で正規化した応答（0 から 1 へ） */
  const y = (i: number) => (X[i] - x0) / d;
  const cross = (lv: number) => {
    for (let i = 1; i < n; i++)
      if (y(i) >= lv) {
        const a = y(i - 1),
          b = y(i);
        return (i - 1 + (lv - a) / (b - a)) * DT;
      }
    return null;
  };
  const t10 = cross(0.1),
    t90 = cross(0.9);
  if (t10 != null && t90 != null) o.tr = t90 - t10;
  let ym = -Infinity,
    im = 0;
  for (let i = 0; i < n; i++)
    if (y(i) > ym) {
      ym = y(i);
      im = i;
    }
  o.os = Math.max(0, (ym - 1) * 100);
  if (ym > 1) o.tp = im * DT;
  const band = 0.02 * Math.abs(d);
  let last = -1;
  for (let i = n - 1; i >= 0; i--)
    if (Math.abs(X[i] - r) > band) {
      last = i;
      break;
    }
  if (!div && last < N - 1) o.ts = (last + 1) * DT;
  return o;
}

/** 応答の表示窓の縦の div の数（横 10 div より低くして、位置と速度の 2 枚を並べやすくする） */
export const ROWS = 4;

/**
 * 縦軸のレンジ。0 を目盛線に置き、lo〜hi が rows div（上下 0.1 div のはみ出しは許す）に収まる
 * 最小の 1-2-5 の vd を選ぶ。k は 0 の位置（下から何 div か）
 */
export function vscale(lo: number, hi: number, fb: number, rows = 6): { vd: number; k: number } {
  lo = Math.min(lo, 0);
  hi = Math.max(hi, 0);
  let vd = hi - lo > 0 ? nice((hi - lo) / rows) : fb;
  for (let t = 0; t < 80; t++, vd = nice(vd * 1.5)) {
    let best = -1,
      bs = Infinity;
    for (let k = 0; k <= rows; k++) {
      const bot = -k * vd,
        top = (rows - k) * vd,
        tol = vd * 0.1;
      if (lo >= bot - tol && hi <= top + tol) {
        const s = Math.abs(top - hi - (lo - bot));
        if (s < bs - 1e-12) {
          bs = s;
          best = k;
        }
      }
    }
    if (best >= 0) return { vd, k: best };
  }
  return { vd, k: rows >> 1 };
}

/** 表示窓（横 10 s/div、縦 rows div）に描く折れ線と座標変換。ref は含めてレンジを決める値（目標など） */
export function trace(data: ArrayLike<number>, ref: number, rows = 6) {
  let lo = ref,
    hi = ref;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const { vd, k } = vscale(lo, hi, 1, rows),
    y0 = rows * DV - k * DV;
  const Y = (v: number) => (y0 - (v / vd) * DV).toFixed(1),
    X = (t: number) => ((t / 10) * DV).toFixed(1);
  let d = '';
  for (let i = 0; i < data.length; i++) d += `${(i ? 'L' : 'M') + X(i * DT)} ${Y(data[i])}`;
  return { vd, k, y0, d, X, Y };
}
