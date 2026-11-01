/**
 * 場面の定義: 長方形と球と材質と光源。シェーダへ渡す uniform の配列へ詰める
 */
import { glass, light, type Material, METALS, metal, surface, type Vec3 } from '../../lib/brdf';

export interface Quad {
  p: Vec3;
  u: Vec3;
  v: Vec3;
  m: number;
}
export interface Sphere {
  c: Vec3;
  r: number;
  m: number;
}
export interface Camera {
  eye: Vec3;
  at: Vec3;
  /** 縦の画角の半分の tan */
  fov: number;
  /** 絞りの半径 */
  lens: number;
  focus: number;
}

/** 光源の種類（シェーダの uLitK と同じ番号） */
export const LIGHT_KIND = { rect: 0, sphere: 1, point: 2, sky: 3 } as const;
export type LightKind = keyof typeof LIGHT_KIND;

export interface LightSpec {
  kind: LightKind;
  /** 四角の 1 辺・球の直径 [m] */
  size: number;
  /** 明るさの倍率 */
  power: number;
  /** 色温度 [K] */
  kelvin: number;
}

export const DEFAULT_LIGHT: LightSpec = { kind: 'rect', size: 0.5, power: 1, kelvin: 4000 };

export interface Scene {
  id: string;
  mats: Material[];
  quads: Quad[];
  spheres: Sphere[];
  light: {
    kind: number;
    /** 四角の角・球の中心・点の位置 */
    p: Vec3;
    u: Vec3;
    v: Vec3;
    /** 四角の面積・球の半径 */
    a: number;
    /** 四角の放射の向き */
    n: Vec3;
    /** 光源の材質の番号（点と空は −1） */
    m: number;
    /** 放射輝度（点は放射強度） */
    e: Vec3;
  };
  cam: Camera;
}

export const SCENES = [
  ['spheres', '球'],
  ['blocks', '箱'],
  ['rough', '粗さ'],
  ['caustic', 'ガラス'],
  ['dof', 'ぼけ'],
] as const;

/**
 * 色温度から、輝度 1 の線形 sRGB へ。プランク軌跡の xy は Kang ら 2002 の 3 次の近似（1667〜25000 K）。
 * 負になる成分は 0 にする
 */
export function kelvinRgb(T: number): Vec3 {
  const a = 1e9 / T ** 3,
    b = 1e6 / T ** 2,
    c = 1e3 / T;
  const x =
    T <= 4000
      ? -0.2661239 * a - 0.234358 * b + 0.8776956 * c + 0.17991
      : -3.0258469 * a + 2.1070379 * b + 0.2226347 * c + 0.24039;
  const y =
    T <= 2222
      ? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683
      : T <= 4000
        ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
        : 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
  const X = x / y,
    Z = (1 - x - y) / y;
  const r = Math.max(0, 3.2406 * X - 1.5372 - 0.4986 * Z),
    g = Math.max(0, -0.9689 * X + 1.8758 + 0.0415 * Z),
    bl = Math.max(0, 0.0557 * X - 0.204 + 1.057 * Z),
    l = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  return [r / l, g / l, bl / l];
}

const WHITE = surface([0.73, 0.73, 0.73]);
const RED = surface([0.65, 0.05, 0.05]);
const GREEN = surface([0.12, 0.45, 0.15]);

/** 四角の光源の放射輝度 × 1 辺² */
const RECT_K = 7.2;
/** 空の放射輝度 */
const SKY_L = 0.7;
const LIGHT_MAT = 3;

export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];

type Room = Pick<Scene, 'mats' | 'quads' | 'spheres' | 'light'>;

