/**
 * CT125（JA65）の駆動系の模型。クランク → 遠心クラッチ（シュー 3 個）とワンウェイクラッチ → ドラムと一体の
 * プライマリドライブギア 19T → クラッチアウター 65T → 多板クラッチ → メインシャフト → 常時噛合の 4 段 →
 * カウンターシャフト → スプロケット 14T・38T → 後輪。
 * つなぎ目（2 つのクラッチとワンウェイクラッチ）は、伝えられるトルクの上限つきの拘束として刻みごとに繰り返して解く。
 * シフトドラムの溝はフォーク 2 本（M2・C3）の位置を決め、スライドする歯車のドグが空転する歯車をつかむ
 */

export const RPM = 60 / (2 * Math.PI);
export const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);

export const SPEC = {
  /** アイドリング・燃料を切る回転数 [rpm] */
  idle: 1400,
  limit: 8500,
  /** 1 次減速の歯数と比 */
  zp: [19, 65] as const,
  p: 65 / 19,
  /** 1〜4 速のメインシャフト・カウンターシャフトの歯数（Honda の部品表） */
  pairs: [
    { m: 14, c: 35 },
    { m: 20, c: 31 },
    { m: 20, c: 23 },
    { m: 26, c: 24 },
  ] as const,
  /** スプロケットの歯数と 2 次減速比 */
  zs: [14, 38] as const,
  fin: 38 / 14,
  /** タイヤの動的な半径 [m]・総質量（車体と乗る人と荷物）[kg]・転がり抵抗・空気抵抗 [m²]・空気の密度・重力 */
  r: 0.284,
  M: 195,
  crr: 0.015,
  cda: 0.55,
  rho: 1.2,
  g: 9.81,
  /** 慣性モーメント [kg·m²]: クランク（発電機を含む）・ドラム（クランクの速さで）・メインシャフトの側・後輪 */
  Je: 0.008,
  Jd: 0.0015,
  Jm: 0.004,
  Jw: 0.25,
  /**
   * 遠心クラッチ: 2,000 rpm でシューが触れ始め、伝えられるトルクは回転数の 2 乗の差に比例する（上限つき）。
   * 係数は発進の録音（滑走が 2,750〜2,990 rpm・つながるまで約 2 秒）に合わせた
   */
  cfIn: 2000,
  cfK: 1.24e-6,
  cfMax: 45,
  /** 多板クラッチ（メインシャフトで）とワンウェイクラッチ（クランクで）の上限 [N·m] */
  mpMax: 45,
  owMax: 60,
} as const;

/** 全開のトルク [N·m]（公表の 10.9 N·m/4,750 rpm・6.5 kW/6,250 rpm に合わせた目安） */
const TFULL: readonly (readonly [number, number])[] = [
  [0, 4],
  [1000, 6],
  [2000, 8.6],
  [3000, 9.6],
  [4000, 10.4],
  [4750, 10.9],
  [5500, 10.6],
  [6250, 9.9],
  [7000, 8.8],
  [8000, 7.0],
  [9000, 5],
];
export function tfull(rpm: number): number {
  if (rpm <= 0) return TFULL[0][1];
  for (let i = 1; i < TFULL.length; i++)
    if (rpm <= TFULL[i][0]) {
      const [a, ta] = TFULL[i - 1],
        [b, tb] = TFULL[i];
      return ta + ((tb - ta) * (rpm - a)) / (b - a);
    }
  return TFULL[TFULL.length - 1][1];
}
export const gearRatio = (g: number): number => SPEC.pairs[g - 1].c / SPEC.pairs[g - 1].m;

/**
 * ドラムの溝: 位置 N・1・2・3・4（6 番目は 1 周して N）でのフォークの位置。
 * FM は M2 を動かすフォーク（−1 で M3 側、+1 で M4 側）、FC は C3 を動かすフォーク（−1 で C1 側、+1 で C2 側）
 */
export const FM = [0, 0, 0, -1, 1, 0] as const;
export const FC = [0, -1, 1, 0, 0, 0] as const;
export const POS = ['N', '1', '2', '3', '4', 'N'] as const;
/** 位置 th（0〜5）での溝の横の位置。止まる所の前後は平らで、間をなめらかに移る */
export function groove(tab: readonly number[], th: number): number {
  const k = clamp(Math.floor(th), 0, 4),
    u = th - k,
    s = clamp((u - 0.25) / 0.5, 0, 1),
    e = s * s * (3 - 2 * s);
  return tab[k] + (tab[k + 1] - tab[k]) * e;
}

