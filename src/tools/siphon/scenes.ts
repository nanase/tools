/**
 * サイフォンの例。寸法は実物に合わせた m（x 右、z 上、床や机の面が z = 0 とは限らない）。
 * 容器と管の形は模型（model.ts）と描画（fig.ts）で共有する
 */
import type { Cond, Pt, VesselDef } from './model';

export type PKey = 'kst' | 'kd' | 'atip' | 'ad' | 'cq' | 'cc' | 'tv' | 'kq' | 'pq' | 'ht' | 'alt' | 'tc';
export type SceneId = 'kerosene' | 'aquarium' | 'cup' | 'toilet' | 'kusama' | 'periodic' | 'height';
export type Group = 'home' | 'nature' | 'lab';
export type Act = 'prime' | 'stop' | 'flush' | 'pour';
type V = Record<PKey, number>;

export interface Scene {
  id: SceneId;
  group: Group;
  name: string;
  /** 図の上の一言 */
  note: string;
  src: (v: V) => VesselDef;
  dst: (v: V) => VesselDef | null;
  tube: (v: V) => Pt[];
  cond: (v: V) => Cond;
  init: (v: V) => { h1: number; h2?: number };
  rows: PKey[];
  /** 押して操作するボタン [種類, 名前] */
  acts: [Act, string][];
  /** 自動の呼び水 [s]・水洗の間隔 [s] */
  autoPrime?: number;
  flushEvery?: number;
  /** 計算の刻み [s]・記録の間隔 [s]・グラフの幅 [s] */
  dt: number;
  every: number;
  win: number;
  /** 再生の速さの選択肢と既定 */
  speeds: number[];
  speed: number;
  /** 描く範囲 [x0, x1, z0, z1] */
  view: [number, number, number, number];
  /** 流量の単位 */
  qUnit: 'L/min' | 'mL/s' | 'L/s' | 'm³/s';
  /** 湧き出しと数える流量の下限 [m³/s] */
  burstQ?: number;
  /** 開いたときに先に進めておく時間 [s] */
  warm?: number;
}

const rect = (x0: number, z0: number, x1: number, z1: number): Pt[] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
];
/** 角を面取りした長方形 */
const chamf = (x0: number, z0: number, x1: number, z1: number, r: number): Pt[] => [
  [x0 + r, z0],
  [x1 - r, z0],
  [x1, z0 + r],
  [x1, z1 - r],
  [x1 - r, z1],
  [x0 + r, z1],
  [x0, z1 - r],
  [x0, z0 + r],
];
const L_S = 1e-3;

/**
 * 折れ線の角を半径 r の円弧でつなぐ（ホースや水路の曲がり）。r は角ごとの配列でもよい（0 なら角のまま）。
 * 半径は隣の辺の半分までに縮める。両端の点は動かさない
 */
