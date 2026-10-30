/**
 * 鏡像法（DOM に依存しない）: 直方体の部屋の鏡像の音源を並べ、反射の経路と波面を求める（Allen・Berkley 1979）。
 * 軸ごとに鏡像の位置は (1 − 2p)·s + 2n·L（p ∈ {0, 1}、n は整数）で、手前の面（0）に |n − p| 回、
 * 奥の面（L）に |n| 回当たる。反射の振幅は面ごとに β = √(1 − α) を当たった回数だけ掛ける。
 * 吸音率 1 の面（開放）に当たる鏡像は振幅 0 なので数えない
 */
import { airDb, alphas, BANDS, C0, NB, type Room, type Vec3 } from './room';

/** 鏡像の音源の並び（構造体の配列ではなく、項目ごとの配列） */
export interface Images {
  n: number;
  /** 位置 [m] */
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  /** 聞き手までの距離 [m] と、届く時刻 [s] */
  r: Float64Array;
  t: Float64Array;
  /** 反射の回数 */
  order: Uint16Array;
  /** 帯域ごとの振幅（1 m で 1 の直接音に対して。距離と空気の吸収を含む）。i 番目の鏡像の帯域 b は amp[i·NB + b] */
  amp: Float64Array;
  /** 軸ごとの (p, n)（経路を描くときに使う）。i 番目は idx[6i]〜idx[6i + 5] = px, nx, py, ny, pz, nz */
  idx: Int32Array;
  /** 数えきった時刻 [s]（これより前に届く鏡像はすべて含む） */
  tEnd: number;
}

export interface ImageOpts {
  /** この時刻 [s] までに届く鏡像を数える */
  tMax: number;
  /** 鏡像の数の上限（超えそうなら tMax を縮める） */
  nMax?: number;
  /** 反射の回数の上限 */
  orderMax?: number;
  c?: number;
}

/** 体積 V の部屋で、半径 R の球に入る鏡像の数の目安 4πR³ / 3V（Kuttruff） */
export const imageCount = (R: number, V: number): number => (4 * Math.PI * R ** 3) / (3 * V);

/** 鏡像を数える。届く時刻の順に並べる */
export function images(room: Room, o: ImageOpts): Images {
  const c = o.c ?? C0,
    [W, D, H] = room.dim,
    L = [W, D, H],
    s = room.src,
    q = room.rcv,
    al = alphas(room),
    beta = al.map((a) => a.map((x) => Math.sqrt(Math.max(0, 1 - x)))),
    air = airDb(room.air),
    /* 開いた面（どの帯域でも反射しない） */
    open = beta.map((b) => b.every((x) => x === 0)),
    orderMax = o.orderMax ?? 1e9;
  /* 鏡像が多すぎる部屋では、数えきれる時刻まで縮める */
  let tEnd = o.tMax;
  if (o.nMax) {
    const V = W * D * H,
      R = Math.cbrt((3 * V * o.nMax) / (4 * Math.PI));
    if (imageCount(c * tEnd, V) > o.nMax) tEnd = R / c;
  }
  const R = c * tEnd;
  /* 軸ごとに、聞き手からの距離が R 以内の (p, n, 座標, 手前の面の回数, 奥の面の回数) を並べる */
  type Ax = { p: number; n: number; u: number; h0: number; h1: number }[];
  const axes: Ax[] = [0, 1, 2].map((k) => {
    const out: Ax = [],
      N = Math.ceil(R / (2 * L[k])) + 1;
    for (let n = -N; n <= N; n++)
      for (let p = 0; p < 2; p++) {
        const u = (1 - 2 * p) * s[k] + 2 * n * L[k];
        const h0 = Math.abs(n - p),
          h1 = Math.abs(n);
        if ((h0 && open[2 * k]) || (h1 && open[2 * k + 1])) continue;
        if (Math.abs(u - q[k]) <= R) out.push({ p, n, u, h0, h1 });
      }
    return out;
  });
  const list: { x: number; y: number; z: number; r: number; o: number; g: number[]; i: number[] }[] = [],
    R2 = R * R;
  for (const ax of axes[0]) {
    const dx = ax.u - q[0];
    for (const ay of axes[1]) {
      const dy = ay.u - q[1],
        dxy = dx * dx + dy * dy;
      if (dxy > R2) continue;
      for (const az of axes[2]) {
        const dz = az.u - q[2],
          d2 = dxy + dz * dz;
        if (d2 > R2) continue;
        const hits = [ax.h0, ax.h1, ay.h0, ay.h1, az.h0, az.h1],
          order = hits.reduce((a, b) => a + b, 0);
        if (order > orderMax) continue;
        const r = Math.max(Math.sqrt(d2), 1e-3),
          g: number[] = [];
        let any = false;
        for (let b = 0; b < NB; b++) {
          let v = 1 / r;
          for (let f = 0; f < 6; f++) if (hits[f]) v *= beta[f][b] ** hits[f];
          v *= 10 ** ((-air[b] * r) / 20);
          g.push(v);
          if (v > 0) any = true;
        }
        if (!any) continue;
        list.push({ x: ax.u, y: ay.u, z: az.u, r, o: order, g, i: [ax.p, ax.n, ay.p, ay.n, az.p, az.n] });
      }
    }
  }
  list.sort((a, b) => a.r - b.r);
  const n = list.length,
    out: Images = {
      n,
      x: new Float64Array(n),
      y: new Float64Array(n),
      z: new Float64Array(n),
      r: new Float64Array(n),
      t: new Float64Array(n),
      order: new Uint16Array(n),
      amp: new Float64Array(n * NB),
      idx: new Int32Array(n * 6),
      tEnd,
    };
  list.forEach((m, i) => {
    out.x[i] = m.x;
    out.y[i] = m.y;
    out.z[i] = m.z;
    out.r[i] = m.r;
    out.t[i] = m.r / c;
    out.order[i] = m.o;
    for (let b = 0; b < NB; b++) out.amp[i * NB + b] = m.g[b];
    for (let k = 0; k < 6; k++) out.idx[i * 6 + k] = m.i[k];
  });
  return out;
}

