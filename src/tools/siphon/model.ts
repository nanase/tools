/**
 * サイフォンの模型。長さは m、時間は s、流量は m³/s、圧力は Pa。
 * 容器は断面の多角形（x 右、z 上）と奥行き D で表し、水位 z での水平の幅 × D を水面の面積とする。
 * 管は中心線の折れ線で、入口・頂上（最も高い点）・出口を持つ。
 *
 * 管の満ち具合 φ（0 は空気、1 は水で満ちた状態）を持ち、有効な落差は
 *   H = (h₁ − z頂上) + φ (z頂上 − z出口')
 * とする（z出口' は出口が水に沈んでいれば受け側の水位）。流れが空気を運び出すと φ が増え、
 * 流れが管の壁を伝う膜ほどの量（qfilm）なら増えない。入口が水面から出ると空気が入り、
 * 下りの管の水が抜けきるまで流れない。流速は慣性と損失の式で進める。
 * 頂上の圧力が蒸気圧に届くと流速は頭打ちになり、静水でも届かない高さなら水柱が分断する。
 */
export const G = 9.80665;
/** 標準大気の気圧 [Pa]（標高 m） */
export const pAtm = (alt: number): number => 101325 * (1 - 2.25577e-5 * alt) ** 5.25588;
/** 水の蒸気圧 [Pa]（Tetens の式、温度 ℃） */
export const pVap = (T: number): number => 610.78 * Math.exp((17.27 * T) / (T + 237.3));
/** 水の密度 [kg/m³]（温度 ℃、0〜100 ℃ の近似） */
export const rhoWater = (T: number): number =>
  1000 * (1 - ((T + 288.9414) / (508929.2 * (T + 68.12963))) * (T - 3.9863) ** 2);
/** 管の摩擦係数（滑らかな管、乱流の Blasius 式。層流では 64/Re） */
export function friction(v: number, d: number, nu: number): number {
  const Re = Math.max(1, (Math.abs(v) * d) / nu);
  return Re < 2300 ? 64 / Re : 0.3164 / Re ** 0.25;
}

export type Pt = readonly [number, number];
export interface VesselDef {
  poly: readonly Pt[];
  /** 奥行き [m] */
  D: number;
  /** あふれる高さ（省略時は多角形の最も高い点） */
  top?: number;
  /** 中にある物（教訓茶碗の柱など）。面積から引く */
  holes?: readonly (readonly Pt[])[];
}
export interface Vessel extends VesselDef {
  z0: number;
  z1: number;
  tz: number[];
  tv: number[];
  cap: number;
}

/** 多角形の高さ z での水平の切り口の幅の合計 */
export function chord(poly: readonly Pt[], z: number): number {
  const xs: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i],
      [x2, z2] = poly[(i + 1) % poly.length];
    if ((z1 <= z && z < z2) || (z2 <= z && z < z1)) xs.push(x1 + ((z - z1) * (x2 - x1)) / (z2 - z1));
  }
  xs.sort((a, b) => a - b);
  let w = 0;
  for (let i = 0; i + 1 < xs.length; i += 2) w += xs[i + 1] - xs[i];
  return w;
}

/** 容器の水位と体積の表を作る */
export function makeVessel(v: VesselDef): Vessel {
  const zs = v.poly.map((p) => p[1]),
    z0 = Math.min(...zs),
    z1 = v.top ?? Math.max(...zs),
    N = 400,
    tz: number[] = [],
    tv: number[] = [];
  let vol = 0;
  for (let i = 0; i <= N; i++) {
    const z = z0 + ((z1 - z0) * i) / N;
    if (i > 0) {
      const zm = z - (z1 - z0) / N / 2;
      let w = chord(v.poly, zm);
      for (const h of v.holes ?? []) w -= chord(h, zm);
      vol += Math.max(0, w) * v.D * ((z1 - z0) / N);
    }
    tz.push(z);
    tv.push(vol);
  }
  return { ...v, z0, z1, tz, tv, cap: vol };
}
export function volAt(V: Vessel, z: number): number {
  if (z <= V.z0) return 0;
  if (z >= V.z1) return V.cap;
  const f = ((z - V.z0) / (V.z1 - V.z0)) * (V.tz.length - 1),
    i = Math.floor(f);
  return V.tv[i] + (V.tv[i + 1] - V.tv[i]) * (f - i);
}
export function levelAt(V: Vessel, vol: number): number {
  if (vol <= 0) return V.z0;
  if (vol >= V.cap) return V.z1;
  let lo = 0,
    hi = V.tv.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (V.tv[m] < vol) lo = m;
    else hi = m;
  }
  const f = (vol - V.tv[lo]) / (V.tv[hi] - V.tv[lo] || 1);
  return V.tz[lo] + (V.tz[hi] - V.tz[lo]) * f;
}