/** 箱の部屋: 幅 2・高さ 2・奥行き 2、手前は開いている。光の総量は光源の大きさに依らない。空のときは天井を外す */
function room(L: LightSpec): Room {
  const rgb = kelvinRgb(L.kelvin),
    s = L.size;
  const quads: Quad[] = [
    { p: [-1, 0, 1], u: [2, 0, 0], v: [0, 0, -2], m: 0 },
    { p: [-1, 0, -1], u: [2, 0, 0], v: [0, 2, 0], m: 0 },
    { p: [-1, 0, 1], u: [0, 0, -2], v: [0, 2, 0], m: 1 },
    { p: [1, 0, -1], u: [0, 0, 2], v: [0, 2, 0], m: 2 },
  ];
  if (L.kind !== 'sky') quads.push({ p: [-1, 2, -1], u: [2, 0, 0], v: [0, 0, 2], m: 0 });
  const spheres: Sphere[] = [];
  const base = { u: [0, 0, 0] as Vec3, v: [0, 0, 0] as Vec3, n: [0, -1, 0] as Vec3 };
  let lit: Scene['light'];
  let emit: Vec3 = [0, 0, 0];
  switch (L.kind) {
    case 'sphere': {
      const r = Math.min(s / 2, 0.45);
      emit = scale(rgb, (L.power * RECT_K) / (Math.PI * 4 * r * r));
      spheres.push({ c: [0, 1.5, 0.1], r, m: LIGHT_MAT });
      lit = { ...base, kind: LIGHT_KIND.sphere, p: [0, 1.5, 0.1], a: r, m: LIGHT_MAT, e: emit };
      break;
    }
    case 'point':
      lit = { ...base, kind: LIGHT_KIND.point, p: [0, 1.45, 0.1], a: 0, m: -1, e: scale(rgb, (L.power * RECT_K) / 4) };
      break;
    case 'sky':
      lit = { ...base, kind: LIGHT_KIND.sky, p: [0, 0, 0], a: 0, m: -1, e: scale(rgb, L.power * SKY_L) };
      break;
    default: {
      emit = scale(rgb, (L.power * RECT_K) / (s * s));
      const q: Quad = { p: [-s / 2, 1.998, -s / 2], u: [s, 0, 0], v: [0, 0, s], m: LIGHT_MAT };
      quads.push(q);
      lit = {
        kind: LIGHT_KIND.rect,
        p: q.p,
        u: q.u,
        v: q.v,
        a: s * s,
        n: norm(cross(q.u, q.v)),
        m: LIGHT_MAT,
        e: emit,
      };
    }
  }
  return { mats: [WHITE, RED, GREEN, light(emit)], quads, spheres, light: lit };
}

const CAM: Camera = { eye: [0, 1, 4.4], at: [0, 1, 0], fov: 0.3, lens: 0, focus: 4.4 };

