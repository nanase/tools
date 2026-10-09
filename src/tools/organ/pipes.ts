/**
 * パイプオルガンの管の模型（DOM に依存しない）。フルー管（唇管）は Verge・Fabre・Hirschberg らの集中定数の
 * ジェット駆動模型を、リード管（舌管）は打ちつけるリードの 1 自由度の振動子を、管のデジタル導波管とつないで
 * 自励振動させる。出力は 1 m 先の音圧 [Pa]（out に足す）。
 * 風箱の圧力は区分（風箱）ごとに外から標本ごとに与え、管は弁（パレット）と足の穴を通して受ける
 */

/** 空気の密度 [kg/m³]・音速 [m/s] */
export const AIR = { rho: 1.2, c: 343 } as const;
/** 音圧を求める距離 [m] */
export const R_MIC = 1;

/* ---------- 管の損失と放射 ---------- */

/**
 * 無フランジの円管の開口端の反射係数の大きさ |R|（ka の関数）。Levine・Schwinger (1948) の厳密解に
 * ka < 3 で 2 % 以内で合う Silva ら (2009) の Padé 近似 [1 + a1 x²] / [1 + (β + a1) x² + a2 x⁴ + a3 x⁶]
 * （x = ka、β = 1/2、a1 = 0.800、a2 = 0.266、a3 = 0.0263）。低い周波数で 1 − (ka)²/2
 */
export function radMag(ka: number): number {
  const x2 = ka * ka;
  return (1 + 0.8 * x2) / (1 + x2 * (1.3 + x2 * (0.266 + 0.0263 * x2)));
}
/** 開口端の端補正 ÷ 半径（低い周波数の値。Levine・Schwinger 1948） */
export const END_CORR = 0.6133;
/**
 * 管壁の粘性・熱の損失の減衰定数 α = WALL √f / a [Np/m]。Kirchhoff の式を 20 ℃の空気の値で計算したもの
 * （Keefe 1984 の近似の低い周波数の極限。Verge 1995 の式 6.24–6.25 では 2.8e-5 になる）
 */
export const WALL = 2.95e-5;

/** 1 次の低域通過 g (1 − p) / (1 − p z⁻¹) の大きさ（ω は標本あたりの角周波数） */
function lpMag(g: number, p: number, w: number): number {
  return (g * (1 - p)) / Math.sqrt(1 - 2 * p * Math.cos(w) + p * p);
}
/** 同じ低域通過の位相遅延 [標本] */
function lpDelay(p: number, w: number): number {
  return Math.atan2(p * Math.sin(w), 1 - p * Math.cos(w)) / w;
}

/**
 * 往復の損失（壁と放射）を 1 次の低域通過に合わせる。f0 で大きさをちょうど合わせ、残りの倍音（odd なら
 * 奇数次だけ）の dB の差の 2 乗和（低い倍音ほど重い）が最小になる極 p を黄金分割で探す
 */
function fitLoss(mag: (f: number) => number, f0: number, fs: number, odd: boolean): { g: number; p: number } {
  const fk: number[] = [];
  for (let k = odd ? 3 : 2; k * f0 < 0.45 * fs && fk.length < 40; k += odd ? 2 : 1) fk.push(k * f0);
  const w0 = (2 * Math.PI * f0) / fs,
    m0 = Math.min(mag(f0), 0.9999),
    tk = fk.map((f) => 20 * Math.log10(mag(f)));
  /* g ≤ 1（受動）になる極の上限: (1 − p)² = m0² (1 − 2p cos ω0 + p²) の小さい根 */
  const Bq = (1 - m0 * m0 * Math.cos(w0)) / (1 - m0 * m0),
    pMax = Math.min(0.95, Bq - Math.sqrt(Bq * Bq - 1));
  const gOf = (p: number) => Math.min(1, m0 / lpMag(1, p, w0));
  const err = (p: number) => {
    const g = gOf(p);
    let e = 0;
    fk.forEach((f, i) => {
      const d = 20 * Math.log10(lpMag(g, p, (2 * Math.PI * f) / fs)) - tk[i];
      e += (d * d * f0) / f;
    });
    return e;
  };
  let a = 0,
    b = pMax;
  const r = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 40; i++) {
    const c = b - r * (b - a),
      d = a + r * (b - a);
    if (err(c) < err(d)) b = d;
    else a = c;
  }
  const p = fk.length ? (a + b) / 2 : 0;
  return { g: gOf(p), p };
}

/**
 * 往復の損失を合わせた低域通過（fitLoss の結果）。合わせるのに 0.1〜0.2 ms かかり、和音で何十本も同時に
 * 鳴らし始めると AudioWorklet の 1 回の処理に収まらないので、調律の Worker で先に求めて設定に付けておく。
 * サンプリング周波数 fs と管の長さ len（フルー管は l、リード管は L）が設定と同じときだけ使う
 */
export interface LossFit {
  g: number;
  p: number;
  fs: number;
  len: number;
}

/** 導波管の設計値 */
interface BoreDesign {
  /** 行き（入口 → 端）の整数の遅延 [標本]・帰り（端 → 入口）の整数の遅延 [標本] */
  n1: number;
  n2: number;
  /** 帰りの分数遅延（1 次の全域通過）の係数 */
  ap: number;
  /** 端の損失の低域通過（b0 = g (1 − p)、極 p）と、端の反射の符号（開いた端 −1、閉じた端 +1） */
  g: number;
  b0: number;
  p: number;
  sR: number;
  /** 往復の遅延が足りず、短くできなかった（高すぎる管） */
  short: boolean;
}