/** 模型に渡す条件 */
export interface Cond {
  /** 管の内径 [m] */
  d: number;
  /** 流入 [m³/s] */
  qin: number;
  /** 標高 [m]・水温 [℃] */
  alt: number;
  T: number;
  /** 液体の密度 [kg/m³]（省略時は水） */
  rho?: number;
  /** 動粘度 [m²/s]（省略時は水） */
  nu?: number;
  /** 空気を運び出す効率（大きいほど早く満ちる） */
  ent: number;
  /** 管を満たせない細い流れ [m³/s] */
  qfilm: number;
  /** 流れが止まってから下りの管の水が抜ける時間 [s] */
  drain: number;
  /** 曲がりなどの損失係数の和 */
  kb: number;
  /** 摩擦係数を固定する（岩の水路のように粗い管）。省略時は滑らかな管 */
  fix?: number;
  /** 水洗: 流す量 [m³/s]・時間 [s]、その後に便器へ補う量 [m³/s]・時間 [s] */
  flushQ?: number;
  flushDur?: number;
  refillQ?: number;
  refillDur?: number;
}

export interface Burst {
  t0: number;
  t1: number;
  tp: number;
  peak: number;
  vol: number;
}
export interface Sample {
  t: number;
  h1: number;
  q: number;
  qin: number;
}
export type EvKind = 'prime' | 'air' | 'vap' | 'over' | 'stop';

/** 流れを計算する本体 */
export class Siphon {
  readonly src: Vessel;
  readonly dst: Vessel | null;
  readonly pts: readonly Pt[];
  /** 管に沿った長さ */
  readonly s: number[];
  readonly L: number;
  /** 頂上の点の番号 */
  readonly ic: number;
  readonly zIn: number;
  readonly zOut: number;
  readonly zC: number;
  readonly a: number;
  readonly Vt: number;
  c: Cond;
  t = 0;
  v1: number;
  v2: number;
  h1: number;
  h2: number;
  phi: number;
  /** 管の中の流速 [m/s] */
  v = 0;
  q = 0;
  qin = 0;
  /** あふれている量 [m³/s] */
  spill1 = 0;
  spill2 = 0;
  /** 入口から空気が入り、下りの管の水が抜けるのを待っている */
  broken = false;
  /** 頂上で水柱が分断している */
  vapor = false;
  /** 頂上で沸騰が始まり流速が頭打ち */
  choke = false;
  over = false;
  /** 出た水の合計 [m³] */
  out = 0;
  /** 見た中で最大の流量 */
  qmax = 0;
  flushT = -1;
  readonly ev: { t: number; k: EvKind }[] = [];
  readonly bursts: Burst[] = [];
  burst: Burst | null = null;
  readonly hist: Sample[] = [];

