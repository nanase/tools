/**
 * 管路（排気管・マフラー・吸気管）のデジタル導波管（DOM に依存しない）。断面積と温度が一定の区間を直列につなぎ、
 * 区間の境目では質量流量が続き、圧力は境目の損失の分だけ下がる（散乱の接合）。境目の損失は、直列の線形の抵抗
 * （触媒・パンチングの穴）と、断面が急に変わるところの流れの損失（急拡大は Borda–Carnot の
 * Δp = ½ρu₁²(1 − A₁/A₂)²、急縮小は縮流の Δp ≈ ½ρu₂²·0.5(1 − A₂/A₁)、どちらも細いほうの流速 u で書く）。
 * 流れの損失は排気の平均の流れと脈動の両方にかかり、マフラーの低い共鳴を抑える（線形の音響だけでは損失がなく、
 * 全開の脈動が膨らみすぎる）。
 * 左端は呼び出し側が境界（弁・スロットル）を解いて出ていく波を渡す。右端は同じく呼び出し側が解くか、
 * 大気へ開いた端（無フランジの円管の放射）にする。
 * 進む波は区間ごとの遅延線（端数の遅延は線形補間）で運び、壁の粘性・熱の損失（と吸音材）を 1 次の低域通過で入れる
 */
import { gammaOf, P_ATM, R_GAS, T_ATM } from './gas';

/** 区間の形 */
export interface SegSpec {
  /** 長さ [m] と内径 [m] */
  len: number;
  d: number;
  /** 温度の割合: 区間の温度 = 外気温 + heat ×（排気の温度 − 外気温）。吸気は 0 */
  heat: number;
  /** 吸音材などの損失の上乗せ（1 kHz での減衰 [dB/m]）。なしは 0 */
  absorb?: number;
  /** 右の境目に入れる直列の抵抗 [Pa/(kg/s)]（触媒・穴の流れの抵抗を線形で表す）。なしは 0 */
  resist?: number;
}

/**
 * 無フランジの円管の開口端の反射係数の大きさ |R|（ka の関数）。Levine・Schwinger (1948) の厳密解に
 * 合う Silva ら (2009) の有理式の近似（オルガンの pipes.ts と同じ式）。この式は因果的でないので、大きさを 1 次の
 * 低域通過に合わせるのにだけ使う
 */
function radMag(ka: number): number {
  const x2 = ka * ka;
  return (1 + 0.8 * x2) / (1 + x2 * (1.3 + x2 * (0.266 + 0.0263 * x2)));
}
/** 開口端の端補正 ÷ 半径（Levine・Schwinger 1948） */
const END_CORR = 0.6133;
/** 壁の損失の減衰定数 α = WALL √f / a [Np/m]（20 ℃の空気。温度 T では動粘度に合わせて (T/293)^0.85 倍） */
const WALL = 2.95e-5;

/** 1 kHz で大きさ m になる、直流の利得 1 の 1 次の低域通過の極 */
function lpPole(m: number, fs: number): number {
  if (m >= 0.99999) return 0;
  const w = (2 * Math.PI * 1000) / fs,
    m2 = m * m,
    B = (1 - m2 * Math.cos(w)) / (1 - m2);
  return B - Math.sqrt(B * B - 1);
}

