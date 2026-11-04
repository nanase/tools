import { describe, expect, it } from 'vitest';
import {
  BODIES,
  type Condition,
  EJECTA,
  ejectaSpeed,
  entry,
  finalCrater,
  plan,
  transientD,
  transitionD,
} from '../src/tools/impact/model';
import { fmtLen, fmtT, sci } from '../src/tools/impact/params';
import { analyze, measureCrater, type Run, smooth } from '../src/tools/impact/run';
import { createSim, type SimFrame } from '../src/tools/impact/sim';

const base: Condition = { L: 1000, v: 20, th: 45, body: 'earth', air: true, imp: 'stone', tgt: 'rock', q: 70 };

describe('大気圏突入（Collins ほか 2005）', () => {
  const earth = BODIES.earth;

  it('表 6 の鉄 40 m は砕けながら地面に届き、速度が半分ほどになる', () => {
    const e = entry(40, 8000, 20000, 45, earth, true);
    expect(e.kind).toBe('breakup');
    expect(e.v / 20000).toBeGreaterThan(0.35);
    expect(e.v / 20000).toBeLessThan(0.6);
  });

  it('ツングースカ相当の岩石は空中で爆発する', () => {
    const e = entry(60, 2700, 15000, 45, earth, true);
    expect(e.kind).toBe('airburst');
    expect(e.zb).toBeGreaterThan(3000);
    expect(e.zb).toBeLessThan(12000);
  });

  it('大きい衝突体はほとんど減速しない', () => {
    expect(entry(18000, 2700, 20000, 45, earth, true).v / 20000).toBeGreaterThan(0.99);
  });

  it('大気がなければ減速しない', () => {
    expect(entry(10, 3000, 20000, 45, BODIES.moon, false)).toEqual({ kind: 'none', v: 20000 });
    expect(entry(10, 3000, 20000, 45, earth, false).v).toBe(20000);
  });
});

describe('クレーターの大きさ（Collins ほか 2005）', () => {
  it('表 6 のリースとチクシュルーブに近い（論文は Dc = 3.2 km、ここは Schenk の 4.5 km）', () => {
    const f = (L: number) => finalCrater(transientD(L, 2700, 20000, 45, 9.81, 'rock'), 9.81).Dfr / 1000;
    expect(f(1750)).toBeGreaterThan(20);
    expect(f(1750)).toBeLessThan(26);
    expect(f(18000)).toBeGreaterThan(160);
    expect(f(18000)).toBeLessThan(195);
  });

  it('重力が小さいほど単純クレーターの範囲が広い', () => {
    expect(transitionD(1.62) / 1000).toBeGreaterThan(10);
    expect(transitionD(9.81)).toBeLessThan(transitionD(1.62));
    expect(finalCrater(5000, 1.62).kind).toBe('単純クレーター');
    expect(finalCrater(5000, 9.81).kind).toBe('中央丘クレーター');
  });

  it('速いほど、角度が大きいほど大きくなる', () => {
    const d = (v: number, th: number) => transientD(1000, 3000, v, th, 9.81, 'rock');
    expect(d(40000, 45)).toBeGreaterThan(d(20000, 45));
    expect(d(20000, 90)).toBeGreaterThan(d(20000, 30));
  });

  it('計算の条件は空中で爆発しても壊れない', () => {
    const p = plan({ ...base, L: 60, v: 15 });
    expect(p.e.kind).toBe('airburst');
    expect(Number.isFinite(p.size)).toBe(true);
  });
});

describe('噴出物の速度（Housen & Holsapple 2011）', () => {
  it('縁に近いほど遅く、n2 Rc の外では 0 になる', () => {
    const law = EJECTA.rock;
    expect(ejectaSpeed(law, 1000, 5000, 9.81)).toBeGreaterThan(ejectaSpeed(law, 4000, 5000, 9.81));
    expect(ejectaSpeed(law, 8000, 5000, 9.81)).toBe(0);
  });
  it('重力が小さいと遅い', () => {
    expect(ejectaSpeed(EJECTA.sand, 1000, 5000, 1.62)).toBeLessThan(ejectaSpeed(EJECTA.sand, 1000, 5000, 9.81));
  });
});

describe('地表の線から測る寸法', () => {
  it('お椀の形の直径と深さを測る', () => {
    const n = 200,
      dx = 100,
      Rw = n * dx,
      R = 4000,
      s = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = -Rw / 2 + i * dx,
        a = Math.abs(x);
      s[i] = a < R ? -800 * (1 - (a / R) ** 2) + 200 : 200 * Math.exp(-(a - R) / 1500);
    }
    const m = measureCrater(s, dx, Rw, 0, 4000);
    expect(m.D).toBeGreaterThan(7400);
    expect(m.D).toBeLessThan(8600);
    expect(m.depth).toBeGreaterThan(700);
    expect(m.depth).toBeLessThan(900);
    expect(Math.abs(m.xc)).toBeLessThan(300);
  });

  it('なめらかにしても欠けた列を数えない', () => {
    expect(smooth(Float32Array.of(-1e9, 1, 1, 1, -1e9))[2]).toBe(1);
  });
});

