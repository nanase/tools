/**
 * 潮の満ち引きの計算（DOM に依存しない）: 月と太陽の位置・平衡潮・潮回り・満潮と干潮・赤道を一周する海の浅水波
 *
 * 月は Meeus 47 章、太陽は VSOP87、章動と恒星時は Meeus 22・12 章（lib/astro）。
 * 平衡潮は地形も海の動きもない海が、月と太陽の引力の差に釣り合った高さ。港の潮位は赤道の東経 135° で数える
 */
import { eclToEqu, gast, nutation } from '../../lib/astro/frame';
import { sunEcl } from '../../lib/astro/sun';
import { deltaT } from '../../lib/astro/time';
import { dot, len, type Vec3 } from '../../lib/astro/vec';
import { ageAt, phaseTimes } from '../moon/ephem';
import { moonEcl } from '../moon/meeus';

export const HOUR = 3600000;
export const DAY = 86400000;
/** 港の経度 [°]。日本の標準時の子午線で、地方時が日本時間と同じになる */
export const PORT_LON = 135;
/** 平衡潮の振幅 [cm]: (3/2)(M/E)(a⁴/d³) を月は平均距離、太陽は 1 au で数えた値 */
export const K_MOON = 53.5;
export const K_SUN = 24.6;
const D_MOON = 384400;
const D_SUN = 149597870.7;

const jdOf = (ms: number): number => ms / DAY + 2440587.5;

export interface Sky {
  /** 月・太陽の地心の位置（真の赤道と分点 of date）[km] */
  moon: Vec3;
  sun: Vec3;
  /** グリニッジ視恒星時 [rad] */
  gst: number;
  /** 太陽から東へ測った月の赤経の差 [rad]（0 新月、π/2 上弦） */
  dra: number;
}

