/**
 * 響板の模型（DOM に依存しない）。ギターの「統計的な胴」（Woodhouse 2004）と同じく、板の理論のモード密度と
 * 平均の駆動点アドミタンスに合う乱数のモードで、駒での力 → 速度（アドミタンス）と 1 m 先の音圧を表す。
 * モードが重なり合う高い周波数（F_TOP より上）は、平均のアドミタンスと放射効率による滑らかな特性で表す。
 * 放射効率は、響棒（リブ）のある響板の 2 つの領域（Boutillon・Ege 2013）で変える: 低い周波数では板全体が
 * 一様な直交異方性の板として振動し、響棒の間隔が曲げ波の波長に近づく周波数より上では、振動が響棒の間に
 * 閉じ込められて導波路になる。導波路の曲げ波は空気中の音より遅い（亜音速の）まま数 kHz まで続くので、
 * 一様な板なら一致周波数（約 2 kHz）より上で効率よく放射するはずの音が、縁の近くからしか出ない
 */
import { C, type Cx, rng } from '../guitar/body';
import { AIR } from './strings';

/**
 * 響板の木材（L は木目の方向、R は直交の方向）。スプルースは Berthaut がピアノの響板の材で測った値
 * （Ege・Boutillon・Rébillat 2013 の表 1）、エゾマツは概数
 */
export interface Wood {
  v: string;
  name: string;
  rho: number;
  EL: number;
  ER: number;
  /** 剪断弾性率 G_LR [Pa] */
  G: number;
}
export const WOODS: readonly Wood[] = [
  { v: 'spruce', name: 'スプルース', rho: 392, EL: 11.5e9, ER: 0.47e9, G: 0.5e9 },
  { v: 'fir', name: 'エゾマツ', rho: 400, EL: 10e9, ER: 0.65e9, G: 0.5e9 },
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
/** 響棒の間隔 [m]（Boutillon・Ege 2013: ピアノにより平均 10〜18 cm） */
const RIB_P = 0.13;
/** 平均の駆動点アドミタンスのうち、駒の質量と響棒で下がる分（無限板の値に掛ける） */
const KAPPA = 0.15;
/** 平均のアドミタンスが半分になる周波数 [Hz]（駒が重く硬いため、高い周波数で動きにくい） */
const FB = 1500;
/** モードの損失係数（Ege・Boutillon・Rébillat 2013: 数 kHz まで 2 % ± 1 %、周波数による系統的な変化はない） */
const ETA = 0.02;
/** 統計的なモードの上限 [Hz] */
export const F_TOP = 1600;
/** 音圧を求める距離 [m] */
export const R_MIC = 1;
/** 放射の大きさの係数（1 m 先の音圧の中音の大きさを、エネルギーの釣り合いを入れる前の模型にそろえた概数） */
const RAD_C = 0.45;
/** 低い周波数で、モードの放射の重みがそろう割合 */
const COH = 0.7;
/** 板全体の領域から導波路の領域へ移る周波数（響棒の間の導波路が通り始める周波数 f_gs に対する比）と、移り方の鋭さ */
const X_GS = 1.25,
  X_N = 12;
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
  /** 響棒の間の導波路が通り始める周波数 [Hz] と、導波路の曲げ波が空気中の音より速くなる（効率よく放射し始める）周波数 [Hz] */
  fgs: number;
  fsup: number;
  /** 最も低いモードの周波数 [Hz] */
  f1: number;
  modes: BoardMode[];
}

const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

/** 平均の駆動点アドミタンスの実部 [s/kg] */
export const yMeanOf = (b: Board, f: number): number => (KAPPA * b.yInf) / Math.sqrt(1 + (f / FB) ** 2);
/** モードより上の滑らかな特性の重み（F_TOP を境目とする 4 次のバターワースの高域通過の大きさ。駒のアドミタンス） */
const hfWeight = (f: number) => {
  const x = (f / F_TOP) ** 4;
  return x / Math.sqrt(1 + x * x);
};
/**
 * 音圧の 2 つの経路を F_TOP で分ける 4 次の Linkwitz–Riley の低域・高域通過の大きさ（足すと全域通過になる）。
 * モードの経路の F_TOP より上の裾（モードを打ち切ったために残る、質量のような応答）を落とし、
 * 滑らかな特性の経路と打ち消し合わないようにする
 */
