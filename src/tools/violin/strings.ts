/**
 * 弦の物理量と振動モード（DOM に依存しない）。
 * 両端を単純支持した硬い弦（Fletcher 1964）のモードで表し、損失は Woodhouse (2004) の形に空気の粘性
 * （Valette）を足したもの。駒のアドミタンスによる周波数と減衰の変化は、1 次の摂動 δω = i (T/L) Y(ω) で入れる
 * （Gough 1981。e^{iωt} の表し方）。指で押さえた端の損失は、端に置いた抵抗の反射の損失として 1/n に比例させる
 */
import { type Body, stringDir, yTop } from './body';

/** 空気の密度 [kg/m³]・粘性率 [Pa·s] */
const AIR = { rho: 1.2, eta: 1.8e-5 } as const;
/** 弦長（駒から上駒まで） [m] */
export const L0 = 0.328;

/** 弦 1 本の指定 */
export interface StringSpec {
  name: string;
  /** 開放弦の音の高さ（MIDI） */
  open: number;
  /** 外径 [m]・張力 [N]・曲げ剛性 EI [N·m²] */
  d: number;
  T: number;
  EI: number;
  /** 損失係数: 張力の側（内部摩擦）・曲げの側・低い周波数で増える分 [1/s]（空気の粘性の分を除いた残り） */
  etaF: number;
  etaB: number;
  etaX: number;
  /** ねじり: 波の速さ ÷ 横波の速さ、弦の表面で見たインピーダンス ÷ 横波の特性インピーダンス、Q */
  ct: number;
  zt: number;
  qt: number;
}

/**
 * 標準的な弦の組（0 = E 線 … 3 = G 線）。張力と外径は Pickering の測定した合成芯の巻線弦（Dominant）の値、
 * E 線は線密度の合うスチールの単線。曲げ剛性は、E 線が Galluzzo ほか (2017) の値、巻線は Desvages (2018) の表の
 * ヤング率を芯（外径の半分）に当てた値。損失は、E 線が Galluzzo ほか (2017)、巻線の曲げの側は Mansour ほか (2016) の
 * チェロ弦の値。低い周波数で増える分は、剛な台の上の基本モードの Q が約 900（Schoonderwaldt ほか 2008 の測定の
 * 約 2 倍）になる値。ねじりは、E 線が Galluzzo ほか (2017) の測定（基本 4.6 kHz・0.61 kg/s・Q 30）、巻線は合成芯の
 * 目安（速さの比 5〜6。Guettler）と、インピーダンスが横波の 2〜4 倍という目安（Schoonderwaldt ほか 2008）の中ほど。
 * 巻線のねじりの Q は、Woodhouse & Loach (1999) がチェロの D 線で測った値（ナイロン芯 46、スチール芯 34、ガット芯 20）の
 * 下の端の 20 にした。35 では D・G 線の和音や重音で多重の滑りが残りやすく、20 で目に見えて減った（段階 5 の走査）。
 * 弓の毛の弾性など、模型にない安定化の仕組みの分を、ここで代わりに受け持っているとみなす
 */
export const STRINGS: readonly StringSpec[] = [
  { name: 'E', open: 76, d: 0.25e-3, T: 72.56, EI: 4.7e-5, etaF: 5e-5, etaB: 2e-3, etaX: 0.8, ct: 7, zt: 3.6, qt: 30 },
  { name: 'A', open: 69, d: 0.676e-3, T: 56.25, EI: 0.8e-5, etaF: 2e-4, etaB: 0.12, etaX: 1, ct: 5.5, zt: 2.5, qt: 20 },
  {
    name: 'D',
    open: 62,
    d: 0.795e-3,
    T: 43.72,
    EI: 0.85e-5,
    etaF: 2e-4,
    etaB: 0.12,
    etaX: 1,
    ct: 5.5,
    zt: 2.5,
    qt: 20,
  },
  { name: 'G', open: 55, d: 0.803e-3, T: 44.57, EI: 0.8e-5, etaF: 2e-4, etaB: 0.12, etaX: 1, ct: 5.5, zt: 2.5, qt: 20 },
];

/** 平均律の周波数（A4 = 440 Hz） */
export const noteHz = (n: number): number => 440 * 2 ** ((n - 69) / 12);

/** 線密度 [kg/m]（開放弦の第 1 部分音が音の高さに合う値。曲げ剛性の分を差し引く） */
export const muOf = (s: StringSpec): number =>
  (s.T + (Math.PI ** 2 * s.EI) / (L0 * L0)) / (4 * L0 * L0 * noteHz(s.open) ** 2);
/**
 * 調弦した弦の張力 [N]。cent は開放弦の音の高さを平均律からずらす量 [セント]（糸巻きで張力を変える）。
 * 周波数は張力の平方根に比例するので、張力は 2^(cent/600) 倍
 */