export interface Angles {
  e: number;
  d: number;
  m: number;
  c: number;
  w: number;
  M3: number;
  M4: number;
  C1: number;
  C2: number;
  /** チェーンの送り [m] */
  ch: number;
}
/** 描くための写し */
export interface Snap {
  t: number;
  rpm: number;
  drpm: number;
  mrpm: number;
  crpm: number;
  wrpm: number;
  v: number;
  thr: number;
  ped: number;
  pedDir: number;
  eng: number;
  th: number;
  base: number;
  blocked: Block;
  fm: number;
  fc: number;
  gear: number;
  Tcf: number;
  Tow: number;
  Tmp: number;
  Te: number;
  ang: Angles;
  /** 場面の何段階目か（場面の記録だけ） */
  stage?: number;
}
/** ペダルの先が止められた理由: 走行中は 4 速と N の間を回らない */
export type Block = '' | 'lock';

export interface Init {
  base?: number;
  v?: number;
  we?: number;
  wd?: number;
  t?: number;
}

export class Model {
  t = 0;
  /** 角速度 [rad/s]: クランク・ドラム・メインシャフト。車速 [m/s] */
  we = SPEC.idle / RPM;
  wd = 0;
  wm = 0;
  v = 0;
  thr = 0;
  /** ブレーキ（重力に対する減速の比） */
  brake = 0;
  /** ドラムの止まる位置（0〜4）・今の角の位置（0〜5）・ペダルの踏み込み（0〜1） */
  base = 0;
  th = 0;
  ped = 0;
  pedDir = 0;
  pedHold = false;
  private committed = false;
  private next = 0;
  blocked: Block = '';
  fm = 0;
  fc = 0;
  gear = 0;
  /** 多板クラッチのつながり（1 で接触、0 で切断） */
  eng = 1;
  Tcf = 0;
  Tow = 0;
  Tmp = 0;
  Te = 0;
  ang: Angles = { e: 0, d: 0, m: 0, c: 0, w: 0, M3: 0, M4: 0, C1: 0, C2: 0, ch: 0 };

