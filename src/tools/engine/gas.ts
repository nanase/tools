/**
 * エンジンの気体の計算の部品（DOM に依存しない）。弁や絞りを通る圧縮性の流れと、その流れで容器（シリンダや大気）と
 * 管の端（デジタル導波管）をつなぐ境界の解き方。
 * 管の中は「圧力 p と質量流量 ṁ」で表し、進む波 w⁺・戻る波 w⁻ で p = pm + w⁺ + w⁻、ṁ = (w⁺ − w⁻) / zc とする。
 * zc = c / A は質量流量に対する波のインピーダンスで、密度を含まない（ρc/A の体積流量の形と同じ式になる）
 */

/** 空気（と燃焼ガス）の気体定数 [J/(kg·K)] */
export const R_GAS = 287;
/** 大気圧 [Pa]・外気温 [K] */
export const P_ATM = 101325;
export const T_ATM = 298;
/** 外の空気の密度 [kg/m³] */
export const RHO_ATM = P_ATM / (R_GAS * T_ATM);

/**
 * 比熱比の温度による変化。Brunt・Rai・Emtage (1998) が熱発生の解析に使った式
 * γ = 1.338 − 6.0×10⁻⁵ T + 1.0×10⁻⁸ T²（新気と燃焼ガスをまとめた近似）
 */
export function gammaOf(T: number): number {
  return 1.338 - 6.0e-5 * T + 1.0e-8 * T * T;
}

/**
 * 絞り（弁・スロットル）を通る圧縮性の等エントロピー流れ。ṁ = A p_u / √(R T_u) · Φ(p_d / p_u)。
 * Φ は圧力比 r が臨界圧力比より小さいとチョーク（一定）。r → 1 では傾きが無限大になって境界の Newton 法が
 * 迷うので、1 − r < EPS の範囲だけ直線で 0 につなぐ（差圧が 0.1 % 未満の流れはごく小さい）
 */
export class Orifice {
  private readonly g: number;
  private readonly k: number;
  private readonly rc: number;
  private readonly phiC: number;
  private readonly phiE: number;
  private static readonly EPS = 1e-3;
  /** 最後に呼んだ flow() の dṁ/dp_pipe */
  dm = 0;

  constructor(gamma: number) {
    const g = gamma;
    this.g = g;
    this.k = (2 * g) / (g - 1);
    this.rc = (2 / (g + 1)) ** (g / (g - 1));
    this.phiC = Math.sqrt(g) * (2 / (g + 1)) ** ((g + 1) / (2 * (g - 1)));
    this.phiE = this.phiSub(1 - Orifice.EPS);
  }

  private phiSub(r: number): number {
    const a = r ** (2 / this.g);
    return Math.sqrt(Math.max(0, this.k * (a - a * r ** ((this.g - 1) / this.g))));
  }

  /** Φ(r) と dΦ/dr を f・d に入れる（標本ごとに呼ぶので配列を作らない） */
  private f = 0;
  private d = 0;
  private phi(r: number): void {
    if (r <= this.rc) {
      this.f = this.phiC;
      this.d = 0;
      return;
    }
    const e = Orifice.EPS;
    if (r >= 1 - e) {
      this.f = (this.phiE * (1 - r)) / e;
      this.d = -this.phiE / e;
      return;
    }
    const g = this.g,
      a = r ** (2 / g),
      b = a * r ** ((g - 1) / g),
      f = Math.sqrt(this.k * (a - b));
    this.f = f;
    this.d = (this.k * ((2 / g) * (a / r) - ((g + 1) / g) * (b / r))) / (2 * f);
  }

  /**
   * 容器（p1・T1）から管の端（pp・Tp）へ、有効面積 A（流量係数を掛けたもの）を通る質量流量 [kg/s]。
   * 逆向きの流れは負。dm に dṁ/dpp を入れる
   */
  flow(A: number, p1: number, T1: number, pp: number, Tp: number): number {
    if (p1 >= pp) {
      const s = A / Math.sqrt(R_GAS * T1);
      this.phi(pp / p1);
      this.dm = s * this.d;
      return s * p1 * this.f;
    }
    const s = A / Math.sqrt(R_GAS * Tp),
      r = p1 / pp;
    this.phi(r);
    this.dm = -s * (this.f - r * this.d);
    return -s * pp * this.f;
  }
}

/** solveEnd の結果 */
export interface EndState {
  /** 管の端の圧力 [Pa]（次の標本の初期値にも使う） */
  pe: number;
  /** 容器から管へ入る質量流量 [kg/s] */
  m: number;
}

/**
 * 容器（p1・T1）と管の端を絞りでつないだ境界を解く。管から端へ来る波 w、管の基準の圧力 pm、
 * 波のインピーダンス zc のとき、端の圧力 pe は pe = pm + 2w + zc·ṁ(pe) を満たす（ṁ は容器 → 管）。
 * 左辺 − 右辺は pe について単調に増えるので、pm + 2w と p1 の間に根が 1 つあり、そこで Newton 法を
 * 二分法で守って解く。出ていく波は pe − pm − w
 */
export function solveEnd(
  o: Orifice,
  A: number,
  p1: number,
  T1: number,
  w: number,
  pm: number,
  zc: number,
  Tp: number,
  st: EndState,
): void {
  const p0 = pm + 2 * w;
  if (A <= 0) {
    st.pe = p0;
    st.m = 0;
    return;
  }
  let lo = Math.min(p0, p1),
    hi = Math.max(p0, p1),
    p = Math.min(hi, Math.max(lo, st.pe)),
    m = o.flow(A, p1, T1, p, Tp);
  for (let i = 0; i < 30; i++) {
    const g = p - p0 - zc * m;
    if (Math.abs(g) < 1e-3) break;
    if (g > 0) hi = p;
    else lo = p;
    let q = p - g / (1 - zc * o.dm);
    if (!(q > lo && q < hi)) q = 0.5 * (lo + hi);
    p = q;
    m = o.flow(A, p1, T1, p, Tp);
    if (hi - lo < 1e-6) break;
  }
  st.pe = p;
  st.m = m;
}