export const lrLow = (f: number): number => 1 / (1 + (f / F_TOP) ** 4),
  lrHigh = (f: number): number => 1 - lrLow(f);
/** 周長 [m]（縦横比 2:1 の長方形とする） */
const perimeter = (b: Board) => 3 * Math.sqrt(2 * b.spec.area);
/**
 * 導波路の領域で振動が閉じ込められる部分の、周長 ÷ 面積 [1/m]。駆動点を囲む 3 本の響棒の間（Boutillon・Ege 2013）で、
 * 長さは板の短い辺、響棒（4 本）と両端を縁とする
 */
const guidePA = (b: Board) => {
  const Lg = Math.sqrt(b.spec.area / 2);
  return (4 * Lg + 6 * RIB_P) / (3 * RIB_P * Lg);
};

/**
 * 周長 ÷ 面積が pa [1/m] の平板の、一致周波数 fc に対する放射効率（Maidanik 1962。式の形は Squicciarini・
 * Thompson・Corradi 2015 の式 (18)）。fc より下は、打ち消し合わずに残る縁の近くだけが放射する
 * σ = P c / (4π² A fc) · [(1 − β²) ln((1 + β)/(1 − β)) + 2β] / (1 − β²)^{3/2}（β = √(f/fc)）、
 * 上は σ = 1/√(1 − fc/f)。1 を超えないとする
 */
export function sigmaPlate(f: number, fc: number, pa: number): number {
  if (f >= fc) return Math.min(1, 1 / Math.sqrt(Math.max(1e-9, 1 - fc / f)));
  const b = Math.sqrt(f / fc),
    q = 1 - b * b;
  return Math.min(1, ((pa * AIR.c) / (4 * Math.PI ** 2 * fc)) * ((q * Math.log((1 + b) / (1 - b)) + 2 * b) / q ** 1.5));
}

/**
 * 響棒の間の導波路（幅 RIB_P、響棒を単純支持の線とみなす）を伝わる、第 1 横モードの曲げ波の波数 [rad/m]
 * （Boutillon・Ege 2013 の式 (13)。厚さ h の木の板だけで、響棒は含めない）。導波路が通らない周波数では 0
 */
function guideK(w: Wood, h: number, f: number): number {
  const h3 = h ** 3,
    Dx = (w.EL * h3) / 12,
    Dy = (w.ER * h3) / 12,
    Dxy = (w.G * h3) / 6,
    kx = Math.PI / RIB_P,
    c = w.rho * h * (2 * Math.PI * f) ** 2 - Dx * kx ** 4;
  if (c <= 0) return 0;
  const bb = Dxy * kx * kx;
  return Math.sqrt((-bb + Math.sqrt(bb * bb + Dy * c)) / Dy);
}

/**
 * 響棒の間の導波路が通り始める周波数 f_gs（Boutillon・Ege 2013 の式 (3)）と、導波路の曲げ波が放射できる
 * （波数の響棒の方向の成分が、同じ横の波数を持つ空気中の音の波数より小さい）ようになる周波数（同じく式 (30) との交点）
 */
function guideFreqs(w: Wood, h: number): [number, number] {
  const kx = Math.PI / RIB_P,
    fgs = ((kx * kx) / (2 * Math.PI)) * Math.sqrt((w.EL * h ** 3) / 12 / (w.rho * h));
  for (let f = fgs; f < 20000; f *= 1.005) {
    const ka = (2 * Math.PI * f) / AIR.c;
    if (ka > kx && guideK(w, h, f) < Math.sqrt(ka * ka - kx * kx)) return [fgs, f];
  }
  return [fgs, 20000];
}

/**
 * 響板の放射効率。f_gs の少し上までは、響棒で補強した板全体を一様な板とみなした値（一致周波数 fc）、
 * それより上は、響棒の間の導波路の値（亜音速の波が続き、f_sup で効率よく放射し始める）。
 * 2 つの領域の境目では板全体の一致周波数に近づくので、1〜2 kHz で放射が強まる（Suzuki 1986、Ege ら 2013 の実測）
 */
