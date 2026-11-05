/** クラスタリングのデータ。座標は幅 1.6・高さ 1 の箱 */
import { type Data, gauss, rng, shuffle } from './core';

export const BOX = { w: 1.6, h: 1 };

type Pt = [number, number, number];
const GEN: Record<string, (n: number, r: () => number) => Pt[]> = {
  blobs(n, r) {
    const C = [
      [0.36, 0.3],
      [1.22, 0.32],
      [0.8, 0.74],
    ];
    return Array.from({ length: n }, (_, i) => {
      const c = i % 3;
      return [C[c][0] + gauss(r) * 0.075, C[c][1] + gauss(r) * 0.075, c];
    });
  },
  aniso(n, r) {
    const X = [0.32, 0.8, 1.28],
      th = 0.9;
    return Array.from({ length: n }, (_, i) => {
      const c = i % 3,
        a = gauss(r) * 0.24,
        b = gauss(r) * 0.035;
      return [X[c] + a * Math.cos(th) - b * Math.sin(th), 0.5 + a * Math.sin(th) + b * Math.cos(th), c];
    });
  },
  varied(n, r) {
    const C = [
      [0.32, 0.72, 0.035],
      [0.72, 0.24, 0.07],
      [1.16, 0.56, 0.15],
    ];
    return Array.from({ length: n }, (_, i) => {
      const u = i / n,
        c = u < 0.2 ? 0 : u < 0.5 ? 1 : 2;
      return [C[c][0] + gauss(r) * C[c][2], C[c][1] + gauss(r) * C[c][2], c];
    });
  },
  /* 三日月は先端を相手の円の中心の近くへ置く。先端と相手の弧の隙間を半径の 0.7 倍にする */
  moons(n, r) {
    return Array.from({ length: n }, (_, i) => {
      const c = i % 2,
        a = ((Math.floor(i / 2) + r()) / Math.ceil(n / 2)) * Math.PI,
        R = 0.42,
        s = 0.022;
      return c === 0
        ? [0.59 + R * Math.cos(a) + gauss(r) * s, 0.565 - R * Math.sin(a) + gauss(r) * s, 0]
        : [1.01 - R * Math.cos(a) + gauss(r) * s, 0.435 + R * Math.sin(a) + gauss(r) * s, 1];
    });
  },
  circles(n, r) {
    return Array.from({ length: n }, (_, i) => {
      const c = i % 3 === 0 ? 1 : 0,
        a = ((i + r()) / n) * 6 * Math.PI,
        R = c ? 0.17 : 0.42,
        s = 0.022;
      return [0.8 + R * Math.cos(a) + gauss(r) * s, 0.5 + R * Math.sin(a) + gauss(r) * s, c];
    });
  },
  spiral(n, r) {
    return Array.from({ length: n }, (_, i) => {
      const c = i % 2,
        u = Math.sqrt((Math.floor(i / 2) + r()) / Math.ceil(n / 2)),
        a = u * 2.6 * Math.PI + c * Math.PI,
        R = 0.05 + u * 0.42,
        s = 0.01;
      return [0.8 + R * Math.cos(a) + gauss(r) * s, 0.5 + R * Math.sin(a) + gauss(r) * s, c];
    });
  },
  uniform(n, r) {
    return Array.from({ length: n }, () => [0.05 + r() * 1.5, 0.05 + r() * 0.9, 0]);
  },
};

