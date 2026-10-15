/**
 * 経路図の曲線（DOM に依存しない）: 中心線、本影・金環帯の南北限界、半影の南北限界、
 * 日の出・日の入りに食が始まる・終わる曲線
 *
 * 中心線と限界は satkit（Apache-2.0）の Eclipse Path of Totality と同じ写像。
 * 日の出・日の入りの曲線は、基準面に写した地球の縁と半影の円の交点として求める（このツールで導いたもの）
 */
import { type Frame, frameAt, latLon, liftToSurface, limbPoint, toPlane, type Vec3 } from './earth';
import { type Elements, type State, stateAt } from './elements';

/** 経路の 1 点: 時刻 t [h]、緯度・経度 [rad]、地球固定の座標 */
export interface PathPoint {
  t: number;
  lat: number;
  lon: number;
  p: Vec3;
}

const pt = (t: number, p: Vec3): PathPoint => {
  const [lat, lon] = latLon(p);
  return { t, lat, lon, p };
};

/** 地表の点 (ξ, η, ζ) の、基準面の上での速さ (ξ', η') */
function surfaceRate(s: State, xi: number, eta: number, zeta: number): [number, number] {
  const sd = Math.sin(s.d);
  const cd = Math.cos(s.d);
  return [s.dmu * (zeta * cd - eta * sd), s.dmu * xi * sd - zeta * s.dd];
}

/** 時刻 t の中心線の点（影の軸が地球に当たらなければ null） */
export function centralPoint(e: Elements, t: number, dt = e.dt): PathPoint | null {
  const s = stateAt(e, t);
  const p = liftToSurface(frameAt(s, dt), s.x, s.y);
  return p && pt(t, p);
}

/**
 * 時刻 t の限界の点。umbra なら本影（|L2|）、そうでなければ半影（L1）の円の、
 * 相対速度に垂直な半径の端。side = +1 で速度の左（ふつうは北）、−1 で右
 */
export function limitPoint(e: Elements, t: number, umbra: boolean, side: number, dt = e.dt): PathPoint | null {
  const s = stateAt(e, t);
  const f = frameAt(s, dt);
  let xi = s.x;
  let eta = s.y;
  let zeta = 0;
  let p: Vec3 | null = null;
  for (let k = 0; k < 10; k++) {
    const [dxi, deta] = surfaceRate(s, xi, eta, zeta);
    const a = s.dx - dxi;
    const b = s.dy - deta;
    const n = Math.hypot(a, b);
    const L = umbra ? Math.abs(s.l2 - zeta * s.tf2) : s.l1 - zeta * s.tf1;
    xi = s.x - (side * L * b) / n;
    eta = s.y + (side * L * a) / n;
    p = liftToSurface(f, xi, eta);
    if (!p) return null;
    zeta = toPlane(f, p)[2];
  }
  return p && pt(t, p);
}

/** 時刻 t で、半影の円が地球の縁と交わる点（0〜2 個）。日の出・日の入りに食が始まる・終わる地点 */
export function rimPoints(e: Elements, t: number, dt = e.dt): PathPoint[] {
  const s = stateAt(e, t);
  const f: Frame = frameAt(s, dt);
  const N = 180;
  const res: PathPoint[] = [];
  const g = (q: number) => {
    const l = limbPoint(f, q);
    // 縁の点の ζ はほぼ 0 だが、扁平のため厳密には 0 にならない
    const L = s.l1 - toPlane(f, l.p)[2] * s.tf1;
    return Math.hypot(l.xi - s.x, l.eta - s.y) - L;
  };
  let q0 = 0;
  let g0 = g(q0);
  for (let k = 1; k <= N; k++) {
    const q1 = (k / N) * 2 * Math.PI;
    const g1 = g(q1);
    if (g0 * g1 < 0) {
      let lo = q0;
      let hi = q1;
      let glo = g0;
      for (let it = 0; it < 40; it++) {
        const mid = (lo + hi) / 2;
        const gm = g(mid);
        if (gm * glo <= 0) hi = mid;
        else {
          lo = mid;
          glo = gm;
        }
      }
      res.push(pt(t, limbPoint(f, (lo + hi) / 2).p));
    }
    q0 = q1;
    g0 = g1;
  }
  return res;
}

/** 曲線を時間で刻む。地球に当たらない区間で切れた点列を返す */
export function trace(
  e: Elements,
  f: (t: number) => PathPoint | null,
  step = 1 / 60,
  t0 = e.tmin,
  t1 = e.tmax,
): PathPoint[][] {
  const out: PathPoint[][] = [];
  let cur: PathPoint[] = [];
  for (let t = t0; t <= t1 + 1e-9; t += step) {
    const q = f(t);
    if (q) cur.push(q);
    else if (cur.length) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

/** 中心線が地球に当たる区間の端の時刻（二分法で詰める）。中心線がなければ null */
export function centralSpan(e: Elements, dt = e.dt): [number, number] | null {
  const on = (t: number) => centralPoint(e, t, dt) !== null;
  const step = 1 / 120;
  let first = Number.NaN;
  let last = Number.NaN;
  for (let t = e.tmin; t <= e.tmax + 1e-9; t += step) {
    if (on(t)) {
      if (Number.isNaN(first)) first = t;
      last = t;
    }
  }
  if (Number.isNaN(first)) return null;
  const edge = (inside: number, outside: number) => {
    let a = inside;
    let b = outside;
    for (let k = 0; k < 40; k++) {
      const m = (a + b) / 2;
      if (on(m)) a = m;
      else b = m;
    }
    return a;
  };
  return [first > e.tmin ? edge(first, first - step) : first, last < e.tmax ? edge(last, last + step) : last];
}

/**
 * 日の出・日の入りに食が始まる・終わる曲線。各時刻の 0〜2 個の点を、近いものどうしでつないで線にする
 */
export function riseSetCurves(e: Elements, dt = e.dt, step = 1 / 120): PathPoint[][] {
  const done: PathPoint[][] = [];
  let open: PathPoint[][] = [];
  const dist = (a: PathPoint, b: PathPoint) => Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]);
  for (let t = e.tmin; t <= e.tmax + 1e-9; t += step) {
    const pts = rimPoints(e, t, dt);
    const next: PathPoint[][] = [];
    for (const q of pts) {
      let best = -1;
      let bd = 0.12;
      open.forEach((line, k) => {
        const d = dist(line[line.length - 1], q);
        if (d < bd && !next.includes(line)) {
          bd = d;
          best = k;
        }
      });
      if (best >= 0) {
        open[best].push(q);
        next.push(open[best]);
      } else next.push([q]);
    }
    for (const line of open) if (!next.includes(line)) done.push(line);
    open = next;
  }
  return [...done, ...open].filter((l) => l.length > 1);
}

/** 食が見える範囲の外縁: 半影の南北限界と、日の出・日の入りの曲線 */
export function outerCurves(e: Elements, dt = e.dt): PathPoint[][] {
  const pn = trace(e, (t) => limitPoint(e, t, false, 1, dt), 1 / 120);
  const ps = trace(e, (t) => limitPoint(e, t, false, -1, dt), 1 / 120);
  return [...pn, ...ps, ...riseSetCurves(e, dt)];
}