/**
 * 導波管を設計する。l は管の長さ [m]、extra は往復に足す遅延 [s]（開口端の端補正）、f0 は第 1 共鳴の目安 [Hz]、
 * mag は往復の損失の大きさ（周波数 [Hz] の関数）、sR は端の反射の符号、odd は奇数次の共鳴だけを合わせるか。
 * 往復の遅延から、損失の低域通過の f0 での位相遅延を引いて、端の補正と合わせて管の長さを連続に表す
 */
function designBore(
  l: number,
  extra: number,
  f0: number,
  fs: number,
  mag: (f: number) => number,
  sR: number,
  odd: boolean,
  fit?: LossFit,
): BoreDesign {
  const { g, p } = fit && fit.fs === fs && fit.len === l ? fit : fitLoss(mag, f0, fs, odd),
    w0 = (2 * Math.PI * f0) / fs,
    D = ((2 * l) / AIR.c + extra) * fs - lpDelay(p, w0);
  let n1 = Math.floor((l / AIR.c) * fs),
    rem = D - n1;
  if (rem < 1.5) {
    n1 = Math.max(0, Math.floor(D - 1.5));
    rem = D - n1;
  }
  const short = rem < 1.5;
  if (short) rem = 1.5;
  let n2 = Math.floor(rem - 0.5);
  if (n2 < 1) n2 = 1;
  /* 1 次の全域通過の位相遅延が f0 でちょうど d になる係数（低い周波数の近似 (1 − d)/(1 + d) では、高い管で
     d の端（0.5 と 1.5）を越えるときに音程が跳ぶ） */
  const d = rem - n2;
  return { n1, n2, ap: Math.sin(((1 - d) * w0) / 2) / Math.sin(((1 + d) * w0) / 2), g, b0: g * (1 - p), p, sR, short };
}

/** 2 のべき乗の長さ（n 以上） */
const pow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(4, n)));

/* ---------- 風（弁と足） ---------- */

/** 弁と足の圧力の設定 */
export interface WindSpec {
  /** 足の圧力 ÷ 風箱の圧力（足の穴で絞る割合、1 以下） */
  toe: number;
  /** 弁が開き切るまで・閉じ切るまでの時間 [s] */
  tPallet: number;
  /** 足の圧力の 1 次遅れの時定数 [s] */
  tFoot: number;
}

/** tanh の近似（Lambert の連分数の 7/6 次。|x| ≥ 4.97 で ±1、誤差 1e-4 未満） */
export function tanhP(x: number): number {
  if (x > 4.97) return 1;
  if (x < -4.97) return -1;
  const x2 = x * x;
  return (x * (135135 + x2 * (17325 + x2 * (378 + x2)))) / (135135 + x2 * (62370 + x2 * (3150 + 28 * x2)));
}

/* ---------- フルー管 ---------- */

/** フルー管 1 本の設定 */
export interface FlueSpec extends WindSpec {
  /** 管の物理長（口の上端から端まで） [m]・内径 [m] */
  l: number;
  d: number;
  /** 閉管（ゲダクト）か */
  stopped: boolean;
  /** 口の幅 H [m]・カットアップ W [m]・ジェットの厚さ（フルーの開き） h [m]・唇のずれ y0 [m] */
  H: number;
  W: number;
  h: number;
  y0: number;
  /**
   * 乱流の雑音（ジェットの変位に足す雑音の実効値 ÷ b）と、その 1 次の低域通過の境目 [Hz]。雑音をジェットに足して
   * 周期に同期させる考えは Chafe (1995)。Verge (1995) は口の圧力に U_j² に比例する雑音を足す別の方法をとる
   */
  noise: number;
  fNoise: number;
  /** 音源の符号（+1 は管の内向きを正とした jet-drive。−1 は逆の取り方。検証用） */
  sign?: number;
  /** tanh を近似（tanhP）で計算するか（省くと近似） */
  fastTanh?: boolean;
  /** 乱数の種 */
  seed?: number;
  /** ジェットの増幅 e^{α_i W} の上限（省くと AMP_MAX）と、立ち上がりの小さい振れでの倍率（省くと AMP_ONSET。1 でなし） */
  ampMax?: number;
  onset?: number;
  /** 先に求めた往復の損失（省くと作るときに求める） */
  fit?: LossFit;
  /**
   * 鳴らすモード（省くと 1）。ハーモニック・フルートは倍の長さの開管を第 2 モードで鳴らす（ジェットの走行時間を鳴らす高さに
   * 合わせるので、第 1 モードは位相がそろわない）。立ち上がりの増幅は、このモードの周波数を中心にする
   */
  mode?: number;
}

/** ジェットの速さを求める間隔 [標本]（間は線形に補間する。足の圧力の変化は数 ms より遅い） */
const CTRL = 16;
/** ジェットの対流速度 ÷ ジェットの速さ（0.3〜0.5 の中の 0.4。Terrien ら 2013、de la Cuadra ら 2007） */
export const CP = 0.4;
/** 唇での流れの縮流の係数 α_vc（0.6〜1 の 0.6。Verge 1995 の式 6.26、Fabre ら 1996） */
export const ALPHA_VC = 0.6;
/**
 * 口の端補正 M = MOUTH d² / H（カットアップが口の幅の約 1/4 のとき。Fletcher 1998。Fletcher 1976 の式 (25)
 * Δl ≈ 1.3 (S_p / S_m) r と同じもの）。カットアップが 1/4 から外れる閉管にもそのまま使う（概数）
 */