  constructor(o: Init = {}) {
    this.reset(o);
  }
  reset(o: Init = {}): void {
    this.t = o.t ?? 0;
    this.we = o.we ?? SPEC.idle / RPM;
    this.wd = o.wd ?? 0;
    this.v = o.v ?? 0;
    this.wm = 0;
    this.thr = 0;
    this.brake = 0;
    this.base = o.base ?? 0;
    this.th = this.base;
    this.ped = 0;
    this.pedDir = 0;
    this.pedHold = false;
    this.committed = false;
    this.blocked = '';
    this.eng = 1;
    this.Tcf = this.Tow = this.Tmp = this.Te = 0;
    this.ang = { e: 0, d: 0, m: 0, c: 0, w: 0, M3: 0, M4: 0, C1: 0, C2: 0, ch: 0 };
    this.fm = groove(FM, this.th);
    this.fc = groove(FC, this.th);
    this.gear = this.selGear();
    if (this.gear > 0) this.wm = (this.v / SPEC.r) * SPEC.fin * gearRatio(this.gear);
  }
  get rpm(): number {
    return this.we * RPM;
  }
  /** チェンジペダルを踏む（dir = 1 でシフトアップ、−1 でシフトダウン）。離すまで踏み続ける */
  press(dir: 1 | -1): void {
    if (this.ped > 0.02 && this.pedDir !== dir) return;
    this.pedDir = dir;
    this.pedHold = true;
  }
  release(): void {
    this.pedHold = false;
  }
  selGear(): number {
    return this.fc < -0.6 ? 1 : this.fc > 0.6 ? 2 : this.fm < -0.6 ? 3 : this.fm > 0.6 ? 4 : 0;
  }
  /** 4 速と N の間はロータリーで、停車中だけどちら向きにも回れる。走行中はドラムロックプレートが止める */
  private canGo(dir: number): Block {
    if (dir < 0 && this.base === 0 && this.v > 0.3) return 'lock';
    if (dir > 0 && this.base === 4 && this.v > 0.3) return 'lock';
    return '';
  }
  /**
   * ペダル: 踏み始めの遊び（0.08〜0.32）で多板クラッチを切り、その先（0.35〜0.95）でドラムを 1 か所回す。
   * 離すと戻り、ドラムはストッパーで止まったまま
   */
  private pedalStep(dt: number): void {
    const T = 0.12;
    this.ped = this.pedHold ? Math.min(1, this.ped + dt / T) : Math.max(0, this.ped - dt / T);
    this.eng = 1 - clamp((this.ped - 0.08) / 0.24, 0, 1);
    if (this.pedDir === 0) {
      this.th = this.base;
      return;
    }
    const u = clamp((this.ped - 0.35) / 0.6, 0, 1);
    if (!this.committed) {
      this.blocked = this.canGo(this.pedDir);
      if (this.blocked) this.th = this.base + this.pedDir * Math.min(u, 0.06);
      else {
        this.th = this.base + this.pedDir * u;
        if (u >= 1 || (!this.pedHold && u > 0.5)) {
          this.committed = true;
          this.next = this.base + this.pedDir;
        }
      }
    }
    if (this.committed) this.th = this.next;
    if (this.ped <= 0 && !this.pedHold) {
      if (this.committed) this.base = (this.next + 5) % 5;
      this.th = this.base;
      this.committed = false;
      this.pedDir = 0;
      this.blocked = '';
    }
  }
  step(dt: number): void {
    const S = SPEC;
    this.pedalStep(dt);
    const thM = this.th < 0 ? this.th + 5 : this.th;
    this.fm = groove(FM, thM);
    this.fc = groove(FC, thM);
    const g = this.selGear();
    if (g !== this.gear) {
      this.gear = g;
      /* ドグが入った瞬間: 多板クラッチは切れていて、メインシャフトの側は軽いので後輪の速さにそろう */
      if (g > 0) this.wm = (this.v / S.r) * S.fin * gearRatio(g);
    }
    const rpm = this.rpm;
    const idleThr = clamp(0.05 + (S.idle - rpm) * 0.0002, 0, 0.3);
    const thrE = rpm > S.limit ? 0 : Math.max(this.thr, idleThr);
    this.Te = (1 - (1 - thrE) ** 2.2) * tfull(rpm) - (0.5 + (0.18 * Math.max(rpm, 0)) / 1000);
    if (this.we < 30 && this.Te < 0) this.Te = 0;
    const moving = this.v > 0.01;
    const res =
      (moving ? S.M * S.g * S.crr : 0) +
      0.5 * S.rho * S.cda * this.v * this.v +
      (moving ? this.brake * 0.7 * S.M * S.g : 0);
    const inG = this.gear > 0,
      R = inG ? S.fin * gearRatio(this.gear) : 0;
    const Jmain = S.Jm + (inG ? (S.M * S.r * S.r + S.Jw) / (R * R) : 0);
    this.we += (this.Te / S.Je) * dt;
    this.wd += ((-0.03 * Math.tanh(this.wd / 2)) / S.Jd) * dt;
    if (inG) this.wm += (-(res * S.r) / R / Jmain) * dt;
    else {
      this.wm += ((-0.08 * Math.tanh(this.wm / 5)) / Jmain) * dt;
      this.v = Math.max(0, this.v - (res / S.M) * dt);
    }
    /* つなぎ目: 遠心クラッチ（クランク↔ドラム）・ワンウェイ（ドラムがクランクを回す向きだけ）・多板（ドラム↔メインシャフト） */
    const ccf = rpm > S.cfIn ? Math.min(S.cfMax, S.cfK * (rpm * rpm - S.cfIn * S.cfIn)) : 0;
    const cmp = S.mpMax * this.eng,
      iA = 1 / S.Je,
      iD = 1 / S.Jd,
      iM = 1 / Jmain,
      p = S.p;
    let Lcf = 0,
      Low = 0,
      Lmp = 0;
    for (let it = 0; it < 10; it++) {
      let lam = (this.we - this.wd) / (dt * (iA + iD)),
        nl = clamp(Lcf + lam, -ccf, ccf),
        d = nl - Lcf;
      Lcf = nl;
      this.we -= d * dt * iA;
      this.wd += d * dt * iD;
      lam = (this.we - this.wd) / (dt * (iA + iD));
      nl = clamp(Low + lam, -S.owMax, 0);
      d = nl - Low;
      Low = nl;
      this.we -= d * dt * iA;
      this.wd += d * dt * iD;
      lam = (this.wd / p - this.wm) / (dt * (iD / (p * p) + iM));
      nl = clamp(Lmp + lam, -cmp, cmp);
      d = nl - Lmp;
      Lmp = nl;
      this.wm += d * dt * iM;
      this.wd -= (d / p) * dt * iD;
    }
    this.Tcf = Lcf;
    this.Tow = Low;
    this.Tmp = Lmp;
    if (inG) {
      this.v = (this.wm * S.r) / R;
      if (this.v < 0) {
        this.v = 0;
        this.wm = 0;
      }
    }
    if (this.we < 0) this.we = 0;
    this.t += dt;
    const wc = (this.v / S.r) * S.fin,
      a = this.ang;
    a.e += this.we * dt;
    a.d += this.wd * dt;
    a.m += this.wm * dt;
    a.c += wc * dt;
    a.w += (this.v / S.r) * dt;
    a.ch += this.v * dt;
    a.M3 += ((wc * 23) / 20) * dt;
    a.M4 += ((wc * 24) / 26) * dt;
    a.C1 += ((this.wm * 14) / 35) * dt;
    a.C2 += ((this.wm * 20) / 31) * dt;
  }
  run(sec: number): void {
    const dt = DT;
    for (let n = Math.round(sec / dt); n > 0; n--) this.step(dt);
  }
  snap(): Snap {
    const S = SPEC,
      wc = (this.v / S.r) * S.fin;
    return {
      t: this.t,
      rpm: this.rpm,
      drpm: this.wd * RPM,
      mrpm: this.wm * RPM,
      crpm: wc * RPM,
      wrpm: (this.v / S.r) * RPM,
      v: this.v,
      thr: this.thr,
      ped: this.ped,
      pedDir: this.pedDir,
      eng: this.eng,
      th: this.th,
      base: this.base,
      blocked: this.blocked,
      fm: this.fm,
      fc: this.fc,
      gear: this.gear,
      Tcf: this.Tcf,
      Tow: this.Tow,
      Tmp: this.Tmp,
      Te: this.Te,
      ang: { ...this.ang },
    };
  }
}
/** 計算の刻み [s] */
export const DT = 0.0005;

