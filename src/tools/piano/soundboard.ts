/**
 * 響板の模型（DOM に依存しない）。ギターの「統計的な胴」（Woodhouse 2004）と同じく、板の理論のモード密度と
 * 平均の駆動点アドミタンスに合う乱数のモードで、駒での力 → 速度（アドミタンス）と 1 m 先の音圧を表す。
 * モードが重なり合う高い周波数（F_TOP より上）は、平均のアドミタンスと放射効率による滑らかな特性で表す
 */
import { C, type Cx, rng } from '../guitar/body';
import { AIR } from './strings';

/** 響板の木材 */
export interface Wood {
  v: string;
  name: string;
  rho: number;
  EL: number;
  ER: number;
}
export const WOODS: readonly Wood[] = [
  { v: 'spruce', name: 'スプルース', rho: 420, EL: 11.5e9, ER: 0.8e9 },
  { v: 'fir', name: 'エゾマツ', rho: 400, EL: 10e9, ER: 0.65e9 },
];
export const woodOf = (v: string): Wood => WOODS.find((w) => w.v === v) ?? WOODS[0];

export interface BoardSpec {
  wood: string;
  /** 面積 [m²]・厚さ [m] */
  area: number;
  h: number;
  /** 最も低いモードの周波数 [Hz]（厚さ 9 mm のスプルースでの実測の値。厚さと木材で変える） */
  f1: number;
}

/* ---------- 模型の定数 ---------- */
/** 響棒（リブ）と駒で、曲げ剛性と質量が増す倍率 */
const RIB_D = 3,
  RIB_M = 1.45;
/** 平均の駆動点アドミタンスのうち、駒の質量と響棒で下がる分（無限板の値に掛ける） */
const KAPPA = 0.15;
/** 平均のアドミタンスが半分になる周波数 [Hz]（駒が重く硬いため、高い周波数で動きにくい） */
const FB = 1500;
/** モードの損失係数（低い周波数）と、高い周波数で増える分 */
const ETA0 = 0.02,
  F_ETA = 3000;
/** 統計的なモードの上限 [Hz] */
export const F_TOP = 1600;
/** 音圧を求める距離 [m] */
export const R_MIC = 1;
/** 放射: 駒の速度に対する板の平均の速度の割合と、放射効率の下限 */
const RAD_K = 0.4,
  SIG0 = 0.03;
/** 低い周波数で、モードの放射の重みがそろう割合 */
const COH = 0.7;
/** 乱数の種 */
const SEED = 19771001;

export interface BoardMode {
  f: number;
  eta: number;
  /** 有効質量 [kg] */
  m: number;
  /** 1 m 先の音圧 ÷ モードの速度 [Pa·s/m] */
  G: number;
}

export interface Board {
  spec: BoardSpec;
  /** 曲げ剛性 [N·m]・面密度 [kg/m²]・平均のモード間隔 [Hz]・無限板の駆動点アドミタンス [s/kg]・一致周波数 [Hz] */
  D: number;
  rhoh: number;
  df: number;
  yInf: number;
  fc: number;
  /** 最も低いモードの周波数 [Hz] */
  f1: number;
  modes: BoardMode[];
  /** 高い周波数の滑らかな特性の大きさ（1 m 先の音圧 ÷ 速度 [Pa·s/m]、F_TOP の 2 倍での値） */
  gHf: number;
  /** 平均のアドミタンスが下がり始める周波数 [Hz] */
  fb: number;
}

const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

/** 平均の駆動点アドミタンスの実部 [s/kg] */
export const yMeanOf = (b: Board, f: number): number => (KAPPA * b.yInf) / Math.sqrt(1 + (f / FB) ** 2);
/** モードより上の滑らかな特性の重み（F_TOP を境目とする 4 次のバターワースの高域通過の大きさ） */
const hfWeight = (f: number) => {
  const x = (f / F_TOP) ** 4;
  return x / Math.sqrt(1 + x * x);
};
/** 放射効率（一致周波数に近づくほど 1 へ） */
const sigma = (b: Board, f: number) => {
  const x = (f / b.fc) ** 1.5;
  return SIG0 + x / (1 + x);
};
/** 平均の放射の重み（音圧 ÷ 速度）の 2 乗平均の平方根 */
const gRms = (b: Board, f: number) =>
  (RAD_K * AIR.rho * AIR.c * Math.sqrt((sigma(b, f) * b.spec.area) / (2 * Math.PI))) / R_MIC;

