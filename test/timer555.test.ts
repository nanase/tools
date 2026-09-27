import { describe, expect, it } from 'vitest';
import { SW } from '../src/lib/scope';
import { solve, wave } from '../src/tools/timer555/model';

const LN2 = Math.LN2;

describe('555 非安定マルチバイブレータ', () => {
  const input = { r1: 10e3, r2: 10e3, c1: 100e-9, vcc: 5 };
  const o = solve(input);

  it('H・L の時間と周期', () => {
    expect(o.tH).toBeCloseTo(LN2 * 20e3 * 100e-9, 15);
    expect(o.tL).toBeCloseTo(LN2 * 10e3 * 100e-9, 15);
    expect(o.T).toBeCloseTo(o.tH + o.tL, 15);
  });

  it('周波数はモックの表示どおり 480.9 Hz', () => {
    expect(o.f).toBeCloseTo(1 / (LN2 * 30e3 * 100e-9), 9);
    expect(o.f).toBeCloseTo(480.898, 3);
  });

  it('デューティ比は (R1 + R2) / (R1 + 2 R2)', () => {
    expect(o.D).toBeCloseTo(200 / 3, 12);
    expect(solve({ ...input, r1: 1e3, r2: 100e3 }).D).toBeCloseTo((101 / 201) * 100, 12);
    expect(solve({ ...input, r1: 100e3, r2: 1e3 }).D).toBeGreaterThan(98);
  });

  it('R1 の最大電流と最大損失', () => {
    expect(o.I).toBeCloseTo(5e-4, 15);
    expect(o.P).toBeCloseTo(2.5e-3, 15);
    expect(solve({ ...input, r1: 100, vcc: 18 }).P).toBeCloseTo(3.24, 12);
  });

  it('波形: 1 周期が 3 div 前後になる時間軸と、電源の 1/5 以上の電圧軸', () => {
    const w = wave(input, o);
    expect(w.td).toBe(1e-3);
    expect(w.vd).toBe(1);
    expect(w.ch1.startsWith('M0 ')).toBe(true);
    expect(w.ch1.endsWith(`H${SW}`)).toBe(true);
    /* 1/3 VCC と 2/3 VCC の閾値線 */
    expect(w.y1).toBeCloseTo(200 - (5 / 3) * 40, 2);
    expect(w.y2).toBeCloseTo(200 - (10 / 3) * 40, 2);
  });

  it('波形: C1 の電圧は 1/3 VCC と 2/3 VCC の間にある', () => {
    const w = wave(input, o);
    const ys = [...w.ch2.matchAll(/[ML][\d.]+ ([\d.-]+)/g)].map((m) => Number(m[1]));
    expect(ys).toHaveLength(601);
    for (const y of ys) {
      expect(y).toBeLessThanOrEqual(w.y1 + 0.01);
      expect(y).toBeGreaterThanOrEqual(w.y2 - 0.01);
    }
  });
});