export const MOUTH = 1.2;
/**
 * ジェットの増幅 e^{α_i W} の上限。α_i = 0.4 / h のままだと、オルガンの管の W/h ≈ 12 で 150 倍になり、
 * 高いモード（ωτ ≈ 2π + π/2 など）でも鳴ってしまう。ジェットの変位はジェットの厚さ程度で飽和して渦に崩れるとみて、
 * 20 倍（W/h ≈ 7.5 に当たる）で切る（試作で決めた概数。15〜20 で 8' C から上の第 1 モードが安定した）
 */
export const AMP_MAX = 20;
/**
 * 立ち上がりの、小さい振れでのジェットの増幅の上限（AMP_MAX に対する倍率）。AMP_MAX は振れが大きく飽和したときの値で、
 * 振れの小さい立ち上がりのジェットは線形の増幅 e^{α_i W} を受ける。そこで、ジェットの変位（AMP_MAX で求めた値）の
 * 1 周期の実効値が b に届くまでは、増幅を最大でこの倍率まで大きくし、b に近づくにつれて 1 倍へ戻す（包絡で決めるので、
 * 波形は歪めない。定常では変位の実効値が 2〜3 b なので、定常の音は変わらない）。
 * 大きくするのは、ジェットの変位のうち第 1 モードの近くの成分だけにする（f1 を中心とする Q = ONSET_Q の 2 次の帯域通過。
 * f1 では位相を変えない）。全部の周波数を大きくすると、端の補正で倍音からずれた上のモード（8' C で 4.2 倍）や、
 * 4 kHz 付近の高いモードが、立ち上がりで定常より 5 dB も大きく鳴り、強い雑音に聞こえた（太いプリンシパルの低音）。
 * 高い周波数（kb が 1 を超える）は、実際のジェットでは増幅されない。
 * 倍率は、寸法の近い管の実測（長さ 312 mm・内径 27 mm・第 1 共鳴 475 Hz・足の圧力 360 Pa。弁を開いてから足の圧力が
 * 定常になるまで 26〜45 ms で、基音もそれと並んで育つ。Castellengo 2004、ISMA）に、プリンシパルの C5 が合うように
 * 決めた概数（1 倍では定常の −3 dB まで 90 ms、3 倍で 42 ms）。立ち上がりはどの高さでも管の周期の約 22 倍になる。
 * 1 倍のときは約 40 倍（−3 dB まで）で、Keeler (1972) の約 200 本の管の平均（定常まで、プリンシパル族で 50 周期、
 * フルート族で 25〜30 周期。Castellengo 1999 の引用）と比べても遅かった
 */
export const AMP_ONSET = 3,
  ONSET_Q = 0.7;

/** フルー管の設計から求めた値（表示・検証用） */
export interface FlueInfo {
  /** 口の端補正 [m]・音響的な長さ [m]・第 1 共鳴の目安 [Hz] */
  M: number;
  Lac: number;
  f1: number;
  /** 往復の遅延が足りなかったか */
  short: boolean;
  /** 往復の損失の低域通過 */
  g: number;
  p: number;
}

/** 管の長さ・端補正から第 1 共鳴の目安 [Hz]（開管は c / 2L、閉管は c / 4L） */
export function flueF1(s: Pick<FlueSpec, 'l' | 'd' | 'H' | 'stopped'>): number {
  const M = (MOUTH * s.d * s.d) / s.H,
    Lac = s.l + M + (s.stopped ? 0 : END_CORR * (s.d / 2));
  return AIR.c / ((s.stopped ? 4 : 2) * Lac);
}

/**
 * フルー管。管の中の圧力の進行波を 2 本の遅延線（口 → 端、端 → 口）で持ち、口では
 * 口の空気の慣性（端補正 M の質量）・管の特性インピーダンス・唇の渦の損失と、ジェット駆動の圧力の釣り合いを
 * 台形則で解く（渦の損失 k_v |u| u の |u| は 1 標本前の値で置いて 1 次にする）。
 * ジェットの変位は η = (h / U_j) e^{α_i W} v_ac(t − τ)（α_i = 0.4 / h、τ = W / (0.4 U_j)。増幅は AMP_MAX で切り、
 * 立ち上がりの小さい振れでは AMP_ONSET まで大きくする）に乱流の雑音を足し、
 * 管に入る流量は Bickley の分布で Q_in = b H U_j (1 + tanh((η − y0) / b))（b = 0.4 h）、
 * 音源は Δp = (ρ δ_d / (W H)) dQ_in/dt（δ_d = (4/π) √(2 h W)）。
 * 式の組み立ては Terrien・Vergez・de la Cuadra・Fabre (2013) のまとめにより、部品は Verge (1995) の博士論文
 * （δ_d、b = 2h/5、渦の損失）、Verge・Hirschberg・Caussé (1997)、Fabre・Hirschberg・Wijnands (1996)、
 * η の指数の形は de la Cuadra (2005) による。
 * 符号は文献ごとに取り方が違うので、管の内向きを正として導き直した（口で内向きに流れるとジェットが内へ曲がり、
 * 内へ入る流量が増えると管の圧力が上がる）。このとき第 1 モードの位相がそろうのは ωτ ≈ π/2（τ/T ≈ 1/4、
 * θ = U_j/(fW) ≈ 10）で、実測の管の θ ≈ 8〜13（Castellengo 1999）と合う。逆の符号は τ/T ≈ 3/4 側になり、
 * その θ では第 2・第 3 モードで鳴る（check.ts で確かめた）
 */