/**
 * 自動運転: N → 1 速 → ゆっくり加速しながら 4 速まで → 約 60 km/h を保つ → ゆっくり減速しながらシフトダウン →
 * 止まって N → くり返し。スロットルとブレーキは急に動かさず、1 秒あたり決まった量だけ近づける
 */
/** 自動運転でシフトアップする速さ [km/h]（添字が今のギア） */
const UP_KMH = [0, 21, 39, 50];
export class Driver {
  private ph = 'wait';
  private t = 0;
  /** スロットルとブレーキの目標 */
  private thrT = 0;
  private brkT = 0;
  constructor(private readonly m: Model) {}
  reset(): void {
    this.ph = 'wait';
    this.t = 0;
    this.thrT = 0;
    this.brkT = 0;
  }
  /** 目標へ近づける（スロットルは 1 秒に 0.4、閉じるときは 1.5、ブレーキは 1 秒に 0.3） */
  private ease(dt: number): void {
    const m = this.m,
      dThr = this.thrT - m.thr;
    m.thr += clamp(dThr, -1.5 * dt, 0.4 * dt);
    m.brake += clamp(this.brkT - m.brake, -0.3 * dt, 0.3 * dt);
  }
  step(dt: number): void {
    const m = this.m,
      kmh = m.v * 3.6;
    this.t += dt;
    const go = (ph: string) => {
      this.ph = ph;
      this.t = 0;
    };
    switch (this.ph) {
      case 'wait':
        this.thrT = 0;
        this.brkT = 0;
        if (this.t > 1.5) {
          m.press(1);
          go('n1');
        }
        break;
      case 'n1':
        if (this.t > 0.25) m.release();
        if (m.ped === 0 && this.t > 0.6) go('pull');
        break;
      case 'pull':
        this.thrT = m.gear < 4 ? 0.3 : 0.5;
        /* シフトアップの速さ [km/h]: 1→2 は 21、2→3 は 39、3→4 は 50（実車の乗り方に合わせた） */
        if (m.gear > 0 && m.gear < 4 && kmh >= UP_KMH[m.gear]) {
          this.thrT = 0;
          go('lift');
        }
        if (m.gear === 4 && kmh > 57) go('cruise');
        break;
      case 'lift':
        if (m.thr < 0.02 && this.t > 0.15) {
          m.press(1);
          go('up');
        }
        break;
      case 'up':
        if (this.t > 0.25) m.release();
        if (m.ped === 0 && this.t > 0.4) go('pull');
        break;
      case 'cruise':
        /* 約 60 km/h を保つ（速度の差に比例して開く） */
        this.thrT = clamp(0.2 + (60 - kmh) * 0.05, 0.05, 0.45);
        if (this.t > 8) {
          this.thrT = 0;
          go('coast');
        }
        break;
      case 'coast':
        this.thrT = 0;
        this.brkT = kmh > 25 ? 0.06 : 0.1;
        if (m.gear > 1 && m.rpm < 2300) {
          this.brkT = 0;
          this.thrT = 0.15;
          m.press(-1);
          go('down');
        }
        if (m.gear === 1 && kmh < 0.5) go('stop');
        break;
      case 'down':
        if (this.t > 0.25) {
          m.release();
          this.thrT = 0;
        }
        if (m.ped === 0 && this.t > 0.6) go('coast');
        break;
      case 'stop':
        this.brkT = 0.2;
        this.thrT = 0;
        if (this.t > 1) {
          m.press(-1);
          go('n0');
        }
        break;
      case 'n0':
        if (this.t > 0.25) m.release();
        if (m.ped === 0 && this.t > 1.5) {
          this.brkT = 0;
          go('wait');
        }
        break;
    }
    this.ease(dt);
  }
}