/** 時刻 ms の月と太陽 */
export function sky(ms: number): Sky {
  const jd = jdOf(ms),
    t = (jd + deltaT(jd) / 86400 - 2451545) / 36525,
    n = nutation(t),
    moon = eclToEqu(moonEcl(t), n),
    sun = eclToEqu(sunEcl(t), n);
  const dra = Math.atan2(moon[1], moon[0]) - Math.atan2(sun[1], sun[0]);
  return { moon, sun, gst: gast(jd, n), dra: ((dra % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) };
}

/** 平衡潮 [cm]: 月と太陽それぞれ K (d₀/d)³ (cos²z − 1/3) の和。z は天頂角 */
export function eqTideAt(s: Sky, latDeg: number, lonDeg: number, which: 'm' | 's' | 'ms' = 'ms'): number {
  const la = (latDeg * Math.PI) / 180,
    th = s.gst + (lonDeg * Math.PI) / 180,
    up: Vec3 = [Math.cos(la) * Math.cos(th), Math.cos(la) * Math.sin(th), Math.sin(la)];
  const body = (v: Vec3, k: number, d0: number): number => {
    const r = len(v),
      c = dot(v, up) / r;
    return k * (d0 / r) ** 3 * (c * c - 1 / 3);
  };
  return (which !== 's' ? body(s.moon, K_MOON, D_MOON) : 0) + (which !== 'm' ? body(s.sun, K_SUN, D_SUN) : 0);
}

/** 港（赤道・東経 135°）の潮位 [cm] */
export const portTide = (ms: number): number => eqTideAt(sky(ms), 0, PORT_LON);

/** 月の距離の比 (d₀/d)³ と太陽の距離の比 (1 au/d)³。海の計算の力の大きさに使う */
export function pullRatio(s: Sky): { moon: number; sun: number } {
  return { moon: (D_MOON / len(s.moon)) ** 3, sun: (D_SUN / len(s.sun)) ** 3 };
}

/** 北極の上から見て太陽を左（θ = π）に置いたときの、月の向きと港の向き [rad]（反時計回り） */
export function angles(s: Sky, lonDeg = PORT_LON): { moon: number; port: number } {
  /* 港の時角は太陽から測ると地方時の正午で 0。地球は北極の上から見て反時計回り */
  const ha = s.gst + (lonDeg * Math.PI) / 180 - Math.atan2(s.sun[1], s.sun[0]);
  return { moon: Math.PI + s.dra, port: Math.PI + ha };
}

/* ---------- 日付と潮回り ---------- */
/** 日本時間の 0 時（ms） */
export function jstMidnight(ms: number): number {
  const d = new Date(ms + 9 * HOUR);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 9 * HOUR;
}

/** 月齢（日本時間の正午） */
export const ageNoon = (ms: number): number => ageAt(jdOf(jstMidnight(ms) + 12 * HOUR));

const lunarCache = new Map<number, number>();
/** 旧暦の日（朔を含む日を 1 日とする。日本時間） */
export function lunarDay(ms: number): number {
  const d0 = jstMidnight(ms),
    hit = lunarCache.get(d0);
  if (hit !== undefined) return hit;
  const news = phaseTimes(jdOf(d0 - 31 * DAY), jdOf(d0 + DAY)).filter((p) => p.q === 0);
  const nm = news[news.length - 1];
  const day = nm ? Math.round((d0 - jstMidnight((nm.jd - 2440587.5) * DAY)) / DAY) + 1 : 1;
  if (lunarCache.size > 400) lunarCache.clear();
  lunarCache.set(d0, day);
  return day;
}

export type Shio = '大潮' | '中潮' | '小潮' | '長潮' | '若潮';
/** 旧暦の日ごとの潮回り（潮見表で広く使われる割り当て。1〜30 日） */
// biome-ignore format: 表
const SHIO: readonly Shio[] = [
  '大潮', '大潮', '大潮', '中潮', '中潮', '中潮', '小潮', '小潮', '小潮', '長潮',
  '若潮', '中潮', '中潮', '大潮', '大潮', '大潮', '大潮', '大潮', '中潮', '中潮',
  '中潮', '小潮', '小潮', '小潮', '長潮', '若潮', '中潮', '中潮', '中潮', '大潮',
];
export const shioOf = (lday: number): Shio => SHIO[Math.min(30, Math.max(1, lday)) - 1];
export const shioAt = (ms: number): Shio => shioOf(lunarDay(ms));

/** ms の翌日から数えて、潮回りが want に変わる最初の日の 0 時 */
export function nextShio(want: Shio, ms: number): number {
  const d0 = jstMidnight(ms);
  for (let k = 1; k <= 40; k++) {
    const d = d0 + k * DAY;
    if (shioAt(d + 12 * HOUR) === want && shioAt(d - 12 * HOUR) !== want) return d;
  }
  return d0;
}

/** [jd0, jd1) の朔・上弦・望・下弦を ms で */
export const quarters = (ms0: number, ms1: number): { ms: number; q: 0 | 1 | 2 | 3 }[] =>
  phaseTimes(jdOf(ms0), jdOf(ms1)).map((p) => ({ ms: (p.jd - 2440587.5) * DAY, q: p.q }));

/** 区間の満潮・干潮: f の極値を step ごとに探し、3 点の放物線で詰める */
export function extrema(
  f: (ms: number) => number,
  t0: number,
  t1: number,
  step = 10 * 60000,
): { ms: number; v: number; hi: boolean }[] {
  const out: { ms: number; v: number; hi: boolean }[] = [];
  let a = f(t0 - step),
    b = f(t0);
  for (let t = t0; t <= t1; t += step) {
    const c = f(t + step);
    if ((b > a && b >= c) || (b < a && b <= c)) {
      const den = a - 2 * b + c,
        dx = den ? (0.5 * (a - c)) / den : 0;
      const ms = t + dx * step;
      if (ms >= t0 && ms < t1) out.push({ ms, v: b - 0.25 * (a - c) * dx, hi: b > a });
    }
    a = b;
    b = c;
  }
  return out;
}

/* ---------- 赤道を一周する海（1 次元の浅水波） ---------- */
/**
 * 単位は地球の周を 2π、重力波の速さを 1 とする。u は流れ、η は海面の高さ。
 * ∂u/∂t = −∂η/∂θ − Σ A sin 2(θ − θ_b) − r u、∂η/∂t = −∂u/∂θ。力の項は平衡潮 (A/2) cos 2(θ − θ_b) の勾配
 */
export interface Ring {
  n: number;
  eta: Float64Array;
  u: Float64Array;
  /** 水の粒: 角度と、陸から海面までの高さの割合 */
  tr: { a: number; r: number }[];
}

export function makeRing(n = 240): Ring {
  return {
    n,
    eta: new Float64Array(n),
    u: new Float64Array(n),
    tr: Array.from({ length: 90 }, (_, i) => ({
      a: (i / 90) * 2 * Math.PI + 0.01 * i,
      r: 0.35 + (0.6 * ((i * 37) % 11)) / 10,
    })),
  };
}

/** forces: [振幅, 天体の向き θ] の並び */
export function stepRing(R: Ring, dt: number, forces: readonly (readonly [number, number])[], damp: number): void {
  const { n, eta, u } = R,
    dx = (2 * Math.PI) / n;
  for (let i = 0; i < n; i++) {
    const ip = (i + 1) % n,
      th = (i + 0.5) * dx;
    let F = 0;
    for (const [A, b] of forces) F -= A * Math.sin(2 * (th - b));
    u[i] += dt * (-(eta[ip] - eta[i]) / dx + F - damp * u[i]);
  }
  for (let i = 0; i < n; i++) eta[i] -= (dt * (u[i] - u[(i - 1 + n) % n])) / dx;
  for (const p of R.tr) {
    const x = (((p.a / dx - 0.5) % n) + n) % n,
      i0 = Math.floor(x),
      w = x - i0;
    p.a += dt * (u[i0] * (1 - w) + u[(i0 + 1) % n] * w) * 0.9;
  }
}

/** 角度 θ の海面の高さ（隣の格子の間を直線で補う） */
export function ringEta(R: Ring, th: number): number {
  const x = ((((th / (2 * Math.PI)) * R.n) % R.n) + R.n) % R.n,
    i0 = Math.floor(x),
    w = x - i0;
  return R.eta[i0] * (1 - w) + R.eta[(i0 + 1) % R.n] * w;
}