export class FluePipe {
  readonly info: FlueInfo;
  /** 往復の損失（設定の fit に付けると、次に作るときに求めずに済む） */
  readonly fit: LossFit;
  /* 導波管 */
  private readonly fwd: Float64Array;
  private readonly bwd: Float64Array;
  private readonly mask: number;
  private readonly n1: number;
  private readonly n2: number;
  private readonly ap: number;
  private readonly b0: number;
  private readonly lp: number;
  private readonly sR: number;
  private wi = 0;
  /* ジェット */
  private readonly jet: Float64Array;
  private readonly jmask: number;
  private readonly jmax: number;
  private ji = 0;
  /* 定数 */
  private readonly Zc: number;
  private readonly m2: number;
  private readonly kv: number;
  private readonly kSf: number;
  private readonly Gj: number;
  private readonly ib: number;
  private readonly bH: number;
  private readonly tauK: number;
  private readonly invSm: number;
  private readonly kr: number;
  private readonly kF: number;
  private readonly dg: number;
  private readonly cn: number;
  private readonly nzK: number;
  private readonly kOn: number;
  private readonly kE: number;
  /* 立ち上がりで大きくする成分の帯域通過（b0、b2 = −b0、a1、a2） */
  private readonly qb0: number;
  private readonly qa1: number;
  private readonly qa2: number;
  /* 開いた端の放射の遅れ（聞く位置までの距離の差）と重み */
  private readonly eBuf: Float64Array;
  private readonly emask: number;
  private readonly eD: number;
  private readonly eF: number;
  private readonly ge: number;
  private ew = 0;
  private ue = 0;
  /* 状態 */
  private u = 0;
  private F = 0;
  private Q = 0;
  private pm = 0;
  private tx = 0;
  private ty = 0;
  private lz = 0;
  private pf = 0;
  private g = 0;
  private gate = 0;
  private nz = 0;
  private seed: number;
  /* ジェットの速さとその逆数（CTRL 標本ごとに求めて、間は線形に補間する） */
  private Uj = 0;
  private dUj = 0;
  private iU = 0;
  private diU = 0;
  private kc = 0;
  /** ジェットの変位 ÷ b の 2 乗の、1 周期の平均（立ち上がりの増幅を決める） */
  private env = 0;
  private qx1 = 0;
  private qx2 = 0;
  private qy1 = 0;
  private qy2 = 0;
  /** 弁を閉じて、音が消えた */
  done = false;

  constructor(
    readonly spec: FlueSpec,
    readonly fs: number,
  ) {
    const s = spec,
      { rho, c } = AIR,
      a = s.d / 2,
      Sp = Math.PI * a * a,
      Sm = s.W * s.H,
      M = (MOUTH * s.d * s.d) / s.H,
      Lac = s.l + M + (s.stopped ? 0 : END_CORR * a),
      f1 = c / ((s.stopped ? 4 : 2) * Lac);
    /* 往復の損失: 口と開いた端の放射（同じ半径の無フランジ端とみなす）と、管壁の損失 */
    const mag = (f: number) => {
      const ka = (2 * Math.PI * f * a) / c,
        r = radMag(ka);
      return (s.stopped ? r : r * r) * Math.exp((-2 * WALL * Math.sqrt(f) * s.l) / a);
    };
    const bd = designBore(
      s.l,
      s.stopped ? 0 : (2 * END_CORR * a) / c,
      f1,
      fs,
      mag,
      s.stopped ? 1 : -1,
      s.stopped,
      s.fit,
    );
    const len = pow2(Math.max(bd.n1, bd.n2) + 2);
    this.fwd = new Float64Array(len);
    this.bwd = new Float64Array(len);
    this.mask = len - 1;
    this.n1 = bd.n1;
    this.n2 = bd.n2;
    this.ap = bd.ap;
    this.b0 = bd.b0;
    this.lp = bd.p;
    this.sR = bd.sR;
    /* ジェットの遅延線（足の圧力が低い間は τ が長いので、上限で切る） */
    const jl = pow2(Math.ceil(0.03 * fs));
    this.jet = new Float64Array(jl);
    this.jmask = jl - 1;
    this.jmax = jl - 3;
    this.Zc = (rho * c) / Sp;
    /* 口の空気の質量 ρ M / S_p の 2/T 倍（台形則） */
    this.m2 = ((2 * rho * M) / Sp) * fs;
    /* 渦の損失 (ρ/2)(v / α_vc)² を体積速度で */
    this.kv = rho / (2 * ALPHA_VC * ALPHA_VC * Sm * Sm);
    const dd = (4 / Math.PI) * Math.sqrt(2 * s.h * s.W);
    this.kSf = (((s.sign ?? 1) * rho * dd) / Sm) * fs;
    const amp = s.ampMax ?? AMP_MAX,
      lin = Math.exp((0.4 * s.W) / s.h);
    this.Gj = s.h * Math.min(amp, lin);
    /* 立ち上がりの増幅の倍率 − 1（線形の増幅が上限より小さい管は 0） */
    this.kOn = Math.max(1, Math.min((s.onset ?? AMP_ONSET) * amp, lin) / amp) - 1;
    this.ib = 1 / (0.4 * s.h);
    this.bH = 0.4 * s.h * s.H;
    this.tauK = (s.W / CP) * fs;
    this.invSm = 1 / Sm;
    this.kr = (rho / (4 * Math.PI * R_MIC)) * fs;
    this.kF = 1 - Math.exp(-1 / (s.tFoot * fs));
    this.dg = 1 / (Math.max(1e-4, s.tPallet) * fs);
    this.cn = 1 - Math.exp((-2 * Math.PI * Math.min(s.fNoise, 0.4 * fs)) / fs);
    this.nzK = s.noise * 0.4 * s.h * Math.sqrt((2 - this.cn) / this.cn) * Math.sqrt(3);
    this.seed = (s.seed ?? 12345) | 0 || 1;
    /* 聞く位置は口から水平に R_MIC。管は立っていて、開いた端は口の真上 l の高さ */
    const re = Math.hypot(R_MIC, s.l),
      de = ((re - R_MIC) / c) * fs;
    this.eD = Math.floor(de);
    this.eF = de - this.eD;
    this.ge = R_MIC / re;
    const el = pow2(this.eD + 2);
    this.eBuf = new Float64Array(el);
    this.emask = el - 1;
    this.info = { M, Lac, f1, short: bd.short, g: bd.g, p: bd.p };
    const fm = f1 * (s.mode ?? 1);
    this.kE = 1 - Math.exp(-fm / fs);
    {
      const w0 = (2 * Math.PI * Math.min(fm, 0.4 * fs)) / fs,
        al = Math.sin(w0) / (2 * ONSET_Q),
        a0 = 1 + al;
      this.qb0 = al / a0;
      this.qa1 = (-2 * Math.cos(w0)) / a0;
      this.qa2 = (1 - al) / a0;
    }
    this.fit = { g: bd.g, p: bd.p, fs, len: s.l };
  }

