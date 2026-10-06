/**
 * 胴の模型（DOM に依存しない）。低い周波数は Christensen・Vistisen (1980) の 2 自由度の模型
 * （表板の第 1 モードとサウンドホールの空気の振動が胴の空気でつながる）、高い周波数は
 * Woodhouse (2004) の「統計的なギター」にならい、板の理論のモード密度と平均の駆動点アドミタンスに合う
 * 乱数のモードで表す。駒の位置での力 → 速度（アドミタンス）と、1 m 先の音圧を返す
 */
import { AIR } from './strings';

/** 複素数 */
export interface Cx {
  re: number;
  im: number;
}
const cx = (re: number, im = 0): Cx => ({ re, im });
const add = (a: Cx, b: Cx): Cx => cx(a.re + b.re, a.im + b.im);
const sub = (a: Cx, b: Cx): Cx => cx(a.re - b.re, a.im - b.im);
const mul = (a: Cx, b: Cx): Cx => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const div = (a: Cx, b: Cx): Cx => {
  const d = b.re * b.re + b.im * b.im;
  return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
const scl = (a: Cx, k: number): Cx => cx(a.re * k, a.im * k);
export const cabs = (a: Cx): number => Math.hypot(a.re, a.im);
const cexp = (a: Cx): Cx => {
  const e = Math.exp(a.re);
  return cx(e * Math.cos(a.im), e * Math.sin(a.im));
};
export const C = { cx, add, sub, mul, div, scl, cexp };

/** 表板の木材: 密度 [kg/m³]、木目方向と直交方向のヤング率 [Pa] */
export interface Wood {
  v: string;
  name: string;
  rho: number;
  EL: number;
  ER: number;
}
export const WOODS: readonly Wood[] = [
  { v: 'spruce', name: 'スプルース', rho: 420, EL: 11e9, ER: 0.85e9 },
  { v: 'cedar', name: 'シダー', rho: 370, EL: 8e9, ER: 0.6e9 },
];
export const woodOf = (v: string): Wood => WOODS.find((w) => w.v === v) ?? WOODS[0];

/** 胴の形: 表板の面積 [m²]、力木で曲げ剛性が増す倍率、駒の質量 [kg] と、厚さ・容積・穴の初期値 */
export interface BodyType {
  v: 'classical' | 'dread';
  name: string;
  area: number;
  brace: number;
  mb: number;
  h: number;
  V: number;
  dh: number;
}
export const BODY_TYPES: readonly BodyType[] = [
  { v: 'classical', name: 'クラシック', area: 0.14, brace: 1.8, mb: 0.02, h: 2.5e-3, V: 13e-3, dh: 85e-3 },
  { v: 'dread', name: 'ドレッドノート', area: 0.17, brace: 2.5, mb: 0.025, h: 2.9e-3, V: 17.5e-3, dh: 100e-3 },
];
export const bodyTypeOf = (v: string): BodyType => BODY_TYPES.find((b) => b.v === v) ?? BODY_TYPES[0];

export interface BodySpec {
  type: string;
  wood: string;
  /** 表板の厚さ [m] */
  h: number;
  /** 胴の容積 [m³] */
  V: number;
  /** サウンドホールの直径 [m] */
  dh: number;
}

/* ---------- 模型の定数 ---------- */
/** 表板の第 1 モードの等価質量のうち、表板の質量の割合 */
const MASS_FRAC = 0.41;
/** 等価なピストンの面積 ÷ 表板の面積（Christensen・Vistisen: 550 cm² ÷ 1400 cm²） */
const AREA_FRAC = 0.39;
/** 表板の剛性 k_p = KP·D / 面積（クラシックの表板で胴のない共振が 174 Hz になる値） */
const KP = 1870;
/** 表板（胴の空気なし）と、サウンドホールの空気の Q */
const QP = 25,
  QH = 20;
/** 平均の駆動点アドミタンスのうち、駒と力木で下がる分（無限板の値に掛ける） */
const KAPPA = 0.25;
/** 平均のアドミタンスが半分になる周波数 [Hz] */
const FB = 2000;
/** 統計的なモードの上限 [Hz] */
export const F_TOP = 6000;
/** 音圧を求める距離 [m] */
export const R_MIC = 1;
/** 統計的なモードの放射: 駒の速度に対する表板の平均の速度の割合と、放射効率の下限 */
const RAD_K = 0.8,
  SIG0 = 0.05;
/** 乱数の種（同じ設定なら同じ胴） */
const SEED = 20040928;

/** 統計的なモード */
export interface StatMode {
  /** 固有周波数 [Hz] */
  f: number;
  /** 損失係数（1/Q） */
  eta: number;
  /** 有効質量 [kg] */
  m: number;
  /** 駒での振動の向き（表板の法線からの角度） [rad] */
  th: number;
  /** 1 m 先の音圧 ÷ モードの速度 [Pa·s/m] */
  G: number;
}

/** 胴の模型の値 */
export interface Body {
  spec: BodySpec;
  /** 表板の等価質量 [kg]・等価ピストン面積 [m²]・剛性 [N/m] */
  mp: number;
  Ap: number;
  kp: number;
  /** サウンドホールの面積 [m²]・空気の質量 [kg] */
  S: number;
  ma: number;
  /** 胴の空気の圧力の係数 ρc²/V [Pa/m³] */
  muV: number;
  /** 角周波数²: 胴を閉じた表板・ヘルムホルツ・結合（ω_c⁴ を ω_c² で持つ） */
  wp2: number;
  wh2: number;
  wc2: number;
  gp: number;
  ga: number;
  /** 胴のない表板・ヘルムホルツ・結合した 2 つの共振の周波数 [Hz] */
  fp0: number;
  fp: number;
  fh: number;
  fm: number;
  fpl: number;
  /** 結合した 2 つのモード（上半面の極）と、体積速度 ÷ 力の留数 */
  cv: { lam: Cx; r: Cx }[];
  stat: StatMode[];
  /** 板の曲げ剛性 [N·m]・面密度 [kg/m²]・平均のモード間隔 [Hz]・無限板の駆動点アドミタンス [s/kg] */
  D: number;
  rhoh: number;
  df: number;
  yInf: number;
  /** 表板の一致周波数（板の曲げ波の速さが音速と等しくなる周波数） [Hz] */
  fc: number;
}

/** 決まった乱数（mulberry32） */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** 標準正規分布（Box–Muller） */
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

/** 4 次式 D(s) = a(s) b(s) − ω_c⁴ と、その微分 */
function dpoly(b: Body, s: Cx): [Cx, Cx] {
  const s2 = mul(s, s),
    a = add(add(s2, scl(s, b.gp)), cx(b.wp2)),
    bb = add(add(s2, scl(s, b.ga)), cx(b.wh2)),
    d = sub(mul(a, bb), cx(b.wc2 * b.wc2)),
    da = add(scl(s, 2), cx(b.gp)),
    db = add(scl(s, 2), cx(b.ga));
  return [d, add(mul(da, bb), mul(a, db))];
}

/** 胴の模型を作る */
export function makeBody(spec: BodySpec): Body {
  const ty = bodyTypeOf(spec.type),
    w = woodOf(spec.wood),
    { h, V, dh } = spec;
  const D = (ty.brace * Math.sqrt(w.EL * w.ER) * h ** 3) / 12,
    rhoh = w.rho * h,
    mp = ty.mb + MASS_FRAC * rhoh * ty.area,
    Ap = AREA_FRAC * ty.area,
    kp = (KP * D) / ty.area,
    S = (Math.PI * dh * dh) / 4,
    ma = AIR.rho * S * (h + 0.85 * dh),
    muV = (AIR.rho * AIR.c * AIR.c) / V;
  const wp2 = (kp + muV * Ap * Ap) / mp,
    wh2 = (muV * S * S) / ma,
    wc2 = (muV * S * Ap) / Math.sqrt(mp * ma),
    gp = Math.sqrt(wp2) / QP,
    ga = Math.sqrt(wh2) / QH;
  const sum = wp2 + wh2,
    dif = Math.sqrt((wp2 - wh2) ** 2 + 4 * wc2 * wc2),
    TAU = 2 * Math.PI;
  const b: Body = {
    spec,
    mp,
    Ap,
    kp,
    S,
    ma,
    muV,
    wp2,
    wh2,
    wc2,
    gp,
    ga,
    fp0: Math.sqrt(kp / mp) / TAU,
    fp: Math.sqrt(wp2) / TAU,
    fh: Math.sqrt(wh2) / TAU,
    fm: Math.sqrt((sum - dif) / 2) / TAU,
    fpl: Math.sqrt((sum + dif) / 2) / TAU,
    cv: [],
    stat: [],
    D,
    rhoh,
    df: 2 / (ty.area * Math.sqrt(rhoh / D)),
    yInf: 1 / (8 * Math.sqrt(D * rhoh)),
    fc: ((AIR.c * AIR.c) / TAU) * Math.sqrt(rhoh / D),
  };

  /* 結合した 2 つのモード: 減衰のない周波数から Newton 法で D(s) = 0 の根を求め、U/F の留数を出す */
  for (const f of [b.fm, b.fpl]) {
    const wv = TAU * f;
    let s = cx(-wv / 50, wv);
    for (let i = 0; i < 30; i++) {
      const [d, dd] = dpoly(b, s),
        ds = div(d, dd);
      s = sub(s, ds);
      if (cabs(ds) < 1e-9 * wv) break;
    }
    /* U/F = A (s³ + γ_a s²) / (m_p D(s)) */
    const s2 = mul(s, s),
      num = scl(add(mul(s2, s), scl(s2, ga)), Ap / mp);
    b.cv.push({ lam: s, r: div(num, dpoly(b, s)[1]) });
  }

  /* 統計的なモード: 間隔は板のモード密度、有効質量の逆数は平均のアドミタンスに合わせた χ² 分布 */
  const r = rng(SEED);
  let f = 1.15 * b.fpl;
  while (true) {
    f += b.df * (0.65 + 0.7 * r());
    if (f > F_TOP) break;
    const g = gauss(r),
      yMean = (KAPPA * b.yInf) / (1 + f / FB),
      invM = 4 * yMean * b.df * Math.max(0.02, g * g),
      eta = 0.025 * (1 + f / FB),
      th = 0.4 * gauss(r),
      x = (f / b.fc) ** 1.5,
      sig = SIG0 + x / (1 + x),
      G = (RAD_K * gauss(r) * AIR.rho * AIR.c * Math.sqrt((sig * ty.area) / (2 * Math.PI))) / R_MIC;
    b.stat.push({ f, eta, m: 1 / invM, th, G });
  }
  return b;
}

/** 統計的なモード 1 つのアドミタンス iω / (m (ω_k² − ω² + iω ω_k η)) */
function yMode(m: StatMode, w: Cx): Cx {
  const wk = 2 * Math.PI * m.f,
    iw = cx(-w.im, w.re),
    den = add(sub(cx(wk * wk), mul(w, w)), scl(iw, wk * m.eta));
  return div(iw, scl(den, m.m));
}

/** 2 自由度の模型の駒のアドミタンス iω b / (m_p (a b − ω_c⁴))（e^{iωt}、ω は複素数でもよい） */
export function yCv(b: Body, w: Cx): Cx {
  const iw = cx(-w.im, w.re),
    w2 = mul(w, w),
    a = add(sub(cx(b.wp2), w2), scl(iw, b.gp)),
    bb = add(sub(cx(b.wh2), w2), scl(iw, b.ga)),
    d = sub(mul(a, bb), cx(b.wc2 * b.wc2));
  return div(mul(iw, bb), scl(d, b.mp));
}

/**
 * 駒のアドミタンス（速度 ÷ 力） [s/kg]。pol 0 は表板に垂直、1 は表板に平行の向き。
 * 2 自由度の模型は垂直の向きだけに動く
 */
export function admittance(b: Body, w: Cx, pol: 0 | 1): Cx {
  let y = pol ? cx(0) : yCv(b, w);
  for (const m of b.stat) {
    const c = pol ? Math.sin(m.th) : Math.cos(m.th);
    y = add(y, scl(yMode(m, w), c * c));
  }
  return y;
}

/** 2 自由度の模型の放射を高い周波数で落とす 2 次の低域通過の境目 [Hz]（その上は統計的なモードが受け持つ） */
export const cvLp = (b: Body): number => 1.6 * b.fpl;

/** 1 m 先の音圧 ÷ 駒への垂直の力 [Pa/N]（周波数 f [Hz]、表示用） */
export function pressure(b: Body, f: number): Cx {
  const wv = 2 * Math.PI * f,
    w = cx(wv),
    iw = cx(0, wv);
  /* 2 自由度: p = iωρ U / (4πR)、U = A (iω)(−ω² + iωγ_a) / (m_p D) を 2 次の低域通過に通す */
  const w2 = mul(w, w),
    a = add(sub(cx(b.wp2), w2), scl(iw, b.gp)),
    bb = add(sub(cx(b.wh2), w2), scl(iw, b.ga)),
    d = sub(mul(a, bb), cx(b.wc2 * b.wc2)),
    u = div(scl(mul(iw, add(scl(w2, -1), scl(iw, b.ga))), b.Ap), scl(d, b.mp)),
    fc = cvLp(b),
    x = f / fc,
    lp = div(cx(1), cx(1 - x * x, Math.SQRT2 * x));
  let p = mul(scl(mul(iw, u), AIR.rho / (4 * Math.PI * R_MIC)), lp);
  for (const m of b.stat) p = add(p, scl(yMode(m, w), m.G * Math.cos(m.th)));
  return p;
}
