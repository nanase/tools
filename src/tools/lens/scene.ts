/**
 * 被写体の 3D 空間（DOM に依存しない）。座標は m で、x が右（東）、y が上、z が前（北）。撮影者のセンサーは
 * 原点の上の高さ EYE にあり、向きだけを変える。ピントの距離の目安になるよう、解像チャートはセンサーから
 * 前へ 0.5〜16 m の面に置く。同じデータから、ブラウザの光線追跡（GLSL）とピント合わせの交差判定（TS）を作る
 */

import { MAPS } from '../jupiter/grs';
import { R0, R1, ringSurge } from '../saturn/rings';

export type V3 = [number, number, number];

/** センサーの中心の高さ [m] */
export const EYE = 1.2;

/** 解像チャート（ジーメンススター）の板: 中心・星の半径・距離の表記 */
export interface Board {
  c: V3;
  r: number;
  label: string;
}
const deg = Math.PI / 180;
export const BOARDS: Board[] = (
  [
    [0.5, -15, -7.5, '0.5'],
    [1, -9, -5.5, '1'],
    [2, -3, -3.8, '2'],
    [4, 3, -2.2, '4'],
    [8, 9, -1, '8'],
    [16, 15, 1, '16'],
  ] as const
).map(([d, az, el, label]) => ({
  c: [d * Math.tan(az * deg), EYE + d * Math.tan(el * deg), d],
  r: 0.036 * d,
  label,
}));
/** 板の範囲（星の半径を単位にした左右・上・下） */
export const BOARD_W = 1.3,
  BOARD_T = 1.3,
  BOARD_B = 2.05;

/** 縦の円柱（柱と、板・電飾の支柱）: x, z, 半径, 高さ, 色 */
export interface Cyl {
  x: number;
  z: number;
  r: number;
  h: number;
  col: V3;
  /** 白い横縞を付ける */
  band?: boolean;
}
const POLE: V3 = [0.09, 0.09, 0.1];
export const CYLS: Cyl[] = [
  { x: 7 * Math.tan(-12 * deg), z: 7, r: 0.2, h: 2.4, col: [0.62, 0.1, 0.07], band: true },
  { x: 13 * Math.tan(6 * deg), z: 13, r: 0.28, h: 3.0, col: [0.07, 0.2, 0.55], band: true },
  { x: 18 * Math.tan(-21 * deg), z: 18, r: 0.34, h: 3.4, col: [0.7, 0.52, 0.08], band: true },
  { x: 24 * Math.tan(21 * deg), z: 24, r: 0.4, h: 3.8, col: [0.1, 0.4, 0.16], band: true },
  ...BOARDS.map((b) => ({ x: b.c[0], z: b.c[2], r: b.r * 0.07, h: b.c[1] - b.r * BOARD_B, col: POLE })),
  { x: -13, z: 19, r: 0.06, h: 4.7, col: POLE },
  { x: 5, z: 19, r: 0.06, h: 4.7, col: POLE },
];

/** 奥の壁（暗い地に白い格子、1 m ごと） */
export const WALL = { z: 30, x0: -40, x1: 6, h: 6, grid: 1, line: 0.05 } as const;

/** 電飾の電球: 中心・半径・放射輝度（RGB） */
export interface Bulb {
  c: V3;
  r: number;
  e: V3;
}
/** 両端の高さ y0 から中央で sag だけ垂れる紐に、n 個を等間隔に吊るす */
function string(
  n: number,
  x0: number,
  x1: number,
  z: number,
  y0: number,
  sag: number,
  r: number,
  e: (i: number) => V3,
): Bulb[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i + 0.5) / n,
      x = x0 + (x1 - x0) * t;
    return { c: [x, y0 - sag * (1 - (2 * t - 1) ** 2), z] as V3, r, e: e(i) };
  });
}
const WARM: V3 = [26, 17, 8];
const COLORS: V3[] = [
  [24, 3, 2],
  [4, 18, 5],
  [3, 7, 26],
  [24, 14, 2],
  [20, 18, 16],
];
/** 電飾の紐（遠・中・手前）。描画は紐ごとに外接箱で先に判定する */
export const STRINGS: Bulb[][] = [
  string(26, -13, 5, 19, 4.6, 1.2, 0.045, () => WARM),
  string(14, -3.2, 2.6, 10, 2.7, 0.45, 0.025, (i) => COLORS[i % COLORS.length]),
  string(7, 0.08, 0.3, 0.85, 1.06, 0.012, 0.0035, () => [14, 9, 4.5]),
];

/** 遠景の山の稜線の仰角 [rad]（方位角 az [rad] の関数） */
export const ridge = (az: number): number =>
  0.018 + 0.012 * Math.sin(2.3 * az + 0.7) + 0.007 * Math.sin(5.9 * az + 2.1) + 0.003 * Math.sin(13 * az);

/* ---------- 空の天体（無限遠） ---------- */
/**
 * 空に置く天体: 方位・仰角 [°]（配置はこのツールで決めた。月は緑の柱の上、惑星は互いに離して低い空に並べる）、赤道半径 [km] と地球からの距離 [km] で決まる
 * 角半径、極の向きの回し [°]（北が上で 0、左回りが正）と、こちらから見た極の傾き（環の開き）[°]
 */
