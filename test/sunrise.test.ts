import { describe, expect, it } from 'vitest';
import { band, geoAltAz, subsolar, sunEq, sunEqLow } from '../src/tools/sunrise/sun';

const D = Math.PI / 180;
const TOKYO = [35.6895, 139.6917] as const;

describe('太陽の位置', () => {
  it('夏至の赤緯は +23.44° 付近', () => {
    expect(sunEq(Date.UTC(2026, 5, 21, 3)).dec / D).toBeCloseTo(23.44, 1);
  });

  it('低精度の式は VSOP87 と 0.02° 以内', () => {
    for (const ms of [Date.UTC(2026, 0, 1), Date.UTC(2026, 3, 1, 6), Date.UTC(2026, 9, 15, 18)]) {
      const a = geoAltAz(sunEq(ms), ...TOKYO);
      const b = geoAltAz(sunEqLow(ms), ...TOKYO);
      expect(Math.abs(a.h - b.h)).toBeLessThan(0.02);
    }
  });

  it('太陽が真上の地点では高度 90°', () => {
    const s = sunEq(Date.UTC(2026, 2, 20, 12));
    const p = subsolar(s);
    expect(geoAltAz(s, p.lat, p.lon).h).toBeCloseTo(90, 3);
    expect(Math.abs(p.lon)).toBeLessThanOrEqual(180);
  });

  it('東京の南中では方位 180°', () => {
    // 2026-11-18 の東京の南中は 11:26 JST ごろ
    const a = geoAltAz(sunEq(Date.UTC(2026, 10, 18, 2, 26)), ...TOKYO);
    expect(Math.abs(a.az - 180)).toBeLessThan(1);
  });

  it('段の境', () => {
    expect([1, -0.833, -1, -6.1, -12.1, -18.1].map(band)).toEqual([0, 0, 1, 2, 3, 4]);
  });
});
