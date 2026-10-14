/**
 * 胴と駒の模型（DOM に依存しない）。弦が駒の上端を押す力から、駒の上端の速度（アドミタンス）と、
 * 離れた点の音圧（放射）を求める。
 *
 * 胴は振動モードの和で表す。600 Hz より下は、どのヴァイオリンにもある「シグネチャモード」
 * （A0・CBR・B1−・B1+）を Bissinger (2008, 2012) の平均の周波数・減衰・放射の強さで置く。
 * その上は、平均の間隔と平均のアドミタンスに合う乱数のモードで表す（Woodhouse の統計的な扱い）。
 * 駒は Woodhouse の 2 つの模型を合わせたもの（Euphonics 7.5.1）: 上部の慣性とねじりのばねで 2 つの足を逆向きに
 * 押す揺れ（rocking）と、質量とばねで 2 つの足を同じ向きに押す上下の動き（bouncing）。
 * 駒と胴をつないだ系の固有モードを先に求めておき、音を作る側は独立な共振器の和として回す
 */

/** 空気: 密度 [kg/m³]・音速 [m/s] */
export const AIR = { rho: 1.2, c: 343 } as const;
/** 音圧を求める距離 [m]（Bissinger の測定の球面の半径） */
export const R_MIC = 1.2;

/** 複素数 */
export interface Cx {
  re: number;
  im: number;
}

export interface BodySpec {
  /** 駒の揺れ: 足を固定したときの共振 [Hz] と、上部の慣性モーメント [kg·m²] */
  fRock: number;
  inertia: number;
  /** 駒の上下の動き: 足を固定したときの共振 [Hz] と、質量 [kg] */
  fBounce: number;
  mBounce: number;
  /** 弱音器の質量 [kg]（駒の上端に載せる） */
  mute: number;
  /** 構え方（0 = 支えなしの測定の減衰、1 = 奏者が構えたときの減衰） */
  hold: number;
  /** 乱数の種（楽器の個体） */
  seed: number;
}
/**
 * 駒の値は Euphonics 7.5・7.5.1 の当てはめ（揺れ 2.9 kHz・4.3×10⁻⁷ kg·m²）と Reinicke の測定（揺れ約 3 kHz・
 * 上下約 6 kHz）による。上下の動きの質量は、Euphonics 7.5 の図 17 の垂直のアドミタンスの 7 kHz より上の値から求めた
 */
export const BODY_DEFAULT: BodySpec = {
  fRock: 3000,
  inertia: 4.3e-7,
  fBounce: 6000,
  mBounce: 1.5e-3,
  mute: 0,
  hold: 1,
  seed: 40,
};

/** 駒: 揺れの回転の中心から上端までの長さ [m]・足の間隔 [m]（Euphonics 7.5.1） */
export const BRIDGE = { L: 0.0195, d: 0.03 } as const;
/** 駒そのものの減衰比（木の内部の損失） */
const Z_BRIDGE = 0.01;
/**
 * 弦（0 = E 線 … 3 = G 線）の弓の向きの、水平からの傾き [rad]。駒の上端の曲線（半径 42 mm）の接線で、
 * 外側の弦は約 24°、内側の弦は約 8°。水平は E 線の向き、垂直は下向きを正とする
 */
const TILT = [24.3, 7.9, -7.9, -24.3].map((d) => (d * Math.PI) / 180);
/** 弦 si の弓の向きの力の、水平・垂直の成分の割合 */
export const stringDir = (si: number): [number, number] => [Math.cos(TILT[si]), Math.sin(TILT[si])];

/* ---------- シグネチャモード ---------- */
interface Sig {
  name: string;
  /** 周波数 [Hz]（Bissinger 2008 の 17 挺の平均） */
  f: number;
  /** 減衰比: 支えなし（Bissinger 2012）・奏者が構えたとき（Marshall 1986、Bissinger 2013 の引用） */
  zFree: number;
  zHeld: number;
  /** 駒の上端の水平のアドミタンスの山の高さ [s/kg]（支えなし。Euphonics 5.3 の図 7 から読んだ値） */
  yPk: number;
  /** 球面平均の音圧 ÷ 力の山の高さ [Pa/N]（支えなし、1.2 m。Bissinger 2012）。A0 は和の規則から決める */
  rPk: number;
}
const SIG: readonly Sig[] = [
  { name: 'A0', f: 275, zFree: 0.025, zHeld: 0.0239, yPk: 10 ** (-30 / 20), rPk: Number.NaN },
  { name: 'CBR', f: 407, zFree: 0.0129, zHeld: 0.02, yPk: 10 ** (-22 / 20), rPk: 0 },
  { name: 'B1-', f: 475, zFree: 0.0122, zHeld: 0.0199, yPk: 10 ** (-15.5 / 20), rPk: 1.01 },
  { name: 'B1+', f: 541, zFree: 0.0115, zHeld: 0.0399, yPk: 10 ** (-14.5 / 20), rPk: 0.95 },
];
/** シグネチャモードの、高音側の足（魂柱の近く）の動き ÷ 低音側の足の動き（Euphonics 7.5 の図 5 から読んだ目安） */
const SIG_TREBLE = 0.25;