export function fillet(pts: readonly Pt[], r: number | readonly number[], n = 10): Pt[] {
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [p0, p1, p2] = [pts[i - 1], pts[i], pts[i + 1]],
      R0 = typeof r === 'number' ? r : (r[i] ?? 0);
    const l1 = Math.hypot(p0[0] - p1[0], p0[1] - p1[1]),
      l2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const a: Pt = [(p0[0] - p1[0]) / l1, (p0[1] - p1[1]) / l1],
      b: Pt = [(p2[0] - p1[0]) / l2, (p2[1] - p1[1]) / l2],
      th = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1])));
    if (R0 <= 0 || th > Math.PI - 1e-3 || th < 1e-3) {
      out.push(p1);
      continue;
    }
    const t = Math.min(R0 / Math.tan(th / 2), l1 / 2, l2 / 2),
      R = t * Math.tan(th / 2),
      T1: Pt = [p1[0] + a[0] * t, p1[1] + a[1] * t],
      T2: Pt = [p1[0] + b[0] * t, p1[1] + b[1] * t];
    const bx = a[0] + b[0],
      bz = a[1] + b[1],
      bl = Math.hypot(bx, bz),
      d = R / Math.sin(th / 2),
      C: Pt = [p1[0] + (bx / bl) * d, p1[1] + (bz / bl) * d];
    const s0 = Math.atan2(T1[1] - C[1], T1[0] - C[0]);
    let ds = Math.atan2(T2[1] - C[1], T2[0] - C[0]) - s0;
    if (ds > Math.PI) ds -= 2 * Math.PI;
    if (ds < -Math.PI) ds += 2 * Math.PI;
    for (let j = 0; j <= n; j++) {
      const u = s0 + (ds * j) / n;
      out.push([C[0] + R * Math.cos(u), C[1] + R * Math.sin(u)]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
const WATER = { alt: 0, T: 20, fix: undefined };

/* ---------- 寸法 ---------- */
/** ポリタンク（18 L）: 幅 34 cm・高さ 33 cm・奥行き 22.5 cm。z は台の高さ S からの値 */
export const KER = {
  w: 0.34,
  h: 0.33,
  wall: 0.004,
  D: 0.225,
  /** 給油口の首（x の範囲と高さ） */
  neck: [0.035, 0.1, 0.035] as const,
  pipeX: 0.068,
  /** カートリッジタンク（9 L）: 床に置き、給油口を上にする */
  ct: [0.5, 0.86, 0.24] as const,
  ctNeck: [0.585, 0.645, 0.035] as const,
  ctD: 0.11,
};
/** 60 cm 水槽: 水槽台 70 cm、ガラス 6 mm、砂利 4 cm。バケツは底 28 cm・口 33 cm・高さ 31 cm */
export const AQ = {
  stand: 0.7,
  x0: 0.01,
  x1: 0.61,
  glass: 0.006,
  floor: 0.712,
  gravel: 0.752,
  rim: 1.065,
  D: 0.288,
  cx: 0.36,
  bucket: [0.75, 1.03, 0.725, 1.055, 0.31] as const,
};
/** 教訓茶碗: 内径 6.2〜8.8 cm・深さ 7 cm、中央の柱は外径 16 mm、足の高さ 3.3 cm */
export const CUP = { rim: 0.07, foot: -0.033, table: -0.036, col: 0.008 };
/** サイフォン式の便器: 床が z = 0、便座の高さ 40 cm、排水路の内径 5 cm、封水の頂上 26 cm */
export const TOI = {
  bowl: [
    [-0.3, 0.4],
    [-0.27, 0.345],
    [-0.22, 0.295],
    [-0.15, 0.255],
    [-0.08, 0.225],
    [-0.03, 0.2],
    [0.0, 0.175],
    [0.02, 0.155],
    [0.045, 0.145],
    [0.06, 0.15],
    [0.07, 0.2],
    [0.085, 0.27],
    [0.1, 0.34],
    [0.11, 0.4],
  ] as Pt[],
  trap: [
    [0.045, 0.15],
    [0.075, 0.115],
    [0.12, 0.112],
    [0.16, 0.155],
    [0.195, 0.222],
    [0.22, 0.252],
    [0.245, 0.26],
    [0.27, 0.242],
    [0.285, 0.185],
    [0.293, 0.08],
    [0.297, -0.08],
  ] as Pt[],
  tank: [0.15, 0.5, 0.44, 0.8] as const,
  flushQ: 1.8 * L_S,
  refillQ: 0.15 * L_S,
  refillDur: 22,
};
/** 間欠冷泉の空洞と水路（地下の形は推定の模式図） */
/**
 * 間欠冷泉の空洞と水路（地下の形は推定の模式図）。水路は地層の面（横）と縦の割れ目・断層をつないだ角ばった道。
 * 模型が使うのは主な道だけで、分かれてまた合わさる脇道（branches）は描くだけ。サイフォンに効くのは道の高さだけである。
 * 湧き口は崖の面にある穴（hole は奥行き）で、主な道は崖の面で終わる
 */
export const KUS = {
  cave: [
    [0, 0],
    [3.3, 0],
    [3.4, 1.2],
    [3.1, 2.5],
    [1.6, 2.75],
    [0.2, 2.45],
    [-0.1, 1.1],
  ] as Pt[],
  tube: [
    [3.2, 0.06],
    [3.8, 0.08],
    [3.88, 0.62],
    [4.2, 0.66],
    [4.3, 1.42],
    [4.52, 1.46],
    [4.6, 2.06],
    [5.1, 2.04],
    [5.16, 1.3],
    [5.55, 1.22],
    [5.62, 0.48],
    [6.05, 0.42],
    [6.12, -0.33],
    [7.05, -0.35],
  ] as Pt[],
  branches: [
    [
      [3.84, 0.35],
      [3.6, 0.42],
      [3.64, 0.98],
      [4.25, 1.04],
    ],
    [
      [5.13, 1.7],
      [5.36, 1.66],
      [5.43, 0.86],
      [5.59, 0.8],
    ],
  ] as Pt[][],
  /** 断層: z = 0 での x と、z が 1 上がるときの x の増え方。右側の地層を throw だけずらして描く */
  fault: { x: 4.0, k: 0.22, throw: 0.3 },
  /** 崖・川の高さ・湧き口の高さと奥行き（高さ 1 m・幅 0.5 m の洞孔） */
  cliff: 7.05,
  river: -1.15,
  mouth: 1.0,
  hole: 0.55,
};
export const PER = {
  cave: [
    [0, 0],
    [9.2, 0],
    [9.6, 1.8],
    [8.4, 3.3],
    [4.5, 3.6],
    [0.6, 3.2],
    [-0.3, 1.5],
  ] as Pt[],
  tube: [
    [9.0, 0.1],
    [10.4, 0.15],
    [10.6, 1.0],
    [11.5, 1.08],
    [11.7, 2.0],
    [12.4, 2.05],
    [12.55, 2.76],
    [13.9, 2.72],
    [14.05, 1.6],
    [15.2, 1.5],
    [15.35, 0.5],
    [16.8, 0.4],
    [16.95, -1.0],
    [19.6, -1.0],
  ] as Pt[],
  branches: [
    [
      [10.51, 0.6],
      [10.0, 0.7],
      [10.2, 1.6],
      [11.6, 1.54],
    ],
    [
      [13.98, 2.15],
      [14.6, 2.1],
      [14.75, 1.0],
      [15.3, 0.85],
    ],
  ] as Pt[][],
  fault: { x: 11.15, k: 0.3, throw: 0.7 },
  cliff: 19.6,
  river: -3.2,
  mouth: 2.2,
  hole: 1.4,
};
/** 高さの限界: 上の水槽は地面に、下の水槽は穴の中。地面は z = −1.45 */
export const HGT = { ground: -1.45, upper: [0, 1.2, 1.2] as const, lower: [3.2, 4.4, -1.4, -0.1] as const };

export const SCENES: readonly Scene[] = [
  {
    id: 'kerosene',
    group: 'home',
    name: '灯油ポンプ',
    note: 'ポリタンクからストーブのカートリッジタンクへ',
    src: (v) => {
      const S = v.kst / 100,
        w = KER.wall;
      return { poly: chamf(w, S + w, KER.w - w, S + KER.h - w, 0.02), D: KER.D, top: S + 0.3 };
    },
    dst: () => {
      const [x0, x1, h] = KER.ct,
        [n0, n1, nh] = KER.ctNeck,
        w = 0.004;
      return {
        poly: [
          [x0 + w, w],
          [x1 - w, w],
          [x1 - w, h - w],
          [n1, h - w],
          [n1, h + nh],
          [n0, h + nh],
          [n0, h - w],
          [x0 + w, h - w],
        ],
        D: KER.ctD,
      };
    },
    tube: (v) => {
      const S = v.kst / 100,
        x = KER.pipeX;
      return fillet(
        [
          [x, S + 0.02],
          [x, S + 0.505],
          [x + 0.07, S + 0.555],
          [0.33, S + 0.56],
          [0.585, 0.36],
          [0.615, 0.26],
          [0.615, 0.225],
        ],
        [0, 0.03, 0.06, 0.16, 0.16, 0.04, 0],
      );
    },
    cond: (v) => ({
      ...WATER,
      d: v.kd / 1000,
      qin: 0,
      rho: 790,
      nu: 2.0e-6,
      ent: 1,
      qfilm: 0.004 * L_S,
      drain: 1.5,
      kb: 1.2,
    }),
    init: (v) => ({ h1: v.kst / 100 + 0.004 + 16e-3 / (0.332 * KER.D), h2: 0.004 + 0.4e-3 / (0.352 * KER.ctD) }),
    rows: ['kst', 'kd'],
    acts: [
      ['prime', 'ポンプを押す'],
      ['stop', '空気弁を開ける'],
    ],
    autoPrime: 0.6,
    dt: 0.005,
    every: 0.25,
    win: 150,
    speeds: [1, 2, 5],
    speed: 1,
    view: [-0.05, 0.92, -0.06, 1.0],
    qUnit: 'L/min',
  },
  {
    id: 'aquarium',
    group: 'home',
    name: '水槽の水換え',
    note: 'バケツへ抜く水の量は吸い口の高さで決まる',
    src: () => ({ poly: rect(AQ.x0 + AQ.glass, AQ.gravel, AQ.x1 - AQ.glass, AQ.rim), D: AQ.D, top: 1.055 }),
    dst: () => {
      const [b0, b1, t0, t1, h] = AQ.bucket;
      return {
        poly: [
          [b0, 0.006],
          [b1, 0.006],
          [t1, h],
          [t0, h],
        ],
        D: 0.27,
        top: h - 0.01,
      };
    },
    tube: (v) => {
      const z = AQ.gravel + v.atip / 100,
        x = AQ.cx;
      return fillet(
        [
          [x, z],
          [x, 1.12],
          [0.48, 1.17],
          [0.66, 1.13],
          [0.8, 0.6],
          [0.885, 0.34],
          [0.89, 0.24],
        ],
        [0, 0.05, 0.09, 0.09, 0.2, 0.1, 0],
      );
    },
    cond: (v) => ({ ...WATER, d: v.ad / 1000, qin: 0, ent: 1, qfilm: 0.004 * L_S, drain: 1.5, kb: 1.5 }),
    init: () => ({ h1: 1.025, h2: 0.006 }),
    rows: ['atip', 'ad'],
    acts: [
      ['prime', 'ホースを吸う'],
      ['stop', 'ホースを水から出す'],
    ],
    autoPrime: 0.6,
    dt: 0.005,
    every: 0.5,
    win: 300,
    speeds: [1, 5, 20],
    speed: 5,
    view: [-0.06, 1.12, -0.05, 1.24],
    qUnit: 'L/min',
  },
  {
    id: 'cup',
    group: 'home',
    name: '教訓茶碗',
    note: '注ぎすぎると底の穴から全部こぼれる杯（ピタゴラスカップ）',
    src: (v) => {
      const cap = v.cc / 100 + 0.004;
      return {
        poly: [
          [-0.031, 0],
          [0.031, 0],
          [0.036, 0.02],
          [0.041, 0.05],
          [0.044, CUP.rim],
          [-0.044, CUP.rim],
          [-0.041, 0.05],
          [-0.036, 0.02],
        ],
        D: 0.058,
        top: CUP.rim,
        holes: [rect(-CUP.col, 0, CUP.col, cap)],
      };
    },
    dst: () => null,
    tube: (v) => {
      const c = v.cc / 100;
      return [
        [-0.005, 0.0015],
        [-0.005, c - 0.002],
        [-0.0025, c],
        [0, c - 0.002],
        [0, CUP.foot],
      ];
    },
    cond: (v) => ({ ...WATER, d: 0.005, qin: v.cq * 1e-6, ent: 1, qfilm: 0.6e-6, drain: 0.6, kb: 1.5 }),
    init: () => ({ h1: 0.012 }),
    rows: ['cq', 'cc'],
    acts: [['pour', '注ぐ']],
    dt: 0.002,
    every: 0.25,
    win: 240,
    speeds: [1, 2, 5],
    speed: 2,
    view: [-0.16, 0.11, -0.045, 0.165],
    qUnit: 'mL/s',
  },
  {
    id: 'toilet',
    group: 'home',
    name: 'サイフォン式トイレ',
    note: 'タンクの水で便器の水位を上げ、排水路を満たして一気に吸い出す',
    src: () => ({ poly: TOI.bowl, D: 0.22, top: 0.39 }),
    dst: () => null,
    tube: () => fillet(TOI.trap, 0.03),
    cond: (v) => ({
      ...WATER,
      d: 0.05,
      qin: 0,
      ent: 1.2,
      qfilm: 0.3 * L_S,
      drain: 0.8,
      kb: 2,
      flushQ: TOI.flushQ,
      flushDur: (v.tv * L_S) / TOI.flushQ,
      refillQ: TOI.refillQ,
      refillDur: TOI.refillDur,
    }),
    init: () => ({ h1: 0.25 }),
    rows: ['tv'],
    acts: [['flush', 'レバーを引く']],
    flushEvery: 32,
    dt: 0.002,
    every: 0.1,
    win: 64,
    speeds: [0.25, 1, 2],
    speed: 1,
    view: [-0.42, 0.62, -0.16, 0.84],
    qUnit: 'L/s',
  },
  {
    id: 'kusama',
    group: 'nature',
    name: '草間の間歇冷泉',
    note: '岡山県新見市の天然記念物。地下の形は推定の模式図',
    src: () => ({ poly: KUS.cave, D: 2.0, top: 2.6 }),
    dst: () => null,
    tube: () => KUS.tube,
    cond: (v) => ({
      ...WATER,
      T: 12,
      fix: 0.03,
      d: 0.072,
      qin: v.kq * L_S,
      ent: 0.0095,
      qfilm: 0.15 * L_S,
      drain: 120,
      kb: 1.2,
    }),
    init: () => ({ h1: 0.3 }),
    rows: ['kq'],
    acts: [],
    dt: 0.5,
    every: 30,
    win: 16 * 3600,
    speeds: [60, 600, 3600],
    speed: 600,
    view: [-0.9, 8.6, -1.7, 4.3],
    qUnit: 'L/s',
    burstQ: 1.5 * L_S,
    warm: 3 * 3600,
  },
  {
    id: 'periodic',
    group: 'nature',
    name: 'ピリオディック・スプリング',
    note: '米国ワイオミング州の湧き水。地下の形は推定の模式図',
    src: () => ({ poly: PER.cave, D: 5.0, top: 3.4 }),
    dst: () => null,
    tube: () => PER.tube,
    cond: (v) => ({ ...WATER, T: 5, fix: 0.03, d: 0.5, qin: v.pq, ent: 0.45, qfilm: 0.01, drain: 60, kb: 1.0 }),
    init: () => ({ h1: 0.3 }),
    rows: ['pq'],
    acts: [],
    dt: 0.05,
    every: 5,
    win: 2 * 3600,
    speeds: [10, 60, 600],
    speed: 60,
    view: [-1.6, 22.4, -4.6, 6.4],
    qUnit: 'm³/s',
    burstQ: 0.16,
    warm: 18 * 60,
  },
  {
    id: 'height',
    group: 'lab',
    name: '高さの限界',
    note: '水面から約 10 m の頂上で水が沸騰し、水柱が 2 本に分かれる',
    src: () => ({ poly: rect(0.03, 0.03, 1.17, 1.2), D: 3, top: 1.2 }),
    dst: () => ({ poly: rect(3.23, -1.4, 4.37, -0.1), D: 3 }),
    tube: (v) =>
      fillet(
        [
          [0.9, 0.1],
          [0.9, 1.4],
          [1.25, v.ht + 0.02],
          [2.75, v.ht + 0.02],
          [3.5, 1.0],
          [3.5, -1.3],
        ],
        [0, 0.3, 0.4, 0.4, 0.3, 0],
      ),
    cond: (v) => ({ d: 0.02, alt: v.alt, T: v.tc, qin: 0, ent: 1, qfilm: 0.01 * L_S, drain: 4, kb: 0.6 }),
    init: () => ({ h1: 1.0, h2: -1.2 }),
    rows: ['ht', 'alt', 'tc'],
    acts: [
      ['prime', '呼び水'],
      ['stop', '空気を入れる'],
    ],
    autoPrime: 0.4,
    dt: 0.005,
    every: 0.25,
    win: 60,
    speeds: [1, 2, 5],
    speed: 1,
    view: [-1.7, 6.2, -1.75, 15.3],
    qUnit: 'L/s',
  },
];

export const GROUPS: [Group, string][] = [
  ['home', '身近な物'],
  ['nature', '自然'],
  ['lab', '実験'],
];
export const sceneOf = (id: string): Scene => SCENES.find((s) => s.id === id) ?? SCENES[0];
