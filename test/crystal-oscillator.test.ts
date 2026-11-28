import { describe, expect, it } from 'vitest';
import { CRYSTALS, type Crystal, XT } from '../src/tools/crystal-oscillator/crystals';
import { admittance, amp, CS, loadCap, MARGIN_OK, probe, solve, TAU } from '../src/tools/crystal-oscillator/model';
import { PARAMS } from '../src/tools/crystal-oscillator/params';
import { PROBES, SEGS } from '../src/tools/crystal-oscillator/schematic';

const m16 = XT.m16 as Crystal;

describe('既定の値', () => {
  it('どの水晶も既定の値で安定に発振し、励振レベルは上限以内', () => {
    for (const x of CRYSTALS) {
      const r = solve(x, x.def);
      expect(r.st, x.id).toBe(2);
      expect(r.margin, x.id).toBeGreaterThanOrEqual(MARGIN_OK);
      expect(r.p, x.id).toBeLessThanOrEqual(x.pmax);
    }
  });

  it('既定の値は入力の範囲の中', () => {
    for (const x of CRYSTALS)
      for (const d of PARAMS) {
        const v = x.def[d.k];
        expect(v, `${x.id} ${d.k}`).toBeGreaterThanOrEqual(d.min);
        expect(v, `${x.id} ${d.k}`).toBeLessThanOrEqual(d.max);
      }
  });

  it('既定の値では、周波数のずれが水晶ごとの目安の内に収まる', () => {
    for (const x of CRYSTALS) {
      const r = solve(x, x.def);
      expect(Math.abs(r.ppm), x.id).toBeLessThan(x.tol);
    }
  });
});

describe('発振の条件', () => {
  it('C1・C2 を大きくすると負性抵抗が減り、やがて発振しない', () => {
    let prev = Number.POSITIVE_INFINITY;
    for (const c of [22e-12, 47e-12, 100e-12, 220e-12, 470e-12]) {
      const r = solve(m16, { ...m16.def, c1: c, c2: c });
      expect(r.rneg).toBeLessThan(prev);
      prev = r.rneg;
    }
    expect(solve(m16, { ...m16.def, c1: 470e-12, c2: 470e-12 }).st).toBe(0);
  });

  it('Rd を小さくすると水晶に流れる電流が増え、過励振になる', () => {
    const big = solve(m16, { ...m16.def, rd: 4.7e3 }),
      small = solve(m16, { ...m16.def, rd: 0 });
    expect(small.p).toBeGreaterThan(big.p);
    expect(small.st).toBe(3);
  });

  it('負荷容量が大きいほど周波数は下がる（直列共振に近づく）', () => {
    const a = solve(m16, { ...m16.def, c1: 10e-12, c2: 10e-12 }),
      b = solve(m16, { ...m16.def, c1: 47e-12, c2: 47e-12 });
    expect(b.f).toBeLessThan(a.f);
    expect(b.f).toBeGreaterThan(b.fs);
  });

  it('負荷容量は浮遊容量を足した C1 と C2 の直列', () => {
    const cl = loadCap({ c1: 22e-12, c2: 22e-12, rd: 0, rf: 1e6 });
    expect(cl).toBeCloseTo((22e-12 + CS) / 2, 20);
  });

  it('Q は 2πfs·Lm / Rm で、帯域幅 fs / Q で電流が山の 1/√2 になる', () => {
    const r = solve(m16, m16.def),
      top = admittance(m16, r.lm, r.fs, 0),
      half = admittance(m16, r.lm, r.fs, r.fs / r.q / 2);
    expect(r.q).toBeCloseTo((TAU * r.fs * r.lm) / m16.rm, 6);
    expect(half / top).toBeCloseTo(Math.SQRT1_2, 2);
  });
});

describe('起動と減衰', () => {
  it('振れ幅は雑音から増え、起動時間で定常の 1/√2 になり、そのあと定常に近づく', () => {
    const r = solve(m16, m16.def);
    expect(amp(r, 0)).toBeCloseTo(1e-6, 9);
    expect(amp(r, r.ts) / r.vIn).toBeCloseTo(Math.SQRT1_2, 2);
    expect(amp(r, r.ts * 3) / r.vIn).toBeGreaterThan(0.999);
  });

  it('電源を切ると時定数 2Lm/Rm で減る', () => {
    const r = solve(m16, m16.def),
      off = r.ts * 3,
      a0 = amp(r, off, off);
    expect(amp(r, off + r.tau, off) / a0).toBeCloseTo(Math.exp(-1), 6);
  });

  it('発振しないときは振れ幅 0', () => {
    const r = solve(m16, { ...m16.def, c1: 470e-12, c2: 470e-12 });
    expect(amp(r, 1)).toBe(0);
  });
});

describe('回路図の電流', () => {
  it('XIN と水晶の右端の節点で出入りがつり合う', () => {
    const r = solve(m16, m16.def);
    for (let k = 0; k < 16; k++) {
      const p = probe(r, m16.def, r.vIn * 0.7, (k / 16) * TAU, true);
      expect(p.ix + p.irf - p.ic1).toBeCloseTo(0, 12);
      expect(p.ird - p.ic2 - p.ix).toBeCloseTo(0, 12);
    }
  });

  it('粒の通り道の線分は軸に平行で、地点の名前は 5 つ', () => {
    for (const s of SEGS) expect(s.a[0] === s.b[0] || s.a[1] === s.b[1]).toBe(true);
    expect(PROBES).toHaveLength(5);
  });
});
