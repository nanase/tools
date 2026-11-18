/** 流れの中の物体を PID 制御で目標の位置へ動かすシミュレーション（DOM に依存しない） */
import { nice } from '../../lib/scope';

/** 刻み幅 [s] と simulate のステップ数（100 s ぶん。Boat を突き合わせる基準） */
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
  /** 水の抵抗 [1/s]（流れに対する速さに比例して減速させる）。省略時 0 */
  c?: number;
}

export interface Sim {
  /** 位置・速度（打ち切ったらそこまで） */
  X: Float64Array;
  V: Float64Array;
  n: number;
}

export function simulate({ kp, ki, kd, x0, r, v0, w, al, c = 0 }: In): Sim {
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
    v += a - c * v * DT;
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

/**
 * 1 ステップずつ進める版（川の枠のライブ）。simulate と同じ式で、目標を途中で変えたり、押したり、PID を切ったりできる。
 * 目標を変えずに N − 1 回 step すると simulate と同じ列になる
 */
export class Boat {
  x = 0;
  v = 0;
  /** 1 次遅れのあとの、1 ステップあたりの速度の変化（推力は a/Δt） */
  a = 0;
  t = 0;
  /** 誤差の積分と前回の誤差 */
  private integral = 0;
  private prev = 0;
  /** 直前のステップの比例・積分・微分の各項（PID を切っている間は 0） */
  up = 0;
  ui = 0;
  ud = 0;
  /** PID の入・切。切ると操作量は 0 */
  on = true;

  constructor(public p: In) {
    this.reset();
  }

  reset(p: In = this.p): void {
    this.p = p;
    this.x = p.x0;
    this.v = p.v0;
    this.a = this.t = this.integral = this.prev = this.up = this.ui = this.ud = 0;
  }

  /** PID の入・切。入に戻すときは積分を 0 から始め、前回の誤差を今の誤差にそろえる（微分項を跳ねさせない） */
  setOn(on: boolean): void {
    if (on && !this.on) {
      this.integral = 0;
      this.prev = this.p.r - this.x;
    }
    this.on = on;
  }

  /** 流れに対する速さを dv だけ変える */
  push(dv: number): void {
    this.v += dv;
  }

  /** 操作量 u（制御器の出力の合計） */
  get u(): number {
    return this.up + this.ui + this.ud;
  }

  step(): void {
    const { kp, ki, kd, r, w, al, c = 0 } = this.p;
    if (this.on) {
      const e = r - this.x;
      this.integral += e * DT;
      this.up = kp * e;
      this.ui = ki * this.integral;
      this.ud = (kd * (e - this.prev)) / DT;
      this.prev = e;
    } else this.up = this.ui = this.ud = 0;
    this.a += (this.u * DT - this.a) * al;
    this.v += this.a - c * this.v * DT;
    this.x += (this.v + w) * DT;
    this.t += DT;
  }

  /** |x| か |v| が 10⁶ を超えたか（計算結果の発散と同じ閾値）。値が数でなくなったときも */
  get diverged(): boolean {
    return !(Math.abs(this.x) <= DIV && Math.abs(this.v) <= DIV);
  }
}

/** 100 s の計算（計算のモード）: 位置・速度・推力 a/Δt・制御器の各項。Boat を N − 1 回進めた記録で、発散したらそこまで */
export interface Rec extends Sim {
  A: Float64Array;
  UP: Float64Array;
  UI: Float64Array;
  UD: Float64Array;
}

export function record(p: In): Rec {
  const b = new Boat(p),
    X = new Float64Array(N),
    V = new Float64Array(N),
    A = new Float64Array(N),
    UP = new Float64Array(N),
    UI = new Float64Array(N),
    UD = new Float64Array(N);
  X[0] = b.x;
  V[0] = b.v;
  let n = N;
  for (let i = 1; i < N; i++) {
    b.step();
    if (!(Math.abs(b.x) < LIM && Math.abs(b.v) < LIM)) {
      n = i;
      break;
    }
    X[i] = b.x;
    V[i] = b.v;
    A[i] = b.a / DT;
    UP[i] = b.up;
    UI[i] = b.ui;
    UD[i] = b.ud;
  }
  const s = (a: Float64Array) => a.subarray(0, n);
  return { X: s(X), V: s(V), A: s(A), UP: s(UP), UI: s(UI), UD: s(UD), n };
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

export function metrics({ X, V, n }: Pick<Sim, 'X' | 'V' | 'n'>, x0: number, r: number): Metrics {
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

/* ---------- 自動調整 ---------- */

/** 自動調整の条件: 行き過ぎ [%]・流れに対する速さ [m/s] の上限 */
export const TUNE_OS = 5,
  TUNE_VMAX = 10;

/** ゲインの並び（入力と同じ 0 と 0.0001〜20 の E12） */
export const GAIN_LIST: readonly number[] = (() => {
  const E12 = [1, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2],
    L = [0];
  for (let d = -4; d <= 1; d++)
    for (const m of E12) if (m * 10 ** d <= 20) L.push(Number((m * 10 ** d).toPrecision(2)));
  L.push(20);
  return L;
})();

/**
 * 100 s のステップ応答の評価: 時間の重み付き誤差の積分 ITAE。整定しない・発散するなら Infinity、
 * 行き過ぎか速さが上限を超えたら、超えた分に比例する大きな値（条件を守る組より必ず大きい）
 */
export function tuneCost({ kp, ki, kd, x0, r, v0, w, al, c = 0 }: In): number {
  const d = r - x0,
    band = 0.02 * Math.abs(d);
  let x = x0,
    v = v0,
    a = 0,
    I = 0,
    pe = 0,
    itae = 0,
    ym = 0,
    vm = 0,
    last = -1;
  for (let i = 1; i < N; i++) {
    const e = r - x;
    I += e * DT;
    const u = kp * e + ki * I + (kd * (e - pe)) / DT;
    pe = e;
    a += (u * DT - a) * al;
    v += a - c * v * DT;
    x += (v + w) * DT;
    if (!(Math.abs(x) < DIV && Math.abs(v) < DIV)) return Infinity;
    const ae = Math.abs(r - x);
    itae += i * DT * ae * DT;
    if (d !== 0) ym = Math.max(ym, (x - x0) / d);
    vm = Math.max(vm, Math.abs(v));
    if (ae > band) last = i;
  }
  if (last >= N - 1) return Infinity;
  const os = Math.max(0, (ym - 1) * 100);
  const over = Math.max(0, os - TUNE_OS) + Math.max(0, vm - TUNE_VMAX);
  /* 条件を守る組を必ず先にする。守れる組がなければ、はみ出しの小さい組 */
  return over > 0 ? 1e9 * (1 + over) + itae : itae;
}

/**
 * ゲインの自動調整。並びの 3 つおき（10 進の 1 桁に 4 つ）で全部の組み合わせを試し、
 * 最もよい組から隣の値へ動かして、よくならなくなるまで詰める。整定する組がなければ null。
 * ok は条件（行き過ぎ・速さ）を守れたか。守れる組がなければ、はみ出しの最も小さい組を返す
 */
export function tune(p: In): { kp: number; ki: number; kd: number; ok: boolean } | null {
  const G = GAIN_LIST,
    coarse = G.filter((_, i) => i % 3 === 0),
    cost = (g: number[]) => tuneCost({ ...p, kp: g[0], ki: g[1], kd: g[2] });
  let best: number[] | null = null,
    bj = Infinity;
  for (const kp of coarse)
    if (kp > 0)
      for (const ki of coarse)
        for (const kd of coarse) {
          const j = cost([kp, ki, kd]);
          if (j < bj) {
            bj = j;
            best = [kp, ki, kd];
          }
        }
  if (!best) return null;
  let cur: number[] = best;
  for (let it = 0; it < 200; it++) {
    let moved = false;
    for (let k = 0; k < 3; k++)
      for (const s of [-2, -1, 1, 2]) {
        const i = G.indexOf(cur[k]) + s;
        if (i < 0 || i >= G.length || (k === 0 && G[i] === 0)) continue;
        const g: number[] = [...cur];
        g[k] = G[i];
        const j = cost(g);
        if (j < bj) {
          bj = j;
          cur = g;
          moved = true;
        }
      }
    if (!moved) break;
  }
  return { kp: cur[0], ki: cur[1], kd: cur[2], ok: bj < 1e9 };
}

/** 測り始める出来事: 最初から・目標の変更・押す・PID を入に戻す */
export type EvKind = 'start' | 'target' | 'push' | 'pid';

/** 整定とみなすまで帯の中に留まる時間 [s] */
export const HOLD = 10;
/** 整定の帯の下限 [m]（押したときのように目標が変わらない出来事でも帯を持たせる） */
export const BAND_MIN = 0.5;

export interface Meas {
  kind: EvKind;
  /** 出来事からの時間 [s] */
  dt: number;
  /** 整定の帯の半幅 [m]（変化幅の 2 %、少なくとも BAND_MIN） */
  band: number;
  /** 整定時間（帯に入って HOLD 秒留まったときの、入った時刻）。求まらなければ null */
  ts: number | null;
  /** 立ち上がり時間（10 %→90 %）・オーバーシュート [%]・ピーク時刻。目標が 1 m 以上動いた出来事だけ */
  tr: number | null;
  os: number | null;
  tp: number | null;
  /** 誤差の絶対値の積分 [m·s]・最大速度 [m/s]・今の偏差 [m] */
  iae: number;
  vm: number;
  e: number;
}

/**
 * 出来事からの応答を 1 ステップずつ測る（川の枠の計算結果）。
 * 目標が動いた出来事では、出来事の時の位置から目標への変化を 0→1 として立ち上がりと行き過ぎを測る
 */
export class Meter {
  private kind: EvKind = 'start';
  private t0 = 0;
  private xs = 0;
  private r = 0;
  private step = 0;
  private band = BAND_MIN;
  private inSince: number | null = null;
  private ts: number | null = null;
  private t10: number | null = null;
  private t90: number | null = null;
  private yPrev = 0;
  private tPrev = 0;
  private ym = 0;
  private tm = 0;
  private iae = 0;
  private vm = 0;
  private e = 0;
  private t = 0;

  begin(kind: EvKind, t: number, x: number, r: number): void {
    this.kind = kind;
    this.t0 = this.t = this.tPrev = t;
    this.xs = x;
    this.r = r;
    this.step = r - x;
    this.band = Math.max(0.02 * Math.abs(this.step), BAND_MIN);
    this.inSince = Math.abs(this.step) <= this.band ? t : null;
    this.ts = this.t10 = this.t90 = null;
    this.yPrev = this.ym = 0;
    this.tm = t;
    this.iae = this.vm = 0;
    this.e = this.step;
  }

  /** ステップのあとの時刻・位置・速度 */
  sample(t: number, x: number, v: number): void {
    const e = this.r - x;
    this.t = t;
    this.e = e;
    this.iae += Math.abs(e) * DT;
    this.vm = Math.max(this.vm, Math.abs(v));
    if (Math.abs(e) <= this.band) {
      if (this.inSince === null) this.inSince = t;
      if (this.ts === null && t - this.inSince >= HOLD - 1e-9) this.ts = this.inSince - this.t0;
    } else this.inSince = this.ts = null;
    if (Math.abs(this.step) >= 1) {
      const y = (x - this.xs) / this.step,
        at = (lv: number) => this.tPrev + ((lv - this.yPrev) / (y - this.yPrev)) * (t - this.tPrev) - this.t0;
      if (this.t10 === null && y >= 0.1) this.t10 = at(0.1);
      if (this.t90 === null && y >= 0.9) this.t90 = at(0.9);
      if (y > this.ym) {
        this.ym = y;
        this.tm = t;
      }
      this.yPrev = y;
      this.tPrev = t;
    }
  }

  get(): Meas {
    const stepEv = Math.abs(this.step) >= 1;
    return {
      kind: this.kind,
      dt: this.t - this.t0,
      band: this.band,
      ts: this.ts,
      tr: stepEv && this.t10 !== null && this.t90 !== null ? this.t90 - this.t10 : null,
      os: stepEv ? Math.max(0, (this.ym - 1) * 100) : null,
      tp: stepEv && this.ym > 1 ? this.tm - this.t0 : null,
      iae: this.iae,
      vm: this.vm,
      e: Math.abs(this.e) < 1e-9 ? 0 : this.e,
    };
  }
}

/** 表示窓の縦の div の数 */
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
