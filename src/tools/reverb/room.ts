/**
 * 部屋（DOM に依存しない）: 直方体の寸法・6 面の材料・音源と聞き手の位置と、そこから求める値
 * （容積・表面積・平均吸音率・Sabine と Eyring の残響時間・臨界距離・平均自由行程・混合時間）。
 * 吸音率と残響時間はオクターブ帯 125 Hz〜4 kHz の 6 帯域ごとに持つ。空気の吸収は ISO 9613-1（lib/air.ts）
 */
import { AIR0, type Air, absorption, exactMid } from '../../lib/air';

/** オクターブ帯の中心周波数 [Hz]（名目の値） */
export const BANDS = [125, 250, 500, 1000, 2000, 4000] as const;
export const NB = BANDS.length;
/** 帯域ごとの値 */
export type PerBand = readonly number[];

/** 音速 [m/s]（20 °C） */
export const C0 = 343.2;

/** 面の並び: 西（x = 0）・東（x = W）・南（y = 0）・北（y = D）・床（z = 0）・天井（z = H） */
export const FACES = ['w', 'e', 's', 'n', 'f', 'c'] as const;
export type Face = (typeof FACES)[number];
export const FACE_NAMES: Record<Face, string> = {
  w: '西の壁',
  e: '東の壁',
  s: '南の壁',
  n: '北の壁',
  f: '床',
  c: '天井',
};

/**
 * 材料: 帯域ごとの吸音率。値は Vorländer『Auralization』（2008）の付録の表を pyroomacoustics が写したもの
 * （付録の表番号は未確認）。屋外の地面は室内の表にないので、硬い地面はコンクリートの値で代える
 */
export interface Material {
  v: string;
  name: string;
  a: PerBand;
}
export const OPEN = 'open';
export const MATERIALS: readonly Material[] = [
  { v: 'concrete', name: 'コンクリート', a: [0.01, 0.01, 0.02, 0.02, 0.02, 0.05] },
  { v: 'brick', name: 'れんが（塗り）', a: [0.01, 0.02, 0.02, 0.03, 0.03, 0.04] },
  { v: 'hard', name: '硬い壁（平均）', a: [0.02, 0.02, 0.03, 0.03, 0.04, 0.05] },
  { v: 'gypsum', name: '石膏ボード', a: [0.15, 0.1, 0.06, 0.04, 0.04, 0.05] },
  { v: 'woodfloor', name: '木の床', a: [0.09, 0.06, 0.05, 0.05, 0.05, 0.04] },
  { v: 'woodpanel', name: '板張り', a: [0.18, 0.12, 0.1, 0.09, 0.08, 0.07] },
  { v: 'glass', name: 'ガラス窓', a: [0.1, 0.05, 0.04, 0.03, 0.03, 0.03] },
  { v: 'carpet', name: 'カーペット', a: [0.08, 0.08, 0.3, 0.6, 0.75, 0.8] },
  { v: 'curtain', name: '厚いカーテン', a: [0.3, 0.45, 0.65, 0.56, 0.59, 0.71] },
  { v: 'panel', name: '吸音板', a: [0.22, 0.6, 0.92, 0.9, 0.88, 0.88] },
  { v: 'audience', name: '客席（人）', a: [0.72, 0.82, 0.91, 0.93, 0.94, 0.87] },
  /** 面がない（屋外）: 音はすべて抜け、反射しない */
  { v: OPEN, name: 'なし（開放）', a: [1, 1, 1, 1, 1, 1] },
];
export const materialOf = (v: string): Material => MATERIALS.find((m) => m.v === v) ?? MATERIALS[0];

export type Vec3 = readonly [number, number, number];

/** 部屋の設定 */
export interface Room {
  /** 幅（東西）・奥行き（南北）・高さ [m] */
  dim: Vec3;
  /** 面ごとの材料（FACES の順） */
  mat: Readonly<Record<Face, string>>;
  /** 音源・聞き手 [m] */
  src: Vec3;
  rcv: Vec3;
  /** 気温・湿度 */
  air?: Air;
}

/** 部屋の例（寸法と材料はこのツールで選んだ概数。仮） */
export interface Preset {
  v: string;
  name: string;
  room: Room;
}
const all = (m: string, floor = m, ceil = m): Record<Face, string> => ({ w: m, e: m, s: m, n: m, f: floor, c: ceil });
export const PRESETS: readonly Preset[] = [
  {
    v: 'living',
    name: '居間',
    room: {
      dim: [5, 4, 2.4],
      mat: { ...all('gypsum', 'woodfloor', 'gypsum'), n: 'curtain' },
      src: [1.5, 2, 1.2],
      rcv: [3.6, 2.4, 1.2],
    },
  },
  {
    v: 'class',
    name: '教室',
    room: {
      dim: [9, 7, 3],
      mat: { ...all('hard', 'woodfloor', 'panel'), e: 'glass' },
      src: [4.5, 6, 1.5],
      rcv: [4, 2, 1.2],
    },
  },
  {
    v: 'bath',
    name: '浴室',
    room: { dim: [2, 1.6, 2.2], mat: all('concrete'), src: [0.6, 0.8, 1.2], rcv: [1.4, 0.9, 1.2] },
  },
  {
    v: 'hall',
    name: 'ホール',
    room: {
      dim: [26, 40, 15],
      mat: all('woodpanel', 'audience', 'hard'),
      src: [13, 34, 1.5],
      rcv: [16, 14, 1.2],
    },
  },
  {
    v: 'church',
    name: '石の教会',
    room: { dim: [20, 50, 18], mat: all('brick', 'audience', 'hard'), src: [10, 44, 1.5], rcv: [10, 12, 1.5] },
  },
  {
    v: 'tunnel',
    name: '地下道',
    room: { dim: [4, 60, 3], mat: all('concrete'), src: [2, 8, 1.5], rcv: [2, 20, 1.5] },
  },
  {
    v: 'open',
    name: '屋外（地面だけ）',
    room: { dim: [40, 40, 10], mat: all(OPEN, 'concrete', OPEN), src: [18, 20, 1.5], rcv: [24, 20, 1.5] },
  },
  {
    v: 'yamabiko',
    name: '屋外（建物の壁）',
    room: {
      dim: [60, 40, 10],
      mat: { ...all(OPEN, 'concrete', OPEN), e: 'concrete' },
      src: [4, 20, 1.5],
      rcv: [6, 21, 1.5],
    },
  },
];
export const presetOf = (v: string): Preset => PRESETS.find((p) => p.v === v) ?? PRESETS[0];