  /** 弁を開く */
  on(): void {
    this.gate = 1;
    this.done = false;
  }
  /** 弁を閉じる */
  off(): void {
    this.gate = 0;
  }
  /** 弁が開いているか */
  get open(): boolean {
    return this.gate === 1;
  }

  /**
   * out[off] から len 標本に、1 m 先の音圧 [Pa] を足す。wind は風箱の圧力 [Pa]（out と同じ標本の並び、
   * wind[i] が out[off + i] に対応）
   */
  render(out: Float32Array | Float64Array, off: number, len: number, wind: Float64Array): void {
    if (this.done) return;
    const { fwd, bwd, mask, n1, n2, ap, b0, lp, sR, jet, jmask, jmax, Zc, m2, kv, Gj, bH, kSf, ib } = this,
      { tauK, invSm, kF, dg, cn, nzK, kr, eBuf, emask, eD, eF, ge } = this,
      toe = this.spec.toe,
      y0 = this.spec.y0,
      open = this.spec.stopped ? 0 : 1,
      fast = this.spec.fastTanh ?? true,
      B = m2 + Zc,
      iZc = 1 / Zc,
      gate = this.gate,
      sq2r = Math.sqrt(2 / AIR.rho);
    let { wi, ji, u, F, Q, pm, tx, ty, lz, pf, g, nz, seed, ew, ue, Uj, dUj, iU, diU, kc, env } = this,
      peak = 0;
    const { kOn, kE, qb0, qa1, qa2 } = this;
    let { qx1, qx2, qy1, qy2 } = this;
    for (let i = 0; i < len; i++) {
      const pc = toe * wind[i];
      let acc = 0;
      /* 弁と足 */
      if (g !== gate) g = gate > g ? Math.min(gate, g + dg) : Math.max(gate, g - dg);
      pf += kF * (pc * g - pf);
      if (kc === 0) {
        const Ut = pf > 0 ? sq2r * Math.sqrt(pf) : 0;
        dUj = (Ut - Uj) / CTRL;
        diU = ((Ut > 1e-3 ? 1 / Ut : 0) - iU) / CTRL;
        kc = CTRL;
      }
      Uj += dUj;
      iU += diU;
      kc--;
      /* ジェットの変位（τ だけ前の口の速さ、線形補間）と乱流の雑音 */
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      nz += cn * (seed * 4.656612873077393e-10 - nz);
      let Qn = 0;
      if (Uj > 1e-3) {
        let td = tauK * iU;
        if (td > jmax) td = jmax;
        if (td < 1) td = 1;
        const ti = td | 0,
          fr = td - ti,
          j0 = jet[(ji - ti) & jmask],
          j1 = jet[(ji - ti - 1) & jmask],
          a = Gj * (j0 + fr * (j1 - j0)) * iU * ib,
          r = env < 1 ? 1 - env : 0,
          ab = qb0 * (a - qx2) - qa1 * qy1 - qa2 * qy2,
          x = a + kOn * r * r * ab + (nzK * nz - y0) * ib;
        qx2 = qx1;
        qx1 = a;
        qy2 = qy1;
        qy1 = ab;
        env += kE * (a * a - env);
        Qn = bH * Uj * (1 + (fast ? tanhP(x) : Math.tanh(x)));
      } else {
        env -= kE * env;
        /*
         * ジェットがなければ変位もないので、立ち上がりの帯域通過の状態を消す。弁を閉じて U_j が 0 に近づく間は
         * 変位が 1/U_j で大きくなり、その値のまま残すと、鳴り終わる前の管を開き直したときに帯域通過が大きく振れて、
         * 流量が 0 と最大の間を一瞬で切り替わり、破裂音になる（ペダルの太い低音で目立った）
         */
        qx1 = qx2 = qy1 = qy2 = 0;
      }
      const dps = kSf * (Qn - Q);
      Q = Qn;
      /*
       * 口: (2m/T + Z_c) u + k_v |u| u = (2m/T) u⁻ + F⁻ + Δp − 2 p⁻。|u| は 1 標本前の値で置いて 1 次にする
       * （2 次方程式を閉じた形で解くのと、音程は 1 セント未満・倍音は 0.2 dB 以内で同じで、平方根が要らない）
       */
      const au = u < 0 ? -u : u,
        E = m2 * u + F + dps - 2 * pm,
        un = E / (B + kv * au);
      F = dps - 2 * pm - Zc * un - kv * au * un;
      const up = u;
      u = un;
      jet[ji] = u * invSm;
      ji = (ji + 1) & jmask;
      /* 管: 行きの波を書き、端で反射して帰りの線へ */
      fwd[wi] = pm + Zc * u;
      const pL = fwd[(wi - n1) & mask];
      lz = b0 * pL + lp * lz;
      const rf = sR * lz;
      bwd[wi] = rf;
      const xb = bwd[(wi + 1 - n2) & mask],
        yb = ap * xb + tx - ap * ty;
      tx = xb;
      ty = yb;
      pm = yb;
      wi = (wi + 1) & mask;
      /* 放射: 口から出る体積速度 −u と、開いた端から出る (p⁺ − p⁻) / Z_c（距離の差だけ遅らせて重みを掛ける） */
      acc -= un - up;
      if (open) {
        const uen = (pL - rf) * iZc;
        eBuf[ew] = uen - ue;
        ue = uen;
        const e0 = eBuf[(ew - eD) & emask];
        acc += ge * (e0 + eF * (eBuf[(ew - eD - 1) & emask] - e0));
        ew = (ew + 1) & emask;
      }
      const p = kr * acc;
      out[off + i] += p;
      if (!gate) {
        const a = p < 0 ? -p : p;
        if (a > peak) peak = a;
      }
    }
    this.wi = wi;
    this.ji = ji;
    this.u = u;
    this.F = F;
    this.Q = Q;
    this.pm = pm;
    this.tx = tx;
    this.ty = ty;
    this.lz = lz;
    this.pf = pf;
    this.g = g;
    this.nz = nz;
    this.seed = seed;
    this.ew = ew;
    this.ue = ue;
    this.Uj = Uj;
    this.dUj = dUj;
    this.iU = iU;
    this.diU = diU;
    this.kc = kc;
    this.env = env;
    this.qx1 = qx1;
    this.qx2 = qx2;
    this.qy1 = qy1;
    this.qy2 = qy2;
    /* 弁を閉じたあと、足の圧力も音も十分小さくなったら止める */
    if (!gate && g === 0 && pf < 1e-3 && peak < 1e-6) this.done = true;
  }