/* ---------- 統計的なモード ---------- */
/** 範囲 [Hz] と平均の間隔 [Hz]（Weinreich 1997 の見積り 44 Hz と、Bissinger 2012 の数えた値の間） */
const F_STAT0 = 760,
  F_TOP = 10000,
  DF = 55;
/** 足の位置の平均のアドミタンス [s/kg]（低音側・高音側。Euphonics 7.5 の図 5 から読んだ傾き） */
const yBass = (f: number) => 0.022 / Math.sqrt(1 + (f / 4000) ** 2),
  yTreble = (f: number) => 0.03 * Math.sqrt(1 + (f / 3500) ** 2);
/**
 * 減衰比: 支えなしは 1.5 kHz まで Q ≈ 33（典型的な胴のモードの Q は 25〜50。Gough 2016。モードの重なりが
 * 1〜2 kHz で 1 を超えるという Woodhouse 2014 の記述にも合う）。その上は ζ ∝ f^−0.34 で減る（Bissinger 2012）。
 * 構えると低い周波数ほど増える（指数 −0.88。Bissinger 2013）
 */
const zFree = (f: number) => 0.015 * Math.min(1, (f / 1500) ** -0.34),
  zHeld = (f: number) => Math.max(zFree(f), 0.03 * (f / 500) ** -0.88);
/**
 * 放射効率: 臨界周波数（14 挺の平均）より上は 1。下の傾きは、Bissinger 2008 の図 2 の帯域の平均の比
 * ⟨R⟩/⟨Y⟩ が 625 Hz から 3.9 kHz で約 2 倍になることに合わせる（平板の式の f² よりゆるい）
 */
const F_CRIT = 3900;
const sigma = (f: number) => Math.min(1, (f / F_CRIT) ** 0.9);
/** 放射する面の面積 [m²]（Bissinger 2012）と、振動する殻の質量 [kg]（表板・裏板・横板。Jansson の目安） */
const S_RAD = 0.13,
  M_SHELL = 0.21;
/** 統計的なモードの放射の大きさの補正（0.6〜3.9 kHz の帯域の平均を Bissinger 2008 の図 2 に合わせる） */
const RAD_CAL = 0.94;

/** 駒と結合したあとのモード */
export interface Body {
  spec: BodySpec;
  n: number;
  /** 角周波数 [rad/s]・減衰比 */
  w: Float64Array;
  z: Float64Array;
  /** 駒の上端の水平・垂直の力がモードを押す係数 [1/√kg]（モードの速度 → 上端の速度の係数も同じ） */
  aH: Float64Array;
  aV: Float64Array;
  /** モードの速度 → 音圧 [Pa·s·√kg/m]（向きの違う 2 点。左・右の出力に使う） */
  gL: Float64Array;
  gR: Float64Array;
  /** モードの加速度 → 音圧（体積の変化による単極子の放射。どの向きにも同じ） */
  m: Float64Array;
  /** 結合する前のモード（表示・確認用）: 周波数 [Hz]・減衰比・足の動き [1/√kg]（低音側・高音側） */
  raw: { name: string; f: number; z: number; u1: number; u2: number }[];
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

const TAU = 2 * Math.PI;

/**
 * 質量で正規化した対角の系 diag(d) に、ばね k と結合のベクトル v の剛性 k v vᵀ を足したときの固有値と、
 * 付いてくるベクトルの変換。d は昇順で、互いに異なること。
 * 固有値は 1 + k Σ v_i² / (d_i − λ) = 0 の根で、隣り合う d_i の間に 1 つずつ、最後の 1 つは最大の d より上にある。
 * 固有ベクトルは x_i ∝ v_i / (d_i − λ)。vecs の各ベクトル w は Σ_i x_i w_i に、diag の各対角（減衰など）は
 * Σ_i x_i² c_i に移る
 */
function rankOne(
  d: number[],
  v: number[],
  k: number,
  vecs: number[][],
  diag: number[][],
): { d: number[]; vecs: number[][]; diag: number[][] } {
  const n = d.length,
    sec = (lam: number) => {
      let s = 1;
      for (let i = 0; i < n; i++) s += (k * v[i] * v[i]) / (d[i] - lam);
      return s;
    };
  let vsum = 0;
  for (const x of v) vsum += x * x;
  const out = {
      d: new Array<number>(n),
      vecs: vecs.map(() => new Array<number>(n)),
      diag: diag.map(() => new Array<number>(n)),
    },
    x = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const lo0 = d[j],
      hi0 = j + 1 < n ? d[j + 1] : d[n - 1] + k * vsum;
    let lo = lo0 + 1e-10 * (hi0 - lo0),
      hi = hi0 - 1e-10 * (hi0 - lo0);
    for (let it = 0; it < 90; it++) {
      const mid = 0.5 * (lo + hi);
      if (sec(mid) < 0) lo = mid;
      else hi = mid;
    }
    const lam = 0.5 * (lo + hi);
    let nrm = 0;
    for (let i = 0; i < n; i++) {
      x[i] = v[i] / (d[i] - lam);
      nrm += x[i] * x[i];
    }
    nrm = 1 / Math.sqrt(nrm);
    for (let i = 0; i < n; i++) x[i] *= nrm;
    out.d[j] = lam;
    vecs.forEach((w, q) => {
      let s = 0;
      for (let i = 0; i < n; i++) s += x[i] * w[i];
      out.vecs[q][j] = s;
    });
    diag.forEach((c, q) => {
      let s = 0;
      for (let i = 0; i < n; i++) s += x[i] * x[i] * c[i];
      out.diag[q][j] = s;
    });
  }
  return out;
}