/* ---------- 場面: 入力の台本を模型で走らせ、2 ms ごとの写しを残す ---------- */
type Stage = readonly [name: string, desc: string, until: (f: Snap) => boolean];
interface Scene {
  name: string;
  dur: number;
  init: Init;
  /** 始める前に走らせる時間 [s]（時刻は 0 に戻す） */
  pre?: number;
  script(m: Model, t: number): void;
  stages: readonly Stage[];
}
const slip = (f: Snap) => Math.abs(f.drpm / SPEC.p - f.mrpm) > 15;
export const SCENES = {
  start: {
    name: '発進',
    dur: 4.2,
    init: { base: 1 },
    pre: 0.5,
    script(m, t) {
      m.thr = t > 0.5 ? 0.4 : 0;
    },
    stages: [
      ['アイドリング', 'シューは閉じたまま', (f) => f.thr === 0],
      ['スロットルを開けた直後', '遠心力で開くシュー', (f) => f.Tcf < 0.3],
      ['シューとドラムの接触', '滑走しながらの発進', (f) => f.rpm - f.drpm > 40],
      ['滑走の終わり', 'クランクとドラムが同じ回転数', () => true],
    ],
  },
  up: {
    name: 'シフトアップ',
    dur: 1.5,
    init: { base: 1, v: 18 / 3.6, we: 4300 / RPM, wd: 4300 / RPM },
    script(m, t) {
      m.thr = t < 0.1 ? 0.62 : t < 0.42 ? 0 : 0.62;
      if (t >= 0.15 && t < 0.37) m.press(1);
      else m.release();
    },
    stages: [
      ['1 速での加速', '1 速の歯車で伝達', (f) => f.thr > 0 && f.ped === 0 && f.t < 0.12],
      ['スロットルの戻し', 'ドグの力を抜く操作', (f) => f.ped < 0.1],
      ['多板クラッチの切断', 'ペダルの遊びの範囲', (f) => f.ped < 0.35 && f.pedDir !== 0 && f.th < 1.05],
      ['ドラムの回転', '動力のない一瞬', (f) => f.gear !== 2],
      ['2 速のドグの噛み合い', 'C3 のドグと C2 の穴', (f) => f.eng < 0.99],
      ['多板クラッチの接触', '回転数が 2 速の速さに一致', (f) => f.ped > 0 || slip(f)],
      ['2 速での加速', '2 速の歯車で伝達', () => true],
    ],
  },
  down: {
    name: 'シフトダウン',
    dur: 1.6,
    init: { base: 3, v: 30 / 3.6, we: 2500 / RPM, wd: 2500 / RPM },
    script(m, t) {
      m.thr = t > 0.2 && t < 0.5 ? 0.25 : 0;
      if (t >= 0.2 && t < 0.42) m.press(-1);
      else m.release();
    },
    stages: [
      ['3 速での減速', 'スロットルは全閉', (f) => f.pedDir === 0 && f.t < 0.3],
      ['多板クラッチの切断', '回転を合わせる空ぶかし', (f) => f.th > 2.95 && f.pedDir !== 0],
      ['ドラムの逆回転', 'M2 は中立・C3 は C2 側', (f) => f.gear !== 2],
      ['2 速のドグの噛み合い', 'クラッチは切断のまま', (f) => f.ped > 0.5],
      ['多板クラッチの接触', '後輪からエンジンへの力', (f) => f.ped > 0 || slip(f)],
      ['2 速でのエンジンブレーキ', '遠心クラッチも逆向きに伝達', () => true],
    ],
  },
  brake: {
    name: 'エンジンブレーキ',
    dur: 3.2,
    init: { base: 1, v: 14 / 3.6, we: 3000 / RPM, wd: 3000 / RPM },
    script(m) {
      m.thr = 0;
      m.brake = 0.12;
    },
    stages: [
      ['シューも接触（伝達）', '2,000 rpm 以上', (f) => f.rpm > 2150],
      ['ワンウェイクラッチだけ伝達', 'ドラムがクランクを回す', (f) => f.drpm > f.rpm - 20],
      ['切断', 'ドラムがクランクより低回転', () => true],
    ],
  },
  rotary: {
    name: '停車中の 4→N',
    dur: 2.6,
    init: { base: 4, v: 0 },
    script(m, t) {
      m.thr = 0;
      m.brake = 0;
      if (t < 1.3) {
        if (t >= 0.2 && t < 0.45) m.press(1);
        else m.release();
        return;
      }
      if (t < 1.32) {
        m.reset({ base: 4, v: 20 / 3.6, we: 1700 / RPM, wd: 1700 / RPM, t: m.t });
        return;
      }
      if (t >= 1.5 && t < 1.8) m.press(1);
      else m.release();
    },
    stages: [
      ['停車中の 4 速', 'カウンターシャフトは停止', (f) => f.t < 0.2],
      ['シフトアップ', 'ロックプレートは外れたまま', (f) => f.gear === 4],
      ['N への復帰', 'ロータリー式で 1 周', (f) => f.t < 1.3],
      ['走行中の 4 速', 'カウンターシャフトが回転', (f) => f.t < 1.5],
      ['シフトアップ', 'ロックプレートでドラムが停止', () => true],
    ],
  },
} satisfies Record<string, Scene>;
export type SceneId = keyof typeof SCENES;