  /** 足の圧力 [Pa]（検証用） */
  get foot(): number {
    return this.pf;
  }
}

/* ---------- リード管 ---------- */

/** リード管 1 本の設定 */
export interface ReedSpec extends WindSpec {
  /** 舌の固有振動数 [Hz]・Q・単位面積あたりの等価質量 μ [kg/m²] */
  fr: number;
  Q: number;
  mu: number;
  /** 舌の先の開き（静止時） [m]・流れの幅 [m]・舌の動きで押しのける等価な面積 [m²] */
  y0: number;
  w: number;
  Sr: number;
  /** 共鳴管: 円錐か円筒か、長さ [m]、リード側の内径 [m]、先端の内径 [m] */
  bore: 'cone' | 'cyl';
  L: number;
  d0: number;
  d1: number;
  /** シャロットと足の、リードの内側の容積 [m³]（円錐は切り取った頂点の容積にすると倍音がそろう） */
  Vs: number;
  /** 転がる接触のばねの強さと、効き始める隙間 ÷ y0（省くと KC・HC） */
  Kc?: number;
  hc?: number;
  /** 先に求めた往復の損失（省くと作るときに求める） */
  fit?: LossFit;
}

/**
 * 舌が転がって当たる接触: 曲げてある舌はシャロットの面に根元から転がって当たり、振動する長さが短くなって硬くなる。
 * 隙間 h が HC·y0 を切ると、KC ω_r² (HC y0 − h)² / (HC y0) の加速度で押し返す（h = 0 で硬さは元の 1 + 2 KC 倍）。
 * h ≤ 0 では位置を止める（非弾性の衝突。Scavone 1997 と同じ扱い）。Rucz ら (2014) の「シャロットに当たる
 * 復元力」と、大きく振れると振動する長さが周期的に短くなって周波数が上がるという Miklós ら (2003) の観察に
 * ならった試作の概数（止めるだけだと閉じている時間が長くなって音程が下がり、閉じた瞬間の流量の段差が放射で
 * とげになる。強くすると大きく振れたときの舌の振動数が上がる。KC = 1〜5 で比べて 1 にした）
 */
export const KC = 1,
  HC = 0.2;

/** リード管の設計から求めた値（表示・検証用） */
export interface ReedInfo {
  /** 円錐の頂点からリード側の端までの距離 [m]（円筒は Infinity） */
  x0: number;
  /** 共鳴管の第 1 共鳴の目安 [Hz] */
  fRes: number;
  /** 閉じる圧力 μ ω_r² y0 [Pa] */
  pc: number;
  short: boolean;
}

