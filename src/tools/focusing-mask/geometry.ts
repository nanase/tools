/**
 * 幾何光学で見たマスク（DOM に依存しない）。開口の一部（区画）を通った光の像は、ピントがずれると
 * 区画の重心 c に比例して −(Δz/f)·c だけずれる（焦点の奥では上下が入れ替わる）。格子の区画の光条は、その点を通り
 * 格子の向き（法線）に伸びる直線になる。区画の重心は開口を描いて求めるので、桟・中央遮蔽・スパイダーも効く
 */
import { type Mask, type Scope, transmit } from './mask';

type V2 = [number, number];

/** 区画: 重心（半径を 1 とした開口の座標）と、光条の向き（格子の法線。穴は null）、開いた面積の割合 */
export interface Section {
  c: V2;
  dir: V2 | null;
  w: number;
}

/** バーティノフの区画の番号（y < 0 の半円 = 0、上の左 = 1、上の右 = 2）。マスクの座標 */
const bahtinovPart = (u: number, v: number): number => (v < 0 ? 0 : u < 0 ? 1 : 2);

/**
 * マスクの区画（マスクの座標）を返す関数と、区画ごとの光条の向き（マスクの座標）。
 * 番号は、バーティノフが [中央, X の片方, X のもう片方]、トライ・バーティノフは扇ごとにその 3 つ、
 * キャリーは [左上, 左下, 右上, 右下]、穴は穴の順
 */
function layout(sc: Scope, m: Mask): { part: (u: number, v: number) => number; dirs: (V2 | null)[] } {
  const c = Math.cos(m.th),
    s = Math.sin(m.th);
  switch (m.kind) {
    case 'bahtinov':
      return {
        part: bahtinovPart,
        dirs: [
          [1, 0],
          [c, s],
          [c, -s],
        ],
      };
    case 'tri': {
      const rmid = Math.max(0.55, (1 + sc.obs) / 2),
        dirs: V2[] = [];
      const sector = (u: number, v: number) => Math.round((Math.atan2(v, u) - Math.PI / 2) / ((2 * Math.PI) / 3));
      for (let k = 0; k < 3; k++) {
        /* 扇の中心線（角度 c0）を上に向けた座標 (uu, vv) から、マスクの座標へ戻す回転 */
        const c0 = Math.PI / 2 + (k * 2 * Math.PI) / 3,
          a = c0 - Math.PI / 2,
          rot = ([x, y]: V2): V2 => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
        /* 扇の中のバーティノフ: x = vv − rmid、y = uu。法線 (1, 0)・(c, s)・(c, −s) は (x, y) の向き → (uu, vv) = (y, x) */
        dirs.push(rot([0, 1]), rot([s, c]), rot([-s, c]));
      }
      return {
        part: (u, v) => {
          const k = ((sector(u, v) % 3) + 3) % 3,
            a = -(Math.PI / 2 + (k * 2 * Math.PI) / 3 - Math.PI / 2),
            uu = u * Math.cos(a) - v * Math.sin(a),
            vv = u * Math.sin(a) + v * Math.cos(a);
          return k * 3 + bahtinovPart(vv - rmid, uu);
        },
        dirs,
      };
    }
    case 'carey': {
      const h1 = m.th / 2,
        h2 = (m.th2 ?? (m.th * 10) / 12) / 2;
      return {
        part: (u, v) => (u < 0 ? (v >= 0 ? 0 : 1) : v >= 0 ? 2 : 3),
        dirs: [
          [Math.cos(h1), Math.sin(h1)],
          [Math.cos(h1), -Math.sin(h1)],
          [Math.cos(h2), Math.sin(h2)],
          [Math.cos(h2), -Math.sin(h2)],
        ],
      };
    }
    case 'hartmann':
    case 'scheiner': {
      const n = m.kind === 'scheiner' ? 2 : m.holes;
      return {
        part: (u, v) => {
          let best = 0,
            bd = Infinity;
          for (let i = 0; i < n; i++) {
            const a = Math.PI / 2 + (2 * Math.PI * i) / n,
              d = Math.hypot(u - m.hr * Math.cos(a), v - m.hr * Math.sin(a));
            if (d < bd) {
              bd = d;
              best = i;
            }
          }
          return best;
        },
        dirs: Array.from({ length: n }, () => null),
      };
    }
    default:
      return { part: () => 0, dirs: [null] };
  }
}