/** 区間 [0, L] へ折り返す（鏡像の空間から部屋の中へ戻す） */
export function fold(u: number, L: number): number {
  const m = ((u % (2 * L)) + 2 * L) % (2 * L);
  return m > L ? 2 * L - m : m;
}

/**
 * i 番目の鏡像から聞き手までの反射の経路（音源 → 反射点 … → 聞き手）。
 * 鏡像の空間で聞き手と鏡像を結ぶ直線が面 u = k·L を横切る点を、部屋の中へ折り返したものが反射点
 */
export function path(room: Room, im: Images, i: number): Vec3[] {
  const L = room.dim,
    q = room.rcv,
    I: Vec3 = [im.x[i], im.y[i], im.z[i]],
    cross: { s: number; k: number }[] = [];
  for (let k = 0; k < 3; k++) {
    const a = q[k],
      b = I[k];
    if (a === b) continue;
    /* a と b の間にある L の倍数（端は含めない） */
    const lo = Math.min(a, b),
      hi = Math.max(a, b);
    for (let m = Math.floor(lo / L[k]) + 1; m * L[k] < hi; m++) cross.push({ s: (m * L[k] - a) / (b - a), k });
  }
  cross.sort((u, v) => u.s - v.s);
  const pts: Vec3[] = [room.src];
  for (let j = cross.length - 1; j >= 0; j--) {
    const s = cross[j].s;
    pts.push([0, 1, 2].map((k) => fold(q[k] + s * (I[k] - q[k]), L[k])) as unknown as Vec3);
  }
  pts.push(q);
  return pts;
}

/** 上から見た図の波面: 鏡像を中心とする円（聞き手の高さの水平面で切った半径）。振幅は 500 Hz の値 */
export interface Front {
  x: number;
  y: number;
  rho: number;
  amp: number;
  order: number;
}

/**
 * 時刻 t [s]（音源が鳴ってから）の波面。聞き手の高さ z₀ の水平面と、鏡像を中心とする半径 c·t の球の交わり。
 * 部屋の中に見えるのは、部屋で切った円の弧
 */
export function fronts(room: Room, im: Images, t: number, c = C0, minAmp = 0): Front[] {
  const R = c * t,
    z0 = room.rcv[2],
    b500 = BANDS.indexOf(500),
    out: Front[] = [];
  for (let i = 0; i < im.n; i++) {
    const dz = im.z[i] - z0;
    if (Math.abs(dz) >= R) continue;
    const rho = Math.sqrt(R * R - dz * dz),
      /* 部屋の外の円は見えない: 中心から部屋までの最短距離が半径より遠い */
      ex = Math.max(0, -im.x[i], im.x[i] - room.dim[0]),
      ey = Math.max(0, -im.y[i], im.y[i] - room.dim[1]);
    if (Math.hypot(ex, ey) > rho) continue;
    /* 距離 R の振幅（鏡像の振幅は聞き手までの距離で割ってあるので掛け直す） */
    const amp = (im.amp[i * NB + b500] * im.r[i]) / Math.max(R, 1e-3);
    if (amp < minAmp) continue;
    out.push({ x: im.x[i], y: im.y[i], rho, amp, order: im.order[i] });
  }
  return out;
}