export function sigma(b: Board, f: number): number {
  const w = 1 / (1 + (f / (X_GS * b.fgs)) ** X_N);
  return w * sigmaPlate(f, b.fc, perimeter(b) / b.spec.area) + (1 - w) * sigmaPlate(f, b.fsup, guidePA(b));
}
/**
 * 有効質量 m（駒での値）のモードの、1 m 先の音圧 ÷ 駒の速度の 2 乗平均の平方根 [Pa·s/m]。板の運動エネルギー
 * ½ m v² = ½ M ⟨v²⟩ から板の平均の速度を求め、放射するパワー W = ρc σ A ⟨v²⟩ を 1 m 先の半球へ広げる
 * （p² = ρc W / (2π r²)）。駒が動きにくい（m が大きい）モードほど、駒の速度に比べて板が大きく揺れる
 */
const gMode = (b: Board, f: number, m: number) =>
  (RAD_C * AIR.rho * AIR.c * Math.sqrt((sigma(b, f) * m) / (2 * Math.PI * b.rhoh))) / R_MIC;

export function makeBoard(spec: BoardSpec): Board {
  const w = woodOf(spec.wood),
    D = (RIB_D * Math.sqrt(w.EL * w.ER) * spec.h ** 3) / 12,
    rhoh = RIB_M * w.rho * spec.h,
    TAU = 2 * Math.PI,
    [fgs, fsup] = guideFreqs(w, spec.h);
  const b: Board = {
    spec,
    D,
    rhoh,
    df: 2 / (spec.area * Math.sqrt(rhoh / D)),
    yInf: 1 / (8 * Math.sqrt(D * rhoh)),
    fc: ((AIR.c * AIR.c) / TAU) * Math.sqrt(rhoh / D),
    fgs,
    fsup,
    f1: 0,
    modes: [],
  };
  /* 最も低いモード: 実測の値を、板の曲げ波の速さ √(D/ρh) の比（厚さに比例）で変える */
  const ref = woodOf('spruce'),
    sq = (x: Wood, h: number) => Math.sqrt((Math.sqrt(x.EL * x.ER) * h * h) / x.rho);
  b.f1 = spec.f1 * (sq(w, spec.h) / sq(ref, 9e-3));
  /*
   * モードの間隔: 低い周波数では縁の影響でモードが少ない。n(f) = n∞ [1 − 0.75 (P/A) D̃^{1/4} / √(2πf)]
   * （Boutillon・Ege 2013。β は単純支持の −1/2 と固定の −1 の間をとった）
   */
  const P = perimeter(b),
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
      eta: ETA,
      m: 1 / invM,
      G: gMode(b, f, 1 / invM) * (bias + Math.sqrt(1 - bias * bias) * gauss(r)),
    });
    f += dfl * (0.65 + 0.7 * r());
  }
  return b;
}

/**
 * モードより上の滑らかな特性: 1 m 先の音圧 ÷ 駒の力 [Pa/N]（位相を除いた大きさ）。統計的エネルギー解析
 * （Lyon・DeJong 1995）の釣り合い: 駒から入るパワー |F|² Re Y が板の損失 ω η M ⟨v²⟩ と等しく、放射は W = ρc σ A ⟨v²⟩
 * なので p² = (ρc)² σ Re Y |F|² / (2π r² ω η ρh)。モードの和の帯域の平均もこれと同じになる。
 * 高い周波数ほど板のエネルギーが速く失われ（損失は ω η に比例）、木の板そのものが高い音を弱める
 */
export const hfPressure = (b: Board, f: number): number =>
  (lrHigh(f) *
    RAD_C *
    AIR.rho *
    AIR.c *
    Math.sqrt((sigma(b, f) * yMeanOf(b, f)) / (2 * Math.PI * (2 * Math.PI * f) * ETA * b.rhoh))) /
  R_MIC;

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
  return C.add(C.scl(p, lrLow(f)), C.cx(hfPressure(b, f)));
}
