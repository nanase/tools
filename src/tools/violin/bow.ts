/**
 * 弓と弦の摩擦（DOM に依存しない）。
 * 弦の弓の位置の速度 v と摩擦力 f は、弦の応答の直線 v = v_h + G f（v_h は力がないときの速度、G は 1 標本の間に
 * 力 1 N が生む速度）と、摩擦の特性との交点で決まる（Friedlander 1953 の作図。McIntyre・Schumacher・Woodhouse 1983）。
 * 交点が 3 つあるときは、いまいる枝（固着か滑り）に留まれる限り留まる（履歴の規則）
 */

/** 松脂の摩擦係数: 静止のとき・十分に速く滑るとき */
export const MU_S = 1.2,
  MU_INF = 0.35;
/**
 * 滑り速度 s [m/s]（≥ 0）の摩擦係数。定常の滑りの測定への当てはめ（Smith・Woodhouse 2000）:
 * μ = 0.4 e^{−s/0.01} + 0.45 e^{−s/0.1} + 0.35
 */
export const mu = (s: number): number => 0.4 * Math.exp(-s / 0.01) + 0.45 * Math.exp(-s / 0.1) + MU_INF;

/**
 * h(s) = s + d + c μ(s) = 0 の、s > 0 の最大の根（滑りの枝の交点）。なければ −1。
 * μ は下に凸で減るので h も下に凸で、根は多くて 2 つ。大きいほうが安定な滑りで、右から Newton 法で下りる
 */
export function slipRoot(d: number, c: number): number {
  /* μ ≥ μ_inf なので、根は −d − c μ_inf より右にはない */
  let s = -d - c * MU_INF;
  if (s <= 0) return -1;
  for (let i = 0; i < 40; i++) {
    const e1 = Math.exp(-s / 0.01),
      e2 = Math.exp(-s / 0.1),
      h = s + d + c * (0.4 * e1 + 0.45 * e2 + MU_INF),
      dh = 1 - c * (40 * e1 + 4.5 * e2);
    if (dh <= 0) return -1;
    const ds = h / dh;
    s -= ds;
    if (s <= 0) return -1;
    if (ds < 1e-9) return s;
  }
  return s;
}

/** 摩擦の状態: 0 = 固着、−1 = 弦が弓より遅い向きの滑り、1 = 弦が弓より速い向きの滑り */
export type Slip = -1 | 0 | 1;

/** 交点: 弦が受ける力 f [N]（弓の進む向きが正）と、次の状態 */
export interface Contact {
  f: number;
  state: Slip;
}

/**
 * 摩擦曲線と履歴の規則で、交点を求める。d = v_h − v_b（力がないときの、弓に対する弦の速度）、
 * G は応答の直線の傾き [m/(s·N)]、fn は弓圧 [N]、state はいまの状態。結果を out に書く
 */
export function solveCurve(d: number, G: number, fn: number, state: Slip, out: Contact): void {
  if (fn <= 0) {
    out.f = 0;
    out.state = d < 0 ? -1 : 1;
    return;
  }
  const c = G * fn,
    /* 固着に要る力 */
    fs = -d / G,
    lim = MU_S * fn;
  if (state === 0 && Math.abs(fs) <= lim) {
    out.f = fs;
    out.state = 0;
    return;
  }
  /* 滑りの向き: いま滑っているならその向き、固着から外れたなら力の足りない向き */
  const dir: Slip = state !== 0 ? state : fs > 0 ? -1 : 1,
    s = dir < 0 ? slipRoot(d, c) : slipRoot(-d, c);
  if (s > 0) {
    out.f = -dir * fn * mu(s);
    out.state = dir;
    return;
  }
  if (Math.abs(fs) <= lim) {
    out.f = fs;
    out.state = 0;
    return;
  }
  /* 逆向きの滑りへ */
  const s2 = dir < 0 ? slipRoot(-d, c) : slipRoot(d, c);
  out.f = s2 > 0 ? dir * fn * mu(s2) : Math.sign(fs) * lim;
  out.state = (s2 > 0 ? -dir : dir) as Slip;
}

/* ---------- 熱の模型（Woodhouse 2003） ---------- */
/**
 * 摩擦係数を、滑りの速さでなく接触の温度 T（周囲からの上昇 [K]）の関数とする。Woodhouse (2003) の図 3
 * （定常の滑りの測定を温度の関数に直したもの）を 2.5 K ごとに読んだ値
 */
const MU_T = [
  1.2, 1.2, 1.19, 1.17, 1.15, 1.12, 1.08, 1.03, 0.96, 0.88, 0.795, 0.73, 0.68, 0.64, 0.586, 0.5, 0.425, 0.39, 0.372,
  0.365, 0.359, 0.355, 0.353, 0.351, 0.35,
];
export function muT(T: number): number {
  const x = Math.max(0, T) / 2.5,
    i = Math.floor(x);
  if (i >= MU_T.length - 1) return MU_T[MU_T.length - 1];
  return MU_T[i] + (x - i) * (MU_T[i + 1] - MU_T[i]);
}