export const tensionOf = (s: StringSpec, cent = 0): number => s.T * 2 ** (cent / 600);
/** 特性インピーダンス √(T μ) [kg/s]（cent は調弦のずれ [セント]） */
export const z0Of = (s: StringSpec, cent = 0): number => Math.sqrt(tensionOf(s, cent) * muOf(s));

/** 指で押さえた端の損失: 第 1 モードの損失係数に足す値（端の抵抗が約 50 kg/s のときの反射の損失にあたる） */
export const FINGER_ETA = 2.5e-3;

/** 駒のアドミタンスの表の刻み [Hz] と上限 [Hz] */
const Y_DF = 4,
  Y_MAX = 22000;
const tables = new WeakMap<Body, Float64Array[]>();
/** 弦 si の弓の向きの駒のアドミタンスを、刻み Y_DF の表にする（実部・虚部を交互に。胴ごとに 1 度だけ作る） */
function yTable(body: Body, si: number): Float64Array {
  let t = tables.get(body);
  if (!t) {
    t = [];
    tables.set(body, t);
  }
  if (!t[si]) {
    const n = Math.floor(Y_MAX / Y_DF) + 2,
      a = new Float64Array(2 * n),
      dir = stringDir(si);
    for (let i = 0; i < n; i++) {
      const y = yTop(body, i * Y_DF, dir, dir);
      a[2 * i] = y.re;
      a[2 * i + 1] = y.im;
    }
    t[si] = a;
  }
  return t[si];
}

/** 振動する長さ L の弦のモード（駒との結合を含む） */
export interface StringModes {
  L: number;
  n: number;
  /** 角周波数 [rad/s]・減衰率 [1/s] */
  w: Float64Array;
  s: Float64Array;
  /** モードの質量 μL/2 [kg] と、モードの変位 → 駒の力の係数 (T + EI k²) k [N/m] */
  m: number;
  kf: Float64Array;
  /** ねじりのモード（弦の表面の速度で表す）: 数・角周波数・減衰率・モードの質量 */
  nt: number;
  wt: Float64Array;
  st: Float64Array;
  mt: number;
}

/**
 * 弦 si（0 = E 線）の、振動する長さ L [m] のモード。finger は指で押さえた端の損失の倍率（開放弦は 0）、
 * body を渡すと駒のアドミタンスによる周波数と減衰の変化を入れる。cent は調弦のずれ [セント]（張力を変える）。
 * fmax [Hz] までのモードを作る
 */
export function stringModes(
  si: number,
  L: number,
  fmax: number,
  finger: number,
  body: Body | null,
  cent = 0,
  nMax = 120,
): StringModes {
  const sp = STRINGS[si],
    T = tensionOf(sp, cent),
    mu = muOf(sp),
    c = Math.sqrt(T / mu),
    tab = body ? yTable(body, si) : null,
    w: number[] = [],
    s: number[] = [],
    kf: number[] = [];
  for (let n = 1; n <= nMax; n++) {
    const k = (n * Math.PI) / L,
      bk = sp.EI * k * k,
      f = ((n * c) / (2 * L)) * Math.sqrt(1 + bk / T);
    if (f > fmax) break;
    const wn = 2 * Math.PI * f,
      eta =
        (AIR.eta + sp.d * Math.sqrt(Math.PI * AIR.eta * AIR.rho * f)) / (mu * f) +
        sp.etaX / wn +
        (T * sp.etaF + bk * sp.etaB) / (T + bk) +
        (finger * FINGER_ETA) / n;
    let dw = 0,
      ds = 0;
    if (tab) {
      /* δω = i (T/L) Y: 実部が周波数のずれ、虚部が減衰率。Y は表を直線で補間する */
      const x = Math.min(f, Y_MAX) / Y_DF,
        i = Math.floor(x),
        u = x - i,
        kk = T / L;
      dw = -kk * ((1 - u) * tab[2 * i + 1] + u * tab[2 * i + 3]);
      ds = kk * ((1 - u) * tab[2 * i] + u * tab[2 * i + 2]);
    }
    w.push(wn + dw);
    s.push((eta * wn) / 2 + ds);
    kf.push((T + bk) * k);
  }
  /* ねじり: 両端を固定した調和なモードで、Q はどのモードも同じ（Woodhouse・Loach 1999） */
  const wt: number[] = [],
    st: number[] = [];
  for (let n = 1; n <= 40; n++) {
    const f = (n * sp.ct * c) / (2 * L);
    if (f > fmax) break;
    wt.push(2 * Math.PI * f);
    st.push((Math.PI * f) / sp.qt);
  }
  return {
    L,
    n: w.length,
    w: Float64Array.from(w),
    s: Float64Array.from(s),
    m: (mu * L) / 2,
    kf: Float64Array.from(kf),
    nt: wt.length,
    wt: Float64Array.from(wt),
    st: Float64Array.from(st),
    /* 表面の速度で見た線密度は Z_t / c_t */
    mt: ((sp.zt * Math.sqrt(T * mu)) / (sp.ct * c)) * (L / 2),
  };
}