export interface SkyBody {
  id: 'moon' | 'venus' | 'mars' | 'jupiter' | 'saturn' | 'uranus';
  name: string;
  az: number;
  el: number;
  /** 赤道半径・距離 [km] */
  r: number;
  dist: number;
  rot: number;
  tilt: number;
}
/**
 * 大きさは NASA の Planetary Fact Sheet の値: 月は平均距離、外惑星は地球に最も近づくとき（衝）の距離、
 * 金星は最大離角のころの距離 √(1² − 0.72333²) AU = 1.0330 億 km。
 * 全体を同じ向き（衝のころ、太陽を背にして満ちて見える）として、影と満ち欠けは描かない
 */
export const SKY: SkyBody[] = [
  { id: 'venus', name: '金星', az: -30, el: 12, r: 6051.8, dist: 103.3e6, rot: 0, tilt: 0 },
  { id: 'mars', name: '火星', az: -8, el: 20, r: 3396.2, dist: 54.6e6, rot: 0, tilt: 15 },
  { id: 'uranus', name: '天王星', az: 8, el: 17, r: 25559, dist: 2580.6e6, rot: 30, tilt: 55 },
  { id: 'moon', name: '月', az: 21, el: 8, r: 1737.4, dist: 384400, rot: 0, tilt: 0 },
  { id: 'jupiter', name: '木星', az: 40, el: 14, r: 71492, dist: 588.5e6, rot: 0, tilt: 0 },
  { id: 'saturn', name: '土星', az: 55, el: 9, r: 60268, dist: 1205.5e6, rot: -6, tilt: 20 },
];
/** 天体の角半径 [rad] */
export const angRadius = (b: SkyBody): number => Math.asin(b.r / b.dist);

