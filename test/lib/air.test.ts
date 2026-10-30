import { describe, expect, it } from 'vitest';
import { AirFilter, absorption, airPole, airPoleDb, exactMid, soundSpeed } from '../../src/lib/air';

describe('空気の吸収（ISO 9613-1）', () => {
  it('10 °C・70 % のオクターブの値が、以前の ISO 9613-2 の表（0.1・0.4・1・1.9・3.7・9.7・32.8・117 dB/km）と合う', () => {
    const table: [number, number, number][] = [
      [63, 0.1, 0.05],
      [125, 0.4, 0.05],
      [250, 1, 0.05],
      [500, 1.9, 0.05],
      [1000, 3.7, 0.05],
      [2000, 9.7, 0.05],
      [4000, 32.8, 0.05],
      [8000, 117, 0.5],
    ];
    for (const [f, db, tol] of table) {
      const a = absorption(exactMid(f), { t: 10, rh: 70 }) * 1000;
      expect(Math.abs(a - db), `${f} Hz: ${a}`).toBeLessThanOrEqual(tol);
    }
  });
  it('乾いた空気ほど高い音が減り、周波数とともに増える', () => {
    expect(absorption(4000, { t: 20, rh: 20 })).toBeGreaterThan(absorption(4000, { t: 20, rh: 70 }));
    let prev = 0;
    for (const f of [100, 500, 1000, 2000, 4000, 8000, 16000]) {
      const a = absorption(f);
      expect(a).toBeGreaterThan(prev);
      prev = a;
    }
  });
  it('中心周波数の正確な値は 10 の 1/10 乗の刻み', () => {
    expect(exactMid(1000)).toBe(1000);
    expect(exactMid(4000)).toBeCloseTo(3981.07, 2);
    expect(exactMid(63)).toBeCloseTo(63.096, 3);
  });
  it('音速は 20 °C で 343.2 m/s、0 °C で 331.3 m/s', () => {
    expect(soundSpeed(20)).toBeCloseTo(343.2, 10);
    expect(soundSpeed(0)).toBeCloseTo(331.3, 1);
  });
});

describe('吸収の低域通過', () => {
  const fs = 48000;
  it('減衰が 10 dB までの周波数では、式との差が 2.5 dB 以内（20 m〜3 km）', () => {
    for (const r of [20, 100, 300, 1000, 3000]) {
      const p = airPole(r, fs);
      for (const f of [250, 500, 1000, 2000, 4000, 8000, 12000, 16000]) {
        const want = absorption(f) * r;
        if (want > 10) continue;
        expect(Math.abs(airPoleDb(p, f, fs) - want), `${r} m ${f} Hz`).toBeLessThanOrEqual(2.5);
      }
    }
  });
  it('距離が 0 なら素通し、遠いほど高い音を絞る', () => {
    expect(airPole(0, fs)).toBe(0);
    expect(airPoleDb(airPole(1000, fs), 8000, fs)).toBeGreaterThan(airPoleDb(airPole(100, fs), 8000, fs));
  });
  it('フィルタの直流の利得は 1', () => {
    const f = new AirFilter();
    f.p = airPole(500, fs);
    let y = 0;
    for (let i = 0; i < 20000; i++) y = f.step(1);
    expect(y).toBeCloseTo(1, 6);
  });
});