/** 区画の重心と光条の向き（開口の座標。マスクの回転を含む） */
export function sections(sc: Scope, m: Mask, n = 400): Section[] {
  const { part, dirs } = layout(sc, m),
    acc = dirs.map(() => [0, 0, 0]),
    px = 2 / n,
    cr = Math.cos(m.rot),
    sr = Math.sin(m.rot);
  let all = 0;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = -1 + (i + 0.5) * px,
        y = -1 + (j + 0.5) * px,
        t = transmit(x, y, sc, m, px);
      if (x * x + y * y <= 1) all++;
      if (t <= 0) continue;
      const u = x * cr + y * sr,
        v = -x * sr + y * cr,
        k = part(u, v),
        a = acc[k];
      a[0] += t;
      a[1] += t * x;
      a[2] += t * y;
    }
  /* 向きはマスクの座標 → 開口の座標へ回す */
  const turn = ([u, v]: V2): V2 => [u * cr - v * sr, u * sr + v * cr];
  return acc.map(([w, sx, sy], k) => ({
    c: w > 0 ? [sx / w, sy / w] : [0, 0],
    dir: dirs[k] ? turn(dirs[k] as V2) : null,
    w: w / all,
  }));
}

/** 区画 k の像の位置（センサーの上、µm）。D・f は mm、dz は µm */
const spot = (s: Section, D: number, f: number, dz: number): V2 => [
  (-dz / f) * s.c[0] * (D / 2),
  (-dz / f) * s.c[1] * (D / 2),
];

/** 2 本の直線（点 p・向き d）の交点 */
function cross(p1: V2, d1: V2, p2: V2, d2: V2): V2 {
  const det = d1[0] * -d2[1] - d1[1] * -d2[0],
    t = ((p2[0] - p1[0]) * -d2[1] - (p2[1] - p1[1]) * -d2[0]) / det;
  return [p1[0] + t * d1[0], p1[1] + t * d1[1]];
}

/**
 * バーティノフ型の 3 本の光条（中央 a、X の b・c）で、X の交点から中央の光条までの距離（µm、符号つき）。
 * 中央の光条の法線 (−d_y, d_x) の向きで測り、像から測る measure.ts の fitBahtinov の off と同じ向き
 */
function tripletOffset(a: Section, b: Section, c: Section, D: number, f: number, dz: number): number {
  const pa = spot(a, D, f, dz),
    x = cross(spot(b, D, f, dz), b.dir as V2, spot(c, D, f, dz), c.dir as V2),
    d = a.dir as V2;
  return (pa[0] - x[0]) * -d[1] + (pa[1] - x[1]) * d[0];
}

/** マスクごとの読み値（ピントのずれ dz µm のとき） */
export interface Reading {
  /** バーティノフ: 中央の光条と X の交点の距離。トライは扇ごとの 3 つ、キャリーは 2 つの X の交点の距離。穴は像の間隔の最大 */
  v: number[];
}

export function reading(kind: Mask['kind'], S: Section[], D: number, f: number, dz: number): Reading {
  switch (kind) {
    case 'bahtinov':
      return { v: [tripletOffset(S[0], S[1], S[2], D, f, dz)] };
    case 'tri':
      return { v: [0, 1, 2].map((k) => tripletOffset(S[3 * k], S[3 * k + 1], S[3 * k + 2], D, f, dz)) };
    case 'carey': {
      const xl = cross(spot(S[0], D, f, dz), S[0].dir as V2, spot(S[1], D, f, dz), S[1].dir as V2),
        xr = cross(spot(S[2], D, f, dz), S[2].dir as V2, spot(S[3], D, f, dz), S[3].dir as V2),
        d = S[0].dir as V2;
      return { v: [(xr[0] - xl[0]) * d[0] + (xr[1] - xl[1]) * d[1]] };
    }
    case 'hartmann':
    case 'scheiner': {
      const p = S.map((s) => spot(s, D, f, dz));
      let mx = 0;
      for (let i = 0; i < p.length; i++)
        for (let j = i + 1; j < p.length; j++) mx = Math.max(mx, Math.hypot(p[i][0] - p[j][0], p[i][1] - p[j][1]));
      return { v: [mx] };
    }
    default:
      return { v: [] };
  }
}