/** データの一覧。eps・h・nn は点の数 300 のときの既定のパラメータの基準 */
export const DATA = [
  { id: 'blobs', name: '塊', k: 3, eps: 0.07, h: 0.13, nn: 8 },
  { id: 'aniso', name: '細長い塊', k: 3, eps: 0.055, h: 0.1, nn: 8 },
  { id: 'varied', name: '大小の塊', k: 3, eps: 0.06, h: 0.12, nn: 8 },
  { id: 'moons', name: '三日月', k: 2, eps: 0.06, h: 0.11, nn: 7 },
  { id: 'circles', name: '同心円', k: 2, eps: 0.07, h: 0.075, nn: 7 },
  { id: 'spiral', name: '渦巻き', k: 2, eps: 0.05, h: 0.05, nn: 5 },
  { id: 'uniform', name: '一様分布', k: 3, eps: 0.09, h: 0.16, nn: 8 },
] as const;
export type DataId = (typeof DATA)[number]['id'];
export const dataOf = (id: string) => DATA.find((d) => d.id === id);

function fromPoints(pts: Pt[], id: string, k: number, none: boolean): Data {
  const n = pts.length,
    d: Data = { id, n, x: new Float64Array(n), y: new Float64Array(n), t: new Int16Array(n), k, none };
  pts.forEach((p, i) => {
    d.x[i] = Math.min(BOX.w - 0.01, Math.max(0.01, p[0]));
    d.y[i] = Math.min(BOX.h - 0.01, Math.max(0.01, p[1]));
    d.t[i] = p[2];
  });
  return d;
}

/** データを作る。outlier は全体のうち一様に足す外れ値の割合 */
export function makeData(id: DataId, n: number, seed: number, outlier = 0): Data {
  const r = rng(seed * 7919 + id.length * 131),
    m = Math.round(n * outlier),
    pts = GEN[id](n - m, r),
    D = dataOf(id);
  for (let i = 0; i < m; i++) pts.push([0.03 + r() * 1.54, 0.03 + r() * 0.94, -1]);
  shuffle(pts, r);
  return fromPoints(pts, id, D?.k ?? 1, id === 'uniform');
}

/** 手で描いた点からデータを作る */
export function drawnData(x: readonly number[], y: readonly number[], t: readonly number[]): Data {
  const k = new Set(t).size || 1;
  return fromPoints(
    x.map((v, i) => [v, y[i], t[i]]),
    'draw',
    k,
    k < 2,
  );
}

/** 既定のパラメータの基準 */
export interface Ctx {
  k: number;
  eps: number;
  h: number;
  nn: number;
  n: number;
}
const ctxCache = new WeakMap<Data, Ctx>();
export function ctxOf(d: Data): Ctx {
  let c = ctxCache.get(d);
  if (!c) {
    c = makeCtx(d);
    ctxCache.set(d, c);
  }
  return c;
}
function makeCtx(d: Data): Ctx {
  const D = dataOf(d.id);
  if (D) {
    /* 半径は点の間隔に合わせて sqrt(300 / n)、近傍数はその逆に変える */
    const sc = Math.sqrt(300 / d.n);
    return {
      k: D.k,
      eps: +(D.eps * sc).toFixed(3),
      h: D.h,
      nn: Math.max(4, Math.round(D.nn * Math.sqrt(d.n / 300))),
      n: d.n,
    };
  }
  /* 描いたデータは点の間隔から決める */
  const nn = new Float64Array(d.n);
  for (let i = 0; i < d.n; i++) {
    let m = Infinity;
    for (let j = 0; j < d.n; j++) if (i !== j) m = Math.min(m, (d.x[i] - d.x[j]) ** 2 + (d.y[i] - d.y[j]) ** 2);
    nn[i] = Math.sqrt(m);
  }
  const s = Array.from(nn).sort((a, b) => a - b),
    med = s[Math.floor(d.n / 2)] || 0.02,
    q9 = s[Math.floor(d.n * 0.92)] || 0.03;
  return {
    k: Math.max(2, d.k),
    eps: +Math.max(0.03, Math.min(0.16, Math.max(med * 3.2, q9 * 1.6))).toFixed(3),
    h: +Math.max(0.05, Math.min(0.3, med * 5.5)).toFixed(3),
    nn: Math.min(24, Math.max(5, Math.round(7 * Math.sqrt(d.n / 300)))),
    n: d.n,
  };
}
