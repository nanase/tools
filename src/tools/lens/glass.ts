/**
 * 硝材: SCHOTT のカタログの Sellmeier の分散式（refractiveindex.info のデータベースに収めた
 * SCHOTT Zemax catalog 2017-01-20b の係数）。カタログにない硝材は、屈折率とアッベ数が近い
 * カタログの硝材の分散の形を借りて、nd・νd に合わせた「模型の硝材」にする
 */

/** フラウンホーファー線の波長 [µm] */
export const LD = 0.5875618,
  LF = 0.4861327,
  LC = 0.6562725;

/** 断面図で描く可視光の 7 本の輝線（記号・波長 [µm]）。短い順 */
export const SPECTRAL = [
  ['h', 0.4046561],
  ['g', 0.4358343],
  ['F', LF],
  ['e', 0.546074],
  ['d', LD],
  ['C', LC],
  ['r', 0.7065188],
] as const;

export interface Sellmeier {
  name: string;
  nd: number;
  vd: number;
  /** n² − 1 = Σ B λ²/(λ² − C)（λ は µm） */
  B: readonly [number, number, number];
  C: readonly [number, number, number];
}

const S = (
  name: string,
  nd: number,
  vd: number,
  b1: number,
  c1: number,
  b2: number,
  c2: number,
  b3: number,
  c3: number,
): Sellmeier => ({ name, nd, vd, B: [b1, b2, b3], C: [c1, c2, c3] });

export const CATALOG: Record<string, Sellmeier> = Object.fromEntries(
  [
    S('N-BK7', 1.5168, 64.17, 1.03961212, 0.00600069867, 0.231792344, 0.0200179144, 1.01046945, 103.560653),
    S('N-BAK1', 1.5725, 57.55, 1.12365662, 0.00644742752, 0.309276848, 0.0222284402, 0.881511957, 107.297751),
    S('K10', 1.50137, 56.41, 1.15687082, 0.00809424251, 0.0642625444, 0.0386051284, 0.872376139, 104.74773),
    S('N-ZK7', 1.50847, 61.19, 1.07715032, 0.00676601657, 0.168079109, 0.0230642817, 0.851889892, 89.0498778),
    S('N-SK4', 1.61272, 58.63, 1.32993741, 0.00716874107, 0.228542996, 0.0246455892, 0.988465211, 100.886364),
    S('N-SK15', 1.62296, 58.02, 1.30417786, 0.00695051276, 0.28584116, 0.0232023703, 0.974781572, 99.016884),
    S('N-SK16', 1.62041, 60.32, 1.34317774, 0.00704687339, 0.241144399, 0.0229005, 0.994317969, 92.7508526),
    S('N-BAF10', 1.67003, 47.11, 1.5851495, 0.00926681282, 0.143559385, 0.0424489805, 1.08521269, 105.613573),
    S('N-LAF3', 1.717, 47.96, 1.73155854, 0.00953833914, 0.150874455, 0.0407887211, 1.06586596, 98.0758545),
    S('N-LAF33', 1.78582, 44.05, 1.79653417, 0.00927313493, 0.311577903, 0.0358201181, 1.15981863, 87.3448712),
    S('F2', 1.62004, 36.37, 1.34533359, 0.00997743871, 0.209073176, 0.0470450767, 0.937357162, 111.886764),
    S('F5', 1.60342, 38.03, 1.3104463, 0.00958633048, 0.19603426, 0.0457627627, 0.96612977, 115.011883),
    S('N-BASF2', 1.66446, 36.0, 1.53652081, 0.0108435729, 0.156971102, 0.0562278762, 1.30196815, 131.3397),
    S('SF2', 1.64769, 33.85, 1.40301821, 0.0105795466, 0.231767504, 0.0493226978, 0.939056586, 112.405955),
    S('SF15', 1.69895, 30.07, 1.53925927, 0.0119307961, 0.247620926, 0.0556077536, 1.03816409, 116.416747),
    S('SF1', 1.71736, 29.51, 1.55912923, 0.0121481001, 0.284246288, 0.0534549042, 0.968842926, 112.174809),
  ].map((g) => [g.name, g]),
);

/** Sellmeier の式の屈折率（λ は µm） */
export function sellmeier(g: Sellmeier, l: number): number {
  const l2 = l * l;
  let s = 1;
  for (let i = 0; i < 3; i++) s += (g.B[i] * l2) / (l2 - g.C[i]);
  return Math.sqrt(s);
}

/**
 * レンズの媒質。カタログの硝材そのもの（k = 1、off = 0）か、模型の硝材
 * n(λ) = k·n_ref(λ) + off（nd と νd をそろえ、部分分散の形は n_ref に従う）
 */
export interface Medium {
  /** 表の表記（カタログ名、模型なら「模型（分散は N-SK16）」） */
  name: string;
  nd: number;
  vd: number;
  ref: Sellmeier;
  k: number;
  off: number;
}

export const AIR: Medium = {
  name: '空気',
  nd: 1,
  vd: Infinity,
  ref: { name: '', nd: 1, vd: Infinity, B: [0, 0, 0], C: [0, 0, 0] },
  k: 1,
  off: 0,
};

export function glass(name: string): Medium {
  const g = CATALOG[name];
  if (!g) throw new Error(`unknown glass: ${name}`);
  return { name, nd: g.nd, vd: g.vd, ref: g, k: 1, off: 0 };
}

/** 屈折率 nd・アッベ数 νd の模型の硝材。分散の形はカタログの硝材 refName から借りる */
export function model(nd: number, vd: number, refName: string): Medium {
  const r = CATALOG[refName];
  const r0 = sellmeier(r, LD),
    dr = sellmeier(r, LF) - sellmeier(r, LC);
  const k = (nd - 1) / vd / dr;
  return { name: `模型（分散は ${refName}）`, nd, vd, ref: r, k, off: nd - k * r0 };
}

/** 媒質の屈折率（λ は µm） */
export const nAt = (m: Medium, l: number): number => (m === AIR ? 1 : m.k * sellmeier(m.ref, l) + m.off);