/** 共鳴管の第 1 共鳴の目安 [Hz]（円錐は頂点まで延ばした長さの開管、円筒はリード側を閉じた閉管） */
export function resF1(s: Pick<ReedSpec, 'bore' | 'L' | 'd0' | 'd1'>): number {
  const a1 = s.d1 / 2;
  if (s.bore === 'cyl') return AIR.c / (4 * (s.L + END_CORR * a1));
  const x0 = (s.L * s.d0) / (s.d1 - s.d0);
  return AIR.c / (2 * (s.L + x0 + END_CORR * a1));
}

/**
 * リード管。舌は 1 自由度の振動子 ÿ + (ω_r/Q) ẏ + ω_r² y = −Δp / μ（Δp は足とシャロットの圧力の差、閉じる向きに
 * 押す）を厳密な離散化（入力は 0 次ホールド）で回す。隙間が小さくなると転がる接触のばね（KC・HC）が押し返し、
 * 先の開き y0 + y が 0 以下なら当たって止まる（位置を 0 に戻し、閉じる向きの速さを捨てる）。
 * 内向きに打つ舌（Fletcher 1979 の (−,+)。オルガンの舌管もこれ）。
 * 流量はベルヌーイ U = w h √(2|Δp|/ρ) sgn(Δp) から舌の動きの分 S_r ẏ を引いたもの（Scavone 1997 の §3.5.3）。
 * 共鳴管の入口では圧力 p = 2 p⁻ + Z_c (U − U_L − U_C)。円錐は頂点側の慣性 ρ x0 / S0 が並列に入り（U_L。球面波の
 * 特性インピーダンス (ρc/S)·ikx/(1 + ikx)。Scavone 1997 の式 (1.62)–(1.63)、§3.5.4）、シャロットの容積の圧縮
 * （U_C）も並列に入る。どちらも台形則で離散化すると p は U の 1 次式になり、ベルヌーイの式と合わせた 2 次方程式を
 * 閉じた形で解ける（Guillemain・Kergomard・Voinier 2005 の §IV.D と同じ方法。舌の位置は 1 標本前の圧力の差で
 * 進めるので遅れのない環はできず、舌の動きの流量も既知の量として入る）
 */
export class ReedPipe {
  readonly info: ReedInfo;
  /** FluePipe.fit と同じ */
  readonly fit: LossFit;
  private readonly fwd: Float64Array;
  private readonly bwd: Float64Array;
  private readonly mask: number;
  private readonly n1: number;
  private readonly n2: number;
  private readonly ap: number;
  private readonly b0: number;
  private readonly lp: number;
  /* 舌の離散化 */
  private readonly P11: number;
  private readonly P12: number;
  private readonly P21: number;
  private readonly P22: number;
  private readonly G1: number;
  private readonly G2: number;
  /* 入口 */
  private readonly Zc: number;
  private readonly Ze: number;
  private readonly kL: number;
  private readonly kC: number;
  private readonly kOut: number;
  private readonly kr: number;
  private readonly kF: number;
  private readonly dg: number;
  /* 状態 */
  private wi = 0;
  private y = 0;
  private yd = 0;
  private dp = 0;
  private pm = 0;
  private pp = 0;
  private UL = 0;
  private UC = 0;
  private tx = 0;
  private ty = 0;
  private lz = 0;
  private uo = 0;
  private pf = 0;
  private g = 0;
  private gate = 0;
  done = false;
  /** 舌が当たった回数（検証用） */
  hits = 0;

  constructor(
    readonly spec: ReedSpec,
    readonly fs: number,
  ) {
    const s = spec,
      T = 1 / fs,
      { rho, c } = AIR,
      a0 = s.d0 / 2,
      a1 = s.d1 / 2,
      S0 = Math.PI * a0 * a0,
      cone = s.bore === 'cone',
      x0 = cone ? (s.L * a0) / (a1 - a0) : Infinity,
      fRes = resF1(s);
    /* 往復の損失: 先端の放射と管壁の損失（円錐は 1/a の平均） */
    const invA = cone ? Math.log(a1 / a0) / (a1 - a0) : 1 / a1;
    const mag = (f: number) => radMag((2 * Math.PI * f * a1) / c) * Math.exp(-2 * WALL * Math.sqrt(f) * s.L * invA);
    const bd = designBore(s.L, (2 * END_CORR * a1) / c, fRes, fs, mag, -1, !cone, s.fit);
    const len = pow2(Math.max(bd.n1, bd.n2) + 2);
    this.fwd = new Float64Array(len);
    this.bwd = new Float64Array(len);
    this.mask = len - 1;
    this.n1 = bd.n1;
    this.n2 = bd.n2;
    this.ap = bd.ap;
    this.b0 = bd.b0;
    this.lp = bd.p;
    /* 舌: x = [y, ẏ]、e^{AT} と、一定の入力 f（加速度）に対する (I − e^{AT}) [1/ω², 0]ᵀ */
    const wr = 2 * Math.PI * s.fr,
      ze = 1 / (2 * s.Q),
      sg = ze * wr,
      wd = wr * Math.sqrt(1 - ze * ze),
      e = Math.exp(-sg * T),
      cs = Math.cos(wd * T),
      sn = Math.sin(wd * T);
    this.P11 = e * (cs + (sg / wd) * sn);
    this.P12 = (e * sn) / wd;
    this.P21 = (-e * wr * wr * sn) / wd;
    this.P22 = e * (cs - (sg / wd) * sn);
    this.G1 = (1 - this.P11) / (wr * wr);
    this.G2 = -this.P21 / (wr * wr);
    /* 入口: G = 1/Z_c + T/(2 M_c) + 2C/T、M_c = ρ x0 / S0、C = V / (ρ c²) */
    this.Zc = (rho * c) / S0;
    this.kL = cone ? T / (2 * ((rho * x0) / S0)) : 0;
    this.kC = (2 * (s.Vs / (rho * c * c))) / T;
    this.Ze = 1 / (1 / this.Zc + this.kL + this.kC);
    /* 先端の体積速度 = (x1 / x0)(p⁺ − p⁻) / Z_c0（円錐の球面波の広がり）。円筒は 1 */
    this.kOut = (cone ? (x0 + s.L) / x0 : 1) / this.Zc;
    this.kr = (rho / (4 * Math.PI * R_MIC)) * fs;
    this.kF = 1 - Math.exp(-1 / (s.tFoot * fs));
    this.dg = 1 / (Math.max(1e-4, s.tPallet) * fs);
    this.info = { x0, fRes, pc: s.mu * wr * wr * s.y0, short: bd.short };
    this.fit = { g: bd.g, p: bd.p, fs, len: s.L };
  }