/** 天体の中心の向きと、空の上の右・上の単位ベクトル（極の向きで回したもの） */
export function bodyFrame(b: SkyBody): { c: V3; e1: V3; e2: V3 } {
  const a = b.az * deg,
    e = b.el * deg,
    q = b.rot * deg;
  const c: V3 = [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
  const r: V3 = [Math.cos(a), 0, -Math.sin(a)],
    u: V3 = [-Math.sin(a) * Math.sin(e), Math.cos(e), -Math.cos(a) * Math.sin(e)];
  const mix = (x: V3, y: V3, s: number, t: number): V3 => [
    x[0] * s + y[0] * t,
    x[1] * s + y[1] * t,
    x[2] * s + y[2] * t,
  ];
  return { c, e1: mix(r, u, Math.cos(q), Math.sin(q)), e2: mix(r, u, -Math.sin(q), Math.cos(q)) };
}

/** 木星の扁平率と、ガリレオ衛星（木星の赤道半径を単位にした空の上の位置・半径、幾何アルベド） */
const JUP = { flat: 0.06487, albedo: 0.538 } as const;
const GALILEAN = [
  /* イオ・エウロパ・ガニメデ・カリスト。軌道長半径は 421.8・671.1・1070.4・1882.7 千 km で、その内側に置く */
  { x: 4.4, y: 0.05, r: 1821.5, a: 0.62, col: [1, 0.92, 0.7] },
  { x: -7.6, y: -0.1, r: 1560.8, a: 0.68, col: [1, 0.97, 0.92] },
  { x: 12.3, y: 0.15, r: 2631.2, a: 0.44, col: [0.95, 0.93, 0.9] },
  { x: -22.8, y: -0.3, r: 2410.3, a: 0.19, col: [0.86, 0.82, 0.78] },
] as const;
/** 土星・火星の扁平率 */
const SAT = { flat: 0.09796 } as const;
const MARS = { flat: 0.00589 } as const;
/**
 * 天体の円盤の平均の明るさ: 幾何アルベド p を太陽からの距離 r [AU]（軌道長半径）の 2 乗で割った値。
 * 昼の、日光に正面から照らされた反射率 1 の面を 1 とする
 */
export const ALBEDO = {
  moon: 0.12,
  venus: 0.689 / 0.72333 ** 2,
  mars: 0.17 / 1.52366 ** 2,
  jupiter: 0.538 / 5.2034 ** 2,
  saturn: 0.499 / 9.5726 ** 2,
  uranus: 0.488 / 19.165 ** 2,
} as const;
/** 模様を式で描く天体の面の明るさの倍率（模様と周縁減光の平均（およそ）で割る） */
const DISK = {
  venus: ALBEDO.venus / 0.88,
  uranus: ALBEDO.uranus / 0.66,
} as const;

/* ---------- 模様の地図（月・火星・木星・土星） ---------- */
/**
 * 月・木星・土星はそれぞれのページと同じ地図を使う（出典は各ページの SOURCES.md）。月は満月で、経度 0°・緯度 0° を正面にする。
 * 木星は最新の地図で大赤斑が中央の少し右に来る中央経線にし、土星は模様の帯と環の表を使う。
 * 火星は USGS の Viking の全球の色の地図（出典は SOURCES.md）で、大シルチスとヘラスが見える向きにする
 */
const JMAP = MAPS[MAPS.length - 1];
export const TEX = {
  moon: 'moon/color8.jpg',
  jupiter: `jupiter/${JMAP.file}.webp`,
  saturn: 'saturn/s2025a.webp',
  ring: 'saturn/rings.bin',
  mars: 'lens/mars.webp',
} as const;
export type MapId = 'moon' | 'mars' | 'jupiter' | 'saturn';
/** 月の地図の範囲: 経度 −100°〜+100°、緯度 +90°〜−90° */
const MOON_LON = 100;
/** 木星の中央経線（System III の西経 [°]）。地図は左端が西経 0°で、右へ西経が減る */
const JUP_CM = JMAP.grsL3 + 20;
/** 火星の中央経線（東経 [°]）。地図は左端が東経 −180°で、右へ東経が増える */
const MARS_CM = 60;
/**
 * 周縁減光（Minnaert 則、衝なので μ₀ = μ で μ^(2k−1)）の k: 木星・土星はそのページと同じ値、火星はおよその値。
 * 環と本体の明るさの比も土星のページの倍率（1.25 と 1.2）にそろえ、衝のころの位相角 0.3° の増光を掛ける
 */
export const MINN = { mars: [0.7, 0.7, 0.7], jupiter: [0.999, 0.95, 0.85], saturn: [0.8, 0.72, 0.62] } as const;
export const RING_K = (1.25 / 1.2) * ringSurge(0.3);
/** 環の表の範囲（土星の赤道半径が単位） */
const RING = { r0: R0 / 60268, r1: R1 / 60268 } as const;

/**
 * 扁平な天体の円盤の点 (x, y)（赤道半径が 1、右・上）を、こちらへ sin B だけ極を傾けた回転楕円体に当てる。
 * 当たれば [中央経線からの経度（右が正）, 惑星図緯度, μ（法線と視線の余弦）, 手前への距離] [rad] を返す。GLSL の spheroid と同じ
 */
export function spheroid(x: number, y: number, tilt: number, flat: number): [number, number, number, number] | null {
  const sB = Math.sin(tilt * deg),
    cB = Math.cos(tilt * deg),
    ib = 1 / (1 - flat) ** 2;
  const A = cB * cB + sB * sB * ib,
    B = 2 * y * sB * cB * (ib - 1),
    C = x * x + y * y * (sB * sB + cB * cB * ib) - 1,
    D = B * B - 4 * A * C;
  if (D < 0) return null;
  const t = (-B + Math.sqrt(D)) / (2 * A);
  const x2 = -sB * y + cB * t,
    x3 = (cB * y + sB * t) * ib;
  const nz = cB * x2 + sB * x3,
    n = Math.hypot(x, x2, x3);
  return [Math.atan2(x, x2), Math.atan2(x3, Math.hypot(x, x2)), Math.max(nz / n, 1e-3), t];
}

/** 地図の座標（u は右、v は下へ増える）。月・火星・木星・土星の円盤の点 (x, y) から。当たらなければ null */
export function mapUv(id: MapId, x: number, y: number): { u: number; v: number; mu: number } | null {
  const b = SKY.find((k) => k.id === id) as SkyBody;
  const g = spheroid(x, y, b.tilt, { moon: 0, mars: MARS.flat, jupiter: JUP.flat, saturn: SAT.flat }[id]);
  if (!g) return null;
  const lon = g[0] / deg,
    v = 0.5 - g[1] / Math.PI;
  if (id === 'moon') return { u: (lon + MOON_LON) / (2 * MOON_LON), v, mu: g[2] };
  if (id === 'mars') return { u: (MARS_CM + 180 + lon) / 360, v, mu: g[2] };
  if (id === 'jupiter') return { u: (360 - JUP_CM + lon) / 360, v, mu: g[2] };
  return { u: 0.5, v, mu: g[2] };
}

/** 面の明るさの周縁減光（RGB） */
export function limb(id: MapId, mu: number): [number, number, number] {
  if (id === 'moon') {
    const m = 0.88 + 0.12 * mu;
    return [m, m, m];
  }
  const k = MINN[id];
  return [mu ** (2 * k[0] - 1), mu ** (2 * k[1] - 1), mu ** (2 * k[2] - 1)];
}

/**
 * 時間帯（昼・夕暮れ・夜）: 地上の物体の明るさ、天体の倍率（景色に合わせて上げた露出）、電飾、町の灯。
 * 空は地平・中ほど・天頂の色、山並みの色
 */
export const TOD = [
  {
    obj: 1.5,
    sky: 1.5,
    lamp: 0.15,
    town: 0,
    hor: [0.62, 0.68, 0.78],
    mid: [0.36, 0.5, 0.78],
    top: [0.2, 0.34, 0.7],
    mnt: [0.3, 0.35, 0.45],
  },
  {
    obj: 1,
    sky: 5,
    lamp: 1,
    town: 1,
    hor: [0.26, 0.17, 0.2],
    mid: [0.07, 0.08, 0.17],
    top: [0.012, 0.022, 0.06],
    mnt: [0.022, 0.026, 0.04],
  },
  {
    obj: 0.06,
    sky: 20,
    lamp: 1,
    town: 1,
    hor: [0.012, 0.011, 0.016],
    mid: [0.004, 0.005, 0.01],
    top: [0.0015, 0.002, 0.0045],
    mnt: [0.002, 0.002, 0.003],
  },
] as const;

/** 天王星の扁平率と ε 環（半径 51,149 km、幅 20〜96 km の平均、アルベド 0.018 を本体の 0.488 と比べる） */
const URA = { flat: 0.02293, ring: 51149, width: 58, albedo: 0.018 / 0.488, op: 0.9 } as const;

/* ---------- 交差判定（ピント合わせ用） ---------- */
/** 光線（m）が最初に当たる物体までの距離。空（無限遠）なら Infinity */
export function intersect(o: V3, d: V3): number {
  let t = Infinity;
  if (d[1] < 0) t = Math.min(t, -o[1] / d[1]);
  if (d[2] > 1e-9) {
    const tw = (WALL.z - o[2]) / d[2],
      x = o[0] + d[0] * tw,
      y = o[1] + d[1] * tw;
    if (tw > 0 && x > WALL.x0 && x < WALL.x1 && y > 0 && y < WALL.h) t = Math.min(t, tw);
    for (const b of BOARDS) {
      const tb = (b.c[2] - o[2]) / d[2],
        u = (o[0] + d[0] * tb - b.c[0]) / b.r,
        v = (o[1] + d[1] * tb - b.c[1]) / b.r;
      if (tb > 0 && Math.abs(u) < BOARD_W && v < BOARD_T && v > -BOARD_B) t = Math.min(t, tb);
    }
  }
  for (const c of CYLS) {
    const tc = cyl(o, d, c);
    if (tc < t) t = tc;
  }
  for (const L of STRINGS)
    for (const b of L) {
      const ts = sphere(o, d, b.c, b.r);
      if (ts < t) t = ts;
    }
  return t;
}

function cyl(o: V3, d: V3, c: Cyl): number {
  const ox = o[0] - c.x,
    oz = o[2] - c.z;
  const a = d[0] * d[0] + d[2] * d[2],
    b = ox * d[0] + oz * d[2],
    cc = ox * ox + oz * oz - c.r * c.r;
  const disc = b * b - a * cc;
  if (a < 1e-12 || disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / a,
    y = o[1] + d[1] * t;
  return t > 0 && y > 0 && y < c.h ? t : Infinity;
}

function sphere(o: V3, d: V3, c: V3, r: number): number {
  const ox = o[0] - c[0],
    oy = o[1] - c[1],
    oz = o[2] - c[2];
  const b = ox * d[0] + oy * d[1] + oz * d[2],
    cc = ox * ox + oy * oy + oz * oz - r * r,
    disc = b * b - cc;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : Infinity;
}

/** 撮影者の向き（方位 pan・仰角 tilt [°]）の右・上・前の単位ベクトル */
export function basis(pan: number, tilt: number): { r: V3; u: V3; f: V3 } {
  const p = pan * deg,
    t = tilt * deg;
  return {
    r: [Math.cos(p), 0, -Math.sin(p)],
    u: [-Math.sin(p) * Math.sin(t), Math.cos(t), -Math.cos(p) * Math.sin(t)],
    f: [Math.sin(p) * Math.cos(t), Math.sin(t), Math.cos(p) * Math.cos(t)],
  };
}

/* ---------- GLSL ---------- */
const f = (x: number) => {
  const s = x.toPrecision(7);
  return /[.e]/.test(s) ? s : `${s}.`;
};
const v3 = (a: V3) => `vec3(${a.map(f).join(',')})`;
const v4 = (a: number[]) => `vec4(${a.map(f).join(',')})`;
/** 7 セグメントの数字（bit 0〜6 が a〜g）。10 は小数点 */
const SEG = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];

/** 被写体の放射輝度 vec3 radiance(vec3 ro, vec3 rd)（m 単位の光線）を返す GLSL */
export function sceneGlsl(): string {
  const bulbs = STRINGS.flat();
  const boxes = STRINGS.map((L) => {
    const lo = [0, 1, 2].map((k) => Math.min(...L.map((b) => b.c[k] - b.r)) - 1e-3),
      hi = [0, 1, 2].map((k) => Math.max(...L.map((b) => b.c[k] + b.r)) + 1e-3);
    return [lo, hi];
  });
  let k = 0;
  const ranges = STRINGS.map((L) => {
    const a = k;
    k += L.length;
    return [a, k];
  });
  /* 板の表記: 1 枚あたり 3 文字（数字 0〜9、小数点 10、なし −1） */
  const lbl = BOARDS.flatMap((b) => {
    const cs = [...b.label].map((ch) => (ch === '.' ? 10 : Number(ch)));
    while (cs.length < 3) cs.push(-1);
    return cs;
  });
  const fr = SKY.map(bodyFrame);
  const byId = (id: SkyBody['id']) => SKY.findIndex((b) => b.id === id);
  const rUnit = (id: SkyBody['id']) => SKY[byId(id)].r;
  /** 環の開き B のときの、本体の楕円の縦の半軸（赤道半径を 1） */
  const minor = (flat: number, tilt: number) =>
    Math.sqrt(Math.sin(tilt * deg) ** 2 + ((1 - flat) * Math.cos(tilt * deg)) ** 2);
  const sat = SKY[byId('saturn')],
    jup = SKY[byId('jupiter')],
    mars = SKY[byId('mars')],
    ura = SKY[byId('uranus')];
  const arr = (k: 'hor' | 'mid' | 'top' | 'mnt') => `vec3[3](${TOD.map((t) => v3([...t[k]] as V3)).join(',')})`;
  return `
/* 時間帯（0 昼・1 夕暮れ・2 夜）: 地上の物体・天体・電飾・町の灯の倍率と、空・山並みの色 */
uniform int uTod;
const vec4 TODK[3] = vec4[3](${TOD.map((t) => v4([t.obj, t.sky, t.lamp, t.town])).join(',')});
const vec3 SKH[3] = ${arr('hor')};
const vec3 SKM[3] = ${arr('mid')};
const vec3 SKT[3] = ${arr('top')};
const vec3 MNT[3] = ${arr('mnt')};

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

/* 空の天体: 中心の向き・右・上（極で回したもの）・角半径 */
const int NK = ${SKY.length};
const vec3 KC[NK] = vec3[NK](${fr.map((x) => v3(x.c)).join(',')});
const vec3 KE1[NK] = vec3[NK](${fr.map((x) => v3(x.e1)).join(',')});
const vec3 KE2[NK] = vec3[NK](${fr.map((x) => v3(x.e2)).join(',')});
const float KR[NK] = float[NK](${SKY.map((b) => f(angRadius(b))).join(',')});
const vec4 GAL[4] = vec4[4](${GALILEAN.map((g) => v4([g.x, g.y, g.r / rUnit('jupiter'), g.a / JUP.albedo])).join(',')});
const vec3 GALC[4] = vec3[4](${GALILEAN.map((g) => v3([...g.col] as V3)).join(',')});
/* 模様の地図（月・木星・土星）と環の表。倍率は地図の円盤の平均が幾何アルベドになる値（sky-tex.ts） */
uniform sampler2D uTexMoon, uTexJup, uTexSat, uTexRing, uTexMars;
uniform vec4 uTexK;
uniform float uTexKM;

/* 天体 i の面の座標（赤道半径を 1、右・上）。後ろ向きなら遠い値 */
vec2 bodyUV(vec3 d, int i) {
  float w = dot(d, KC[i]);
  if (w <= 0.0) return vec2(1e9);
  return vec2(dot(d, KE1[i]), dot(d, KE2[i])) / (w * KR[i]);
}

/* 円盤の点 p（赤道半径が 1）を、極を sin B だけこちらへ傾けた回転楕円体（極半径の比 b）に当てる。
   中央経線からの経度（右が正）・惑星図緯度・μ・手前への距離を返す。TS の spheroid と同じ */
bool spheroid(vec2 p, float sB, float cB, float b, out vec4 g) {
  float ib = 1.0 / (b * b);
  float A = cB * cB + sB * sB * ib, B = 2.0 * p.y * sB * cB * (ib - 1.0);
  float C = p.x * p.x + p.y * p.y * (sB * sB + cB * cB * ib) - 1.0, D = B * B - 4.0 * A * C;
  if (D < 0.0) return false;
  float t = (-B + sqrt(D)) / (2.0 * A);
  float x2 = -sB * p.y + cB * t, x3 = (cB * p.y + sB * t) * ib;
  g = vec4(atan(p.x, x2), atan(x3, length(vec2(p.x, x2))), max((cB * x2 + sB * x3) / length(vec3(p.x, x2, x3)), 1e-3), t);
  return true;
}

/* 満月: LROC WAC の色の地図。経度 0°・緯度 0° が正面 */
vec3 moonAt(vec2 p) {
  vec4 g;
  if (!spheroid(p, 0.0, 1.0, 1.0, g)) return vec3(0.0);
  vec2 uv = vec2(degrees(g.x) / ${f(2 * MOON_LON)} + 0.5, 0.5 - g.y / PI);
  return textureLod(uTexMoon, uv, 0.0).rgb * uTexK.x * (0.88 + 0.12 * g.z);
}

/* 木星: OPAL の地図と Minnaert 則の周縁減光。周りにガリレオ衛星 */
vec3 jupiterAt(vec2 p, vec3 bg) {
  for (int i = 0; i < 4; i++) {
    vec4 g = GAL[i];
    vec2 q = (p - g.xy) / g.z;
    float r2 = dot(q, q);
    if (r2 < 1.0) return GALC[i] * g.w * ${f(ALBEDO.jupiter / 0.87)} * (0.6 + 0.4 * sqrt(1.0 - r2));
  }
  vec4 g;
  if (!spheroid(p, ${f(Math.sin(jup.tilt * deg))}, ${f(Math.cos(jup.tilt * deg))}, ${f(1 - JUP.flat)}, g)) return bg;
  vec2 uv = vec2(${f((360 - JUP_CM) / 360)} + g.x / (2.0 * PI), 0.5 - g.y / PI);
  return textureLod(uTexJup, uv, 0.0).rgb * uTexK.y * pow(vec3(g.z), ${v3(MINN.jupiter.map((k) => 2 * k - 1) as V3)});
}

/* 土星: OPAL の模様の帯と、Cassini の掩蔽から作った環の表。手前の環は本体の前、奥の環は本体の後ろ */
vec3 saturnAt(vec2 p, vec3 bg) {
  float sB = ${f(Math.sin(sat.tilt * deg))}, cB = ${f(Math.cos(sat.tilt * deg))};
  vec4 g;
  float tp = -1e9;
  vec3 behind = bg;
  if (spheroid(p, sB, cB, ${f(1 - SAT.flat)}, g)) {
    tp = g.w;
    behind = textureLod(uTexSat, vec2(0.5, 0.5 - g.y / PI), 0.0).rgb * uTexK.z * pow(vec3(g.z), ${v3(MINN.saturn.map((k) => 2 * k - 1) as V3)});
  }
  float rr = length(vec2(p.x, p.y / sB)), tr = -p.y * cB / sB;
  if (rr < ${f(RING.r0)} || rr >= ${f(RING.r1)} || tr < tp) return behind;
  vec4 t = textureLod(uTexRing, vec2((rr - ${f(RING.r0)}) / ${f(RING.r1 - RING.r0)}, 0.5), 0.0);
  float tau = -log(1.0 - min(t.a, 0.998));
  /* 単散乱（衝なので μ₀ = μ = sin B）。後ろの光は透けた分だけ通す */
  return t.rgb * uTexK.w * 0.5 * (1.0 - exp(-2.0 * tau / sB)) + exp(-tau / sB) * behind;
}

/* 天王星: 青緑の本体と ε 環。環は実際の幅（約 ${URA.width} km）と明るさのまま、画素より細い幅を広げた帯に光の量を保って薄める */
vec3 uranusAt(vec2 p, vec3 bg) {
  float b = ${f(minor(URA.flat, ura.tilt))}, sb = ${f(Math.sin(ura.tilt * deg))};
  float r2 = p.x * p.x + (p.y / b) * (p.y / b);
  vec3 behind = bg;
  bool inG = r2 < 1.0;
  if (inG) behind = vec3(0.63, 0.86, 0.9) * ${f(DISK.uranus)} * (0.5 + 0.5 * sqrt(1.0 - r2));
  float rr = length(vec2(p.x, p.y / sb)), we = 0.02;
  if (abs(rr - ${f(URA.ring / ura.r)}) < we && !(inG && p.y > 0.0)) {
    float k = ${f(URA.width / 2 / ura.r)} / we;
    return vec3(0.6, 0.6, 0.6) * ${f(DISK.uranus * URA.albedo)} * k + (1.0 - ${f(URA.op)} * k) * behind;
  }
  return behind;
}

/* 金星: 模様のない淡い黄白色の雲 */
vec3 venusAt(vec2 p) {
  float mu = sqrt(max(1.0 - dot(p, p), 0.0));
  return vec3(1.0, 0.97, 0.86) * ${f(DISK.venus)} * (0.8 + 0.2 * mu);
}

/* 火星: Viking の色の地図（極冠を含む）と Minnaert 則の周縁減光 */
vec3 marsAt(vec2 p) {
  vec4 g;
  if (!spheroid(p, ${f(Math.sin(mars.tilt * deg))}, ${f(Math.cos(mars.tilt * deg))}, ${f(1 - MARS.flat)}, g)) return vec3(0.0);
  vec2 uv = vec2(${f((MARS_CM + 180) / 360)} + g.x / (2.0 * PI), 0.5 - g.y / PI);
  return textureLod(uTexMars, uv, 0.0).rgb * uTexKM * pow(vec3(g.z), ${v3(MINN.mars.map((k) => 2 * k - 1) as V3)});
}

/* 天体の放射輝度（宇宙の背景は 0）。空の光は天体の手前の大気から来るので、呼ぶ側で足す */
vec3 celestial(vec3 d) {
  vec3 bg = vec3(0.0);
  vec2 p = bodyUV(d, ${byId('moon')});
  if (dot(p, p) < 1.0) return moonAt(p);
  p = bodyUV(d, ${byId('jupiter')});
  if (dot(p, p) < 900.0) return jupiterAt(p, bg);
  p = bodyUV(d, ${byId('saturn')});
  if (dot(p, p) < 6.0) return saturnAt(p, bg);
  p = bodyUV(d, ${byId('uranus')});
  if (dot(p, p) < 4.5) return uranusAt(p, bg);
  p = bodyUV(d, ${byId('venus')});
  if (dot(p, p) < 1.0) return venusAt(p);
  p = bodyUV(d, ${byId('mars')});
  if (dot(p, p) < 1.0) return marsAt(p);
  return bg;
}

const int NB = ${BOARDS.length};
const vec4 BRD[NB] = vec4[NB](${BOARDS.map((b) => v4([...b.c, b.r])).join(',')});
const int LBL[NB * 3] = int[NB * 3](${lbl.join(',')});
const int SEG[10] = int[10](${SEG.join(',')});
const int NC = ${CYLS.length};
const vec4 CYL[NC] = vec4[NC](${CYLS.map((c) => v4([c.x, c.z, c.r, c.h])).join(',')});
const vec4 CYC[NC] = vec4[NC](${CYLS.map((c) => v4([...c.col, c.band ? 1 : 0])).join(',')});
const int NL = ${bulbs.length};
const vec4 BLB[NL] = vec4[NL](${bulbs.map((b) => v4([...b.c, b.r])).join(',')});
const vec3 BLE[NL] = vec3[NL](${bulbs.map((b) => v3(b.e)).join(',')});
const vec3 SLO[3] = vec3[3](${boxes.map((b) => v3(b[0] as V3)).join(',')});
const vec3 SHI[3] = vec3[3](${boxes.map((b) => v3(b[1] as V3)).join(',')});
const ivec2 SRG[3] = ivec2[3](${ranges.map(([a, b]) => `ivec2(${a},${b})`).join(',')});
const vec3 LDIR = normalize(vec3(-0.4, 0.8, -0.45));

float ridge(float az) {
  return 0.018 + 0.012 * sin(2.3 * az + 0.7) + 0.007 * sin(5.9 * az + 2.1) + 0.003 * sin(13.0 * az);
}

/* 空（時間帯の色）と天体、遠景の山並みと町の灯（無限遠） */
vec3 sky(vec3 d) {
  float el = asin(clamp(d.y, -1.0, 1.0)), az = atan(d.x, d.z);
  float rg = ridge(az);
  if (el < rg) {
    vec3 c = MNT[uTod];
    vec2 g = vec2(az, el) / 0.004;
    vec2 cell = floor(g);
    float hs = hash12(cell + 17.0);
    if (hs < 0.32 && el < rg - 0.002) {
      vec2 pc = (cell + 0.2 + 0.6 * vec2(hash12(cell + 3.1), hash12(cell + 7.7))) * 0.004;
      vec2 dd = vec2((az - pc.x) * cos(el), el - pc.y);
      if (dot(dd, dd) < 0.0006 * 0.0006) c += mix(vec3(9.0, 6.0, 2.6), vec3(6.0, 7.0, 8.0), step(0.24, hs)) * TODK[uTod].w;
    }
    return c;
  }
  float s = clamp(el / 0.6, 0.0, 1.0);
  vec3 hor = SKH[uTod], mid = SKM[uTod], top = SKT[uTod];
  return celestial(d) * TODK[uTod].y + (s < 0.25 ? mix(hor, mid, s / 0.25) : mix(mid, top, (s - 0.25) / 0.75));
}

float seg7(vec2 p, int m) {
  /* 1 文字は幅 0.6・高さ 1.0（左下が原点） */
  float w = 0.11, on = 0.0;
  if ((m & 1) != 0 && abs(p.y - 1.0) < w && p.x > 0.05 && p.x < 0.55) on = 1.0;
  if ((m & 2) != 0 && abs(p.x - 0.55) < w && p.y > 0.5 && p.y < 0.95) on = 1.0;
  if ((m & 4) != 0 && abs(p.x - 0.55) < w && p.y > 0.05 && p.y < 0.5) on = 1.0;
  if ((m & 8) != 0 && abs(p.y) < w && p.x > 0.05 && p.x < 0.55) on = 1.0;
  if ((m & 16) != 0 && abs(p.x - 0.05) < w && p.y > 0.05 && p.y < 0.5) on = 1.0;
  if ((m & 32) != 0 && abs(p.x - 0.05) < w && p.y > 0.5 && p.y < 0.95) on = 1.0;
  if ((m & 64) != 0 && abs(p.y - 0.5) < w && p.x > 0.05 && p.x < 0.55) on = 1.0;
  return on;
}

/* 板の模様: ジーメンススター（36 本）、外周の環、下に距離の数字 */
float board(int i, vec2 uv) {
  if (abs(uv.x) > ${f(BOARD_W)} - 0.04 || uv.y > ${f(BOARD_T)} - 0.04 || uv.y < -${f(BOARD_B)} + 0.04) return 0.03;
  float r = length(uv);
  if (r < 1.0) {
    if (r < 0.05) return 0.45;
    float a = atan(uv.y, uv.x);
    return mod(floor(a / 6.2831853 * 36.0 + 36.0), 2.0) < 0.5 ? 0.03 : 0.82;
  }
  if (r < 1.06) return 0.03;
  /* 数字（高さ 0.6、中央にそろえる） */
  float wd = 0.0;
  for (int j = 0; j < 3; j++) {
    int c = LBL[i * 3 + j];
    if (c >= 0) wd += c == 10 ? 0.3 : 0.78;
  }
  vec2 p = (uv - vec2(-wd * 0.3, -1.9)) / 0.6;
  float x = 0.0;
  for (int j = 0; j < 3; j++) {
    int c = LBL[i * 3 + j];
    if (c < 0) break;
    if (c == 10) {
      if (length(p - vec2(x + 0.15, 0.06)) < 0.1) return 0.03;
      x += 0.3;
    } else {
      if (seg7(p - vec2(x + 0.04, 0.0), SEG[c]) > 0.5) return 0.03;
      x += 0.78;
    }
  }
  return 0.82;
}

bool boxHit(vec3 ro, vec3 ird, vec3 lo, vec3 hi, float tmax) {
  vec3 t0 = (lo - ro) * ird, t1 = (hi - ro) * ird;
  vec3 a = min(t0, t1), b = max(t0, t1);
  float tn = max(max(a.x, a.y), a.z), tf = min(min(b.x, b.y), b.z);
  return tf > max(tn, 0.0) && tn < tmax;
}

vec3 radiance(vec3 ro, vec3 rd) {
  float t = 1e20;
  int id = 0;
  vec3 nrm = vec3(0.0, 1.0, 0.0);
  if (rd.y < 0.0) { t = -ro.y / rd.y; id = 1; }
  if (rd.z > 1e-6) {
    float tw = (${f(WALL.z)} - ro.z) / rd.z;
    vec3 p = ro + rd * tw;
    if (tw < t && p.x > ${f(WALL.x0)} && p.x < ${f(WALL.x1)} && p.y > 0.0 && p.y < ${f(WALL.h)}) { t = tw; id = 2; nrm = vec3(0.0, 0.0, -1.0); }
    for (int i = 0; i < NB; i++) {
      vec4 b = BRD[i];
      float tb = (b.z - ro.z) / rd.z;
      if (tb <= 0.0 || tb >= t) continue;
      vec2 uv = (ro.xy + rd.xy * tb - b.xy) / b.w;
      if (abs(uv.x) < ${f(BOARD_W)} && uv.y < ${f(BOARD_T)} && uv.y > -${f(BOARD_B)}) { t = tb; id = 10 + i; nrm = vec3(0.0, 0.0, -1.0); }
    }
  }
  for (int i = 0; i < NC; i++) {
    vec4 c = CYL[i];
    vec2 o = ro.xz - c.xy;
    float a = dot(rd.xz, rd.xz), b = dot(o, rd.xz), cc = dot(o, o) - c.z * c.z;
    float disc = b * b - a * cc;
    if (disc < 0.0 || a < 1e-12) continue;
    float tc = (-b - sqrt(disc)) / a;
    float y = ro.y + rd.y * tc;
    if (tc > 0.0 && tc < t && y > 0.0 && y < c.w) {
      t = tc; id = 30 + i;
      nrm = vec3(o.x + rd.x * tc, 0.0, o.y + rd.z * tc) / c.z;
    }
  }
  vec3 ird = 1.0 / rd;
  for (int s = 0; s < 3; s++) {
    if (!boxHit(ro, ird, SLO[s], SHI[s], t)) continue;
    for (int i = SRG[s].x; i < SRG[s].y; i++) {
      vec4 b = BLB[i];
      vec3 o = ro - b.xyz;
      float bb = dot(o, rd), cc = dot(o, o) - b.w * b.w, disc = bb * bb - cc;
      if (disc < 0.0) continue;
      float ts = -bb - sqrt(disc);
      if (ts > 0.0 && ts < t) { t = ts; id = 100 + i; }
    }
  }
  if (id == 0) return sky(rd);
  if (id >= 100) return BLE[id - 100] * TODK[uTod].z;
  vec3 p = ro + rd * t, alb;
  if (id == 1) {
    vec2 q = floor(p.xz / 0.5);
    float ck = mod(q.x + q.y, 2.0);
    alb = mix(vec3(0.2, 0.195, 0.185), vec3(0.32, 0.31, 0.29), ck);
    /* 遠くは縞が細かくなりすぎるので平均の色へ寄せる */
    alb = mix(alb, vec3(0.26, 0.252, 0.238), smoothstep(60.0, 400.0, t));
  } else if (id == 2) {
    vec2 g = abs(fract(p.xy / ${f(WALL.grid)} + 0.5) - 0.5) * ${f(WALL.grid)};
    alb = min(g.x, g.y) < ${f(WALL.line / 2)} ? vec3(0.78, 0.78, 0.75) : vec3(0.06, 0.065, 0.075);
  } else if (id < 30) {
    vec4 b = BRD[id - 10];
    alb = vec3(board(id - 10, (p.xy - b.xy) / b.w));
  } else {
    vec4 c = CYC[id - 30];
    alb = c.rgb;
    if (c.w > 0.5 && fract(p.y / 0.4) < 0.1) alb = vec3(0.8);
  }
  return alb * (0.4 + 0.6 * max(dot(nrm, LDIR), 0.0)) * TODK[uTod].x;
}
`;
}