/** 胴の模型を作る */
export function makeBody(spec: BodySpec): Body {
  const { L, d } = BRIDGE,
    h = Math.min(1, Math.max(0, spec.hold)),
    lever = L / d,
    dsig = 1 - SIG_TREBLE;
  /* 結合する前のモード: 角周波数²・減衰率 2ζω・足の動き（低音側・高音側）・放射（速度 → 音圧 2 方向、加速度 → 音圧） */
  const w2: number[] = [],
    c: number[] = [],
    u1: number[] = [],
    u2: number[] = [],
    gl: number[] = [],
    gr: number[] = [],
    mo: number[] = [],
    raw: Body['raw'] = [];

  /*
   * シグネチャモード。駒が剛体として働く低い周波数では、上端の水平のアドミタンスの山は (L/d)² Δu² / (2ζω)、
   * 音圧の山は ρ V (L/d) Δu / (8π r ζ)（Δu は 2 つの足の動きの差、V はモードの体積の変化）。ここから Δu と V を
   * 決める。A0 の V は、周波数 0 で体積の変化の和が 0 になる条件（f 孔の空気が胴の体積の変化を打ち消す。
   * Weinreich 1985 の和の規則）から決める
   */
  let sum = 0;
  const vol: number[] = [];
  for (const s of SIG) {
    const w = TAU * s.f,
      du = Math.sqrt((s.yPk * 2 * s.zFree * w) / (lever * lever)),
      v = Number.isNaN(s.rPk) ? Number.NaN : (s.rPk * 8 * Math.PI * R_MIC * s.zFree) / (AIR.rho * lever * du),
      z = s.zFree + h * (s.zHeld - s.zFree);
    if (!Number.isNaN(v)) sum += (v * du) / (w * w);
    vol.push(v);
    w2.push(w * w);
    c.push(2 * z * w);
    u1.push(du / dsig);
    u2.push((SIG_TREBLE * du) / dsig);
    raw.push({ name: s.name, f: s.f, z, u1: du / dsig, u2: (SIG_TREBLE * du) / dsig });
  }
  SIG.forEach((s, i) => {
    const w = TAU * s.f,
      du = u1[i] - u2[i],
      v = Number.isNaN(vol[i]) ? (-sum * w * w) / du : vol[i];
    gl.push(0);
    gr.push(0);
    mo.push((AIR.rho * v) / (4 * Math.PI * R_MIC));
  });

  /* 統計的なモード: 足の動きは平均のアドミタンスに合う正規分布、放射は放射効率に合う正規分布 */
  const r = rng(spec.seed);
  let f = F_STAT0;
  while (f < F_TOP) {
    const w = TAU * f,
      a1 = Math.sqrt(4 * DF * yBass(f)) * gauss(r),
      a2 = Math.sqrt(4 * DF * yTreble(f)) * gauss(r),
      g0 = (RAD_CAL * AIR.rho * AIR.c * Math.sqrt((sigma(f) * S_RAD) / (4 * Math.PI * M_SHELL))) / R_MIC,
      z = zFree(f) + h * (zHeld(f) - zFree(f));
    w2.push(w * w);
    c.push(2 * z * w);
    u1.push(a1);
    u2.push(a2);
    gl.push(g0 * gauss(r));
    gr.push(g0 * gauss(r));
    mo.push(0);
    raw.push({ name: '', f, z, u1: a1, u2: a2 });
    f += DF * (0.6 + 0.8 * r());
  }

  /*
   * 駒の揺れとの結合。座標は (√I θ, q_1 … q_N)。ばね K は、駒の上部の回転 θ と表板の回転 Σ φ_k q_k
   * （φ = (u2 − u1) / d。水平の力が E 線の向きのとき、高音側の足が下がる向きを正）の差で伸びる
   */
  const I = spec.inertia + spec.mute * L * L,
    K = spec.inertia * (TAU * spec.fRock) ** 2,
    phi = u1.map((a, i) => (u2[i] - a) / d),
    ubar = u1.map((a, i) => 0.5 * (a + u2[i])),
    N = w2.length,
    zeros = new Array<number>(N).fill(0);
  const s1 = rankOne(
    [0, ...w2],
    [1 / Math.sqrt(I), ...phi.map((p) => -p)],
    K,
    /* 水平の力の入口・上下の動きの結合・放射 */
    [
      [L / Math.sqrt(I), ...zeros],
      [0, ...ubar],
      [0, ...gl],
      [0, ...gr],
      [0, ...mo],
    ],
    [[2 * Z_BRIDGE * TAU * spec.fRock, ...c]],
  );
  /* 駒の上下の動きとの結合。座標は (√m z, …)。ばね k は、質量の変位 z と 2 つの足の平均の変位の差で伸びる */
  const mv = spec.mBounce + spec.mute,
    kv = spec.mBounce * (TAU * spec.fBounce) ** 2,
    z0 = new Array<number>(N + 1).fill(0);
  const s2 = rankOne(
    [0, ...s1.d],
    [1 / Math.sqrt(mv), ...s1.vecs[1].map((p) => -p)],
    kv,
    [
      [0, ...s1.vecs[0]],
      [1 / Math.sqrt(mv), ...z0],
      [0, ...s1.vecs[2]],
      [0, ...s1.vecs[3]],
      [0, ...s1.vecs[4]],
    ],
    [[2 * Z_BRIDGE * TAU * spec.fBounce, ...s1.diag[0]]],
  );
  const n = N + 2,
    w = Float64Array.from(s2.d, Math.sqrt);
  return {
    spec,
    n,
    w,
    z: Float64Array.from(s2.diag[0], (x, j) => x / (2 * w[j])),
    aH: Float64Array.from(s2.vecs[0]),
    aV: Float64Array.from(s2.vecs[1]),
    gL: Float64Array.from(s2.vecs[2]),
    gR: Float64Array.from(s2.vecs[3]),
    m: Float64Array.from(s2.vecs[4]),
    raw,
  };
}

