/**
 * カードの図柄の輪郭。発散の速さ ν の場を格子で計算し、等値線をマーチングスクエアで閉じた path にする。
 * 外周の 1 列を外とみなすので、輪郭はどれも閉じる（はみ出た分は svg の枠で切れる）
 */
import { type Formula, nu } from './formula';

/** 格子の間隔（viewBox の単位） */
const GS = 0.75;
const r1 = (v: number): number => Math.round(v * 10) / 10;

export interface Grid {
  nx: number;
  ny: number;
  v: Float32Array;
  x0: number;
  y0: number;
}

function grid(x0: number, y0: number, x1: number, y1: number, fn: (x: number, y: number) => number): Grid {
  const nx = Math.round((x1 - x0) / GS) + 3,
    ny = Math.round((y1 - y0) / GS) + 3,
    v = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const edge = i === 0 || j === 0 || i === nx - 1 || j === ny - 1;
      v[j * nx + i] = edge ? -1 : fn(x0 + (i - 1) * GS, y0 + (j - 1) * GS);
    }
  return { nx, ny, v, x0: x0 - GS, y0: y0 - GS };
}

/**
 * viewBox の矩形 (x0, y0)〜(x1, y1) に、中心 (cx, cy)・1 単位あたり s の複素平面を写した場。
 * 虚軸は下向き（ページの図と同じ）。J を渡すとジュリア集合。発散の判定の半径は 2（|z_k| = 2 の線が ν = k + 1）
 */
export function field(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  s: number,
  f: Formula,
  N: number,
  J?: readonly [number, number],
): Grid {
  const mx = (x0 + x1) / 2,
    my = (y0 + y1) / 2;
  return grid(x0, y0, x1, y1, (x, y) => nu(cx + (x - mx) * s, cy + (y - my) * s, f, N, 2, J));
}

/** 値 L の等値線を、閉じた折れ線の path の d にする */
export function iso(G: Grid, L: number): string {
  const { nx, ny, v, x0, y0 } = G,
    pts = new Map<string, [number, number]>(),
    segs: [string, string][] = [];
  const E = (i: number, j: number, h: boolean): string => {
    const k = `${h ? 'h' : 'v'}${i},${j}`;
    if (!pts.has(k)) {
      const a = v[j * nx + i],
        b = h ? v[j * nx + i + 1] : v[(j + 1) * nx + i],
        t = (L - a) / (b - a);
      pts.set(k, h ? [x0 + (i + t) * GS, y0 + j * GS] : [x0 + i * GS, y0 + (j + t) * GS]);
    }
    return k;
  };
  for (let j = 0; j < ny - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const a = v[j * nx + i],
        b = v[j * nx + i + 1],
        c = v[(j + 1) * nx + i + 1],
        d = v[(j + 1) * nx + i];
      const code = (a >= L ? 8 : 0) | (b >= L ? 4 : 0) | (c >= L ? 2 : 0) | (d >= L ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const T = () => E(i, j, true),
        R = () => E(i + 1, j, false),
        B = () => E(i, j + 1, true),
        Lf = () => E(i, j, false),
        add = (p: () => string, q: () => string) => segs.push([p(), q()]),
        mid = (a + b + c + d) / 4 >= L;
      switch (code) {
        case 1:
        case 14:
          add(Lf, B);
          break;
        case 2:
        case 13:
          add(B, R);
          break;
        case 3:
        case 12:
          add(Lf, R);
          break;
        case 4:
        case 11:
          add(T, R);
          break;
        case 6:
        case 9:
          add(T, B);
          break;
        case 7:
        case 8:
          add(Lf, T);
          break;
        /* 鞍点: 4 隅の平均で、つながる向きを決める */
        case 5:
          if (mid) {
            add(Lf, T);
            add(B, R);
          } else {
            add(T, R);
            add(Lf, B);
          }
          break;
        case 10:
          if (mid) {
            add(T, R);
            add(Lf, B);
          } else {
            add(Lf, T);
            add(B, R);
          }
          break;
      }
    }
  const adj = new Map<string, number[]>();
  segs.forEach(([p, q], s) => {
    for (const k of [p, q]) {
      const l = adj.get(k);
      if (l) l.push(s);
      else adj.set(k, [s]);
    }
  });
  const used = new Uint8Array(segs.length);
  let out = '';
  for (let s0 = 0; s0 < segs.length; s0++) {
    if (used[s0]) continue;
    used[s0] = 1;
    const [st, c0] = segs[s0];
    let cur = c0;
    const path = [pts.get(st) as [number, number], pts.get(cur) as [number, number]];
    for (;;) {
      const nxt = adj.get(cur)?.find((s) => !used[s]);
      if (nxt === undefined) break;
      used[nxt] = 1;
      const [p, q] = segs[nxt];
      cur = p === cur ? q : p;
      if (cur === st) break;
      const P = pts.get(cur) as [number, number],
        last = path[path.length - 1];
      if (Math.hypot(P[0] - last[0], P[1] - last[1]) > 0.5) path.push(P);
    }
    if (path.length > 2) out += `M${path.map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L')}Z`;
  }
  return out;
}