/** 面ごとの面積 [m²]（FACES の順） */
export function faceAreas(dim: Vec3): number[] {
  const [W, D, H] = dim;
  return [D * H, D * H, W * H, W * H, W * D, W * D];
}

/** 面ごと・帯域ごとの吸音率 */
export const alphas = (r: Room): PerBand[] => FACES.map((f) => materialOf(r.mat[f]).a);

/** 6 面すべてがある（閉じた部屋） */
export const isClosed = (r: Room): boolean => FACES.every((f) => r.mat[f] !== OPEN);

/** 帯域ごとの空気の吸収 [dB/m] */
export const airDb = (air: Air = AIR0): number[] => BANDS.map((f) => absorption(exactMid(f), air));

/**
 * Sabine の式 T = 0.161 V / (A + 4 m V)、A = Σ S_i α_i。0.161 は 24 ln 10 / c（c = 343 m/s）。
 * m は空気の強さの減衰率 [1/m]（dB/m ÷ 10 log₁₀ e）
 */
export const sabine = (V: number, A: number, m = 0): number => (0.161 * V) / (A + 4 * m * V);
/** Eyring の式 T = 0.161 V / (−S ln(1 − ᾱ) + 4 m V)、ᾱ は面積で重みを付けた平均 */
export const eyring = (V: number, S: number, a: number, m = 0): number =>
  a >= 1 ? 0 : (0.161 * V) / (-S * Math.log(1 - a) + 4 * m * V);

/** dB/m を強さの減衰率 [1/m] にする */
export const dbToM = (db: number): number => db / (10 * Math.LOG10E);

/** 部屋から求めた値 */
export interface Acoustics {
  V: number;
  S: number;
  /** 平均自由行程 4V/S [m] */
  mfp: number;
  /** 帯域ごと: 平均吸音率、等価吸音面積 A [m²]、Sabine・Eyring の残響時間 [s]、臨界距離 [m] */
  aMean: number[];
  A: number[];
  sab: number[];
  eyr: number[];
  rc: number[];
  /** 混合時間 √V [ms] を秒で（反射の密度が 400 /s になる時刻。Cremer・Müller の目安） */
  tMix: number;
  /** Schroeder 周波数 2000 √(T/V) [Hz]（500 Hz の Eyring の残響時間で） */
  fSch: number;
  /** 閉じた部屋か（開いた面があると残響時間の式は使えない） */
  closed: boolean;
}

export function acoustics(r: Room): Acoustics {
  const [W, D, H] = r.dim,
    V = W * D * H,
    Si = faceAreas(r.dim),
    S = Si.reduce((s, x) => s + x, 0),
    al = alphas(r),
    m = airDb(r.air).map(dbToM),
    aMean: number[] = [],
    A: number[] = [],
    sab: number[] = [],
    eyr: number[] = [],
    rc: number[] = [];
  for (let b = 0; b < NB; b++) {
    let a = 0;
    for (let i = 0; i < 6; i++) a += Si[i] * al[i][b];
    aMean.push(a / S);
    A.push(a);
    sab.push(sabine(V, a, m[b]));
    eyr.push(eyring(V, S, a / S, m[b]));
    /* 拡散音場で直接音と残響音が等しくなる距離 √(A_eq / 16π)（無指向性の音源）。A_eq は空気の吸収を含む Eyring の吸音力 */
    const Aeq = a / S >= 1 ? Infinity : -S * Math.log(1 - a / S) + 4 * m[b] * V;
    rc.push(Math.sqrt(Aeq / (16 * Math.PI)));
  }
  return {
    V,
    S,
    mfp: (4 * V) / S,
    aMean,
    A,
    sab,
    eyr,
    rc,
    tMix: Math.sqrt(V) / 1000,
    fSch: 2000 * Math.sqrt(eyr[2] / V),
    closed: isClosed(r),
  };
}

/** 2 点の距離 [m] */
export const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** 位置を部屋の中（壁から e [m] 離す）に収める */
export function clampIn(p: Vec3, dim: Vec3, e = 0.1): Vec3 {
  const c = (x: number, L: number) => Math.min(L - e, Math.max(e, x));
  return [c(p[0], dim[0]), c(p[1], dim[1]), c(p[2], dim[2])];
}