/** 長方形 5 枚の直方体（底は描かない）。y 軸まわりに回す */
function block(cx: number, cz: number, w: number, h: number, d: number, deg: number, m: number): Quad[] {
  const a = (deg * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  const U: Vec3 = [w * c, 0, -w * s],
    V: Vec3 = [d * s, 0, d * c],
    Y: Vec3 = [0, h, 0];
  const o: Vec3 = [cx - (U[0] + V[0]) / 2, 0, cz - (U[2] + V[2]) / 2];
  const add = (x: Vec3, y: Vec3): Vec3 => [x[0] + y[0], x[1] + y[1], x[2] + y[2]];
  return [
    { p: add(o, Y), u: U, v: V, m },
    { p: o, u: U, v: Y, m },
    { p: add(o, V), u: U, v: Y, m },
    { p: o, u: V, v: Y, m },
    { p: add(o, U), u: V, v: Y, m },
  ];
}

/** 場面を作る。材質は部屋の 4 つのあとに足す */
export function makeScene(id: string, L: LightSpec = DEFAULT_LIGHT): Scene {
  const R = room(L),
    b = R.mats.length;
  switch (id) {
    case 'blocks':
      return {
        id,
        ...R,
        quads: [...R.quads, ...block(0.34, 0.34, 0.6, 0.6, 0.6, -17, 0), ...block(-0.34, -0.3, 0.6, 1.2, 0.6, 17, 0)],
        cam: CAM,
      };
    case 'rough': {
      const rs = [0, 0.15, 0.3, 0.5, 0.8];
      return {
        id,
        ...R,
        mats: [...R.mats, ...rs.map((r) => metal(METALS.gold, r))],
        spheres: [...R.spheres, ...rs.map((_, i) => ({ c: [-0.72 + 0.36 * i, 0.17, 0.1] as Vec3, r: 0.17, m: b + i }))],
        cam: CAM,
      };
    }
    case 'caustic':
      return {
        id,
        ...R,
        mats: [...R.mats, glass(1.5)],
        spheres: [...R.spheres, { c: [0, 0.5, 0.1], r: 0.5, m: b }],
        cam: CAM,
      };
    case 'dof':
      return {
        id,
        ...R,
        mats: [
          ...R.mats,
          metal(METALS.copper, 0.25),
          surface([0.1, 0.25, 0.6], { spec: 0.5, rough: 0.3 }),
          metal(METALS.silver, 0),
        ],
        spheres: [
          ...R.spheres,
          { c: [-0.5, 0.25, -0.6], r: 0.25, m: b },
          { c: [0, 0.25, 0.1], r: 0.25, m: b + 1 },
          { c: [0.45, 0.25, 0.75], r: 0.25, m: b + 2 },
        ],
        cam: { ...CAM, lens: 0.06, focus: 4.3 },
      };
    default:
      return {
        id: 'spheres',
        ...R,
        mats: [...R.mats, glass(1.5), metal(METALS.silver, 0.08)],
        spheres: [
          ...R.spheres,
          { c: [0.42, 0.36, 0.42], r: 0.36, m: b },
          { c: [-0.42, 0.36, -0.28], r: 0.36, m: b + 1 },
        ],
        cam: CAM,
      };
  }
}

/** カメラを注視点のまわりに回す（方位・仰角 [°]） */
export function orbit(c: Camera, yaw: number, pitch: number): Camera {
  const r = Math.hypot(c.eye[0] - c.at[0], c.eye[1] - c.at[1], c.eye[2] - c.at[2]),
    y = (yaw * Math.PI) / 180,
    p = (pitch * Math.PI) / 180;
  return {
    ...c,
    eye: [c.at[0] + r * Math.cos(p) * Math.sin(y), c.at[1] + r * Math.sin(p), c.at[2] + r * Math.cos(p) * Math.cos(y)],
  };
}

export const MAX_QUADS = 16;
export const MAX_SPHERES = 6;
export const MAX_MATS = 9;

export interface PackedScene {
  quad: Float32Array;
  sph: Float32Array;
  mat: Float32Array;
  lit: Float32Array;
  litE: Float32Array;
  litK: number;
  nq: number;
  ns: number;
}

/** uniform の配列へ詰める。長方形は vec4 が 4 個、球は 2 個、材質は 3 個、光源は 4 個 */
export function packScene(sc: Scene): PackedScene {
  const quad = new Float32Array(MAX_QUADS * 16),
    sph = new Float32Array(MAX_SPHERES * 8),
    mat = new Float32Array(MAX_MATS * 12);
  sc.quads.forEach((q, i) => {
    const n = norm(cross(q.u, q.v)),
      uu = dot(q.u, q.u),
      vv = dot(q.v, q.v);
    quad.set(
      [
        q.p[0],
        q.p[1],
        q.p[2],
        q.m,
        q.u[0] / uu,
        q.u[1] / uu,
        q.u[2] / uu,
        0,
        q.v[0] / vv,
        q.v[1] / vv,
        q.v[2] / vv,
        0,
        n[0],
        n[1],
        n[2],
        dot(n, q.p),
      ],
      i * 16,
    );
  });
  sc.spheres.forEach((s, i) => {
    sph.set([s.c[0], s.c[1], s.c[2], s.r, s.m, 0, 0, 0], i * 8);
  });
  sc.mats.forEach((m, i) => {
    mat.set(
      [
        m.base[0],
        m.base[1],
        m.base[2],
        m.metal,
        m.emit[0],
        m.emit[1],
        m.emit[2],
        m.rough * m.rough,
        m.spec,
        m.ior,
        m.kind,
        0,
      ],
      i * 12,
    );
  });
  const L = sc.light;
  const lit = Float32Array.of(
    L.p[0],
    L.p[1],
    L.p[2],
    L.a,
    L.u[0],
    L.u[1],
    L.u[2],
    0,
    L.v[0],
    L.v[1],
    L.v[2],
    0,
    L.n[0],
    L.n[1],
    L.n[2],
    L.m,
  );
  return {
    quad,
    sph,
    mat,
    lit,
    litE: Float32Array.from(L.e),
    litK: L.kind,
    nq: sc.quads.length,
    ns: sc.spheres.length,
  };
}