/** モード 1 つの応答 iω / (ω_j² − ω² + 2iζ ω_j ω) */
function resp(b: Body, j: number, w: number): Cx {
  const re = b.w[j] * b.w[j] - w * w,
    im = 2 * b.z[j] * b.w[j] * w,
    den = re * re + im * im;
  return { re: (w * im) / den, im: (w * re) / den };
}

/**
 * 駒の上端のアドミタンス（速度 ÷ 力） [s/kg]。力と速度の向きを、それぞれ [水平, 垂直] の成分の割合で渡す
 * （既定は水平の力・水平の速度）
 */
export function yTop(b: Body, f: number, df: readonly [number, number] = [1, 0], dv = df): Cx {
  const w = TAU * f;
  let re = 0,
    im = 0;
  for (let j = 0; j < b.n; j++) {
    const h = resp(b, j, w),
      k = (df[0] * b.aH[j] + df[1] * b.aV[j]) * (dv[0] * b.aH[j] + dv[1] * b.aV[j]);
    re += k * h.re;
    im += k * h.im;
  }
  return { re, im };
}

/** 音圧 ÷ 駒の上端の力 [Pa/N]（ch 0 = 左、1 = 右。力の向きは [水平, 垂直] の成分の割合） */
export function radiation(b: Body, f: number, ch: 0 | 1, df: readonly [number, number] = [1, 0]): Cx {
  const w = TAU * f,
    g = ch ? b.gR : b.gL;
  let re = 0,
    im = 0;
  for (let j = 0; j < b.n; j++) {
    const h = resp(b, j, w),
      a = df[0] * b.aH[j] + df[1] * b.aV[j],
      /* 速度の係数 g と、加速度の係数 m（iω を掛ける） */
      cr = a * g[j],
      ci = a * b.m[j] * w;
    re += cr * h.re - ci * h.im;
    im += cr * h.im + ci * h.re;
  }
  return { re, im };
}
