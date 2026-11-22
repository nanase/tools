import { describe, expect, it } from 'vitest';
import {
  angles,
  DAY,
  eqTideAt,
  extrema,
  HOUR,
  jstMidnight,
  lunarDay,
  makeRing,
  nextShio,
  portTide,
  ringEta,
  shioAt,
  sky,
  stepRing,
} from '../src/tools/tide/model';

const at = (s: string): number => Date.parse(s);

describe('平衡潮', () => {
  it('月の真下で高く、90° 離れた所で低い', () => {
    const s = sky(at('2026-01-01T00:00:00Z'));
    const ra = Math.atan2(s.moon[1], s.moon[0]),
      dec = (Math.asin(s.moon[2] / Math.hypot(...s.moon)) * 180) / Math.PI,
      lon = ((((ra - s.gst) * 180) / Math.PI + 540) % 360) - 180;
    const under = eqTideAt(s, dec, lon, 'm'),
      side = eqTideAt(s, 0, lon + 90, 'm');
    expect(under).toBeGreaterThan(30);
    expect(under).toBeLessThan(48); /* 近地点では (d₀/d)³ で 2 割ほど大きい */
    expect(side).toBeLessThan(-15);
  });

  it('港の潮位は 1 日に満潮と干潮が 2 回ずつ', () => {
    const t0 = at('2026-03-10T00:00:00Z'),
      ex = extrema(portTide, t0, t0 + 2 * DAY);
    expect(ex.filter((p) => p.hi).length).toBeGreaterThanOrEqual(3);
    expect(ex.filter((p) => p.hi).length).toBeLessThanOrEqual(4);
    expect(ex.filter((p) => !p.hi).length).toBeGreaterThanOrEqual(3);
  });

  it('大潮の日は小潮の日より干満の差が大きい', () => {
    const range = (ms: number): number => {
      const v = Array.from({ length: 145 }, (_, i) => portTide(ms + i * 10 * 60000));
      return Math.max(...v) - Math.min(...v);
    };
    /* 2026-01-03 は満月、2026-01-10 は下弦 */
    expect(range(at('2026-01-03T00:00:00Z'))).toBeGreaterThan(range(at('2026-01-10T00:00:00Z')) * 1.6);
  });
});

describe('向き', () => {
  it('正午の港は太陽の向き、真夜中は反対', () => {
    const noon = angles(sky(at('2026-06-01T03:00:00Z'))).port,
      night = angles(sky(at('2026-06-01T15:00:00Z'))).port;
    const near = (a: number, b: number) => Math.abs(((a - b + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    /* 均時差の分（±16 分）だけずれてよい */
    expect(near(noon, Math.PI)).toBeLessThan(0.08);
    expect(near(night, 0)).toBeLessThan(0.08);
  });

  it('満月の月は太陽の反対', () => {
    const m = angles(sky(at('2026-01-03T10:03:00Z'))).moon;
    expect(Math.abs(((m + 3 * Math.PI) % (2 * Math.PI)) - Math.PI)).toBeLessThan(0.1);
  });
});

describe('潮回り', () => {
  it('朔の日が旧暦の 1 日で、大潮', () => {
    /* 2026-02-17 12:01 UTC が朔（日本時間 21:01） */
    expect(lunarDay(at('2026-02-17T05:00:00Z'))).toBe(1);
    expect(lunarDay(at('2026-02-16T05:00:00Z'))).toBeGreaterThanOrEqual(29);
    expect(shioAt(at('2026-02-17T05:00:00Z'))).toBe('大潮');
  });

  it('旧暦の 10 日は長潮、11 日は若潮', () => {
    expect(shioAt(at('2026-02-26T05:00:00Z'))).toBe('長潮');
    expect(shioAt(at('2026-02-27T05:00:00Z'))).toBe('若潮');
  });

  it('次の大潮は潮回りが大潮に変わる日の 0 時', () => {
    const d = nextShio('大潮', at('2026-02-20T05:00:00Z'));
    expect(d).toBe(jstMidnight(d));
    expect(shioAt(d + 12 * HOUR)).toBe('大潮');
    expect(shioAt(d - 12 * HOUR)).not.toBe('大潮');
  });
});

describe('海の計算', () => {
  it('月の向きと反対側に膨らむ', () => {
    const R = makeRing();
    for (let i = 0; i < 4000; i++) stepRing(R, 0.012, [[0.3, 0]], 0.25);
    const top = ringEta(R, 0),
      back = ringEta(R, Math.PI),
      side = ringEta(R, Math.PI / 2);
    expect(top).toBeGreaterThan(0.1);
    expect(Math.abs(top - back)).toBeLessThan(0.01);
    expect(side).toBeLessThan(-0.05);
  });

  it('海の量は増えも減りもしない', () => {
    const R = makeRing();
    for (let i = 0; i < 2000; i++)
      stepRing(
        R,
        0.012,
        [
          [0.3, 0.4],
          [0.14, Math.PI],
        ],
        0.25,
      );
    expect(Math.abs(R.eta.reduce((a, b) => a + b, 0))).toBeLessThan(1e-9);
  });
});