  on(): void {
    this.gate = 1;
    this.done = false;
  }
  off(): void {
    this.gate = 0;
  }
  get open(): boolean {
    return this.gate === 1;
  }

  /** FluePipe.render と同じ */
  render(out: Float32Array | Float64Array, off: number, len: number, wind: Float64Array): void {
    if (this.done) return;
    const { fwd, bwd, mask, n1, n2, ap, b0, lp, P11, P12, P21, P22, G1, G2, Zc, Ze, kL, kC, kOut, kF, dg, kr } = this,
      { toe, y0, w, Sr, mu } = this.spec,
      hcy = (this.spec.hc ?? HC) * y0,
      kcc = ((this.spec.Kc ?? KC) * (2 * Math.PI * this.spec.fr) ** 2) / hcy,
      gate = this.gate,
      kLC = kL - kC,
      Aw = w * Math.sqrt(2 / AIR.rho),
      invMu = 1 / mu;
    let { wi, y, yd, dp, pm, pp, UL, UC, tx, ty, lz, uo, pf, g, hits } = this,
      peak = 0;
    for (let i = 0; i < len; i++) {
      const pc = toe * wind[i];
      let acc = 0;
      if (g !== gate) g = gate > g ? Math.min(gate, g + dg) : Math.max(gate, g - dg);
      pf += kF * (pc * g - pf);
      /* 舌（前の標本の圧力の差で押す） */
      let fa = -dp * invMu;
      const hn = y0 + y;
      if (hn < hcy) {
        const e = hcy - hn;
        fa += kcc * e * e;
      }
      let yn = P11 * y + P12 * yd + G1 * fa,
        ydn = P21 * y + P22 * yd + G2 * fa;
      if (yn < -y0) {
        yn = -y0;
        if (ydn < 0) {
          ydn = 0;
          hits++;
        }
      }
      y = yn;
      yd = ydn;
      /* 入口: p = Z_e (U + J)、Δp = X − Z_e U_B */
      const J = (2 * pm) / Zc - UL - kLC * pp + UC,
        X = pf - Ze * (J - Sr * yd),
        A = Aw * (y0 + y),
        ax = X < 0 ? -X : X;
      let UB = 0;
      if (A > 0) {
        const za = Ze * A;
        UB = (A * 2 * X) / (za + Math.sqrt(za * za + 4 * ax));
      }
      const p = Ze * (UB - Sr * yd + J);
      dp = pf - p;
      UL += kL * (p + pp);
      UC = kC * (p - pp) - UC;
      pp = p;
      /* 管 */
      fwd[wi] = p - pm;
      const pL = fwd[(wi - n1) & mask];
      lz = b0 * pL + lp * lz;
      const rf = -lz;
      bwd[wi] = rf;
      const xb = bwd[(wi + 1 - n2) & mask],
        yb = ap * xb + tx - ap * ty;
      tx = xb;
      ty = yb;
      pm = yb;
      wi = (wi + 1) & mask;
      const Uo = kOut * (pL - rf);
      acc += Uo - uo;
      uo = Uo;
      const po = kr * acc;
      out[off + i] += po;
      if (!gate) {
        const a = po < 0 ? -po : po;
        if (a > peak) peak = a;
      }
    }
    this.wi = wi;
    this.y = y;
    this.yd = yd;
    this.dp = dp;
    this.pm = pm;
    this.pp = pp;
    this.UL = UL;
    this.UC = UC;
    this.tx = tx;
    this.ty = ty;
    this.lz = lz;
    this.uo = uo;
    this.pf = pf;
    this.g = g;
    this.hits = hits;
    if (!gate && g === 0 && pf < 1e-3 && peak < 1e-6) this.done = true;
  }

  get foot(): number {
    return this.pf;
  }
  /** 舌の先の開き [m]（検証用） */
  get gap(): number {
    return this.spec.y0 + this.y;
  }
}

/** 管 1 本（フルー管かリード管） */
export type Pipe = FluePipe | ReedPipe;
