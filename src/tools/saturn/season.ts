/**
 * 環の傾きの季節（DOM に依存しない）: 環の面の通過、環が最も開く時、タイタンの影と通過の探索
 */
import { bisect } from '../../lib/astro/solve';
import { cross, dot, mul, unit, type Vec3 } from '../../lib/astro/vec';
import { C_KMD, type Ephem, type Geo, slowAt } from '../../lib/planet/ephem';
import { limb, toEarth } from '../../lib/planet/events';
import { SATURN_MODEL as M, RE, RP, ringTilt } from './model';

/** [JD, B, B′]（°） */
export type TiltPoint = [number, number, number];

export const tiltAt = (jd: number): TiltPoint => {
  const { b, bs } = ringTilt(slowAt(M, jd));
  return [jd, b, bs];
};

/** 環の面を地球または太陽が横切る時 */
export interface Crossing {
  t: number;
  who: 'earth' | 'sun';
}

/** 傾きの列から、環の面の通過を探す（二分法で 1 分ほどまで詰める） */
export function crossings(pts: TiltPoint[]): Crossing[] {
  const out: Crossing[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1],
      b = pts[i];
    for (const [who, c] of [
      ['earth', 1],
      ['sun', 2],
    ] as const) {
      if (a[c] < 0 === b[c] < 0) continue;
      const t = bisect((x: number) => tiltAt(x)[c], a[0], b[0], 14);
      out.push({ t, who });
    }
  }
  return out.sort((x, y) => x.t - y.t);
}

/** 環が最も開く時: 太陽の通過の間ごとに、地球から見た傾きの絶対値が最大の時刻 */
export function widest(pts: TiltPoint[], cross: Crossing[]): TiltPoint[] {
  const suns = cross.filter((c) => c.who === 'sun').map((c) => c.t);
  const out: TiltPoint[] = [];
  for (let i = 1; i < suns.length; i++) {
    let best: TiltPoint | null = null;
    for (const p of pts)
      if (p[0] > suns[i - 1] && p[0] < suns[i] && (!best || Math.abs(p[1]) > Math.abs(best[1]))) best = p;
    if (!best) continue;
    /* 前後を細かく探す */
    let top = best;
    for (let t = best[0] - 20; t <= best[0] + 20; t += 1) {
      const q = tiltAt(t);
      if (Math.abs(q[1]) > Math.abs(top[1])) top = q;
    }
    out.push(top);
  }
  return out;
}

/** 衛星 k だけの幾何（自転を省くので軽い。limb は自転に依らない） */
function oneMoon(e: Ephem, k: number, t: number): { g: Geo; m: Vec3 } {
  const s = e.slow(t);
  const tl = s.jdTT - s.lt;
  const u = unit(s.P);
  const v = mul(s.M, M.moon(k, tl));
  const m = mul(s.M, M.moon(k, tl - dot(v, u) / C_KMD));
  return { g: { ...s, x: s.q, y: cross(s.z, s.q), moons: [] }, m };
}

export interface MoonPass {
  kind: 'SH' | 'TR';
  t0: number;
  t1: number;
}

/** [jd0, jd1] の衛星 k の影の通過（SH）と土星の前の通過（TR）。step は刻み [日] */
export function findPasses(e: Ephem, k: number, jd0: number, jd1: number, step = 1 / 24): MoonPass[] {
  const out: MoonPass[] = [];
  const fs = (t: number) => {
    const { g, m } = oneMoon(e, k, t);
    return limb(g, RE, RP, m, g.s);
  };
  const fo = (t: number) => {
    const { g, m } = oneMoon(e, k, t);
    return limb(g, RE, RP, m, toEarth(g));
  };
  for (const [kind, f] of [
    ['SH', fs],
    ['TR', fo],
  ] as const) {
    const on = (r: [number, boolean]) => r[0] < 0 && r[1];
    let open: number | null = null;
    let prev = on(f(jd0));
    if (prev) open = jd0;
    for (let t = jd0 + step; t <= jd1; t += step) {
      const cur = on(f(t));
      if (cur !== prev) {
        const edge = bisect((x: number) => f(x)[0], t - step, t, 18);
        if (cur) open = edge;
        else if (open !== null) {
          out.push({ kind, t0: open, t1: edge });
          open = null;
        }
      }
      prev = cur;
    }
    if (open !== null) out.push({ kind, t0: open, t1: jd1 });
  }
  return out.sort((a, b) => a.t0 - b.t0);
}