export interface Rec {
  name: string;
  frames: Snap[];
  stages: { n: string; d: string }[];
  /** 各段階の始まりの時刻（現れない段階は null） */
  bounds: (number | null)[];
  dur: number;
}
/** 場面を走らせて記録する */
export function record(key: SceneId): Rec {
  const sc: Scene = SCENES[key],
    m = new Model(sc.init);
  if (sc.pre) {
    m.run(sc.pre);
    m.t = 0;
  }
  const frames: Snap[] = [];
  for (let n = 0; n <= Math.round(sc.dur / DT); n++) {
    sc.script(m, m.t);
    if (n % 4 === 0) frames.push(m.snap());
    m.step(DT);
  }
  /* 段階: 条件が成り立つ最初の段階。前へは戻らない */
  let cur = 0;
  for (const f of frames) {
    while (cur < sc.stages.length - 1 && !sc.stages[cur][2](f)) cur++;
    f.stage = cur;
  }
  const bounds = sc.stages.map((_, i) => frames.find((f) => f.stage === i)?.t ?? null);
  return {
    name: sc.name,
    frames,
    stages: sc.stages.map(([n, d]) => ({ n, d })),
    bounds,
    dur: frames[frames.length - 1].t,
  };
}
/** 記録の写しの間隔 [s] */
export const REC_DT = DT * 4;