export function makeBoard(spec: BoardSpec): Board {
  const w = woodOf(spec.wood),
    D = (RIB_D * Math.sqrt(w.EL * w.ER) * spec.h ** 3) / 12,
    rhoh = RIB_M * w.rho * spec.h,
    TAU = 2 * Math.PI;
  const b: Board = {
    spec,
    D,
    rhoh,
    df: 2 / (spec.area * Math.sqrt(rhoh / D)),
    yInf: 1 / (8 * Math.sqrt(D * rhoh)),
    fc: ((AIR.c * AIR.c) / TAU) * Math.sqrt(rhoh / D),
    f1: 0,
    modes: [],
    gHf: 0,
    fb: FB,
  };
  /* 最も低いモード: 実測の値を、板の曲げ波の速さ √(D/ρh) の比（厚さに比例）で変える */
  const ref = woodOf('spruce'),
    sq = (x: Wood, h: number) => Math.sqrt((Math.sqrt(x.EL * x.ER) * h * h) / x.rho);
  b.f1 = spec.f1 * (sq(w, spec.h) / sq(ref, 9e-3));
  /*
   * モードの間隔: 低い周波数では縁の影響でモードが少ない。n(f) = n∞ [1 − 0.75 (P/A) D̃^{1/4} / √(2πf)]
   * （Boutillon・Ege 2013。β は単純支持の −1/2 と固定の −1 の間をとった。周長 P は縦横比 2:1 の長方形とする）
   */
  const P = 3 * Math.sqrt(2 * spec.area),
    dt4 = (D / rhoh) ** 0.25,
    dfAt = (f: number) => b.df / Math.max(0.3, 1 - (0.75 * (P / spec.area) * dt4) / Math.sqrt(TAU * f));
  const r = rng(SEED);
  let f = b.f1;
  while (f < F_TOP) {
    const g = gauss(r),
      dfl = dfAt(f),
      invM = 4 * yMeanOf(b, f) * dfl * Math.max(0.02, g * g);
    /* 一致周波数より下では、駒の周りが一体に動いて放射する分（同じ符号）を足す */
    const bias = COH / (1 + (f / b.fc) ** 2);
    b.modes.push({
      f,
      eta: ETA0 * (1 + f / F_ETA),
      m: 1 / invM,
      G: gRms(b, f) * (bias + Math.sqrt(1 - bias * bias) * gauss(r)),
    });
    f += dfl * (0.65 + 0.7 * r());
  }
  b.gHf = gRms(b, 2 * F_TOP);
  return b;
}

/** モード 1 つのアドミタンス iω / (m (ω_k² − ω² + iω ω_k η)) */
function yMode(m: BoardMode, w: Cx): Cx {
  const wk = 2 * Math.PI * m.f,
    iw = C.cx(-w.im, w.re),
    den = C.add(C.sub(C.cx(wk * wk), C.mul(w, w)), C.scl(iw, wk * m.eta));
  return C.div(iw, C.scl(den, m.m));
}

/**
 * 駒のアドミタンス（速度 ÷ 力） [s/kg]（e^{iωt}、ω は複素数でもよい）。
 * モードの上の周波数は、モードの和に滑らかな平均の実部をつなぐ
 */
export function admittance(b: Board, w: Cx): Cx {
  let y = C.cx(0);
  for (const m of b.modes) y = C.add(y, yMode(m, w));
  const f = w.re / (2 * Math.PI);
  return C.add(y, C.cx(hfWeight(f) * yMeanOf(b, f)));
}

/** 1 m 先の音圧 ÷ 駒の力 [Pa/N]（周波数 f [Hz]、表示用） */
export function pressure(b: Board, f: number): Cx {
  const w = C.cx(2 * Math.PI * f);
  let p = C.cx(0);
  for (const m of b.modes) p = C.add(p, C.scl(yMode(m, w), m.G));
  return C.add(p, C.cx(hfWeight(f) * yMeanOf(b, f) * b.gHf));
}