describe('工程の時刻', () => {
  const frameAt = (t: number, depth: number) =>
    ({
      t,
      base: false,
      surf: Float32Array.of(-depth, -depth),
      air: new Float32Array(0),
      land: new Float32Array(0),
    }) as unknown as Run['frames'][number];
  const newRun = (): Run =>
    ({
      c: base,
      pl: plan(base),
      info: { dx: 1, Rw: 2, D: 100, Tg: 100 },
      frames: [],
      land: [],
      res: null,
      secs: 0,
      lastGrid: null,
      tFall: null,
      tr: null,
      trFixed: false,
      aMax: -1,
      aSeen: 0,
      mt: null,
      st: [],
      col: null,
    }) as unknown as Run;

  it('穴が揺れて大きくなる間は掘削の終わりを決めない', () => {
    const r = newRun();
    for (const [t, d] of [
      [10, 5],
      [11, 8],
      [12, 7.9],
      [13, 9],
      [14, 8.9],
    ] as const) {
      r.frames.push(frameAt(t, d));
      analyze(r);
      expect(r.st[2]).toBe(Infinity);
    }
  });

  it('十分縮んだら掘削の終わりを決め、あとは動かさない', () => {
    const r = newRun();
    for (const [t, d] of [
      [10, 5],
      [20, 9],
      [30, 4],
    ] as const) {
      r.frames.push(frameAt(t, d));
      analyze(r);
    }
    expect(r.st[2]).toBe(20);
    r.frames.push(frameAt(40, 50));
    analyze(r);
    expect(r.st[2]).toBe(20);
  });
});

describe('表記', () => {
  it('長さと時間', () => {
    expect(fmtLen(500)).toBe('500 m');
    expect(fmtLen(1750)).toBe('1.75 km');
    expect(fmtLen(12300000)).toBe('12,300 km');
    expect(fmtT(0.5)).toBe('0.50 秒');
    expect(fmtT(300)).toBe('5.0 分');
  });
  it('大きい数は指数で書く', () => {
    expect(sci(7.4e4)).toBe('7.4 × 10⁴');
    expect(sci(162)).toBe('162');
  });
});

describe('計算（粗い格子）', () => {
  const pl = plan(base),
    b = BODIES.earth;
  const run = (over = {}) => {
    const sim = createSim({
      D: pl.domain,
      Lc: pl.Lc,
      v: pl.vS,
      thetaDeg: 45,
      g: b.g,
      target: 'rock',
      impactor: 'stone',
      airRho: b.rho0,
      atmH: b.H,
      R: b.R,
      dxN: 24,
      cVib: pl.cVib,
      tMaxF: 3,
      tEnd: 3000,
      ej: { law: EJECTA.rock, a: 500, Rc: pl.size / 2, n: 300 },
      ...over,
    });
    const frames: SimFrame[] = [];
    while (!sim.tick(1000, (f) => frames.push(f)));
    return { sim, frames, r: sim.result() };
  };
  const { sim, frames, r } = run();

  it('穴ができ、縁が地面より高くなる', () => {
    const m = measureCrater(r.surf, sim.info.dx, sim.info.Rw, 0, pl.f.Dfr / 2);
    expect(m.D).toBeGreaterThan(0.5 * pl.f.Dfr);
    expect(m.D).toBeLessThan(2 * pl.f.Dfr);
    expect(m.depth).toBeGreaterThan(0);
    expect(m.rim).toBeGreaterThan(0);
  });

  it('時刻は増え続け、値は壊れない', () => {
    for (let i = 1; i < frames.length; i++) expect(frames[i].t).toBeGreaterThanOrEqual(frames[i - 1].t);
    for (const f of frames) {
      expect(f.air.every(Number.isFinite)).toBe(true);
      expect(f.land.every(Number.isFinite)).toBe(true);
    }
  });

  it('岩が止まったあとは噴出物だけを追い、決めた時刻まで計算する', () => {
    expect(frames.some((f) => f.base)).toBe(true);
    expect(r.t).toBeGreaterThan(r.tFall);
    expect(r.tDone).toBeGreaterThan(r.tFall);
    expect(r.t).toBeGreaterThanOrEqual(r.tDone);
    expect(r.farS).toBeGreaterThan(pl.size);
  });

  it('巨大な衝突でも天体の円を切り取って解き、値が壊れない', () => {
    const p3 = plan({ ...base, L: 1000e3 }),
      o = run({
        D: p3.domain,
        Lc: p3.Lc,
        v: p3.vS,
        cVib: p3.cVib,
        ej: { law: EJECTA.rock, a: 500e3, Rc: p3.size / 2, n: 300 },
      });
    expect(p3.f.kind).toBe('衝突盆地');
    expect(o.sim.info.Rw).toBeLessThanOrEqual(2.4 * b.R);
    expect(o.frames.at(-1)?.air.every(Number.isFinite)).toBe(true);
    expect(o.r.surf.some((s) => s > -1e8)).toBe(true);
  });

  it('月では同じ衝突でも噴出物が飛び去ることがある（大気の抵抗もない）', () => {
    const m = BODIES.moon,
      p2 = plan({ ...base, body: 'moon', air: false }),
      o = run({ D: p2.domain, Lc: p2.Lc, v: p2.vS, g: m.g, airRho: 0, atmH: m.H, R: m.R, cVib: p2.cVib }).r;
    expect(o.escFrac).toBeGreaterThanOrEqual(0);
    expect(o.farS).toBeGreaterThan(p2.size);
  });
});