/**
 * 熱の釣り合い（Woodhouse 2003 の式 (1)、Smith・Woodhouse 2000）:
 *   f v = ∫ g(t − τ) T(τ) dτ + v a δ ρ_r c_r T + ρ_r π a² δ c_r dT/dt
 * 左辺は摩擦の発熱、右辺は両側の固体への伝導、流れ込む松脂が運ぶ熱、接触部の蓄熱。
 * 伝導の核は半無限の固体の離散形 g_0 = 2λ/√h、g_n = 2λ/√h (√(n+1) − 2√n + √(n−1))、λ = A λ0 / √π
 * （A = π a² は接触の面積、λ0 = √(K ρ c)）。近い K0 刻みはこの式のまま、それより古い部分は
 * g ≈ −(λ/2) t^{−3/2} を指数関数の和で近似して漸化式にする。弓の毛の側は、滑ると新しい毛が入るので、
 * 滑った距離 8a/(3π) で履歴を忘れる（Smith・Woodhouse 2000 の打ち切りを指数関数にしたもの）
 */
const RHO_C_ROSIN = 1010 * 250,
  /** 変形する層の厚さ [m]・1 N のときの接触の半径 [m]（Woodhouse 2003 の表 I） */
  DELTA = 1e-6,
  A1N = 250e-6,
  /** λ0 = √(K ρ c) [W s^½ /(m² K)]: 弦・弓（表 I） */
  LAM_STR = 2050,
  LAM_BOW = 450;
const K0 = 6;
/** 指数関数の和: 時定数 20 µs〜4 s、1 桁に 3 個 */
const TAUS = Array.from({ length: 17 }, (_, m) => 2e-5 * 10 ** (m / 3)),
  DLN = Math.log(10) / 3,
  W_SOE = TAUS.map((t) => (DLN * t ** -1.5) / 0.886227);
const GN = Array.from({ length: K0 + 1 }, (_, n) =>
  n === 0 ? 1 : Math.sqrt(n + 1) - 2 * Math.sqrt(n) + Math.sqrt(n - 1),
);

/** 接触の温度の状態 */
export class Thermal {
  /** 接触の温度上昇 [K] */
  T = 0;
  /* 直近の温度（[0] が最新）: 弦の側・弓の側（弓の側は滑った分だけ薄めてある） */
  private hs = new Float64Array(K0);
  private hb = new Float64Array(K0);
  /* 指数関数の和の状態 */
  private ss = new Float64Array(TAUS.length);
  private sb = new Float64Array(TAUS.length);
  private h = 0;
  private dec = new Float64Array(TAUS.length);
  private ent = new Float64Array(TAUS.length);

  /** 刻み h [s] を変えたときに係数を作り直す */
  private setH(h: number): void {
    this.h = h;
    TAUS.forEach((t, m) => {
      this.dec[m] = Math.exp(-h / t);
      this.ent[m] = h * Math.exp((-(K0 + 1) * h) / t);
    });
  }

  reset(): void {
    this.T = 0;
    this.hs.fill(0);
    this.hb.fill(0);
    this.ss.fill(0);
    this.sb.fill(0);
  }

  /**
   * 1 刻み h [s] 進める。fn は弓圧 [N]、q は摩擦の発熱 |f Δv| [W]、dv は滑りの速さ |Δv| [m/s]
   */
  step(h: number, fn: number, q: number, dv: number): void {
    if (h !== this.h) this.setH(h);
    const { hs, hb, ss, sb, dec, ent } = this;
    /* 弓が離れているあいだは、接触の大きさを 0.05 N のときで代える（冷えていく） */
    const a = A1N * Math.sqrt(Math.max(fn, 0.05)),
      area = Math.PI * a * a,
      ls = (area * LAM_STR) / Math.sqrt(Math.PI),
      lb = (area * LAM_BOW) / Math.sqrt(Math.PI),
      rs = 2 / Math.sqrt(h),
      /* 弓の側の履歴を薄める割合 */
      fade = Math.exp((-dv * h) / ((8 * a) / (3 * Math.PI)));
    /* いまの温度を直近の履歴へ入れ、一番古い直近の値を指数関数の和へ移す */
    const os = hs[K0 - 1],
      ob = hb[K0 - 1];
    for (let m = 0; m < ss.length; m++) {
      ss[m] = dec[m] * ss[m] + ent[m] * os;
      sb[m] = fade * (dec[m] * sb[m] + ent[m] * ob);
    }
    for (let n = K0 - 1; n > 0; n--) {
      hs[n] = hs[n - 1];
      hb[n] = fade * hb[n - 1];
    }
    hs[0] = this.T;
    hb[0] = this.T;
    /* 履歴による伝導（g_n は n ≥ 1 で負） */
    let hist = 0;
    for (let n = 1; n <= K0; n++) hist += rs * GN[n] * (ls * hs[n - 1] + lb * hb[n - 1]);
    let tail = 0;
    for (let m = 0; m < ss.length; m++) tail += W_SOE[m] * (ls * ss[m] + lb * sb[m]);
    hist -= 0.5 * tail;
    const C = (RHO_C_ROSIN * area * DELTA) / h,
      Tn = (C * this.T + q - hist) / (C + rs * (ls + lb) + dv * a * DELTA * RHO_C_ROSIN);
    this.T = Math.max(0, Tn);
  }
}

/**
 * 熱の模型での交点。摩擦力の限界は弓圧 × μ(T) で、滑っている間の力は限界の値（向きは滑りと逆）。
 * 交点は常に 1 つに決まり、履歴の規則は要らない（Woodhouse 2003）
 */
export function solveThermal(d: number, G: number, fn: number, mu: number, out: Contact): void {
  const fs = -d / G,
    lim = mu * Math.max(0, fn);
  if (Math.abs(fs) <= lim) {
    out.f = fs;
    out.state = 0;
  } else {
    out.f = fs > 0 ? lim : -lim;
    out.state = fs > 0 ? -1 : 1;
  }
}