  constructor(
    src: VesselDef,
    dst: VesselDef | null,
    pts: readonly Pt[],
    c: Cond,
    init: { h1: number; h2?: number; phi?: number },
    /** 湧き出しと数える流量の下限 [m³/s] */
    readonly burstQ = 0,
  ) {
    this.src = makeVessel(src);
    this.dst = dst ? makeVessel(dst) : null;
    this.pts = pts;
    this.s = [0];
    for (let i = 1; i < pts.length; i++)
      this.s.push(this.s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    this.L = this.s[this.s.length - 1];
    let ic = 0;
    for (let i = 1; i < pts.length; i++) if (pts[i][1] > pts[ic][1]) ic = i;
    this.ic = ic;
    this.zIn = pts[0][1];
    this.zOut = pts[pts.length - 1][1];
    this.zC = pts[ic][1];
    this.c = c;
    this.a = (Math.PI * c.d * c.d) / 4;
    this.Vt = this.a * this.L;
    this.v1 = volAt(this.src, init.h1);
    this.h1 = levelAt(this.src, this.v1);
    this.v2 = this.dst ? volAt(this.dst, init.h2 ?? this.dst.z0) : 0;
    this.h2 = this.dst ? levelAt(this.dst, this.v2) : Number.NEGATIVE_INFINITY;
    this.phi = init.phi ?? 0;
  }

  get rho(): number {
    return this.c.rho ?? rhoWater(this.c.T);
  }
  get nu(): number {
    return this.c.nu ?? 1.0e-6;
  }
  get patm(): number {
    return pAtm(this.c.alt);
  }
  get pv(): number {
    return pVap(this.c.T);
  }
  /** 静水で水を持ち上げられる高さ（大気圧と蒸気圧の差） */
  get lift(): number {
    return (this.patm - this.pv) / (this.rho * G);
  }
  /** 管が水で満ちて流れられる状態 */
  get full(): boolean {
    return this.phi > 0.98 && !this.vapor && !this.broken;
  }
  /** 出口側の基準の高さ（沈んでいれば受け側の水位） */
  get outRef(): number {
    return this.dst && this.h2 > this.zOut ? this.h2 : this.zOut;
  }
  /** 摩擦係数 */
  get f(): number {
    return this.c.fix ?? friction(this.v, this.c.d, this.nu);
  }
  /** 管全体の損失係数（入口 0.5・摩擦・曲がり・出口 1） */
  get K(): number {
    return 0.5 + (this.f * this.L) / this.c.d + this.c.kb + 1;
  }
  /** 頂上までの損失係数（入口・摩擦・曲がりの半分） */
  get Kup(): number {
    return 0.5 + (this.f * this.s[this.ic]) / this.c.d + this.c.kb / 2;
  }
  /** 頂上の圧力 [Pa]（満ちて流れているとき） */
  crestP(): number {
    return this.patm - this.rho * G * (this.zC - this.h1) - (this.rho * this.v * Math.abs(this.v) * (1 + this.Kup)) / 2;
  }
  /** 管に沿った圧力（満ちているとき） */
  profile(): { s: number; z: number; p: number }[] {
    const dyn = (this.rho * this.v * Math.abs(this.v)) / 2,
      sc = this.s[this.ic] || 1,
      fr = (this.f * dyn) / this.c.d;
    return this.pts.map((p, i) => {
      const si = this.s[i],
        bend = (this.c.kb / 2) * dyn * (si <= sc ? si / sc : 1 + (si - sc) / (this.L - sc || 1));
      const loss = i === 0 ? 0 : 0.5 * dyn + fr * si + bend;
      return { s: si, z: p[1], p: this.patm - this.rho * G * (p[1] - this.h1) - dyn - loss };
    });
  }

  private inflow(): number {
    const c = this.c;
    let q = c.qin;
    if (this.flushT >= 0) {
      const u = this.t - this.flushT;
      if (u < (c.flushDur ?? 0)) q += c.flushQ ?? 0;
      else if (u < (c.flushDur ?? 0) + (c.refillDur ?? 0)) q += c.refillQ ?? 0;
      else this.flushT = -1;
    }
    return q;
  }

  step(dt: number): void {
    const c = this.c;
    this.qin = this.inflow();
    const zo = this.outRef;
    let H = this.h1 - this.zC + this.phi * (this.zC - zo);
    const inletDry = this.h1 < this.zIn + 0.002 * Math.min(1, this.c.d / 0.01);
    if (inletDry && this.phi > 0.05 && !this.broken) {
      this.broken = true;
      this.ev.push({ t: this.t, k: 'air' });
    }
    if (this.broken) {
      H = this.h1 - this.zC;
      this.phi = Math.max(0, this.phi - dt / c.drain);
      if (this.phi <= 0) this.broken = false;
    }
    if (inletDry) H = Math.min(H, 0);
    /* 頂上の圧力と蒸気圧 */
    const spare = this.lift - (this.zC - this.h1);
    if (this.phi > 0.5 && spare < 0 && !this.vapor && !this.broken) {
      this.vapor = true;
      this.ev.push({ t: this.t, k: 'vap' });
    }
    if (this.vapor) {
      H = 0;
      this.v = 0;
      this.phi = Math.max(0, this.phi - dt / 2);
      if (spare > 0.05 && this.phi <= 0) this.vapor = false;
    }
    /* 流速（慣性と損失） */
    if (H > 0 && !this.vapor) {
      const Lm = Math.max(0.05, this.phi * this.L + 0.05);
      this.v = (this.v + (G * H * dt) / Lm) / (1 + (this.K * Math.abs(this.v) * dt) / (2 * Lm));
    } else this.v = Math.max(0, this.v - G * dt * 4);
    const vmax = spare > 0 ? Math.sqrt((2 * G * spare) / (1 + this.Kup)) : 0;
    this.choke = this.phi > 0.9 && !this.vapor && this.v > vmax;
    if (this.choke) this.v = vmax;
    let q = this.v * this.a;
    q = Math.min(q, this.v1 / dt + this.qin);
    /* 管の満ち具合 */
    if (!this.broken) {
      if (H > 0) this.phi = Math.min(1, this.phi + (c.ent * Math.max(0, q - c.qfilm) * dt) / this.Vt);
      else if (this.h1 < this.zC) this.phi = Math.max(0, this.phi - dt / c.drain);
    }
    /* 水の出入り */
    this.v1 += (this.qin - q) * dt;
    this.spill1 = 0;
    if (this.v1 > this.src.cap) {
      this.spill1 = (this.v1 - this.src.cap) / dt;
      this.v1 = this.src.cap;
    }
    this.v1 = Math.max(0, this.v1);
    if (this.dst) {
      this.v2 += q * dt;
      this.spill2 = 0;
      if (this.v2 > this.dst.cap) {
        if (!this.over) this.ev.push({ t: this.t, k: 'over' });
        this.over = true;
        this.spill2 = (this.v2 - this.dst.cap) / dt;
        this.v2 = this.dst.cap;
      }
      this.h2 = levelAt(this.dst, this.v2);
    }
    this.h1 = levelAt(this.src, this.v1);
    this.out += q * dt;
    this.q = q;
    if (q > this.qmax) this.qmax = q;
    this.track(q, dt);
    this.t += dt;
  }

  /** 湧き出しの区切り: 流量が下限（と流入の 1.5 倍）を超えた所から、その半分を下回るまで */
  private track(q: number, dt: number): void {
    const thr = Math.max(this.burstQ, this.qin * 1.5 + 1e-7),
      on = this.burst ? q > thr * 0.5 : q > thr;
    if (on && !this.burst) this.burst = { t0: this.t, t1: this.t, tp: this.t, peak: q, vol: 0 };
    const b = this.burst;
    if (!b) return;
    b.vol += q * dt;
    if (q > b.peak) {
      b.peak = q;
      b.tp = this.t;
    }
    if (!on) {
      b.t1 = this.t;
      if (b.vol > 0.05 * Math.max(0, ...this.bursts.map((x) => x.vol))) this.bursts.push(b);
      if (this.bursts.length > 12) this.bursts.shift();
      this.burst = null;
    }
  }

  /** T 秒進める。h は刻みの上限、every は記録の間隔、keep は記録を残す長さ */
  advance(T: number, h: number, every: number, keep: number): void {
    const n = Math.min(200000, Math.max(1, Math.ceil(T / h)));
    for (let i = 0; i < n; i++) {
      this.step(T / n);
      const last = this.hist[this.hist.length - 1];
      if (!last || this.t - last.t >= every) {
        this.hist.push({ t: this.t, h1: this.h1, q: this.q, qin: this.qin });
        while (this.hist.length && this.t - this.hist[0].t > keep) this.hist.shift();
      }
    }
  }

  /** 呼び水（管を水で満たす） */
  prime(): void {
    if (this.h1 <= this.zIn) return;
    this.phi = 1;
    this.broken = false;
    this.vapor = false;
    this.ev.push({ t: this.t, k: 'prime' });
  }
  /** 管に空気を入れて止める */
  breakAir(): void {
    if (this.phi <= 0) return;
    this.broken = true;
    this.v = 0;
    this.ev.push({ t: this.t, k: 'stop' });
  }
  flush(): void {
    if (this.flushT < 0) this.flushT = this.t;
  }
  /** 最後の 2 回の湧き出しの始まりの間隔 */
  period(): number | null {
    const b = this.bursts;
    return b.length >= 2 ? b[b.length - 1].t0 - b[b.length - 2].t0 : null;
  }
}