export class Duct {
  readonly n: number;
  private readonly segs: readonly SegSpec[];
  private readonly fs: number;
  /** 区間ごとの遅延線（右向き・左向き）。長さは 2 のべき乗 */
  private readonly bufR: Float64Array[];
  private readonly bufL: Float64Array[];
  private readonly mask: number[];
  private w = 0;
  /** 区間ごとの遅延 [標本]・波のインピーダンス zc = c/A・音速・温度 */
  readonly delay: Float64Array;
  readonly zc: Float64Array;
  readonly c: Float64Array;
  readonly T: Float64Array;
  /** 境目の流れの損失の係数 Δp = K ṁ|ṁ|（右向き・左向きの流れ）[Pa/(kg/s)²] */
  private readonly kFwd: Float64Array;
  private readonly kBwd: Float64Array;
  /** 損失の低域通過の極と状態（右向き・左向き） */
  private readonly pole: Float64Array;
  private readonly sR: Float64Array;
  private readonly sL: Float64Array;
  /** prepare() で求めた、区間の右端に着く右向きの波・左端に着く左向きの波 */
  readonly aR: Float64Array;
  readonly aL: Float64Array;
  /** 開いた右端か（そうでなければ呼び出し側が右端の波を渡す） */
  readonly open: boolean;
  /** 開いた端の反射の低域通過の極と状態 */
  private radP = 0;
  private radS = 0;
  /** 開いた端から出る質量流量 [kg/s]（放射の計算に使う） */
  mOut = 0;

  constructor(segs: readonly SegSpec[], fs: number, open: boolean) {
    this.segs = segs;
    this.n = segs.length;
    this.fs = fs;
    this.open = open;
    this.bufR = [];
    this.bufL = [];
    this.mask = [];
    for (const s of segs) {
      /* いちばん冷たい（遅い）ときにも入る長さ */
      const cMin = Math.sqrt(1.4 * R_GAS * Math.min(T_ATM, 250)),
        n = 2 ** Math.ceil(Math.log2(((s.len + END_CORR * s.d) / cMin) * fs + 4));
      this.bufR.push(new Float64Array(n));
      this.bufL.push(new Float64Array(n));
      this.mask.push(n - 1);
    }
    const k = this.n;
    this.delay = new Float64Array(k);
    this.zc = new Float64Array(k);
    this.c = new Float64Array(k);
    this.T = new Float64Array(k);
    this.pole = new Float64Array(k);
    this.sR = new Float64Array(k);
    this.sL = new Float64Array(k);
    this.aR = new Float64Array(k);
    this.aL = new Float64Array(k);
    this.kFwd = new Float64Array(k);
    this.kBwd = new Float64Array(k);
    this.setTemp(T_ATM);
  }

  /** 排気の温度 Tx [K] から区間ごとの温度・音速・遅延・インピーダンス・損失を決める（ゆっくり変えて呼ぶ） */
  setTemp(Tx: number): void {
    const fs = this.fs;
    this.segs.forEach((s, i) => {
      const T = T_ATM + s.heat * (Tx - T_ATM),
        c = Math.sqrt(gammaOf(T) * R_GAS * T),
        A = (Math.PI / 4) * s.d * s.d,
        last = this.open && i === this.n - 1,
        len = s.len + (last ? END_CORR * (s.d / 2) : 0);
      this.T[i] = T;
      this.c[i] = c;
      this.zc[i] = c / A;
      this.delay[i] = Math.max(1, (len / c) * fs);
      /* 1 kHz での区間 1 本の減衰（壁＋吸音材） */
      const a = ((WALL * Math.sqrt(1000)) / (s.d / 2)) * (T / 293) ** 0.85,
        db = (s.absorb ?? 0) * s.len;
      this.pole[i] = lpPole(Math.exp(-a * s.len) * 10 ** (-db / 20), fs);
      if (last) {
        /* 放射の反射の大きさを ka = 0.5 で合わせる（低い周波数で −1） */
        const f = (0.5 * c) / (Math.PI * s.d),
          w = (2 * Math.PI * f) / fs,
          m = radMag(0.5),
          m2 = m * m,
          B = (1 - m2 * Math.cos(w)) / (1 - m2);
        this.radP = f < 0.45 * fs ? B - Math.sqrt(B * B - 1) : 0;
      }
    });
    for (let i = 0; i < this.n - 1; i++) {
      const A1 = (Math.PI / 4) * this.segs[i].d ** 2,
        A2 = (Math.PI / 4) * this.segs[i + 1].d ** 2,
        As = Math.min(A1, A2),
        r = As / Math.max(A1, A2),
        rho = P_ATM / (R_GAS * 0.5 * (this.T[i] + this.T[i + 1])),
        kE = (1 - r) ** 2 / (2 * rho * As * As),
        kC = (0.5 * (1 - r)) / (2 * rho * As * As);
      /* 右向きの流れは A1 → A2: 広がるなら急拡大、狭まるなら急縮小 */
      this.kFwd[i] = A1 <= A2 ? kE : kC;
      this.kBwd[i] = A1 <= A2 ? kC : kE;
    }
  }

  /** 遅延線の d 標本前の値（線形補間） */
  private read(buf: Float64Array, mask: number, d: number): number {
    const x = this.w - d,
      i = Math.floor(x),
      f = x - i;
    return buf[i & mask] * (1 - f) + buf[(i + 1) & mask] * f;
  }

  /** この標本で端に着く波を求めて aR・aL に入れる（損失をかける） */
  prepare(): void {
    for (let i = 0; i < this.n; i++) {
      const d = this.delay[i],
        p = this.pole[i],
        m = this.mask[i];
      this.sR[i] = (1 - p) * this.read(this.bufR[i], m, d) + p * this.sR[i];
      this.sL[i] = (1 - p) * this.read(this.bufL[i], m, d) + p * this.sL[i];
      this.aR[i] = this.sR[i];
      this.aL[i] = this.sL[i];
    }
  }

  /**
   * 境目を解いて遅延線に書き、1 標本進める。left は左端から入る（右向きの）波、right は右端から入る（左向きの）
   * 波（開いた端なら無視して放射の反射を使う）
   */
  commit(left: number, right: number): void {
    const n = this.n,
      w = this.w;
    this.bufR[0][w & this.mask[0]] = left;
    for (let i = 0; i < n - 1; i++) {
      const a = this.aR[i],
        b = this.aL[i + 1],
        z1 = this.zc[i],
        z2 = this.zc[i + 1],
        s2 = 2 * (a - b),
        zs = (this.segs[i].resist ?? 0) + z1 + z2,
        K = s2 >= 0 ? this.kFwd[i] : this.kBwd[i],
        /* ṁ (zs + K|ṁ|) = 2(a − b) を ṁ について解く */
        m = K > 0 ? (Math.sign(s2) * (Math.sqrt(zs * zs + 4 * K * Math.abs(s2)) - zs)) / (2 * K) : s2 / zs;
      this.bufL[i][w & this.mask[i]] = a - z1 * m;
      this.bufR[i + 1][w & this.mask[i + 1]] = b + z2 * m;
    }
    const k = n - 1,
      a = this.aR[k];
    if (this.open) {
      this.radS = (1 - this.radP) * a + this.radP * this.radS;
      const b = -this.radS;
      this.mOut = (a - b) / this.zc[k];
      this.bufL[k][w & this.mask[k]] = b;
    } else this.bufL[k][w & this.mask[k]] = right;
    this.w = (w + 1) & 0x3fffffff;
  }

  /**
   * 区間 i の位置 s（0 が左端、1 が右端）の圧力の変動 [Pa]（基準の圧力からの差）。図に描くのに使う。
   * 右向きの波は左端から s·D 標本前に入ったもの、左向きの波は右端から (1 − s)·D 標本前に入ったもの
   * （commit の後に呼ぶので、最後に書いた標本は 1 標本前）
   */
  pressureAt(i: number, s: number): number {
    const d = this.delay[i],
      m = this.mask[i];
    return this.read(this.bufR[i], m, 1 + s * d) + this.read(this.bufL[i], m, 1 + (1 - s) * d);
  }

  /** 区間の長さ [m] と内径 [m]（図に描くのに使う） */
  seg(i: number): SegSpec {
    return this.segs[i];
  }

  /** 開いた端の気体の密度 [kg/m³] */
  rhoEnd(): number {
    return P_ATM / (R_GAS * this.T[this.n - 1]);
  }
}
